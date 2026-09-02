/**
 * patientDirectory.mjs — "whose number is this?", answered from Postgres.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 * Every surface that shows a caller's name resolved it by fanning out across
 * seven Monday boards at the moment it was needed. The Communications Hub batches
 * that (CLAUDE.md §5.28), but batching only makes a slow answer cheaper, not
 * fast — a 900-conversation inbox still took several round trips before the
 * names appeared. And `findPatientByPhone` runs its seven board queries WHILE
 * THE PHONE IS RINGING, which is the worst possible moment to be waiting on
 * Monday.
 *
 * The names barely change. So this keeps a copy: number → name, refreshed once
 * a day, answered in one indexed query.
 *
 * ── ⚠️ THIS TABLE HOLDS PHI, AND THAT IS A DEPARTURE ────────────────────────
 * Taken explicitly (Josh, 2026-09-02), on the same terms as the SMS archive
 * beside it, and bounded the same two ways:
 *   · It lives on the MESSAGING pool (ASSIGNMENTS_DATABASE_URL), never the
 *     audit pool — the separation index.mjs draws so the audit DB keeps its
 *     "metadata only, no PHI" property. Do not move this table.
 *   · The number is stored as HMAC + last4, NEVER in the clear, exactly as
 *     sent_messages, call_events and sms_archive do it. A lookup hashes the
 *     number the caller asks about, so the table holds no number anybody can
 *     read back.
 * What IS in the clear is the patient's NAME. That is the departure: a dump of
 * this table is a list of our patients' names. It buys a name on screen the
 * instant a call comes in, and the alternative — resolving names from Monday on
 * the ringing path — is what it replaces.
 *
 * ── Why a full reconcile, not a webhook or a cursor ─────────────────────────
 * Each run re-reads EVERY board and upserts, so any single successful run
 * repairs every prior gap. A week of failures costs nothing so long as one run
 * lands. An incremental design turns one bad run into permanent missing names,
 * and this gateway redeploys on every push to main, so bad runs are a
 * certainty. Same reasoning as the SMS archive (§5.27) and the inbound-call
 * subscription (§5.13): reconcile, never blindly increment.
 *
 * ⚠️ **A miss is not an answer.** The directory is at most a day old, so a
 * patient created this morning is genuinely absent from it. Callers must fall
 * back to the live Monday lookup on a miss rather than rendering a bare number
 * — see `lib/commsHub/directoryApi.ts`. That fallback is what makes a stale or
 * even an empty directory a performance regression rather than a correctness
 * one.
 */
import { authEnforced } from "./auth.mjs";
import { phoneHmac, hashingConfigured } from "./phoneHash.mjs";
import {
  DIRECTORY_BOARDS,
  MAX_PAGES,
  PAGE_SIZE,
  boundLookup,
  collapseRows,
  directoryHealth,
  toDirectoryRow,
} from "./patientDirectoryRules.mjs";

const MONDAY_URL = "https://api.monday.com/v2";
const TOKEN = process.env.MONDAY_API_TOKEN;
const VER = process.env.MONDAY_API_VERSION || "2024-10";

/**
 * ⚠️ Its OWN statement, deliberately not appended to another module's SCHEMA
 * template. index.mjs records why: that block ends in a DROP+CREATE VIEW which
 * takes every CREATE TABLE with it when it fails.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS patient_directory (
  -- The hashed number IS the identity here: one row per number, holding the
  -- name from the furthest-along board (see collapseRows).
  phone_hmac      TEXT PRIMARY KEY,
  last4           TEXT,                 -- matching hint only; four digits collide
  name            TEXT NOT NULL,
  monday_item_id  TEXT,
  board_id        BIGINT,
  board_name      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patient_directory_last4_idx ON patient_directory (last4);

-- One row per reconcile. A job that silently stopped running is the failure
-- this module exists to prevent, and an empty directory with no run history
-- looks exactly like an empty directory that is working fine.
CREATE TABLE IF NOT EXISTS patient_directory_runs (
  id          BIGSERIAL PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  ok          BOOLEAN,
  boards      INT,
  pages       INT,
  seen        INT,
  written     INT,
  truncated   BOOLEAN DEFAULT false,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS patient_directory_runs_ok_idx ON patient_directory_runs (ok, finished_at DESC);
`;

const EVERY_MS = Math.max(Number(process.env.PATIENT_DIRECTORY_EVERY_HOURS) || 24, 1) * 3600_000;
/** A boot run is skipped when a successful one landed this recently — the
 *  gateway redeploys on every push to main, and without this a busy afternoon
 *  of deploys would each trigger a full board scan. */
