/**
 * smsArchiveRules.mjs — pure rules for the patient-text archive.
 *
 * Split out of smsArchive.mjs for the same reason callRules.mjs and
 * rcAllowlist.mjs were: that module imports `pg` and talks to RingCentral, so
 * nothing in it can be unit-tested. What is worth testing here is the mapping
 * and the merge — the two places where getting it subtly wrong produces an
 * archive that looks full and answers the wrong question.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * RingCentral's message store is a ROLLING ~30-DAY WINDOW on this account.
 * Measured 2026-09-01: the oldest surviving record was 2026-08-01, and every
 * query with dateTo earlier than that returns 0 rows for EVERY number, not just
 * a quiet one. So "pull the full history" and "pull the last month" are the
 * same request, and anything not copied out within the month is gone for good.
 *
 * ⚠️ A missing patient thread is indistinguishable from a patient nobody ever
 * texted — 200 OK, empty `records`. That is exactly how the question "what did
 * we text this patient" came back "nothing" for a patient we had in fact called
 * (MM, 2026-09-01). The archive is what makes that answer trustworthy.
 */

/** Last ten digits — the only substring present in every rendering of a US
 *  number ("+13475037148", "(347) 503-7148" and "3475037148" share nothing
 *  else). Same helper shape as callRules.last4, for the same reason. */
export function last10(raw) {
  return String(raw ?? "").replace(/\D/g, "").slice(-10);
}

/** Display hint stored beside the HMAC, exactly as call_events does it. Four
 *  digits collide, so it is a matching HINT and never an identifier. */
export function last4(raw) {
  const d = last10(raw);
  return d.length >= 4 ? d.slice(-4) : "";
}

/**
 * How far back each reconcile reads.
 *
 * Deliberately LONGER than the ~30 days RingCentral actually retains. Asking
 * for more than it holds costs nothing — the extra days simply come back empty
 * — and it means the window can never be the thing that clipped the archive if
 * RingCentral quietly lengthens retention or a run starts late.
 */
export const WINDOW_DAYS = Math.max(Number(process.env.SMS_ARCHIVE_WINDOW_DAYS) || 35, 1);

/** RingCentral's page cap for message-store, and our own page ceiling.
 *  At ~180 records/day a 35-day window is ~26 pages; 60 leaves real headroom
 *  while still bounding a runaway loop. Hitting the cap is REPORTED, not
 *  swallowed — it would mean the archive is silently truncated. */
export const PAGE_SIZE = 250;
export const MAX_PAGES = Math.max(Number(process.env.SMS_ARCHIVE_MAX_PAGES) || 60, 1);

/** ISO timestamp for the start of the reconcile window. */
export function windowStart(now = Date.now(), days = WINDOW_DAYS) {
  return new Date(Number(now) - days * 24 * 60 * 60_000).toISOString();
}

/**
 * Is this store record a patient text?
 *
 * ⚠️ The message store also holds Fax and VoiceMail rows. Archiving those as
 * texts would be worse than the gap it fills — the same reasoning that keeps
 * the type check in /messaging/conversation. MMS is INCLUDED on purpose: a
 * patient answering with a photo of their insurance card sends an MMS, and an
 * SMS-only filter drops that message entirely (Josh, 2026-08-18).
 */
export function isArchivable(record) {
  const t = record?.type;
  return t === "SMS" || t === "MMS";
}

/**
 * Which party is the PATIENT.
 *
 * The archive is keyed by the person on the other end, never by our own line,
 * so a thread can be read back by the number a rep types in. Direction decides
 * first (`from` is definitionally ours on an Outbound message), with the known
 * -numbers filter as the safety net for a record whose direction is missing.
 *
 * ⚠️ Returns "" when every party is one of ours — a self-test text has no
 * patient side, and storing our own number as the counterparty would create a
 * fake "thread" that every lookup of our own line would then match.
 *
 * ⚠️ A group MMS with two outside recipients records only the FIRST. Patient
 * texting here is 1:1 (one patient, one thread), so this has no live case; it
 * is called out because the row would otherwise look complete.
 */
export function counterparty(record, ourNumbers = []) {
  const known = new Set(ourNumbers.map(last10).filter(Boolean));
  const to = (record?.to ?? []).map((t) => t?.phoneNumber).filter(Boolean);
  const from = record?.from?.phoneNumber || "";
  const ordered = record?.direction === "Outbound" ? [...to, from] : [from, ...to];
  for (const n of ordered) {
    if (n && !known.has(last10(n))) return n;
  }
  return "";
}

/** The media parts of an MMS. Text parts are skipped — the body already rides
 *  in `subject` — and the uri is kept so a later job can fetch the bytes.
 *
 *  ⚠️ Storing the uri is NOT storing the photo. RingCentral purges the media
 *  with the message, so these links die with the window; what survives is the
 *  fact that a photo existed, which is why a thread can still say so instead of
 *  rendering as an empty bubble. Fetching the bytes is a separate job. */
