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
 * ⚠️ **Over the total is an ERROR; under it is a WARNING.** Brandon said "warn
 * if over", but over-ordering is the half that gets denied and costs money,
 * while under-ordering is a legitimate thing a rep may do deliberately (a
 * partial first shipment). Treating both the same would either block a real
 * order or wave through one the payer refuses.
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
  if (total > i.orderTotal) {
    return {
      split,
      error: `${q1} + ${q2} = ${total} exceeds the ${i.orderTotal}-box order — lower one of them.`,
      warning: null,
    };
  }
  if (total < i.orderTotal) {
    return {
      split,
      error: null,
      warning: `${q1} + ${q2} = ${total} of the ${i.orderTotal}-box order — intentional?`,
    };
  }
  return { split, error: null, warning: null };
}
