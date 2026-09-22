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
 * Apply that mirror to a patch on its way into the patient overlay.
 *
 * ⚠️ **`primaryInsuranceForGeneral` had no caller until this existed**, which
 * is the §5.31b failure exactly: *"a module nobody calls does not fail; it is
 * absent, and its green tests say otherwise."* Both intake pages funnel every
 * field edit through one handler, so mirroring THERE rather than on the picker
 * means any future route that sets General Insurance — a bulk edit, a paste, a
 * second picker — mirrors too, and no second call site can be forgotten.
 *
 * Returns the patch unchanged when the mirror does not fire, so a caller can
 * pass every patch through it unconditionally.
 */
export function cashPayMirrorEdit(
  patch: Partial<Patient>,
  currentPrimary: string | null | undefined,
): Partial<Patient> {
  if (patch.generalInsurance === undefined) return patch;
  const mirrored = primaryInsuranceForGeneral(patch.generalInsurance, currentPrimary);
  return mirrored === null ? patch : { ...patch, primaryInsurance: mirrored };
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
 * list — this only ever REMOVES rows.
 *
 * ⚠️ **Matched on the row LABELS the two pages use**, which is a string
 * coupling, so `cashPayReadinessRows.test.ts` scans both pages for labels this
 * list does not know about rather than trusting it. The alternative — a flag on
 * every row — means editing every row on both pages, which is how one of them
 * gets missed.
 *
 * Two kinds of row are dropped, and the difference is worth keeping straight:
 *
 * **Rows a cash pay patient can NEVER satisfy.** Primary and Secondary
 * Insurance, both Member IDs, and *Benefits verified active* — the last reads
 * the Stedi eligibility answer, and Stedi never runs for a patient with no
 * payer, so it is false forever. These are the dead ends §5.10 · §5.20 · §5.31c
 * · §5.31f each record reversing: a gate with no passing move.
 *
 * **Rows about insurance that simply do not apply.** The CGM and Insulin Pump
 * *Coverage Paths* are how a PAYER covers a product. Josh, 2026-09-22:
 * *"we dont need any of that data, the patient doesn have insruance or need a
 * coverage path they pay oop for everytrhing"*.
 *
 * ⚠️⚠️ **SERVING IS NEITHER OF THOSE, AND IS DROPPED ON JOSH'S EXPLICIT
 * INSTRUCTION** (2026-09-22, pointing at the three rows blocking a cash pay
 * patient: *"all of these shoul;d be disabled if i select cash pay as general
 * insurance"*). It is product data, not insurance data — a rep CAN pick it —
 * and it is what the order is priced and placed from (§5.22 records a $3,787
 * pump shipping because Serving and the product columns disagreed). Dropping it
 * means a cash pay patient can reach Welcome Call with no product mix named,
 * and the Welcome Call rep sets it there instead. That is recoverable, because
 * Welcome Call is where the order is confirmed anyway — but it is a decision,
 * not a tidy-up, and reversing it is deleting one line below.
 *
 * ⚠️ **CGM Type and Pump Type are deliberately NOT dropped.** They are the
 * products themselves rather than how somebody pays for them, so they are
 * exactly as relevant to a cash pay patient as to anyone else. They only appear
 * once Serving is set, so in practice they follow it.
 */
const CASH_PAY_DROPPED_ROW_LABELS = [
  // Impossible for a patient with no insurance.
  "Primary Insurance",
  "Member ID 1",
  "Member ID 2 (required for NY Medicaid)", // UnverifiedReferralsPage's wording
  "Member ID 2 (NY Medicaid)",              // ProfilePage's wording
  "Secondary Insurance",
  "Benefits verified active",
  // Insurance data that does not apply.
  "CGM Coverage Path",
  "Insulin Pump Coverage Path", // UnverifiedReferralsPage's wording
  "IP Coverage Path",           // ProfilePage's wording
  // Product data, dropped on Josh's instruction — see the header above.
  "Serving",
];

export function applyCashPayReadiness<T extends { label: string }>(
  rows: readonly T[],
  p: Patient | null | undefined,
): T[] {
  if (benefitCheckApplies(p)) return [...rows];
  return rows.filter((r) => !CASH_PAY_DROPPED_ROW_LABELS.includes(r.label));
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
 * ✅ **LIVE from 2026-09-22.** A cash pay patient's Advance writes **"Advance to
 * Welcome Call"** (label id 6 on Move to Onboarding `color_mm1zmeb3`) instead of
 * "Advance to MN", and monday automation **7923595946** on Profile Send Off
 * turns that into a Welcome Call item and moves this one to Completed.
 *
 * **Proved end to end before flipping**, not reasoned about: a throwaway item in
 * Profile Clean-Up carrying Cash Pay was advanced, the source item landed in
 * **Completed**, and a Welcome Call item appeared in the **Welcome Call** group
 * carrying Primary Insurance = Cash Pay, DOB, phone, doctor and Serving. Both
 * test items deleted.
 *
 * ⚠️ **That test was the point, because the failure mode here is silent.** The
 * automation still carries **23 mappings aimed at Medical Evaluation column ids**
 * — left over from the duplicate it was built from — and a create-item step
 * carrying column ids the destination board does not have *could* have been
 * refused outright, creating no item at all while the source item still moved to
 * Completed. That would have taken cash pay patients out of the pipeline
 * entirely with nothing erroring. It does not; monday ignores them. Delete them
 * anyway if you are in there (`scripts/cash-pay/README.md` lists all 23).
 *
 * ⚠️ **Six of the 38 columns are deliberately unmapped and that is not a gap**
 * (Josh, 2026-09-22): both Coverage Paths, Stedi Home Plan, Stedi Coinsurance %,
 * Stedi Plan Begin Date and Referral? — *"we dont need any of that data, the
 * patient doesn have insruance or need a coverage path they pay oop for
 * everytrhing"*. Profile Send-Off Notes IS mapped, which is the one that
 * mattered: it is the intake case history the Welcome Call rep reads.
 *
 * ⚠️ **Board automation 7917676280 is untouched.** It triggers on label id 1
 * ("Advance to MN"), so an insured patient's route is byte-identical to what it
 * has always been.
 *
 * To turn this back off, set the flag to false: cash pay patients then advance
 * on "Advance to MN" like everyone else and land on Medical Evaluation. Nobody
 * is stranded either way — it only changes WHICH board they land on.
 */
export const CASH_PAY_SKIPS_TO_WELCOME_CALL = true;

export function advanceLabelForLive(p: Patient | null | undefined): string {
  return CASH_PAY_SKIPS_TO_WELCOME_CALL ? advanceLabelFor(p) : ADVANCE_TO_MN;
}
