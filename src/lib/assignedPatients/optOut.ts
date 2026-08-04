/**
 * SMS opt-out (TCPA / CTIA) for the Assigned Patients inbox.
 *
 * RingCentral auto-honors STOP/START only on High Volume SMS. Our sends go
 * through the plain /sms endpoint, so nothing upstream stops a rep texting
 * someone who has opted out — for a healthcare provider texting patients that
 * is real exposure, so the guard lives here and the composer blocks on it.
 *
 * Rules, deliberately strict:
 *  - Only an INBOUND message can opt a patient in or out. Nothing a rep types
 *    changes consent.
 *  - The keyword must be essentially the WHOLE message. "STOP" opts out;
 *    "please stop by the office tomorrow" does not. This is the CTIA
 *    convention and it is what keeps false positives near zero — a false
 *    positive silently blocks a rep from reaching a patient who never asked.
 *  - Latest wins: a patient who texts STOP and later START is opted back in.
 */

/** Whole-message keywords that revoke consent (CTIA standard set). */
export const OPT_OUT_KEYWORDS = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit"] as const;

/** Whole-message keywords that restore consent. */
export const OPT_IN_KEYWORDS = ["start", "unstop", "yes"] as const;

/** Strip case, punctuation and surrounding whitespace so "STOP." and " stop "
 *  both match, while "stop by" keeps its second word and does not. */
function normalize(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

export type ConsentSignal = "optOut" | "optIn" | null;

/** What consent signal, if any, a single inbound message carries. */
export function consentSignal(text: string): ConsentSignal {
  const t = normalize(text);
  if (!t) return null;
  if ((OPT_OUT_KEYWORDS as readonly string[]).includes(t)) return "optOut";
  if ((OPT_IN_KEYWORDS as readonly string[]).includes(t)) return "optIn";
  return null;
}

export interface ConsentMessage {
  direction: "Inbound" | "Outbound";
  text: string;
  /** ISO timestamp. Used only for ordering. */
  time: string;
}

export interface ConsentState {
  /** Block sending. True for a real opt-out AND for an unverifiable history. */
  optedOut: boolean;
  /** The message that produced the current state, for showing the rep why. */
  since: string | null;
  keyword: string | null;
  /**
   * We couldn't see the whole conversation, so "no STOP found" proves nothing.
   * Distinguished from a real opt-out purely so the UI can explain itself —
   * both block sending.
   */
  unknown: boolean;
}

/**
 * Resolve consent from a conversation. Messages may arrive in any order — they
 * are sorted here rather than trusting the caller, because getting this
 * backwards would flip a STOP into an opt-in.
 *
 * ⚠️ `complete` defaults to true only because most callers pass a whole thread.
 * Pass it honestly: a truncated history that scanned clean is NOT consent, it's
 * the absence of evidence, and treating the two the same is how a guard like
 * this fails open and texts someone who asked us to stop.
 */
export function consentState(messages: ConsentMessage[], complete = true): ConsentState {
  const signals = (messages || [])
    .filter((m) => m.direction === "Inbound")
    .map((m) => ({ ...m, signal: consentSignal(m.text) }))
    .filter((m) => m.signal !== null)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const last = signals[signals.length - 1];
  if (last && last.signal === "optOut") {
    return { optedOut: true, since: last.time || null, keyword: normalize(last.text), unknown: false };
  }
  // An explicit opt-IN is proof in its own right — it postdates anything we
  // couldn't see, so a partial history doesn't undermine it.
  if (last && last.signal === "optIn") {
    return { optedOut: false, since: null, keyword: null, unknown: false };
  }
  if (!complete) return { optedOut: true, since: null, keyword: null, unknown: true };
  return { optedOut: false, since: null, keyword: null, unknown: false };
}

/** True when a rep must not be allowed to send to this conversation. */
export function isOptedOut(messages: ConsentMessage[], complete = true): boolean {
  return consentState(messages, complete).optedOut;
}
