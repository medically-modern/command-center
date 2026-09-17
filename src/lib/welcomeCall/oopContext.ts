/**
 * lib/welcomeCall/oopContext.ts — the benefit details behind the out-of-pocket
 * number, and one sentence saying why it is what it is.
 *
 * ── WHY THIS EXISTS ──
 * Katie, 2026-09-17: *"For pt Mariacamila Salazar — I need context on their OOP
 * cost. Is it 0 because of her coinsurance / because she hit OOP max? Context on
 * coinsurance, OOP max, and deductible is important to have a nuanced
 * conversation"* — and, separately, *"still missing updated OOP cost
 * calculator"*.
 *
 * Both are the same gap, and it has a date. On 2026-09-11 Brandon cut three
 * rows off the top of the Welcome Call screen; one of them was **Benefits —
 * deductible, remaining, coinsurance, OOP max**. The note recording that cut
 * argues nothing was lost because *"the out-of-pocket figure has its own step
 * there"*. The figure is not the benefit details: `OopEstimateCard` shows what
 * the deductible and coinsurance came to **on this order** and has never shown
 * what eligibility actually returned. Its own copy even says so out loud —
 * *"Benefit details aren't shown here"* — under a calculator button that is
 * inert. So from 2026-09-11 there was no surface on this page answering "how
 * much of their deductible is left?".
 *
 * Measured on the live board the day Katie asked: **Mariacamila Salazar**
 * (`13059690654`, Fidelis Low-Cost, secondary None) reads deductible remaining
 * **0**, coinsurance **0%**, OOP max remaining **191**. Her $0 is because the
 * plan's coinsurance is 0% and her deductible is met — she has **not** hit her
 * out-of-pocket maximum, which is the specific thing Katie could not tell and
 * the specific thing a patient will ask about next.
 *
 * ── WHAT IT DOES NOT DO ──
 * ⚠️ It reads the BOARD's eligibility columns, never the estimate's derived
 * fields, and it never computes anything. `estimateOop`'s Medicaid and
 * zero-OOP-payer branches both return `oopMaxRemaining: null` regardless of
 * what eligibility said, so sourcing the row from the estimate would blank a
 * real number for exactly the payers whose patients ask hardest about it.
 * ⚠️ **Blank is "not on file", never zero.** A missing deductible and a met
 * deductible are opposite facts and they look identical once either is rendered
 * as `$0.00`. `parseBenefit` returns null for anything it cannot read, and the
 * row prints an em dash — the same rule `estimateOop` itself keeps with
 * `missingFields` (missing ≠ zero).
 *
 * Pure + unit-tested (`oopContext.test.ts`). No fetches, no writes.
 */
import type { OopEstimate } from "./oopEstimator";

/** One eligibility fact as eligibility returned it. */
export interface BenefitInput {
  label: string;
  /** Formatted for the screen, or `"—"` when the column is blank/unreadable. */
  value: string;
  /** False when the column is blank — the row is muted rather than alarming. */
  known: boolean;
}

export interface BenefitSource {
  deductibleRemaining: string;
  stediCoinsurance: string;
  oopMaxRemaining: string;
  /** Qualified Medicare Beneficiary — when Yes the patient owes nothing by law. */
  stediQmb: string;
}

const DASH = "—";

/**
 * A benefits column as a number.
 *
 * ⚠️ Returns **null** for blank, whitespace and anything unparseable. Same
 * contract as `oopEstimator.parseNumber`, deliberately duplicated rather than
 * exported from there: this module must be readable as "what the board holds"
 * without dragging the estimator's rate schedule in behind it.
 */
