/**
 * Phase 2 — server-side transactional send (the bad-internet fix).
 *
 * The browser fires ONE request to POST /send and can close immediately. The
 * gateway durably queues the job in Postgres and a worker performs the slow
 * snapshot → write data columns → read-back verify → write stage columns
 * sequence (the same logic the SPA's verifiedWrite.ts runs today, but now on a
 * reliable server connection). This shrinks the browser's required online
 * window from ~10-15s of round-trips to a single quick POST, and an
 * idempotency key makes client retries safe.
 *
 * PHI note: a queued job's payload contains column VALUES (patient data) while
 * it waits/processes. On success the payload is scrubbed (kept only as a
 * 'scrubbed' marker); only failed jobs retain it for retry/debugging.
 */

import { verifyGoogleToken } from "./auth.mjs";

const MONDAY_URL = "https://api.monday.com/v2";
const TOKEN = process.env.MONDAY_API_TOKEN;
const VER = process.env.MONDAY_API_VERSION || "2024-10";

const MAX_WRITE_RETRIES = 2;
const RETRY_DELAY_MS = 800;
const VERIFY_ATTEMPTS = 8;
const VERIFY_INTERVAL_MS = 1500;
const STABLE_THRESHOLD = 3;
const MAX_JOB_ATTEMPTS = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callMonday(query, variables) {
  const r = await fetch(MONDAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: TOKEN, "API-Version": VER },
    body: JSON.stringify({ query, variables }),
  });
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { throw new Error(`Monday non-JSON (${r.status}): ${t.slice(0, 200)}`); }
  if (j.errors) throw new Error("Monday errors: " + JSON.stringify(j.errors));
  return j.data;
}

async function withRetry(fn) {
  let lastErr;
  for (let a = 0; a <= MAX_WRITE_RETRIES; a++) {
    try { return await fn(); }
    catch (e) { lastErr = e; if (a < MAX_WRITE_RETRIES) await sleep(RETRY_DELAY_MS * (a + 1)); }
  }
  throw lastErr;
}

async function readColumnTexts(itemId, colIds) {
  const data = await callMonday(
    `query($ids:[ID!]){items(ids:$ids){column_values(ids:${JSON.stringify(colIds)}){id text}}}`,
    { ids: [String(itemId)] },
  );
  const cvs = data?.items?.[0]?.column_values || [];
  return new Map(cvs.map((c) => [c.id, c.text ?? ""]));
}

/** Live label set of one or more status columns, keyed by column id.
 *  Unreadable / unparseable columns are simply absent from the map. */
async function readColumnLabels(boardId, colIds) {
  const out = new Map();
  if (!colIds.length) return out;
  const data = await callMonday(
    `query($board:[ID!],$cols:[String!]){boards(ids:$board){columns(ids:$cols){id settings_str}}}`,
    { board: [String(boardId)], cols: colIds },
  );
  for (const c of data?.boards?.[0]?.columns || []) {
    try {
      const labels = JSON.parse(c.settings_str || "{}").labels;
      if (!labels) continue;
      // Status columns: { "0": "Yes", ... }. Anything else (e.g. a dropdown's
      // array shape) yields no usable strings and stays out of the map, so a
      // shape we don't understand can never produce a false accusation.
      const vals = Object.values(labels)
        .map((v) => (typeof v === "string" ? v : v?.label ?? ""))
        .filter(Boolean);
      if (vals.length) out.set(c.id, vals);
    } catch { /* unparseable → absent → stays quiet */ }
  }
  return out;
}

/** Which exact-match label writes are asking for a label the board lacks.
 *  `current` is the latest read-back, so a value that DID land is never
 *  reported even if the verify loop timed out on a different column. */
async function findMissingLabels(boardId, verify, current) {
  const wanted = (verify || []).filter(
    (v) => v && v.expectedText && (current.get(v.columnId) ?? "") !== v.expectedText,
  );
  if (!wanted.length) return [];
  const known = await readColumnLabels(boardId, [...new Set(wanted.map((v) => v.columnId))]);
  return wanted
    .filter((v) => known.has(v.columnId) && !known.get(v.columnId).includes(v.expectedText))
    .map((v) => ({ columnId: v.columnId, label: v.expectedText }));
}

function writeMultiple(itemId, boardId, valuesObj, createLabels = false) {
  // create_labels_if_missing lets specific flows (e.g. Evaluate's Diagnosis +
  // consolidated ask) create new status/dropdown labels server-side. OFF by
  // default so every other column stays strict — a typo'd label fails instead
  // of silently creating board junk.
  return callMonday(
    `mutation($item:ID!,$board:ID!,$vals:JSON!){change_multiple_column_values(item_id:$item,board_id:$board,column_values:$vals,create_labels_if_missing:${createLabels ? "true" : "false"}){id}}`,
    { item: String(itemId), board: String(boardId), vals: JSON.stringify(valuesObj) },
  );
}

