/**
 * mmsArchiveRules.mjs — the pure half of the MMS media archive.
 *
 * Split out of mmsArchive.mjs so the rules that decide WHAT gets archived,
 * WHERE it lands and WHETHER the job is healthy are unit-testable without the
 * express / pg / aws-sdk imports beside them — the same split as
 * callArchiveRules.mjs, voicemailArchiveRules.mjs and smsArchiveRules.mjs.
 *
 * Nothing here calls RingCentral, Postgres or S3. Nothing here has side
 * effects.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 * §5.27 built sms_archive and said outright what it did not cover:
 *
 *   "Not covered: MMS media. Attachment bytes live on RingCentral and purge
 *    with the message, so the archive stores the attachment metadata and uris
 *    only — a patient's insurance-card photo is recorded as having existed,
 *    not saved."
 *
 * §5.47b closed the same sentence for voicemail and left this one open. This is
 * it. A patient answering "what insurance do you have?" with a photo of their
 * card (§5.23 — the whole insurance step is built around that answer) is on the
 * SAME ~30-day message-store clock as their texts, and the failure is quieter
 * than either archive beside it: the text survives in sms_archive, so the
 * thread goes on saying a photo was attached, with a uri that 404s and nothing
 * saying the image itself is gone.
 *
 * ── ⚠️⚠️ WHY THIS MODULE HAS NO RINGCENTRAL SCAN, AND THAT IS NOT A SHORTCUT ─
 * callArchive and voicemailArchive each open with a metadata pass over
 * RingCentral, because they are the only thing that knows their records exist.
 * This one is not: sms_archive ALREADY reconciles the whole 35-day window
 * daily and already records every media part as {id, contentType, uri}
 * (smsArchiveRules.mediaAttachments), including the uri, "so a later job can
 * fetch the bytes". This is that job.
 *
 * So the queue source is POSTGRES, not RingCentral, and this module is
 * DRAIN-ONLY. What that buys is not just fewer requests: the enqueue is one
 * SQL statement against a table we own, so it cannot be shed, cannot be
 * throttled and cannot be truncated by a page ceiling — three of the four
 * failure modes the archives beside it spend real machinery on simply do not
 * arise here. What it costs is one coupling, and it is worth naming: **if
 * sms_archive ever stops recording attachments, this archive goes silently
 * empty.** smsArchiveRules.mediaAttachments is the keep-in-agreement partner.
 *
 * ── ⚠️⚠️ AND WHY THE STATE CANNOT LIVE IN sms_archive.attachments ───────────
 * The obvious cheaper design is to write "we have these bytes" back into that
 * JSONB column. It would be destroyed within a day: smsArchive's own upsert
 * ends `attachments = EXCLUDED.attachments`, replacing the column wholesale on
 * every reconcile — deliberately, so a message's late delivery verdict can be
 * corrected. Any archive state written there is overwritten by the next
 * nightly run, silently, and the media is re-downloaded for ever. Hence a table
 * of our own, keyed on (message, attachment), seeded FROM that column.
 */
import {
  MAX_ATTEMPTS as CALL_MAX_ATTEMPTS,
  URL_TTL_SECONDS as CALL_URL_TTL_SECONDS,
  extensionFor as audioExtensionFor,
  isOfficeHours,
  last10,
  last4,
  nextAudioState,
  windowStart,
} from "./callArchiveRules.mjs";

/**
 * ⚠️ RE-EXPORTED, NEVER RE-IMPLEMENTED — the same call voicemailArchiveRules
 * makes, for the same reasons:
 *
 *  · `nextAudioState` — `gone` is terminal and nothing ever retries it, so two
 *    readings of "is this really gone" is two chances to throw a patient's
 *    photo away. (The name says "audio" because the call archive was its first
 *    caller; the rule is about an HTTP status and knows nothing about media.)
 *  · `isOfficeHours` — the early brake that keeps bulk work off the line while
 *    reps are on it. Two definitions of "the office is working" is one of them
 *    being wrong twice a year at the DST boundary.
 *  · `last10` / `last4` / `windowStart` — a read that normalised differently
 *    from the write matches nothing and reports an empty history.
 *
 * ⚠️⚠️ `extensionFor` is deliberately **NOT** among them — see
 * `extensionForMedia` below, which is the one genuine divergence in this file.
 */
export { isOfficeHours, last10, last4, nextAudioState, windowStart };

