/**
 * callArchive.mjs — a durable copy of every recorded call, and of the call log.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 * RingCentral deletes call recordings on a fixed retention clock and KEEPS THE
 * CALL-LOG ROW. So an aged-out call renders with its date, its duration and no
 * audio — which is indistinguishable, on screen, from a call that was never
 * recorded — and nothing in the app can fetch it back. Measured live on
 * 2026-09-16 it was a cliff, not a slope: 88–90 days old, 9/9 connected calls
 * still had audio; 90–92 days old, 0/126 did. At ~69 recorded calls a business
 * day that is ~1,400 calls a month rolling off the back edge, permanently.
 *
 * This is §5.27's shape one system over. Texts had a ~30-day window and got
 * smsArchive.mjs; calls have a retention cliff and, until now, had nothing but
 * somebody remembering to press Download inside the window.
 *
 * ── ⚠️⚠️ THIS IS THE MOST SENSITIVE THING THE GATEWAY STORES ────────────────
 * The standing posture is metadata-only (LOG_PAYLOAD=false; gql_log and
 * request_log keep no bodies and request_log strips query strings). Two
 * departures were taken explicitly before this one — sms_archive's message
 * bodies and patient_directory's names — each bounded the same two ways. A call
 * recording goes further than either: it is a patient's actual voice discussing
 * their actual medical condition, and unlike a text it cannot be redacted or
 * truncated.
 *
 * The same two bounds apply and are not optional:
 *   · It lives on the MESSAGING pool (ASSIGNMENTS_DATABASE_URL), never the
 *     audit pool, so the audit database keeps its no-PHI property.
 *     DO NOT MOVE THIS TABLE.
 *   · The counterparty is stored as HMAC + last4, never in the clear — the same
 *     call sent_messages, call_events, sms_archive and patient_directory all
 *     make. The object key carries call ids, never a number and never a name.
 * A third, specific to this module: every issuance of a presigned URL is
 * written to `call_archive_access`, because that URL is a bearer credential for
 * PHI and an untracked one is indistinguishable from a leak.
 *
 * ── Why metadata first, audio second ────────────────────────────────────────
 * Each run does two things in order: it UPSERTS a row for every call in the
 * window (cheap, complete, one call-log page at a time), then it drains a
 * bounded slice of the audio queue (expensive, paced, oldest-first). That
 * ordering is the durability property: the index is always complete even when
 * the audio is behind, a crash mid-run loses nothing, and the queue is
 * self-prioritising — the oldest unarchived recording is the one closest to
 * being deleted, so the job always works on what it is about to lose.
 *
 * It is also why there is no separate backfill script. The queue does not care
 * whether a recording is from this morning or ninety days ago; ordinary hourly
 * runs drain a backlog of thousands in a couple of days, and a redeploy costs
 * at most one run's progress.
 *
 * ── Reconcile, never increment ──────────────────────────────────────────────
 * Same rule smsArchive.mjs and the call-subscription reconcile both state: a
 * periodic DEEP pass re-reads the whole retention window, so any single
 * successful run repairs every prior gap. An incremental "everything since my
 * cursor" design turns one bad run into a permanent hole — and this gateway
 * redeploys on every push to main, so bad runs are a certainty.
 */
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { rcConfigured, rcMediaFetch, rcApiFetch } from "./ringcentral.mjs";
import { shedWaitMs } from "./rcLimiter.mjs";
import { authEnforced } from "./auth.mjs";
import { phoneHmac } from "./phoneHash.mjs";
import { directoryHealth, getExtensionDirectory } from "./rcDirectory.mjs";
import {
  getObjectStream,
  objectExists,
  presignGet,
  putObject,
  storeConfigured,
  storeName,
} from "./callArchiveStore.mjs";
import {
  MAX_ATTEMPTS,
  MAX_PAGES,
  MIN_GAP_MS,
  PAGE_SIZE,
  RECORDING_GAP_MS,
  SCAN_GAP_MS,
  SCAN_DAYS,
  URL_TTL_SECONDS,
  WINDOW_DAYS,
  EVERY_MS,
  archiveHealth,
  drainBudget,
  extensionFor,
  isOfficeHours,
  fallbackFilename,
  nextAudioState,
  objectKey,
  shouldDeepScan,
  toCallRow,
  windowStart,
} from "./callArchiveRules.mjs";

