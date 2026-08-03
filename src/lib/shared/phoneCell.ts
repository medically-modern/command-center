/**
 * Monday phone columns — writing them without tripping the API's validator.
 *
 * A phone column takes `{ phone, countryShortName }`, and `phone` must be BARE
 * DIGITS. Monday's own UI accepts "917-968-9304" or "(917) 656-7209" because
 * the front end parses the format before it stores anything; the API does no
 * such thing and rejects punctuation outright with
 *
 *   "invalid value, please check our API documentation for the correct data
 *    structure for this column."
 *
 * That is the 2026-08-03 Welcome Call report: a rep typed the number the
 * provider gave her — `917-968-9304`, hyphens and all — into the Phone field,
 * and the save failed. Editing the same value directly on the board works
 * fine, which is exactly why the two experiences disagreed: one path goes
 * through Monday's UI parser, the other through the raw API.
 *
 * Profile already normalised before writing (`phoneDigits`); Welcome Call,
 * Final Confirm, Subscription, Insurance and Medical Evaluation all passed the
 * rep's keystrokes straight through. This module is that rule, shared.
 *
 * Same skip-vs-clear distinction as shared/emailCell.ts, and for the same
 * reason: several of these writes ride inside a 50-column verified send
 * (CLAUDE.md §5.2), where one rejected column aborts the transaction and the
 * patient never advances. A phone we can't parse must not be able to do that.
 */

/** Digits only, with a US country code dropped. Does NOT judge length. */
export function phoneDigits(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

/**
 * True for anything Monday will accept as a US phone number.
 *
 * Deliberately length-checked rather than truncating: an extension
 * ("917-968-9304 x12") normalises to 12 digits, and silently slicing that to
 * ten would store a number that reaches the wrong person — a worse outcome
 * than the error the rep is currently getting.
 */
export function isValidUsPhone(raw: string | null | undefined): boolean {
  return phoneDigits(raw).length === 10;
}

/** Human-readable reason a phone can't be saved, or null when it can. */
export function phoneRejectionReason(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null; // blank is a legitimate clear
  const digits = phoneDigits(trimmed);
  if (digits.length === 10) return null;
  if (digits.length === 0) return `"${trimmed}" has no digits in it.`;
  if (digits.length < 10) {
    return `"${trimmed}" is only ${digits.length} digit${digits.length === 1 ? "" : "s"} — a US number needs 10.`;
  }
  return `"${trimmed}" has ${digits.length} digits — a US number needs 10. If there's an extension, save the main number and put the extension in the notes.`;
}

export type PhoneWritePlan =
  /** Send `{ phone, countryShortName }` — ten clean digits. */
  | { action: "write"; phone: string }
  /** Send the column's empty value — the caller genuinely meant "no number". */
  | { action: "clear" }
  /** Send nothing. Not a number we can read, but there IS something there. */
  | { action: "skip" };

/**
 * Decide what to do with a value bound for a phone column.
 *
 * `skip` protects the bulk sends: a stored number that never passed through
 * this normaliser (copied in by a board automation, typed before this shipped)
 * must not be able to abort a whole stage advance. Callers that represent a
 * human explicitly saving a number — the Welcome Call check-mark — should
 * check `phoneRejectionReason` FIRST and tell the rep, because for them a
 * silent skip would read as a successful save.
 */
export function planPhoneWrite(raw: string | null | undefined): PhoneWritePlan {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { action: "clear" };
  const digits = phoneDigits(trimmed);
  return digits.length === 10 ? { action: "write", phone: digits } : { action: "skip" };
}
