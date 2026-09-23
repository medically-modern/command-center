/**
 * voicemailArchiveRules.mjs — the pure half of the voicemail archive.
 *
 * Split out of voicemailArchive.mjs so the rules that decide WHAT gets
 * archived, WHERE it lands and WHETHER the job is healthy are unit-testable
 * without the express / pg / aws-sdk imports beside them — the same split as
 * callArchiveRules.mjs vs callArchive.mjs and smsArchiveRules.mjs vs
 * smsArchive.mjs.
 *
 * Nothing here calls RingCentral, Postgres or S3. Nothing here has side
 * effects.
 *
 * ── ⚠️⚠️ THE CLOCK HERE IS THREE TIMES TIGHTER THAN THE CALL ARCHIVE'S ──────
 * Call recordings sit on a 90-day retention cliff (§5.16, measured: 9/9 at
 * 88–90 days, 0/126 at 90–92). Voicemail does not live in that system at all —
 * it is a MESSAGE-STORE record, and this account's message store is a rolling
 * ~30-day window (§5.27, measured 2026-09-01: the oldest surviving record was
 * 2026-08-01, and every query with an earlier dateTo returns 0 rows for EVERY
 * number). So a voicemail has about a third of the grace a recording does, and
 * the same silent failure mode: the audio simply stops being in the list, with
 * no error anywhere, and a patient's message is gone.
 *
 * ── Why this file does NOT carry the call archive's two-window machinery ─────
 * callArchiveRules splits SCAN_DAYS from WINDOW_DAYS because the call log is
 * ~111 rows a business day, so a 95-day repair pass is ~8,000 rows — ~16
 * call-log pages — and running that hourly would spend hundreds of RingCentral
 * requests a day to re-learn what it already knows.
 *
 * Voicemail is nothing like that volume. The extension call log showed 78
 * voicemails in 30 days (§5.13b), i.e. ~2.6 a day: a 35-day window is under a
 * hundred records, which is ONE page. So every run reads the WHOLE window, and
 * the deep/shallow bookkeeping — and the "was the deep pass complete" verdict
 * that goes with it — simply does not need to exist. Every run is a repair
 * pass. That is a simplification earned by a measurement, not a corner cut; if
 * voicemail volume ever grows two orders of magnitude, this is the first thing
 * to revisit.
 */
import {
  MAX_ATTEMPTS as CALL_MAX_ATTEMPTS,
  URL_TTL_SECONDS as CALL_URL_TTL_SECONDS,
  extensionFor,
  isOfficeHours,
  last10,
  last4,
  nextAudioState,
  windowStart,
} from "./callArchiveRules.mjs";

/**
 * ⚠️ RE-EXPORTED, NEVER RE-IMPLEMENTED.
 *
 * Six of these decide things the two archives must agree about, and a second
 * copy is the §5.7 hand-synced-mirror hazard with a specific cost each time:
 *
 *  · `extensionFor` — one names an object in the bucket and the other names a
 *    download, and per-account MP3-vs-WAV is exactly what a divergent copy gets
 *    wrong (a file that will not open, on the accounts where it is wrong).
 *  · `nextAudioState` — `gone` is terminal and nothing ever retries it, so two
 *    readings of "is this really gone" is two chances to throw audio away.
 *  · `isOfficeHours` — the early brake that keeps bulk work off the line while
 *    reps are on it. Two definitions of "the office is working" is one of them
 *    being wrong twice a year at the DST boundary.
 *  · `last10` / `last4` / `windowStart` — a read that normalised differently
 *    from the write matches nothing and reports an empty history.
 */
export { extensionFor, isOfficeHours, last10, last4, nextAudioState, windowStart };

/* ────────────────────────────────────────────────────────────────────────────
 * Window
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * How far back each run reads.
 *
 * Deliberately LONGER than the ~30 days RingCentral actually retains, for the
 * reason smsArchiveRules gives for the same number: asking for more than it
 * holds costs nothing — the extra days come back empty — and it means the
 * window can never be the thing that clipped the archive if a run starts late
 * or RingCentral quietly lengthens retention.
 *
 * ⚠️ A window SHORTER than real retention loses voicemail silently. There is no
 * surviving row to notice, the way a purged call recording at least leaves its
 * call-log entry behind: a voicemail that ages out simply stops being returned.
 */
