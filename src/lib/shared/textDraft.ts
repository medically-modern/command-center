/**
 * What the SMS composer's draft box should contain, as two pure rules.
 *
 * These live outside the component because getting them wrong is SILENT. The
 * composer opens with a template in it; if the template is the wrong one there
 * is no error, no warning, nothing to notice — the rep sends a CGM upload link
 * to a patient they meant to ask about insurance, and only finds out when the
 * patient replies asking what the link is for.
 *
 * That is not hypothetical: it shipped. `msg` outlives the dialog (closing a
 * Radix dialog unmounts nothing), and the seeding rule only filled an EMPTY
 * box — so the first template a rep opened stuck in the box forever. Open
 * "Generate CGM data link", close it without sending, click "Start Insurance
 * Follow-Up", and the CGM text was still there, because the box was no longer
 * empty for the insurance template to land in.
 */

/**
 * Seeding, when the composer opens with a template.
 *
 * A template never overwrites words the rep typed themselves — those are
 * unrecoverable, and the template is one click away again. Anything they did
 * NOT type (an empty box, or a template they left untouched and closed —
 * see `draftAfterClose`) gives way to it.
 */
export function draftOnOpen(current: string, prefill: string | undefined): string {
  if (!prefill) return current;
  return current ? current : prefill;
}

/**
 * Closing the composer.
 *
 * A template the rep looked at and closed is thrown away, so the next template
 * has an empty box to land in. Anything they actually typed survives — an
 * outside click or Esc must not eat their words.
 *
 * @param seeded the template WE put in the box, or null if we never did
 */
export function draftAfterClose(current: string, seeded: string | null): string {
  return current === seeded ? "" : current;
}
