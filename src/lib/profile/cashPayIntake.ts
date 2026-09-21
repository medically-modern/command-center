/**
 * What intake asks of a Cash Pay patient, and what it stops asking.
 *
 * Brandon's handoff (2026-08-18), after Janelle could not move Debbie Hinze:
 * *"When Cash Pay is selected: no benefit check is required, and on the right
 * side only section 2 should be required — sections 1 and 3 should be
 * hidden/skipped. Validation on the Advance button needs to respect that,
 * because today you can't advance at all without insurance on file (that's
 * exactly what blocked Debbie)."*
 *
 * ⚠️ **SECTION 3 (Select Correct Provider) IS STILL REQUIRED** — a deliberate
 * departure from that wording, on Josh's call (2026-09-21: *"keep doctor
 * required. since we need it to order"*). Cardinal's submit payload carries a
 * mandatory `doctorInfo` block; Debbie's real order went out with Becky
 * Blodgett, NPI 1942274204. Hiding the doctor step would let cash pay orders
 * reach Cardinal with an empty doctor and fail GATE 1, hours downstream of the
 * only stage where somebody is still on the phone with the patient. Only
 * SECTION 1 (Verified Insurance) goes.
 *
 * ⚠️ Applied on **BOTH** of the board's intake routes — `/profile` (Referral
 * Intake, Already In System) and `/unverified-referrals` + `/profile-cleanup`
 * (the DTC pair). §5.19b records the cost of a rule living on one and not the
 * other: the doctor-fax requirement blocked on one route while the shared
 * banner told reps on the other that it blocked there too. One module, read by
 * both; `cashPayIntakeWiring.test.ts` scans for it.
 */

import { CASH_PAY_LABEL, isCashPay, isCashPayPatient } from "../shared/cashPay";
import type { Patient } from "./workflow";

export { CASH_PAY_LABEL, isCashPayPatient };

/**
 * Picking Cash Pay under General Insurance mirrors it into Primary Insurance —
 * "that's the value that flows to the Welcome Call board, Subscription board,
 * and everything downstream, and it's what the Order board can key on later"
 * (Brandon).
 *
 * Returns the value Primary Insurance should carry, or `null` when this edit
 * should not touch it. Deliberately narrow: it fires only on the General
 * Insurance column BECOMING Cash Pay, so a rep who deliberately sets some other
 * Primary Insurance afterwards is not overruled on the next keystroke, and a
 * patient who is corrected AWAY from Cash Pay keeps whatever the rep then
 * chooses rather than being silently blanked.
 */
export function primaryInsuranceForGeneral(
  nextGeneral: string,
  currentPrimary: string | null | undefined,
): string | null {
  if (!isCashPay(nextGeneral)) return null;
  if (isCashPay(currentPrimary)) return null; // already right — no needless write
  return CASH_PAY_LABEL;
}

/**
 * Is the benefit check part of this patient's intake at all?
 *
 * Drives whether Run Stedi and the eligibility readout render. A cash pay
 * patient has no payer for Stedi to ask about — the run takes the payer and
 * Member ID from monday, so it would fail on identifiers that do not exist and
 * leave an error on the record that reads like a data problem.
 */
export function benefitCheckApplies(p: Patient | null | undefined): boolean {
  return !!p && !isCashPayPatient(p);
}

/** Section 1, Verified Insurance. Hidden for cash pay; there is nothing in it
 *  to verify. Section 2 and section 3 render for everybody. */
export function verifiedInsuranceStepApplies(p: Patient | null | undefined): boolean {
  return benefitCheckApplies(p);
}

/**
 * Should the readiness checklist demand a Member ID?
 *
 * ⚠️ This is the single row that actually stranded Debbie. Primary Insurance
 * passes on its own once Cash Pay is mirrored across, so dropping that row
 * changes nothing; Member ID 1 can never be satisfied for somebody with no
 * insurance.
 */
export function memberIdRequired(p: Patient | null | undefined): boolean {
  return benefitCheckApplies(p);
}

/**
 * Filter a readiness checklist down to what a cash pay patient can actually
 * satisfy. Takes the rows a page has already built so each page keeps its own
 * list — this only ever REMOVES rows, and only insurance ones.
 *
 * ⚠️ Matched on the row LABELS the two pages use. That is a string coupling,
 * so it is scanned by a test rather than trusted; the alternative (a flag per
 * row) would mean editing every row on both pages and is how one of them gets
 * missed.
 */
const INSURANCE_ROW_LABELS = [
  "Primary Insurance",
  "Member ID 1",
  "Member ID 2 (required for NY Medicaid)",
];

export function applyCashPayReadiness<T extends { label: string }>(
  rows: readonly T[],
  p: Patient | null | undefined,
): T[] {
  if (benefitCheckApplies(p)) return [...rows];
  return rows.filter((r) => !INSURANCE_ROW_LABELS.includes(r.label));
}

/**
 * Which label the Advance button writes to **Move to Onboarding**
 * (`color_mm1zmeb3`).
 *
 * Cash pay patients skip Medical Evaluation and Insurance entirely — there is
 * no medical necessity to document for a payer and no auth to chase (Corey,
 * 2026-08-14: *"logic that skips straight to welcome call"*). They take
 * "Advance to Welcome Call" (id 6, added 2026-09-21); everybody else keeps
 * "Advance to MN" (id 1).
 *
 * ⚠️ Board automation **7917676280 is deliberately untouched.** It triggers on
 * label id 1 specifically, so an insured patient's route is byte-identical to
 * what it has always been. That automation cannot be edited through the API at
 * all (§10 — the workflow tools refuse board automations outright), which is a
 * second reason not to need to.
 */
export const ADVANCE_TO_MN = "Advance to MN";
export const ADVANCE_TO_WELCOME_CALL = "Advance to Welcome Call";

export function advanceLabelFor(p: Patient | null | undefined): string {
  return isCashPayPatient(p ?? {}) ? ADVANCE_TO_WELCOME_CALL : ADVANCE_TO_MN;
}

/**
 * ⚠️⚠️ **THE CASH PAY ROUTE IS DARK UNTIL ITS AUTOMATION IS PUBLISHED.**
 *
 * Writing "Advance to Welcome Call" before monday's automation exists is worse
 * than not offering it: the label lands, nothing fires, the intake item never
 * leaves Profile Clean-Up, and the rep has pressed a button that silently did
 * nothing. The label already exists on the live board (id 6), so this is
 * reachable the moment somebody flips the flag.
 *
 * Workflow **18432110599** carries the trigger and the move-to-Completed step
 * correctly; its create-item mapping could not be built through the API and is
 * an unpublished draft awaiting a person in monday's UI. Same dark-switch shape
 * as `orders/config.ORDERING_FROM_COMMAND_CENTER` (§5.35).
 *
 * While this is false a cash pay patient still advances — on "Advance to MN",
 * exactly as they do today — so nobody is stranded either way. Flipping it only
 * changes WHICH board they land on.
 */
export const CASH_PAY_SKIPS_TO_WELCOME_CALL = false;

export function advanceLabelForLive(p: Patient | null | undefined): string {
  return CASH_PAY_SKIPS_TO_WELCOME_CALL ? advanceLabelFor(p) : ADVANCE_TO_MN;
}
