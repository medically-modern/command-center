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

/**
 * Should Qty Inf. 1 pre-fill to the single-set default?
 *
 * Brandon, 2026-09-11: *"I don't think the infusion set 1 defaulted to 3, like
 * cartridges did (i think it made me select it)."* Correct — Qty Cartridge has
 * had a fill-when-blank effect since July and the infusion slot never got one,
 * so the only prompt was a red "please choose a quantity" after the fact.
 *
 * ⚠️ **Never while a second set is chosen.** A split is the one case where 3 is
 * the wrong answer: `setTwoTransition` deliberately clears BOTH quantities when
 * Set 2 arrives, because Qty 1's default was the whole order and leaving it
 * would silently propose 3 + 3 = six boxes. Re-filling it here would undo that
 * within a render.
 *
 * ⚠️ Fill-when-blank, so a rep who typed 2 keeps 2, and scoped to the pump
 * section being on — a CGM-only patient must never have an infusion quantity
 * stamped on them.
 */
export function shouldDefaultInfusionQty1(args: {
  /** Is the Pump & Infusion section showing for this patient? */
  showPump: boolean;
  /** `patient.qtyInf1`. */
  qtyInf1: string;
  /** `patient.infusionSet2` label. */
  infusionSet2: string;
}): boolean {
  if (!args.showPump) return false;
  if ((args.qtyInf1 ?? "").trim() !== "") return false;
  return !isSetChosen(args.infusionSet2);
}

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

/* ─── Subscription Type ─── */

export interface SubscriptionTypeState {
  /** The label the card should show, or "" when nothing answers yet. */
  label: string;
  /** The muted hint, or "" — a value the BOARD already held gets neither. */
  hint: string;
  /** The chosen value disagrees with the products. Reported, never overridden. */
  mismatch: string;
  /** The field is blank and we have a derived answer: the caller should fill it. */
  needsFill: boolean;
}

/**
 * What the Subscription Type card should show.
 *
 * Brandon, 2026-09-09: *"Subscription Type: Sensors / Sensors & Supplies /
 * Supplies. **Default from the product mix**, editable, required"*, with the
 * same single muted hint as the Order Frequency card beside it — *"from product
 * mix"* while it is our guess, flipping to *"edited"* once the rep changes it.
 *
 * ⚠️ Until now the app COMPUTED the answer and declined to use it. The only
 * consumer of `expectedSubscriptionType` was a red *"Mismatch: expected X but Y
 * is selected"* line, which by construction cannot render on a blank field — it
 * needs a selected value to compare against. So the rep re-picked it on every
 * patient, and the one piece of help appeared only after they had already
 * picked something else.
 *
 * ⚠️ The derived value never OVERRIDES a stated one, only fills a blank. Unlike
 * Order Frequency — where an ineligible cadence is dropped wherever it came
 * from, because the payer will not pay for it — a Subscription Type that
 * disagrees with the products is a legitimate override, and Serving and the
 * product columns are editable right there. It is reported and left alone.
 *
 * `autoFilled` is what THIS session filled in for THIS patient ("" if we did
 * not), which is the only way to tell our own guess from a value the board
 * already held — they are the same string by then.
 */
export function subscriptionTypeState(args: {
  /** `patient.subscriptionType` — the board value with any overlay edit applied. */
  current: string;
  /** `expectedSubscriptionType(patient)`, or null when the mix says nothing. */
  derived: string | null;
  /** What this session auto-filled for this patient, or "". */
  autoFilled: string;
}): SubscriptionTypeState {
  const current = (args.current ?? "").trim();
  const derived = (args.derived ?? "").trim();
  const autoFilled = (args.autoFilled ?? "").trim();

  if (!current) {
    return {
      label: "",
      hint: "",
      mismatch: "",
      needsFill: !!derived,
    };
  }

  const mismatch =
    derived && current !== derived
      ? `Based on the selections above this reads as ${derived}.`
      : "";

  // Our own guess, untouched — the only case that earns "from product mix".
  if (autoFilled && current === autoFilled) {
    return { label: current, hint: "from product mix", mismatch, needsFill: false };
  }
  // We filled it and the rep then changed it.
  if (autoFilled) {
    return { label: current, hint: "edited", mismatch, needsFill: false };
  }
  // A value the board already carried: neither our guess nor this call's edit.
  return { label: current, hint: "", mismatch, needsFill: false };
}