/** snapshot → write data → verify read-back → write stage. Throws on verify timeout. */
async function executeSend(payload) {
  const { itemId, boardId, dataColumns = {}, stageColumns = {}, verify = [], createLabelsIfMissing = false } = payload;
  if (!itemId || !boardId) throw new Error("itemId and boardId are required");
  const dataIds = Object.keys(dataColumns);
  const stageIds = Object.keys(stageColumns);

  // Phase 0: snapshot
  let before = new Map();
  if (dataIds.length) { try { before = await readColumnTexts(itemId, dataIds); } catch { /* best-effort */ } }

  // Phase 1: write data columns (one mutation, retried)
  if (dataIds.length) await withRetry(() => writeMultiple(itemId, boardId, dataColumns, createLabelsIfMissing));

  // Phase 2: read-back verification
  if (dataIds.length) {
    const expected = new Map(verify.filter((v) => v && v.expectedText != null).map((v) => [v.columnId, v.expectedText]));
    const stable = new Map();
    let ok = false;
    for (let a = 1; a <= VERIFY_ATTEMPTS; a++) {
      const cur = await readColumnTexts(itemId, dataIds);
      const pending = [];
      for (const id of dataIds) {
        const c = cur.get(id) ?? "";
        if (expected.has(id)) { if (c === expected.get(id)) continue; pending.push(id); continue; }
        const b = before.get(id) ?? "";
        if (c !== b) continue; // changed → verified
        const s = (stable.get(id) || 0) + 1; stable.set(id, s);
        if (s >= STABLE_THRESHOLD) continue; // same-value write, assume landed
        pending.push(id);
      }
      if (!pending.length) { ok = true; break; }
      if (a < VERIFY_ATTEMPTS) await sleep(VERIFY_INTERVAL_MS);
    }
    if (!ok) {
      // Before blaming latency, check the one cause latency can never resolve:
      // a create_labels_if_missing write where Monday stamped the item with a
      // label index but never wrote the label into the column's settings. The
      // column then reads back "" forever, so exact-match verification fails
      // identically on every attempt and every retry (2026-08-11 incident — a
      // new ICD-10 code on Evaluate; the rep retried five times on a "Monday
      // may be slow" message that could never come true). Mirrors
      // findMissingBoardLabels in src/lib/shared/verifiedWrite.ts.
      const missing = createLabelsIfMissing
        ? await findMissingLabels(boardId, verify, await readColumnTexts(itemId, dataIds))
        : [];
      if (missing.length) {
        const m = missing[0];
        throw new Error(
          `Monday did not create the label "${m.label}" on column ${m.columnId} — the column has no such ` +
            `label, so the value can't be read back and the stage was NOT advanced. Retrying will not help. ` +
            `Add "${m.label}" to that column on the board, then pick it from the list and send again.`,
        );
      }
      throw new Error(`verify timeout after ~${Math.round((VERIFY_ATTEMPTS * VERIFY_INTERVAL_MS) / 1000)}s`);
    }
  }

  // Phase 3: stage advancer(s) last
  if (stageIds.length) await withRetry(() => writeMultiple(itemId, boardId, stageColumns, createLabelsIfMissing));

  return { verifiedColumns: dataIds, stageColumns: stageIds, at: new Date().toISOString() };
}

const SEND_SCHEMA = `
CREATE TABLE IF NOT EXISTS send_jobs (
  id              BIGSERIAL PRIMARY KEY,
  idempotency_key TEXT UNIQUE,
  status          TEXT NOT NULL DEFAULT 'queued',   -- queued|processing|done|failed
  item_id         TEXT,
  board_id        TEXT,
  actor           TEXT,
  client_ip       TEXT,
  payload         JSONB NOT NULL,
  attempts        INT NOT NULL DEFAULT 0,
  result          JSONB,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS send_jobs_status_idx ON send_jobs (status, id);
`;