/**
 * ⚠️ Its OWN statement, deliberately not appended to another module's SCHEMA
 * template — index.mjs records why: that block ends in a DROP+CREATE VIEW which
 * takes every CREATE TABLE with it when it fails.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS call_archive (
  -- ⚠️⚠️ KEYED ON THE CALL, NOT THE RECORDING, and this is the one schema
  -- decision that is fatal to get wrong. After the purge the call-log row
  -- SURVIVES carrying its id, while the recording object disappears from it
  -- entirely — so an archive keyed only on the recording id is unjoinable to
  -- the surviving row at exactly the moment it becomes useful.
  rc_call_id      TEXT PRIMARY KEY,
  -- RingCentral's telephony session. Survives too, and is what call_events
  -- keys on, so an archived call joins to its ring/claim history.
  rc_session_id   TEXT,
  rc_recording_id TEXT,
  direction       TEXT NOT NULL,
  result          TEXT,
  leg_results     JSONB,
  -- The OTHER party, hashed. Never the number.
  phone_hmac      TEXT,
  last4           TEXT,
  duration_sec    INT,
  started_at      TIMESTAMPTZ NOT NULL,

  -- none | pending | stored | gone | failed. See callArchiveRules.
  audio_state     TEXT NOT NULL DEFAULT 'none',
  object_key      TEXT,
  content_type    TEXT,
  bytes           BIGINT,
  -- RingCentral's media URL, kept while it still resolves. Refreshed by every
  -- scan, because it is the input to the download and it can change.
  content_uri     TEXT,
  attempts        INT NOT NULL DEFAULT 0,
  last_error      TEXT,
  last_attempt_at TIMESTAMPTZ,
  stored_at       TIMESTAMPTZ,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The queue: pending work, oldest first. Oldest is closest to deletion.
CREATE INDEX IF NOT EXISTS call_archive_queue_idx   ON call_archive (audio_state, started_at);
CREATE INDEX IF NOT EXISTS call_archive_phone_idx   ON call_archive (phone_hmac, started_at DESC);
CREATE INDEX IF NOT EXISTS call_archive_started_idx ON call_archive (started_at DESC);
CREATE INDEX IF NOT EXISTS call_archive_session_idx ON call_archive (rc_session_id);

-- One row per run. A job that silently stopped running is the failure this
-- whole module exists to prevent, and an empty archive with no run history
-- looks exactly like an empty archive that is working fine.
CREATE TABLE IF NOT EXISTS call_archive_runs (
  id           BIGSERIAL PRIMARY KEY,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  ok           BOOLEAN,
  deep         BOOLEAN NOT NULL DEFAULT false,
  pages        INT,
  seen         INT,
  rows_written INT,
  audio_tried  INT,
  audio_stored INT,
  audio_failed INT,
  audio_gone   INT,
  bytes        BIGINT,
  truncated    BOOLEAN DEFAULT false,
  -- Cut short by the RingCentral budget rather than finished. Separate from
  -- the truncated flag (the page ceiling) because the remedies differ: one
  -- wants a bigger MAX_PAGES, the other wants patience.
  -- NOTE: this whole SCHEMA is a JS template literal, so no backticks in it.
  shed         BOOLEAN DEFAULT false,
  window_days  INT,
  error        TEXT
);
ALTER TABLE call_archive_runs ADD COLUMN IF NOT EXISTS shed BOOLEAN DEFAULT false;
-- Voice or Fax. The call log carries both, and the Communications inbox reads
-- this table as a list of phone calls, so it has to be able to leave the
-- faxes out. Nullable and default-free, so adding it is metadata-only.
ALTER TABLE call_archive ADD COLUMN IF NOT EXISTS call_type TEXT;
-- Who picked up an INBOUND call: the extension NUMBER that answered and that
-- extension's person, as RingCentral named them when the call was archived
-- (callArchiveRules.answeredByOf, CLAUDE.md §5.47d). Staff, not patients.
-- Nullable and default-free, so adding them is metadata-only.
ALTER TABLE call_archive ADD COLUMN IF NOT EXISTS answered_ext TEXT;
ALTER TABLE call_archive ADD COLUMN IF NOT EXISTS answered_name TEXT;
CREATE INDEX IF NOT EXISTS call_archive_runs_ok_idx   ON call_archive_runs (ok, finished_at DESC);
CREATE INDEX IF NOT EXISTS call_archive_runs_deep_idx ON call_archive_runs (deep, ok, finished_at DESC);

-- ⚠️ Who fetched which recording, and how. A presigned URL is a bearer
-- credential for PHI; an untracked one is indistinguishable from a leak. This
-- is the mitigation that makes handing them out acceptable at all.
CREATE TABLE IF NOT EXISTS call_archive_access (
  id         BIGSERIAL PRIMARY KEY,
  rc_call_id TEXT NOT NULL,
  actor      TEXT,
  mode       TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS call_archive_access_at_idx   ON call_archive_access (at DESC);
CREATE INDEX IF NOT EXISTS call_archive_access_call_idx ON call_archive_access (rc_call_id, at DESC);
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Tries per call-log page when the budget refuses it, and how long to wait
 * between them. The guard's window is 60s, so ~30s apiece rides out an ordinary
 * shed.
 *
 * ⚠️ Retrying here is NOT hammering RingCentral. `rcGuard.note` opens on a 429,
 * so the retries that follow are absorbed by the GATEWAY's own breaker and
 * never reach the account — which is what makes patience the right answer
 * rather than a way to keep a throttle alive.
 */
const SHED_RETRIES = Math.max(Number(process.env.CALL_ARCHIVE_SHED_RETRIES) || 5, 1);
const SHED_PAUSE_MS = Math.max(Number(process.env.CALL_ARCHIVE_SHED_PAUSE_MS) || 30_000, 1_000);

/** Rows per INSERT. 17 columns, so 100 rows is 1,700 bind parameters — well
 *  under Postgres' 65535 cap, and one round trip instead of a hundred. */
const CHUNK = 100;

function upsertSql(count) {
  const cols = 17;
  const tuples = [];
  for (let i = 0; i < count; i++) {
    const b = i * cols;
    tuples.push(
      `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6}::jsonb,$${b + 7},$${b + 8},` +
        `$${b + 9},$${b + 10}::timestamptz,$${b + 11},$${b + 12},$${b + 13},$${b + 14},$${b + 15},` +
        `$${b + 16},$${b + 17})`,
    );
  }
  // ⚠️⚠️ THE SCAN MAY ONLY EVER MOVE `none` → `pending`. Every other transition
  // belongs to the downloader, which is the only thing that knows whether we
  // actually hold the bytes.
  //
  // Without that rule the everyday case corrupts itself two ways. A scan
  // re-reading a call we already stored would reset it to `pending` and
  // re-download it forever. And a recording that has since been PURGED comes
  // back from the call log with no `recording` object at all — i.e. as `none` —
  // so letting the scan write that would erase the fact that a recording ever
  // existed, silently, for exactly the calls this module is here to protect.
  //
  // `none` → `pending` must be allowed, because RingCentral takes a little
  // while to produce a recording: a call scanned seconds after it ends has no
  // recording yet, and the next pass is what picks it up.
  //
  // ⚠️⚠️ `direction` is taken from EVERY read, not just the first. A row first
  // written from a call still in progress kept that read's direction for good —
  // "We called" on a call the patient made, whose final record says Inbound
  // (callArchiveRules.isUnfinished). toCallRow now refuses unfinished records,
  // so every read that reaches here is a final one, and the deep pass repairs
  // the rows written wrong before the fix.
  return (
    `INSERT INTO call_archive
       (rc_call_id, rc_session_id, rc_recording_id, direction, result, leg_results,
        phone_hmac, last4, duration_sec, started_at, audio_state, content_uri, attempts, first_seen_at, call_type,
        answered_ext, answered_name)
     VALUES ${tuples.join(",")}
     ON CONFLICT (rc_call_id) DO UPDATE SET
       direction       = EXCLUDED.direction,
       rc_session_id   = COALESCE(EXCLUDED.rc_session_id,   call_archive.rc_session_id),
       call_type       = COALESCE(EXCLUDED.call_type,       call_archive.call_type),
       -- Who picked up (§5.47d): filled when a read can say, never blanked by
       -- one that cannot (a scan while the extension list was unreadable
       -- carries the number and no name).
       answered_ext    = COALESCE(EXCLUDED.answered_ext,    call_archive.answered_ext),
       answered_name   = COALESCE(EXCLUDED.answered_name,   call_archive.answered_name),
       rc_recording_id = COALESCE(EXCLUDED.rc_recording_id, call_archive.rc_recording_id),
       result          = COALESCE(EXCLUDED.result,          call_archive.result),
       leg_results     = COALESCE(EXCLUDED.leg_results,     call_archive.leg_results),
       phone_hmac      = COALESCE(EXCLUDED.phone_hmac,      call_archive.phone_hmac),
       last4           = COALESCE(NULLIF(EXCLUDED.last4,''),call_archive.last4),
       duration_sec    = GREATEST(COALESCE(EXCLUDED.duration_sec,0), COALESCE(call_archive.duration_sec,0)),
       content_uri     = COALESCE(EXCLUDED.content_uri,     call_archive.content_uri),
       audio_state     = CASE
                           WHEN call_archive.audio_state = 'none' AND EXCLUDED.audio_state = 'pending'
                             THEN 'pending'
                           ELSE call_archive.audio_state
                         END`
  );
}

