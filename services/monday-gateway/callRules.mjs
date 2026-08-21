/**
 * callRules.mjs — who gets rung, and which leg of a call we act on.
 *
 * Kept free of `pg` and `fetch` so it can be unit-tested directly, same split as
 * columns.mjs / phoneHash.mjs. Two responsibilities, both pure:
 *
 *   1. pickInboundParty() — read RingCentral's telephony-session payload and
 *      return the one party that represents "somebody is calling us, right now".
 *   2. shouldNotify()     — decide whether a given employee wants to see it.
 *
 * ── The model (Josh, 2026-08-05) ────────────────────────────────────────────
 * The Command Center is ONE instance. Every inbound call routes through the
 * shared line, every eligible employee can see it, and IT DOES NOT MATTER WHO
 * PICKS UP. So there is deliberately no routing, no ownership, and no
 * per-patient assignment here: a rule decides who gets *notified*, never who
 * the call belongs to. Anyone who sees a ringing call may take it.
 *
 * That is why the rules below are a display filter and nothing more. Narrowing
 * your own list can never make a call unanswerable by someone else — it only
 * quiets YOUR screen.
 */

/** Party statuses that mean "still ringing, not yet answered".
 *  RingCentral says `Proceeding` where a human would say "ringing"; `Setup` is
 *  the moment before. Those two are also exactly the window in which the
 *  Forward API works, so this list doubles as "can still be claimed". */
export const RINGING_STATES = ["Setup", "Proceeding"];

/** Statuses that end a call's life on screen. */
export const TERMINAL_STATES = ["Disconnected", "Gone", "VoiceMail", "VoiceMailScreening"];

export function isRinging(status) {
  return RINGING_STATES.includes(String(status || ""));
}

/**
 * The telephony payload inside RingCentral's webhook envelope.
 *
 * ⚠️ Deliveries are NOT the shape the docs' example shows. The published
 * example is the *inner* payload, while what actually arrives is
 * `AccountTelephonySessionsEvent`:
 *
 *   { uuid, event, timestamp, subscriptionId, ownerId, body: { telephonySessionId, parties } }
 *
 * Reading the top level therefore finds no `telephonySessionId` and drops every
 * event — with a 200 back to RingCentral and nothing in the logs, because a
 * webhook we can't parse looks identical to a webhook that wasn't sent. That is
 * exactly how this shipped and it cost a round of log forensics to see; the
 * event counters on /calls/health exist so the next person sees it immediately.
 *
 * Accepts an already-unwrapped payload too, so a replayed body still parses.
 */
export function unwrapEvent(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const body = payload.body;
  if (body && typeof body === "object" && !Array.isArray(body)) return body;
  return payload;
}

/**
 * The inbound, still-ringing party of a telephony session event — or null.
 *
 * `selfNumbers` are OUR OWN numbers — the caller ID the softphone presents on
 * every outbound call. See the fourth bullet: without them this returns our own
 * click-to-call legs and the whole office gets popped.
 *
 * ⚠️ Three things this has to get right, because each one silently produces a
 * feature that "works" while showing the wrong thing:
 *
 *  · Reps' OUTBOUND calls generate these events too. A party whose direction is
 *    Outbound is us calling a patient; ringing the whole office for it would
 *    make every click-to-call pop everyone's screen.
 *  · A session can carry several parties (IVR → queue → extension). We want the
 *    one that is inbound AND ringing; an already-Answered party is a call
 *    somebody is on, not an offer.
 *  · `from.phoneNumber` is the CALLER. Reading `to` instead would key the whole
 *    feature on our own main line and match every call to the same "patient".
 *  · ⚠️ **A party whose `from` is OUR OWN number is our own outbound call**
 *    (Josh, 2026-08-20 — reps were being popped by their own click-to-calls).
 *    The `direction` check above is necessary and NOT sufficient: the softphone
 *    dials as the shared extension presenting the MM main line as caller ID
 *    (`useWebPhone` → `wp.call(phone, mmPhoneNumber())`), and the session that
 *    produces carries a party RingCentral marks `Inbound` and ringing whose
 *    `from` is that same main line. It passed every test above, so every rep's
 *    screen lit up on every outbound call — and because the number was always
 *    ours, the browser matched it to whichever board row happens to carry the
 *    MM number, putting the SAME patient's name on every card. That is the
 *    "collapsing every caller onto one patient" failure this module's own
 *    header warns about, arriving through `from` rather than `to`.
 *    The check is safe in the one direction that matters: a patient can never
 *    ring us FROM our own line, so this can only ever drop our own calls.
 */
export function pickInboundParty(event, selfNumbers = []) {
  const parties = Array.isArray(event?.parties) ? event.parties : [];
  const mine = new Set(
    (Array.isArray(selfNumbers) ? selfNumbers : [selfNumbers])
      .map((n) => digitsOf(n))
      .filter(Boolean),
  );
  for (const p of parties) {
    if (String(p?.direction || "") !== "Inbound") continue;
    if (!isRinging(p?.status?.code)) continue;
    const from = String(p?.from?.phoneNumber || "");
    if (!from) continue;
    if (mine.has(digitsOf(from))) continue;
    return {
      partyId: String(p.id || ""),
      from,
      to: String(p?.to?.phoneNumber || ""),
      callerName: String(p?.from?.name || ""),
    };
  }
  return null;
}