export const WINDOW_DAYS = Math.max(Number(process.env.VOICEMAIL_ARCHIVE_WINDOW_DAYS) || 35, 1);

/** RingCentral's message-store page size, as smsArchive uses it. */
export const PAGE_SIZE = Math.min(
  Math.max(Number(process.env.VOICEMAIL_ARCHIVE_PAGE_SIZE) || 250, 1),
  1000,
);

/** Page ceiling. ~90 records in a full window is ONE page, so 20 is enormous
 *  headroom and exists only to bound a runaway loop. Hitting it is REPORTED,
 *  never swallowed — a truncated archive is the one outcome that looks exactly
 *  like a complete one. */
export const MAX_PAGES = Math.max(Number(process.env.VOICEMAIL_ARCHIVE_MAX_PAGES) || 20, 1);

/** How often the job runs. Hourly, like the call archive: frequent small runs
 *  beat one big nightly one, because the gateway redeploys on every push to
 *  main and a redeploy then costs an hour of progress rather than a night's. */
export const EVERY_MS =
  Math.max(Number(process.env.VOICEMAIL_ARCHIVE_EVERY_HOURS) || 1, 1) * 3600_000;

/** Skip the boot run if one succeeded this recently — an afternoon of deploys
 *  must not become an afternoon of full scans. */
export const MIN_GAP_MS =
  Math.max(Number(process.env.VOICEMAIL_ARCHIVE_MIN_GAP_MINUTES) || 20, 0) * 60_000;

/* ────────────────────────────────────────────────────────────────────────────
 * Pacing
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Gap between audio downloads.
 *
 * ⚠️ Set to the call archive's HEAVY-group pace (10 requests/60s) deliberately,
 * even though it is not established that message-store content is in that
 * group. It might be lighter; being slower than necessary costs nothing here,
 * because a full window is ~90 recordings against a per-run budget that drains
 * it in one pass. Being FASTER than the real ceiling costs 429s on the account
 * that also carries live patient texting — INCIDENT_2026-08-20's shape.
 *
 * ⚠️ `noteRateLimitGroup` in ringcentral.mjs logs the `X-Rate-Limit-Group`
 * header once per path shape, so the first live run prints which group
 * message-store content is actually in. Settle this constant from that line
 * rather than from a doc page.
 */
export const AUDIO_GAP_MS = Math.max(Number(process.env.VOICEMAIL_ARCHIVE_GAP_MS) || 6_500, 0);

/** Gap between message-store pages. The scan was the half that actually drew
 *  real 429s on the call archive's first live run — a sustained rate is gentle,
 *  ten requests in two seconds is a spike, and a spike is what a rate limiter
 *  is built to notice. Nothing waits on this scan, so the seconds are free. */
export const SCAN_GAP_MS = Math.max(Number(process.env.VOICEMAIL_ARCHIVE_SCAN_GAP_MS) || 1_500, 0);

/** Audio downloads per run, outside office hours. A full backlog of a 35-day
 *  window is ~90, so this drains one in a single pass. */
export const PER_RUN_BUDGET = Math.max(Number(process.env.VOICEMAIL_ARCHIVE_PER_RUN) || 120, 0);

/** The same budget while the office is working. ⚠️ The shed floor in rcLimiter
 *  is a LATE brake — it engages once the account is already busy, which is when
 *  a rep is waiting on a thread to load. This is the early one, the same trade
 *  callArchiveRules records Josh asking for on 2026-09-21. */
export const PER_RUN_BUSY_BUDGET =
  Math.max(Number(process.env.VOICEMAIL_ARCHIVE_PER_RUN_BUSY) || 20, 0);

/** How many transcripts one run may fetch. Separate from the audio budget
 *  because a transcript is a few hundred bytes and may not exist at all on this
 *  account (see `transcriptAttachment`), so it must never crowd out the thing
 *  that actually matters. */
export const TRANSCRIPT_BUDGET =
  Math.max(Number(process.env.VOICEMAIL_ARCHIVE_TRANSCRIPTS_PER_RUN) || 60, 0);

/** How many voicemails this run may take, given who else is on the line. */
export function drainBudget(now = new Date()) {
  return isOfficeHours(now) ? PER_RUN_BUSY_BUDGET : PER_RUN_BUDGET;
}

/** Tries before a voicemail is parked as `failed`, spread over separate runs. */
export const MAX_ATTEMPTS = Math.max(
  Number(process.env.VOICEMAIL_ARCHIVE_MAX_ATTEMPTS) || CALL_MAX_ATTEMPTS,
  1,
);

