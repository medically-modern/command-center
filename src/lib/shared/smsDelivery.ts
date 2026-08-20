/**
 * Did a text actually land? — the rule behind the "Not delivered" marker.
 *
 * ⚠️ **A successful send is NOT a delivered text.** RingCentral's own guide says
 * it outright: invoking the SMS API "only confirms that the request was accepted
 * by the system. It does not guarantee that the messages will be delivered."
 * The message is accepted, queued, and only *seconds later* flips to
 * `SendingFailed` in the message store — which is why an invalid number showed
 * a red failure in the RingCentral app and a perfectly ordinary sent bubble in
 * the Command Center (Brandon, 2026-08-20). Nothing errored; the failure simply
 * arrives after everyone has stopped looking.
 *
 * So the thread — not the send call — is where a failure becomes visible, and
 * that makes these two fields load-bearing rather than cosmetic.
 *
 * **STATUS decides, CODE only explains.** `messageStatus` is the verdict;
 * `deliveryErrorCode` is a reason string we may or may not recognise. Deriving
 * failure from the code instead would invert on the two "carrier didn't say"
 * codes (`SMS-CAR-104` / `-199`), which appear on messages that were fine — and
 * an unrecognised code must never downgrade a real `SendingFailed` to silence.
 *
 * Codes are RingCentral's, from
 * https://developers.ringcentral.com/guide/messaging/sms/sms-errors — the
 * gateway passes them through verbatim (`services/monday-gateway/messaging.mjs`)
 * and all the interpretation lives here, so there is no mirrored table to drift.
 */

export type SmsDeliveryState = "pending" | "delivered" | "failed";

/**
 * RingCentral's terminal failure statuses. Everything else — `Queued`, `Sent`,
 * `Received`, or a status we have never seen — is PENDING, never failed: a
 * message still in flight must not be marked undelivered, and a blank status
 * (an older record, or a field RC stopped sending) is an absence of evidence.
 */
const FAILED_STATUSES = new Set(["SendingFailed", "DeliveryFailed"]);

export function smsDeliveryState(messageStatus?: string): SmsDeliveryState {
  const s = (messageStatus ?? "").trim();
  if (FAILED_STATUSES.has(s)) return "failed";
  if (s === "Delivered") return "delivered";
  return "pending";
}

/**
 * What the rep should DO about it, in their words rather than the carrier's.
 *
 * Grouped by the action each code implies — a rep needs "fix the number" vs
 * "this one is ours" vs "leave them alone", not twenty-eight distinct carrier
 * sentences. Codes we don't recognise fall through to the raw code, which is
 * still enough to search RingCentral's table with.
 */
const REASONS: Array<{ codes: string[]; reason: string }> = [
  {
    // The headline case, and the one Brandon reported: the number is wrong.
    codes: ["SMS-RC-410", "SMS-UP-410", "SMS-CAR-411", "SMS-CAR-400"],
    reason: "That number can't receive texts — it's a landline or not a working mobile number. Check the number on file.",
  },
  {
    codes: ["SMS-CAR-412"],
    reason: "The patient's phone was unreachable (off or out of service). Worth retrying later.",
  },
  {
    // Not a fault to fix — a boundary to respect. Our own STOP guard reads the
    // thread for a keyword; the carrier can block one it never showed us.
    codes: ["SMS-RC-413", "SMS-UP-413", "SMS-CAR-413", "SMS-CAR-460"],
    reason: "The patient has opted out of texts from this number — don't re-send. Call them instead.",
  },
  {
    codes: ["SMS-RC-430", "SMS-UP-430", "SMS-UP-431", "SMS-CAR-430", "SMS-CAR-431", "SMS-CAR-435", "SMS-CAR-461"],
    reason: "The carrier blocked it as spam. Re-word it without links or all-caps and try again.",
  },
  {
    codes: ["SMS-UP-432", "SMS-CAR-432", "SMS-CAR-434"],
    reason: "The message was too long for the carrier. Shorten it and re-send.",
  },
  {
    // Ours, not the patient's — say so, or a rep re-types a number that was
    // never the problem.
    codes: ["SMS-CAR-414", "SMS-UP-414", "SMS-RC-503", "SMS-RC-504", "SMS-RC-501"],
    reason: "Our texting number isn't set up to send this — nothing wrong with the patient's number. Flag it to Josh.",
  },
  {
    codes: ["SMS-RC-403", "SMS-CAR-450", "SMS-CAR-451", "SMS-CAR-452"],
    reason: "We've hit the texting limit for now. Try again later.",
  },
  {
    codes: ["SMS-CAR-410", "SMS-UP-433", "SMS-CAR-433", "SMS-RC-500", "SMS-UP-500", "SMS-CAR-500"],
    reason: "RingCentral or the carrier failed to send it. Try again.",
  },
  {
    // "We never heard back" — the message may or may not have arrived, so this
    // deliberately does not claim it failed to reach them.
    codes: ["SMS-CAR-104", "SMS-CAR-199"],
    reason: "The carrier never confirmed delivery, so we can't tell whether it arrived. Follow up another way.",
  },
];

const BY_CODE = new Map<string, string>(
  REASONS.flatMap((r) => r.codes.map((c) => [c, r.reason] as const)),
);

export function smsFailureReason(deliveryErrorCode?: string): string {
  const code = (deliveryErrorCode ?? "").trim().toUpperCase();
  const known = BY_CODE.get(code);
  if (known) return known;
  // A code with no entry still beats silence — it names the failure and is
  // searchable in RingCentral's own table. Both fallbacks are worded to read
  // correctly AFTER a "Not delivered" lead, which is how both call sites
  // present them (the bubble marker and the send toast).
  if (code) return `RingCentral reported ${code}.`;
  return "RingCentral gave no reason. Check the number on file.";
}

/** The whole verdict for one message, for the UI to render or ignore. */
export function smsDelivery(m: { messageStatus?: string; deliveryError?: string }): {
  state: SmsDeliveryState;
  reason: string | null;
} {
  const state = smsDeliveryState(m.messageStatus);
  return { state, reason: state === "failed" ? smsFailureReason(m.deliveryError) : null };
}
