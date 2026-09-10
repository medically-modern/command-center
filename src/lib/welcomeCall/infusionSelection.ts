/**
 * lib/welcomeCall/infusionSelection.ts — which sets a rep may pick, and how the
 * two quantity slots relate.
 *
 * Brandon, 2026-09-09:
 *   · "Filter the infusion set options by the selected pump like the ops
 *      version does (5" tubing is Mobi-only, for example); if Pump Type
 *      changes, clear any set that's no longer compatible."
 *   · "Then should be in alphabetical order within the ones that are
 *      compatible, so easy to find."
 *   · "When Infusion Set 2 is selected, clear both quantities; both become
 *      required, and Qty 1 + Qty 2 must equal the order total (warn if over).
 *      Set 2 can't be the same set as Set 1."
 *   · "If Set 2 is removed, restore Qty 1's default and write blanks to
 *      Infusion Set 2 / Qty Inf. 2 on Monday — don't leave the old values on
 *      the board."
 *
 * ⚠️ **Filtering HIDES only what we positively know is wrong.**
 * `infusionCompat.infusionSetIssue` returns three kinds; only `incompatible`
 * and `five-inch-not-mobi` are removed. An **`unverified`** pairing stays in
 * the list and keeps its amber note — that module was deliberately rewritten so
 * an unclassified set says so rather than going quiet (CLAUDE.md §5.9's
 * silence-reads-as-approval rule), and hiding it here would undo that by
 * removing a real, orderable set from a rep's options with no explanation.
 *
 * ⚠️ **"Not Serving" is pinned LAST, not sorted.** It is an escape hatch, not a
 * product, and alphabetically it lands in the middle of the N's where a rep
 * scanning for a set has to read past it.
 */
import { infusionSetIssue } from "@/lib/shared/infusionCompat";

export interface SetOption {
  index: number;
  label: string;
}

/** The one label that means "no second set", handled specially throughout. */
export const NOT_SERVING = "Not Serving";

/** Positively-wrong pairings. `unverified` is deliberately absent. */
function isBlockedPairing(pumpType: string, label: string): boolean {
  if (!label || label === NOT_SERVING) return false;
  const issue = infusionSetIssue(pumpType, label);
  return issue?.kind === "incompatible" || issue?.kind === "five-inch-not-mobi";
}

/**
 * Options for a set slot: compatible only, A→Z, with `Not Serving` last.
 *
 * ⚠️ Sorted with `localeCompare` + `numeric`, so `AutoSoft XC 9 mm` follows
 * `AutoSoft XC 6 mm` rather than preceding it — a plain string sort puts "13"
 * before "6", which is exactly the ordering a rep hunting for a size does not
 * expect.
 */
export function compatibleSetOptions(
  pumpType: string,
  options: SetOption[],
  opts: { exclude?: string } = {},
): SetOption[] {
  const exclude = (opts.exclude ?? "").trim();
  const usable = options.filter(
    (o) =>
      !isBlockedPairing(pumpType, o.label) &&
      // Set 2 may not repeat Set 1 (Brandon). "Not Serving" is exempt — it is
      // the empty state, not a product, and both slots must be able to hold it.
      !(exclude && o.label === exclude && o.label !== NOT_SERVING),
  );
  const products = usable.filter((o) => o.label !== NOT_SERVING);
  const notServing = usable.filter((o) => o.label === NOT_SERVING);
  products.sort((a, b) =>
    a.label.localeCompare(b.label, "en", { numeric: true, sensitivity: "base" }),
  );
  return [...products, ...notServing];
}

/**
 * Re-admit the slot's CURRENT selection if the compatible list dropped it.
 *
 * ⚠️ Without this, a filter can blank a control that the BOARD says holds a
 * value: `InfusionSetCombobox` renders from the options list, so a selected
 * index that isn't in it shows the placeholder — the §5.11 failure where a real
 * column reads as empty with nothing erroring. Two live states reach it: a set
 * that is incompatible with the pump (until the pump-change effect clears it),
 * and Set 2 already holding the same product as Set 1.
 *
 * Showing an existing bad selection is the safe direction — `CompatNote` and
 * `infusionQtyPlan` both say what is wrong with it, and the rep can then change
 * it. Hiding it would leave a board value nobody can see or correct.
 */
export function withCurrentSelection(
  filtered: SetOption[],
  all: SetOption[],
  currentIndex: number | null,
): SetOption[] {
  if (currentIndex === null) return filtered;
  if (filtered.some((o) => o.index === currentIndex)) return filtered;
  const current = all.find((o) => o.index === currentIndex);
  return current ? [current, ...filtered] : filtered;
}

