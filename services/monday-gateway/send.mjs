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

function writeMultiple(itemId, boardId, valuesObj) {
  return callMonday(
    `mutation($item:ID!,$board:ID!,$vals:JSON!){change_multiple_column_values(item_id:$item,board_id:$board,column_values:$vals){id}}`,
    { item: String(itemId), board: String(boardId), vals: JSON.stringify(valuesObj) },
  );
}

/** snapshot → write data → verify read-back → write stage. Throws on verify timeout. */
async function executeSend(payload) {
  const { itemId, boardId, dataColumns = {}, stageColumns = {}, verify = [] } = payload;
  if (!itemId || !boardId) throw new Error("itemId and boardId are required");
  const dataIds = Object.keys(dataColumns);
  const stageIds = Object.keys(stageColumns);

  // Phase 0: snapshot
  let before = new Map();
  if (dataIds.length) { try { before = await readColumnTexts(itemId, dataIds); } catch { /* best-effort */ } }

  // Phase 1: write data columns (one mutation, retried)
  if (dataIds.length) await withRetry(() => writeMultiple(itemId, boardId, dataColumns));

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
    if (!ok) throw new Error(`verify timeout after ~${Math.round((VERIFY_ATTEMPTS * VERIFY_INTERVAL_MS) / 1000)}s`);
  }

  // Phase 3: stage advancer(s) last
  if (stageIds.length) await withRetry(() => writeMultiple(itemId, boardId, stageColumns));

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
    const { itemId, boardId, dataColumns, stageColumns, verify, idempotencyKey } = b;
    if (!itemId || !boardId) return res.status(400).json({ error: "itemId and boardId required" });
    if (!dataColumns && !stageColumns) return res.status(400).json({ error: "dataColumns or stageColumns required" });

    const actor = req.headers["x-mm-user"] || b.actor || null;
    const ip = clientIp ? clientIp(req) : null;
    const payload = { itemId, boardId, dataColumns: dataColumns || {}, stageColumns: stageColumns || {}, verify: verify || [] };

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

  // Worker: claim one queued job at a time (SKIP LOCKED → safe across replicas)
  async function tick() {
    const claim = await pool.query(
      `UPDATE send_jobs SET status='processing', attempts=attempts+1, updated_at=now()
       WHERE id = (SELECT id FROM send_jobs WHERE status='queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
    );
    if (!claim.rows.length) return;
    const job = claim.rows[0];
    try {
      const result = await executeSend(job.payload);
      // scrub PHI from payload on success
      await pool.query(
        `UPDATE send_jobs SET status='done', result=$2, error=null, payload='{"scrubbed":true}'::jsonb, updated_at=now() WHERE id=$1`,
        [job.id, JSON.stringify(result)],
      );
      console.log(`send_job ${job.id} done (item ${job.item_id})`);
    } catch (e) {
      const failed = job.attempts >= MAX_JOB_ATTEMPTS;
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
