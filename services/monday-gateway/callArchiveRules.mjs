/**
 * callArchiveRules.mjs — the pure half of the call-recording archive.
 *
 * Split out of callArchive.mjs so the rules that decide WHAT gets archived,
 * WHERE it lands and WHETHER the job is healthy are unit-testable without the
 * express / pg / aws-sdk imports beside them — the same split as
 * callRules.mjs vs inboundCalls.mjs and smsArchiveRules.mjs vs smsArchive.mjs.
 *
 * Nothing here calls RingCentral, Postgres or S3. Nothing here has side
 * effects.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Windows
 *
 * TWO of them, deliberately, and the reason is the RingCentral budget.
 *
 * A full-retention scan on every run is the obvious design and it is wasteful:
 * ~111 call-log rows a business day means a 95-day window is ~8,000 rows, i.e.
 * ~16 pages of call-log reads, and running that hourly spends ~380 RingCentral
 * calls a day to re-learn what we already know. So the hourly pass reads a
 * SHORT recent window (new calls arrive at the front), and a DEEP pass over the
 * whole retention window runs about once a day to repair anything the short
 * window missed — a gateway redeploy mid-run, a shed background tier, a day the
 * job did not fire.
 *
 * ⚠️ The deep window has to be at least as wide as RingCentral's real retention
 * or the archive loses recordings SILENTLY: the call-log row survives the purge
 * carrying no recording, so a gap looks exactly like a call that was never
 * recorded. Default 95 covers the published 90-day policy with margin. If the
 * account turns out to be on a shorter policy the default still works — it just
 * scans further back than anything exists.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Recent window read on every run. Two days, so a whole day's outage is still
 *  caught by the next ordinary run rather than having to wait for a deep pass. */
export const SCAN_DAYS = Math.max(Number(process.env.CALL_ARCHIVE_SCAN_DAYS) || 2, 1);

/** The repair window. Must be ≥ RingCentral's retention — see above. */
export const WINDOW_DAYS = Math.max(Number(process.env.CALL_ARCHIVE_WINDOW_DAYS) || 95, 1);

/** How stale a deep pass may get before the next run is promoted to one. */
export const DEEP_EVERY_MS =
  Math.max(Number(process.env.CALL_ARCHIVE_DEEP_EVERY_HOURS) || 20, 1) * 3600_000;

/** How often the job runs at all. Hourly: the audio queue is drained in small
 *  paced slices, so frequent small runs beat one big nightly one — a redeploy
 *  costs at most an hour of progress instead of a whole night's. */
export const EVERY_MS = Math.max(Number(process.env.CALL_ARCHIVE_EVERY_HOURS) || 1, 1) * 3600_000;

/** Skip the boot run if one succeeded this recently. The gateway redeploys on
 *  every push to main, so without this an afternoon of deploys is an afternoon
 *  of full scans. */
export const MIN_GAP_MS =
  Math.max(Number(process.env.CALL_ARCHIVE_MIN_GAP_MINUTES) || 20, 0) * 60_000;

/**
 * ⚠️ AS BIG AS RingCentral ALLOWS, because REQUESTS are the scarce resource
 * here, not bytes. The first live run paged at 250 and RingCentral 429'd the
 * call-log part way through a 95-day pass — and since a shed pass restarts from
 * page 1 next time, it would have spent every run re-reading pages it already
 * had and getting shed in the same place. At 1000 the same window is ~10
 * requests instead of ~40, which is the difference between a deep pass that
 * completes and one that never can.
 */
export const PAGE_SIZE = Math.min(Math.max(Number(process.env.CALL_ARCHIVE_PAGE_SIZE) || 1000, 1), 1000);
export const MAX_PAGES = Math.max(Number(process.env.CALL_ARCHIVE_MAX_PAGES) || 40, 1);

