/**
 * Stage-advancer no-op detection.
 *
 * Monday board automations trigger on a status CHANGE, not on a status VALUE.
 * Automation 7917676280 on Profile Send Off is literally "When status *changes*
 * to something, create item in board" — so writing "Advance to MN" onto a
 * column that already reads "Advance to MN" fires nothing at all. Monday
 * accepts the write, returns 200, and records no activity-log entry.
 *
 * `executeWritesWithVerification` could not see this. It deliberately excludes
 * the advancer from read-back verification (the advancer is the thing being
 * held BACK until the data lands) and then fires it blind, so the transaction
 * reported success and the rep got a green toast while nothing moved.
 *
 * Betty Dillingham (12895834887) and Eddie Quintero (12895852715), Aug 2026:
 * both advanced correctly on 8/26, were pulled back out of Completed into
 * Profile Clean-Up on 8/27 still carrying "Advance to MN", and from then on
 * every press of Advance to MN was a silent no-op. Katie pressed it on 8/28 and
 * again on 8/31; the 8/31 press produced ZERO activity-log entries — the item's
 * updated_at moved and not one column changed.
 *
 * ⚠️ This is deliberately a BEFORE-the-write check, not an after-the-write one.
 * Comparing the advancer's value after writing it cannot distinguish "unchanged
 * because it was already that value" from "unchanged because Monday has not
 * indexed it yet" — the very ambiguity that makes Phase 2 poll. Comparing the
 * pre-write snapshot against the value we are about to write has no such
 * ambiguity: if they are equal, no automation can possibly fire.
 *
 * ⚠️ An advancer with no `expectedText` is NOT reported. We only claim a no-op
 * when the caller told us what it is writing; guessing would mean flagging real
 * advances, and a false "nothing moved" is worse than the silence it replaces.
 */

/** True when writing `expectedText` onto a column already reading `currentText`
 *  would change nothing — and therefore trigger no Monday automation.
 *
 *  `currentText` is `undefined` when the pre-write snapshot could not be read;
 *  that is unknown, never a no-op. */
export function isAdvancerNoop(
  currentText: string | undefined,
  expectedText: string | undefined,
): boolean {
  if (expectedText === undefined) return false;
  if (currentText === undefined) return false;
  return currentText === expectedText;
}

/** The one sentence both the rep's toast and the Railway error line use, so the
 *  message a rep reports and the message an engineer greps for are the same. */
export function advancerNoopMessage(label: string, value: string): string {
  return (
    `${label} is already "${value}" — Monday only runs the stage automation when the ` +
    `value CHANGES, so nothing moved. This patient has already advanced; they should ` +
    `not be in this queue. Check the board before pressing again.`
  );
}

/** Greppable prefix for the Railway/browser console line. Searching Railway for
 *  ADVANCER_NOOP finds every occurrence across both write paths. */
export const ADVANCER_NOOP_TAG = "ADVANCER_NOOP";

export function advancerNoopLogLine(
  itemId: string,
  columnId: string,
  label: string,
  value: string,
): string {
  return `[${ADVANCER_NOOP_TAG}] item=${itemId} column=${columnId} label="${label}" value="${value}" — advancer already at target; NO automation fired, nothing moved.`;
}
