/**
 * voicemailArchive.mjs — a durable copy of every voicemail, and of its audio.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 * A voicemail is a patient talking to us, in their own words, and on this
 * account it lives for about thirty days.
 *
 * It is not in the call-recording system at all. Voicemail is a MESSAGE-STORE
 * record, and §5.27 measured what that store keeps: on 2026-09-01 the oldest
 * surviving record was 2026-08-01, and every query with an earlier `dateTo`
 * returned 0 rows for EVERY number. So the clock here is three times tighter
 * than the 90-day cliff that justified callArchive.mjs, and the failure is
 * quieter: a purged call recording at least leaves its call-log row behind, so
 * the call is still visible with no audio. A purged voicemail leaves NOTHING —
 * it simply stops being in the list, and "this patient never left a message"
 * and "this patient left a message we no longer have" become the same answer.
 *
 * §5.47 closed that gap for call recordings and named this one as the piece
 * still open: *"Not built (phase 5): voicemail audio, which is on the ~30-day
 * message-store clock — three times TIGHTER than recordings — and has no
 * archive at all."* This is that.
 *
 * ── ⚠️⚠️ PHI, ON THE SAME TERMS AS THE CALL ARCHIVE ─────────────────────────
 * This stores a patient's recorded voice, and — where the account produces
 * them — a text transcript of it. That is the same category as call recordings
 * and sms_archive's message bodies, and it carries the same two bounds, which
 * are not optional:
 *   · It lives on the MESSAGING pool (ASSIGNMENTS_DATABASE_URL), never the
 *     audit pool, so the audit database keeps its no-PHI property.
 *     DO NOT MOVE THIS TABLE. `registerVoicemailArchive` is called from
 *     messaging.mjs for exactly that reason, and a test pins it.
 *   · The counterparty is stored as HMAC + last4, never in the clear — the
 *     same call sent_messages, call_events, sms_archive, patient_directory and
 *     call_archive all make. The object key carries message ids, never a
 *     number and never a name.
 *
 * ⚠️ Retention is KEEP-FOREVER, matching the call archive (Josh, 2026-09-22:
 * *"keep it forever, no retention policy"*). There is deliberately no prune
 * job and no retention variable — that is the decision, not an oversight. At
 * ~2.6 voicemails a business day this is a rounding error against the
 * recordings beside it.
 *
 * ── The same shape as callArchive, for the same reasons ─────────────────────
 * Metadata first, audio second: each run UPSERTS a row for every voicemail in
 * the window (cheap, complete), then drains a bounded, paced slice of the audio
 * queue OLDEST-FIRST — because the oldest unarchived message is the one closest
 * to deletion, so the job races the window rather than the clock. That ordering
 * is also why there is no backfill script: ordinary hourly runs drain whatever
 * is queued, and a redeploy costs at most one run's progress.
 *
 * Reconcile, never increment: every run re-reads the WHOLE window, so any
 * single successful run repairs every prior gap. This gateway redeploys on
 * every push to main, so bad runs are a certainty.
 *
 * ── Why it reuses the call archive's bucket ─────────────────────────────────
 * `callArchiveStore.mjs` is a generic S3 wrapper that happens to be named for
 * its first caller, and its credentials are already set on the gateway. A
 * second store module would mean five more Railway variables that must be set
 * before this feature does anything at all — and a half-configured second store
 * is a new silent failure mode for no benefit, since the two archives want the
 * same bucket, the same lifecycle and the same access posture. They are kept
 * apart by the object-key PREFIX (`voicemails/` vs `recordings/`), which is
 * what makes a listing of one not a listing of the other.
 */
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { rcConfigured, rcMediaFetch, rcApiFetch } from "./ringcentral.mjs";
import { retryAfterMs } from "./rcLimiter.mjs";
import { authEnforced } from "./auth.mjs";
import { phoneHmac } from "./phoneHash.mjs";
import {
  getObjectStream,
  presignGet,
  putObject,
  storeConfigured,
  storeName,
} from "./callArchiveStore.mjs";
import {
  AUDIO_GAP_MS,
  EVERY_MS,
  MAX_ATTEMPTS,
  MAX_PAGES,
  MIN_GAP_MS,
  PAGE_SIZE,
  SCAN_GAP_MS,
  TRANSCRIPT_BUDGET,
  URL_TTL_SECONDS,
  WINDOW_DAYS,
  archiveHealth,
  drainBudget,
  extensionFor,
  fallbackFilename,
  isOfficeHours,
  nextAudioState,
  objectKey,
  toVoicemailRow,
  windowStart,
} from "./voicemailArchiveRules.mjs";