/* ────────────────────────────────────────────────────────────────────────────
 * Pacing
 *
 * ⚠️⚠️ RECORDING DOWNLOADS ARE IN RINGCENTRAL'S **HEAVY** API GROUP — 10
 * requests per 60 seconds, per their own archival guide. That is FOUR TIMES
 * tighter than the gateway's own per-caller budget of 40/min (rcLimiter.mjs),
 * so obeying rcLimiter is not enough on its own: this module has to pace itself
 * below a ceiling rcLimiter does not know about.
 *
 * 6.5s ≈ 9 requests/minute, just under the group limit with room for the
 * occasional retry. Every fetch also goes out on the `background` tier, so a
 * rep's interactive work sheds it first.
 *
 * ⚠️ Confirm the group from the `X-Rate-Limit-Group` response header — the
 * recordings guide explicitly tells you to read it, and it is the only
 * authoritative statement of which group this endpoint is in. `noteRateLimitGroup`
 * below logs it once per distinct value so the constant can be settled with a
 * fact instead of a doc page.
 * ──────────────────────────────────────────────────────────────────────────── */
export const RECORDING_GAP_MS = Math.max(Number(process.env.CALL_ARCHIVE_GAP_MS) || 6_500, 0);

/**
 * Gap between CALL-LOG pages.
 *
 * ⚠️ The drain was paced from the start and the scan was not, so it fired its
 * pages back to back — and that burst, not the download loop, is what actually
 * drew real RingCentral 429s on 2026-09-21 while the team was working. A
 * sustained 9/min is gentle; ten requests in two seconds is a spike, and a
 * spike is what a rate limiter is built to notice.
 *
 * 1.5s turns a ten-page deep scan into ~15 seconds of polite reads. That is
 * free: the scan happens once an hour (and the wide one once a day), and
 * nothing is waiting on it.
 */
export const SCAN_GAP_MS = Math.max(Number(process.env.CALL_ARCHIVE_SCAN_GAP_MS) || 1_500, 0);

/**
 * How many recordings one run may download.
 *
 * At 6.5s apiece, 300 is ~32 minutes of work inside an hourly cadence — about
 * 7,000/day of capacity against ~69/day of arrival. That ~100x headroom is what
 * makes the BACKFILL just the job running: a few thousand queued recordings
 * drain inside a day of ordinary hourly runs, with no separate script and
 * nothing long-running to be interrupted by a redeploy.
 *
 * ⚠️ Being generous here is safe BECAUSE the tier is `background`: rcLimiter
 * sheds it above 70% of the global budget, so a bigger number spends the quiet
 * hours and stands aside during a busy afternoon on its own. It was 120, which
 * left 47 minutes of every hour idle while the oldest queued recordings sat at
 * the 90-day cliff — the one part of the backlog that cannot be fetched later.
 */
export const PER_RUN_BUDGET = Math.max(Number(process.env.CALL_ARCHIVE_PER_RUN) || 300, 0);

/**
 * The same budget while the office is working.
 *
 * ⚠️ Josh, 2026-09-21: *"i dont want to throttle rc while everyone is using
 * it"*. The shed floor already stands the archive aside at 70% of the global
 * budget, but that is a LATE brake — it engages once the account is already
 * busy, and "already busy" is when a rep is waiting on a thread to load. This
 * is the early one: during office hours the drain takes a tenth of the bite,
 * and the backlog is caught up overnight when the line is quiet.
 *
 * 60 at a 6.5s gap is ~6.5 minutes of an hour, so ~1.6 requests/minute averaged
 * — noise against a 90/minute account. Overnight it goes back to 300.
 */
export const PER_RUN_BUSY_BUDGET = Math.max(Number(process.env.CALL_ARCHIVE_PER_RUN_BUSY) || 60, 0);

/** Office hours, Eastern, on the clock the rest of this app uses (§5.15). */
export const BUSY_START_HOUR = Math.min(Math.max(Number(process.env.CALL_ARCHIVE_BUSY_FROM) || 8, 0), 23);
export const BUSY_END_HOUR = Math.min(Math.max(Number(process.env.CALL_ARCHIVE_BUSY_TO) || 19, 0), 24);

