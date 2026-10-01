/**
 * callTranscribe.mjs — transcripts of archived call recordings (§5.47e).
 *
 * After the call archive stores a recording, this copies the audio from OUR
 * bucket to a Google Cloud Storage drop-box, asks Speech-to-Text (chirp_3, `us`,
 * two-speaker diarization) for a transcript, stores the speaker turns on the
 * call_archive row and deletes the drop-box copy. The rules and the measured
 * constraints are in callTranscribeRules.mjs.
 *
 * ⚠️ PHI: the audio and the transcript are a patient's words. The transcript
 * lives on the messaging database beside the recording (never the audit DB),
 * is read only through an authenticated route, and nothing here logs a word of
 * it. Google's errors are logged as their message only.
 *
 * ⚠️ OFF unless GOOGLE_STT_ENABLED=1 (and the three GOOGLE_STT_* settings) —
 * the switch exists so audio could never flow before the BAA.
 */
import { createSign } from "node:crypto";
import { Buffer } from "node:buffer";
import { getObjectStream, storeConfigured } from "./callArchiveStore.mjs";
import { authEnforced } from "./auth.mjs";
import {
  JOB_TIMEOUT_MS,
  LOOKBACK_HOURS,
  MAX_ATTEMPTS,
  MAX_RUNNING,
  MIN_DURATION_SEC,
  LOCATION,
  SPEECH_HOST,
  START_PER_TICK,
  TICK_MS,
  batchRequestBody,
  fileResult,
  gcsObjectName,
  transcribeEnabled,
  transcriptRecord,
  turnsFrom,
} from "./callTranscribeRules.mjs";

export const TRANSCRIBE_SCHEMA = `
ALTER TABLE call_archive ADD COLUMN IF NOT EXISTS transcript_state      TEXT;
ALTER TABLE call_archive ADD COLUMN IF NOT EXISTS transcript_op         TEXT;
ALTER TABLE call_archive ADD COLUMN IF NOT EXISTS transcript_json       JSONB;
ALTER TABLE call_archive ADD COLUMN IF NOT EXISTS transcript_attempts   INT NOT NULL DEFAULT 0;
ALTER TABLE call_archive ADD COLUMN IF NOT EXISTS transcript_error      TEXT;
ALTER TABLE call_archive ADD COLUMN IF NOT EXISTS transcript_started_at TIMESTAMPTZ;
ALTER TABLE call_archive ADD COLUMN IF NOT EXISTS transcript_done_at    TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS call_archive_transcript_state_idx ON call_archive (transcript_state);
`;

const stats = { lastTickAt: null, lastError: null, started: 0, done: 0, empty: 0, failed: 0 };

/* ── Google auth (service-account JWT → access token), cached ─────────────── */

let _token = { value: "", exp: 0 };
let _key = null;
function serviceKey() {
  if (!_key) _key = JSON.parse(process.env.GOOGLE_STT_CREDENTIALS || "{}");
  return _key;
}
async function googleToken() {
  if (_token.value && Date.now() < _token.exp - 60_000) return _token.value;
  const key = serviceKey();
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: key.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url");
  const res = await fetch(key.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${sig}`,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`google token ${res.status}: ${j.error || "no token"}`);
  _token = { value: j.access_token, exp: Date.now() + Number(j.expires_in || 3600) * 1000 };
  return _token.value;
}

async function google(url, init = {}) {
  const token = await googleToken();
  return fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
}

const bucket = () => process.env.GOOGLE_STT_BUCKET;
const project = () => process.env.GOOGLE_STT_PROJECT;

async function gcsPut(name, body, contentType) {
  const res = await google(
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket())}/o?uploadType=media&name=${encodeURIComponent(name)}`,
    { method: "POST", headers: { "content-type": contentType || "audio/mpeg" }, body },
  );
  if (!res.ok) throw new Error(`gcs upload ${res.status}`);
}

async function gcsDelete(name) {
  const res = await google(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket())}/o/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  ).catch(() => null);
  // 404 = already gone (the bucket's 1-day lifecycle rule is the backstop).
  return !!res && (res.ok || res.status === 404);
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

function errorText(e) {
  return String((e && e.message) || e).slice(0, 300);
}

