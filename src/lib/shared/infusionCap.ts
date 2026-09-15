/**
 * How many infusion sets one order may carry — the ONE rule, shared by the two
 * stages that can still change the number.
 *
 * ── THE CAPS ──
 * Brandon, 2026-09-09: *"Only anthem commercial, horizon, cigna can go up to 9
 * for the infusion sets and cartridges. Aetna can go up to 4. All else can only
 * go up to 3."*
 * Brandon, 2026-09-15: *"it should flag if insuion sets add up to more than 3 as
 * a warning. If it's Aetna, it's ok if it's 4. If it's carecentrix or anthem
 * commercial, it's ok if its 9. Everything else should only be 3 total."*
 *
 * ⚠️ **CARECENTRIX IS NOT A PAYER — it is the Referral SOURCE**, `color_mm1w5wxr`
 * label 3, a different column from Primary Insurance, whose 29 labels contain no
 * CareCentrix at all. So the second note names a second DIMENSION rather than
 * restating the first.
 *
 * ⚠️ **The two notes AGREE; they are not a revision.** Measured on the live
 * Welcome Call board 2026-09-15: **all 33** CareCentrix-referral patients carry
 * Primary Insurance = **Horizon BCBS**, with no other payer once. CareCentrix
 * administers Horizon's DME benefit, so "carecentrix" and "horizon" name one
 * population and the September 9th list is intact. Horizon and Cigna therefore
 * KEEP their 9 — reading the later note as a replacement would silently reverse
 * Brandon's own six-day-old decision to raise Cigna from 3 to 9.
 * That reading costs nothing today either way: over the 197 live rows carrying a
 * quantity, **both readings flag exactly zero patients**, because the only order
 * above 3 on a default-cap payer is a Horizon patient who is also a CareCentrix
 * referral (Sean Dayton, `12583677009`, 5 sets) and is covered by either route.
 *
 * ⚠️ These are PATTERNS, not board labels — deliberately. `anthem.*commercial`
 * is NOT `anthem`: the board carries "Anthem BCBS Medicare", "Anthem BCBS
 * Medicaid (JLJ)" and "Anthem BCBS Low-Cost (JLJ)" beside "Anthem BCBS
 * Commercial", and only Commercial is a 9. There is no generic BCBS rule —
 * "BCBS TN/FL/WY" are 3. A payer we do not recognise falls to the conservative
 * default rather than going unchecked.
 *
 * ⚠️ **A cap set too HIGH is the dangerous direction** — it lets a rep order sets
 * the payer will only pay three of, which comes back as a denial weeks later. So
 * an unrecognised payer AND an unrecognised referral source both fall to 3.
 *
 * ⚠️ **ONE module, re-exported rather than copied** (`welcomeCall/payerRules`
 * re-exports it; `finalConfirm/checkPack` imports it). A per-slice copy is the
 * hand-synced hazard §5.7/§5.17 record, and here it has a specific cost: Welcome
 * Call is where the quantity is SET and Final Confirm is where it is CHECKED, so
 * two tables drifting means one stage offering a number the next one complains
 * about, with no move that satisfies both. Same reasoning as
 * `shared/monitorPurchaseDate.ts` (§5.14).
 */

export interface PayerCap {
  /** Maximum infusion sets (and cartridges) this payer will pay for in one order. */
  cap: number;
  /** The family we matched, or null when we fell through to the default. */
  payerLabel: string | null;
}

interface CapRule {
  match: RegExp;
  label: string;
  cap: number;
}

/** First match wins. */
export const PAYER_CAP_RULES: CapRule[] = [
  { match: /anthem.*commercial/i, label: "Anthem Commercial", cap: 9 },
  { match: /horizon/i, label: "Horizon", cap: 9 },
  { match: /cigna/i, label: "Cigna", cap: 9 },
  { match: /aetna/i, label: "Aetna", cap: 4 },
];

/** Referral sources that raise the cap on their own, whatever the payer. */
const REFERRAL_CAP_RULES: CapRule[] = [
  { match: /carecentrix/i, label: "CareCentrix", cap: 9 },
];

/** What every unrecognised payer gets. Conservative on purpose. */
export const DEFAULT_INFUSION_CAP = 3;

/** How many infusion sets (or cartridges) this PAYER allows per order. */
export function payerInfusionCap(primaryInsurance: string): PayerCap {
  const primary = primaryInsurance ?? "";
  for (const rule of PAYER_CAP_RULES) {
    if (rule.match.test(primary)) return { cap: rule.cap, payerLabel: rule.label };
  }
  return { cap: DEFAULT_INFUSION_CAP, payerLabel: null };
}

/**
 * The cap for this order, reading BOTH dimensions — the payer and the referral
 * source. The HIGHER of the two wins: each is an independent statement that this
 * order may carry that many, so a CareCentrix referral on an unrecognised payer
 * is a 9, and an Anthem Commercial patient referred by a doctor is still a 9.
 */
export function infusionSetCap(primaryInsurance: string, referralSource: string): PayerCap {
  const payer = payerInfusionCap(primaryInsurance);
  const source = referralSource ?? "";
  for (const rule of REFERRAL_CAP_RULES) {
    if (rule.match.test(source) && rule.cap > payer.cap) {
      return { cap: rule.cap, payerLabel: rule.label };
    }
  }
  return payer;
}

/** The sentence shown under the infusion quantities. */
export function payerCapNote({ cap, payerLabel }: PayerCap): string {
  return payerLabel
    ? `${payerLabel} caps infusion sets and cartridges at ${cap} per order.`
    : `Defaults to ${cap} per order for this payer — can be lowered, not raised.`;
}

/** A quantity cell as a number; blank, whitespace and unparseable all read 0. */
function qty(value: string): number {
  const n = Number((value ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface InfusionTotalVerdict {
  /** Qty Inf. 1 + Qty Inf. 2. */
  total: number;
  cap: number;
  /** The family that set the cap, or null on the conservative default. */
  payerLabel: string | null;
  /** Is the order above what this payer will pay for? */
  over: boolean;
}

/**
 * Do the two infusion-set quantities ADD UP to more than the cap?
 *
 * ⚠️ **The TOTAL is the whole point of this rule, and nothing checked it before.**
 * Welcome Call renders the cap under each quantity field separately
 * (`WelcomeCallForm` draws a `CapNote` on Qty Inf. 1, Qty Inf. 2 and Qty
 * Cartridge), and `infusionSelection.infusionQtyPlan` compares the pair only
 * against the ORDER total, never against the cap. So on a default-cap payer a rep
 * could put 3 in each slot and pass every control in the app while ordering six
 * boxes the payer pays three of.
 *
 * ⚠️ **Sets only — cartridges are deliberately not summed in.** Brandon named the
 * sets, and Qty Cartridge is a separate line whose own quantity is capped in its
 * own right; folding it into this sum would be a different claim about a
 * different order line.
 */
export function infusionSetTotal(
  qty1: string,
  qty2: string,
  primaryInsurance: string,
  referralSource: string,
): InfusionTotalVerdict {
  const { cap, payerLabel } = infusionSetCap(primaryInsurance, referralSource);
  const total = qty(qty1) + qty(qty2);
  return { total, cap, payerLabel, over: total > cap };
}
