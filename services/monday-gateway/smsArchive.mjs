/**
 * smsArchive.mjs — a durable copy of every patient text, in Postgres.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 * RingCentral's message store is a rolling ~30-day window on this account
 * (measured 2026-09-01: oldest surviving record 2026-08-01, and every query
 * with an earlier dateTo returns 0 rows for EVERY number). Texts are patient
 * communications, so a month is not a retention policy anybody chose — it is
 * just what the phone vendor happens to keep. Ask "what did we text this
 * patient in June" and RingCentral answers 200 OK with an empty list, which is
 * indistinguishable from a patient nobody ever contacted.
 *
 * This module copies that window into `cmd ctr db` before it ages out, and
 * /messaging/conversation then serves the union, so a thread stops going blank
 * at thirty days.
 *
 * ── ⚠️ THIS TABLE HOLDS PHI, AND THAT IS A DEPARTURE ────────────────────────
 * The gateway's standing posture is metadata-only: LOG_PAYLOAD=false, gql_log
 * and request_log store no bodies, and request_log strips query strings
 * (CLAUDE.md §8). Message BODIES are patient communications and the numbers are
 * one of HIPAA's 18 identifiers, so this table is deliberately different, and
 * the decision was taken explicitly rather than arrived at.
 *
 * Two things keep the departure bounded:
 *   · It lives on the MESSAGING pool (ASSIGNMENTS_DATABASE_URL), never the
 *     audit pool. That is the same separation index.mjs already draws so the
 *     audit DB keeps its "no PHI" property — do not move this table.
 *   · The number is stored as HMAC + last4, never in the clear, exactly as
 *     sent_messages and call_events do it. A thread is read back by hashing the
 *     number the caller asks for, so lookup still works and the archive still
 *     holds nothing directly patient-identifying beyond the body itself.
 *
 * ── Why a full-window reconcile, not an incremental cursor ──────────────────
 * Each run re-reads the ENTIRE window and upserts. That makes any single
 * successful run repair every prior gap: a week of failures costs nothing so
 * long as one run lands before the oldest unsaved message ages out. An
 * incremental "everything since my last cursor" design turns one bad run into
 * a permanent hole — and this gateway redeploys on every push to main, so bad
 * runs are a certainty, not a hypothetical. Same reasoning as the inbound-call
 * subscription: reconcile, never blindly increment (§5.13).
 */
import { rcApiFetch, rcConfigured } from "./ringcentral.mjs";
import { authEnforced } from "./auth.mjs";
import { phoneHmac } from "./phoneHash.mjs";
import {
  MAX_PAGES,
  PAGE_SIZE,
  WINDOW_DAYS,
  archiveHealth,
  isArchivable,
  rowToMessage,
  toArchiveRow,
  windowStart,
} from "./smsArchiveRules.mjs";

