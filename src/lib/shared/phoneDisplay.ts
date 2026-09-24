/**
 * How a patient's number reads on a button — "(555)-555-0100".
 *
 * Moved here from `masheke/mmKit` because the dial and Communications popups
 * need it too, and `mmKit` now renders both of them: importing it back from
 * `mmKit` would make those files and `mmKit` a cycle, which ES modules tolerate
 * right up until one side reads the other at module-init time and gets
 * `undefined`. Import it from here.
 */

/** Format raw phone digits as (xxx)-xxx-xxxx / +1 (xxx)-xxx-xxxx. */
export function formatPhoneNice(raw?: string): string {
  if (!raw) return "—";
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)})-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `+1 (${d.slice(1, 4)})-${d.slice(4, 7)}-${d.slice(7)}`;
  return raw;
}

/**
 * "(555) 555-0100" — the shape Brandon's patient screen prints a number in
 * (pixel-match, 2026-09-24: *"phone formatted (xxx) xxx-xxxx"*). A US number
 * with its leading 1 reads the same. Anything else is returned verbatim, so a
 * number this cannot read is shown as the board holds it rather than mangled.
 * DISPLAY ONLY — what is stored, and what an editor starts from, is untouched.
 */
export function formatPhoneParen(raw?: string): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  const d = v.replace(/\D/g, "");
  const ten = d.length === 11 && d[0] === "1" ? d.slice(1) : d;
  if (ten.length !== 10) return v;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}
