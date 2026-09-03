/**
 * Monday long-text columns hold **2000 characters, and truncate silently.**
 *
 * ── HOW THIS FAILS ──
 * `change_column_value` / `change_multiple_column_values` accept an over-length
 * long_text body, return success, and store only the FIRST 2000 characters.
 * There is no error, no warning, and no indication in the response. Because the
 * app appends (history first, newest last), what gets dropped is always the
 * NEWEST content — the note somebody just wrote.
 *
 * Discovered 2026-08-14 while repairing three patients: a rollup computed 2103
 * characters, the write reported success, and the board stored 2000 with the
 * last call note cut mid-sentence. A scan of the Medical Evaluation board found
 * **9 items already sitting at exactly 2000** — every note appended to those is
 * currently being thrown away.
 *
 * ⚠️ The all-or-nothing property of `change_multiple_column_values` does NOT
 * help here. That guarantees the transaction doesn't half-apply; it says
 * nothing about the value being stored in full. A write can succeed completely
 * and still lose text.
 *
 * ⚠️ WORST CASE — Doctor Appointments. That stage has no attempt columns: the
 * attempt LINES in MN Workflow Notes are the counter (`apptOutreach
 * .apptAttemptsFromNotes`). Truncation drops the newest lines, so a patient with
 * a long history silently stops accumulating attempts — the counter freezes, the
 * rep gets unlimited retries, and the third-attempt escalation never fires.
 *
 * ── WHAT THIS MODULE DOES ──
 * Detect and refuse, nothing cleverer (Josh, 2026-08-14). A caller that would
 * overflow throws instead of writing, so the failure is loud and the existing
 * history is left intact. It deliberately does NOT trim, summarise, or silently
 * relocate the overflow — losing old history to make room for new is the same
 * class of harm, just chosen by us instead of by Monday.
 *
 * The escape hatch when a body genuinely no longer fits is a Monday **item
 * update**, which has no such limit; that's how the three repaired patients'
 * attempt history was preserved.
 */

import { isCappedColumn } from "./columnType";

/** Monday's hard limit for a `long-text` column value. */
export const MONDAY_LONG_TEXT_MAX = 2000;

/** Characters over the limit, or 0 when it fits. */
export function longTextOverflow(text: string | undefined | null): number {
  return Math.max(0, (text ?? "").length - MONDAY_LONG_TEXT_MAX);
}

/** Will Monday store this body in full? */
export function longTextFits(text: string | undefined | null): boolean {
  return longTextOverflow(text) === 0;
}

/**
 * Throw before writing a body Monday would truncate.
 *
 * `label` names the column for the rep-facing toast — "MN Workflow Notes" reads
 * far better in an error than `text_mm6vevjf`. The message says how far
 * over it is, because "trim about 150 characters" is actionable and "too long"
 * is not.
 */
export function assertLongTextFits(text: string, label: string): void {
  const over = longTextOverflow(text);
  if (over === 0) return;
  throw new Error(
    `${label} is ${over} character${over === 1 ? "" : "s"} over Monday's ${MONDAY_LONG_TEXT_MAX}-character limit. ` +
      `Monday would silently drop the newest ${over}, so nothing was saved. ` +
      `Shorten the note, or move older history to an update on the item.`,
  );
}

/**
 * `assertLongTextFits`, but only when the cap actually applies to THIS column.
 *
 * The notes columns are being converted long_text → text (no cap) in the Monday
 * UI, board by board, possibly keeping their ids — so the rule cannot key off a
 * static list or an id prefix. `isCappedColumn` asks the board (cached) and
 * answers "capped" for anything it cannot confirm is plain text, which keeps the
 * refusal in place until a flip is really live.
 */
export async function assertTextLikeFits(
  boardId: number | string,
  columnId: string,
  text: string,
  label: string,
): Promise<void> {
  if (await isCappedColumn(boardId, columnId)) assertLongTextFits(text, label);
}