/* ── the job ─────────────────────────────────────────────────────────────── */

async function startJob(pool, row) {
  const name = gcsObjectName(row.rc_call_id);
  const uri = `gs://${bucket()}/${name}`;
  try {
    const obj = await getObjectStream(row.object_key);
    const audio = await streamToBuffer(obj.body);
    await gcsPut(name, audio, obj.contentType || row.content_type || "audio/mpeg");
    const res = await google(
      `https://${SPEECH_HOST}/v2/projects/${encodeURIComponent(project())}/locations/${LOCATION}/recognizers/_:batchRecognize`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(batchRequestBody(uri)) },
    );
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.name) throw new Error(`batchRecognize ${res.status}: ${j.error?.message || "no operation"}`);
    await pool.query(
      `UPDATE call_archive SET transcript_state = 'running', transcript_op = $2, transcript_started_at = now(),
              transcript_attempts = transcript_attempts + 1, transcript_error = NULL
        WHERE rc_call_id = $1`,
      [row.rc_call_id, j.name],
    );
    stats.started++;
  } catch (e) {
    await gcsDelete(name);
    const attempts = Number(row.transcript_attempts || 0) + 1;
    await pool.query(
      `UPDATE call_archive SET transcript_attempts = $2, transcript_error = $3,
              transcript_state = CASE WHEN $2 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE NULL END
        WHERE rc_call_id = $1`,
      [row.rc_call_id, attempts, errorText(e)],
    );
    stats.lastError = errorText(e);
    if (attempts >= MAX_ATTEMPTS) stats.failed++;
  }
}

async function pollJob(pool, row) {
  const name = gcsObjectName(row.rc_call_id);
  const uri = `gs://${bucket()}/${name}`;
  try {
    const res = await google(`https://${SPEECH_HOST}/v2/${row.transcript_op}`);
    const op = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`operation ${res.status}: ${op.error?.message || ""}`);
    if (!op.done) {
      const started = row.transcript_started_at ? new Date(row.transcript_started_at).getTime() : 0;
      if (started && Date.now() - started > JOB_TIMEOUT_MS) {
        await gcsDelete(name);
        await finish(pool, row.rc_call_id, "failed", null, "timed out waiting for Google");
      }
      return;
    }
    await gcsDelete(name);
    if (op.error) return finish(pool, row.rc_call_id, "failed", null, op.error.message || `code ${op.error.code}`);
    const { error, results } = fileResult(op, uri);
    if (error) return finish(pool, row.rc_call_id, "failed", null, error);
    const turns = turnsFrom(results);
    if (!turns.length) return finish(pool, row.rc_call_id, "empty", null, null);
    return finish(pool, row.rc_call_id, "done", transcriptRecord(turns), null);
  } catch (e) {
    stats.lastError = errorText(e);
  }
}

async function finish(pool, callId, state, record, error) {
  await pool.query(
    `UPDATE call_archive SET transcript_state = $2, transcript_json = $3, transcript_error = $4,
            transcript_done_at = now(), transcript_op = NULL
      WHERE rc_call_id = $1`,
    [callId, state, record ? JSON.stringify(record) : null, error ? String(error).slice(0, 300) : null],
  );
  if (state === "done") stats.done++;
  else if (state === "empty") stats.empty++;
  else if (state === "failed") {
    stats.failed++;
    stats.lastError = error ? String(error).slice(0, 300) : stats.lastError;
  }
}

let ticking = false;
export async function transcribeTick(pool) {
  if (ticking || !transcribeEnabled() || !storeConfigured()) return;
  ticking = true;
  try {
    stats.lastTickAt = new Date().toISOString();
    const running = await pool.query(
      `SELECT rc_call_id, transcript_op, transcript_started_at FROM call_archive
        WHERE transcript_state = 'running' AND transcript_op IS NOT NULL ORDER BY transcript_started_at LIMIT 50`,
    );
    for (const row of running.rows) await pollJob(pool, row);

    const room = Math.min(START_PER_TICK, MAX_RUNNING - running.rows.length);
    if (room <= 0) return;
    const fresh = await pool.query(
      `SELECT rc_call_id, object_key, content_type, transcript_attempts FROM call_archive
        WHERE audio_state = 'stored' AND object_key IS NOT NULL
          AND transcript_state IS NULL
          AND call_type IS DISTINCT FROM 'Fax'
          AND duration_sec >= $1
          AND started_at >= now() - ($2 || ' hours')::interval
        ORDER BY started_at DESC LIMIT $3`,
      [MIN_DURATION_SEC, String(LOOKBACK_HOURS), room],
    );
    for (const row of fresh.rows) await startJob(pool, row);
  } catch (e) {
    stats.lastError = errorText(e);
    console.warn("call transcribe tick failed:", errorText(e));
  } finally {
    ticking = false;
  }
}