export function registerSend({ app, pool, clientIp }) {
  if (!pool) {
    app.post("/send", (_req, res) => res.status(503).json({ error: "send queue needs DATABASE_URL" }));
    console.warn("WARN: /send disabled (no DATABASE_URL)");
    return;
  }

  pool.query(SEND_SCHEMA)
    .then(() => console.log("send_jobs schema ready"))
    .catch((e) => console.error("send_jobs schema failed:", e.message));

  // POST /send — enqueue (idempotent on idempotencyKey), return fast
  app.post("/send", async (req, res) => {
    const b = req.body || {};
    const { itemId, boardId, dataColumns, stageColumns, verify, idempotencyKey, createLabelsIfMissing } = b;
    if (!itemId || !boardId) return res.status(400).json({ error: "itemId and boardId required" });
    if (!dataColumns && !stageColumns) return res.status(400).json({ error: "dataColumns or stageColumns required" });

    // Auth is enforced once, at the website's Google sign-in gate — not on every
    // send. We still verify the token WHEN PRESENT so a fresh sign-in attributes
    // the write to a verified email; a stale or absent token no longer blocks the
    // write (it falls back to the X-MM-User email), matching the non-blocking
    // /gql path. See project_access_gate / monday-gateway-service memory.
    const gUser = await verifyGoogleToken(req.headers["x-mm-auth"]);
    const actor = gUser?.email || req.headers["x-mm-user"] || b.actor || null;
    const ip = clientIp ? clientIp(req) : null;
    const payload = { itemId, boardId, dataColumns: dataColumns || {}, stageColumns: stageColumns || {}, verify: verify || [], createLabelsIfMissing: !!createLabelsIfMissing };

    try {
      if (idempotencyKey) {
        const existing = await pool.query("SELECT id, status FROM send_jobs WHERE idempotency_key=$1", [idempotencyKey]);
        if (existing.rows.length) {
          const row = existing.rows[0];
          return res.status(200).json({ jobId: row.id, status: row.status, idempotent: true });
        }
      }
      const r = await pool.query(
        `INSERT INTO send_jobs (idempotency_key, item_id, board_id, actor, client_ip, payload)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, status`,
        [idempotencyKey || null, String(itemId), String(boardId), actor, ip, JSON.stringify(payload)],
      );
      res.status(202).json({ jobId: r.rows[0].id, status: r.rows[0].status, idempotent: false });
    } catch (e) {
      // Unique-violation race on idempotency_key → return the existing job
      if (idempotencyKey && /duplicate key/.test(e.message)) {
        const ex = await pool.query("SELECT id, status FROM send_jobs WHERE idempotency_key=$1", [idempotencyKey]);
        if (ex.rows.length) return res.status(200).json({ jobId: ex.rows[0].id, status: ex.rows[0].status, idempotent: true });
      }
      res.status(500).json({ error: e.message });
    }
  });

  // GET /send/:id — status
  app.get("/send/:id", async (req, res) => {
    try {
      const r = await pool.query(
        "SELECT id, status, item_id, board_id, actor, attempts, result, error, created_at, updated_at FROM send_jobs WHERE id=$1",
        [req.params.id],
      );
      if (!r.rows.length) return res.status(404).json({ error: "not found" });
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Mirror each completed/failed send into the audit log (gql_log) so the
  // /audit page shows every send with its REAL, read-back-verified status
  // (ok here means "re-read and confirmed in Monday", not just "200").
  async function logSendToAudit(job, ok, ms) {
    try {
      const cols = { ...(job.payload?.dataColumns || {}), ...(job.payload?.stageColumns || {}) };
      await pool.query(
        `INSERT INTO gql_log (actor, client_ip, operation, operation_name, board_id, item_id, columns, ok, monday_status, duration_ms)
         VALUES ($1,$2,'mutation','send',$3,$4,$5,$6,$7,$8)`,
        [
          job.actor, job.client_ip, job.board_id, job.item_id,
          Object.keys(cols).length ? JSON.stringify(cols) : null,
          ok, ok ? 200 : null, ms,
        ],
      );
    } catch (e) { console.error("send→audit log failed:", e.message); }
  }

  // Worker: claim one queued job at a time (SKIP LOCKED → safe across replicas)
  async function tick() {
    const claim = await pool.query(
      `UPDATE send_jobs SET status='processing', attempts=attempts+1, updated_at=now()
       WHERE id = (SELECT id FROM send_jobs WHERE status='queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
    );
    if (!claim.rows.length) return;
    const job = claim.rows[0];
    const t0 = Date.now();
    try {
      const result = await executeSend(job.payload);
      await logSendToAudit(job, true, Date.now() - t0); // verified-true row in the audit
      // scrub PHI from payload on success
      await pool.query(
        `UPDATE send_jobs SET status='done', result=$2, error=null, payload='{"scrubbed":true}'::jsonb, updated_at=now() WHERE id=$1`,
        [job.id, JSON.stringify(result)],
      );
      console.log(`send_job ${job.id} done (item ${job.item_id})`);
    } catch (e) {
      const failed = job.attempts >= MAX_JOB_ATTEMPTS;
      if (failed) await logSendToAudit(job, false, Date.now() - t0); // FAIL row once retries exhausted
      await pool.query(
        `UPDATE send_jobs SET status=$2, error=$3, updated_at=now() WHERE id=$1`,
        [job.id, failed ? "failed" : "queued", String(e.message).slice(0, 500)],
      );
      console.warn(`send_job ${job.id} ${failed ? "FAILED" : "requeued"}: ${e.message}`);
    }
  }

  // Requeue jobs stuck in 'processing' (e.g. a deploy mid-job)
  async function recover() {
    try {
      await pool.query(`UPDATE send_jobs SET status='queued' WHERE status='processing' AND updated_at < now() - interval '3 minutes'`);
    } catch (e) { console.error("recover failed:", e.message); }
  }

  setInterval(() => tick().catch((e) => console.error("tick error:", e.message)), 1000);
  setInterval(recover, 60000);
  recover();
  console.log("send worker started (poll 1s)");
}