const MIN_GAP_MS = Math.max(Number(process.env.PATIENT_DIRECTORY_MIN_GAP_HOURS) || 6, 0) * 3600_000;
/** Rows per INSERT. 6 columns, so 200 rows is 1,200 bind parameters — well
 *  under Postgres' 65535 cap, and one round trip instead of two hundred. */
const CHUNK = 200;
/** Floor between FORCED reconciles, for the same reason the archive has one:
 *  `running` blocks only CONCURRENT runs, so a client that posts again each
 *  time the last one finishes would scan every board on demand. */
const FORCE_MIN_GAP_MS = Math.max(Number(process.env.PATIENT_DIRECTORY_FORCE_MIN_GAP_MINUTES) || 5, 0) * 60_000;
let lastForcedAt = 0;

async function callMonday(query, variables) {
  const r = await fetch(MONDAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: TOKEN, "API-Version": VER },
    body: JSON.stringify({ query, variables }),
  });
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    throw new Error(`Monday non-JSON (${r.status}): ${t.slice(0, 200)}`);
  }
  // ⚠️ A 200 with an `errors` array is Monday's most common silent failure
  // (§5.2, §10). Treating it as success would write an EMPTY directory over a
  // good one and report a clean run.
  if (j.errors) throw new Error("Monday errors: " + JSON.stringify(j.errors));
  if (!r.ok) throw new Error(`Monday HTTP ${r.status}: ${t.slice(0, 200)}`);
  if (j.data === undefined || j.data === null) throw new Error(`Monday returned no data (${r.status})`);
  return j.data;
}

const FIRST_PAGE = `
  query ($board: [ID!], $cols: [String!], $limit: Int!) {
    boards (ids: $board) {
      items_page (limit: $limit) { cursor items { id name column_values (ids: $cols) { id text } } }
    }
  }`;
const NEXT_PAGE = `
  query ($cursor: String!, $cols: [String!], $limit: Int!) {
    next_items_page (limit: $limit, cursor: $cursor) {
      cursor items { id name column_values (ids: $cols) { id text } }
    }
  }`;

/** Every named, phone-bearing item on one board. */
async function scanBoard(board) {
  const cols = [board.phoneColId];
  const rows = [];
  let pages = 0;
  let truncated = false;

  const first = await callMonday(FIRST_PAGE, { board: [String(board.boardId)], cols, limit: PAGE_SIZE });
  let page = first?.boards?.[0]?.items_page;
  for (;;) {
    pages += 1;
    for (const it of page?.items ?? []) {
      const row = toDirectoryRow(it, board, phoneHmac);
      if (row) rows.push(row);
    }
    const cursor = page?.cursor ?? null;
    if (!cursor) break;
    if (pages >= MAX_PAGES) {
      // Reported, never swallowed: a board we only half-read leaves patients
      // permanently unnamed, and that must not read as a healthy run.
      truncated = true;
      break;
    }
    const next = await callMonday(NEXT_PAGE, { cursor, cols, limit: PAGE_SIZE });
    page = next?.next_items_page;
    if (!page) break;
  }
  return { rows, pages, truncated };
}