/**
 * ⚠️ Its OWN statement, deliberately not appended to another module's SCHEMA
 * template. index.mjs records why: that block ends in a DROP+CREATE VIEW which
 * takes every CREATE TABLE with it when it fails.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS sms_archive (
  -- RingCentral's own message id. PRIMARY KEY is what makes the reconcile
  -- idempotent: re-reading the same window every day writes no duplicates.
  rc_message_id  TEXT PRIMARY KEY,
  phone_hmac     TEXT NOT NULL,        -- the PATIENT's number, hashed
  last4          TEXT,                 -- matching hint only; four digits collide
  direction      TEXT NOT NULL,
  body           TEXT,
  -- RingCentral's late delivery verdict. An accepted text is not a delivered
  -- text, and the thread is the only place that verdict ever surfaces.
  message_status TEXT,
  delivery_error TEXT,
  -- MMS media metadata. The URIs die with RingCentral's own retention; what
  -- survives is that a photo existed. Fetching the bytes is a separate job.
  attachments    JSONB,
  created_at     TIMESTAMPTZ NOT NULL, -- RingCentral creationTime
  archived_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sms_archive_phone_idx   ON sms_archive (phone_hmac, created_at);
CREATE INDEX IF NOT EXISTS sms_archive_created_idx ON sms_archive (created_at DESC);
CREATE INDEX IF NOT EXISTS sms_archive_last4_idx   ON sms_archive (last4);

-- One row per reconcile. This is what /messaging/archive-health reads: a job
-- that silently stopped running is the failure this whole module exists to
-- prevent, and an empty archive with no run history looks exactly like an
-- empty archive that is working fine.
CREATE TABLE IF NOT EXISTS sms_archive_runs (
  id          BIGSERIAL PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  ok          BOOLEAN,
  pages       INT,
  seen        INT,
  written     INT,
  skipped     INT,
  truncated   BOOLEAN DEFAULT false,
  window_days INT,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS sms_archive_runs_ok_idx ON sms_archive_runs (ok, finished_at DESC);
`;

/** Our own line(s), so the archive is keyed by the PATIENT and never by us. */
function ourNumbers() {
  const extra = String(process.env.SMS_ARCHIVE_OUR_NUMBERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [process.env.RC_SMS_FROM || "+13475037148", ...extra];
}

const EVERY_MS = Math.max(Number(process.env.SMS_ARCHIVE_EVERY_HOURS) || 24, 1) * 3600_000;
/** A boot run is skipped when a successful one landed this recently. The
 *  gateway redeploys on every push to main, so without this a busy afternoon
 *  of deploys would each trigger a full ~26-page scan. */
const MIN_GAP_MS = Math.max(Number(process.env.SMS_ARCHIVE_MIN_GAP_HOURS) || 6, 0) * 3600_000;
/** Rows per INSERT. 9 columns, so 100 rows is 900 bind parameters — well under
 *  Postgres' 65535 cap, and one round trip instead of a hundred. */
const CHUNK = 100;
/**
 * Floor between FORCED reconciles (POST /messaging/archive-run).
 *
 * ⚠️ `running` only blocks CONCURRENT runs — a client that posts again each
 * time the previous one finishes gets a fresh full-window scan every time, up
 * to 60 RingCentral calls a piece. That is precisely the shape of the
 * 2026-08-20 incident (§10): one runaway, AUTHENTICATED client draining the
 * shared RingCentral account and taking texting down for the whole company. So
 * the route needs both a verified caller AND this floor — auth alone would not
 * have stopped that incident. Short enough to iterate against by hand.
 */
const FORCE_MIN_GAP_MS = Math.max(Number(process.env.SMS_ARCHIVE_FORCE_MIN_GAP_MINUTES) || 5, 0) * 60_000;
let lastForcedAt = 0;

export function upsertSql(count) {
  const cols = 9;
  const tuples = [];
  for (let i = 0; i < count; i++) {
    const b = i * cols;
    tuples.push(
      `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8}::jsonb,$${b + 9}::timestamptz)`,
    );
  }
  // ⚠️ DO UPDATE, not DO NOTHING. The fields that can legitimately change after
  // we first saw a message are exactly the ones worth re-reading for: a text
  // archived while `Queued` gets its `SendingFailed` verdict seconds later, and
  // DO NOTHING would pin the optimistic status forever.
  // archived_at is deliberately NOT in the SET list, so it keeps meaning
  // "when we first captured this", which is the only question it can answer.
  return (
    `INSERT INTO sms_archive
       (rc_message_id, phone_hmac, last4, direction, body, message_status, delivery_error, attachments, created_at)
     VALUES ${tuples.join(",")}
     ON CONFLICT (rc_message_id) DO UPDATE SET
       body           = EXCLUDED.body,
       message_status = EXCLUDED.message_status,
       delivery_error = EXCLUDED.delivery_error,
       attachments    = EXCLUDED.attachments`
  );
}

async function upsertRows(pool, rows) {
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const args = [];
    for (const r of slice) {
      args.push(
        r.rcMessageId,
        r.phoneHmac,
        r.last4,
        r.direction,
        r.body,
        r.messageStatus,
        r.deliveryError,
        r.attachments ? JSON.stringify(r.attachments) : null,
        r.createdAt,
      );
    }
    const res = await pool.query(upsertSql(slice.length), args);
    written += res.rowCount || 0;
  }
  return written;
}

/** One reconcile may run at a time. A boot run and a timer tick can land
 *  together; two full scans at once would double the RingCentral spend to write
 *  the same rows. Same coalescing lesson as the call-subscription reconcile. */
let running = false;