/** Presigned-URL lifetime. One TTL for every piece of archived patient media —
 *  see the PHI note on `presignGet` in callArchiveStore.mjs. */
export const URL_TTL_SECONDS = CALL_URL_TTL_SECONDS;

/** How stale a successful run may get before that is a fault. Hourly cadence,
 *  so six hours is six missed runs. */
export const STALE_AFTER_MS =
  Math.max(Number(process.env.VOICEMAIL_ARCHIVE_STALE_HOURS) || 6, 1) * 3600_000;

/* ────────────────────────────────────────────────────────────────────────────
 * Reading a message-store record
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Is this store record a voicemail?
 *
 * ⚠️ The mirror image of `smsArchiveRules.isArchivable`, which returns true for
 * SMS and MMS and false for everything else BY NAME — including VoiceMail,
 * with the comment that archiving one as a text "would be worse than the gap it
 * fills". That exclusion stays exactly as it is: the two archives partition the
 * store rather than overlapping, and a voicemail belongs here, where its audio
 * is fetched, not there, where it would be a text with no body.
 */
export function isVoicemail(record) {
  return record?.type === "VoiceMail";
}

/**
 * The audio part of a voicemail.
 *
 * ⚠️ NEVER `attachments[0]`. A voicemail record carries the audio AND, when the
 * account produces them, a `text/plain` transcript — in an order RingCentral
 * does not promise. Taking the first would store a transcript under an `.mp3`
 * key on the accounts where it is wrong, which is a file that will not play and
 * nothing saying why.
 *
 * Matched on the content type first and on `type === "AudioRecording"` as the
 * fallback, exactly as `fetchVoicemails` in the SPA does it — one reading of
 * the same payload, so the archive and the live list cannot disagree about
 * which part is the message.
 */
