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

/* ─── Favourites (Brandon, 2026-09-11) ─── */

/**
 * *"Set a default to AutoSoft XC 6mm 23\" … not default, but like have it be
 * the first one on the list as like a favourites list. Also for any patient
 * from Joslin the favourite should be TruSteel 6mm 23\" instead."*
 *
 * ⚠️ **A favourite REORDERS, it never selects.** Nothing is written until a rep
 * picks — Brandon said "not default" in the same breath. Auto-selecting an
 * infusion set would put a product on an order nobody chose, which is the
 * §5.22 class of error that shipped a $3,787 pump.
 */
export const FAVOURITE_SET = 'AutoSoft XC 6 mm 23"';
export const FAVOURITE_SET_JOSLIN = 'TruSteel 6 mm 23"';

/**
 * Compare labels the way a human would, so a board label that gains or loses a
 * space — `9mm` vs `9 mm`, the exact mismatch the stock tracker already needs
 * normalising for — still matches its favourite. Curly quotes fold to straight.
 */
function setKey(label: string): string {
  return (label ?? "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, '"')
    .replace(/\s+/g, "")
    .trim();
}

/**
 * Which set leads the list for this patient.
 *
 * ⚠️ **Any Joslin clinic, not one exact label** (Josh, 2026-09-11: "all joslin,
 * yes"). The Clinic Name dropdown holds five Joslin entries — the exact
 * "Joslin Pediatric Educators" plus four spellings of the SUNY Upstate Joslin
 * practice — and on a scan of all 466 Welcome Call items the exact one appears
 * 3 times, all long finished, while the SUNY spellings carry the other 33.
 * Matching the exact label alone would have made this fire for nobody.
 */
export function favouriteSetLabel(clinicName: string): string {
  return /joslin/i.test(clinicName ?? "") ? FAVOURITE_SET_JOSLIN : FAVOURITE_SET;
}

/**
 * Move this patient's favourite to the top of an already-filtered list.
 *
 * ⚠️ Adds nothing and removes nothing. A favourite that is not in `options` —
 * filtered out as incompatible with the pump, or already chosen in the other
 * slot — simply does not appear, rather than being re-admitted: compatibility
 * outranks preference, and re-adding it would offer a set the pump cannot take.
 */
export function withFavouriteFirst(options: SetOption[], favourite: string): SetOption[] {
  const key = setKey(favourite);
  if (!key) return options;
  const i = options.findIndex((o) => setKey(o.label) === key);
  if (i <= 0) return options;
  return [options[i], ...options.slice(0, i), ...options.slice(i + 1)];
}

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

/**
 * What a send should do with one infusion-set column.
 *
 * Three answers, not two — and the third is the one that matters:
 *
 *  · **write** — a real index. Normal.
 *  · **clear** — a null index AND no label. The rep emptied the slot, either by
 *    hand or via `setTwoTransition` / `setsInvalidatedByPump`, and the column
 *    has to follow (Brandon, 2026-09-09: *"write blanks to Infusion Set 2 /
 *    Qty Inf. 2 on Monday — don't leave the old values on the board"*).
 *  · ⚠️ **skip** — a null index but a NON-EMPTY label. That is not a removal,
 *    it is a BAD READ: the board holds a set this app could not map, because
 *    the label was renamed or the column's `value` did not parse.
 *
 * The third case exists because `mondayMapping` derives the two independently —
 * the label from the column's `text`, the index from `JSON.parse(value).index`,
 * which returns null on any parse failure. So a set that is really there can
 * arrive with a null index, and clearing on that basis destroys a live
 * selection on the strength of a read that failed. The surviving label IS the
 * evidence there is something to keep.
 *
 * Same principle as `isOrphanRow` in the patient directory and the pending-advance
 * rule in `useMondayPatients`: act on positive evidence, and let a thing we
 * failed to read mean nothing at all.
 */
export type InfusionSetWrite = "write" | "clear" | "skip";

export function infusionSetWriteAction(
  index: number | null,
  boardLabel: string,
): InfusionSetWrite {
  if (index !== null) return "write";
  return (boardLabel ?? "").trim() === "" ? "clear" : "skip";
}