/**
 * ⚠️ Its OWN statement, deliberately not appended to another module's SCHEMA
 * template — index.mjs records why: that block ends in a DROP+CREATE VIEW which
 * takes every CREATE TABLE with it when it fails.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS voicemail_archive (
  -- The message-store id. Unlike a call recording there is no second id that
  -- survives a purge — when the window closes the whole record goes — so this
  -- table IS the surviving record, not an index onto one.
  rc_message_id    TEXT PRIMARY KEY,
  direction        TEXT NOT NULL,
  -- The OTHER party, hashed. Never the number, and never the caller-ID name.
  phone_hmac       TEXT,
  last4            TEXT,
  duration_sec     INT,
  created_at       TIMESTAMPTZ NOT NULL,

  -- none | pending | stored | gone | failed. See callArchiveRules.nextAudioState,
  -- which both archives share so "gone" can only ever mean one thing.
  audio_state      TEXT NOT NULL DEFAULT 'none',
  rc_attachment_id TEXT,
  -- RingCentral's media URL, refreshed by every scan because it is the input to
  -- the download and it dies with the message.
  content_uri      TEXT,
  object_key       TEXT,
  content_type     TEXT,
  bytes            BIGINT,

  -- The transcript, where this account produces one at all. Its ABSENCE is the
  -- expected reading, not a defect — see transcriptAttachment.
  transcript       TEXT,
  transcript_uri   TEXT,
  transcript_attempts INT NOT NULL DEFAULT 0,
  transcription_status TEXT,

  attempts         INT NOT NULL DEFAULT 0,
  last_error       TEXT,
  last_attempt_at  TIMESTAMPTZ,
  stored_at        TIMESTAMPTZ,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The queue: pending work, oldest first. Oldest is closest to deletion.
CREATE INDEX IF NOT EXISTS voicemail_archive_queue_idx   ON voicemail_archive (audio_state, created_at);
CREATE INDEX IF NOT EXISTS voicemail_archive_phone_idx   ON voicemail_archive (phone_hmac, created_at DESC);
CREATE INDEX IF NOT EXISTS voicemail_archive_created_idx ON voicemail_archive (created_at DESC);

-- One row per run. A job that silently stopped running is the failure this
-- whole module exists to prevent, and an empty archive with no run history
-- looks exactly like an empty archive that is working fine.
CREATE TABLE IF NOT EXISTS voicemail_archive_runs (
  id           BIGSERIAL PRIMARY KEY,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  ok           BOOLEAN,
  pages        INT,
  seen         INT,
  rows_written INT,
  audio_tried  INT,
  audio_stored INT,
  audio_failed INT,
  audio_gone   INT,
  transcripts  INT,
  bytes        BIGINT,
  truncated    BOOLEAN DEFAULT false,
  -- Cut short by the RingCentral budget rather than finished. Separate from
  -- truncated (the page ceiling) because the remedies differ: one wants a
  -- bigger MAX_PAGES, the other wants patience — and because archiveHealth
  -- measures staleness on runs that are neither, so an archive that sheds
  -- every single pass cannot report healthy.
  -- NOTE: this whole SCHEMA, and every SQL string in this file, is a JS
  -- template literal — so no backticks anywhere inside one, comments included.
  shed         BOOLEAN DEFAULT false,
  window_days  INT,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS voicemail_archive_runs_ok_idx ON voicemail_archive_runs (ok, finished_at DESC);

-- ⚠️ Who fetched which voicemail, and how. A presigned URL is a bearer
-- credential for PHI; an untracked one is indistinguishable from a leak. This
-- is the mitigation that makes handing them out acceptable at all.
CREATE TABLE IF NOT EXISTS voicemail_archive_access (
  id            BIGSERIAL PRIMARY KEY,
  rc_message_id TEXT NOT NULL,
  actor         TEXT,
  mode          TEXT NOT NULL,
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voicemail_archive_access_at_idx  ON voicemail_archive_access (at DESC);
CREATE INDEX IF NOT EXISTS voicemail_archive_access_msg_idx ON voicemail_archive_access (rc_message_id, at DESC);
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Tries per message-store page when the budget refuses it, and how long to wait
 * between them.
 *
 * ⚠️ Retrying here is NOT hammering RingCentral: `rcGuard.note` opens on a 429,
 * so the retries that follow are absorbed by the GATEWAY's own breaker and
 * never reach the account — which is what makes patience the right answer
 * rather than a way to keep a throttle alive.
 */
const SHED_RETRIES = Math.max(Number(process.env.VOICEMAIL_ARCHIVE_SHED_RETRIES) || 5, 1);
const SHED_PAUSE_MS = Math.max(Number(process.env.VOICEMAIL_ARCHIVE_SHED_PAUSE_MS) || 30_000, 1_000);

/** Defensive cap on a stored transcript. Real ones are a paragraph; this only
 *  stops a malformed response becoming an unbounded row. */
const TRANSCRIPT_MAX_CHARS = 20_000;

/** Rows per INSERT. 13 columns, so 100 rows is 1,300 bind parameters — well
 *  under Postgres' 65535 cap, and one round trip instead of a hundred. */
const CHUNK = 100;

