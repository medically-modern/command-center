/**
 * Two order defaults from Brandon's 2026-09-09 notes that are TRANSITIONS, not
 * steady state — which is the whole difficulty. Each fires on a change the rep
 * made, never on what a patient's board row happens to say when it loads.
 *
 * Pure so both can be tested without a form.
 */
import { servingSellsPumpDevice } from "@/lib/shared/servingLines";
import { NOT_SERVING } from "./infusionSelection";
import { DEFAULT_INFUSION_QTY } from "./payerRules";

/**
 * Should Pump Qty default to 1?  *"Pump Qty should be default to 1 for any
 * serving that includes insulin pump"* (Brandon).
 *
 * ⚠️ **`servingSellsPumpDevice`, never `servingIncludesPump`, and never
 * `pumpQtyApplies`.** All three sound like "the serving includes a pump" and
 * they mean different things:
 *   - `servingIncludesPump` is TRUE for "Supplies", correctly — infusion sets
 *     ARE pump supplies. Defaulting on it ships a pump to every supplies-only
 *     patient, which is CLAUDE.md §5.22's $3,787 t:slim, exactly.
 *   - `pumpQtyApplies` additionally trusts a BLANK serving, which is right for
 *     enabling the control (a column that failed to read must not disable a
 *     real sale) and wrong for a default: defaulting on absent data is how you
 *     ship a device nobody chose. A default needs positive evidence.
 *
 * ⚠️ Fill-when-BLANK only. A rep who set 0 on purpose must not have it undone,
 * and — unlike Monitor Qty (§5.22b) — a blank Pump Qty is load-bearing on this
 * board: automation 7918341011 gates "monitor only" on **Pump Qty is empty**.
 * Writing 1 into a blank cell silences that branch. Scoping the default to
 * pump-serving patients is what keeps them clear of it: a monitor-only patient's
 * Serving names no pump, so this returns false and the cell stays empty.
 */
export function shouldDefaultPumpQty(serving: string, pumpQty: string): boolean {
  if (!servingSellsPumpDevice(serving)) return false;
  return (pumpQty ?? "").trim() === "";
}

const chosen = (label: string) => {
  const l = (label ?? "").trim();
  return l !== "" && l !== NOT_SERVING;
};

export interface SetTwoChange {
  /** Field → value the caller should write. Empty when nothing changed. */
  writes: Record<string, string>;
  /** Also blank the Set 2 status column itself. */
  clearSet2: boolean;
}

/**
 * What a change to Infusion Set 2 should do to the quantities.
 *
 * Brandon, both directions:
 *   - *"When Infusion Set 2 is selected, clear both quantities; both become
 *     required"* — the pair is now a split, and Qty 1's default of 3 was the
 *     whole order. Leaving it would silently propose 3 + 3 = 6 boxes.
 *   - *"If Set 2 is removed, restore Qty 1's default and write blanks to
 *     Infusion Set 2 / Qty Inf. 2 on Monday — don't leave the old values on
 *     the board."*
 *
 * ⚠️ Returns the writes rather than performing them, so the caller owns the
 * board writes — and so a removal can blank the SET and its QUANTITY together.
 * A quantity left attached to no set is the §5.12 shape where a counter and its
 * columns disagree.
 *
 * ⚠️ Called only on an actual transition. Running it on load would wipe the
 * quantities of every already-split patient the moment a rep opened them.
 */
export function setTwoTransition(had: boolean, has: boolean): SetTwoChange {
  if (!had && has) {
    // Became a split: both quantities are the rep's to state.
    return { writes: { qtyInf1: "", qtyInf2: "" }, clearSet2: false };
  }
  if (had && !has) {
    // Back to one set: Qty 1 returns to the single-set default and Set 2's
    // leftovers are blanked rather than left on the board.
    return {
      writes: { qtyInf1: String(DEFAULT_INFUSION_QTY), qtyInf2: "" },
      clearSet2: true,
    };
  }
  return { writes: {}, clearSet2: false };
}

/** Is a Set 2 label an actual second set? Exported so the caller's transition
 *  test and this module's cannot disagree about what "selected" means. */
export function isSetChosen(label: string): boolean {
  return chosen(label);
}
