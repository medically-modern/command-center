/**
 * lib/welcomeCall/payerRules.ts — the payer-driven order rules for this stage.
 *
 * ── THE CAPS (Brandon, 2026-09-09) ──
 * "Only anthem commercial, horizon, cigna can go up to 9 for the infusion sets
 * and cartridges. Aetna can go up to 4. All else can only go up to 3."
 *
 * That REPLACED an earlier table ported from the Lovable prototype, which gave
 * 9 to `/anthem/i` (all four Anthem plans) and to a generic BCBS pattern. The
 * change moves five live board labels DOWN and one UP:
 *
 *   BCBS TN · BCBS FL · BCBS WY                     9 → 3   (no generic BCBS rule any more)
 *   Anthem BCBS Medicare · Medicaid (JLJ) · Low-Cost (JLJ)  9 → 3
 *   Cigna                                            3 → 9
 *
 * ⚠️ **`/anthem/i` alone is now WRONG** — it matched all four Anthem plans, and
 * only the Commercial one is a 9. The pattern carries `commercial` for exactly
 * that reason; do not "simplify" it back.
 *
 * ⚠️ **The cap is a CEILING ON MANUAL OVERRIDE, not the default.** Measured on
 * the live board 2026-09-09 over the 181 Welcome Call patients with an infusion
 * set chosen: 164 ordered 3, twelve ordered 2, two ordered 4 (Anthem BCBS
 * Commercial and Aetna Commercial — both cap-raised payers), one ordered 5
 * (Horizon BCBS), two ordered 1. **Nobody has ever ordered 9.** So the cap and
 * `DEFAULT_INFUSION_QTY` are orthogonal numbers: the default is what a rep gets,
 * the cap is how far they may raise it. A cap set too HIGH is the dangerous
 * direction — it lets a rep order sets the payer will only pay three of, which
 * comes back as a denial weeks later.
 *
 * ⚠️ These are PATTERNS, not board labels — deliberately. The Primary Insurance
 * column carries 29 labels of which four families matter, and matching
 * `/horizon/i` covers a plan family without an entry per plan. A payer we do not
 * recognise falls to the conservative default rather than going unchecked.
 *
 * ── SUPPLY LENGTH ──
 * Medicaid anywhere in the coverage shortens the run to 60 days; everyone else
 * is 90. **75 days is an Aetna-only OPTION and is never a default** (Brandon,
 * 2026-09-09) — see `supplyLengthOptions`.
 */

export interface PayerCap {
  /** Maximum infusion sets (and cartridges) this payer will pay for in one order. */
  cap: number;
  /** The payer family we matched, or null when we fell through to the default. */
  payerLabel: string | null;
}

interface CapRule {
  match: RegExp;
  label: string;
  cap: number;
}

/**
 * First match wins.
 *
 * ⚠️ Anthem is `anthem.*commercial`, NOT `anthem` — the board carries
 * "Anthem BCBS Medicare", "Anthem BCBS Medicaid (JLJ)" and "Anthem BCBS
 * Low-Cost (JLJ)" alongside "Anthem BCBS Commercial", and only Commercial is a
 * 9. There is deliberately NO generic BCBS rule: "BCBS TN/FL/WY" are 3.
 */
export const PAYER_CAP_RULES: CapRule[] = [
  { match: /anthem.*commercial/i, label: "Anthem Commercial", cap: 9 },
  { match: /horizon/i, label: "Horizon", cap: 9 },
  { match: /cigna/i, label: "Cigna", cap: 9 },
  { match: /aetna/i, label: "Aetna", cap: 4 },
];

/** What every unrecognised payer gets. Conservative on purpose. */
export const DEFAULT_INFUSION_CAP = 3;

