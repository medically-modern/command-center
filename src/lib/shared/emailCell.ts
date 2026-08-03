/**
 * Monday email columns — reading and writing them without corrupting them.
 *
 * An email column stores TWO fields, `{ email, text }`, where `text` is a
 * display LABEL and `email` is the address. The GraphQL `text` field on a
 * column_value is a *rendering* of that pair, not the address:
 *
 *   { email: "a@b.com", text: "a@b.com" }   → text: "a@b.com"
 *   { email: "a@b.com", text: "Dr. Smith" } → text: "Dr. Smith - a@b.com"
 *
 * Every role slice except Subscription used to read doctor Email/Fax off that
 * `text` field, so a label that has drifted from the address — a single stray
 * leading space is enough — hands the app a composite string where it expects
 * an address. Writing that string back is rejected by Monday with
 * "email is not valid", and because the six main sends run through
 * `executeWritesWithVerification` (CLAUDE.md §5.2), ONE rejected column aborts
 * the whole transaction and the patient never advances.
 *
 * That is the 2026-08-03 Benefits incident: an Insurance item carried
 * `{ text: " trajkobendo@gmail.com", email: "trajkobendo@gmail.com" }`, so the
 * send read `" trajkobendo@gmail.com - trajkobendo@gmail.com"`, tried to write
 * it as an address, and left 49 of 50 columns written with the stage not
 * advanced. The same item had failed identically on 2026-05-12 — the bad label
 * sits on the board, so it recurs on every send until something normalises it.
 *
 * Reads go through `readEmailCell` (authoritative `value.email` first) and
 * writes through `planEmailWrite`, which never sends Monday a string that
 * isn't an address.
 */

/**
 * Deliberately permissive — Monday itself is the validator and these addresses
 * include machine ones like `9299929303@rcfax.com` (§5.5). The one thing this
 * MUST reject is whitespace, since that is what the composite rendering and the
 * stray-space labels are made of.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True when `raw` is a single address with no surrounding junk. */
export function isEmailAddress(raw: string): boolean {
  return EMAIL_RE.test(raw);
}

/**
 * Pull a usable address out of whatever a Monday email column handed us.
 *
 * Handles the plain case, a stray-whitespace case, and the `"label - address"`
 * composite. Returns "" when there is no address in there at all — callers
 * must decide whether that means "clear" or "leave alone" (see
 * `planEmailWrite`), because those are very different outcomes for a column
 * holding a doctor's fax number.
 */
export function extractEmailAddress(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  if (isEmailAddress(trimmed)) return trimmed;

  // Monday renders a label/address mismatch as "<label> - <address>", so the
  // address is the LAST address-shaped token. Split on whitespace rather than
  // on " - " specifically: a label may itself contain a hyphen.
  const tokens = trimmed.split(/\s+/).filter(isEmailAddress);
  return tokens.length > 0 ? tokens[tokens.length - 1] : "";
}

/**
 * Read an email column. Prefers the raw `value` JSON's `email` field, which is
 * the address Monday actually stores, over the rendered `text`.
 *
 * Falls back to the trimmed `text` when `value` is absent or unparseable so a
 * value that exists on the board is never hidden from the rep — the write side
 * is what guarantees we don't push it back as an address.
 */
export function readEmailCell(
  cv: { text?: string | null; value?: string | null } | null | undefined,
): string {
  if (!cv) return "";
  if (cv.value) {
    try {
      const parsed = JSON.parse(cv.value) as { email?: unknown };
      const email = typeof parsed?.email === "string" ? parsed.email.trim() : "";
      if (email) return email;
    } catch {
      // Fall through to the rendered text.
    }
  }
  return extractEmailAddress(cv.text) || (cv.text ?? "").trim();
}

export type EmailWritePlan =
  /** Send `{ email, text }` — a real address. */
  | { action: "write"; email: string }
  /** Send the column's empty value — the caller genuinely meant "no address". */
  | { action: "clear" }
  /** Send nothing. We couldn't read an address, but there IS something there. */
  | { action: "skip" };

/**
 * Decide what to do with a value bound for an email column.
 *
 * The `skip` case is the important one: a value we can't parse is NOT the same
 * as an empty one. Clearing on unparseable input would delete a doctor's fax
 * number because its label had drifted — a silent data loss dressed up as a
 * fix. Leaving the column alone keeps the send green (the whole point) without
 * touching data we don't understand.
 */
export function planEmailWrite(raw: string | null | undefined): EmailWritePlan {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { action: "clear" };
  const email = extractEmailAddress(trimmed);
  return email ? { action: "write", email } : { action: "skip" };
}