export async function reconcileSmsArchive({ pool, now = Date.now() } = {}) {
  if (!pool) return { ok: false, error: "archive pool not configured" };
  if (!rcConfigured()) return { ok: false, error: "RingCentral not configured" };
  if (running) return { ok: false, skipped: true, error: "a reconcile is already running" };
  running = true;

  const stats = { pages: 0, seen: 0, written: 0, skipped: 0, truncated: false };
  let runId = null;
  try {
    runId = (
      await pool.query(`INSERT INTO sms_archive_runs (window_days) VALUES ($1) RETURNING id`, [WINDOW_DAYS])
    ).rows[0]?.id;

    const dateFrom = windowStart(now);
    const ours = ourNumbers();
    for (let page = 1; page <= MAX_PAGES; page++) {
      // ⚠️ NO messageType parameter. The documented multi-value syntax comes
      // back 400 on this account, which broke the WHOLE thread load when it was
      // tried — so the query filters by date only and the type check happens in
      // isArchivable, where it cannot 400. Same account quirk as the SMS-500
      // and the call-log's digits-only phone filter.
      const path =
        `/restapi/v1.0/account/~/extension/~/message-store` +
        `?dateFrom=${encodeURIComponent(dateFrom)}&perPage=${PAGE_SIZE}&page=${page}`;
      // `background` on purpose: this is bulk work with no human waiting, so it
      // is the first thing shed when RingCentral is under pressure. A shed run
      // costs nothing — the next one re-reads the same window.
      const up = await rcApiFetch(path, {}, { tier: "background", caller: "sms-archive" });
      if (!up.ok) throw new Error(`RingCentral message-store failed (${up.status})`);
      const j = await up.json();
      const records = j.records ?? [];
      stats.pages = page;
      stats.seen += records.length;

      const rows = [];
      for (const r of records) {
        const row = toArchiveRow(r, ours);
        // Only count a SKIP for something that was a text — faxes and
        // voicemails share this store and are not misses.
        if (!row) {
          if (isArchivable(r)) stats.skipped++;
          continue;
        }
        const h = phoneHmac(row.phone);
        if (!h) {
          stats.skipped++;
          continue;
        }
        rows.push({ ...row, phoneHmac: h });
      }
      stats.written += await upsertRows(pool, rows);

      if (records.length < PAGE_SIZE) break;
      // Hitting the ceiling means the window held more than we read, i.e. the
      // archive is TRUNCATED. Reported rather than swallowed: it is the one
      // outcome that looks like success and isn't.
      if (page === MAX_PAGES) stats.truncated = true;
    }

    await pool.query(
      `UPDATE sms_archive_runs
          SET finished_at = now(), ok = true, pages = $2, seen = $3, written = $4, skipped = $5, truncated = $6
        WHERE id = $1`,
      [runId, stats.pages, stats.seen, stats.written, stats.skipped, stats.truncated],
    );
    console.log(
      `sms_archive: reconciled ${stats.seen} store records over ${stats.pages} page(s) — ` +
        `${stats.written} rows written, ${stats.skipped} skipped${stats.truncated ? " (TRUNCATED)" : ""}`,
    );
    return { ok: true, ...stats };
  } catch (e) {
    const msg = String((e && e.message) || e);
    console.error("sms_archive reconcile failed:", msg);
    if (runId) {
      await pool
        .query(
          `UPDATE sms_archive_runs
              SET finished_at = now(), ok = false, pages = $2, seen = $3, written = $4, skipped = $5, error = $6
            WHERE id = $1`,
          [runId, stats.pages, stats.seen, stats.written, stats.skipped, msg.slice(0, 500)],
        )
        .catch(() => {});
    }
    return { ok: false, error: msg, ...stats };
  } finally {
    running = false;
  }
}

/**
 * Everything we saved for one number, oldest first, in the wire shape
 * /messaging/conversation already returns.
 *
 * ⚠️ Hashes the number with the SAME helper that stamped the column on the way
 * in. A read that normalised differently would match nothing and report an
 * empty history — the exact failure this module exists to make impossible.
 */
export async function readArchivedConversation({ pool, phone }) {
  if (!pool) return [];
  const h = phoneHmac(phone);
  if (!h) return [];
  const r = await pool.query(
    `SELECT rc_message_id, direction, body, message_status, delivery_error, attachments, created_at
       FROM sms_archive WHERE phone_hmac = $1 ORDER BY created_at`,
    [h],
  );
  return r.rows.map(rowToMessage);
}

/**
 * Schema, the health route, and the schedule.
 *
 * Called from messaging.mjs with ITS pool, not from index.mjs — see the PHI
 * note at the top of this file for why that matters.
 */