/**
 * Is the office working right now?
 *
 * ⚠️ Eastern, not UTC and not the container's zone — everything else on these
 * boards is Eastern wall clock, and a UTC reading would put the brake on
 * between 4am and 3pm local, i.e. free overnight and throttled all morning.
 * `Intl` rather than an offset constant, so DST is not a twice-yearly bug.
 */
export function isOfficeHours(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const weekend = map.weekday === "Sat" || map.weekday === "Sun";
  const hour = Number(map.hour);
  return !weekend && hour >= BUSY_START_HOUR && hour < BUSY_END_HOUR;
}

/** How many recordings this run may take, given who else is on the line. */
export function drainBudget(now = new Date()) {
  return isOfficeHours(now) ? PER_RUN_BUSY_BUDGET : PER_RUN_BUDGET;
}

/** Tries before a recording is parked as `failed`. Four, spread over four
 *  separate runs (a run takes one attempt per recording), so a transient
 *  throttle or a RingCentral blip never burns the budget. */
export const MAX_ATTEMPTS = Math.max(Number(process.env.CALL_ARCHIVE_MAX_ATTEMPTS) || 4, 1);

/** Presigned-URL lifetime. Short on purpose — see the PHI note in callArchive.mjs. */
export const URL_TTL_SECONDS = Math.min(
  Math.max(Number(process.env.CALL_ARCHIVE_URL_TTL_SECONDS) || 300, 30),
  3600,
);

export const STALE_AFTER_MS =
  Math.max(Number(process.env.CALL_ARCHIVE_STALE_HOURS) || 6, 1) * 3600_000;

/**
 * How long the repair window may go unread before that is a fault.
 *
 * ⚠️ Measured from the last COMPLETE deep pass — or, when none has ever
 * finished, from the archive's first run. That second clause is what lets this
 * be honest on day one: a fresh archive genuinely has not repaired anything
 * yet, and paging for that would be the "alert that fires for a working
 * system" this module keeps refusing to be. But it also means "deep passes
 * never complete" cannot hide forever behind a null.
 */
export const DEEP_STALE_AFTER_MS = DEEP_EVERY_MS * 3;

/* ──────────────────────────────────────────────────────────────────────────── */

/** ISO timestamp `days` before `now`, for a RingCentral `dateFrom`. */
export function windowStart(now = Date.now(), days = SCAN_DAYS) {
  return new Date(Number(now) - Math.max(Number(days) || 0, 0) * 86_400_000).toISOString();
}