async function upsertRows(pool, rows) {
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const args = [];
    for (const r of slice) {
      args.push(
        r.rcCallId,
        r.rcSessionId,
        r.rcRecordingId,
        r.direction,
        r.result,
        JSON.stringify(r.legResults || []),
        r.phoneHmac,
        r.last4,
        r.durationSec,
        r.startedAt,
        r.audioState,
        r.contentUri,
        0,
        new Date().toISOString(),
        r.callType ?? null,
        r.answeredExt ?? null,
        r.answeredName ?? null,
      );
    }
    const res = await pool.query(upsertSql(slice.length), args);
    written += res.rowCount || 0;
  }
  return written;
}

/**
 * Hand RingCentral call-log records to the archive.
 *
 * ⚠️ THE one path into call_archive's metadata — the hourly scan below and the
 * Communications inbox's minute-by-minute capture (commsInbox.mjs) both come
 * through here, so the upsert's rule that a scan may only ever move `none` →
 * `pending` holds whoever is scanning. Pass `view=Detailed` records: the legs
 * are what the missed-call verdict reads.
 *
 * @returns {Promise<{written: number, rows: object[]}>} `rows` carry the
 *   counterparty in the clear for the caller's in-memory use only.
 */
export async function archiveCallRecords({ pool, records, directory }) {
  // Names the extension that picked up an inbound call (§5.47d). Cached for
  // hours and never throws — an unreadable list still saves the number.
  const extensions = directory ?? (records?.length ? await getExtensionDirectory() : null);
  const rows = [];
  for (const rec of records ?? []) {
    const row = toCallRow(rec, extensions ?? undefined);
    if (!row) continue;
    // A blank or unhashable number is not a reason to drop the call — an
    // internal or blocked-caller row is still a call somebody may ask about.
    rows.push({ ...row, phoneHmac: row.phone ? phoneHmac(row.phone) || null : null });
  }
  const written = rows.length ? await upsertRows(pool, rows) : 0;
  return { written, rows };
}

/**
 * Page the call log over a window and upsert a row per call.
 *
 * ⚠️ `background` tier on purpose: this is bulk work with nobody waiting, so it
 * is the first thing shed when RingCentral is under pressure. A shed run costs
 * nothing — the next one re-reads the same window.
 */
async function scanCallLog({ pool, days, now, stats }) {
  const dateFrom = windowStart(now, days);
  for (let page = 1; page <= MAX_PAGES; page++) {
    let up = null;
    // ⚠️⚠️ A 429 HERE IS ROUTINE, NOT A FAULT, AND IT MUST NOT END THE RUN.
    // `background` is the tier rcLimiter sheds FIRST — that is the whole point
    // of putting this work on it — so a busy afternoon refuses a page as a
    // matter of design. The first live run learned this the hard way: it read
    // 11 pages, took a 429, threw, and therefore never reached the audio
    // queue at all. The scan is the cheap half; abandoning the EXPENSIVE half
    // because the cheap half was throttled is exactly backwards.
    //
    // So: wait out the window (RingCentral's own Retry-After where it gives
    // one) and try the same page again, a bounded number of times, then stop
    // paging and let the caller carry on to the drain. Bounded, because a hot
    // retry loop against a throttled account is how you keep a throttle alive.
    // ⚠️ `view=Detailed` is what carries `legs` and `telephonySessionId`. The
    // default (Simple) view has neither, so a claimed inbound call's audio —
    // which hangs off a leg — would be invisible, silently.
    //
    // ⚠️ `dateFrom` is explicit for the reason the fax count documents: this
    // API defaults to roughly the last 24 hours, so an omitted bound quietly
    // turns a 95-day repair pass into a one-day one.
    const path =
      `/restapi/v1.0/account/~/extension/~/call-log` +
      `?dateFrom=${encodeURIComponent(dateFrom)}&perPage=${PAGE_SIZE}&page=${page}` +
      `&view=Detailed`;
    for (let attempt = 1; attempt <= SHED_RETRIES; attempt++) {
      const res = await rcApiFetch(path, {}, { tier: "background", caller: "call-archive", ttlMs: 0 });
      if (res.status !== 429) {
        up = res;
        break;
      }
      stats.shedHits++;
      if (attempt === SHED_RETRIES) break;
      // Honour whoever refused us. rcLimiter's own refusal carries a
      // Retry-After, and so does a real RingCentral 429 — reading it is the
      // difference between waiting the right amount and guessing.
      // ⚠️ But not for long: a breaker refusal lasts as long as RingCentral
      // asks (up to an hour), and sleeping through it here holds `running`
      // and starves the next run. Past `shedWaitMs`'s ceiling the scan stops
      // and the next run re-reads the window.
      const wait = shedWaitMs(res.headers.get("retry-after"), SHED_PAUSE_MS);
      if (wait === null) break;
      await sleep(wait);
    }
    if (!up) {
      // Out of retries. NOT an error: the window is simply not fully read this
      // time, which `shed` records so a deep pass cannot be mistaken for a
      // complete one.
      stats.shed = true;
      return;
    }
    // ⚠️ Any OTHER non-ok status still throws. A 403 is the ReadCallLog
    // permission and a 5xx is RingCentral being down — both are faults worth
    // surfacing, and swallowing them would make a broken integration look like
    // a quiet day.
    if (!up.ok) throw new Error(`RingCentral call-log read failed (${up.status})`);
    const j = await up.json();
    const records = j.records ?? [];
    stats.pages = page;
    stats.seen += records.length;

    stats.rowsWritten += (await archiveCallRecords({ pool, records })).written;

    if (records.length < PAGE_SIZE) return;
    // Hitting the ceiling means the window held more than we read, i.e. the
    // repair pass is TRUNCATED. Reported rather than swallowed: it is the one
    // outcome that looks like success and isn't.
    if (page === MAX_PAGES) stats.truncated = true;
    // ⚠️ Pages are PACED, like the downloads. The drain was polite from the
    // start and this loop was not, so it fired its pages back to back — and
    // that burst is what actually drew real RingCentral 429s while the team
    // was working. A sustained rate is gentle; a spike is the thing a rate
    // limiter notices. Nothing waits on this scan, so the seconds are free.
    await sleep(SCAN_GAP_MS);
  }
}

/**
 * Download and store a bounded slice of the pending queue.
 *
 * ⚠️ OLDEST FIRST. The oldest unarchived recording is the one closest to being
 * deleted, so this ordering makes the job race the retention cliff rather than
 * the clock. Newest-first would archive what has ninety days left and lose what
 * had one.
 */
