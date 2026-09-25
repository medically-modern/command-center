/**
 * commsInboxRules.mjs — the pure half of the Communications inbox, "the
 * Unresolved queue" (COMMS_INBOX_PLAN.md; Brandon + Katie's v2 mockup,
 * 2026-09-22; every question answered by Josh, 2026-09-23).
 *
 * No `pg`, no RingCentral, no Monday, no clock of its own: rows go in, the
 * inbox comes out. Split out of commsInbox.mjs for the reason every rules
 * module beside it was — the judgements are worth testing without a database
 * behind them, and every one of them fails SILENTLY when it is wrong (an item
 * that should be open reads as handled, a wait that should be red reads green).
 *
 * ── The model, in five lines ────────────────────────────────────────────────
 *  · The unit is the PATIENT: their primary and alternate numbers fold into one
 *    item. An unmatched number is its own item until somebody matches it.
 *  · An inbound text, a missed inbound call or a voicemail opens (or reopens) it.
 *  · Our replies never close it. A person closes it with one click that says
 *    HOW: Called (a note is required) · Texted · No action needed.
 *  · "Left voicemail" is an ATTEMPT: it is logged, and the item stays open.
 *  · 24 counted hours is the target. Saturday and Sunday, Eastern, don't count.
 *
 * ── ⚠️ Resolutions are stored PER NUMBER and grouped when read ─────────────
 * A patient is a different Monday item on every board (CLAUDE.md §6), so a
 * resolution keyed to a Welcome Call item would drop out of view the day they
 * reach Subscription. A phone number survives the hop. One click therefore
 * writes one row per number in the group, all sharing a `resolutionId`, and
 * everything here works per number first and per group second.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Constants
 * ──────────────────────────────────────────────────────────────────────────── */

/** The target. An item waiting longer than this (COUNTED — see countedWaitMs)
 *  is "Over 24h": red in the list, and a breach on the SLA card. */
export const OVER_AFTER_MS = 24 * 3600_000;

/** Undo is offered while the row is sticky; the server takes it only from the
 *  person who resolved, inside this window, and never once the note is on
 *  Monday (COMMS_INBOX_PLAN.md §5.4). */
export const UNDO_WINDOW_MS = 15 * 60_000;

/** A Monday copy made later than this says when the resolve happened, because
 *  the stamp's own time is when the LINE was written (plan §5.4). The SPA builds
 *  the line; this is exported so the two cannot disagree about the threshold. */
export const LATE_COPY_AFTER_MS = 15 * 60_000;

/** A claim on a note that never reported back is released after this, so a
 *  browser that died mid-copy cannot strand the note (plan §5.4). */
export const STALE_CLAIM_MS = 10 * 60_000;

/** After this many failed copies a note stops being retried automatically and
 *  is reported by the health route instead — so one Monday blip does not lose
 *  the copy, and a permanently failing one does not toast on every page load. */
export const MAX_MIRROR_ATTEMPTS = 3;

/** "Left voicemail" plays the recording of the newest outbound call to the
 *  patient that ENDED no more than this long before the press (plan §4.4). */
export const LEFT_VM_LINK_MS = 15 * 60_000;

/** …and a call may appear to end this long AFTER the press. Two clocks —
 *  RingCentral's and ours — and a rep presses the button the moment they hang
 *  up. Small on purpose: widening it is what would link a DIFFERENT call. */
export const LEFT_VM_SKEW_MS = 60_000;

/** Who pressed Call: a dial may precede the call-log start by this much… */
export const DIAL_BEFORE_MS = 2 * 60_000;
/** …or follow it by this much (clock skew between the browser and RingCentral). */
export const DIAL_AFTER_MS = 30_000;

/** The inline note is capped so a paste cannot bloat the log (plan §5.9). */
export const NOTE_MAX = 2000;

/** How far back the "All" tab reaches. Open items are listed however old. */
export const DISPLAY_WINDOW_MS = 30 * 24 * 3600_000;

/** Rows returned per list request. The badge counts are computed before this
 *  cap, so a long list can never make the header disagree with it. */
export const LIST_LIMIT = 500;

export const HOWS = ["called", "texted", "no_action", "left_vm"];
/** The three that CLOSE an item. `left_vm` is an attempt and never does. */
export const RESOLVING_HOWS = ["called", "texted", "no_action"];
export const HOW_LABEL = {
  called: "Called",
  texted: "Texted",
  no_action: "No action needed",
  left_vm: "Left voicemail",
};

/* ────────────────────────────────────────────────────────────────────────────
 * Small helpers
 * ──────────────────────────────────────────────────────────────────────────── */

const norm = (s) => String(s ?? "").trim().toLowerCase();

/** Milliseconds from a Date, an ISO string or a number; NaN when unreadable. */
export function toMs(v) {
  if (v === null || v === undefined || v === "") return NaN;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  return new Date(v).getTime();
}

const byAt = (a, b) => a.at - b.at;

/* ────────────────────────────────────────────────────────────────────────────
 * The missed-call verdict
 *
 * ⚠️⚠️ A MIRROR of `callConnected` / `isVoicemail` in
 * src/lib/callHistory/callHistory.ts — the gateway is a separate Node service
 * that does not build the SPA's TypeScript, so it cannot import the real one.
 * That is the hand-synced hazard CLAUDE.md §5.7 records, and it would fail the
 * worst way here: a verdict that drifted would open items for calls a rep
 * TOOK, or leave a real missed call reading as answered and silent.
 *
 * `inboxParity.test.mjs` runs BOTH copies over the same RingCentral records,
 * passing the gateway copy exactly what `call_archive` stores
 * (`callArchiveRules.toCallRow`) — which is also the proof that `result`,
 * `leg_results` and `duration_sec` are everything the rule reads.
 *
 * ⚠️ It reads the LEGS. A call a rep claimed from the Command Center is
 * forwarded, which tears down the original leg and can stamp the parent record
 * with a result that reads as missed (CLAUDE.md §5.13, §5.16). The forwarded
 * leg is the one that connected.
 * ──────────────────────────────────────────────────────────────────────────── */

const CONNECTED_RESULTS = new Set(["accepted", "call connected", "connected", "answered", "ok"]);
const VOICEMAIL_RESULTS = new Set(["voicemail", "message left"]);
const MISSED_RESULTS = new Set([
  "missed",
  "no answer",
  "busy",
  "rejected",
  "declined",
  "hang up",
  "abandoned",
  "stopped",
  "blocked",
  "call failed",
  "answered not accepted",
  "unknown caller",
]);

/** The connected labels, for the one place that needs them outside JS: the
 *  list query's pre-filter, which drops calls a rep took before they leave
 *  Postgres. Exported from HERE so the SQL can never hold a second copy. */
export const CONNECTED_RESULT_LABELS = [...CONNECTED_RESULTS];

/** Did it reach voicemail? Checked on the legs too, for the same reason. */
export function callWentToVoicemail({ result, legResults } = {}) {
  if (VOICEMAIL_RESULTS.has(norm(result))) return true;
  return (legResults ?? []).some((r) => VOICEMAIL_RESULTS.has(norm(r)));
}

/** Did anyone actually talk? The SPA's rule, over the columns call_archive keeps. */
export function callConnected({ result, legResults, durationSec } = {}) {
  if (CONNECTED_RESULTS.has(norm(result))) return true;
  if ((legResults ?? []).some((r) => CONNECTED_RESULTS.has(norm(r)))) return true;
  // Voicemail has a duration (the message) but nobody talked to the patient.
  if (callWentToVoicemail({ result, legResults })) return false;
  // An outcome RingCentral named beats a duration we're inferring from.
  if (MISSED_RESULTS.has(norm(result))) return false;
  return Number(durationSec ?? 0) > 0;
}

/** A blocked caller never opens an item — somebody here chose to block them. */
export function isBlockedCall({ result } = {}) {
  return norm(result) === "blocked";
}

/* ────────────────────────────────────────────────────────────────────────────
 * A missed call and the voicemail it left are ONE event
 *
 * ⚠️⚠️ A MIRROR of `voicemailForCall` in src/lib/commsHub/callVoicemail.ts —
 * the rule the hub's Phone tab uses to open the message a call left. Nothing
 * joins the two RingCentral lists (a call-log record carries no message id), so
 * it is a NUMBER-AND-TIME match, and it fails CLOSED: no match leaves them two
 * rows. `inboxParity.test.mjs` runs both copies over the same fixtures.
 *
 * The only difference is the key: the SPA matches on the last ten digits, and
 * the gateway — which stores no number in the clear — on the number's HMAC.
 * Both are "the same number" and nothing else.
 * ──────────────────────────────────────────────────────────────────────────── */

export const VOICEMAIL_AFTER_CALL_MS = 15 * 60 * 1000;
export const VOICEMAIL_BEFORE_CALL_MS = 2 * 60 * 1000;

/**
 * The voicemail this call left, or null.
 *
 * @param {{key: string, at: number|string, voicemail: boolean}|null} call
 * @param {Array<{id: any, key: string, at: number|string}>} voicemails
 *   ⚠️ Newest first, like the SPA's list — the loop keeps the FIRST of two
 *   equally near messages, so the order is part of the rule.
 */
