/**
 * Batch write — all local edits are sent to Monday on submit.
 * Only triggerStediRun fires immediately.
 */
import {
  writeStatusIndex, writeText, writePhone, writeEmail, writeNumber,
  writeLocation, writeItemName, writeDropdownIds, writeDropdownLabels,
  fetchItem, clearStatusColumn, COL,
} from "./mondayApi";
import type { Patient } from "./workflow";
import { phoneDigits } from "./workflow";
import {
  PRIMARY_INSURANCE_INDEX, GENERAL_INSURANCE_INDEX, SECONDARY_INSURANCE_INDEX,
  DOCTOR_STATUS_INDEX, CLINICALS_METHOD_INDEX, REFERRAL_TYPE_INDEX,
  REFERRAL_SOURCE_INDEX, PUMP_TYPE_INDEX, CGM_TYPE_INDEX, REQUEST_TYPE_INDEX,
  CGM_CROSS_SELL_INDEX, SERVING_INDEX, INSULIN_PUMP_COVERAGE_PATH_INDEX,
  CGM_COVERAGE_PATH_INDEX, GENDER_INDEX, MOVE_TO_ONBOARDING_INDEX,
} from "./mondayMapping";

/**
 * Trigger a Stedi eligibility run.
 *
 * Minimal-touch version: only clear the two columns the page uses as
 * "is the run finished?" signals (planName for success, errorDescription
 * for failure). Everything else gets overwritten by the next Stedi
 * response, so leaving stale values in those fields for a few seconds
 * is preferable to wiping the whole results card and showing nothing
 * if the new run hangs.
 *
 * Then force a real Run-Stedi-Eligibility status transition so the
 * "When status changes to Run" Monday automation re-fires even if the
 * column is already showing "Run".
 */
export async function triggerStediRun(itemId: string): Promise<void> {
  // Clear the two completion signals only. Sequential, only two writes.
  await writeText(itemId, COL.stediErrorDescription, "");
  await writeText(itemId, COL.stediPlanName, "");

  // Force a real status transition: clear → Run.
  await clearStatusColumn(itemId, COL.runStediEligibility);
  await writeStatusIndex(itemId, COL.runStediEligibility, 1);
}

// ── Helpers ──

function statusTask(
  itemId: string, colId: string, label: string, indexMap: Record<string, number>,
): Promise<void> | null {
  if (!label) return null; // skip empty labels
  const idx = indexMap[label];
  if (idx === undefined) {
    console.warn(`No index found for status label "${label}" in column ${colId}`);
    return null;
  }
  return writeStatusIndex(itemId, colId, idx);
}

/**
 * Send all patient data to Monday in one batch.
 * @param p The local patient state to write
 * @param onboardingAction "advance" or "needsInfo"
 * @param clinicLabelId If a clinic was selected from dropdown, pass its numeric id
 */