export function audioAttachment(record) {
  const atts = Array.isArray(record?.attachments) ? record.attachments : [];
  return (
    atts.find((a) => a?.uri && /^audio\//i.test(a?.contentType || "")) ||
    atts.find((a) => a?.uri && a?.type === "AudioRecording") ||
    null
  );
}

/**
 * The transcript part, when this account produces one.
 *
 * ⚠️ **UNVERIFIED AGAINST THIS ACCOUNT**, and written so that its absence is
 * the NORMAL case rather than a fault. §5.28 records the same caveat for the
 * SPA's voicemail pane: transcription is a per-account feature that may simply
 * be off here, in which case `vmTranscriptionStatus` comes back `NotAvailable`
 * and there is no text attachment at all. Nothing in the drain may treat a
 * missing transcript as a failed row — the same posture `fetchPatientCallHistory`
 * takes for absent recordings, where an account that does not produce them is
 * ordinary rather than broken.
 *
 * Matched on the content type rather than on `type`, whose value for a
 * transcript has not been seen on this account.
 */
export function transcriptAttachment(record) {
  const atts = Array.isArray(record?.attachments) ? record.attachments : [];
  return atts.find((a) => a?.uri && /^text\//i.test(a?.contentType || "")) || null;
}

/**
 * The OTHER party's number.
 *
 * ⚠️ Direction decides which field, and getting it backwards collapses every
 * voicemail onto our own main line. `from` is the caller on an inbound message,
 * so an outbound one's counterparty is the first `to`. In practice essentially
 * every voicemail here is inbound — the archive does not FILTER on direction
 * (a filter is a silent exclusion, and keeping the rare outbound row costs one
 * page either way), it just records which it was.
 */
export function counterpartyNumber(record) {
  if (record?.direction === "Outbound") {
    const to = Array.isArray(record?.to) ? record.to : [];
    for (const t of to) {
      const n = String(t?.phoneNumber ?? "").trim();
      if (n) return n;
    }
    return "";
  }
  return String(record?.from?.phoneNumber ?? "").trim();
}

/**
 * Where an object lives in the bucket.
 *
 * `voicemails/YYYY/MM/DD/<messageId>_<attachmentId>.<ext>`
 *
 * ⚠️ Same bucket as the call recordings, under its OWN prefix — see the store
 * note in voicemailArchive.mjs for why a second bucket was not created. The
 * prefix is what keeps a listing of one from being a listing of the other.
 *
 * ⚠️ Partitioned by **UTC**, not Eastern, for the reason `callArchiveRules
 * .objectKey` gives: a RingCentral `creationTime` is a real UTC instant (unlike
 * a naive monday column, §5.15) and UTC has no DST gap or overlap, so the
 * partition boundaries are stable and a key can be derived from a timestamp by
 * anyone without knowing our office's timezone rules.
 */
export function objectKey({ createdAt, rcMessageId, rcAttachmentId, ext = "mp3" }) {
  const d = new Date(createdAt);
  if (!rcMessageId || Number.isNaN(d.getTime())) return null;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const safe = (v) => String(v ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  const att = safe(rcAttachmentId) || "noatt";
  return `voicemails/${yyyy}/${mm}/${dd}/${safe(rcMessageId)}_${att}.${safe(ext) || "mp3"}`;
}

/**
 * The name a browser saves a presigned download as, when the caller offers none.
 *
 * Deliberately plain and deliberately carrying no PHI beyond four digits: this
 * process holds an HMAC, never a number, and no name at all.
 */
export function fallbackFilename({ createdAt, last4: l4, ext = "mp3" }) {
  const d = new Date(createdAt);
  const stamp = Number.isNaN(d.getTime())
    ? "undated"
    : d.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return `voicemail_${stamp}Z${l4 ? `_x${l4}` : ""}.${ext}`;
}

/**
 * One message-store record → the row we keep, or null if it is not a voicemail
 * we can key.
 *
 * ⚠️ EVERY voicemail is kept, including one whose audio we cannot see —
 * `audioState: "none"` — because the METADATA ages out of RingCentral with the
 * message too. A row saying "this number left a message at this time and we
 * never got the audio" is a fact somebody can act on; nothing at all is
 * indistinguishable from a patient who never called.
 *
 * ⚠️ `from.name` is deliberately NOT stored. It is caller ID, which on this
 * account is mostly carrier CNAM junk ("WIRELESS CALLER", "CELLCO PARTNERSHIP",
 * §5.28) and occasionally a real patient's name — i.e. a name in the clear, for
 * no benefit, when the number's HMAC already joins to `patient_directory` where
 * that departure was taken deliberately and bounded.
 */
export function toVoicemailRow(record) {
  if (!isVoicemail(record)) return null;
  const rcMessageId = String(record?.id ?? "").trim();
  const createdAt = String(record?.creationTime ?? "").trim();
  if (!rcMessageId || !createdAt || Number.isNaN(new Date(createdAt).getTime())) return null;

  const audio = audioAttachment(record);
  const transcript = transcriptAttachment(record);
  const phone = counterpartyNumber(record);

  return {
    rcMessageId,
    direction: record?.direction === "Outbound" ? "Outbound" : "Inbound",
    phone,
    last4: last4(phone),
    // Seconds, from the audio part. 0 when RingCentral did not say — which is
    // a display hint, never a reason to skip the row.
    durationSec: Math.max(0, Number(audio?.vmDuration ?? 0)) || 0,
    createdAt: new Date(createdAt).toISOString(),
    rcAttachmentId: audio?.id ? String(audio.id) : null,
    contentUri: audio?.uri ? String(audio.uri) : null,
    transcriptUri: transcript?.uri ? String(transcript.uri) : null,
    transcriptionStatus: String(record?.vmTranscriptionStatus ?? "").trim() || null,
    audioState: audio?.uri ? "pending" : "none",
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Health
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Health verdict for GET /voicemail/archive-health.
 *
 * ⚠️ Every failure mode here is SILENT — a dead timer, a revoked permission, a
 * shed background tier, a bucket whose credentials were rotated. All of them
 * look exactly like a quiet week until somebody asks for a message we no longer
 * have, and by then the 30-day window has closed on everything in between.
 *
 * Not ok when:
 *  · no run has ever read the window ALL THE WAY THROUGH — however many rows
 *    the table holds, so a job that was deployed but never actually completed
 *    a pass cannot report healthy;
 *  · the last COMPLETE pass is older than STALE_AFTER_MS. ⚠️⚠️ Complete, not
 *    merely `ok`, and that distinction is the whole reason this file needs no
 *    deep/shallow bookkeeping. A run that was SHED by the rate limiter is
 *    recorded ok — it really did do what it could, and losing that signal
 *    would be worse — but it did not read the window. Measuring staleness on
 *    `ok` alone would let an archive that sheds every single run report
 *    healthy forever while the 30-day window closes on everything in it. One
 *    shed run is routine and trips nothing; six hours of them is a fault.
 *  · the last run hit the page ceiling, so the window was only partly read.
 *    That run is still recorded ok, for the same reason, which is exactly why
 *    the verdict belongs here instead;
 *  · the presigned-URL self-check is failing, i.e. voicemail is being saved and
 *    none of it can be played back;
 *  · anything is parked in `failed`.
 *
 * ⚠️ `pending` is NOT a fault on its own — a backfill looks exactly like a
 * backlog, and alerting on it would page for a working system. What is a fault
 * is pending work that is not MOVING, which `oldestPendingHours` exposes for a
 * monitor to threshold on.
 *
 * ⚠️ `noTranscripts` is REPORTED AND NEVER A FAULT. Transcription may simply be
 * off on this account (see `transcriptAttachment`), so a zero there is the
 * expected reading, not a defect — but it is worth being able to see, because
 * the other explanation is that the fetch is broken and nobody would otherwise
 * know which.
 */
export function archiveHealth({
  /** The last run that finished ok, shed or truncated or not. Reported only. */
  lastOkAt,
  /** The last run that read the WHOLE window: ok, not truncated, not shed.
   *  This is what staleness is measured on — see the note above. */
  lastCompleteAt,
  lastRunAt,
  lastError,
  lastTruncated,
  rows,
  stored,
  pending,
  failed,
  gone,
  none,
  transcripts,
  bytes,
  oldest,
  newest,
  oldestPendingAt,
  /** null = nothing stored yet, so nothing to sign. See presignSelfCheck. */
  presignOk,
  now = Date.now(),
} = {}) {
  const okAt = lastOkAt ? new Date(lastOkAt).getTime() : null;
  const completeAt = lastCompleteAt ? new Date(lastCompleteAt).getTime() : null;
  const ageMs = completeAt ? Number(now) - completeAt : null;
  const stale = completeAt === null || ageMs > STALE_AFTER_MS;
  const truncated = !!lastTruncated;
  const failedCount = Number(failed ?? 0);
  const pendingAt = oldestPendingAt ? new Date(oldestPendingAt).getTime() : null;

  let reason = null;
  if (completeAt === null)
    reason =
      okAt === null
        ? "no successful run recorded yet"
        : "no run has yet read the whole window — every pass so far was cut short";
  else if (stale)
    reason = `the ${WINDOW_DAYS}-day window has not been read all the way through for ${Math.floor(ageMs / 3600_000)}h`;
  else if (truncated)
    reason =
      `the last run hit the ${MAX_PAGES}-page ceiling, so the ${WINDOW_DAYS}-day window is ` +
      `only partly read — raise VOICEMAIL_ARCHIVE_MAX_PAGES`;
  else if (presignOk === false)
    // ⚠️ Ahead of the `failed` count, because this one is worse: voicemail is
    // being saved perfectly and NONE of it can be played back. An archive
    // nobody can read from is the failure this module exists to prevent,
    // wearing the costume of one that is working.
    reason = "voicemail is being saved but cannot be served — the presigned-URL check is failing";
  else if (failedCount > 0)
    reason = `${failedCount} voicemail(s) RingCentral has but we could not fetch`;

  return {
    ok: !stale && !truncated && presignOk !== false && failedCount === 0,
    stale,
    truncated,
    presignOk: presignOk === undefined ? null : presignOk,
    reason,
    lastOkAt: okAt ? new Date(okAt).toISOString() : null,
    lastCompleteAt: completeAt ? new Date(completeAt).toISOString() : null,
    lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
    lastError: lastError || null,
    ageHours: ageMs === null ? null : Math.round(ageMs / 3600_000),
    voicemails: Number(rows ?? 0),
    stored: Number(stored ?? 0),
    pending: Number(pending ?? 0),
    failed: failedCount,
    gone: Number(gone ?? 0),
    none: Number(none ?? 0),
    transcripts: Number(transcripts ?? 0),
    bytes: Number(bytes ?? 0),
    oldestPendingHours:
      pendingAt === null ? null : Math.max(0, Math.round((Number(now) - pendingAt) / 3600_000)),
    oldest: oldest ? new Date(oldest).toISOString() : null,
    newest: newest ? new Date(newest).toISOString() : null,
    windowDays: WINDOW_DAYS,
  };
}