/**
 * Which of the two chosen sets a pump change has just invalidated.
 *
 * Returns the SLOTS to clear rather than doing it, so the caller owns the
 * writes — the board needs a blank in both the set and its quantity, and a
 * helper that cleared one without the other would leave a quantity attached to
 * no set (the §5.12 shape where a counter and its columns disagree).
 */
export function setsInvalidatedByPump(
  pumpType: string,
  set1Label: string,
  set2Label: string,
): { clearSet1: boolean; clearSet2: boolean } {
  return {
    clearSet1: isBlockedPairing(pumpType, set1Label),
    clearSet2: isBlockedPairing(pumpType, set2Label),
  };
}

/**
 * What the send should do with ONE infusion-set column.
 *
 * ⚠️ **An emptied selection is a CLEAR, not a skip.** Both routes that empty
 * one of these controls are automatic and both show the rep an emptied control:
 * `setsInvalidatedByPump` when they correct Pump Type (which also raises a toast
 * reading "Infusion set cleared"), and `setTwoTransition` when the second set
 * goes away. The send skipped a null index, so the incompatible set and its
 * quantity STAYED ON THE BOARD and were copied onto the order by the create-item
 * automations — the screen said one thing, Monday said another, and nothing
 * errored. That is §5.22's class of failure one product over: the supplies that
 * ship do not fit the pump.
 *
 * ⚠️ **`skip` is the third answer and it is load-bearing.** A null INDEX with a
 * non-empty LABEL means the board holds a set this app could not map — a label
 * renamed on the board, or a `value` that did not parse. Clearing there would
 * destroy a real selection on the strength of a read failure, which is the
 * dangerous direction. The two are mapped independently in `mondayMapping`
 * (`txt` vs `statusIndex`), so the surviving label is the evidence that there is
 * something there to keep.
 */
export function infusionSetWriteAction(
  index: number | null,
  label: string,
): "write" | "clear" | "skip" {
  if (index !== null) return "write";
  return label.trim() === "" ? "clear" : "skip";
}

export interface QtyPlanInput {
  /** Set 1 label as chosen ("" or "Not Serving" mean no set). */
  set1: string;
  /** Set 2 label as chosen. */
  set2: string;
  qty1: string;
  qty2: string;
  /** Boxes this order should total — `payerRules.DEFAULT_INFUSION_QTY`. */
  orderTotal: number;
}

export interface QtyPlan {
  /** True once a second set is in play; both quantities are then required. */
  split: boolean;
  /** Rep-facing problem, or null. */
  error: string | null;
  /** Non-blocking note, or null. */
  warning: string | null;
}

const chosen = (label: string) => {
  const l = (label ?? "").trim();
  return l !== "" && l !== NOT_SERVING;
};

const qty = (v: string) => {
  const n = Number((v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
};

/**
 * Validate the two quantity slots against the order total.
 *
 * ⚠️ **Missing the order total WARNS, in both directions — it never blocks.**
 * Brandon's wording is "Qty 1 + Qty 2 must equal the order total (warn if
 * over)", and the parenthetical sets the enforcement level. The quantities
 * themselves are still required once a second set is in play ("both become
 * required"), so an empty slot is an error; a total that does not add up is
 * the rep's call to make on the phone.
 */
export function infusionQtyPlan(i: QtyPlanInput): QtyPlan {
  const has1 = chosen(i.set1);
  const has2 = chosen(i.set2);
  const split = has1 && has2;

  if (has2 && !has1) {
    return {
      split: false,
      error: "Pick Infusion Set 1 before adding a second set.",
      warning: null,
    };
  }
  if (split && i.set1.trim() === i.set2.trim()) {
    return {
      split,
      error: "Infusion Set 2 must be a different set from Set 1.",
      warning: null,
    };
  }
  if (!has1) return { split: false, error: null, warning: null };

  const q1 = qty(i.qty1);
  if (!split) {
    return {
      split: false,
      error: q1 > 0 ? null : "Infusion set selected — choose a quantity.",
      warning: null,
    };
  }

  const q2 = qty(i.qty2);
  if (q1 <= 0 || q2 <= 0) {
    return {
      split,
      error: "Both quantities are required when two sets are ordered.",
      warning: null,
    };
  }

  const total = q1 + q2;
  if (total !== i.orderTotal) {
    return {
      split,
      error: null,
      warning: `${q1} + ${q2} = ${total}, not the ${i.orderTotal}-box order.`,
    };
  }
  return { split, error: null, warning: null };
}