/* ────────────────────────────────────────────────────────────────────────────
 * Window and pacing
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * How far back the enqueue looks in sms_archive.
 *
 * Deliberately LONGER than smsArchiveRules.WINDOW_DAYS (35), which is itself
 * longer than the ~30 days RingCentral retains. A message enters sms_archive at
 * the very edge of ITS window, so an enqueue bounded at the same number could
 * miss a row by hours; a few extra days cost one cheap SQL scan of rows that
 * are already enqueued and change nothing.
 *
 * ⚠️ It is bounded at all only because sms_archive is KEEP-FOREVER (§5.27,
 * unpruned). An unbounded enqueue would re-walk every text we have ever stored,
 * every hour, for ever, to re-learn what it already knows.
 *
 * ⚠️ Nothing is LOST at the far edge: the enqueue writes a row per attachment
 * once, and the drain reads that table rather than this window — so a media
 * part that has been queued for weeks keeps being retried long after its
 * message drops out of here. The window decides what gets NOTICED, not what
 * gets finished.
 */
export const ENQUEUE_DAYS = Math.max(Number(process.env.MMS_ARCHIVE_ENQUEUE_DAYS) || 45, 1);

/** How often the job runs. Hourly, like the two archives beside it: frequent
 *  small runs beat one big nightly one, because the gateway redeploys on every
 *  push to main and a redeploy then costs an hour of progress, not a night's. */
export const EVERY_MS = Math.max(Number(process.env.MMS_ARCHIVE_EVERY_HOURS) || 1, 1) * 3600_000;

/** Skip the boot run if one succeeded this recently — an afternoon of deploys
 *  must not become an afternoon of full drains. */
export const MIN_GAP_MS = Math.max(Number(process.env.MMS_ARCHIVE_MIN_GAP_MINUTES) || 20, 0) * 60_000;

/**
 * Gap between media downloads.
 *
 * ⚠️ Set to the call archive's HEAVY-group pace (10 requests/60s), for the
 * reason voicemailArchiveRules gives for the same number: it is not established
 * which rate-limit group message-store CONTENT is in, being slower than
 * necessary costs nothing at this volume, and being faster than the real
 * ceiling costs 429s on the account that also carries live patient texting —
 * INCIDENT_2026-08-20's shape.
 *
 * ⚠️ `noteRateLimitGroup` in ringcentral.mjs logs the `X-Rate-Limit-Group`
 * header once per path shape. An MMS attachment and a voicemail attachment are
 * the SAME path shape (`/message-store/{id}/content/{attachmentId}`), so the
 * first live run of either settles this constant for both. Read it from that
 * log line rather than from a doc page.
 */
export const MEDIA_GAP_MS = Math.max(Number(process.env.MMS_ARCHIVE_GAP_MS) || 6_500, 0);

/** Downloads per run, outside office hours. */
export const PER_RUN_BUDGET = Math.max(Number(process.env.MMS_ARCHIVE_PER_RUN) || 120, 0);

/** The same budget while the office is working. ⚠️ The shed floor in rcLimiter
 *  is a LATE brake — it engages once the account is already busy, which is when
 *  a rep is waiting on a thread to load. This is the early one. */
export const PER_RUN_BUSY_BUDGET = Math.max(Number(process.env.MMS_ARCHIVE_PER_RUN_BUSY) || 20, 0);

/** How much media this run may take, given who else is on the line. */
export function drainBudget(now = new Date()) {
  return isOfficeHours(now) ? PER_RUN_BUSY_BUDGET : PER_RUN_BUDGET;
}

/** Tries before a media part is parked as `failed`, spread over separate runs. */
export const MAX_ATTEMPTS = Math.max(Number(process.env.MMS_ARCHIVE_MAX_ATTEMPTS) || CALL_MAX_ATTEMPTS, 1);

/** Presigned-URL lifetime. One TTL for every piece of archived patient media —
 *  see the PHI note on `presignGet` in callArchiveStore.mjs. */
export const URL_TTL_SECONDS = CALL_URL_TTL_SECONDS;

/**
 * Defensive ceiling on one object.
 *
 * MMS is capped by the carriers at a megabyte or so, so anything far beyond
 * that is not a photo — it is an error page, a redirect chain or a bug. Stored
 * as a `failed` row with the size in `last_error`, never silently truncated:
 * half a JPEG is a file that opens to grey, which is worse than an honest gap.
 */
export const MAX_BYTES = Math.max(Number(process.env.MMS_ARCHIVE_MAX_BYTES) || 25 * 1024 * 1024, 1);

/** How stale a successful run may get before that is a fault. Hourly cadence,
 *  so six hours is six missed runs. */
export const STALE_AFTER_MS = Math.max(Number(process.env.MMS_ARCHIVE_STALE_HOURS) || 6, 1) * 3600_000;