/**
 * What Qty 1 pre-fills to when a set is picked (Brandon, 2026-09-09).
 *
 * ⚠️ **Flat 3 — it deliberately does NOT follow the supply length.** Brandon
 * offered both branches ("defaults to 3", or "90 → 3, 60 → 2, 30 → 1") and Josh
 * picked the flat one on 2026-09-09 after the board scan showed why: Medicaid
 * patients run on a 60-day cadence yet order **3** boxes today — Fidelis
 * Medicaid 73 at qty 3 against 7 at qty 2, plain Medicaid 17 at 3, Anthem BCBS
 * Medicaid 7 at 3. Deriving the quantity from the cadence would have dropped
 * ~99 live Medicaid patients from 3 boxes to 2, which is a change to what
 * physically ships, not a UI default. "Medicaid should stick to 3 boxes."
 */
export const DEFAULT_INFUSION_QTY = 3;

/** How many infusion sets (or cartridges) this payer allows per order. */
export function payerInfusionCap(primaryInsurance: string): PayerCap {
  const primary = primaryInsurance ?? "";
  for (const rule of PAYER_CAP_RULES) {
    if (rule.match.test(primary)) return { cap: rule.cap, payerLabel: rule.label };
  }
  return { cap: DEFAULT_INFUSION_CAP, payerLabel: null };
}

/** The sentence shown under the infusion quantities. */
export function payerCapNote({ cap, payerLabel }: PayerCap): string {
  return payerLabel
    ? `${payerLabel} caps infusion sets and cartridges at ${cap} per order.`
    : `Defaults to ${cap} per order for this payer — can be lowered, not raised.`;
}

/* ─── Supply length ─── */

export const MEDICAID_SUPPLY_DAYS = 60;
export const STANDARD_SUPPLY_DAYS = 90;

/**
 * Medicaid anywhere in the coverage — primary OR secondary — shortens the
 * supply run. Checking both is the rule as written: a commercial primary with
 * Medicaid secondary still bills at the Medicaid cadence.
 */
export function isMedicaidPlan(primaryInsurance: string, secondaryInsurance: string): boolean {
  return `${primaryInsurance ?? ""} ${secondaryInsurance ?? ""}`.toLowerCase().includes("medicaid");
}

/** Days of supply this order should be built for. */
export function supplyLengthDays(primaryInsurance: string, secondaryInsurance: string): number {
  return isMedicaidPlan(primaryInsurance, secondaryInsurance)
    ? MEDICAID_SUPPLY_DAYS
    : STANDARD_SUPPLY_DAYS;
}

/** The rep-facing line, matching the prototype's wording. */
export function supplyLengthNote(primaryInsurance: string, secondaryInsurance: string): string {
  return isMedicaidPlan(primaryInsurance, secondaryInsurance)
    ? `Medicaid — ${MEDICAID_SUPPLY_DAYS} day supply`
    : `${STANDARD_SUPPLY_DAYS} day supply`;
}

/**
 * Is 75 days offered for this payer? **Aetna only** (Brandon, 2026-09-09), which
 * on the live board means `Aetna Commercial` and `Aetna Medicare` — the two
 * labels the Primary Insurance column carries.
 */
export function payerAllows75Days(primaryInsurance: string): boolean {
  return /aetna/i.test(primaryInsurance ?? "");
}

/**
 * Which supply lengths the rep may pick, in ascending order.
 *
 * ⚠️ **75 is an option, never a default.** `supplyLengthDays` above still
 * returns 60 or 90 for everyone — a patient only lands on 75 because a rep
 * chose it. Offering it to a non-Aetna payer would let a rep build an order the
 * payer will not pay for, which is the same class of harm as a cap set too high.
 *
 * ⚠️ **This is NOT `callIntake.SUPPLY_LENGTHS`, and the two must not be
 * confused.** That list is every value the notes block can round-trip and DOES
 * contain 75; this one is what a given payer may pick. They were briefly the
 * same list, which meant a saved 75 parsed back as blank while still counting
 * as a manual override — blank and frozen blank (Greptile, PR #55).
 * `SupplyLengthField` therefore takes its options as a REQUIRED prop rather
 * than defaulting to either list.
 */
export function supplyLengthOptions(primaryInsurance: string): string[] {
  return payerAllows75Days(primaryInsurance)
    ? ["30", "60", "75", "90"]
    : ["30", "60", "90"];
}
