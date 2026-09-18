/**
 * The Patient Intake column's filter — five facets, each multi-select.
 *
 * Brandon, 2026-09-17: *"Let's change the complete vs partial toggle to a
 * filter where you can filter for each of the 5 columns: Request type ·
 * Insurance (where "Photo upload" is an option, just like each of the actual
 * insurances) · Pump Path · CGM Path · Form (complete vs partial vs all). Each
 * of these should be able to multi-select too."*
 *
 * The five facets ARE the five pill columns on the card, in the same order —
 * that is the whole design. A coordinator reads a value off a row and then
 * wants the rows like it, so what she can filter by has to be exactly what she
 * can see, spelled the same way.
 *
 * ⚠️ **THE OPTIONS ARE DERIVED FROM THE POPULATION, NEVER HARDCODED**, and
 * that is what makes "Photo upload" work. Brandon asked for it as an insurance
 * option; it is not a payer and it is not on the General Insurance column at
 * all — it is `Insurance Provided Via = "Photo of card"`, which the card
 * already renders as **"Card on file"** because 18 of the 20 live rows that
 * answered it have a blank carrier (§5.30c, `pills.intakeInsurance`). Deriving
 * the list from `facetValue`, the same function the pill calls, means the
 * option and the pill are the same string by construction. Hardcoding a payer
 * list would also rot the day Brandon adds a payer on monday (§5.33) — here a
 * new label simply appears.
 *
 * ⚠️ **AN EMPTY SELECTION MEANS "ALL", never "none".** That is what makes the
 * five facets independent and what replaces the old three-way toggle's "All"
 * without needing an All button on every facet. A filter that started with
 * nothing selected and therefore showed nothing would read as a broken page.
 *
 * ⚠️ **BLANK IS A VALUE YOU CAN FILTER FOR.** "Which of these has nobody put
 * insurance on yet" is a real question and the card already answers it with an
 * em dash, so the option exists and is labelled rather than dropped. Dropping
 * it would make those rows unreachable through the very control that exists to
 * reach rows.
 */
import { coveragePathPill, intakeInsurance } from "./pills";
import { formCompletion, type IntakeLead } from "./workflow";

/** The five, in card order. */
export type FacetKey = "requestType" | "insurance" | "ipPath" | "cgmPath" | "form";

export const FACET_KEYS: readonly FacetKey[] = ["requestType", "insurance", "ipPath", "cgmPath", "form"];

export const FACET_LABEL: Record<FacetKey, string> = {
  requestType: "Request type",
  insurance: "Insurance",
  ipPath: "Pump path",
  cgmPath: "CGM path",
  form: "Form",
};

/** What a blank value is called in the list. Never an empty row. */
export const BLANK_LABEL = "Not set";

/**
 * A lead's value for one facet — the SAME derivation the pill row uses.
 *
 * ⚠️ `coveragePathPill` is applied here too, so a "Not Serving" path is blank
 * on both the card and in this list. If it were only blanked on the card, the
 * filter would offer an option that matched rows showing an em dash, which is
 * the §5.9-class disagreement in miniature.
 */
export function facetValue(lead: IntakeLead, facet: FacetKey, groups: { partial: string; completed: string }): string {
  switch (facet) {
    case "requestType": return (lead.requestType || "").trim();
    case "insurance": return intakeInsurance(lead);
    case "ipPath": return coveragePathPill(lead.ipCoveragePath);
    case "cgmPath": return coveragePathPill(lead.cgmCoveragePath);
    case "form": return formCompletion(lead, groups) ?? "";
  }
}

/** Nothing selected anywhere. */
export type FacetSelection = Readonly<Record<FacetKey, readonly string[]>>;

export const EMPTY_SELECTION: FacetSelection = {
  requestType: [], insurance: [], ipPath: [], cgmPath: [], form: [],
};

/** How many facets are narrowing the list — what the "Clear" control counts. */
export function activeFacetCount(sel: FacetSelection): number {
  return FACET_KEYS.filter((k) => sel[k].length > 0).length;
}

export function isFiltering(sel: FacetSelection): boolean {
  return activeFacetCount(sel) > 0;
}

/** Add or remove one value from one facet, returning a new selection. */
export function toggleFacetValue(sel: FacetSelection, facet: FacetKey, value: string): FacetSelection {
  const current = sel[facet];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  return { ...sel, [facet]: next };
}

/** Drop one facet's selection, or all of them. */
export function clearFacet(sel: FacetSelection, facet: FacetKey): FacetSelection {
  return { ...sel, [facet]: [] };
}

export interface FacetOption {
  /** The raw value matched against, `""` for blank. */
  value: string;
  /** What the option says. Blank becomes `BLANK_LABEL`. */
  label: string;
  /** How many leads in the population carry it. */
  count: number;
}

/**
 * Every value present in the population, per facet, with counts.
 *
 * ⚠️ Built from the UNFILTERED population, deliberately. Recomputing the
 * options from the already-filtered list is the classic facet bug: pick
 * "Insulin Pump" and every other Request type vanishes from the menu, so
 * there is no way to widen the selection again without clearing it. The counts
 * are therefore "how many patients in this column", not "how many you would
 * see", which is also the more useful number when deciding what to click.
 *
 * Ordered by count descending, then alphabetically, with blank ALWAYS LAST
 * however common it is — it is the absence of an answer, and a list whose first
 * entry is "Not set" buries the real ones.
 */
export function facetOptions(
  leads: readonly IntakeLead[],
  facet: FacetKey,
  groups: { partial: string; completed: string },
): FacetOption[] {
  const counts = new Map<string, number>();
  for (const lead of leads) {
    const v = facetValue(lead, facet, groups);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: value || BLANK_LABEL, count }))
    .sort((a, b) => {
      if (!a.value !== !b.value) return a.value ? -1 : 1;
      return b.count - a.count || a.label.localeCompare(b.label);
    });
}

/**
 * Does this lead survive the filter?
 *
 * AND across facets, OR within one — the only reading that makes multi-select
 * useful. "Insulin Pump or CGM, on Medicaid" is a question a coordinator
 * actually asks; "Insulin Pump AND CGM" in one column is not a thing a single
 * status value can ever be.
 */
export function matchesFacets(
  lead: IntakeLead,
  sel: FacetSelection,
  groups: { partial: string; completed: string },
): boolean {
  for (const facet of FACET_KEYS) {
    const chosen = sel[facet];
    if (!chosen.length) continue;
    if (!chosen.includes(facetValue(lead, facet, groups))) return false;
  }
  return true;
}