export function upsertSql(count) {
  const cols = 13;
  const tuples = [];
  for (let i = 0; i < count; i++) {
    const b = i * cols;
    tuples.push(
      `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6}::timestamptz,$${b + 7},` +
        `$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13})`,
    );
  }
  // ⚠️⚠️ THE SCAN MAY ONLY EVER MOVE `none` → `pending`. Every other transition
  // belongs to the downloader, which is the only thing that knows whether we
  // actually hold the bytes. Without that rule a re-scan resets a stored row to
  // `pending` and re-downloads it forever — and, worse, a message whose audio
  // attachment stopped being listed would come back as `none` and erase the
  // record that we hold the audio, silently.
  //
  // `none` → `pending` must stay allowed: a voicemail read seconds after it
  // lands can arrive before its audio part is attached, and the next pass is
  // what picks it up.
  return (
    `INSERT INTO voicemail_archive
       (rc_message_id, direction, phone_hmac, last4, duration_sec, created_at, audio_state,
        rc_attachment_id, content_uri, transcript_uri, transcription_status, attempts, first_seen_at)
     VALUES ${tuples.join(",")}
     ON CONFLICT (rc_message_id) DO UPDATE SET
       phone_hmac           = COALESCE(EXCLUDED.phone_hmac,       voicemail_archive.phone_hmac),
       last4                = COALESCE(NULLIF(EXCLUDED.last4,''), voicemail_archive.last4),
       duration_sec         = GREATEST(COALESCE(EXCLUDED.duration_sec,0), COALESCE(voicemail_archive.duration_sec,0)),
       rc_attachment_id     = COALESCE(EXCLUDED.rc_attachment_id, voicemail_archive.rc_attachment_id),
       content_uri          = COALESCE(EXCLUDED.content_uri,      voicemail_archive.content_uri),
       -- ⚠️ Refreshed on every pass on purpose: transcription is ASYNC, so a
       -- voicemail first seen as InProgress grows a transcript uri minutes
       -- later. Reading it once would mean every transcript we ever get is one
       -- we happened to ask about at the right moment.
       transcript_uri       = COALESCE(EXCLUDED.transcript_uri,   voicemail_archive.transcript_uri),
       transcription_status = COALESCE(EXCLUDED.transcription_status, voicemail_archive.transcription_status),
       audio_state          = CASE
                                WHEN voicemail_archive.audio_state = 'none' AND EXCLUDED.audio_state = 'pending'
                                  THEN 'pending'
                                ELSE voicemail_archive.audio_state
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
        r.rcMessageId,
        r.direction,
        r.phoneHmac,
        r.last4,
        r.durationSec,
        r.createdAt,
        r.audioState,
        r.rcAttachmentId,
        r.contentUri,
        r.transcriptUri,
        r.transcriptionStatus,
        0,
        new Date().toISOString(),
      );
    }
    const res = await pool.query(upsertSql(slice.length), args);
    written += res.rowCount || 0;
  }
  return written;
}

/**
 * Hand RingCentral message-store records to the archive.
 *
 * ⚠️ THE one path into voicemail_archive's metadata — the hourly scan below and
 * the Communications inbox's minute-by-minute capture (commsInbox.mjs) both
 * come through here, so the scan-may-only-move-`none`-→-`pending` rule holds
 * whoever is scanning. Records of any type may be passed; anything that is not
 * a voicemail is ignored.
 *
 * @returns {Promise<{written: number, rows: object[]}>} `rows` carry the
 *   counterparty in the clear for the caller's in-memory use only.
 */
export async function archiveVoicemailRecords({ pool, records }) {
  const rows = [];
  for (const rec of records ?? []) {
    const row = toVoicemailRow(rec);
    if (!row) continue;
    // A blank or unhashable number is not a reason to drop the voicemail — a
    // blocked or withheld caller still left a message somebody may ask about.
    rows.push({ ...row, phoneHmac: row.phone ? phoneHmac(row.phone) || null : null });
  }
  const written = rows.length ? await upsertRows(pool, rows) : 0;
  return { written, rows };
}

/**
 * Page the message store over the window and upsert a row per voicemail.
 *
 * ⚠️ `background` tier on purpose: this is bulk work with nobody waiting, so it
 * is the first thing shed when RingCentral is under pressure. A shed run costs
 * nothing — the next one re-reads the same window.
 */
export async function scanMessageStore({ pool, now, stats }) {
  const dateFrom = windowStart(now, WINDOW_DAYS);
  for (let page = 1; page <= MAX_PAGES; page++) {
    let up = null;
    // ⚠️ `messageType=VoiceMail` is a SINGLE value, and that is the difference
    // between this and smsArchive.mjs, which passes no type at all. The
    // MULTI-value syntax 400s on this account (it broke the whole thread load
    // when it was tried), so that module filters in code instead — but one
    // value is proven in production by `fetchVoicemails` in the SPA, and
    // filtering server-side is what turns a ~5,000-record window into ~90.
    //
    // ⚠️ No `direction` filter, deliberately. `fetchVoicemails` passes
    // Inbound because a list of messages to listen to is inbound by nature;
    // an archive must not silently exclude a category, and the rare outbound
    // row costs nothing when the whole window is one page.
    //
    // ⚠️ `dateFrom` is explicit for the reason the fax count documents: this
    // API defaults to roughly the last 24 hours, so an omitted bound quietly
    // turns a 35-day repair pass into a one-day one.
    const path =
      `/restapi/v1.0/account/~/extension/~/message-store` +
      `?messageType=VoiceMail&dateFrom=${encodeURIComponent(dateFrom)}` +
      `&perPage=${PAGE_SIZE}&page=${page}`;
    for (let attempt = 1; attempt <= SHED_RETRIES; attempt++) {
      const res = await rcApiFetch(path, {}, { tier: "background", caller: "voicemail-archive", ttlMs: 0 });
      if (res.status !== 429) {
        up = res;
        break;
      }
      stats.shedHits++;
      if (attempt === SHED_RETRIES) break;
      // Honour whoever refused us — rcLimiter's own refusal carries a
      // Retry-After, and so does a real RingCentral 429.
      await sleep(retryAfterMs(res.headers.get("retry-after")) || SHED_PAUSE_MS);
    }
    if (!up) {
      // ⚠️⚠️ Out of retries, and NOT an error. `background` is the tier
      // rcLimiter sheds FIRST — that is the whole point of putting this work
      // on it — so a busy afternoon refuses a page as a matter of design. The
      // call archive's first live run learned this the hard way: it took a
      // 429, threw, and therefore never reached the audio queue at all.
      // Abandoning the EXPENSIVE half because the CHEAP half was throttled is
      // exactly backwards. `shed` records it so a clipped pass cannot be
      // mistaken for a complete one.
      stats.shed = true;
      return;
    }
    // ⚠️ Any OTHER non-ok status still throws. A 403 is a missing RingCentral
    // permission and a 5xx is RingCentral being down — both are faults worth
    // surfacing, and swallowing them would make a broken integration look like
    // a quiet week.
    if (!up.ok) throw new Error(`RingCentral message-store read failed (${up.status})`);
    const j = await up.json();
    const records = j.records ?? [];
    stats.pages = page;
    stats.seen += records.length;

    stats.rowsWritten += (await archiveVoicemailRecords({ pool, records })).written;

    if (records.length < PAGE_SIZE) return;
    // Hitting the ceiling means the window held more than we read, i.e. the
    // pass is TRUNCATED. Reported rather than swallowed: it is the one outcome
    // that looks like success and isn't.
    if (page === MAX_PAGES) stats.truncated = true;
    // ⚠️ Pages are PACED, like the downloads. A sustained rate is gentle; a
    // burst is the thing a rate limiter notices, and the burst is what drew
    // real 429s on the call archive's first live run.
    await sleep(SCAN_GAP_MS);
  }
}

/**
 * Download and store a bounded slice of the pending queue.
 *
 * ⚠️ OLDEST FIRST. The oldest unarchived voicemail is the one closest to being
 * deleted, so this ordering makes the job race the 30-day window rather than
 * the clock. Newest-first would archive what has a month left and lose what had
 * a day.
 */
export async function drainAudioQueue({ pool, stats, budget = drainBudget(), gapMs = AUDIO_GAP_MS }) {
  if (budget <= 0) return;
  stats.busy = isOfficeHours();
  stats.budget = budget;
  const q = await pool.query(
    `SELECT rc_message_id, rc_attachment_id, content_uri, created_at, last4, attempts
       FROM voicemail_archive
      WHERE audio_state = 'pending' AND attempts < $1 AND content_uri IS NOT NULL
      ORDER BY created_at ASC
      LIMIT $2`,
    [MAX_ATTEMPTS, budget],
  );

  for (let i = 0; i < q.rows.length; i++) {
    const row = q.rows[i];
    stats.audioTried++;
    const attempts = Number(row.attempts) + 1;
    try {
      const up = await rcMediaFetch(row.content_uri, { tier: "background", caller: "voicemail-archive" });
      // ⚠️⚠️ A 429 MUST NOT BURN AN ATTEMPT. Attempts exist to retire a
      // voicemail that is genuinely unfetchable; a throttle says nothing about
      // this voicemail at all. Counting it would let one busy afternoon park
      // MAX_ATTEMPTS-worth of perfectly good messages as `failed`, which is
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
        const state = nextAudioState({ status: up.status, attempts, maxAttempts: MAX_ATTEMPTS });
        if (state === "gone") stats.audioGone++;
        else if (state === "failed") stats.audioFailed++;
        await pool.query(
          `UPDATE voicemail_archive
              SET audio_state = $2, attempts = $3, last_error = $4, last_attempt_at = now()
            WHERE rc_message_id = $1`,
          [row.rc_message_id, state, attempts, `HTTP ${up.status}`],
        );
        continue;
      }

      const contentType = up.headers.get("content-type") || "";
      const body = Buffer.from(await up.arrayBuffer());

      // ⚠️ A 200 is not audio. RingCentral (and the storage in front of it) can
      // hand back an XML or HTML error body with a 200 status — the same trap
      // `fetchAssetBytes` documents for expired monday URLs, where an
      // AccessDenied body renders as a blank "file" instead of an error. An
      // archive that stores those has lost the voicemail AND reports success.
      if (!/^audio\//i.test(contentType) || body.length === 0) {
        const state = nextAudioState({ status: 0, attempts, maxAttempts: MAX_ATTEMPTS });
        if (state === "failed") stats.audioFailed++;
        await pool.query(
          `UPDATE voicemail_archive
              SET audio_state = $2, attempts = $3, last_error = $4, last_attempt_at = now()
            WHERE rc_message_id = $1`,
          [row.rc_message_id, state, attempts, `not audio (${contentType || "no type"}, ${body.length}B)`],
        );
        continue;
      }

      const ext = extensionFor(contentType);
      const key = objectKey({
        createdAt: row.created_at,
        rcMessageId: row.rc_message_id,
        rcAttachmentId: row.rc_attachment_id,
        ext,
      });
      await putObject({ key, body, contentType });

      // ⚠️ Marked `stored` only AFTER the object is written. If the process dies
      // between the PUT and this UPDATE the row stays `pending` and the next run
      // re-uploads to the SAME key (it is derived from the ids), which overwrites
      // rather than duplicating. The other order would mark a voicemail safe
      // that is not in the bucket.
      await pool.query(
        `UPDATE voicemail_archive
            SET audio_state = 'stored', object_key = $2, content_type = $3, bytes = $4,
                attempts = $5, last_error = NULL, last_attempt_at = now(), stored_at = now()
          WHERE rc_message_id = $1`,
        [row.rc_message_id, key, contentType, body.length, attempts],
      );
      stats.audioStored++;
      stats.bytes += body.length;
    } catch (e) {
      const state = nextAudioState({ status: 0, attempts, maxAttempts: MAX_ATTEMPTS });
      if (state === "failed") stats.audioFailed++;
      await pool
        .query(
          `UPDATE voicemail_archive
              SET audio_state = $2, attempts = $3, last_error = $4, last_attempt_at = now()
            WHERE rc_message_id = $1`,
          [row.rc_message_id, state, attempts, String((e && e.message) || e).slice(0, 500)],
        )
        .catch(() => {});
    }
    if (i < q.rows.length - 1) await sleep(gapMs);
  }
}

/**
 * Fetch the transcripts RingCentral has produced, where it produces any.
 *
 * ⚠️⚠️ **THE ABSENCE OF TRANSCRIPTS IS THE EXPECTED READING, NOT A FAULT.**
 * Transcription is a per-account RingCentral feature and it is NOT established
 * that it is on here — §5.28 records the same caveat for the SPA's voicemail
 * pane. When it is off, `vmTranscriptionStatus` comes back `NotAvailable`,
 * there is no text attachment, `transcript_uri` stays null and this loop does
 * nothing at all. Nothing here may mark a row failed for want of a transcript,
 * and `archiveHealth` reports the count without ever treating zero as a defect.
 *
 * ⚠️ It runs as its OWN pass rather than inside the audio drain, because the
 * two are not ready at the same time: transcription is async, so a voicemail
 * whose audio we stored within the hour may not have a transcript for minutes
 * afterwards. A separate queue re-checks on the next run, within the window,
 * on its own.
 *
 * ⚠️ Its budget is separate from the audio budget for the same reason it is
 * small: a transcript is a few hundred bytes and may be worth nothing, so it
 * must never crowd out the thing that actually matters.
 */
export async function drainTranscriptQueue({ pool, stats, budget = TRANSCRIPT_BUDGET, gapMs = AUDIO_GAP_MS }) {
  if (budget <= 0) return;
  const q = await pool.query(
    `SELECT rc_message_id, transcript_uri, transcript_attempts
       FROM voicemail_archive
      WHERE transcript IS NULL AND transcript_uri IS NOT NULL AND transcript_attempts < $1
      ORDER BY created_at ASC
      LIMIT $2`,
    [MAX_ATTEMPTS, budget],
  );

  for (let i = 0; i < q.rows.length; i++) {
    const row = q.rows[i];
    const attempts = Number(row.transcript_attempts) + 1;
    try {
      const up = await rcMediaFetch(row.transcript_uri, { tier: "background", caller: "voicemail-archive" });
      // A throttle says nothing about this transcript — same rule as the audio
      // drain, and the same reason: attempts exist to retire something that is
      // genuinely unfetchable.
      if (up.status === 429) {
        stats.shed = true;
        stats.shedHits++;
        return;
      }
      if (!up.ok) {
        await pool.query(
          `UPDATE voicemail_archive SET transcript_attempts = $2 WHERE rc_message_id = $1`,
          [row.rc_message_id, attempts],
        );
        continue;
      }
      const text = (await up.text()).trim().slice(0, TRANSCRIPT_MAX_CHARS);
      if (!text) {
        // An empty transcript is an answer, not a failure — but it is stored as
        // an ATTEMPT rather than as an empty string, so a transcript that
        // arrives later is still picked up.
        await pool.query(
          `UPDATE voicemail_archive SET transcript_attempts = $2 WHERE rc_message_id = $1`,
          [row.rc_message_id, attempts],
        );
        continue;
      }
      await pool.query(
        `UPDATE voicemail_archive SET transcript = $2, transcript_attempts = $3 WHERE rc_message_id = $1`,
        [row.rc_message_id, text, attempts],
      );
      stats.transcripts++;
    } catch {
      await pool
        .query(`UPDATE voicemail_archive SET transcript_attempts = $2 WHERE rc_message_id = $1`, [
          row.rc_message_id,
          attempts,
        ])
        .catch(() => {});
    }
    if (i < q.rows.length - 1) await sleep(gapMs);
  }
}

/** One reconcile at a time. A boot run and a timer tick can land together, and
 *  two scans at once would double the RingCentral spend to write the same rows
 *  — and race each other for the same queue slice. */
let running = false;

export async function reconcileVoicemailArchive({ pool, now = Date.now() } = {}) {
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
    transcripts: 0,
    bytes: 0,
    truncated: false,
    shed: false,
    shedHits: 0,
    busy: false,
    budget: 0,
  };
  let runId = null;
  try {
    runId = (
      await pool.query(
        `INSERT INTO voicemail_archive_runs (window_days) VALUES ($1) RETURNING id`,
        [WINDOW_DAYS],
      )
    ).rows[0]?.id;

    // ⚠️ SEQUENCED, NOT CONDITIONAL. The drains run whatever the scan managed —
    // the queue is durable in Postgres and does not care whether this run added
    // to it, so a throttled scan must never cost a run's worth of downloads.
    await scanMessageStore({ pool, now, stats });
    await drainAudioQueue({ pool, stats });
    await drainTranscriptQueue({ pool, stats });

    await pool.query(
      `UPDATE voicemail_archive_runs
          SET finished_at = now(), ok = true, pages = $2, seen = $3, rows_written = $4,
              audio_tried = $5, audio_stored = $6, audio_failed = $7, audio_gone = $8,
              transcripts = $9, bytes = $10, truncated = $11, shed = $12
        WHERE id = $1`,
      [
        runId, stats.pages, stats.seen, stats.rowsWritten,
        stats.audioTried, stats.audioStored, stats.audioFailed, stats.audioGone,
        stats.transcripts, stats.bytes, stats.truncated, stats.shed,
      ],
    );
    console.log(
      `voicemail_archive: ${stats.seen} voicemail(s) over ${WINDOW_DAYS}d on ${stats.pages} page(s), ` +
        `${stats.rowsWritten} row(s) written; audio ${stats.audioStored} stored, ${stats.audioGone} gone, ` +
        `${stats.audioFailed} failed; ${stats.transcripts} transcript(s) (budget ${stats.budget}` +
        `${stats.busy ? ", office hours" : ""})` +
        `${stats.truncated ? " (TRUNCATED)" : ""}${stats.shed ? ` (SHED after ${stats.shedHits} refusal(s))` : ""}`,
    );
    return { ok: true, ...stats };
  } catch (e) {
    const msg = String((e && e.message) || e);
    console.error("voicemail_archive reconcile failed:", msg);
    if (runId) {
      await pool
        .query(
          `UPDATE voicemail_archive_runs
              SET finished_at = now(), ok = false, pages = $2, seen = $3, rows_written = $4,
                  audio_tried = $5, audio_stored = $6, audio_failed = $7, audio_gone = $8,
                  transcripts = $9, bytes = $10, truncated = $11, shed = $12, error = $13
            WHERE id = $1`,
          [
            runId, stats.pages, stats.seen, stats.rowsWritten,
            stats.audioTried, stats.audioStored, stats.audioFailed, stats.audioGone,
            stats.transcripts, stats.bytes, stats.truncated, stats.shed, msg.slice(0, 500),
          ],
        )
        .catch(() => {});
    }
    return { ok: false, error: msg, ...stats };
  } finally {
    running = false;
  }
}

/**
 * Can we actually GET a voicemail back out?
 *
 * ⚠️⚠️ SAVING AND SERVING ARE DIFFERENT SIGNING CHAINS. A successful upload
 * proves the credentials, the endpoint and the HEADER-signed request work. A
 * presigned URL is QUERY-string SigV4 — a different code path — so the archive
 * can be filling perfectly while every attempt to play a message 403s, and
 * nothing anywhere would say so. callArchive.mjs records shipping exactly that
 * bug and reporting a false alarm on the one signal that exists to be trusted.
 *
 * ⚠️ It must be a ranged **GET**, never a HEAD: SigV4 signs the HTTP METHOD, so
 * a URL signed from a GetObjectCommand is a GET-only URL and a HEAD to it is
 * SignatureDoesNotMatch every single time.
 *
 * ⚠️ Cached and NON-BLOCKING, because /voicemail/archive-health is
 * unauthenticated and polled by a monitor on a short timeout — a health
 * endpoint that waits on a third-party round trip can TIME OUT, which reads as
 * an outage generated by the monitoring itself.
 */
let _presign = { at: 0, ok: null };
const PRESIGN_CHECK_MS = 5 * 60_000;

function presignSelfCheck(pool) {
  if (!storeConfigured()) return null;
  if (Date.now() - _presign.at >= PRESIGN_CHECK_MS) {
    _presign = { at: Date.now(), ok: _presign.ok };
    void refreshPresignCheck(pool);
  }
  return _presign.ok;
}

async function refreshPresignCheck(pool) {
  try {
    const q = await pool.query(
      `SELECT object_key, content_type FROM voicemail_archive
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
      const res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, signal: ctl.signal });
      _presign = { at: Date.now(), ok: res.ok };
      if (!res.ok) {
        let detail = "";
        try {
          detail = (await res.text()).replace(/\s+/g, " ").slice(0, 300);
        } catch {
          /* no body */
        }
        console.error(`voicemail_archive: presigned GET self-check failed (${res.status}) ${detail}`);
      }
      return res.ok;
    } finally {
      clearTimeout(t);
    }
  } catch (e) {
    console.error("voicemail_archive: presigned GET self-check errored:", String((e && e.message) || e));
    _presign = { at: Date.now(), ok: false };
    return false;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Routes
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * ⚠️ The SAME service token as the call archive, deliberately. Both routes
 * answer the one question "may this service read archived patient media", so a
 * second token would be a second secret to rotate, a second thing to set on
 * every consumer, and a second thing to forget — for no additional boundary.
 */
const SERVICE_TOKEN = process.env.CALL_ARCHIVE_SERVICE_TOKEN || "";
const FORCE_MIN_GAP_MS =
  Math.max(Number(process.env.VOICEMAIL_ARCHIVE_FORCE_MIN_GAP_MINUTES) || 5, 0) * 60_000;
let lastForcedAt = 0;

/** The shape a row is handed out in. ⚠️ `last4` and never the number — the
 *  archive holds an HMAC, and a caller who knows the number can find the rows
 *  by sending it (we hash what they bring), which is `/directory/lookup`'s
 *  posture: nothing is disclosed that the caller did not already hold. */
function publicRow(r) {
  return {
    messageId: r.rc_message_id,
    direction: r.direction,
    last4: r.last4,
    durationSec: Number(r.duration_sec ?? 0),
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    hasAudio: r.audio_state === "stored",
    audioState: r.audio_state,
    bytes: r.bytes === null || r.bytes === undefined ? null : Number(r.bytes),
    contentType: r.content_type || null,
    storedAt: r.stored_at ? new Date(r.stored_at).toISOString() : null,
    transcript: r.transcript || null,
    transcriptionStatus: r.transcription_status || null,
  };
}

export function registerVoicemailArchive({ app, pool, requireCaller }) {
  // Master kill switch. The archive is additive and shed-first, but if it ever
  // needs stopping it must be stoppable from Railway in seconds — without a
  // revert and a redeploy of the service that also carries patient texting.
  const killed = process.env.VOICEMAIL_ARCHIVE_ENABLED === "0";
  const disabled = killed || !pool;
  if (killed) console.warn("WARN: voicemail archive disabled by VOICEMAIL_ARCHIVE_ENABLED=0");
  else if (!pool) console.warn("WARN: voicemail archive disabled (messaging Postgres not configured)");

  if (disabled) {
    // ⚠️⚠️ THE HEALTH ROUTE SURVIVES THE KILL SWITCH, and that is the point of
    // putting it before the early return. Without it, flipping the switch
    // during an incident makes /voicemail/archive-health 404 — which a monitor
    // reports as "could not reach the health check", i.e. turning a deliberate
    // shutdown into a fresh alert stream at the exact moment somebody is
    // already dealing with something.
    app.get("/voicemail/archive-health", (_req, res) => {
      res.json({
        ok: true,
        enabled: false,
        reason: killed
          ? "the voicemail archive is switched off (VOICEMAIL_ARCHIVE_ENABLED=0)"
          : "the voicemail archive is not configured (messaging Postgres missing)",
      });
    });
    return;
  }
  if (!storeConfigured()) {
    // ⚠️ A warning, not a throw. A gateway with no bucket configured must still
    // boot and carry patient texting; the archive simply does not run, and
    // /voicemail/archive-health says so rather than the process dying.
    console.warn(
      "WARN: voicemail archive disabled (object store not configured — set CALL_ARCHIVE_* env vars)",
    );
  }

  /**
   * A verified employee, OR a service holding the shared token.
   *
   * ⚠️ Same shape as callArchive's, including the `authEnforced()` clause:
   * `requireCaller` answers 401 ITSELF only when auth is enforced, so in a
   * build with no Google client id it returns null having sent nothing — and
   * returning there would hang the request forever.
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
    if (who === null && authEnforced()) return null;
    return who || "anon";
  }

  /**
   * ⚠️ UNAUTHENTICATED, matching /calls/archive-health and /calls/health beside
   * it: counts and timestamps only, never a number, a message id, a transcript
   * or an employee email. The whole point is that an outage here is silent, so
   * the check has to be reachable by whatever is watching — including the
   * calls-monitor cron, which carries no token.
   */
  app.get("/voicemail/archive-health", async (_req, res) => {
    try {
      if (!pool) return res.json({ ok: false, reason: "messaging Postgres not configured" });
      const q = await pool.query(
        `SELECT
           (SELECT max(finished_at) FROM voicemail_archive_runs WHERE ok)                              AS last_ok,
           -- ⚠️ AND NOT truncated AND NOT shed — a pass clipped by the page
           -- ceiling or cut short by a throttle did NOT read the window, so
           -- treating it as one would let an archive that sheds every run
           -- report healthy forever while the 30-day window closes.
           (SELECT max(finished_at) FROM voicemail_archive_runs
             WHERE ok AND NOT truncated AND NOT shed)                                                 AS last_complete,
           (SELECT max(started_at)  FROM voicemail_archive_runs)                                       AS last_run,
           (SELECT error FROM voicemail_archive_runs WHERE error IS NOT NULL ORDER BY id DESC LIMIT 1) AS last_error,
           (SELECT truncated FROM voicemail_archive_runs WHERE ok ORDER BY finished_at DESC LIMIT 1)   AS last_trunc,
           (SELECT count(*) FROM voicemail_archive)                                                    AS rows,
           (SELECT count(*) FROM voicemail_archive WHERE audio_state = 'stored')                       AS stored,
           (SELECT count(*) FROM voicemail_archive WHERE audio_state = 'pending')                      AS pending,
           (SELECT count(*) FROM voicemail_archive WHERE audio_state = 'failed')                       AS failed,
           (SELECT count(*) FROM voicemail_archive WHERE audio_state = 'gone')                         AS gone,
           (SELECT count(*) FROM voicemail_archive WHERE audio_state = 'none')                         AS none_state,
           (SELECT count(*) FROM voicemail_archive WHERE transcript IS NOT NULL)                       AS transcripts,
           (SELECT coalesce(sum(bytes),0) FROM voicemail_archive WHERE audio_state = 'stored')         AS bytes,
           (SELECT min(created_at) FROM voicemail_archive)                                             AS oldest,
           (SELECT max(created_at) FROM voicemail_archive)                                             AS newest,
           (SELECT min(created_at) FROM voicemail_archive WHERE audio_state = 'pending')               AS oldest_pending`,
      );
      const r = q.rows[0] || {};
      const presignOk = presignSelfCheck(pool);
      res.json({
        ...archiveHealth({
          lastOkAt: r.last_ok,
          lastCompleteAt: r.last_complete,
          lastRunAt: r.last_run,
          lastError: r.last_error,
          lastTruncated: r.last_trunc,
          rows: r.rows,
          stored: r.stored,
          pending: r.pending,
          failed: r.failed,
          gone: r.gone,
          none: r.none_state,
          transcripts: r.transcripts,
          bytes: r.bytes,
          oldest: r.oldest,
          newest: r.newest,
          oldestPendingAt: r.oldest_pending,
          presignOk,
        }),
        enabled: true,
        storeConfigured: storeConfigured(),
        bucket: storeConfigured() ? storeName() : null,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String((e && e.message) || e) });
    }
  });

  /**
   * Force a run, so iterating costs neither a redeploy nor an hour.
   *
   * ⚠️ AUTHENTICATED **AND** RATE-FLOORED, both, unlike the health route beside
   * it. `running` only blocks CONCURRENT runs, so a client that posts again
   * each time the last one finishes gets a fresh full scan plus a full audio
   * slice every time. That is precisely the shape of the 2026-08-20 incident:
   * one runaway, AUTHENTICATED client draining the shared RingCentral account
   * and taking texting down for the whole company. Auth alone would not have
   * stopped it.
   */
  app.post("/voicemail/archive-run", async (req, res) => {
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
    const out = await reconcileVoicemailArchive({ pool });
    res.status(out.ok ? 200 : 502).json(out);
  });

  /**
   * The audio, for the Command Center and for other services.
   *
   * Default is a **302 to a presigned URL**: the browser (or the service)
   * fetches straight from the bucket, where egress is free and the gateway
   * never touches the bytes.
   *
   * ⚠️⚠️ A PRESIGNED URL IS A BEARER CREDENTIAL FOR PHI — copyable out of a
   * network tab, and it works for anyone holding it until it expires. Three
   * things bound that, and none is optional: it is issued only behind the
   * caller check above; its life is minutes (URL_TTL_SECONDS, capped at an hour
   * in the rules module); and **every issuance is written to
   * voicemail_archive_access**, because an untracked bearer credential for a
   * patient's recorded voice is indistinguishable from a leak.
   *
   * ⚠️ `?mode=proxy` streams the bytes through the gateway instead. It exists
   * because a browser `fetch()` following a cross-origin redirect needs CORS on
   * the bucket, which Railway buckets do not expose a way to configure — so an
   * `<audio src>` or an `<a href>` can take the 302 and a `fetch()`-based
   * caller takes the proxy. Both are authenticated; only the cost differs.
   */
  app.get("/voicemail/audio", async (req, res) => {
    const who = await caller(req, res);
    if (who === null) return;
    if (!storeConfigured()) return res.status(503).json({ error: "object store not configured" });
    const messageId = String(req.query?.messageId || "").trim();
    if (!messageId) return res.status(400).json({ error: "messageId is required" });

    try {
      const q = await pool.query(
        `SELECT rc_message_id, object_key, content_type, audio_state, created_at, last4
           FROM voicemail_archive WHERE rc_message_id = $1`,
        [messageId],
      );
      const row = q.rows[0];
      if (!row) return res.status(404).json({ error: "no archived voicemail with that id", messageId });
      if (row.audio_state !== "stored" || !row.object_key) {
        // ⚠️ The state is REPORTED rather than flattened to a 404. "RingCentral
        // never gave us audio for it", "it was purged before we got there" and
        // "it is queued, come back shortly" are three different answers with
        // three different next moves, and a bare 404 makes them one.
        return res
          .status(404)
          .json({ error: "no audio archived for that voicemail", messageId, audioState: row.audio_state });
      }

      const ext = extensionFor(row.content_type);
      const filename =
        String(req.query?.filename || "").replace(/[^\w.\- ]/g, "").slice(0, 120) ||
        fallbackFilename({ createdAt: row.created_at, last4: row.last4, ext });

      const mode = req.query?.mode === "proxy" ? "proxy" : "presigned";
      // Fire-and-forget: an audit row must never be able to fail the fetch, and
      // it must never be able to make this route slow.
      void pool
        .query(`INSERT INTO voicemail_archive_access (rc_message_id, actor, mode) VALUES ($1,$2,$3)`, [
          messageId,
          who,
          mode,
        ])
        .catch(() => {});

      if (mode === "proxy") {
        const out = await getObjectStream(row.object_key);
        res.status(200).set("Content-Type", row.content_type || "audio/mpeg");
        if (out.bytes) res.set("Content-Length", String(out.bytes));
        res.set("Content-Disposition", `inline; filename="${filename}"`);
        // ⚠️ Streamed, not buffered — and both stream shapes are handled: the
        // SDK's `Body` is a Node Readable on this runtime but a WEB
        // ReadableStream under some configurations, and a web stream has no
        // `.pipe`, so assuming one is a TypeError inside a route that has
        // already sent its headers, i.e. a dead connection rather than an error
        // anybody can read.
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
   * The metadata query — what the Command Center and other services read.
   *
   * ⚠️ This is deliberately ALSO the batched "do we hold audio for these"
   * question, rather than a second `/voicemail/have` route beside it: pass
   * `messageIds` and it answers for exactly those. One route doing both jobs
   * beats shipping an endpoint with no caller, which §5.31b records as the
   * module that "does not fail; it is absent, and its green tests say
   * otherwise".
   *
   * ⚠️ It answers with `last4`, never the number, because the archive stores an
   * HMAC. A caller who KNOWS a number can find its voicemail by sending it — we
   * hash what they bring — which is exactly `/directory/lookup`'s posture.
   */
  app.post("/voicemail/archive/query", async (req, res) => {
    const who = await caller(req, res);
    if (who === null) return;
    const body = req.body || {};
    const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 1000);
    const sinceDays = Math.min(Math.max(Number(body.sinceDays) || 30, 1), 3650);
    const messageIds = Array.isArray(body.messageIds) ? body.messageIds.map(String).slice(0, 500) : [];
    const phones = Array.isArray(body.phones) ? body.phones.map(String).slice(0, 100) : [];

    try {
      const where = [];
      const args = [];
      // ⚠️ An explicit id list is NOT date-bounded. A caller asking about
      // specific voicemails already knows which ones it wants, and silently
      // dropping the ones older than `sinceDays` would answer "we hold no
      // audio for that" about a message sitting in the bucket — the exact
      // wrong answer for the aged-out messages this archive exists for.
      if (messageIds.length) {
        args.push(messageIds);
        where.push(`rc_message_id = ANY($${args.length}::text[])`);
      } else {
        args.push(String(sinceDays));
        where.push(`created_at >= now() - ($${args.length} || ' days')::interval`);
      }
      if (phones.length) {
        // Hashed with the SAME helper that stamped the column on the way in. A
        // read that normalised differently would match nothing and report an
        // empty history — the exact failure this module exists to prevent.
        const hashes = phones.map((p) => phoneHmac(p)).filter(Boolean);
        if (!hashes.length) return res.json({ ok: true, voicemails: [] });
        args.push(hashes);
        where.push(`phone_hmac = ANY($${args.length}::text[])`);
      }
      args.push(limit);
      const q = await pool.query(
        `SELECT rc_message_id, direction, last4, duration_sec, created_at, audio_state, bytes,
                content_type, stored_at, transcript, transcription_status
           FROM voicemail_archive
          WHERE ${where.join(" AND ")}
          ORDER BY created_at DESC
          LIMIT $${args.length}`,
        args,
      );
      // ⚠️ Echo the window actually used. A silently narrowed window reads as
      // "nothing happened" — the same reason /calls/history echoes its bounds.
      res.json({
        ok: true,
        sinceDays: messageIds.length ? null : sinceDays,
        limit,
        voicemails: q.rows.map(publicRow),
      });
    } catch (e) {
      /* ⚠️ A failure is an ERROR, not an empty result. `[]` means "we hold
         nothing", which a caller acts on by drawing no player — so a 200 with
         `[]` on a dead database is indistinguishable from an archive that
         legitimately has nothing, which is §5.27's silence one table over. */
      res.status(502).json({ ok: false, error: String((e && e.message) || e) });
    }
  });

  void (async () => {
    try {
      await pool.query(SCHEMA);
      console.log("Voicemail archive schema ready");
    } catch (e) {
      console.error("Voicemail archive schema failed:", e.message);
      return;
    }
    if (!storeConfigured()) return;

    // Hourly thereafter. unref() so a pending timer can never hold the process
    // open through a redeploy.
    setInterval(() => void reconcileVoicemailArchive({ pool }), EVERY_MS).unref?.();

    // Boot run, unless one landed recently. Delayed so a cold start is not
    // competing with the traffic that woke it — and offset from the call
    // archive's own boot run, so a redeploy does not fire two full scans at
    // the same RingCentral account in the same second.
    setTimeout(() => {
      void (async () => {
        try {
          const q = await pool.query(`SELECT max(finished_at) AS last_ok FROM voicemail_archive_runs WHERE ok`);
          const lastOk = q.rows[0]?.last_ok ? new Date(q.rows[0].last_ok).getTime() : 0;
          if (Date.now() - lastOk < MIN_GAP_MS) {
            console.log("voicemail_archive: boot run skipped, a recent run already succeeded");
            return;
          }
          await reconcileVoicemailArchive({ pool });
        } catch (e) {
          console.error("voicemail_archive boot run failed:", e.message);
        }
      })();
    }, 150_000).unref?.();
  })();
}