/** Last ten digits — the only substring present in every rendering of a number. */
export function last10(raw) {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

/** Display hint only. Four digits collide, so this is never an identifier. */
export function last4(raw) {
  const d = last10(raw);
  return d ? d.slice(-4) : "";
}

/**
 * The recording attached to a call-log record, if any.
 *
 * ⚠️ It can hang off the PARENT or off the LEG that actually carried the audio,
 * and on a claimed (forwarded) inbound call it is the leg. Reading only the
 * parent silently archives nothing for exactly the calls a rep took by pressing
 * "Take it" — the same "read the legs" rule `lib/callHistory/callHistory.ts`
 * needs for the call verdict, and `lib/fax/ringcentralApi.ts` for the blob.
 */
export function recordingOf(record) {
  const parent = record?.recording;
  if (parent?.contentUri) return parent;
  const legs = Array.isArray(record?.legs) ? record.legs : [];
  for (const leg of legs) {
    if (leg?.recording?.contentUri) return leg.recording;
  }
  return null;
}

/**
 * The OTHER party's number.
 *
 * ⚠️ Direction decides which field, and getting it backwards collapses every
 * call onto our own main line. §5.13 records this for the live-call cards:
 * `from` is the caller on an INBOUND call, so an outbound call's counterparty
 * is `to`. Reading one field for both makes every row look like the same
 * patient.
 */
export function counterpartyNumber(record) {
  const inbound = record?.direction === "Inbound";
  const side = inbound ? record?.from : record?.to;
  return String(side?.phoneNumber ?? "").trim();
}

/**
 * Extension of a stored object, from the media type RingCentral actually sent.
 *
 * ⚠️ NEVER assumed. Recordings are MP3 on most accounts and WAV on some, and
 * the setting is per-ACCOUNT — so a hardcoded `.mp3` yields a file that will
 * not open on exactly the accounts where it is wrong, with nothing saying why.
 * Mirrors `extensionFor` in src/lib/callHistory/recordingDownload.ts; the two
 * must agree, because one names the object and the other names the download.
 */
export function extensionFor(mimeType) {
  const t = String(mimeType ?? "").toLowerCase().split(";")[0].trim();
  if (t === "audio/wav" || t === "audio/x-wav" || t === "audio/wave") return "wav";
  if (t === "audio/ogg") return "ogg";
  if (t === "audio/mp4" || t === "audio/x-m4a") return "m4a";
  return "mp3";
}

/**
 * Where an object lives in the bucket.
 *
 * `recordings/YYYY/MM/DD/<callId>_<recordingId>.<ext>`
 *
 * Date-partitioned so a prefix listing is one day's calls, and BOTH ids in the
 * name so an object found loose in a bucket explorer still identifies itself
 * without the index.
 *
 * ⚠️ Partitioned by **UTC**, not Eastern, and that is not an oversight. A
 * RingCentral `startTime` is a real UTC instant (unlike a naive monday column —
 * §5.15), and UTC has no DST gap or overlap, so the partition boundaries are
 * stable and an object's key can be derived from its timestamp by anyone
 * without knowing our office's timezone rules. Eastern belongs on the DOWNLOAD
 * FILENAME, which is for a human's folder — see `fallbackFilename`.
 */
export function objectKey({ startedAt, rcCallId, rcRecordingId, ext = "mp3" }) {
  const d = new Date(startedAt);
  if (!rcCallId || Number.isNaN(d.getTime())) return null;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const safe = (v) => String(v ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  const rec = safe(rcRecordingId) || "norec";
  return `recordings/${yyyy}/${mm}/${dd}/${safe(rcCallId)}_${rec}.${safe(ext) || "mp3"}`;
}

/**
 * The name a browser saves a presigned download as, when the caller offers none.
 *
 * Deliberately plain and deliberately NOT a mirror of the SPA's
 * `recordingFilename`: that one knows the patient's NAME and this process does
 * not (the archive holds an HMAC, never a number, and no name at all). The SPA
 * passes its own nicer filename; this is the fallback for curl and for other
 * services, and it carries no PHI beyond four digits.
 */
export function fallbackFilename({ startedAt, direction, last4: l4, ext = "mp3" }) {
  const d = new Date(startedAt);
  const stamp = Number.isNaN(d.getTime()) ? "undated" : d.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const dir = direction === "Inbound" ? "inbound" : "outbound";
  return `call_${stamp}Z_${dir}${l4 ? `_x${l4}` : ""}.${ext}`;
}

/**
 * A call RingCentral has not finished writing up.
 *
 * ⚠️⚠️ THE ROOT OF "WE CALLED" ON A CALL THE PATIENT MADE (2026-09-27, the
 * Fidelis 8:26 AM call §5.53 records). The call log serves a call WHILE IT IS
 * STILL GOING — `finished: false`, `result: "In Progress"` (both are in
 * RingCentral's own CallLogRecord schema) — and rewrites it when it ends, under
 * the same id as far as §5.53's timeline shows (the phantom stood where the
 * 8:26 inbound row belongs, with no inbound row beside it). The 60-second inbox
 * tick reads the last two hours, so it can catch a call mid-flight, and the
 * upsert never updated `direction` after the first write. MEASURED: the final record for that call is Inbound
 * (same session, voicemail message on its leg), and Friday's whole log, read
 * back on 2026-09-27, has no Outbound record from an outside caller and none
 * that is "Accepted" or "Voicemail" — while the timeline showed one. NOT
 * observed (it has since been rewritten): the mid-flight record itself. A
 * record with no `direction` also became Outbound here (`toCallRow`'s
 * `=== "Inbound"` test), so either shape ends the same way.
 * So: an unfinished record is not archived at all (the next tick, a minute
 * later, reads the finished one), and the upsert takes `direction` from every
 * read (callArchive.mjs), which is how the deep pass repairs rows already
 * frozen wrong.
 */
export function isUnfinished(record) {
  return record?.finished === false || String(record?.result ?? "").trim() === "In Progress";
}

/* ────────────────────────────────────────────────────────────────────────────
 * Who picked up — the EXTENSION that answered an inbound call (§5.47d)
 *
 * Josh, 2026-09-30, after the forwarded-lines setup went live: *"we need to
 * save who picked up into the database so the calls are saved with his name
 * and ext number"* — then, narrowed: *"only which ext picked up"*, inbound
 * only, because every outbound call leaves from the one shared extension and
 * would all read as that extension's owner.
 *
 * Measured on a real call that day (Detailed view): the shared line's record
 * has a MASTER leg ("Accepted", to the line's own extension) and one fan-out
 * leg per extension it rang — to ext 2, 13, 8 and 7 at once, each "Stopped" or
 * "IP Phone Offline" except the one that answered, "Call connected", whose
 * `to.extensionNumber` was 13. Those fan-out legs carry the extension NUMBER
 * but no name, so the name comes from the account's extension list
 * (`extensionDirectory`).
 * ──────────────────────────────────────────────────────────────────────────── */

/** An empty directory — what a call is resolved against when the extension
 *  list could not be read. The number is still saved; the name fills in on a
 *  later scan (the upsert never blanks a known one). */
export const EMPTY_DIRECTORY = Object.freeze({ byExt: new Map(), byId: new Map() });

/**
 * `GET /account/~/extension` records → lookups by extension NUMBER and by id.
 * The name is the person's (contact first + last), else the extension's own
 * name — the rule `rcSetup.describeRcSetup` already logs the account with.
 */
export function extensionDirectory(records) {
  const byExt = new Map();
  const byId = new Map();
  for (const r of Array.isArray(records) ? records : []) {
    const id = r?.id !== undefined && r?.id !== null ? String(r.id) : "";
    const ext = String(r?.extensionNumber ?? "").trim();
    const first = String(r?.contact?.firstName ?? "").trim();
    const name = first
      ? `${first} ${String(r?.contact?.lastName ?? "").trim()}`.trim()
      : String(r?.name ?? "").trim();
    const entry = { id, ext, name, type: String(r?.type ?? "") };
    if (ext) byExt.set(ext, entry);
    if (id) byId.set(id, entry);
  }
  return { byExt, byId };
}

const lc = (v) => String(v ?? "").trim().toLowerCase();

/** A party on a leg → the extension it names, or null when it names none. */
function extensionParty(party, directory) {
  const extNum = String(party?.extensionNumber ?? "").trim();
  const id = party?.extensionId !== undefined && party?.extensionId !== null ? String(party.extensionId) : "";
  const hit = (extNum && directory.byExt.get(extNum)) || (id && directory.byId.get(id)) || null;
  const ext = extNum || hit?.ext || "";
  if (!ext && !hit) return null;
  return { ext, name: hit?.name || "", type: hit?.type || "" };
}

/**
 * The extension that picked up an INBOUND call, as `{ ext, name }` — or null
 * when nobody did, when we cannot say, or when the call was outbound.
 *
 * In order:
 *  1. A fan-out leg that "Call connected" to an extension → that extension.
 *     The longest one if more than one (a transfer rings on).
 *  2. ⚠️ A leg that connected to something that is NOT a person's extension —
 *     the old "Take it" forward to a rep's cell (§5.13), an IVR menu, a queue —
 *     with no person's leg connected: null, never the line's own owner.
 *  3. Otherwise, an answered call ("Accepted" / "Call connected") that did not
 *     go to voicemail was picked up on the line the log belongs to — the
 *     master leg's `to`.
 * ⚠️ Only a USER extension counts as "who": an IVR menu or a department queue
 * "connecting" is routing, not a person. With no directory (the list could not
 * be read) the type is unknown and the extension is taken as it stands.
 */
export function answeredByOf(record, directory = EMPTY_DIRECTORY) {
  if (record?.direction !== "Inbound") return null;
  const dir = directory && directory.byExt ? directory : EMPTY_DIRECTORY;
  const legs = Array.isArray(record?.legs) ? record.legs : [];
  const isPerson = (who) => !who.type || who.type === "User";

  let best = null;
  let connectedElsewhere = false;
  for (const leg of legs) {
    if (leg?.master) continue;
    if (lc(leg?.result) !== "call connected") continue;
    const who = extensionParty(leg?.to, dir);
    // Connected to something that is not a person's extension — a cell phone,
    // an IVR menu, a queue. Unless a person's leg also connected, nobody we
    // can name picked up, and the line's own owner certainly did not.
    if (!who || !who.ext || !isPerson(who)) {
      connectedElsewhere = true;
      continue;
    }
    const dur = Number(leg?.duration ?? 0) || 0;
    if (!best || dur > best.dur) best = { ...who, dur };
  }
  if (best) return { ext: best.ext, name: best.name || null };
  if (connectedElsewhere) return null;

  const answered = ["accepted", "call connected"].includes(lc(record?.result));
  const voicemail = lc(record?.result).includes("voicemail") || legs.some((l) => lc(l?.result).includes("voicemail"));
  if (!answered || voicemail) return null;
  const master = legs.find((l) => l?.master) ?? legs[0] ?? null;
  const who = extensionParty(master?.to ?? record?.to, dir);
  if (!who || !who.ext || !isPerson(who)) return null;
  return { ext: who.ext, name: who.name || null };
}

/**
 * One call-log record → the row we keep, or null if it is not a call we can key
 * (or not over yet — `isUnfinished`).
 *
 * ⚠️ EVERY call is kept, not just the recorded ones. Josh, 2026-09-21: *"having
 * other services view the information like the phone number that called and the
 * time date etc is important"*. RingCentral's call LOG ages out on its own
 * schedule too, so storing the metadata for every row makes this a durable call
 * log as well as a recording store — and it costs a few hundred bytes against a
 * multi-megabyte object. `audioState` is `none` for a call that was never
 * recorded, which is a different fact from `pending`.
 */
export function toCallRow(record, directory = EMPTY_DIRECTORY) {
  const rcCallId = String(record?.id ?? "").trim();
  const startedAt = String(record?.startTime ?? "").trim();
  if (!rcCallId || !startedAt || Number.isNaN(new Date(startedAt).getTime())) return null;
  if (isUnfinished(record)) return null;

  const rec = recordingOf(record);
  const phone = counterpartyNumber(record);
  const legs = Array.isArray(record?.legs) ? record.legs : [];
  const answeredBy = answeredByOf(record, directory);

  return {
    rcCallId,
    // Both ids survive the recording purge; the session id is also what
    // `call_events` keys on, so an archived call can be joined to its ring and
    // claim history (§5.13).
    rcSessionId: String(record?.telephonySessionId ?? record?.sessionId ?? "").trim() || null,
    rcRecordingId: rec?.id ? String(rec.id) : null,
    contentUri: rec?.contentUri ? String(rec.contentUri) : null,
    direction: record?.direction === "Inbound" ? "Inbound" : "Outbound",
    result: String(record?.result ?? "").trim() || null,
    // Raw leg results, so a consumer can apply the "read the legs" verdict rule
    // without a second RingCentral call. The VERDICT itself is deliberately not
    // computed here — `lib/callHistory/callHistory.ts` owns it, and a second
    // copy in another language is the §5.7 hand-synced-mirror hazard.
    legResults: legs.map((l) => String(l?.result ?? "")).filter(Boolean),
    durationSec: Math.max(0, Number(record?.duration ?? 0)) || 0,
    startedAt: new Date(startedAt).toISOString(),
    phone,
    last4: last4(phone),
    audioState: rec?.contentUri ? "pending" : "none",
    // ⚠️ The call log carries FAXES too ("Voice" | "Fax"). Kept, so a consumer
    // that reads this table as a list of phone calls — the Communications
    // inbox — can leave the faxes out (commsInboxRules.isFaxCall). Blank when
    // RingCentral does not say.
    callType: String(record?.type ?? "").trim() || null,
    // Who picked up an INBOUND call: the extension number and its person's
    // name (§5.47d). Null on outbound calls, missed calls, and whenever it
    // cannot be said; the upsert never blanks a known value with a null.
    answeredExt: answeredBy?.ext || null,
    answeredName: answeredBy?.name || null,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Audio state machine
 *
 *   none    — the call was never recorded. Not a gap.
 *   pending — there is a recording and we have not stored it yet.
 *   stored  — the bytes are in the bucket.
 *   gone    — RingCentral no longer has it. Terminal, and a POSITIVE finding.
 *   failed  — we tried MAX_ATTEMPTS times and could not get it, and it is not
 *             gone. Terminal for the automatic retry, and the one state that
 *             should make somebody look.
 * ──────────────────────────────────────────────────────────────────────────── */

/** RingCentral statuses that mean "this recording no longer exists", as opposed
 *  to "not right now". A 403 is deliberately NOT here: that is the
 *  ReadCallRecording permission, which is a fault to fix, not a purge. */
const GONE_STATUSES = new Set([404, 410]);

/**
 * What a failed download attempt leaves the row in.
 *
 * ⚠️ `gone` is only ever reached on POSITIVE evidence — RingCentral answering
 * 404/410 for a recording it told us about. Ageing a row out by calendar
 * arithmetic would guess, and the guess is unrecoverable: nothing ever retries
 * a `gone` row. Same discipline as `patientDirectoryRules.isOrphanRow` and the
 * pending-advance marker — act on evidence, let absence mean nothing.
 */
export function nextAudioState({ status, attempts, maxAttempts = MAX_ATTEMPTS } = {}) {
  if (GONE_STATUSES.has(Number(status))) return "gone";
  return Number(attempts) >= Number(maxAttempts) ? "failed" : "pending";
}

/** Should this run do the wide repair pass rather than the cheap recent one? */
export function shouldDeepScan({ lastDeepAt, now = Date.now(), everyMs = DEEP_EVERY_MS } = {}) {
  if (!lastDeepAt) return true;
  const t = new Date(lastDeepAt).getTime();
  if (!Number.isFinite(t)) return true;
  return Number(now) - t >= everyMs;
}

/**
 * Health verdict for GET /calls/archive-health.
 *
 * ⚠️ Every failure mode in this module is SILENT — a dead timer, a revoked
 * ReadCallRecording permission, a shed background tier, a bucket whose
 * credentials were rotated. All of them look exactly like a quiet week until
 * somebody asks for a call we no longer have. Same lesson the calls monitor
 * records: an alert that stays quiet during an outage reads as an all-clear.
 *
 * Not ok when:
 *  · no run has EVER succeeded — however many rows the table holds, so a job
 *    that was deployed but never actually ran cannot report healthy;
 *  · the last success is older than STALE_AFTER_MS;
 *  · the last successful DEEP pass hit the page ceiling, so the repair window
 *    was only partly read. That run is still recorded ok (it really did sync,
 *    and losing that signal is worse than the clipping), which is exactly why
 *    the verdict has to be made here instead — a clipped archive reporting
 *    healthy while the recordings it never reached age out is the one outcome
 *    that looks like success;
 *  · anything is parked in `failed`. That is a recording RingCentral says
 *    exists and we could not fetch, which is the whole thing this module is
 *    for.
 *
 * ⚠️ `pending` is NOT a fault on its own — the queue is meant to have a backlog
 * during a backfill, and alerting on it would page for a working system. What
 * is a fault is pending work that is not MOVING, which `oldestPendingHours`
 * exposes for a monitor to threshold on.
 */
export function archiveHealth({
  lastOkAt,
  lastRunAt,
  lastDeepOkAt,
  lastError,
  lastDeepTruncated,
  rows,
  stored,
  pending,
  failed,
  gone,
  bytes,
  oldest,
  newest,
  oldestPendingAt,
  firstRunAt,
  /** null = nothing stored yet, so nothing to sign. See presignSelfCheck. */
  presignOk,
  now = Date.now(),
} = {}) {
  const okAt = lastOkAt ? new Date(lastOkAt).getTime() : null;
  const ageMs = okAt ? Number(now) - okAt : null;
  const stale = okAt === null || ageMs > STALE_AFTER_MS;
  const truncated = !!lastDeepTruncated;
  const failedCount = Number(failed ?? 0);
  const pendingAt = oldestPendingAt ? new Date(oldestPendingAt).getTime() : null;

  // The repair window: how long since it was last read all the way through.
  // Falls back to the archive's age when no deep pass has ever completed — see
  // DEEP_STALE_AFTER_MS.
  const deepAt = lastDeepOkAt ? new Date(lastDeepOkAt).getTime() : null;
  const firstAt = firstRunAt ? new Date(firstRunAt).getTime() : null;
  const deepAgeMs = deepAt !== null ? Number(now) - deepAt : firstAt !== null ? Number(now) - firstAt : null;
  const deepStale = deepAgeMs !== null && deepAgeMs > DEEP_STALE_AFTER_MS;

  let reason = null;
  if (okAt === null) reason = "no successful run recorded yet";
  else if (stale) reason = `last successful run was ${Math.floor(ageMs / 3600_000)}h ago`;
  else if (truncated)
    reason =
      `the last deep pass hit the ${MAX_PAGES}-page ceiling, so the repair window is ` +
      `only partly read — raise CALL_ARCHIVE_MAX_PAGES`;
  else if (deepStale)
    reason =
      `the ${WINDOW_DAYS}-day repair window has not been read all the way through for ` +
      `${Math.floor(deepAgeMs / 3600_000)}h — deep passes are being cut short`;
  else if (presignOk === false)
    // ⚠️ Ahead of the `failed` count, because this one is worse: recordings are
    // being saved perfectly and NONE of them can be played back. An archive
    // nobody can read from is the failure this module exists to prevent,
    // wearing the costume of one that is working.
    reason = "recordings are being saved but cannot be served — the presigned-URL check is failing";
  else if (failedCount > 0)
    reason = `${failedCount} recording(s) RingCentral has but we could not fetch`;

  return {
    ok: !stale && !truncated && !deepStale && presignOk !== false && failedCount === 0,
    stale,
    truncated,
    deepStale,
    presignOk: presignOk === undefined ? null : presignOk,
    reason,
    lastOkAt: okAt ? new Date(okAt).toISOString() : null,
    lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
    lastDeepOkAt: deepAt ? new Date(deepAt).toISOString() : null,
    deepAgeHours: deepAgeMs === null ? null : Math.round(deepAgeMs / 3600_000),
    lastError: lastError || null,
    ageHours: ageMs === null ? null : Math.round(ageMs / 3600_000),
    calls: Number(rows ?? 0),
    stored: Number(stored ?? 0),
    pending: Number(pending ?? 0),
    failed: failedCount,
    gone: Number(gone ?? 0),
    bytes: Number(bytes ?? 0),
    oldestPendingHours:
      pendingAt === null ? null : Math.max(0, Math.round((Number(now) - pendingAt) / 3600_000)),
    oldest: oldest ? new Date(oldest).toISOString() : null,
    newest: newest ? new Date(newest).toISOString() : null,
    scanDays: SCAN_DAYS,
    windowDays: WINDOW_DAYS,
  };
}