async function drainAudioQueue({ pool, stats, budget = drainBudget(), gapMs = RECORDING_GAP_MS }) {
  if (budget <= 0) return;
  stats.busy = isOfficeHours();
  stats.budget = budget;
  const q = await pool.query(
    `SELECT rc_call_id, rc_recording_id, content_uri, started_at, direction, last4, attempts
       FROM call_archive
      WHERE audio_state = 'pending' AND attempts < $1 AND content_uri IS NOT NULL
      ORDER BY started_at ASC
      LIMIT $2`,
    [MAX_ATTEMPTS, budget],
  );

  for (let i = 0; i < q.rows.length; i++) {
    const row = q.rows[i];
    stats.audioTried++;
    const attempts = Number(row.attempts) + 1;
    try {
      const up = await rcMediaFetch(row.content_uri, { tier: "background", caller: "call-archive" });
      // ⚠️⚠️ A 429 MUST NOT BURN AN ATTEMPT. Attempts exist to retire a
      // recording that is genuinely unfetchable; a throttle says nothing about
      // this recording at all. Counting it would let one busy afternoon park
      // MAX_ATTEMPTS-worth of perfectly good recordings as `failed`, which is
      // terminal for the automatic retry — losing audio to our own rate limit.
      // The row is left exactly as it was, and the drain stops: there is no
      // point walking the rest of the queue into the same wall.
      if (up.status === 429) {
        stats.shed = true;
        stats.shedHits++;
        stats.audioTried--;
        return;
      }
      if (!up.ok) {
        const state = nextAudioState({ status: up.status, attempts });
        if (state === "gone") stats.audioGone++;
        else if (state === "failed") stats.audioFailed++;
        await pool.query(
          `UPDATE call_archive
              SET audio_state = $2, attempts = $3, last_error = $4, last_attempt_at = now()
            WHERE rc_call_id = $1`,
          [row.rc_call_id, state, attempts, `HTTP ${up.status}`],
        );
        continue;
      }

      const contentType = up.headers.get("content-type") || "";
      const body = Buffer.from(await up.arrayBuffer());

      // ⚠️ A 200 is not audio. RingCentral (and the S3 in front of it) can hand
      // back an XML or HTML error body with a 200 status — the same trap
      // `fetchAssetBytes` documents for expired monday URLs, where an
      // AccessDenied body renders as a blank "file" instead of an error. An
      // archive that stores those has lost the recording AND reports success.
      if (!/^audio\//i.test(contentType) || body.length === 0) {
        const state = nextAudioState({ status: 0, attempts });
        if (state === "failed") stats.audioFailed++;
        await pool.query(
          `UPDATE call_archive
              SET audio_state = $2, attempts = $3, last_error = $4, last_attempt_at = now()
            WHERE rc_call_id = $1`,
          [row.rc_call_id, state, attempts, `not audio (${contentType || "no type"}, ${body.length}B)`],
        );
        continue;
      }

      const ext = extensionFor(contentType);
      const key = objectKey({
        startedAt: row.started_at,
        rcCallId: row.rc_call_id,
        rcRecordingId: row.rc_recording_id,
        ext,
      });
      await putObject({ key, body, contentType });

      // ⚠️ Marked `stored` only AFTER the object is written. If the process dies
      // between the PUT and this UPDATE the row stays `pending` and the next run
      // re-uploads to the SAME key (it is derived from the ids), which
      // overwrites rather than duplicating. The other order would mark a
      // recording safe that is not in the bucket.
      await pool.query(
        `UPDATE call_archive
            SET audio_state = 'stored', object_key = $2, content_type = $3, bytes = $4,
                attempts = $5, last_error = NULL, last_attempt_at = now(), stored_at = now()
          WHERE rc_call_id = $1`,
        [row.rc_call_id, key, contentType, body.length, attempts],
      );
      stats.audioStored++;
      stats.bytes += body.length;
    } catch (e) {
      const state = nextAudioState({ status: 0, attempts });
      if (state === "failed") stats.audioFailed++;
      await pool
        .query(
          `UPDATE call_archive
              SET audio_state = $2, attempts = $3, last_error = $4, last_attempt_at = now()
            WHERE rc_call_id = $1`,
          [row.rc_call_id, state, attempts, String((e && e.message) || e).slice(0, 500)],
        )
        .catch(() => {});
    }
    // Paced below RingCentral's Heavy group (10/60s) — see callArchiveRules.
    if (i < q.rows.length - 1) await sleep(gapMs);
  }
}

/** One reconcile at a time. A boot run and a timer tick can land together, and
 *  two scans at once would double the RingCentral spend to write the same rows
 *  — and race each other for the same queue slice. */
let running = false;

export async function reconcileCallArchive({ pool, now = Date.now(), force = false } = {}) {
  if (!pool) return { ok: false, error: "archive pool not configured" };
  if (!rcConfigured()) return { ok: false, error: "RingCentral not configured" };
  if (!storeConfigured()) return { ok: false, error: "object store not configured (CALL_ARCHIVE_* env vars)" };
  if (running) return { ok: false, skipped: true, error: "a reconcile is already running" };
  running = true;

  const stats = {
    pages: 0,
    seen: 0,
    rowsWritten: 0,
    audioTried: 0,
    audioStored: 0,
    audioFailed: 0,
    audioGone: 0,
    bytes: 0,
    truncated: false,
    shed: false,
    shedHits: 0,
    busy: false,
    budget: 0,
  };
  let runId = null;
  let deep = false;
  try {
    const last = await pool.query(
      // ⚠️ `AND NOT truncated AND NOT shed` — a deep pass that was clipped by the
      // page ceiling or cut short by a throttle did NOT read the repair window,
      // so treating it as one would park the archive for a whole deep interval
      // believing a gap had been repaired that never was.
      `SELECT max(finished_at) AS at FROM call_archive_runs
         WHERE ok AND deep AND NOT truncated AND NOT shed`,
    );
    deep = force || shouldDeepScan({ lastDeepAt: last.rows[0]?.at, now });
    const days = deep ? WINDOW_DAYS : SCAN_DAYS;

    runId = (
      await pool.query(
        `INSERT INTO call_archive_runs (deep, window_days) VALUES ($1,$2) RETURNING id`,
        [deep, days],
      )
    ).rows[0]?.id;

    // ⚠️ SEQUENCED, NOT CONDITIONAL. The drain runs whatever the scan managed —
    // the queue is durable in Postgres and does not care whether this run added
    // to it, so a throttled scan must never cost a run's worth of downloads.
    await scanCallLog({ pool, days, now, stats });
    await drainAudioQueue({ pool, stats });

    await pool.query(
      `UPDATE call_archive_runs
          SET finished_at = now(), ok = true, pages = $2, seen = $3, rows_written = $4,
              audio_tried = $5, audio_stored = $6, audio_failed = $7, audio_gone = $8,
              bytes = $9, truncated = $10, shed = $11
        WHERE id = $1`,
      [
        runId, stats.pages, stats.seen, stats.rowsWritten,
        stats.audioTried, stats.audioStored, stats.audioFailed, stats.audioGone,
        stats.bytes, stats.truncated, stats.shed,
      ],
    );
    console.log(
      `call_archive: ${deep ? "DEEP" : "recent"} pass over ${days}d — ${stats.seen} call(s) on ` +
        `${stats.pages} page(s), ${stats.rowsWritten} row(s) written; audio ${stats.audioStored} stored, ` +
        `${stats.audioGone} gone, ${stats.audioFailed} failed (budget ${stats.budget}` +
        `${stats.busy ? ", office hours" : ""})` +
        `${stats.truncated ? " (TRUNCATED)" : ""}${stats.shed ? ` (SHED after ${stats.shedHits} refusal(s))` : ""}`,
    );
    return { ok: true, deep, ...stats };
  } catch (e) {
    const msg = String((e && e.message) || e);
    console.error("call_archive reconcile failed:", msg);
    if (runId) {
      await pool
        .query(
          `UPDATE call_archive_runs
              SET finished_at = now(), ok = false, pages = $2, seen = $3, rows_written = $4,
                  audio_tried = $5, audio_stored = $6, audio_failed = $7, audio_gone = $8,
                  bytes = $9, truncated = $10, shed = $11, error = $12
            WHERE id = $1`,
          [
            runId, stats.pages, stats.seen, stats.rowsWritten,
            stats.audioTried, stats.audioStored, stats.audioFailed, stats.audioGone,
            stats.bytes, stats.truncated, stats.shed, msg.slice(0, 500),
          ],
        )
        .catch(() => {});
    }
    return { ok: false, deep, error: msg, ...stats };
  } finally {
    running = false;
  }
}