export function upsertSql(count) {
  const cols = 6;
  const tuples = [];
  for (let i = 0; i < count; i++) {
    const b = i * cols;
    tuples.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},now())`);
  }
  // ⚠️ DO UPDATE, not DO NOTHING: a patient who was renamed, or who moved to a
  // later board, must overwrite the older row. DO NOTHING would pin whatever
  // name the directory happened to see first, forever.
  return (
    `INSERT INTO patient_directory
       (phone_hmac, last4, name, monday_item_id, board_id, board_name, updated_at)
     VALUES ${tuples.join(",")}
     ON CONFLICT (phone_hmac) DO UPDATE SET
       name           = EXCLUDED.name,
       last4          = EXCLUDED.last4,
       monday_item_id = EXCLUDED.monday_item_id,
       board_id       = EXCLUDED.board_id,
       board_name     = EXCLUDED.board_name,
       updated_at     = now()`
  );
}

async function upsertRows(pool, rows) {
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const args = [];
    for (const r of slice) args.push(r.phoneHmac, r.last4, r.name, r.mondayItemId, r.boardId, r.boardName);
    const res = await pool.query(upsertSql(slice.length), args);
    written += res.rowCount || 0;
  }
  return written;
}

/** One reconcile may run at a time — a boot run and a timer tick can land
 *  together, and two full scans would double the Monday spend to write the
 *  same rows. Same coalescing lesson as the call-subscription reconcile. */
let running = false;

export async function reconcilePatientDirectory({ pool } = {}) {
  if (!pool) return { ok: false, error: "directory pool not configured" };
  if (!TOKEN) return { ok: false, error: "MONDAY_API_TOKEN not set" };
  if (!hashingConfigured()) return { ok: false, error: "PHONE_HMAC_PEPPER not set" };
  if (running) return { ok: false, skipped: true, error: "a reconcile is already running" };
  running = true;

  const stats = { boards: 0, pages: 0, seen: 0, written: 0, truncated: false };
  let runId = null;
  try {
    runId = (await pool.query(`INSERT INTO patient_directory_runs DEFAULT VALUES RETURNING id`)).rows[0]?.id;

    const all = [];
    for (const board of DIRECTORY_BOARDS) {
      // Boards are scanned one after another on purpose: this is bulk work with
      // nobody waiting, and it shares Monday's complexity budget with every
      // page a rep has open (§5.25 — a big read on a poll is what drained it).
      const { rows, pages, truncated } = await scanBoard(board);
      all.push(...rows);
      stats.boards += 1;
      stats.pages += pages;
      stats.seen += rows.length;
      if (truncated) stats.truncated = true;
    }

    // ⚠️ Collapse BEFORE writing. One number is several board items, and the
    // table is keyed by number — writing uncollapsed rows would make the
    // surviving name depend on upsert order, i.e. on Monday's scan order.
    stats.written = await upsertRows(pool, collapseRows(all));

    // ⚠️ Rows are never DELETED for absence. A board read that failed halfway,
    // or a board temporarily returning nothing, would otherwise wipe real
    // names — and a stale name is a far smaller harm than a blank one. A
    // patient who leaves keeps their entry, which only ever helps a rep
    // recognise an old number.
    await pool.query(
      `UPDATE patient_directory_runs
          SET finished_at = now(), ok = true, boards = $2, pages = $3, seen = $4, written = $5, truncated = $6
        WHERE id = $1`,
      [runId, stats.boards, stats.pages, stats.seen, stats.written, stats.truncated],
    );
    return { ok: true, ...stats };
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (runId) {
      await pool
        .query(
          `UPDATE patient_directory_runs
              SET finished_at = now(), ok = false, boards = $2, pages = $3, seen = $4, written = $5, error = $6
            WHERE id = $1`,
          [runId, stats.boards, stats.pages, stats.seen, stats.written, msg.slice(0, 500)],
        )
        .catch(() => {});
    }
    return { ok: false, error: msg, ...stats };
  } finally {
    running = false;
  }
}

export function registerPatientDirectory({ app, pool, requireCaller }) {
  // Master kill switch. The directory is additive and every caller falls back
  // to the live Monday lookup, so it must be stoppable from Railway in seconds
  // without reverting the service that also carries patient texting.
  if (process.env.PATIENT_DIRECTORY_ENABLED === "0") {
    console.warn("WARN: patient directory disabled by PATIENT_DIRECTORY_ENABLED=0");
    return;
  }
  if (!pool) {
    console.warn("WARN: patient directory disabled (messaging Postgres not configured)");
    return;
  }

  /**
   * Names for a batch of numbers.
   *
   * ⚠️ **AUTHENTICATED.** Unlike the health route below, this one returns
   * patient names — the health route returns counts. It is also the reason the
   * request takes NUMBERS and returns names keyed by the number the caller
   * asked about: the caller already knows those numbers (they came off its own
   * RingCentral list), so nothing is disclosed that the caller did not bring.
   */
  app.post("/directory/lookup", async (req, res) => {
    if (requireCaller) {
      const who = await requireCaller(req, res);
      // ⚠️ Same shape as /messaging/send: requireCaller answers 401 ITSELF only
      // when auth is enforced. In a build with no Google client id it returns
      // null having sent nothing, so returning here would hang the request.
      if (who === null && authEnforced()) return;
    }
    if (!hashingConfigured()) {
      return res.status(503).json({ error: "Directory not configured (PHONE_HMAC_PEPPER unset)" });
    }
    const numbers = boundLookup(req.body?.numbers);
    if (!numbers.length) return res.json({ names: {} });

    // Hash on the way in, so the number never reaches the database in the
    // clear and never appears in a query plan or a slow-query log.
    const byHash = new Map(numbers.map((n) => [phoneHmac(n), n]));
    try {
      const q = await pool.query(
        `SELECT phone_hmac, name, monday_item_id, board_id, board_name
           FROM patient_directory WHERE phone_hmac = ANY($1)`,
        [[...byHash.keys()]],
      );
      const names = {};
      for (const row of q.rows) {
        const num = byHash.get(row.phone_hmac);
        if (!num) continue;
        names[num] = {
          name: row.name,
          itemId: row.monday_item_id,
          boardId: row.board_id === null ? null : Number(row.board_id),
          boardName: row.board_name,
        };
      }
      // ⚠️ `asked` is echoed back so the caller can tell "checked, not in the
      // directory" from "the request never covered this number" — the caller
      // caches misses, and a silently narrowed answer would be cached as one.
      res.json({ names, asked: numbers.length });
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  /**
   * ⚠️ Unauthenticated, matching /calls/health and /messaging/archive-health:
   * counts and timestamps only, never a name or a number. The whole point is
   * that a directory which stopped refreshing fails silently, so the check has
   * to be reachable by whatever is watching, including a cron with no token.
   */
  app.get("/directory/health", async (_req, res) => {
    try {
      const q = await pool.query(
        `SELECT
           (SELECT max(finished_at) FROM patient_directory_runs WHERE ok)                              AS last_ok,
           (SELECT max(started_at)  FROM patient_directory_runs)                                       AS last_run,
           (SELECT error FROM patient_directory_runs WHERE error IS NOT NULL ORDER BY id DESC LIMIT 1) AS last_error,
           (SELECT truncated FROM patient_directory_runs WHERE ok ORDER BY finished_at DESC LIMIT 1)   AS last_truncated,
           (SELECT count(*) FROM patient_directory)                                                    AS row_count`,
      );
      const r = q.rows[0] || {};
      res.json(
        directoryHealth({
          lastOkAt: r.last_ok,
          lastRunAt: r.last_run,
          lastError: r.last_error,
          lastTruncated: r.last_truncated,
          rows: r.row_count,
        }),
      );
    } catch (e) {
      res.status(500).json({ ok: false, error: String((e && e.message) || e) });
    }
  });

  /** Force a refresh without waiting for the timer. Authenticated AND
   *  rate-floored, for the reason the archive's equivalent documents: `running`
   *  blocks concurrent runs only, and a full board scan on demand is real spend
   *  against a budget shared with every page a rep has open. */
  app.post("/directory/refresh", async (req, res) => {
    if (requireCaller) {
      const who = await requireCaller(req, res);
      if (who === null && authEnforced()) return;
    }
    const since = Date.now() - lastForcedAt;
    if (since < FORCE_MIN_GAP_MS) {
      return res.status(429).json({
        error: "A forced refresh ran too recently",
        retryAfterSeconds: Math.ceil((FORCE_MIN_GAP_MS - since) / 1000),
      });
    }
    lastForcedAt = Date.now();
    const out = await reconcilePatientDirectory({ pool });
    res.status(out.ok ? 200 : 502).json(out);
  });

  void (async () => {
    try {
      await pool.query(SCHEMA);
      console.log("patient directory schema ready");
    } catch (e) {
      console.error("patient directory schema failed:", e.message);
      return;
    }

    // Daily thereafter. unref() so a pending timer can never hold the process
    // open through a redeploy.
    setInterval(() => void reconcilePatientDirectory({ pool }), EVERY_MS).unref?.();

    // Boot run, unless one landed recently. Delayed so a cold start is not
    // competing with the traffic that woke it.
    setTimeout(() => {
      void (async () => {
        try {
          const q = await pool.query(`SELECT max(finished_at) AS last_ok FROM patient_directory_runs WHERE ok`);
          const lastOk = q.rows[0]?.last_ok ? new Date(q.rows[0].last_ok).getTime() : 0;
          if (Date.now() - lastOk < MIN_GAP_MS) {
            console.log("patient_directory: boot run skipped, a recent reconcile already succeeded");
            return;
          }
          await reconcilePatientDirectory({ pool });
        } catch (e) {
          console.error("patient_directory boot run failed:", e.message);
        }
      })();
    }, 90_000).unref?.();
  })();
}