export function parseBenefit(raw: string): number | null {
  const cleaned = String(raw ?? "").replace(/[$,%\s]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Coinsurance as a percentage.
 *
 * ⚠️ Stedi returns this either way round — `20` for twenty percent and `0.2`
 * for the same thing — and `oopEstimator.resolveCoinsurance` already normalises
 * on `< 1`. The row has to read the same way the maths did, or a patient is
 * quoted 20% beside a number computed at 0.2%.
 */
export function fmtCoinsurance(n: number): string {
  const pct = n < 1 && n > 0 ? n * 100 : n;
  const rounded = Math.round(pct * 100) / 100;
  return `${rounded}%`;
}

/** The three eligibility facts, in the order a rep reads them out. */
export function benefitInputs(p: BenefitSource): BenefitInput[] {
  const ded = parseBenefit(p.deductibleRemaining);
  const coins = parseBenefit(p.stediCoinsurance);
  const oop = parseBenefit(p.oopMaxRemaining);
  const rows: BenefitInput[] = [
    {
      label: "Deductible left",
      value: ded === null ? DASH : fmtMoney(ded),
      known: ded !== null,
    },
    {
      label: "Coinsurance",
      value: coins === null ? DASH : fmtCoinsurance(coins),
      known: coins !== null,
    },
    {
      label: "OOP max left",
      value: oop === null ? DASH : fmtMoney(oop),
      known: oop !== null,
    },
  ];
  /* QMB rides along only when it is a Yes. It is a legal bar on billing the
     patient at all, so it explains a $0 that nothing else on the row does — but
     a "QMB: No" beside three benefit figures reads as a fourth benefit and is
     noise on every other patient. */
  if (String(p.stediQmb ?? "").trim().toUpperCase() === "YES") {
    rows.push({ label: "QMB", value: "Yes — cannot be billed", known: true });
  }
  return rows;
}

/**
 * One sentence saying why the patient owes what they owe.
 *
 * Returns `""` when the card already says it another way — the Medicaid/zero-OOP
 * branches print `medicaidNote`, and an un-computable estimate prints its own
 * missing-field warnings. A second sentence repeating either is how a card stops
 * being read.
 *
 * ⚠️ The **$0 cases are the point** and they are three different conversations:
 * the deductible is met, the plan charges no coinsurance, or the out-of-pocket
 * maximum is already spent. Katie could not tell them apart, and the third one
 * is the only one that resets in January.
 */
export function oopReason(est: OopEstimate, source: BenefitSource): string {
  if (est.medicaidCovers) return "";
  if (!est.canCalculateCosts) return "";

  const owes = est.patientOwes;
  const raw = est.patientOwesRaw;
  if (owes === null || raw === null) return "";

  const oopLeft = parseBenefit(source.oopMaxRemaining);
  const dedLeft = parseBenefit(source.deductibleRemaining);
  const coinsPct = est.coinsurancePct ?? 0;

  /* Capped by the out-of-pocket maximum — whether that caps it to zero or just
     trims it. The full share is named because it is what the patient would owe
     on the next fill once the year rolls over. */
  if (owes < raw) {
    const left = oopLeft !== null ? fmtMoney(oopLeft) : "what is left";
    return owes === 0
      ? `Nothing to collect — their out-of-pocket maximum is already met. Without that cap this fill would be ${fmtMoney(raw)}.`
      : `Capped at ${left}, the rest of their out-of-pocket maximum — the full share would be ${fmtMoney(raw)}.`;
  }

  if (owes === 0) {
    const because: string[] = [];
    if (dedLeft !== null && dedLeft <= 0) because.push("their deductible is met");
    if (coinsPct === 0) because.push("this plan charges no coinsurance");
    return because.length
      ? `Nothing to collect on this fill — ${because.join(" and ")}.`
      : "Nothing to collect on this fill.";
  }

  /* The ordinary case: say which half is which, so a rep can answer "why that
     much?" without opening anything. */
  const ded = est.appliedDeductible ?? 0;
  const post = est.postDeductible ?? 0;
  if (ded > 0 && (est.patientCoinsurance ?? 0) > 0) {
    return `${fmtMoney(ded)} of their remaining deductible, then ${fmtCoinsurance(coinsPct)} of the ${fmtMoney(post)} left.`;
  }
  if (ded > 0) return `${fmtMoney(ded)} of their remaining deductible.`;
  return `${fmtCoinsurance(coinsPct)} coinsurance on ${fmtMoney(post)} — their deductible is met.`;
}


/**
 * Is this a CareCentrix referral — i.e. a patient we do not price?
 *
 * ⚠️ ONE reader, because two surfaces key off it and they have to agree.
 * `OopEstimateCard` swaps its whole estimate for "contact CareCentrix directly",
 * and `InsuranceAuthSection.OopBlock` drops the amount field and the "Reviewed
 * with patient" tick that sit under it (Katie, 2026-09-17: *"should remove
 * option to select reviewed with patient for CareCentrix patients"*). Split
 * between two files, one of them eventually stops matching and a rep is offered
 * a tick confirming a figure the card above refuses to give them.
 *
 * ⚠️ It reads Referral **Source** `color_mm1w5wxr`, not an insurance column —
 * CareCentrix is not a payer (§5.32g). All 33 CareCentrix rows on the live board
 * carry Horizon BCBS as their payer, so keying off the insurance would catch
 * every Horizon patient, referral or not.
 */
export function isCareCentrixReferral(p: { referralSource?: string | null }): boolean {
  return (p.referralSource ?? "").toLowerCase().includes("carecentrix");
}