/**
 * Can we actually GET a recording back out?
 *
 * ⚠️⚠️ **SAVING AND SERVING ARE DIFFERENT CHAINS, AND ONLY ONE OF THEM PROVES
 * ITSELF.** A successful upload proves the credentials, the endpoint and the
 * HEADER-signed request work. A presigned URL is QUERY-string SigV4 — a
 * different code path, against a different service (Tigris, behind Railway's
 * bucket) — so an archive can be filling perfectly while every attempt to play
 * a recording 403s, and nothing anywhere would say so. That is the worst
 * version of this module's failure mode: we would believe we were safe, and
 * find out only when somebody needed a call.
 *
 * So the health route signs a URL for a real stored object and HEADs it, the
 * same way a browser would. Reports a BOOLEAN and nothing else — never the
 * URL, never the key, never a call id.
 *
 * ⚠️ Cached, because /calls/archive-health is unauthenticated and polled every
 * ten minutes by the monitor; without this it would be a free way to make the
 * gateway sign and fetch on demand.
 * ⚠️ Never throws. A self-check that can fail the check it lives in is worse
 * than no self-check.
 */
let _presign = { at: 0, ok: null };
const PRESIGN_CHECK_MS = 5 * 60_000;

function presignSelfCheck(pool) {
  if (!storeConfigured()) return null;
  // ⚠️⚠️ NEVER BLOCKS. This returns the LAST known verdict and refreshes in the
  // background when it is stale — because /calls/archive-health is what the
  // monitor polls, on a 15s timeout, and a health endpoint that waits on a
  // third-party network round trip can TIME OUT. That would push "could not
  // reach the archive health check" over a perfectly healthy archive: a false
  // alarm generated by the monitoring itself, which is the exact failure this
  // module keeps refusing to ship. At most one interval stale is the right
  // trade against that.
  if (Date.now() - _presign.at >= PRESIGN_CHECK_MS) {
    _presign = { at: Date.now(), ok: _presign.ok };
    void refreshPresignCheck(pool);
  }
  return _presign.ok;
}