/**
 * The state a session has moved to, for a call we are already showing.
 *
 * Returned separately from pickInboundParty because the interesting transition
 * is the one AWAY from ringing: a card left on screen after the caller hung up
 * is worse than no card at all, and RingCentral tells us via the same event
 * stream rather than a distinct "call over" message.
 */
export function sessionOutcome(event) {
  const parties = Array.isArray(event?.parties) ? event.parties : [];
  const inbound = parties.filter((p) => String(p?.direction || "") === "Inbound");
  if (!inbound.length) return null;
  if (inbound.some((p) => String(p?.status?.code || "") === "Answered")) return "answered";
  if (inbound.every((p) => TERMINAL_STATES.includes(String(p?.status?.code || "")))) {
    // A caller who reached voicemail was still missed by every human.
    return "ended";
  }
  return null;
}

/** Ring modes. `list` is "only what I chose"; `off` silences everything. */
export const RING_MODES = ["all", "list", "off"];

/**
 * Normalised preferences, with the defaults a brand-new employee gets.
 *
 * Defaults to `all` ON PURPOSE. The shared line is everyone's line, and a
 * default of `list` would mean a new hire's screen stays silent until they
 * discover a settings dialog they have no reason to look for.
 */
export function normalizePrefs(raw) {
  const mode = RING_MODES.includes(raw?.mode) ? raw.mode : "all";
  return { mode, forwardNumber: String(raw?.forwardNumber || "") };
}

/**
 * Does this employee want to be notified about this call?
 *
 * `facts.pinned` — the number is on this person's explicit allow list.
 *
 * ⚠️ Membership in `list` mode is EXPLICIT ONLY (Josh, 2026-08-05). An earlier
 * cut also rang for "anyone I've texted", inferred from sent_messages. It is
 * tempting because the data is already there and it costs no configuration —
 * and it is wrong: a rep who texts fifty patients a week would have quietly
 * rebuilt `all` under a name that promises the opposite, and the one person
 * most likely to choose `list` is exactly the person who texts the most.
 * Texting a patient must never enrol them in your ring list. The only way onto
 * the list is to put a number on it.
 */
export function shouldNotify(prefs, facts = {}) {
  const p = normalizePrefs(prefs);
  if (p.mode === "off") return false;
  if (p.mode === "all") return true;
  return !!facts.pinned;
}

/** Digits only, so a comparison survives the shape a number arrives in —
 *  `+13475037148`, `13475037148` and `(347) 503-7148` are one number. Kept
 *  local rather than importing phoneHash's `toE164`, which returns "" for
 *  anything it can't place and would make two unparseable numbers compare
 *  equal. */
function digitsOf(raw) {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

/** Last four digits, the only part of a number the allow list stores in the
 *  clear. Enough to recognise your own entry, useless as an identifier on its
 *  own — the full number is never written down (see inboundCalls.mjs). */
export function last4(raw) {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : "";
}

/* ── claiming ─────────────────────────────────────────────────────────────── */

/**
 * What a rep is told when RingCentral refuses to forward a ringing call.
 *
 * ⚠️ This sentence is the whole point. RingCentral's own refusal text is a
 * protocol string — the kind of thing a rep reports as "I received an error
 * code" (ticket MM-1090, 2026-08-20), which is exactly what happened: the card
 * was still on screen, the caller had hung up 0.7 seconds earlier, and the rep
 * was shown RingCentral's words for it. Nothing was broken and it read as a
 * system fault.
 *
 * The raw text is still kept — it goes to call_claims.detail, where an
 * engineer can read it months later (see /calls/history). The rep gets English.
 */
export const CLAIM_GONE_MESSAGE =
  "That call already ended — the caller hung up or somebody else picked it up.";

/**
 * Map RingCentral's forward-refusal onto what the browser should see.
 *
 * 404/409 from RingCentral both mean "that party is no longer forwardable",
 * i.e. the ordinary race the card cannot win: a ring is often only a few
 * seconds long, and the terminal webhook can land between the render and the
 * click. It is NOT a failure worth alarming anyone about, so it becomes 410,
 * which the UI already treats as "gone" (info toast, dismiss the card).
 *
 * ⚠️ Anything else stays 502 and keeps RingCentral's own words: a throttle, a
 * revoked CallControl permission and a dead upstream are all real faults, and
 * flattening them into the reassuring sentence above would hide an outage
 * behind "the caller hung up". The 502/410 split is the difference between
 * "nothing is wrong" and "something is", so it must never key on anything
 * softer than the upstream status.
 */
export function claimRefusal(rcStatus, rcMessage) {
  const gone = rcStatus === 404 || rcStatus === 409;
  const raw = String(rcMessage ?? "").trim();
  return {
    status: gone ? 410 : 502,
    error: gone ? CLAIM_GONE_MESSAGE : raw || `RingCentral refused the transfer (${rcStatus})`,
    // Verbatim upstream text for the audit row; null when RingCentral said
    // nothing, so a blank detail can't be mistaken for a message it did send.
    detail: raw || null,
  };
}
