/**
 * lib/welcomeCall/payerRules.ts — the two payer-driven order rules the ops
 * design specified for this stage.
 *
 * Both are ported from the Lovable prototype's own logic, which is the closest
 * thing to a written spec ops has given us:
 *
 *     var Le=[{match:/aetna/i,label:`Aetna`,cap:4},{match:/anthem/i,label:`Anthem`,cap:9},
 *             {match:/horizon/i,label:`Horizon`,cap:9},
 *             {match:/\bbcbs\b|blue cross|blue shield/i,label:`BCBS`,cap:9}];
 *     function Re(e){let t=e.primaryInsurance??``;for(let e of Le)
 *       if(e.match.test(t))return{cap:e.cap,payerLabel:e.label};return{cap:3,payerLabel:null}}
 *     function Se(e){return`${e.primaryInsurance} ${e.secondaryInsurance??``}`
 *       .toLowerCase().includes(`medicaid`)}
 *     function Ae(e){return Se(e)?60:90}
 *
 * ⚠️ **These are PATTERNS, not board labels — deliberately.** Everywhere else in
 * this codebase a payer rule keyed on an exact label would be right, because a
 * typo silently creates a duplicate label on write. Here nothing is written:
 * the rules only ever produce a warning, and the Primary Insurance column
 * carries 29 labels of which four families matter. Matching `/anthem/i` covers
 * "Anthem BCBS Commercial", "Anthem BCBS Medicare", "Anthem BCBS Medicaid
 * (JLJ)" and "Anthem BCBS Low-Cost (JLJ)" without four entries that would rot
 * the next time a plan is added. A payer we don't recognise falls to the
 * conservative default rather than going unchecked.
 *
 * ⚠️ **Order matters in the cap table.** "Anthem BCBS Commercial" matches both
 * `/anthem/i` and the BCBS pattern; Anthem is listed first and wins. Both give
 * 9 today, so the order is currently invisible — which is exactly why it is
 * written down here before someone changes one of the numbers.
 */

export interface PayerCap {
  /** Maximum infusion sets this payer will pay for in one order. */
  cap: number;
  /** The payer family we matched, or null when we fell through to the default. */
  payerLabel: string | null;
}

interface CapRule {
  match: RegExp;
  label: string;
  cap: number;
}

/** First match wins — see the ordering note in the header. */
export const PAYER_CAP_RULES: CapRule[] = [
  { match: /aetna/i, label: "Aetna", cap: 4 },
  { match: /anthem/i, label: "Anthem", cap: 9 },
  { match: /horizon/i, label: "Horizon", cap: 9 },
  { match: /\bbcbs\b|blue cross|blue shield/i, label: "BCBS", cap: 9 },
];

/** What every unrecognised payer gets. Conservative on purpose. */
export const DEFAULT_INFUSION_CAP = 3;

/** How many infusion sets this payer allows per order. */
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
    ? `${payerLabel} caps infusion sets at ${cap} per order.`
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
