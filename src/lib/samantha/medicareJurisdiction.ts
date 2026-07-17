/**
 * medicareJurisdiction.ts — Medicare A&B MAC jurisdiction helper (Benefits tab).
 *
 * Display-only. Drives the "JURISDICTION A–D · state" pill and the Medicare-A&B
 * hazard reminder in the redesigned Benefits panel. Writes nothing to Monday and
 * is unrelated to the `stediMedicareJurisdiction` column (text_mm298skc), which
 * is separate Stedi output.
 *
 * The state → MAC map mirrors claims-ui-tool `src/lib/claims/medicareJurisdiction.ts`
 * (CMS MAC jurisdiction map, verified 2026-06-01). There is no shared package
 * between the two apps, so this is a HAND-SYNCED COPY — same arrangement as
 * `oopEstimator.ts` ↔ the Railway financial backend (CLAUDE.md §5.7/§9). MAC
 * jurisdictions change very rarely, but if CMS reassigns a state, update both.
 *
 *   A — Noridian JE       (Northeast + DC)
 *   B — CGS Administrators (Midwest)
 *   C — Palmetto GBA       (South + PR/VI)
 *   D — Noridian JF        (West + Pacific)
 *
 * Only meaningful for TRADITIONAL Medicare A&B — Medicare Advantage plans have
 * no MAC jurisdiction (they bill the MA carrier, not a MAC), so the pill is
 * gated on `isMedicareABOnly` and hidden when the state doesn't map (same
 * behavior as the claims board).
 */

export type MacJurisdiction = "A" | "B" | "C" | "D";

const STATE_TO_JURISDICTION: Record<string, MacJurisdiction> = {
  CT: "A", DE: "A", ME: "A", MD: "A", MA: "A", NH: "A", NJ: "A", NY: "A", PA: "A", RI: "A", VT: "A", DC: "A",
  IL: "B", IN: "B", KY: "B", MI: "B", MN: "B", OH: "B", WI: "B",
  AL: "C", AR: "C", CO: "C", FL: "C", GA: "C", LA: "C", MS: "C", NM: "C", NC: "C", OK: "C",
  SC: "C", TN: "C", TX: "C", VA: "C", WV: "C", PR: "C", VI: "C",
  AK: "D", AZ: "D", CA: "D", HI: "D", ID: "D", IA: "D", KS: "D", MO: "D", MT: "D", NE: "D",
  NV: "D", ND: "D", OR: "D", SD: "D", UT: "D", WA: "D", WY: "D", AS: "D", GU: "D", MP: "D",
};

export const MAC_CONTRACTORS: Record<MacJurisdiction, string> = {
  A: "Noridian JE", B: "CGS Administrators", C: "Palmetto GBA", D: "Noridian JF",
};

const VALID_STATES = new Set(Object.keys(STATE_TO_JURISDICTION));

/**
 * Traditional Medicare A&B with no other coverage in play — the only case a MAC
 * jurisdiction (and the HMO/MSP/Inpatient hazard) is meaningful. A secondary of
 * "None" or blank counts as no-secondary.
 */
export function isMedicareABOnly(primary: string, secondary: string): boolean {
  const hasSecondary = !!(secondary || "").trim() && !/^none$/i.test((secondary || "").trim());
  return /^Medicare A&B/i.test(primary || "") && !hasSecondary;
}

/** MAC jurisdiction for a 2-letter state code, or null when unmapped. */
export function medicareJurisdictionForState(state: string): MacJurisdiction | null {
  return STATE_TO_JURISDICTION[(state || "").toUpperCase()] ?? null;
}

/**
 * Best-effort 2-letter US state from a patient address string. Prefers the
 * state immediately before a 5-digit ZIP ("…, NY 11793"), then falls back to
 * the last standalone US-state token. Returns "" when nothing maps.
 */
export function stateFromAddress(addr: string): string {
  const up = (addr || "").toUpperCase();
  const m = up.match(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/);
  if (m && VALID_STATES.has(m[1])) return m[1];
  const toks = up.replace(/[^A-Z]+/g, " ").trim().split(/\s+/).filter((t) => t.length === 2 && VALID_STATES.has(t));
  return toks.length ? toks[toks.length - 1] : "";
}

export interface MedicareJurisdictionPill {
  jurisdiction: MacJurisdiction;
  state: string;
  contractor: string;
}

/**
 * The jurisdiction pill to show for a patient, or null when not applicable
 * (not Medicare-A&B-only, or the address state doesn't map).
 */
export function medicareJurisdictionPill(
  primary: string,
  secondary: string,
  address: string,
): MedicareJurisdictionPill | null {
  if (!isMedicareABOnly(primary, secondary)) return null;
  const state = stateFromAddress(address);
  const jur = medicareJurisdictionForState(state);
  if (!jur) return null;
  return { jurisdiction: jur, state, contractor: MAC_CONTRACTORS[jur] };
}