export function voicemailForCall(call, voicemails) {
  if (!call?.voicemail || !voicemails?.length) return null;
  const key = String(call.key ?? "");
  if (!key) return null;
  const started = toMs(call.at);
  if (!Number.isFinite(started)) return null;

  let best = null;
  let bestGap = Infinity;
  for (const v of voicemails) {
    if (String(v.key ?? "") !== key) continue;
    const made = toMs(v.at);
    if (!Number.isFinite(made)) continue;
    const delta = made - started;
    if (delta < -VOICEMAIL_BEFORE_CALL_MS || delta > VOICEMAIL_AFTER_CALL_MS) continue;
    const gap = Math.abs(delta);
    if (gap < bestGap) {
      best = v;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Pair inbound calls with the voicemails they left — for DISPLAY.
 *
 * Each call takes its nearest message (the mirrored rule above). A message two
 * calls both reach stays with the NEARER call — the other is an ordinary missed
 * call — so one voicemail can never be listed twice.
 *
 * @returns {Map<string, object>} call id → voicemail event
 */
export function joinCallsToVoicemails(calls, voicemails) {
  const vms = [...(voicemails ?? [])].sort((a, b) => b.at - a.at); // newest first, as the SPA
  const claims = new Map(); // vm id → { callId, gap }
  for (const c of calls ?? []) {
    if (c.kind !== "call" || c.dir !== "in") continue;
    const vm = voicemailForCall(
      { key: c.hmac, at: c.at, voicemail: callWentToVoicemail(c) },
      vms.map((v) => ({ id: v.id, key: v.hmac, at: v.at, v })),
    );
    if (!vm) continue;
    const gap = Math.abs(vm.at - c.at);
    const prev = claims.get(String(vm.id));
    if (!prev || gap < prev.gap || (gap === prev.gap && c.at < prev.at)) {
      claims.set(String(vm.id), { callId: String(c.id), gap, at: c.at, vm: vm.v });
    }
  }
  const out = new Map();
  for (const { callId, vm } of claims.values()) out.set(callId, vm);
  return out;
}

/** The one join every reader uses: every inbound call against every inbound
 *  voicemail of the same events. */
export function joinInbound(events) {
  return joinCallsToVoicemails(
    (events ?? []).filter((e) => e.kind === "call" && e.dir === "in"),
    (events ?? []).filter((e) => e.kind === "voicemail" && e.dir === "in"),
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Events
 *
 * One shape for everything the four archives hold, so the rules below never
 * care which table a row came from:
 *   { kind: "text"|"call"|"voicemail", id, dir: "in"|"out", at: ms, hmac, last4, … }
 * ──────────────────────────────────────────────────────────────────────────── */

const dirOf = (d) => (String(d ?? "") === "Outbound" ? "out" : "in");

/**
 * RingCentral's terminal FAILURE statuses for a text — a mirror of
 * `src/lib/shared/smsDelivery.ts` FAILED_STATUSES, pinned by
 * `inboxParity.test.mjs`. Everything else (Queued, Sent, Delivered, Received,
 * a status nobody has seen) is NOT failed: STATUS decides, and an unknown one
 * is pending, never a failure (CLAUDE.md §5.5).
 */
export const FAILED_TEXT_STATUSES = Object.freeze(["SendingFailed", "DeliveryFailed"]);

/** Did RingCentral give up on this text? */
export function textFailed(status) {
  return FAILED_TEXT_STATUSES.includes(String(status ?? "").trim());
}

/** An `sms_archive` row. `sentBy` is joined in by the caller (senderFor). */
export function textEvent(row, sentBy = "") {
  const attachments = Array.isArray(row?.attachments) ? row.attachments : [];
  return {
    kind: "text",
    id: String(row?.rc_message_id ?? ""),
    dir: dirOf(row?.direction),
    at: toMs(row?.created_at),
    hmac: row?.phone_hmac || "",
    last4: row?.last4 || "",
    body: String(row?.body ?? ""),
    status: String(row?.message_status ?? ""),
    deliveryError: row?.delivery_error ? String(row.delivery_error) : "",
    attachments,
    sentBy: sentBy || "",
  };
}

/** A `call_archive` row. `dialedBy` is joined in by the caller (dialerFor). */
export function callEvent(row, dialedBy = "") {
  return {
    kind: "call",
    id: String(row?.rc_call_id ?? ""),
    sessionId: row?.rc_session_id ? String(row.rc_session_id) : "",
    dir: dirOf(row?.direction),
    at: toMs(row?.started_at),
    hmac: row?.phone_hmac || "",
    last4: row?.last4 || "",
    result: String(row?.result ?? ""),
    legResults: Array.isArray(row?.leg_results) ? row.leg_results.map(String) : [],
    durationSec: Math.max(0, Number(row?.duration_sec ?? 0)) || 0,
    audioState: String(row?.audio_state ?? "none"),
    // RingCentral's call-log `type` — "Voice" or "Fax". Blank on rows archived
    // before the column existed; see `isFaxCall`.
    callType: String(row?.call_type ?? ""),
    dialedBy: dialedBy || "",
  };
}

/**
 * Is this call-log row a FAX?
 *
 * ⚠️⚠️ THE CALL LOG CARRIES FAXES, and `call_archive` keeps every row it is
 * given (found by the 2026-09-23 review, against a real Postgres). A received
 * fax that failed ("Receive Error", duration 0) reads to `callConnected` as a
 * call nobody answered, so it opened a "Missed call" item — and fed the badge
 * and the SLA. The SPA has always asked the call log for `type=Voice`; the
 * archive does not, so the type rides on the row (`call_type`) and is checked
 * here. A blank type is a VOICE call: only rows archived before the column
 * existed are blank, and those are all older than the inbox's epoch.
 */
export function isFaxCall(e) {
  return e?.kind === "call" && norm(e.callType) === "fax";
}

/* ────────────────────────────────────────────────────────────────────────────
 * Browser pickups — an answered inbound call RingCentral logged as OUTBOUND
 *
 * ⚠️⚠️ MEASURED, NOT REASONED (Josh, 2026-09-25, his own two test calls: "the
 * second says we called when in reality we picked up" · "i answered in the
 * browser"). A call answered on the WebRTC softphone comes back from the call
 * log as a SINGLE Outbound/Accepted record toward the CALLER's number, with no
 * inbound record at all — direction inverted, so every surface honestly worded
 * it "We called". The one thing that knows the truth is our own telephony
 * webhook: `call_events` (§5.13) watched that inbound call ring and get
 * answered, on this same pool.
 *
 * The join is hmac + TIME (an `end/answered` event lands when the call ends,
 * so it sits within seconds of the log record's start + duration), or the
 * telephony session id when the Detailed scan has backfilled one. Guards, each
 * load-bearing:
 *  · `dialedBy` skips — a call somebody PRESSED CALL for is a genuine
 *    outbound whatever rang around it (Answer is not a dial, so a pickup can
 *    never carry one).
 *  · An answered event within the window of an INBOUND connected record is
 *    that record's own answer (an RC-app pickup logs Inbound/Accepted and
 *    raises the same event) — it must not relabel a neighbouring callback.
 *  · Fax rows and unconnected outbound calls never match.
 * A dropped webhook (§5.13's immortal-ring class) simply means no match: the
 * row keeps reading "We called", which is today's behaviour, never worse.
 * ──────────────────────────────────────────────────────────────────────────── */

export const PICKUP_MATCH_MS = 3 * 60_000;

/** `call_events` rows (kind=end, state=answered) → pickups marked on the
 *  matching outbound call events. Identity-stable when nothing matches. */
export function markBrowserPickups(events, answeredEnds = []) {
  if (!Array.isArray(events) || !events.length || !answeredEnds.length) return events;
  const accounted = events
    .filter((e) => e.kind === "call" && e.dir === "in" && callConnected(e))
    .map((e) => e.at + (Number(e.durationSec) || 0) * 1000);
  const free = answeredEnds
    .map((r) => ({
      sessionId: r.session_id ? String(r.session_id) : "",
      hmac: r.phone_hmac ? String(r.phone_hmac) : "",
      at: toMs(r.at),
    }))
    .filter((r) => Number.isFinite(r.at))
    .filter((r) => !accounted.some((endAt) => Math.abs(endAt - r.at) <= PICKUP_MATCH_MS));
  if (!free.length) return events;
  let changed = false;
  const out = events.map((e) => {
    if (e.kind !== "call" || e.dir !== "out" || e.dialedBy || isFaxCall(e) || !callConnected(e)) return e;
    const endAt = e.at + (Number(e.durationSec) || 0) * 1000;
    const hit = free.some(
      (r) =>
        (r.sessionId && e.sessionId && r.sessionId === e.sessionId) ||
        (r.hmac && r.hmac === e.hmac && Math.abs(r.at - endAt) <= PICKUP_MATCH_MS),
    );
    if (!hit) return e;
    changed = true;
    return { ...e, pickedUp: true };
  });
  return changed ? out : events;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Inverted MISSED calls — the same direction flip, unanswered
 *
 * ⚠️⚠️ OBSERVED LIVE 2026-09-25 (Brandon's morning audit). Fidelis Care rang
 * the line three times; the third call (8:26 AM, browser leg rung, nobody
 * answered, voicemail took it) came back from the call log as a single
 * OUTBOUND record toward the caller — the §5.49 inversion again, this time
 * with nobody picking up. Every surface then honestly told the wrong story:
 * the timeline said "We called · no answer" about a call the patient made
 * ("i don't think we called them back"), its voicemail could not join
 * (`joinInbound` pairs voicemails with INBOUND calls only) and rendered as an
 * orphaned row — and, the half that costs real work, an inverted missed call
 * that leaves NO voicemail opens NO inbox item at all: a patient who called
 * and got nobody, absent from the very queue built to catch them.
 *
 * The repair mirrors `markBrowserPickups`, evidence and all: our own
 * telephony webhook (`call_events`, §5.13) watched the real inbound call ring
 * and END unanswered (`kind='end', state='missed'`), so an outbound,
 * UNCONNECTED, undialled record that matches one of those ends is that
 * inbound call wearing the wrong direction. Guards, each load-bearing:
 *  · `dialedBy` skips — a call somebody PRESSED CALL for is a genuine
 *    outbound however close it landed to a missed inbound ring.
 *  · A missed end within the window of an INBOUND unconnected record is that
 *    record's own ending (the ordinary, correctly-logged missed call raises
 *    the same event) — it must never invert a genuine callback beside it.
 *    ⚠️ `guardCalls` exists because the LIST loaders pre-filter resolved
 *    (covered) inbound calls out of `events` in SQL: the guard has to see
 *    those too, or a covered missed call's end evidence would invert a rep's
 *    real callback and REOPEN the item they resolved.
 *  · Connected outbound records never match — those are `markBrowserPickups`'
 *    (the two rules partition on `callConnected`).
 * A dropped webhook simply means no match: the row keeps reading "We called",
 * which is the pre-repair behaviour, never worse.
 * ──────────────────────────────────────────────────────────────────────────── */

/** `call_events` rows (kind=end, state=missed) → the matching outbound call
 *  events re-labelled INBOUND (`dir: "in"`, `inverted: true`), after which the
 *  ordinary missed-call rules — the voicemail join, `opensItem`, the chips —
 *  apply unchanged. Identity-stable when nothing matches. */
export function markInvertedInbound(events, missedEnds = [], guardCalls = events) {
  if (!Array.isArray(events) || !events.length || !missedEnds.length) return events;
  const accounted = (Array.isArray(guardCalls) ? guardCalls : [])
    .filter((e) => e.kind === "call" && e.dir === "in" && !callConnected(e) && !isFaxCall(e))
    .map((e) => e.at + (Number(e.durationSec) || 0) * 1000);
  const free = missedEnds
    .map((r) => ({
      sessionId: r.session_id ? String(r.session_id) : "",
      hmac: r.phone_hmac ? String(r.phone_hmac) : "",
      at: toMs(r.at),
    }))
    .filter((r) => Number.isFinite(r.at))
    .filter((r) => !accounted.some((endAt) => Math.abs(endAt - r.at) <= PICKUP_MATCH_MS));
  if (!free.length) return events;
  let changed = false;
  const out = events.map((e) => {
    if (e.kind !== "call" || e.dir !== "out" || e.dialedBy || isFaxCall(e) || callConnected(e)) return e;
    const endAt = e.at + (Number(e.durationSec) || 0) * 1000;
    const hit = free.some(
      (r) =>
        (r.sessionId && e.sessionId && r.sessionId === e.sessionId) ||
        (r.hmac && r.hmac === e.hmac && Math.abs(r.at - endAt) <= PICKUP_MATCH_MS),
    );
    if (!hit) return e;
    changed = true;
    return { ...e, dir: "in", inverted: true };
  });
  return changed ? out : events;
}

/**
 * The same RingCentral record read twice in one tick, collapsed to one.
 *
 * ⚠️⚠️ OFFSET PAGING SHIFTS UNDER A BUSY LINE. The tick reads several pages of
 * a newest-first list with a pause between them; a record that arrives in the
 * pause pushes everything down one, so the last row of page 1 comes back as the
 * first row of page 2. The archives upsert in multi-row statements, and
 * Postgres refuses one that touches the same key twice ("ON CONFLICT DO UPDATE
 * command cannot affect row a second time") — so ONE duplicate failed the whole
 * tick, every minute the burst lasted (reproduced against a real Postgres,
 * 2026-09-23 review). The archives' own scans upsert one page at a time, which
 * is why they never met it.
 *
 * The LAST read of a record wins: it is the fresher one (a delivery verdict can
 * change between the two reads). A record with no id is kept as it is — the
 * archives' own row builders drop those.
 */
export function dedupeRecords(records) {
  const byId = new Map();
  const noId = [];
  for (const r of records ?? []) {
    const id = r?.id === undefined || r?.id === null ? "" : String(r.id);
    if (!id) {
      noId.push(r);
      continue;
    }
    if (byId.has(id)) byId.delete(id); // re-insert, so the order follows the last read
    byId.set(id, r);
  }
  return [...byId.values(), ...noId];
}

/** A `voicemail_archive` row. */
export function voicemailEvent(row) {
  return {
    kind: "voicemail",
    id: String(row?.rc_message_id ?? ""),
    dir: dirOf(row?.direction),
    at: toMs(row?.created_at),
    hmac: row?.phone_hmac || "",
    last4: row?.last4 || "",
    durationSec: Math.max(0, Number(row?.duration_sec ?? 0)) || 0,
    transcript: row?.transcript ? String(row.transcript) : "",
    audioState: String(row?.audio_state ?? "none"),
  };
}

/** A `comms_resolutions` row. */
export function resolutionFromRow(row) {
  return {
    id: String(row?.id ?? ""),
    resolutionId: String(row?.resolution_id ?? ""),
    hmac: row?.phone_hmac || "",
    how: String(row?.how ?? ""),
    note: row?.note ? String(row.note) : "",
    coversThrough: toMs(row?.covers_through),
    resolvedBy: String(row?.resolved_by ?? ""),
    resolvedAt: toMs(row?.resolved_at),
    itemBoard: row?.item_board === null || row?.item_board === undefined ? null : Number(row.item_board),
    itemId: row?.item_id ? String(row.item_id) : "",
    mirrorClaimedAt: row?.mirror_claimed_at ? toMs(row.mirror_claimed_at) : null,
    mirrorAttempts: Number(row?.mirror_attempts ?? 0) || 0,
    mirroredTo: row?.mirrored_to ? String(row.mirrored_to) : "",
    mirrorError: row?.mirror_error ? String(row.mirror_error) : "",
    undoneBy: row?.undone_by ? String(row.undone_by) : "",
    undoneAt: row?.undone_at ? toMs(row.undone_at) : null,
  };
}

/**
 * Does this event open (or reopen) an item?
 *
 *  · an inbound text (MMS included — sms_archive holds both);
 *  · an inbound call that did not connect, unless RingCentral says Blocked;
 *  · a voicemail left for us.
 *
 * Never a fax — `sms_archive` drops them, and the call log's are refused here
 * by type (`isFaxCall`), because `call_archive` DOES hold them. Never an
 * outbound event — our replies do not close items and do not open them either —
 * and never an event with no number: a withheld caller cannot be grouped,
 * called back or resolved. Those still show in the hub's Phone tab, as they
 * always have. Our OWN lines are dropped before this is asked (commsInbox's
 * `dropOwn`): the rules never see a number in the clear, so they cannot tell.
 */
export function opensItem(e) {
  if (!e || !e.hmac || e.dir !== "in" || !Number.isFinite(e.at)) return false;
  if (e.kind === "text") return true;
  if (e.kind === "voicemail") return true;
  if (e.kind === "call") return !isFaxCall(e) && !callConnected(e) && !isBlockedCall(e);
  return false;
}

/** The list's type chip and the row's coloured edge: text · missed · voicemail. */
export function displayKind(e, joined) {
  if (e.kind === "text") return "text";
  if (e.kind === "voicemail") return "voicemail";
  if (e.kind === "call") return joined && joined.has(String(e.id)) ? "voicemail" : "missed";
  return "text";
}

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** The second line of a list row. */
export function previewOf(e, joined) {
  if (!e) return "";
  const kind = displayKind(e, joined);
  if (e.kind === "text") {
    const body = oneLine(e.body);
    if (body) return body.slice(0, 160);
    return e.attachments?.length ? "Photo" : "Text";
  }
  if (kind === "voicemail") {
    const vm = e.kind === "voicemail" ? e : joined?.get(String(e.id));
    const t = oneLine(vm?.transcript);
    return t ? t.slice(0, 160) : "Voicemail";
  }
  return "Missed call";
}

/* ────────────────────────────────────────────────────────────────────────────
 * The wait clock — Saturday and Sunday, Eastern, don't count (plan §9.1 D7)
 *
 * ⚠️⚠️ ONE copy, here. The wait on screen, the red flag, the Over 24h tab and
 * every number on the SLA card come from `countedWaitMs`. The browser only
 * shows the wait it is given: a second copy for it to tick with would buy
 * nothing but a mirror to drift (CLAUDE.md §5.7).
 *
 * Eastern is read through `Intl`, never a fixed offset — the way
 * callArchiveRules.isOfficeHours does it — so a daylight-saving weekend (47 or
 * 49 real hours long) still skips exactly Saturday and Sunday. Holidays count
 * like weekdays: nothing in the app knows them.
 * ──────────────────────────────────────────────────────────────────────────── */

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

/** The Eastern calendar date and clock time of an instant. */
export function etParts(ms) {
  const out = {};
  for (const p of ET.formatToParts(new Date(ms))) out[p.type] = p.value;
  return {
    y: Number(out.year),
    m: Number(out.month),
    d: Number(out.day),
    h: Number(out.hour),
    mi: Number(out.minute),
  };
}

/**
 * The instant Eastern midnight begins on a calendar date.
 *
 * Midnight is never inside a US daylight-saving transition (those happen at
 * 2 AM), so it is always either 04:00 or 05:00 UTC — whichever reads 00:00 in
 * Eastern is the answer. No offset table, no library.
 */
export function etMidnightUtc(y, m, d) {
  for (const hour of [4, 5]) {
    const t = Date.UTC(y, m - 1, d, hour);
    const p = etParts(t);
    if (p.y === y && p.m === m && p.d === d && p.h === 0 && p.mi === 0) return t;
  }
  // Unreachable for America/New_York; answer something ordered rather than NaN.
  return Date.UTC(y, m - 1, d, 5);
}

/** Weekday of a calendar date, 0 = Sunday. Pure calendar arithmetic — no zone. */
const weekdayOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

const nextDate = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
};

/**
 * How long something has waited, counting weekdays only.
 *
 * A text at 6 PM Friday reads 15h at 9 AM Monday and crosses 24h at 6 PM
 * Monday. A message that lands on the weekend starts its clock as Monday
 * begins: a Saturday text reads 0m all weekend, 9h at 9 AM Monday, and turns
 * red as Tuesday begins.
 */
export function countedWaitMs(from, to) {
  const start = toMs(from);
  const end = toMs(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  let { y, m, d } = etParts(start);
  let dayStart = etMidnightUtc(y, m, d);
  let total = 0;
  // A year of days is far beyond any real wait; the bound only stops a
  // malformed pair spinning.
  for (let i = 0; i < 400 && dayStart < end; i++) {
    const [ny, nm, nd] = nextDate(y, m, d);
    const next = etMidnightUtc(ny, nm, nd);
    const wd = weekdayOf(y, m, d);
    if (wd !== 0 && wd !== 6) {
      const a = Math.max(dayStart, start);
      const b = Math.min(next, end);
      if (b > a) total += b - a;
    }
    [y, m, d] = [ny, nm, nd];
    dayStart = next;
  }
  return total;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Grouping — which patient a number belongs to
 *
 * `comms_links` first (a rep said so), then `patient_directory` (the daily
 * copy, furthest-along board wins, CLAUDE.md §5.29), then the live-lookup cache
 * (a patient created today, whom the directory has not seen yet). Otherwise the
 * number is its own, unmatched item.
 * ──────────────────────────────────────────────────────────────────────────── */

const sameName = (a, b) => oneLine(a).toLowerCase() === oneLine(b).toLowerCase() && !!oneLine(a);

/**
 * The patient a number belongs to, or null.
 *
 * ⚠️⚠️ A LINK FOLLOWS THE PATIENT, NOT THE ITEM IT WAS MADE AGAINST. A rep links
 * an unknown number to a patient's Welcome Call item; a week later the patient
 * is on Subscription and every one of their own numbers now resolves to the
 * Subscription item. A link pinned to the Welcome Call item would split them
 * into two inbox items for ever. So a link also stores the patient's own
 * primary number (`anchorHmac`), and resolves through the directory's CURRENT
 * answer for it — but only while that answer still carries the same name. A
 * number shared by a household resolves to one of the two people (§5.28), and
 * following it to the other one would file this number under the wrong patient;
 * the stored item is the safer answer then.
 *
 * @param {string} hmac
 * @param {{links: Map, directory: Map, cache: Map}} ctx
 */
export function resolveTarget(hmac, { links, directory, cache } = {}) {
  const link = links?.get(hmac);
  if (link) {
    if (link.anchorHmac && link.anchorHmac !== hmac) {
      const via = bestRow(directory?.get(link.anchorHmac), cache?.get(link.anchorHmac));
      if (via && sameName(via.row.name, link.name)) return { ...via.row, via: "link" };
    }
    if (link.boardId && link.itemId) {
      return {
        boardId: Number(link.boardId),
        itemId: String(link.itemId),
        name: link.name || "",
        groupId: null,
        boardName: link.boardName || "",
        via: "link",
      };
    }
  }
  const best = bestRow(directory?.get(hmac), cache?.get(hmac));
  return best ? { ...best.row, via: best.via } : null;
}

/**
 * Directory answer vs live-lookup cache answer for one number: the directory
 * wins — EXCEPT when its row is an inactive Subscription record and the cache
 * holds an active one. Active always trumps inactive (Josh, 2026-09-25):
 * the directory's copy is nightly, so between reconciles the stage refresh
 * re-resolves a number whose record went inactive and parks the live answer in
 * the cache — this is what lets that answer be seen.
 */
function bestRow(d, c) {
  const dv = d && d.itemId ? d : null;
  const cv = c && c.itemId ? c : null;
  if (dv && cv && isInactiveRow(dv) && !isInactiveRow(cv)) return { row: cv, via: "live" };
  if (dv) return { row: dv, via: "directory" };
  if (cv) return { row: cv, via: "live" };
  return null;
}

/** An item's key: the patient's record, or the bare number when unmatched.
 *  Opaque to the browser, in the `/calls/prefs` `allow[].id` precedent — it
 *  names an HMAC or a Monday item, never a phone number. */
export function groupKeyFor(hmac, target) {
  return target && target.itemId ? `p:${Number(target.boardId)}:${String(target.itemId)}` : `n:${hmac}`;
}

export function parseKey(key) {
  const s = String(key ?? "");
  let m = /^p:(\d+):(\d+)$/.exec(s);
  if (m) return { type: "p", boardId: Number(m[1]), itemId: m[2] };
  m = /^n:([0-9a-f]{64})$/.exec(s);
  if (m) return { type: "n", hmac: m[1] };
  return null;
}

/** Subscription's "Not Active Patients" group — declared beside the directory
 *  collapse that also reads it, so the pill and the resolution agree about
 *  what "inactive" means. Re-exported for this module's existing readers. */
export { SUBSCRIPTION_INACTIVE_GROUP, isInactiveRow } from "./patientDirectoryRules.mjs";
import { SUBSCRIPTION_INACTIVE_GROUP, isInactiveRow } from "./patientDirectoryRules.mjs";

const BOARD_PILL = {
  18392794310: "Intake", // DTC Intake
  18406352652: "Intake", // Profile Send Off
  18406060017: "Medical Necessity", // the patient screen's name, not the mockup's
  18410601299: "Insurance",
  18410804557: "Welcome Call",
  18407459988: "Subscription",
  18413019028: "Claims", // Secondary Claims — only ever the pick when nothing later is
};

/**
 * The stage pill: the four onboarding stages, Subscription, Inactive, or
 * Unmatched. The BOARD comes from the directory's copy (up to a day stale —
 * the profile pane always shows the truth); the GROUP behind Inactive is kept
 * live by the stage refresh (`stageRefreshPlan`/`applyStageFresh` below +
 * `lookupItemGroupsLive`), because a patient moved out of "Not Active
 * Patients" reading Inactive for a day confused people (Josh, 2026-09-25).
 */
export function stagePill(target) {
  if (!target || !target.itemId) return "Unmatched";
  const board = Number(target.boardId);
  if (board === 18407459988 && target.groupId === SUBSCRIPTION_INACTIVE_GROUP) return "Inactive";
  return BOARD_PILL[board] ?? "Unmatched";
}

/**
 * Every value `stagePill` can return, in pipeline order. Derived from
 * BOARD_PILL, so a board added there is offered without a second list to
 * remember. `filterInbox` accepts exactly these.
 * ⚠️ The SPA's filter MENU offers these MINUS "Claims" (Josh, 2026-09-25 —
 * Secondary Claims is only ever the pick when a patient has no later record,
 * and a menu entry for it confused more than it filtered). The row pill keeps
 * the value; `stageFilter.test.ts` holds the menu to this list minus Claims.
 */
export const STAGE_PILLS = Object.freeze([...new Set(Object.values(BOARD_PILL)), "Inactive", "Unmatched"]);

/* ────────────────────────────────────────────────────────────────────────────
 * The stage-pill refresh — the pill must be up to date (Josh, 2026-09-25)
 *
 * The pill's group comes from `patient_directory`, refreshed nightly, so a
 * group change (Active ↔ Not Active) read wrong for up to a day. These plan a
 * bounded live re-read of the GROUP of the items behind inbox rows — one
 * `items (ids:)` query, open items first — and overlay the answer on the
 * resolved targets before the pill is computed. The cache is in-memory in
 * commsInbox.mjs (like `snap`): a redeploy re-asks once, and nothing here
 * writes `patient_directory` (one writer per table, this file's own rule).
 * ──────────────────────────────────────────────────────────────────────────── */

/** How long a freshly-read group is trusted — the pill's staleness bound. */
export const STAGE_FRESH_TTL_MS = 2 * 60_000;
/** Monday's cap on `items (ids:)`, and plenty: open items are typically dozens. */
export const STAGE_REFRESH_CAP = 100;

const stageKeyOf = (boardId, itemId) => `${Number(boardId)}:${String(itemId)}`;

/**
 * Which (board, item) pairs the refresh should ask Monday about: every matched
 * row's item, deduplicated, OPEN rows first (they are what the list shows and
 * what a stale pill confuses on), skipping pairs the cache answered inside the
 * TTL, capped. Takes anything shaped like a row (`boardId`/`itemId`/`open`).
 */
export function stageRefreshPlan(rows, cache, now = Date.now(), { ttl = STAGE_FRESH_TTL_MS, cap = STAGE_REFRESH_CAP } = {}) {
  const seen = new Set();
  const out = [];
  const ordered = [...(rows ?? [])].sort((a, b) => Number(!!b?.open) - Number(!!a?.open));
  for (const r of ordered) {
    if (!r?.itemId || !r?.boardId) continue;
    const key = stageKeyOf(r.boardId, r.itemId);
    if (seen.has(key)) continue;
    seen.add(key);
    const c = cache?.get(key);
    if (c && now - c.at < ttl) continue;
    out.push({ boardId: Number(r.boardId), itemId: String(r.itemId) });
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * The freshly-read group for one resolved target, or undefined when the cache
 * has no answer for it — including the "asked, item missing" entry (groupId
 * undefined), which keeps the target's own group: absence is not evidence.
 */
export function stageFreshGroup(target, cache) {
  if (!target?.itemId || !cache) return undefined;
  const c = cache.get(stageKeyOf(target.boardId, target.itemId));
  return c && c.groupId !== undefined ? c.groupId : undefined;
}

/**
 * Overlay the refresh's groups onto the resolved targets. Returns the SAME map
 * when nothing changes, so a caller can skip a rebuild it doesn't need.
 */
export function applyStageFresh(targets, cache) {
  let changed = false;
  const out = new Map();
  for (const [hmac, t] of targets ?? new Map()) {
    const g = stageFreshGroup(t, cache);
    if (g !== undefined && g !== (t?.groupId ?? null)) {
      out.set(hmac, { ...t, groupId: g });
      changed = true;
    } else {
      out.set(hmac, t);
    }
  }
  return changed ? out : targets;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Who dialed · who texted
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Who pressed Call for this outbound call, or "".
 *
 * The line is ONE shared RingCentral extension (§5.13b), so the call log cannot
 * say who dialed. The Command Center's Call button records it instead
 * (`POST /comms/dialed`), and this matches that record to the call: same
 * number, nearest in time. A call dialed from the RingCentral app has no dial
 * and stays unattributed — honestly.
 */
export function dialerFor(call, dials) {
  if (!call || call.dir !== "out" || !call.hmac) return "";
  let best = "";
  let bestGap = Infinity;
  for (const d of dials ?? []) {
    if (d.hmac !== call.hmac) continue;
    const delta = toMs(d.at) - call.at; // negative: pressed before RC logged the start
    if (delta < -DIAL_BEFORE_MS || delta > DIAL_AFTER_MS) continue;
    const gap = Math.abs(delta);
    if (gap < bestGap) {
      best = d.by;
      bestGap = gap;
    }
  }
  return best;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Left voicemail → the call it was left on
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The outbound call a "Left voicemail" press refers to, or null.
 *
 * Calls are recorded in both directions (§5.16), so the message the rep left is
 * inside that call's recording. The link is the newest outbound call to the
 * patient's numbers that ENDED no more than 15 minutes before the press.
 *
 * ⚠️ Worked out when the timeline is read, never stored: a call that reaches the
 * archive a minute after the press still links. And it fails CLOSED — no such
 * call, no Listen — because linking the wrong call would play the rep a
 * different conversation (§5.28's rule for a call opening its voicemail).
 */
export function leftVmCallFor(attempt, calls) {
  const pressed = toMs(attempt?.resolvedAt);
  if (!Number.isFinite(pressed)) return null;
  let best = null;
  let bestEnd = -Infinity;
  for (const c of calls ?? []) {
    if (c.kind !== "call" || c.dir !== "out") continue;
    const end = c.at + (Number(c.durationSec) || 0) * 1000;
    if (end > pressed + LEFT_VM_SKEW_MS) continue;
    if (pressed - end > LEFT_VM_LINK_MS) continue;
    if (end > bestEnd) {
      best = c;
      bestEnd = end;
    }
  }
  return best;
}

/* ────────────────────────────────────────────────────────────────────────────
 * One item's state
 * ──────────────────────────────────────────────────────────────────────────── */

/** Distinct resolutions (one click = one resolutionId = one row per number). */
function distinctResolutions(rows) {
  const seen = new Map();
  for (const r of rows) {
    const prev = seen.get(r.resolutionId);
    if (!prev || r.resolvedAt > prev.resolvedAt) seen.set(r.resolutionId, r);
  }
  return [...seen.values()].sort((a, b) => a.resolvedAt - b.resolvedAt);
}

const publicResolution = (r) =>
  r
    ? {
        resolutionId: r.resolutionId,
        how: r.how,
        label: HOW_LABEL[r.how] || r.how,
        by: r.resolvedBy,
        at: r.resolvedAt,
        note: r.note || "",
        coversThrough: r.coversThrough,
        mirrored: !!r.mirroredTo,
      }
    : null;

/**
 * Open / waiting / suggestion / attempts for ONE item.
 *
 * @param {{events: object[], resolutions: object[], now: number, epoch?: number}} input
 *   `events` and `resolutions` are those of the item's numbers only.
 *
 * ⚠️⚠️ OPEN IS "an inbound event newer than what the rep SAW", NOT "newer than
 * the resolution". Every resolution stores `coversThrough` — the newest inbound
 * message the rep was shown — and anything newer reopens the item. The mockup
 * compared the resolution's TIME instead, so a text that landed while the rep
 * was typing the Called note was swallowed: resolved, never seen.
 *
 * ⚠️ `epoch` is the day the inbox started counting. Everything the archives
 * held before it would otherwise be "unresolved" at launch — every patient who
 * ever texted us — so events older than the epoch are history, shown in the
 * timeline and never opening anything.
 */
export function itemState({ events = [], resolutions = [], now = Date.now(), epoch = 0 } = {}) {
  const live = resolutions.filter((r) => !r.undoneAt);
  const resolving = live.filter((r) => RESOLVING_HOWS.includes(r.how));
  const cover = new Map();
  for (const r of resolving) {
    if (!Number.isFinite(r.coversThrough)) continue;
    cover.set(r.hmac, Math.max(cover.get(r.hmac) ?? -Infinity, r.coversThrough));
  }
  const coverOf = (hmac) => cover.get(hmac) ?? -Infinity;
  const covered = (e) => e.at < epoch || e.at <= coverOf(e.hmac);

  const inbound = events.filter(opensItem).sort(byAt);
  // The same join the timeline draws (buildTimeline), over every inbound call,
  // so the list's type chip and the timeline can never disagree about which
  // missed call was really a voicemail.
  const joined = joinInbound(events);
  const openEvents = inbound.filter((e) => !covered(e));
  const open = openEvents.length > 0;
  const openedBy = open ? openEvents[0] : null;

  const lastInbound = inbound.length ? inbound[inbound.length - 1] : null;
  const resolvedList = distinctResolutions(resolving);
  const lastRes = resolvedList.length ? resolvedList[resolvedList.length - 1] : null;

  // Suggestion: the newest QUALIFYING outbound event since the item opened.
  const attemptsAll = distinctResolutions(live.filter((r) => r.how === "left_vm"));
  const outCalls = events.filter((e) => e.kind === "call" && e.dir === "out");
  const linkedCallIds = new Set(
    attemptsAll.map((a) => leftVmCallFor(a, outCalls)?.id).filter(Boolean).map(String),
  );
  let suggestion = null;
  if (open) {
    const candidates = events
      .filter((e) => e.dir === "out" && e.at > openedBy.at)
      .filter(
        (e) =>
          // ⚠️ Only a CONNECTED callback suggests Called: Called asks "what did
          // you talk about?", and highlighting it after an unanswered call
          // invites resolving an item nobody spoke about. A call a Left
          // voicemail press links to never suggests it either — to the phone
          // network a voicemail box answers the call, so it can read connected.
          (e.kind === "call" && callConnected(e) && !linkedCallIds.has(String(e.id))) ||
          // ⚠️ Only a text a PERSON sent here. The Railway automations text
          // from the same line; without this a patient asking "when does my
          // order ship?" would get "Texted 9:00 AM — Confirm" off a robot's
          // reorder link.
          // ⚠️ And never one RingCentral gave up on. An accepted text is not a
          // delivered one (CLAUDE.md §5.5): a text to a landline flips to
          // SendingFailed seconds later, and "Texted — Confirm" would resolve
          // the item on a message the patient never got. The capture tick
          // re-reads the last two hours every minute, so the late verdict
          // reaches this row within about a minute of RingCentral's.
          (e.kind === "text" && !!e.sentBy && !textFailed(e.status)),
      )
      .sort(byAt);
    const s = candidates[candidates.length - 1];
    if (s) {
      suggestion = {
        how: s.kind === "call" ? "called" : "texted",
        at: s.at,
        by: s.kind === "call" ? s.dialedBy || "" : s.sentBy || "",
      };
    }
  }

  const attempts = open
    ? attemptsAll
        .filter((a) => a.resolvedAt > openedBy.at)
        .map((a) => ({ resolutionId: a.resolutionId, by: a.resolvedBy, at: a.resolvedAt }))
    : [];

  // Where the latest resolved period began — so the row a rep just resolved
  // keeps its place in "Longest waiting" until they open another item.
  let lastPeriodStart = null;
  if (lastRes) {
    const prevCover = resolvedList
      .filter((r) => r.resolutionId !== lastRes.resolutionId && r.resolvedAt <= lastRes.resolvedAt)
      .reduce((mx, r) => Math.max(mx, r.coversThrough), -Infinity);
    const first = inbound.find((e) => e.at >= epoch && e.at > prevCover && e.at <= lastRes.coversThrough);
    lastPeriodStart = first ? first.at : null;
  }

  const waitMs = open ? countedWaitMs(openedBy.at, now) : 0;
  const lastAt = Math.max(
    lastInbound ? lastInbound.at : -Infinity,
    lastRes ? lastRes.resolvedAt : -Infinity,
    suggestion ? suggestion.at : -Infinity,
  );

  return {
    open,
    openedBy: openedBy ? { at: openedBy.at, kind: displayKind(openedBy, joined) } : null,
    openCount: openEvents.length,
    waitMs,
    over: open && waitMs > OVER_AFTER_MS,
    reopened: open && !!lastRes,
    lastInbound: lastInbound
      ? { at: lastInbound.at, kind: displayKind(lastInbound, joined), preview: previewOf(lastInbound, joined) }
      : null,
    previewKind: lastInbound ? displayKind(lastInbound, joined) : "",
    preview: lastInbound ? previewOf(lastInbound, joined) : "",
    lastResolution: publicResolution(lastRes),
    suggestion,
    attempts,
    stickyWaitMs: lastPeriodStart === null ? 0 : countedWaitMs(lastPeriodStart, now),
    lastAt: Number.isFinite(lastAt) ? lastAt : 0,
    // Internal: what a resolve would cover. Never serialised as-is.
    _openEvents: openEvents,
    _cover: cover,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * The whole inbox
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Group events and resolutions into items and compute each one's state.
 *
 * @param {{events: object[], resolutions: object[], targets: Map<string, object|null>,
 *          now: number, epoch?: number, windowMs?: number}} input
 */
export function buildInbox({ events = [], resolutions = [], targets = new Map(), now = Date.now(), epoch = 0, windowMs = DISPLAY_WINDOW_MS } = {}) {
  const groups = new Map();
  const groupOf = (hmac) => {
    const target = targets.get(hmac) ?? null;
    const key = groupKeyFor(hmac, target);
    let g = groups.get(key);
    if (!g) {
      g = { key, target, numbers: new Map(), events: [], resolutions: [] };
      groups.set(key, g);
    }
    if (!g.numbers.has(hmac)) g.numbers.set(hmac, "");
    return g;
  };
  for (const e of events) {
    if (!e?.hmac) continue;
    const g = groupOf(e.hmac);
    g.events.push(e);
    if (e.last4 && !g.numbers.get(e.hmac)) g.numbers.set(e.hmac, e.last4);
  }
  for (const r of resolutions) {
    if (!r?.hmac) continue;
    groupOf(r.hmac).resolutions.push(r);
  }

  const items = [];
  for (const g of groups.values()) {
    const hasInbound = g.events.some(opensItem);
    const hasResolution = g.resolutions.some((r) => !r.undoneAt && RESOLVING_HOWS.includes(r.how));
    if (!hasInbound && !hasResolution) continue; // outbound-only traffic is not a conversation to handle
    const st = itemState({ events: g.events, resolutions: g.resolutions, now, epoch });
    if (!st.open && st.lastAt < now - windowMs) continue;
    items.push(publicItem(g, st));
  }
  return items;
}

/** The wire shape of a list row. */
export function publicItem(g, st) {
  return {
    key: g.key,
    name: g.target?.name || "",
    stage: stagePill(g.target),
    boardId: g.target?.itemId ? Number(g.target.boardId) : null,
    itemId: g.target?.itemId ? String(g.target.itemId) : null,
    numbers: [...g.numbers.entries()].map(([hmac, last4]) => ({ hmac, last4 })),
    open: st.open,
    openedBy: st.openedBy,
    waitMs: st.waitMs,
    over: st.over,
    reopened: st.reopened,
    previewKind: st.previewKind,
    preview: st.preview,
    lastInbound: st.lastInbound,
    lastResolution: st.lastResolution,
    suggestion: st.suggestion,
    attempts: st.attempts,
    stickyWaitMs: st.stickyWaitMs,
    lastAt: st.lastAt,
  };
}

/**
 * The list a rep sees: a view, a type chip, a search and a sort.
 *
 * ⚠️ The counts are taken BEFORE the search and the row cap, so the tab
 * numbers and the header badge describe the same set whatever is on screen.
 */
export function filterInbox(
  items,
  { view = "open", type = "", stage = "", q = "", qHmac = "", sort = "wait", sticky = "", limit = LIST_LIMIT } = {},
) {
  const kinds = ["text", "missed", "voicemail"];
  const byKind = kinds.includes(type) ? items.filter((i) => i.previewKind === type) : items;
  // The stage filter narrows like a type chip, so the tab counts describe what
  // the rep is looking at ("Unresolved 3" = three in Insurance). An unknown
  // value is ignored rather than matching nothing: a list that goes blank on a
  // value this build does not know reads as "nobody is waiting".
  const typed = STAGE_PILLS.includes(stage) ? byKind.filter((i) => i.stage === stage) : byKind;
  const counts = {
    open: typed.filter((i) => i.open).length,
    over: typed.filter((i) => i.open && i.over).length,
  };
  const v = view === "all" || view === "over" ? view : "open";
  let rows = typed.filter(
    (i) => v === "all" || i.key === sticky || (v === "over" ? i.open && i.over : i.open),
  );

  const text = oneLine(q).toLowerCase();
  if (text) {
    const digits = text.replace(/\D/g, "");
    rows = rows.filter((i) => {
      const allDigits = digits.length >= 4 && digits.length === text.replace(/[\s()+.-]/g, "").length;
      // A whole number is matched by its HMAC and nothing else: a last-four
      // fallback would hand back a different person who happens to share them.
      if (allDigits && digits.length >= 10) return !!qHmac && i.numbers.some((n) => n.hmac === qHmac);
      // Fewer digits than a number: a last-four hint, which is all the list holds.
      if (allDigits) return i.numbers.some((n) => n.last4 && n.last4 === digits.slice(-4));
      return (i.name || "unknown caller").toLowerCase().includes(text);
    });
  }

  const s = sort === "recent" ? "recent" : "wait";
  const rank = (i) => {
    if (i.open) return [1, i.waitMs];
    if (i.key === sticky) return [1, i.stickyWaitMs];
    return [0, 0];
  };
  rows.sort((a, b) => {
    if (s === "recent") return b.lastAt - a.lastAt;
    const x = rank(a);
    const y = rank(b);
    return y[0] - x[0] || y[1] - x[1] || b.lastAt - a.lastAt;
  });
  return { rows: rows.slice(0, Math.max(1, limit)), counts, total: rows.length };
}

/** The header badge: unresolved items, and how many are over 24 counted hours. */
export function badgeCounts(items) {
  return {
    open: items.filter((i) => i.open).length,
    over: items.filter((i) => i.open && i.over).length,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Resolving, undoing, notes, the Monday copy
 * ──────────────────────────────────────────────────────────────────────────── */

/** Trimmed, single-line, capped (plan §5.9). "" when there is nothing. */
export function normalizeNote(note) {
  return oneLine(note).slice(0, NOTE_MAX);
}

/**
 * May this click be written, and what does it cover?
 *
 * @param {{how: string, note?: string, seenThrough?: string|number, now: number,
 *          state: ReturnType<typeof itemState>}} input
 * @returns {{ok: true, coversThrough: number, note: string|null}
 *         | {ok: false, status: 400|409, error: string, conflict?: object}}
 *
 * ⚠️⚠️ A COMPARE-AND-SET ON THE OPEN PERIOD. A resolution is accepted only if
 * it covers something still open: an uncovered inbound event no newer than
 * what the rep saw. Two reps on one item is an ordinary afternoon — the second
 * gets a 409 naming who resolved it and when, instead of writing a second
 * resolution nobody asked for. The route holds a per-number advisory lock
 * around this, so the check and the write cannot interleave.
 */
export function planResolve({ how, note, seenThrough, now = Date.now(), state } = {}) {
  if (!HOWS.includes(how)) return { ok: false, status: 400, error: "Unknown way of resolving" };
  const clean = normalizeNote(note);
  if (how === "called" && !clean) {
    return { ok: false, status: 400, error: "Called needs a note — what did you talk about?" };
  }
  const conflict = () => ({
    ok: false,
    status: 409,
    error: state?.lastResolution
      ? `Already resolved by ${state.lastResolution.by}`
      : "There is nothing open on this item",
    conflict: state?.lastResolution ?? null,
  });
  if (!state?.open) return conflict();

  if (how === "left_vm") {
    // An attempt: it covers nothing and keeps the clock running.
    return { ok: true, coversThrough: now, note: null };
  }

  const seen = toMs(seenThrough);
  if (!Number.isFinite(seen)) return { ok: false, status: 400, error: "seenThrough is required" };
  // Never beyond now: a far-future cover would swallow every message to come.
  const coversThrough = Math.min(seen, now);
  const coverable = (state._openEvents ?? []).filter((e) => e.at <= coversThrough);
  if (!coverable.length) return conflict();
  return { ok: true, coversThrough, note: clean || null };
}

/**
 * May `actor` undo this resolution? `rows` are all rows sharing its id.
 */
export function canUndo({ rows = [], actor = "", now = Date.now() } = {}) {
  if (!rows.length) return { ok: false, status: 404, error: "No such resolution" };
  const r = rows[0];
  if (norm(r.resolvedBy) !== norm(actor)) {
    return { ok: false, status: 403, error: `Only ${r.resolvedBy} can undo this` };
  }
  if (rows.some((x) => x.undoneAt)) return { ok: false, status: 409, error: "Already undone" };
  if (now - r.resolvedAt > UNDO_WINDOW_MS) {
    return { ok: false, status: 409, error: "Too late to undo — it's been more than 15 minutes" };
  }
  // ⚠️ Never once the note is on Monday — or might be. A claim in flight means
  // a browser may be writing it right now, and Monday has no compare-and-set to
  // take a line back. A Communications line on Monday must always mean a
  // resolution that stands.
  if (rows.some((x) => x.mirroredTo || x.mirrorClaimedAt)) {
    return { ok: false, status: 409, error: "The note has already been copied to Monday" };
  }
  return { ok: true };
}

/**
 * May `actor` add the optional note to a Texted / No action needed resolution?
 * Offered once, right after resolving; append-only, like every note path.
 */
export function canAddNote({ rows = [], actor = "", now = Date.now(), note = "" } = {}) {
  const base = canUndo({ rows, actor, now });
  if (!base.ok && base.status !== 409) return base;
  const r = rows[0];
  if (!r) return { ok: false, status: 404, error: "No such resolution" };
  if (!["texted", "no_action"].includes(r.how)) {
    return { ok: false, status: 400, error: "Only a Texted or No action needed resolution takes a note afterwards" };
  }
  if (rows.some((x) => x.undoneAt)) return { ok: false, status: 409, error: "That resolution was undone" };
  if (rows.some((x) => x.note)) return { ok: false, status: 409, error: "This resolution already has a note" };
  if (now - r.resolvedAt > UNDO_WINDOW_MS) return { ok: false, status: 409, error: "Too late to add a note here" };
  if (rows.some((x) => x.mirroredTo || x.mirrorClaimedAt)) {
    return { ok: false, status: 409, error: "Already copied to Monday" };
  }
  if (!normalizeNote(note)) return { ok: false, status: 400, error: "The note is empty" };
  return { ok: true };
}

/**
 * Where a resolution's note is copied to Monday (plan §5.2): the patient record
 * stored on the resolution as `item_board` / `item_id`.
 *
 * Normally the item's own patient — the record the number files under. On a
 * number two patients SHARE, though, that is one of them by a deterministic
 * tie-break (§5.29's `collapseRows`), and the rep may have been looking at the
 * other: the hub's household switcher, or the other patient's own screen. The
 * note is about the person the rep was looking at, so the browser can name them
 * (2026-09-23 review) and the copy goes there.
 *
 * ⚠️ Only for an item that IS a patient's. An unmatched number's note is never
 * copied (plan §5.2), and a request naming somebody for one must not start
 * copying it — that would write a note about a stranger's number onto a record
 * nobody linked it to.
 * ⚠️ Ids are checked for SHAPE only: they are Monday ids, and the browser's copy
 * step reads the record back by id before writing anything — a record that is
 * not there is recorded as "no live record" rather than written.
 */
export function noteTargetFor(target, requested) {
  if (!target || !target.itemId) return null;
  const own = { boardId: Number(target.boardId), itemId: String(target.itemId) };
  const b = String(requested?.boardId ?? "").trim();
  const i = String(requested?.itemId ?? "").trim();
  if (!/^[1-9]\d{0,19}$/.test(b) || !/^[1-9]\d{0,19}$/.test(i)) return own;
  return { boardId: Number(b), itemId: i };
}

/**
 * Is this resolution waiting to be copied to Monday by `actor`'s browser?
 *
 * ⚠️ Only the RESOLVER's browser copies: `appendNoteToRecord` stamps the
 * signed-in person's initials, so a copy from somebody else's browser would
 * sign the note with the wrong name (plan §5.3). The route's SQL implements
 * this same predicate; this is what it is tested against.
 */
export function mirrorPending(r, actor, now = Date.now()) {
  if (!r || r.undoneAt) return false;
  if (norm(r.resolvedBy) !== norm(actor)) return false;
  if (!RESOLVING_HOWS.includes(r.how)) return false;
  if (!r.note || !r.itemId) return false;
  if (r.mirroredTo) return false;
  if (r.mirrorAttempts >= MAX_MIRROR_ATTEMPTS) return false;
  if (r.mirrorClaimedAt && now - r.mirrorClaimedAt <= STALE_CLAIM_MS) return false;
  return true;
}

/* ────────────────────────────────────────────────────────────────────────────
 * One item's timeline
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Texts as bubbles, calls and voicemails as rows, resolutions as quiet
 * dividers, Left voicemail as an attempt row — one list, oldest first.
 *
 * Every event says which number it came in on (`last4`), because a patient
 * with two numbers is one item.
 */
export function buildTimeline({ events = [], resolutions = [] } = {}) {
  const joined = joinInbound(events);
  const joinedVmIds = new Set([...joined.values()].map((v) => String(v.id)));
  const outCalls = events.filter((e) => e.kind === "call" && e.dir === "out");
  const out = [];

  for (const e of events) {
    if (!Number.isFinite(e.at)) continue;
    if (e.kind === "text") {
      out.push({
        type: "text",
        id: e.id,
        dir: e.dir,
        at: e.at,
        last4: e.last4,
        body: e.body,
        status: e.status,
        deliveryError: e.deliveryError,
        attachments: e.attachments,
        sentBy: e.sentBy,
      });
    } else if (e.kind === "call") {
      const connected = callConnected(e);
      const vm = joined.get(String(e.id)) ?? null;
      out.push({
        type: "call",
        id: e.id,
        dir: e.dir,
        at: e.at,
        last4: e.last4,
        durationSec: e.durationSec,
        result: e.result,
        connected,
        missed: e.dir === "in" && !connected && !isBlockedCall(e),
        blocked: isBlockedCall(e),
        // An inbound call answered in the browser, which RingCentral logged as
        // Outbound (markBrowserPickups) — the wording and the icon flip on it.
        pickedUp: !!e.pickedUp,
        audioState: e.audioState,
        dialedBy: e.dialedBy,
        voicemail: vm
          ? { id: vm.id, at: vm.at, durationSec: vm.durationSec, transcript: vm.transcript, audioState: vm.audioState }
          : null,
      });
    } else if (e.kind === "voicemail") {
      if (joinedVmIds.has(String(e.id))) continue; // shown on the call it was left on
      out.push({
        type: "voicemail",
        id: e.id,
        dir: e.dir,
        at: e.at,
        last4: e.last4,
        durationSec: e.durationSec,
        transcript: e.transcript,
        audioState: e.audioState,
      });
    }
  }

  const live = resolutions.filter((r) => !r.undoneAt);
  for (const r of distinctResolutions(live)) {
    if (r.how === "left_vm") {
      const call = leftVmCallFor(r, outCalls);
      out.push({
        type: "attempt",
        resolutionId: r.resolutionId,
        how: "left_vm",
        label: HOW_LABEL.left_vm,
        by: r.resolvedBy,
        at: r.resolvedAt,
        linkedCallId: call ? call.id : null,
        linkedCallAudio: call ? call.audioState : null,
      });
    } else {
      out.push({ type: "resolution", ...publicResolution(r) });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/* ────────────────────────────────────────────────────────────────────────────
 * The SLA card (Reports & Metrics)
 * ──────────────────────────────────────────────────────────────────────────── */

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/**
 * Resolution times over a window: from the first inbound message of the period
 * each resolution closed, to the resolution — in COUNTED time, the same clock
 * as the list.
 *
 * @param {{resolutions: object[], events: object[], since: number, now: number, epoch?: number,
 *          open: number, over: number}} input
 *   `events` must reach back far enough to hold each resolved period's first
 *   message; the route reads opening events from well before `since`.
 */
export function slaReport({ resolutions = [], events = [], since = 0, now = Date.now(), epoch = 0, open = 0, over = 0 } = {}) {
  const live = resolutions.filter((r) => !r.undoneAt);
  const resolvingRows = live.filter((r) => RESOLVING_HOWS.includes(r.how));
  const byNumber = new Map();
  for (const r of resolvingRows) {
    if (!byNumber.has(r.hmac)) byNumber.set(r.hmac, []);
    byNumber.get(r.hmac).push(r);
  }
  for (const list of byNumber.values()) list.sort((a, b) => a.resolvedAt - b.resolvedAt);
  const inbound = events.filter(opensItem).sort(byAt);

  const rows = [];
  for (const r of distinctResolutions(resolvingRows)) {
    if (r.resolvedAt < since) continue;
    // Across every number this click covered: the first message after that
    // number's PREVIOUS cover and no newer than this one.
    const numbers = resolvingRows.filter((x) => x.resolutionId === r.resolutionId).map((x) => x.hmac);
    let first = Infinity;
    for (const h of numbers) {
      const prev = (byNumber.get(h) ?? [])
        .filter((x) => x.resolutionId !== r.resolutionId && x.resolvedAt < r.resolvedAt)
        .reduce((mx, x) => Math.max(mx, x.coversThrough), -Infinity);
      const e = inbound.find((x) => x.hmac === h && x.at >= epoch && x.at > prev && x.at <= r.coversThrough);
      if (e && e.at < first) first = e.at;
    }
    if (!Number.isFinite(first)) continue;
    rows.push({ who: r.resolvedBy, how: r.how, ms: countedWaitMs(first, r.resolvedAt) });
  }

  const attempts = distinctResolutions(live.filter((r) => r.how === "left_vm" && r.resolvedAt >= since));
  const within = rows.filter((r) => r.ms <= OVER_AFTER_MS).length;
  const byHow = {};
  for (const r of rows) byHow[r.how] = (byHow[r.how] || 0) + 1;

  const reps = new Map();
  const rep = (who) => {
    if (!reps.has(who)) reps.set(who, { who, resolved: 0, within: 0, times: [], hows: new Set(), attempts: 0 });
    return reps.get(who);
  };
  for (const r of rows) {
    const x = rep(r.who);
    x.resolved += 1;
    if (r.ms <= OVER_AFTER_MS) x.within += 1;
    x.times.push(r.ms);
    x.hows.add(r.how);
  }
  for (const a of attempts) rep(a.resolvedBy).attempts += 1;

  return {
    since,
    now,
    open,
    over,
    resolved: rows.length,
    within,
    withinPct: rows.length ? Math.round((within / rows.length) * 100) : null,
    medianMs: median(rows.map((r) => r.ms)),
    byHow,
    attempts: attempts.length,
    reps: [...reps.values()]
      .map((x) => ({
        who: x.who,
        resolved: x.resolved,
        within: x.within,
        withinPct: x.resolved ? Math.round((x.within / x.resolved) * 100) : null,
        medianMs: median(x.times),
        hows: [...x.hows],
        attempts: x.attempts,
      }))
      .sort((a, b) => b.resolved - a.resolved || b.attempts - a.attempts || a.who.localeCompare(b.who)),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Phase 1's shadow measurement (plan §8)
 * ──────────────────────────────────────────────────────────────────────────── */

/** How far back an automated text still counts as what an inbound text is
 *  replying to. */
export const AUTOMATION_REPLY_WINDOW_MS = 7 * 24 * 3600_000;

/**
 * Is this inbound text a reply to an AUTOMATED text? — the newest outbound text
 * to the same number before it (inside a week) carried no sender.
 */
export function isReplyToAutomation(inbound, outboundTexts) {
  if (!inbound || inbound.kind !== "text" || inbound.dir !== "in") return false;
  let prev = null;
  for (const o of outboundTexts ?? []) {
    if (o.kind !== "text" || o.dir !== "out" || o.hmac !== inbound.hmac) continue;
    if (o.at >= inbound.at || inbound.at - o.at > AUTOMATION_REPLY_WINDOW_MS) continue;
    if (!prev || o.at > prev.at) prev = o;
  }
  return !!prev && !prev.sentBy;
}

/**
 * What the inbox WOULD have opened, per day, before anybody sees it: items per
 * day by kind, how many were unmatched numbers, how many were replies to our
 * own automated texts. Counts only — no number, name or body.
 */
export function shadowReport({ events = [], targets = new Map(), since = 0 } = {}) {
  const inbound = events.filter((e) => opensItem(e) && e.at >= since).sort(byAt);
  const outTexts = events.filter((e) => e.kind === "text" && e.dir === "out");
  const joined = joinInbound(events);
  const joinedVmIds = new Set([...joined.values()].map((v) => String(v.id)));
  const days = new Map();
  let unmatched = 0;
  let automation = 0;
  const numbers = new Set();
  for (const e of inbound) {
    if (e.kind === "voicemail" && joinedVmIds.has(String(e.id))) continue; // one event, not two
    const { y, m, d } = etParts(e.at);
    const day = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (!days.has(day)) days.set(day, { day, text: 0, missed: 0, voicemail: 0, total: 0 });
    const row = days.get(day);
    const kind = displayKind(e, joined);
    row[kind] += 1;
    row.total += 1;
    if (!targets.get(e.hmac)) unmatched += 1;
    if (isReplyToAutomation(e, outTexts)) automation += 1;
    numbers.add(e.hmac);
  }
  return {
    since,
    events: [...days.values()].reduce((n, d) => n + d.total, 0),
    numbers: numbers.size,
    unmatchedEvents: unmatched,
    repliesToAutomation: automation,
    perDay: [...days.values()],
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Health
 * ──────────────────────────────────────────────────────────────────────────── */

/** The capture tick runs every minute; this long without a COMPLETE one means
 *  the inbox is no longer seeing new messages within the minute. */
export const TICK_STALE_AFTER_MS = 10 * 60_000;

/** A note still waiting to be copied to Monday after this long is reported. */
export const MIRROR_WAIT_WARN_MS = 24 * 3600_000;

/**
 * Health verdict for GET /comms/inbox-health.
 *
 * ⚠️ Staleness is measured on the last COMPLETE tick — not shed by the
 * RingCentral budget and not clipped by the page ceiling. One shed tick is
 * routine (background is the tier shed first, by design); ten minutes of them
 * means new messages are no longer reaching the inbox within the minute, and a
 * tick that only ever runs half-way must not read healthy just because it ran.
 * Not ok, too, when no tick has EVER completed — a job deployed but never
 * working cannot report healthy on an empty table.
 *
 * Notes waiting on a Monday copy are REPORTED, not a fault: the note is safe in
 * the log either way. They surface here so notes from a rep who never came back
 * to Communications don't sit unnoticed.
 */
export function inboxHealth({
  lastCompleteAt,
  lastRunAt,
  lastError,
  lastTruncated,
  pendingMirrors = 0,
  oldestPendingMirrorAt = null,
  failedMirrors = 0,
  feedsOff = [],
  epoch = null,
  now = Date.now(),
} = {}) {
  const okAt = lastCompleteAt ? toMs(lastCompleteAt) : null;
  const ageMs = okAt === null ? null : now - okAt;
  const stale = okAt === null || ageMs > TICK_STALE_AFTER_MS;
  const truncated = !!lastTruncated;
  const off = [...new Set(feedsOff ?? [])];
  let reason = null;
  if (okAt === null) reason = "no complete capture tick recorded yet";
  else if (stale) reason = `the last complete capture tick was ${Math.round(ageMs / 60_000)} minutes ago`;
  else if (truncated) reason = "the last capture tick hit its page ceiling, so the two-hour window was only partly read";
  const oldest = oldestPendingMirrorAt ? toMs(oldestPendingMirrorAt) : null;
  const warnings = [];
  // ⚠️ An archive switched off is a deliberate act, and the tick honours it —
  // the inbox is then BLIND to that kind of event, which reads exactly like a
  // quiet day, so the health SAYS so. But it is a WARNING, not a fault: every
  // archive's own health treats "off on purpose" as quiet, and a page every
  // ten minutes about a switch somebody flipped on purpose is the kind that
  // teaches everybody to swipe these away (2026-09-23 review).
  if (off.length) warnings.push(`new ${off.join(" and ")} are not reaching the inbox — that archive is switched off`);
  if (oldest !== null && now - oldest > MIRROR_WAIT_WARN_MS) {
    warnings.push(`${pendingMirrors} note(s) waiting to be copied to Monday, the oldest ${Math.round((now - oldest) / 3600_000)}h`);
  }
  if (failedMirrors > 0) warnings.push(`${failedMirrors} note(s) could not be copied to Monday after ${MAX_MIRROR_ATTEMPTS} tries`);
  return {
    ok: !stale && !truncated,
    enabled: true,
    stale,
    truncated,
    feedsOff: off,
    reason,
    lastCompleteAt: okAt === null ? null : new Date(okAt).toISOString(),
    lastRunAt: lastRunAt ? new Date(toMs(lastRunAt)).toISOString() : null,
    lastError: lastError || null,
    ageMinutes: ageMs === null ? null : Math.round(ageMs / 60_000),
    pendingMirrors: Number(pendingMirrors) || 0,
    oldestPendingMirrorHours: oldest === null ? null : Math.round((now - oldest) / 3600_000),
    failedMirrors: Number(failedMirrors) || 0,
    epoch: epoch ? new Date(toMs(epoch)).toISOString() : null,
    warnings,
  };
}
