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
