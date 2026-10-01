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

/**
 * ⚠️ **THE CAP TABLE MOVED TO `lib/shared/infusionCap.ts` (2026-09-15) and is
 * re-exported here, never copied.** Final Profile Confirmation now checks the
 * same numbers (checkPack C31), and Welcome Call is where they are SET while
 * Final Confirm is where they are CHECKED — so two copies drifting would mean
 * one stage offering a quantity the next one complains about, with no move that
 * satisfies both. The shared module also carries the CareCentrix referral route
 * and the pair-TOTAL rule; read its header for why "carecentrix" does not
 * displace Horizon and Cigna.
 */
export {
  PAYER_CAP_RULES,
  DEFAULT_INFUSION_CAP,
  payerInfusionCap,
  infusionSetCap,
  infusionSetTotal,
  payerCapNote,
} from "@/lib/shared/infusionCap";
export type { PayerCap, InfusionTotalVerdict } from "@/lib/shared/infusionCap";

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
  // ⚠️ AETNA COMMERCIAL only from 2026-10-01 (Josh: *"for commercial plans"* →
  // *"Aetna Commercial only"*) — the same narrowing as the infusion cap. No
  // Aetna Medicare subscriber was on 75 days when it changed.
  return /aetna.*commercial/i.test(primaryInsurance ?? "");
}

/**
 * The Subscription profile's Frequency — how LONG an order may run, per payer
 * (Josh, 2026-10-01: *"Medicaid and Fidelis → can do 60-days · Aetna → can do
 * 75-days · All else → 90 days"*, and asked directly: each payer's number is
 * the MAXIMUM; *"primary insurance is only medicaid or fidelis low cost,
 * that's it"*; a Medicaid SECONDARY does not count).
 *
 * ⚠️ **EXACT Primary Insurance labels, not a /medicaid/ pattern** — Fidelis
 * Medicaid, United Medicaid and Anthem BCBS Medicaid (JLJ) follow the 90 rule,
 * by that answer. And it reads the PRIMARY alone, unlike `isMedicaidPlan`
 * above (Welcome Call's supply default), which also reads the secondary.
 * ⚠️ Measured the day it shipped (Subscription board, active group): Medicaid
 * 288 on 60 · 2 on 90; **Fidelis Low-Cost 66 on 90** · 2 on 60. A saved value
 * above the max is KEPT and shown (the profile never rewrites a frequency on
 * its own); the max only limits what a rep can newly pick.
 */
export const PROFILE_60_DAY_PRIMARIES: readonly string[] = ["Medicaid", "Fidelis Low-Cost"];

export function profileFrequencyMaxDays(primaryInsurance: string): 60 | 75 | 90 {
  const p = (primaryInsurance ?? "").trim().toLowerCase();
  if (PROFILE_60_DAY_PRIMARIES.some((l) => l.toLowerCase() === p)) return 60;
  if (payerAllows75Days(primaryInsurance)) return 75;
  return 90;
}

/** The frequencies a rep may pick: 30, 60 and the payer's own max — so 75 is
 *  offered to Aetna Commercial only, and 90 to everyone but the 60 and 75 payers. */
export function profileFrequencyDays(primaryInsurance: string): number[] {
  const max = profileFrequencyMaxDays(primaryInsurance);
  return [...new Set([30, 60, max])].filter((d) => d <= max);
}

/**
 * Why a frequency is NOT offered to this payer, or null when it is. Only two
 * shapes exist: above the payer's max, or 75 for anyone but Aetna Commercial.
 */
export function profileFrequencyRefusal(primaryInsurance: string, days: number): string | null {
  if (!Number.isFinite(days) || profileFrequencyDays(primaryInsurance).includes(days)) return null;
  const max = profileFrequencyMaxDays(primaryInsurance);
  if (days > max) return `${profileFrequencyPayer(primaryInsurance) || "This payer"} goes up to ${max} days.`;
  return `${days} days is Aetna Commercial only.`;
}

/** The payer's name for the max, as the note says it ("Fidelis Low-Cost"). */
export function profileFrequencyPayer(primaryInsurance: string): string {
  const max = profileFrequencyMaxDays(primaryInsurance);
  if (max === 60) return (primaryInsurance ?? "").trim();
  if (max === 75) return "Aetna Commercial";
  return "";
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