export async function sendPatientToMonday(
  p: Patient,
  onboardingAction: "advance" | "needsInfo",
  clinicLabelId: number | null,
): Promise<void> {
  const tasks: (Promise<void> | null)[] = [];

  // ── Name ──
  tasks.push(writeItemName(p.id, p.name));

  // ── Demographics ──
  tasks.push(writeText(p.id, COL.dob, p.dob));
  if (p.ptPhone) tasks.push(writePhone(p.id, COL.ptPhone, phoneDigits(p.ptPhone)));
  if (p.email) tasks.push(writeText(p.id, COL.email, p.email));
  tasks.push(statusTask(p.id, COL.gender, p.gender, GENDER_INDEX));
  if (p.patientAddress) tasks.push(writeLocation(p.id, COL.patientAddress, p.patientAddress, p.patientAddressLat ?? 0, p.patientAddressLng ?? 0));

  // ── Insurance ──
  tasks.push(statusTask(p.id, COL.generalInsurance, p.generalInsurance, GENERAL_INSURANCE_INDEX));
  tasks.push(statusTask(p.id, COL.primaryInsurance, p.primaryInsurance, PRIMARY_INSURANCE_INDEX));
  tasks.push(statusTask(p.id, COL.secondaryInsurance, p.secondaryInsurance, SECONDARY_INSURANCE_INDEX));
  if (p.memberId1) tasks.push(writeText(p.id, COL.memberId1, p.memberId1));
  if (p.memberId2) tasks.push(writeText(p.id, COL.memberId2, p.memberId2));

  // ── Working cost-sharing (numeric) ──
  // Working cost-sharing: fall back to stedi individual values if user hasn't edited
  const wCoins = p.workingCoinsurance || p.stediCoinsurance;
  const wDeduct = p.workingDeductible || p.stediIndividualDeductible;
  const wDeductRem = p.workingDeductibleRemaining || p.stediIndividualDeductibleRemaining;
  const wOop = p.workingOopMax || p.stediIndividualOopMax;
  const wOopRem = p.workingOopMaxRemaining || p.stediIndividualOopMaxRemaining;
  if (wCoins) tasks.push(writeNumber(p.id, COL.workingCoinsurance, wCoins));
  if (wDeduct) tasks.push(writeNumber(p.id, COL.workingDeductible, wDeduct));
  if (wDeductRem) tasks.push(writeNumber(p.id, COL.workingDeductibleRemaining, wDeductRem));
  if (wOop) tasks.push(writeNumber(p.id, COL.workingOopMax, wOop));
  if (wOopRem) tasks.push(writeNumber(p.id, COL.workingOopMaxRemaining, wOopRem));

  // ── Doctor ──
  tasks.push(statusTask(p.id, COL.doctorStatus, p.doctorStatus, DOCTOR_STATUS_INDEX));
  if (p.doctorName) tasks.push(writeText(p.id, COL.doctorName, p.doctorName));
  if (p.doctorPhone) tasks.push(writePhone(p.id, COL.doctorPhone, phoneDigits(p.doctorPhone)));
  if (p.doctorNpi) tasks.push(writeText(p.id, COL.doctorNpi, p.doctorNpi));
  tasks.push(statusTask(p.id, COL.clinicalsMethod, p.clinicalsMethod, CLINICALS_METHOD_INDEX));
  if (p.doctorEmail) tasks.push(writeEmail(p.id, COL.doctorEmail, p.doctorEmail));
  if (p.doctorFax) tasks.push(writeEmail(p.id, COL.doctorFax, p.doctorFax));
  if (clinicLabelId !== null) {
    tasks.push(writeDropdownIds(p.id, COL.clinicName, [clinicLabelId]));
  }
  if (p.clinicAddress) tasks.push(writeLocation(p.id, COL.clinicAddress, p.clinicAddress, p.clinicAddressLat ?? 0, p.clinicAddressLng ?? 0));

  // ── Insurance Plan (copied from Stedi plan name) ──
  // Stedi resolves the patient's specific plan during eligibility check
  // (e.g. "Fidelis Care Silver"). Copy it into the Insurance Plan
  // dropdown so downstream auth flows have the granular plan, not just
  // the carrier. Auto-creates the label on Monday if it's a new plan
  // we haven't seen before.
  if (p.stediPlanName?.trim()) {
    tasks.push(writeDropdownLabels(p.id, COL.insurancePlan, [p.stediPlanName.trim()]));
  }

  // ── Active / Not Active (derived from Stedi Eligibility Active) ──
  // stediEligibilityActive is text "Yes" / "No" from Stedi. Map to the
  // Active/Not-Active status column: "Yes" → Active (index 0),
  // "No" → Not Active (index 1). Anything else → don't write.
  const activeText = p.stediEligibilityActive?.toLowerCase().trim();
  if (activeText === "yes") {
    tasks.push(writeStatusIndex(p.id, COL.activeNotActive, 0));
  } else if (activeText === "no") {
    tasks.push(writeStatusIndex(p.id, COL.activeNotActive, 1));
  }

  // ── Serving / Product ──
  tasks.push(statusTask(p.id, COL.referralType, p.referralType, REFERRAL_TYPE_INDEX));
  tasks.push(statusTask(p.id, COL.referralSource, p.referralSource, REFERRAL_SOURCE_INDEX));
  tasks.push(statusTask(p.id, COL.requestType, p.requestType, REQUEST_TYPE_INDEX));
  tasks.push(statusTask(p.id, COL.cgmCrossSell, p.cgmCrossSell, CGM_CROSS_SELL_INDEX));
  tasks.push(statusTask(p.id, COL.serving, p.serving, SERVING_INDEX));
  tasks.push(statusTask(p.id, COL.pumpType, p.pumpType, PUMP_TYPE_INDEX));
  tasks.push(statusTask(p.id, COL.cgmType, p.cgmType, CGM_TYPE_INDEX));
  tasks.push(statusTask(p.id, COL.insulinPumpCoveragePath, p.insulinPumpCoveragePath, INSULIN_PUMP_COVERAGE_PATH_INDEX));
  tasks.push(statusTask(p.id, COL.cgmCoveragePath, p.cgmCoveragePath, CGM_COVERAGE_PATH_INDEX));

  // ── Move to Onboarding ──
  const onboardingLabel = onboardingAction === "advance" ? "Advance to MN" : "Need More Info.";
  tasks.push(statusTask(p.id, COL.moveToOnboarding, onboardingLabel, MOVE_TO_ONBOARDING_INDEX));

  // Fire all writes in parallel (filter out nulls)
  await Promise.all(tasks.filter(Boolean));
}


