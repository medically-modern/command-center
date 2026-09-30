/**
 * Writing the Expedited mark on Profile Send Off (§5.56).
 *
 * Two writes, two jobs:
 *
 * 1. `writeExpedited` — the manager's tick, written the moment it is pressed.
 *    It is a plain column write, not an advancer: no automation reacts to this
 *    column changing. It goes straight to the board (not the page's local edit
 *    overlay) because the person who ticks it is often not the person who
 *    later presses Advance.
 *
 * 2. `expeditedAdvanceTask` — the same mark again INSIDE the verified advance
 *    batch. The create-item hop copies the column the instant Move to
 *    Onboarding flips, and Monday answers 200 before a value is indexed (§5.2),
 *    so a tick pressed a second before Advance could otherwise reach the hop
 *    stale. In the batch it is read back — exact match on the label — before
 *    the advancer is allowed to fire.
 *
 * ⚠️ THE BATCH ONLY EVER WRITES "Expedited", NEVER A CLEAR. A rep's screen can
 * be up to one poll behind the board, and a clear written from that stale copy
 * would silently un-expedite a patient a manager ticked a few seconds earlier.
 * Un-ticking is the manager's own immediate write, and nothing else's.
 */
import { COL, clearStatusColumn, readColumnTexts, writeStatusIndex } from "./mondayApi";
import { EXPEDITED_INDEX, EXPEDITED_LABEL, isExpedited } from "../shared/expedited";
import type { Patient } from "./workflow";

/**
 * Set (`true`) or clear (`false`) the mark on a Profile Send Off item, then
 * read it back. Resolves `true` once Monday reads the asked-for value, `false`
 * if it still hasn't after `tries` reads (the write itself returned 200 — it
 * is not a failure, just not confirmed yet). Throws only when the WRITE fails.
 */
export async function writeExpedited(
  itemId: string,
  on: boolean,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<boolean> {
  if (on) await writeStatusIndex(itemId, COL.expedited, EXPEDITED_INDEX);
  else await clearStatusColumn(itemId, COL.expedited);

  const tries = opts.tries ?? 5;
  const delayMs = opts.delayMs ?? 800;
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    try {
      const cols = await readColumnTexts(itemId, [COL.expedited]);
      const text = cols.find((c) => c.id === COL.expedited)?.text ?? "";
      if (on ? isExpedited(text) : text.trim() === "") return true;
    } catch {
      /* a failed READ says nothing about the write — try again */
    }
  }
  return false;
}

/** The mark's task for an advance batch, or null when the patient is not
 *  expedited (see the ⚠️ above — never a clear). `value` mirrors exactly what
 *  `fn` writes, for the gateway's durable fast path (§5.2). */
export function expeditedAdvanceTask(p: Patient): {
  label: string;
  columnId: string;
  value: { index: number };
  expectedText: string;
  fn: () => Promise<void>;
} | null {
  if (!isExpedited(p.expedited)) return null;
  return {
    label: "Expedited",
    columnId: COL.expedited,
    value: { index: EXPEDITED_INDEX },
    expectedText: EXPEDITED_LABEL,
    fn: () => writeStatusIndex(p.id, COL.expedited, EXPEDITED_INDEX),
  };
}