/* ── routes ──────────────────────────────────────────────────────────────── */

export function registerCallTranscribe({ app, pool, requireCaller }) {
  let ready = false;

  // ⚠️ UNAUTHENTICATED, like the other archive health routes: counts, states
  // and Google's error message only — never a transcript, a number or an id.
  app.get("/calls/transcribe-health", async (_req, res) => {
    const body = { enabled: transcribeEnabled(), ready, ...stats };
    try {
      if (pool && ready) {
        const q = await pool.query(
          `SELECT coalesce(transcript_state, 'none') AS state, count(*)::int AS n FROM call_archive
            WHERE started_at >= now() - interval '7 days' AND audio_state = 'stored'
              AND call_type IS DISTINCT FROM 'Fax'
            GROUP BY 1`,
        );
        body.last7Days = Object.fromEntries(q.rows.map((r) => [r.state, r.n]));
        // Did diarization work? Shape counts only — never text.
        const d = await pool.query(
          `SELECT count(*)::int AS done,
                  count(*) FILTER (WHERE jsonb_array_length(coalesce(transcript_json->'speakers','[]'::jsonb)) >= 2)::int AS two_speakers,
                  count(*) FILTER (WHERE jsonb_array_length(coalesce(transcript_json->'speakers','[]'::jsonb)) = 0)::int AS no_speakers,
                  round(avg(jsonb_array_length(coalesce(transcript_json->'turns','[]'::jsonb))))::int AS avg_turns
             FROM call_archive WHERE transcript_state = 'done' AND started_at >= now() - interval '7 days'`,
        );
        body.shape = d.rows[0] || null;
      }
    } catch (e) {
      body.error = errorText(e);
    }
    res.json(body);
  });

  // One call's transcript, for a signed-in rep opening it in the timeline.
  app.get("/calls/transcript", async (req, res) => {
    if (requireCaller) {
      const who = await requireCaller(req, res);
      // requireCaller answers 401 itself only when auth is enforced (see
      // callArchive's caller()).
      if (who === null && authEnforced()) return;
    }
    const callId = String(req.query?.callId || "").trim();
    if (!callId) return res.status(400).json({ error: "callId is required" });
    if (!pool || !ready) return res.status(503).json({ error: "transcripts are not available" });
    try {
      const q = await pool.query(
        `SELECT transcript_state, transcript_json FROM call_archive WHERE rc_call_id = $1`,
        [callId],
      );
      const row = q.rows[0];
      if (!row) return res.status(404).json({ error: "no archived call with that id" });
      res.set("Cache-Control", "no-store");
      return res.json({ state: row.transcript_state || "none", transcript: row.transcript_json || null });
    } catch (e) {
      return res.status(500).json({ error: errorText(e) });
    }
  });

  if (!pool) return;
  void (async () => {
    try {
      const t = await pool.query(`SELECT to_regclass('call_archive') IS NOT NULL AS ok`);
      if (!t.rows[0]?.ok) return; // the call archive creates the table; next boot
      await pool.query(TRANSCRIBE_SCHEMA);
      ready = true;
      if (!transcribeEnabled()) {
        console.log("call transcribe: ready, switched off (GOOGLE_STT_ENABLED is not 1)");
        return;
      }
      console.log("call transcribe: on");
      setInterval(() => void transcribeTick(pool), TICK_MS).unref?.();
      setTimeout(() => void transcribeTick(pool), 60_000).unref?.();
    } catch (e) {
      console.error("call transcribe schema failed:", errorText(e));
    }
  })();
}