// ───────────────────────────────────────────────────────────
// Profile pre-Stedi sync — writes the profile-box fields and
// verifies they made it to Monday before allowing Stedi to run.
// ───────────────────────────────────────────────────────────

/**
 * Write the patient profile fields needed before Stedi runs.
 * Sends Name, DOB, Phone, Email, Gender, Address, General Insurance,
 * Member ID 1, Member ID 2 in parallel.
 */
export async function writePatientProfile(p: Patient): Promise<void> {
  const tasks: (Promise<void> | null)[] = [];

  // Name
  tasks.push(writeItemName(p.id, p.name));

  // Demographics
  tasks.push(writeText(p.id, COL.dob, p.dob));
  if (p.ptPhone) tasks.push(writePhone(p.id, COL.ptPhone, phoneDigits(p.ptPhone)));
  if (p.email) tasks.push(writeText(p.id, COL.email, p.email));
  tasks.push(statusTask(p.id, COL.gender, p.gender, GENDER_INDEX));
  if (p.patientAddress) tasks.push(writeLocation(p.id, COL.patientAddress, p.patientAddress, p.patientAddressLat ?? 0, p.patientAddressLng ?? 0));

  // Insurance
  tasks.push(statusTask(p.id, COL.generalInsurance, p.generalInsurance, GENERAL_INSURANCE_INDEX));
  if (p.memberId1) tasks.push(writeText(p.id, COL.memberId1, p.memberId1));
  if (p.memberId2) tasks.push(writeText(p.id, COL.memberId2, p.memberId2));

  await Promise.all(tasks.filter(Boolean));
}

/**
 * After writing, re-fetch the item from Monday and verify the four key
 * Stedi-input fields (Name, DOB, General Insurance, Member ID 1) match
 * what we expected to write.
 *
 * Returns { ok: true } if everything matches, otherwise a list of
 * field-level mismatches for the toast.
 */
export async function verifyProfileWritten(
  itemId: string,
  expected: {
    name: string;
    dob: string;
    generalInsurance: string;
    memberId1: string;
  },
): Promise<{ ok: boolean; mismatches: string[] }> {
  const item = await fetchItem(itemId, [
    COL.dob,
    COL.generalInsurance,
    COL.memberId1,
  ]);
  if (!item) return { ok: false, mismatches: ["Item not found in Monday"] };

  const cv = (id: string): string =>
    item.column_values.find((c) => c.id === id)?.text ?? "";

  const mismatches: string[] = [];
  if ((item.name ?? "") !== expected.name) {
    mismatches.push(`Name (Monday: "${item.name}", expected: "${expected.name}")`);
  }
  if (cv(COL.dob) !== expected.dob) {
    mismatches.push(`DOB (Monday: "${cv(COL.dob)}", expected: "${expected.dob}")`);
  }
  if (cv(COL.generalInsurance) !== expected.generalInsurance) {
    mismatches.push(
      `General Insurance (Monday: "${cv(COL.generalInsurance)}", expected: "${expected.generalInsurance}")`,
    );
  }
  if (cv(COL.memberId1) !== expected.memberId1) {
    mismatches.push(
      `Member ID 1 (Monday: "${cv(COL.memberId1)}", expected: "${expected.memberId1}")`,
    );
  }
  return { ok: mismatches.length === 0, mismatches };
}
