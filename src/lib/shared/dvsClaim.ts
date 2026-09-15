/**
 * Medicaid DVS supply claims — "did this line actually get paid?"
 *
 * The two supply lines that route to NY Medicaid are billed through ePACES/DVS
 * by the `automate-dvs` Railway services, which write the adjudication back onto
 * the board as a per-line CLAIM string:
 *
 *   Infusion sets → "A4230 Claim"  `text_mm28a3xt`
 *   Cartridges    → "A4232 Claim"  `text_mm282cy5`
 *
 * The shape is `<verdict>[: <detail>]`. Verdicts seen across all 107 non-blank
 * values on the live Welcome Call board (2026-09-15):
 *
 *   "Paid: $456.00" · "Paid: $108.30" · "Paid: $455.00" · "Paid: $0.00"
 *   "Denied: Claim denied — see ePACES for details"
 *   "Denied: Maximum coverage amount met or exceeded for benefit period."
 *   "ERROR — see Claims Error col"
 *   "Yes"   ← one legacy row, from before the verdict format existed
 *
 * ⚠️ NON-BLANK IS NOT PAID. A blank check would read a DENIED claim as evidence
 * the line is fine — the exact opposite of what it says, and the one direction
 * that costs money. Only an explicit `Paid` verdict counts; every other value,
 * the legacy "Yes" included, is "we cannot tell from this column".
 *
 * ⚠️ THE VERDICT DECIDES, THE AMOUNT ONLY EXPLAINS. `Paid: $0.00` is paid — DVS
 * adjudicated and accepted the claim. Reading the dollar figure to overrule the
 * verdict is the same inversion `lib/shared/smsDelivery.ts` exists to prevent
 * (status decides, code explains). Three rows carry $0.00, all in Completed or
 * Stuck, none in a live stage.
 *
 * ⚠️ These two columns are the RECORD of what DVS did. Do not gate a consumer on
 * `hcpcRules.suppliesRouteToMedicaid` instead — that is a PREDICTION built on a
 * hand-maintained payer set, and it is already wrong for this population:
 * `United Medicaid` is not in its `SUPPLIES_NEED_NY_MEDICAID_SECONDARY` set, yet
 * two live patients on that payer have paid A4230/A4232 claims. A set that must
 * be updated when a payer is added will not be (§5.9/§5.10). The claim column
 * needs no such list, and it is per-line — CGM and the pump have no equivalent
 * column, so nothing keyed on it can ever reach beyond the supplies.
 */

/** Did this line's DVS claim come back PAID? */
export function dvsClaimPaid(claim: string | null | undefined): boolean {
  return /^\s*paid\b/i.test(claim ?? "");
}