/* ────────────────────────────────────────────────────────────────────────────
 * Reading a media part
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The file extension for a piece of MMS media.
 *
 * ⚠️⚠️ THIS IS THE ONE THING IN THIS FILE THAT IS NOT RE-EXPORTED FROM
 * callArchiveRules, AND IT MUST NOT BE. `extensionFor` there returns **"mp3"
 * for anything it does not recognise** — correct when every input is a call
 * recording and every unknown is some audio codec, and catastrophic here: MMS
 * media is images, video and vCards, so that rule would name a patient's
 * insurance-card photo `.mp3`. A file whose extension lies is a file that opens
 * in the wrong application, or does not open at all, and nothing says why.
 *
 * ⚠️ It DELEGATES for `audio/*`, so the two cannot disagree about the one
 * family they share. An MMS really can carry an audio part.
 *
 * ⚠️ The fallback is `bin`, not a guess. An unknown type saved as `.bin` is
 * honest and still openable by anyone who looks at `content_type`; an unknown
 * type saved as `.jpg` is a lie that spreads.
 */
export function extensionForMedia(mimeType) {
  const t = String(mimeType ?? "").toLowerCase().split(";")[0].trim();
  if (t.startsWith("audio/")) return audioExtensionFor(t);
  const map = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/pjpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/tiff": "tiff",
    "video/mp4": "mp4",
    "video/3gpp": "3gp",
    "video/3gpp2": "3g2",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-msvideo": "avi",
    "text/vcard": "vcf",
    "text/x-vcard": "vcf",
    "text/directory": "vcf",
    "application/pdf": "pdf",
    "text/plain": "txt",
  };
  return map[t] || "bin";
}

/**
 * Does this response body look like the media we asked for?
 *
 * ⚠️⚠️ THE CALL AND VOICEMAIL ARCHIVES BOTH TEST `/^audio\//`, AND THAT TEST
 * CANNOT BE REUSED HERE. MMS media is a photo, a video or a contact card, so an
 * audio check would reject every single real attachment. What it is guarding
 * against is the same thing though, and it is real: RingCentral and the storage
 * in front of it can hand back an XML or HTML error body **with a 200 status** —
 * the trap `fetchAssetBytes` documents for expired monday URLs, where an
 * AccessDenied body renders as a blank "file" instead of an error. An archive
 * that stores those has lost the photo AND reported success.
 *
 * So the test is made precise by something the other two archives do not have:
 * **we already know what to expect.** sms_archive recorded the attachment's own
 * `contentType` when the message was archived, so a mismatch is checkable
 * rather than guessable.
 *
 *  · empty body ⇒ not media, always;
 *  · the response type agrees with what sms_archive recorded ⇒ media;
 *  · the response type is one of the error shapes ⇒ NOT media;
 *  · anything else ⇒ media, and that permissiveness is deliberate. The expected
 *    type can legitimately be absent or stale, and refusing an unfamiliar-but-
 *    real type would throw away the photo to avoid storing an error page. The
 *    two are not symmetric: a stored error page is a visible, fixable row with
 *    its size and type in `last_error`; a discarded photo is gone in thirty
 *    days.
 *
 * ⚠️ `text/vcard` is why the error list names types exactly rather than
 * rejecting everything under `text/`. A shared contact card is real MMS media.
 */
const ERROR_CONTENT_TYPES = new Set([
  "text/html",
  "application/xml",
  "text/xml",
  "application/json",
  "application/problem+json",
]);

function bareType(mimeType) {
  return String(mimeType ?? "").toLowerCase().split(";")[0].trim();
}

export function looksLikeMedia({ contentType, expectedContentType, bytes } = {}) {
  if (!Number(bytes)) return false;
  const got = bareType(contentType);
  const want = bareType(expectedContentType);
  if (want && got && got === want) return true;
  if (ERROR_CONTENT_TYPES.has(got)) return false;
  return true;
}

/**
 * Where an object lives in the bucket.
 *
 * `mms/YYYY/MM/DD/<messageId>_<attachmentId>.<ext>`
 *
 * ⚠️ The SAME bucket as the call recordings and the voicemail, under its OWN
 * prefix — see the store note in mmsArchive.mjs for why a third bucket was not
 * created. The prefix is what keeps a listing of one from being a listing of
 * another.
 *
 * ⚠️ The ATTACHMENT id is in the key, not just the message id: one MMS can
 * carry several parts, and a key that named only the message would have the
 * second part overwrite the first — silently, since the upload is idempotent by
 * key precisely so a retry does not duplicate.
 *
 * ⚠️ Partitioned by **UTC**, not Eastern, for the reason callArchiveRules
 * .objectKey gives: a RingCentral `creationTime` is a real UTC instant (unlike
 * a naive monday column, §5.15) and UTC has no DST gap or overlap, so the
 * partition boundaries are stable and a key can be derived from a timestamp by
 * anyone without knowing our office's timezone rules.
 */