async function refreshPresignCheck(pool) {
  try {
    const q = await pool.query(
      `SELECT object_key, content_type FROM call_archive
        WHERE audio_state = 'stored' AND object_key IS NOT NULL
        ORDER BY stored_at DESC LIMIT 1`,
    );
    const row = q.rows[0];
    // Nothing stored yet is not a failure — there is simply nothing to sign.
    if (!row) {
      _presign = { at: Date.now(), ok: null };
      return null;
    }
    const url = await presignGet({ key: row.object_key, expiresIn: 60, contentType: row.content_type });
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10_000);
    try {
      // ⚠️⚠️ A ranged GET of ONE BYTE, and it MUST NOT be a HEAD.
      //
      // SigV4 signs the HTTP METHOD into the canonical request, so a URL signed
      // from a GetObjectCommand is a GET-only URL: sending HEAD to it is
      // SignatureDoesNotMatch, i.e. a 403, every single time. The first version
      // of this check did exactly that and reported `presignOk: false` against
      // a serving path that was perfectly healthy — a false alarm on the one
      // signal that exists to be trusted, which is worse than no signal at all.
      // If this ever needs a HEAD, sign a HeadObjectCommand for it.
      //
      // Two lesser reasons it stays a GET: a HEAD returns no body, so an S3 403
      // arrives with nothing saying WHICH error it was; and a HEAD proves only
      // that metadata is reachable, where the question is whether BYTES come
      // back. `Range: bytes=0-0` makes that one byte rather than a whole
      // recording.
      const res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, signal: ctl.signal });
      _presign = { at: Date.now(), ok: res.ok };
      if (!res.ok) {
        // S3 error bodies are XML naming the exact code. No PHI in them — the
        // key is a call id, which this process already logs nowhere else, so
        // the body is trimmed hard and the URL is never logged.
        let detail = "";
        try {
          detail = (await res.text()).replace(/\s+/g, " ").slice(0, 300);
        } catch {
          /* no body */
        }
        console.error(`call_archive: presigned GET self-check failed (${res.status}) ${detail}`);
      }
      return res.ok;
    } finally {
      clearTimeout(t);
    }
  } catch (e) {
    console.error("call_archive: presigned GET self-check errored:", String((e && e.message) || e));
    _presign = { at: Date.now(), ok: false };
    return false;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Routes
 * ──────────────────────────────────────────────────────────────────────────── */

const SERVICE_TOKEN = process.env.CALL_ARCHIVE_SERVICE_TOKEN || "";
const FORCE_MIN_GAP_MS =
  Math.max(Number(process.env.CALL_ARCHIVE_FORCE_MIN_GAP_MINUTES) || 5, 0) * 60_000;
let lastForcedAt = 0;

/** The shape a row is handed out in. ⚠️ `last4` and never the number — the
 *  archive holds an HMAC, and a caller who knows the number can find the rows
 *  by sending it (we hash what they bring), which is the `/directory/lookup`
 *  posture: nothing is disclosed that the caller did not already hold. */
function publicRow(r) {
  return {
    callId: r.rc_call_id,
    sessionId: r.rc_session_id,
    direction: r.direction,
    result: r.result,
    legResults: r.leg_results || [],
    last4: r.last4,
    durationSec: Number(r.duration_sec ?? 0),
    startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
    hasAudio: r.audio_state === "stored",
    audioState: r.audio_state,
    bytes: r.bytes === null || r.bytes === undefined ? null : Number(r.bytes),
    contentType: r.content_type || null,
    storedAt: r.stored_at ? new Date(r.stored_at).toISOString() : null,
    // Who picked up an inbound call (§5.47d) — staff, not the patient.
    answeredExt: r.answered_ext ?? null,
    answeredName: r.answered_name ?? null,
  };
}

export function registerCallArchive({ app, pool, requireCaller }) {
  // Master kill switch. The archive is additive and shed-first, but if it ever
  // needs stopping it must be stoppable from Railway in seconds — without a
  // revert and a redeploy of the service that also carries patient texting.
  const killed = process.env.CALL_ARCHIVE_ENABLED === "0";
  const disabled = killed || !pool;
  if (killed) console.warn("WARN: call archive disabled by CALL_ARCHIVE_ENABLED=0");
  else if (!pool) console.warn("WARN: call archive disabled (messaging Postgres not configured)");

  if (disabled) {
    // ⚠️⚠️ THE HEALTH ROUTE SURVIVES THE KILL SWITCH, and that is the point of
    // putting it before the early return. Without it, flipping the switch
    // during an incident makes /calls/archive-health 404 — which the monitor
    // reports as "could not reach the health check", i.e. turning a deliberate
    // shutdown into a fresh alert stream at the exact moment somebody is
    // already dealing with something. It answers "off, on purpose" instead,
    // which `archiveFaults` can tell apart from a fault.
    app.get("/calls/archive-health", (_req, res) => {
      res.json({
        ok: true,
        enabled: false,
        reason: killed
          ? "the call archive is switched off (CALL_ARCHIVE_ENABLED=0)"
          : "the call archive is not configured (messaging Postgres missing)",
      });
    });
    return;
  }
  if (!storeConfigured()) {
    // ⚠️ A warning, not a throw. A gateway with no bucket configured must still
    // boot and carry patient texting; the archive simply does not run, and
    // /calls/archive-health says so rather than the process dying.
    console.warn("WARN: call archive disabled (object store not configured — set CALL_ARCHIVE_* env vars)");
  }

  /**
   * A verified employee, OR a service holding the shared token.
   *
   * ⚠️ Other Railway services have no Google identity, and Josh asked for them
   * to be able to read this (2026-09-21). The token is the same device
   * calendlyDay.mjs uses to call dtc-mm-form as a service — it never reaches a
   * browser, and it is checked with a length-safe comparison so the route
   * cannot be used as an oracle.
   */
  async function caller(req, res) {
    const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (SERVICE_TOKEN && bearer && bearer.length === SERVICE_TOKEN.length) {
      let diff = 0;
      for (let i = 0; i < SERVICE_TOKEN.length; i++) diff |= bearer.charCodeAt(i) ^ SERVICE_TOKEN.charCodeAt(i);
      if (diff === 0) return "service";
    }
    if (!requireCaller) return "anon";
    const who = await requireCaller(req, res);
    // ⚠️ Same shape as /messaging/send, and not interchangeable with a bare null
    // check: requireCaller answers 401 ITSELF only when auth is enforced. In a
    // build with no Google client id it returns null having sent nothing, so
    // returning here would hang the request forever.
    if (who === null && authEnforced()) return null;
    return who || "anon";
  }

  /**
   * ⚠️ UNAUTHENTICATED, matching /calls/health and /messaging/archive-health
   * beside it: counts and timestamps only, never a number, a call id, a name or
   * an employee email. The whole point is that an outage here is silent, so the
   * check has to be reachable by whatever is watching — including the
   * calls-monitor cron, which carries no token.
   */
  /**
   * ⚠️ UNAUTHENTICATED PROBE, counts and RingCentral's error codes only — never
   * a word of a transcript. Can this account read call transcripts through
   * RingSense (§5.13c, 2026-10-01)? Asks for the newest recorded call's
   * insights and reports the HTTP status, RingCentral's errorCode/message (its
   * own words about licensing, no PHI) and how many transcript utterances came
   * back. Cached 5 minutes so the open route can't become RingCentral traffic.
   */
  let ringsenseProbe = null;
  app.get("/calls/ringsense-probe", async (_req, res) => {
    if (ringsenseProbe && Date.now() - ringsenseProbe.at < 5 * 60_000) return res.json(ringsenseProbe.body);
    const body = { at: new Date().toISOString() };
    try {
      if (!pool) return res.json({ ...body, error: "no pool" });
      const q = await pool.query(
        `SELECT rc_session_id, rc_recording_id, started_at FROM call_archive
          WHERE rc_recording_id IS NOT NULL AND rc_session_id IS NOT NULL AND audio_state = 'stored'
          ORDER BY started_at DESC LIMIT 1`,
      );
      const row = q.rows[0];
      if (!row) return res.json({ ...body, error: "no recorded call in the archive" });
      body.callStartedAt = row.started_at;
      for (const [kind, path] of [
        ["record", `/ai/ringsense/v1/public/accounts/~/domains/pbx/records/${encodeURIComponent(row.rc_recording_id)}/insights?insightTypes=Transcript`],
        ["session", `/ai/ringsense/v1/public/accounts/~/domains/pbx/sessions/${encodeURIComponent(row.rc_session_id)}/insights?insightTypes=Transcript`],
      ]) {
        const r = await rcApiFetch(path, {}, { tier: "background", caller: "ringsense-probe", ttlMs: 0 });
        let j = null;
        try {
          j = await r.json();
        } catch {
          /* not JSON */
        }
        const list = Array.isArray(j?.insights?.Transcript)
          ? j.insights.Transcript
          : Array.isArray(j?.records)
            ? j.records.flatMap((x) => (Array.isArray(x?.insights?.Transcript) ? x.insights.Transcript : []))
            : [];
        body[kind] = {
          status: r.status,
          errorCode: j?.errorCode || j?.errors?.[0]?.errorCode || null,
          message: String(j?.message || j?.errors?.[0]?.message || "").slice(0, 300) || null,
          utterances: list.length,
        };
      }
    } catch (e) {
      body.error = String((e && e.message) || e).slice(0, 300);
    }
    ringsenseProbe = { at: Date.now(), body };
    res.json(body);
  });

  app.get("/calls/archive-health", async (_req, res) => {
    try {
      if (!pool) return res.json({ ok: false, reason: "messaging Postgres not configured" });
      const q = await pool.query(
        `SELECT
           (SELECT max(finished_at) FROM call_archive_runs WHERE ok)                              AS last_ok,
           (SELECT max(started_at)  FROM call_archive_runs)                                       AS last_run,
           (SELECT max(finished_at) FROM call_archive_runs
             WHERE ok AND deep AND NOT truncated AND NOT shed)                                   AS last_deep_ok,
           (SELECT error FROM call_archive_runs WHERE error IS NOT NULL ORDER BY id DESC LIMIT 1) AS last_error,
           (SELECT truncated FROM call_archive_runs WHERE ok AND deep ORDER BY finished_at DESC LIMIT 1) AS last_deep_trunc,
           (SELECT count(*) FROM call_archive)                                                    AS rows,
           (SELECT count(*) FROM call_archive WHERE audio_state = 'stored')                       AS stored,
           (SELECT count(*) FROM call_archive WHERE audio_state = 'pending')                      AS pending,
           (SELECT count(*) FROM call_archive WHERE audio_state = 'failed')                       AS failed,
           (SELECT count(*) FROM call_archive WHERE audio_state = 'gone')                         AS gone,
           (SELECT coalesce(sum(bytes),0) FROM call_archive WHERE audio_state = 'stored')         AS bytes,
           (SELECT min(started_at) FROM call_archive)                                             AS oldest,
           (SELECT max(started_at) FROM call_archive)                                             AS newest,
           (SELECT min(started_at) FROM call_archive WHERE audio_state = 'pending')               AS oldest_pending,
           (SELECT min(started_at) FROM call_archive_runs)                                        AS first_run`,
      );
      const r = q.rows[0] || {};
      const presignOk = presignSelfCheck(pool);
      res.json({
        ...archiveHealth({
          lastOkAt: r.last_ok,
          lastRunAt: r.last_run,
          lastDeepOkAt: r.last_deep_ok,
          lastError: r.last_error,
          lastDeepTruncated: r.last_deep_trunc,
          rows: r.rows,
          stored: r.stored,
          pending: r.pending,
          failed: r.failed,
          gone: r.gone,
          bytes: r.bytes,
          oldest: r.oldest,
          newest: r.newest,
          oldestPendingAt: r.oldest_pending,
          firstRunAt: r.first_run,
          presignOk,
        }),
        enabled: true,
        storeConfigured: storeConfigured(),
        bucket: storeConfigured() ? storeName() : null,
        // Who-picked-up names (§5.47d): how many extensions are known, and
        // when the list was read. Counts and timestamps only, never a name.
        extensionDirectory: directoryHealth(),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String((e && e.message) || e) });
    }
  });

  /**
   * Force a run — the affordance /calls/resubscribe gives, so iterating costs
   * neither a redeploy nor an hour.
   *
   * ⚠️ AUTHENTICATED **AND** RATE-FLOORED, both, unlike the health route beside
   * it. `running` only blocks CONCURRENT runs, so a client that posts again each
   * time the last one finishes gets a fresh deep scan plus a full audio slice
   * every time — up to 40 call-log pages and 120 recording downloads a go. That
   * is precisely the shape of the 2026-08-20 incident: one runaway,
   * AUTHENTICATED client draining the shared RingCentral account and taking
   * texting down for the whole company. Auth alone would not have stopped it.
   */
  app.post("/calls/archive-run", async (req, res) => {
    const who = await caller(req, res);
    if (who === null) return;
    const since = Date.now() - lastForcedAt;
    if (since < FORCE_MIN_GAP_MS) {
      return res.status(429).json({
        error: "A forced run happened too recently",
        retryAfterSeconds: Math.ceil((FORCE_MIN_GAP_MS - since) / 1000),
      });
    }
    // Stamped BEFORE the run, so a burst is capped by the floor rather than by
    // how long each pass happens to take.
    lastForcedAt = Date.now();
    const out = await reconcileCallArchive({ pool, force: req.query?.deep === "1" });
    res.status(out.ok ? 200 : 502).json(out);
  });

  /**
   * The audio, for the Command Center and for other services.
   *
   * Default is a **302 to a presigned URL**: the browser (or the service)
   * fetches straight from the bucket, where egress is free and the gateway
   * never touches the bytes. Josh, 2026-09-21: *"lets do the presigned thing"*.
   *
   * ⚠️⚠️ A PRESIGNED URL IS A BEARER CREDENTIAL FOR PHI — copyable out of a
   * network tab, and it works for anyone holding it until it expires. Three
   * things bound that, and none of them is optional: it is issued only behind
   * the caller check above; its life is minutes (URL_TTL_SECONDS, capped at an
   * hour in the rules module); and **every issuance is written to
   * call_archive_access**, because an untracked bearer credential for a
   * patient's recorded call is indistinguishable from a leak.
   *
   * ⚠️ `?mode=proxy` streams the bytes through the gateway instead. It exists
   * because a browser `fetch()` following a cross-origin redirect needs CORS on
   * the bucket, which Railway buckets do not expose a way to configure — so an
   * `<audio src>` or an `<a href>` can take the 302 and a `fetch()`-based
   * caller takes the proxy. Both are authenticated; only the cost differs.
   */
  app.get("/calls/recording", async (req, res) => {
    const who = await caller(req, res);
    if (who === null) return;
    if (!storeConfigured()) return res.status(503).json({ error: "object store not configured" });
    const callId = String(req.query?.callId || "").trim();
    if (!callId) return res.status(400).json({ error: "callId is required" });

    try {
      const q = await pool.query(
        `SELECT rc_call_id, object_key, content_type, audio_state, started_at, direction, last4
           FROM call_archive WHERE rc_call_id = $1`,
        [callId],
      );
      const row = q.rows[0];
      if (!row) return res.status(404).json({ error: "no archived call with that id", callId });
      if (row.audio_state !== "stored" || !row.object_key) {
        // ⚠️ The state is REPORTED rather than flattened to a 404. "We never
        // recorded it", "RingCentral purged it before we got there" and "it is
        // queued, come back shortly" are three different answers with three
        // different next moves, and a bare 404 makes them one.
        return res.status(404).json({ error: "no audio archived for that call", callId, audioState: row.audio_state });
      }

      const ext = extensionFor(row.content_type);
      const filename =
        String(req.query?.filename || "").replace(/[^\w.\- ]/g, "").slice(0, 120) ||
        fallbackFilename({ startedAt: row.started_at, direction: row.direction, last4: row.last4, ext });

      const mode = req.query?.mode === "proxy" ? "proxy" : "presigned";
      // Fire-and-forget: an audit row must never be able to fail the fetch, and
      // it must never be able to make this route slow.
      void pool
        .query(`INSERT INTO call_archive_access (rc_call_id, actor, mode) VALUES ($1,$2,$3)`, [callId, who, mode])
        .catch(() => {});

      if (mode === "proxy") {
        const out = await getObjectStream(row.object_key);
        res.status(200).set("Content-Type", row.content_type || "audio/mpeg");
        if (out.bytes) res.set("Content-Length", String(out.bytes));
        res.set("Content-Disposition", `inline; filename="${filename}"`);
        // ⚠️ Streamed, not buffered. A recording is only a few megabytes, but a
        // handful of simultaneous listeners buffering whole files is real
        // memory in a process that also carries patient texting.
        //
        // ⚠️ The SDK's `Body` is a Node Readable on this runtime, but it is a
        // WEB ReadableStream under some configurations — and a web stream has
        // no `.pipe`, so assuming one is a TypeError inside a route that has
        // already sent its headers, i.e. a dead connection rather than an
        // error anybody can read. Both shapes are handled because this path is
        // the fallback, and a fallback that throws is not one.
        if (typeof out.body?.pipe === "function") {
          out.body.pipe(res);
        } else {
          Readable.fromWeb(out.body).pipe(res);
        }
        return;
      }

      const url = await presignGet({
        key: row.object_key,
        expiresIn: URL_TTL_SECONDS,
        filename: req.query?.download === "1" ? filename : undefined,
        contentType: row.content_type,
      });
      if (req.query?.json === "1") {
        return res.json({ ok: true, url, expiresInSeconds: URL_TTL_SECONDS, filename });
      }
      // ⚠️ no-store. A 302 to a credential-bearing URL must not sit in a shared
      // cache or a browser's back-forward cache after it has expired.
      res.set("Cache-Control", "no-store");
      return res.redirect(302, url);
    } catch (e) {
      res.status(502).json({ error: String((e && e.message) || e) });
    }
  });

  /**
   * "Which of these calls do we have audio for?"
   *
   * The Command Center needs this to draw a Play button at all: an aged-out
   * call arrives from RingCentral's call log with NO recording object, so a
   * fallback on the download path alone fixes nothing a rep can see — the
   * button is simply never rendered. One batched question per list, in the
   * `useDirectoryNames` shape, rather than a lookup per row.
   */
  app.post("/calls/recordings/have", async (req, res) => {
    const who = await caller(req, res);
    if (who === null) return;
    const ids = Array.isArray(req.body?.callIds) ? req.body.callIds.map(String).slice(0, 500) : [];
    if (!ids.length) return res.json({ ok: true, results: {} });
    try {
      const q = await pool.query(
        `SELECT rc_call_id, audio_state, content_type, bytes, duration_sec
           FROM call_archive WHERE rc_call_id = ANY($1::text[])`,
        [ids],
      );
      const results = {};
      for (const r of q.rows) {
        results[r.rc_call_id] = {
          hasAudio: r.audio_state === "stored",
          audioState: r.audio_state,
          contentType: r.content_type || null,
          bytes: r.bytes === null ? null : Number(r.bytes),
          durationSec: Number(r.duration_sec ?? 0),
        };
      }
      res.json({ ok: true, results });
    } catch (e) {
      /* ⚠️ A failure is an ERROR, not an empty result. `{}` means "we hold audio
         for none of these", which a caller acts on by drawing no buttons — so a
         200 with `{}` on a dead database is indistinguishable from an archive
         that legitimately has nothing, which is §5.27's silence one table over. */
      res.status(502).json({ ok: false, error: String((e && e.message) || e) });
    }
  });

  /**
   * The metadata query — what other services read.
   *
   * Josh, 2026-09-21: *"having other services view the information like the
   * phone number that called and the time date etc is important"*.
   *
   * ⚠️ It answers with `last4`, never the number, because the archive stores an
   * HMAC. A caller who KNOWS a number can find its calls by sending it — we
   * hash what they bring — which is exactly `/directory/lookup`'s posture:
   * nothing is disclosed that the caller did not already hold. Storing numbers
   * in the clear to make this route prettier would undo the one property that
   * bounds every PHI table on this pool.
   */
  app.post("/calls/archive/query", async (req, res) => {
    const who = await caller(req, res);
    if (who === null) return;
    const body = req.body || {};
    const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 1000);
    const sinceDays = Math.min(Math.max(Number(body.sinceDays) || 30, 1), 3650);
    const callIds = Array.isArray(body.callIds) ? body.callIds.map(String).slice(0, 500) : [];
    const phones = Array.isArray(body.phones) ? body.phones.map(String).slice(0, 100) : [];

    try {
      const where = [`started_at >= now() - ($1 || ' days')::interval`];
      const args = [String(sinceDays)];
      if (callIds.length) {
        args.push(callIds);
        where.push(`rc_call_id = ANY($${args.length}::text[])`);
      }
      if (phones.length) {
        // Hashed with the SAME helper that stamped the column on the way in. A
        // read that normalised differently would match nothing and report an
        // empty history — the exact failure this module exists to prevent.
        const hashes = phones.map((p) => phoneHmac(p)).filter(Boolean);
        if (!hashes.length) return res.json({ ok: true, calls: [] });
        args.push(hashes);
        where.push(`phone_hmac = ANY($${args.length}::text[])`);
      }
      args.push(limit);
      const q = await pool.query(
        `SELECT rc_call_id, rc_session_id, direction, result, leg_results, last4, duration_sec,
                started_at, audio_state, bytes, content_type, stored_at, answered_ext, answered_name
           FROM call_archive
          WHERE ${where.join(" AND ")}
          ORDER BY started_at DESC
          LIMIT $${args.length}`,
        args,
      );
      // ⚠️ Echo the window actually used. A silently narrowed window reads as
      // "nothing happened" — the same reason /calls/history echoes its bounds.
      res.json({ ok: true, sinceDays, limit, calls: q.rows.map(publicRow) });
    } catch (e) {
      res.status(502).json({ ok: false, error: String((e && e.message) || e) });
    }
  });

  void (async () => {
    try {
      await pool.query(SCHEMA);
      console.log("Call archive schema ready");
    } catch (e) {
      console.error("Call archive schema failed:", e.message);
      return;
    }
    if (!storeConfigured()) return;

    // Hourly thereafter. unref() so a pending timer can never hold the process
    // open through a redeploy.
    setInterval(() => void reconcileCallArchive({ pool }), EVERY_MS).unref?.();

    // Boot run, unless one landed recently. Delayed so a cold start is not
    // competing with the traffic that woke it.
    setTimeout(() => {
      void (async () => {
        try {
          const q = await pool.query(`SELECT max(finished_at) AS last_ok FROM call_archive_runs WHERE ok`);
          const lastOk = q.rows[0]?.last_ok ? new Date(q.rows[0].last_ok).getTime() : 0;
          if (Date.now() - lastOk < MIN_GAP_MS) {
            console.log("call_archive: boot run skipped, a recent run already succeeded");
            return;
          }
          await reconcileCallArchive({ pool });
        } catch (e) {
          console.error("call_archive boot run failed:", e.message);
        }
      })();
    }, 90_000).unref?.();
  })();
}

/** Exported for the tests, which assert the object is written before the row is
 *  marked stored. */
export { drainAudioQueue, scanCallLog, upsertSql, objectExists };