export function registerSmsArchive({ app, pool, requireCaller }) {
  // Master kill switch. The archive is additive and shed-first, but if it ever
  // needs to be stopped it must be stoppable from Railway in seconds, without a
  // revert and a redeploy of the service that also carries patient texting.
  if (process.env.SMS_ARCHIVE_ENABLED === "0") {
    console.warn("WARN: SMS archive disabled by SMS_ARCHIVE_ENABLED=0");
    return;
  }
  if (!pool) {
    console.warn("WARN: SMS archive disabled (messaging Postgres not configured)");
    return;
  }

  /**
   * ⚠️ Unauthenticated, matching /calls/health beside it: counts and
   * timestamps only, never a number, a body or an employee email. The whole
   * point is that an outage here is silent, so the check has to be reachable by
   * whatever is watching — including services-monitor cron with no token.
   */
  app.get("/messaging/archive-health", async (_req, res) => {
    try {
      const q = await pool.query(
        `SELECT
           (SELECT max(finished_at) FROM sms_archive_runs WHERE ok)                             AS last_ok,
           (SELECT max(started_at)  FROM sms_archive_runs)                                      AS last_run,
           (SELECT error FROM sms_archive_runs WHERE error IS NOT NULL ORDER BY id DESC LIMIT 1) AS last_error,
           -- Of the latest SUCCESSFUL run: did it hit the page ceiling? A pass
           -- that completed without reading the whole window must not report
           -- healthy just because it completed.
           (SELECT truncated FROM sms_archive_runs WHERE ok ORDER BY finished_at DESC LIMIT 1) AS last_truncated,
           (SELECT count(*)        FROM sms_archive)                                            AS row_count,
           (SELECT min(created_at) FROM sms_archive)                                            AS oldest,
           (SELECT max(created_at) FROM sms_archive)                                            AS newest`,
      );
      const r = q.rows[0] || {};
      res.json(
        archiveHealth({
          lastOkAt: r.last_ok,
          lastRunAt: r.last_run,
          lastError: r.last_error,
          lastTruncated: r.last_truncated,
          rows: r.row_count,
          oldest: r.oldest,
          newest: r.newest,
        }),
      );
    } catch (e) {
      res.status(500).json({ ok: false, error: String((e && e.message) || e) });
    }
  });

  /**
   * Force a reconcile without waiting for the timer — the affordance
   * /calls/resubscribe gives, so iterating costs neither a redeploy nor a day.
   *
   * ⚠️ AUTHENTICATED AND RATE-FLOORED, unlike the health route beside it. That
   * one only reads counters; this one starts up to 60 RingCentral calls and a
   * full-window write. An unauthenticated version of this was the finding that
   * held this change in review (2026-09-01), and correctly: the gateway's
   * RingCentral account is shared with live patient texting, and an endpoint
   * that spends it on demand is the 2026-08-20 incident with a URL.
   */
  app.post("/messaging/archive-run", async (req, res) => {
    if (requireCaller) {
      const who = await requireCaller(req, res);
      // ⚠️ Same shape as /messaging/send, and not interchangeable with a bare
      // null check: requireCaller answers 401 ITSELF only when auth is
      // enforced. In a build with no Google client id it returns null having
      // sent nothing, so returning here would hang the request forever.
      if (who === null && authEnforced()) return;
    }
    const since = Date.now() - lastForcedAt;
    if (since < FORCE_MIN_GAP_MS) {
      return res.status(429).json({
        error: "A forced reconcile ran too recently",
        retryAfterSeconds: Math.ceil((FORCE_MIN_GAP_MS - since) / 1000),
      });
    }
    // Stamped BEFORE the run, so a burst is capped by the floor rather than by
    // how long each scan happens to take.
    lastForcedAt = Date.now();
    const out = await reconcileSmsArchive({ pool });
    res.status(out.ok ? 200 : 502).json(out);
  });

  void (async () => {
    try {
      await pool.query(SCHEMA);
      console.log("SMS archive schema ready");
    } catch (e) {
      console.error("SMS archive schema failed:", e.message);
      return;
    }

    // Daily thereafter. unref() so a pending timer can never hold the process
    // open through a redeploy.
    setInterval(() => void reconcileSmsArchive({ pool }), EVERY_MS).unref?.();

    // Boot run, unless one landed recently. Delayed a minute so a cold start
    // is not competing with the traffic that woke it.
    setTimeout(() => {
      void (async () => {
        try {
          const q = await pool.query(`SELECT max(finished_at) AS last_ok FROM sms_archive_runs WHERE ok`);
          const lastOk = q.rows[0]?.last_ok ? new Date(q.rows[0].last_ok).getTime() : 0;
          if (Date.now() - lastOk < MIN_GAP_MS) {
            console.log("sms_archive: boot run skipped, a recent reconcile already succeeded");
            return;
          }
          await reconcileSmsArchive({ pool });
        } catch (e) {
          console.error("sms_archive boot run failed:", e.message);
        }
      })();
    }, 60_000).unref?.();
  })();
}