export function objectKey({ createdAt, rcMessageId, rcAttachmentId, ext = "bin" }) {
  const d = new Date(createdAt);
  if (!rcMessageId || !rcAttachmentId || Number.isNaN(d.getTime())) return null;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const safe = (v) => String(v ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  const msg = safe(rcMessageId);
  const att = safe(rcAttachmentId);
  if (!msg || !att) return null;
  return `mms/${yyyy}/${mm}/${dd}/${msg}_${att}.${safe(ext) || "bin"}`;
}

/**
 * The name a browser saves a presigned download as, when the caller offers none.
 *
 * Deliberately plain and deliberately carrying no PHI beyond four digits: this
 * process holds an HMAC, never a number, and no name at all.
 */
export function fallbackFilename({ createdAt, last4: l4, ext = "bin" }) {
  const d = new Date(createdAt);
  const stamp = Number.isNaN(d.getTime())
    ? "undated"
    : d.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return `mms_${stamp}Z${l4 ? `_x${l4}` : ""}.${ext}`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Health
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Health verdict for GET /mms/archive-health.
 *
 * ⚠️ Every failure mode here is SILENT — a dead timer, a revoked permission, a
 * shed background tier, a bucket whose credentials were rotated, or
 * sms_archive quietly ceasing to record attachments. All of them look exactly
 * like a quiet week until somebody asks for a photo we no longer have, and by
 * then the 30-day window has closed on everything in between.
 *
 * Not ok when:
 *  · no run has ever completed — however many rows the table holds, so a job
 *    that was deployed but never actually ran cannot report healthy;
 *  · the last COMPLETE run is older than STALE_AFTER_MS. ⚠️⚠️ Complete, not
 *    merely `ok`: a run cut short by the rate limiter is recorded ok — it
 *    really did what it could, and losing that signal would be worse — but it
 *    did not drain. Measuring staleness on `ok` alone would let an archive that
 *    sheds every single run report healthy for ever while the 30-day window
 *    closes on everything in it. One shed run is routine and trips nothing;
 *    six hours of them is a fault. Same rule as voicemailArchiveRules, and the
 *    reason there is no `truncated` twin here is that the enqueue is one SQL
 *    statement against our own table, so there is no page ceiling to hit.
 *  · the presigned-URL self-check is failing, i.e. media is being saved and
 *    none of it can be fetched back;
 *  · anything is parked in `failed`.
 *
 * ⚠️ `pending` is NOT a fault on its own — a backfill looks exactly like a
 * backlog, and alerting on it would page for a working system. What is a fault
 * is pending work that is not MOVING, which `oldestPendingHours` exposes for a
 * monitor to threshold on.
 *
 * ⚠️ `gone` is REPORTED AND NEVER A FAULT, and it is the standing detector for
 * the one thing nobody can measure from here: if RingCentral ever shortens its
 * message-store retention, the oldest queued media starts coming back 404 and
 * this number climbs. That is how the question answers itself next time.
 */
export function archiveHealth({
  /** The last run that finished ok, shed or not. Reported only. */
  lastOkAt,
  /** The last run that drained without being shed. Staleness is measured on
   *  this — see the note above. */
  lastCompleteAt,
  lastRunAt,
  lastError,
  rows,
  stored,
  pending,
  failed,
  gone,
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
  const failedCount = Number(failed ?? 0);
  const pendingAt = oldestPendingAt ? new Date(oldestPendingAt).getTime() : null;

  let reason = null;
  if (completeAt === null)
    reason =
      okAt === null
        ? "no successful run recorded yet"
        : "no run has yet drained without being cut short — every pass so far was shed";
  else if (stale) reason = `the last complete run was ${Math.floor(ageMs / 3600_000)}h ago`;
  else if (presignOk === false)
    // ⚠️ Ahead of the `failed` count, because this one is worse: media is being
    // saved perfectly and NONE of it can be fetched back. An archive nobody can
    // read from is the failure this module exists to prevent, wearing the
    // costume of one that is working.
    reason = "MMS media is being saved but cannot be served — the presigned-URL check is failing";
  else if (failedCount > 0) reason = `${failedCount} media part(s) RingCentral has but we could not fetch`;

  return {
    ok: !stale && presignOk !== false && failedCount === 0,
    stale,
    presignOk: presignOk === undefined ? null : presignOk,
    reason,
    lastOkAt: okAt ? new Date(okAt).toISOString() : null,
    lastCompleteAt: completeAt ? new Date(completeAt).toISOString() : null,
    lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
    lastError: lastError || null,
    ageHours: ageMs === null ? null : Math.round(ageMs / 3600_000),
    media: Number(rows ?? 0),
    stored: Number(stored ?? 0),
    pending: Number(pending ?? 0),
    failed: failedCount,
    gone: Number(gone ?? 0),
    bytes: Number(bytes ?? 0),
    oldestPendingHours:
      pendingAt === null ? null : Math.max(0, Math.round((Number(now) - pendingAt) / 3600_000)),
    oldest: oldest ? new Date(oldest).toISOString() : null,
    newest: newest ? new Date(newest).toISOString() : null,
    enqueueDays: ENQUEUE_DAYS,
  };
}