export function mediaAttachments(record) {
  return (record?.attachments ?? [])
    .filter((a) => a && a.uri && a.type !== "Text" && !/^text\//i.test(a.contentType || ""))
    .map((a) => ({ id: a.id, contentType: a.contentType || "", uri: a.uri }));
}

/**
 * RingCentral store record → archive row, or null if it should not be stored.
 *
 * Returns the counterparty as E.164-ish TEXT; hashing is the caller's job so
 * this stays testable without PHONE_HMAC_PEPPER set. Nothing here is lossy that
 * the thread view needs: `messageStatus` and `deliveryError` ride along because
 * the THREAD is the only surface RingCentral's late delivery verdict ever
 * reaches (Brandon, 2026-08-20) — an archive that dropped them would turn a
 * message the carrier rejected into an ordinary sent bubble, forever.
 */
export function toArchiveRow(record, ourNumbers = []) {
  if (!isArchivable(record)) return null;
  const id = record?.id;
  if (id === undefined || id === null || id === "") return null;
  const phone = counterparty(record, ourNumbers);
  if (!phone) return null;
  const createdAt = record?.creationTime;
  // Without a timestamp the row cannot be ordered in a thread, and an
  // unorderable message is worse than an absent one: it renders somewhere.
  if (!createdAt) return null;
  const media = mediaAttachments(record);
  return {
    rcMessageId: String(id),
    phone,
    last4: last4(phone),
    direction: record.direction === "Outbound" ? "Outbound" : "Inbound",
    body: record.subject ?? record.text ?? "",
    messageStatus: record.messageStatus ?? "",
    deliveryError: record.deliveryErrorCode ? String(record.deliveryErrorCode) : null,
    attachments: media.length ? media : null,
    createdAt: String(createdAt),
  };
}

/** An archive row → the wire shape /messaging/conversation already returns, so
 *  the SPA cannot tell an archived message from a live one (beyond the
 *  additive `archived` flag). */
export function rowToMessage(row) {
  return {
    id: String(row.rc_message_id),
    direction: row.direction === "Outbound" ? "Outbound" : "Inbound",
    text: row.body ?? "",
    time: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
    messageStatus: row.message_status ?? "",
    ...(row.delivery_error ? { deliveryError: String(row.delivery_error) } : {}),
    ...(row.attachments ? { attachments: row.attachments } : {}),
    archived: true,
  };
}

/**
 * Union of what RingCentral still holds and what we saved earlier.
 *
 * ⚠️ LIVE WINS on a collision, and the direction of that matters. The two
 * disagree exactly when a message's delivery verdict changed after we archived
 * it — a text that was `Queued` at archive time and `SendingFailed` a few
 * seconds later. Preferring the archive there would pin the stale verdict and
 * re-introduce the bug the status field exists to prevent.
 *
 * Sorted oldest-first with the same comparator the route already used, so the
 * merge cannot reorder an existing thread.
 */
export function mergeConversation(live = [], archived = []) {
  const byId = new Map();
  for (const m of archived) byId.set(String(m.id), m);
  for (const m of live) byId.set(String(m.id), m);
  return [...byId.values()].sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

/** A successful run older than this means the archive is not keeping up. Three
 *  days is chosen against the ~30-day window: it is far enough out that a
 *  single failed nightly run is not a page, and far short of the point where
 *  data starts aging out unsaved. */
export const STALE_AFTER_MS = 3 * 24 * 60 * 60_000;

/**
 * Health verdict for GET /messaging/archive-health.
 *
 * ⚠️ The point of this is that EVERY failure mode here is silent. A dead timer,
 * a revoked RingCentral permission, a throttle that sheds the background tier —
 * all of them look exactly like a quiet month until somebody asks a question
 * the archive can no longer answer. Same lesson as the calls monitor (§5.13):
 * an alert that stays quiet during an outage reads as an all-clear.
 *
 * `ok` is false when no run has EVER succeeded, so a job that was deployed but
 * never actually ran does not report healthy on an empty table.
 */
export function archiveHealth({
  lastOkAt,
  lastRunAt,
  lastError,
  lastTruncated,
  rows,
  oldest,
  newest,
  now = Date.now(),
} = {}) {
  const okAt = lastOkAt ? new Date(lastOkAt).getTime() : null;
  const ageMs = okAt ? Number(now) - okAt : null;
  const stale = okAt === null || ageMs > STALE_AFTER_MS;
  // ⚠️ A truncated pass COMPLETED — it just did not read the whole window. The
  // run is still recorded ok (we really did sync, and losing that signal would
  // be worse than the clipping), so the VERDICT has to be made here instead.
  // Without this, a clipped archive reports healthy while the messages it never
  // reached go on aging out of RingCentral — the one outcome that looks exactly
  // like success. Caught in review of this module, 2026-09-01.
  const truncated = !!lastTruncated;
  let reason = null;
  if (okAt === null) reason = "no successful run recorded yet";
  else if (stale) reason = `last successful run was ${Math.floor(ageMs / 3600_000)}h ago`;
  else if (truncated)
    reason =
      `last successful run hit the ${MAX_PAGES}-page ceiling, so the window is ` +
      `only partly archived — raise SMS_ARCHIVE_MAX_PAGES`;
  return {
    ok: !stale && !truncated,
    stale,
    truncated,
    reason,
    lastOkAt: okAt ? new Date(okAt).toISOString() : null,
    lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
    lastError: lastError || null,
    ageHours: ageMs === null ? null : Math.round(ageMs / 3600_000),
    rows: Number(rows ?? 0),
    oldest: oldest ? new Date(oldest).toISOString() : null,
    newest: newest ? new Date(newest).toISOString() : null,
    windowDays: WINDOW_DAYS,
  };
}
