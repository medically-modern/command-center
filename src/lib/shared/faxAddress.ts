/**
 * faxAddress — the doctor "Fax" field is a Monday EMAIL column, not a text one.
 *
 * Doctor DB "Script Fax" (`email_mkwh2ywd`) and the patient boards' Doctor Fax
 * (`email_mm1xdzcj`) are both email columns, written as `{ email, text }`. A
 * bare number like `8653742115` is not a valid address, so Monday rejects the
 * mutation with a bare `Internal Server Error` — which surfaces in the UI as an
 * "invalid email" toast pointing at the EMAIL box, even though the box the rep
 * filled in correctly is fine and the fax box is the real culprit.
 *
 * The convention everywhere else in the app (see `sendViaWorker`) is that a fax
 * destination IS an address: `<digits>@rcfax.com`, which RingCentral converts to
 * a fax. So store the fax that way too — the value is then both a valid email
 * column value and directly sendable.
 */

export const RCFAX_SUFFIX = "@rcfax.com";

/**
 * Normalize a typed fax entry into the value stored in Monday's email column.
 * An entry containing "@" is kept as-is (the rep typed a full address, rcfax or
 * otherwise); a bare number becomes `<digits>@rcfax.com`. A digit-less entry
 * (or an empty one) yields "" rather than a stray "@rcfax.com".
 */
export function toFaxAddress(raw: string): string {
  const v = (raw || "").trim();
  if (!v) return "";
  if (v.includes("@")) return v;
  const digits = v.replace(/\D/g, "");
  return digits ? `${digits}${RCFAX_SUFFIX}` : "";
}

/**
 * What an EDIT BOX's fax entry should be written to the column as.
 *
 * `writeEmail` SKIPS a value that isn't an address, silently, so a rep who
 * corrects a doctor's fax by typing `(215) 555-0100` saves nothing: the old
 * number stays on the board and every later send goes to it (Medical
 * Evaluation, 2026-09-29). A value with a digit in it goes through
 * `toFaxAddress`. A value WITHOUT one is returned as typed and never through
 * `toFaxAddress`, which would turn it into "" — and "" CLEARS the column, so a
 * stray "n/a" would delete the fax it was typed over.
 */
export function faxEditToColumnValue(raw: string): string {
  const v = (raw || "").trim();
  return /\d/.test(v) ? toFaxAddress(v) : v;
}

/**
 * Is this value a fax destination RingCentral can actually deliver, i.e.
 * `<digits>@rcfax.com`? This is the "required" half of the Doctor Fax rule
 * (`lib/profile/doctorFaxRequired.ts`) and it lives HERE, beside the two
 * functions that produce and split the value, so the normalizer, the splitter
 * and the validator cannot disagree about what the convention is.
 *
 * ⚠️ **Presence is NOT enough, and the board proves it.** Every non-empty
 * Doctor Fax on Profile Send Off was read on 2026-09-17 (~581 values): SEVEN
 * are not deliverable and each one looks fine to a presence check —
 * `smweissoffice@gmail.com` (a real inbox typed into the fax field),
 * `3156270554@rcfaxcom` (**the dot is missing**), `fax@rcfax.com` and
 * `josh.pso@rcfax.com` (the local part is a word, not a number), and three
 * truncated nine-digit numbers (`805343557@`, `423892505@`, `516832442@`).
 * A fax to any of them goes nowhere and nothing says so.
 *
 * ⚠️ **The suffix match is CASE-INSENSITIVE because a live value depends on
 * it** — `3367130547@RCFAX.com` is on the board and RingCentral delivers it
 * (mail domains are case-insensitive). Refusing it would block a working fax,
 * which is the one direction this check must never fail in.
 * ⚠️ **Eleven digits with a leading 1 is ACCEPTED** for the same reason: four
 * live values are that shape (`13102138290@`, `18432349057@`, `19724066715@`,
 * `14065854650@`) and all four are dialable. Anything else — nine digits, a
 * stray letter — is not, so the count is the check that catches a truncation.
 *
 * Re-run that scan before loosening or tightening the digit rule; the numbers,
 * not an intuition, are what chose it.
 */
export function isFaxAddress(raw: string): boolean {
  const v = (raw || "").trim().toLowerCase();
  if (!v.endsWith(RCFAX_SUFFIX)) return false;
  const local = v.slice(0, -RCFAX_SUFFIX.length);
  return /^1?\d{10}$/.test(local);
}

/**
 * Split a stored fax value for display in an input that shows `@rcfax.com` as a
 * fixed suffix: `local` is what the rep sees/edits, `suffixed` says whether the
 * suffix adornment applies (false when the value is some other address, which
 * must render in full so it isn't silently mangled).
 */
export function splitFaxAddress(raw: string): { local: string; suffixed: boolean } {
  const v = (raw || "").trim();
  if (!v) return { local: "", suffixed: true };
  const at = v.toLowerCase().lastIndexOf(RCFAX_SUFFIX);
  if (at > 0 && at === v.length - RCFAX_SUFFIX.length) {
    return { local: v.slice(0, at), suffixed: true };
  }
  if (v.includes("@")) return { local: v, suffixed: false };
  return { local: v, suffixed: true };
}
