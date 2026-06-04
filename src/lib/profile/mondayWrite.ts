/**
 * Batch write — all local edits are sent to Monday on submit.
 * Only triggerStediRun fires immediately.
 *
 * The "Move to Onboarding" column is treated as a stage advancer:
 * all data columns are written and verified BEFORE it fires, so
 * Monday automations always read up-to-date values.
 */
import {
  writeStatusIndex, writeText, writePhone, writeEmail, writeNumber,
  writeLocation, writeItemName, writeDropdownIds, writeDropdownLabels,
  fetchItem, clearStatusColumn, readColumnTexts, COL,
} from "./mondayApi";
import { executeWritesWithVerification } from "../shared/verifiedWrite";
import type { Patient } from "./workflow";
import { phoneDigits } from "./workflow";
import {
  PRIMARY_INSURANCE_INDEX, GENERAL_INSURANCE_INDEX, SECONDARY_INSURANCE_INDEX,
  DOCTOR_STATUS_INDEX, CLINICALS_METHOD_INDEX, REFERRAL_TYPE_INDEX,
  REFERRAL_SOURCE_INDEX, PUMP_TYPE_INDEX, CGM_TYPE_INDEX, REQUEST_TYPE_INDEX,
  CGM_CROSS_SELL_INDEX, SERVING_INDEX, INSULIN_PUMP_COVERAGE_PATH_INDEX,
  CGM_COVERAGE_PATH_INDEX, GENDER_INDEX, MOVE_TO_ONBOARDING_INDEX,
} from "./mondayMapping";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;

interface WriteTask {
  label: string;
  columnId: string;
  fn: () => Promise<unknown>;
  expectedText?: string;
}

async function executeWithRetry(task: WriteTask): Promise<string | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await task.fn();
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[mondayWrite:profile] ${task.label} (${task.columnId}) failed attempt ${attempt + 1}/${MAX_RETRIES + 1}: ${msg}`,
      );
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      } else {
        return `${task.label} (${task.columnId}): ${msg}`;
      }
    }
  }
  return null;
}

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

/** Push a status WriteTask into the tasks array (skips empty labels / unknown mappings). */
function statusWriteTask(
  tasks: WriteTask[],
  itemId: string,
  taskLabel: string,
  colId: string,
  statusLabel: string,
  indexMap: Record<string, number>,
): void {
  if (!statusLabel) return;
  const idx = indexMap[statusLabel];
  if (idx === undefined) {
    console.warn(`No index found for status label "${statusLabel}" in column ${colId}`);
    return;
  }
  tasks.push({ label: taskLabel, columnId: colId, fn: () => writeStatusIndex(itemId, colId, idx) });
}

/**
 * Send all patient data to Monday in one batch.
 *
 * Uses verified writes: all data columns are written and polled for
 * indexing BEFORE the "Move to Onboarding" column fires, so any Monday
 * automation triggered by that status change reads up-to-date values.
 *
 * @param p The local patient state to write
 * @param onboardingAction "advance" or "needsInfo"
 * @param clinicLabelId If a clinic was selected from dropdown, pass its numeric id
 */
export async function sendPatientToMonday(
  p: Patient,
  onboardingAction: "advance" | "needsInfo",
  clinicLabelId: number | null,
): Promise<void> {
  const tasks: WriteTask[] = [];

  // ── Name ──
  tasks.push({ label: "Name", columnId: "name", fn: () => writeItemName(p.id, p.name) });

  // ── Demographics ──
  tasks.push({ label: "DOB", columnId: COL.dob, fn: () => writeText(p.id, COL.dob, p.dob) });
  if (p.ptPhone) tasks.push({ label: "Phone", columnId: COL.ptPhone, fn: () => writePhone(p.id, COL.ptPhone, phoneDigits(p.ptPhone)) });
  if (p.email) tasks.push({ label: "Email", columnId: COL.email, fn: () => writeText(p.id, COL.email, p.email) });
  statusWriteTask(tasks, p.id, "Gender", COL.gender, p.gender, GENDER_INDEX);
  if (p.patientAddress) tasks.push({ label: "Patient Address", columnId: COL.patientAddress, fn: () => writeLocation(p.id, COL.patientAddress, p.patientAddress, p.patientAddressLat ?? 0, p.patientAddressLng ?? 0) });

  // ── Insurance ──
  statusWriteTask(tasks, p.id, "General Insurance", COL.generalInsurance, p.generalInsurance, GENERAL_INSURANCE_INDEX);
  statusWriteTask(tasks, p.id, "Primary Insurance", COL.primaryInsurance, p.primaryInsurance, PRIMARY_INSURANCE_INDEX);
  statusWriteTask(tasks, p.id, "Secondary Insurance", COL.secondaryInsurance, p.secondaryInsurance, SECONDARY_INSURANCE_INDEX);
  if (p.memberId1) tasks.push({ label: "Member ID 1", columnId: COL.memberId1, fn: () => writeText(p.id, COL.memberId1, p.memberId1) });
  if (p.memberId2) tasks.push({ label: "Member ID 2", columnId: COL.memberId2, fn: () => writeText(p.id, COL.memberId2, p.memberId2) });

  // ── Working cost-sharing (numeric) ──
  const wCoins = p.workingCoinsurance || p.stediCoinsurance;
  const wDeduct = p.workingDeductible || p.stediIndividualDeductible;
  const wDeductRem = p.workingDeductibleRemaining || p.stediIndividualDeductibleRemaining;
  const wOop = p.workingOopMax || p.stediIndividualOopMax;
  const wOopRem = p.workingOopMaxRemaining || p.stediIndividualOopMaxRemaining;
  if (wCoins) tasks.push({ label: "Working Coinsurance", columnId: COL.workingCoinsurance, fn: () => writeNumber(p.id, COL.workingCoinsurance, wCoins) });
  if (wDeduct) tasks.push({ label: "Working Deductible", columnId: COL.workingDeductible, fn: () => writeNumber(p.id, COL.workingDeductible, wDeduct) });
  if (wDeductRem) tasks.push({ label: "Working Deductible Rem", columnId: COL.workingDeductibleRemaining, fn: () => writeNumber(p.id, COL.workingDeductibleRemaining, wDeductRem) });
  if (wOop) tasks.push({ label: "Working OOP Max", columnId: COL.workingOopMax, fn: () => writeNumber(p.id, COL.workingOopMax, wOop) });
  if (wOopRem) tasks.push({ label: "Working OOP Max Rem", columnId: COL.workingOopMaxRemaining, fn: () => writeNumber(p.id, COL.workingOopMaxRemaining, wOopRem) });

  // ── Doctor ──
  statusWriteTask(tasks, p.id, "Doctor Status", COL.doctorStatus, p.doctorStatus, DOCTOR_STATUS_INDEX);
  if (p.doctorName) tasks.push({ label: "Doctor Name", columnId: COL.doctorName, fn: () => writeText(p.id, COL.doctorName, p.doctorName) });
  if (p.doctorPhone) tasks.push({ label: "Doctor Phone", columnId: COL.doctorPhone, fn: () => writePhone(p.id, COL.doctorPhone, phoneDigits(p.doctorPhone)) });
  if (p.doctorNpi) tasks.push({ label: "Doctor NPI", columnId: COL.doctorNpi, fn: () => writeText(p.id, COL.doctorNpi, p.doctorNpi) });
  statusWriteTask(tasks, p.id, "Clinicals Method", COL.clinicalsMethod, p.clinicalsMethod, CLINICALS_METHOD_INDEX);
  if (p.doctorEmail) tasks.push({ label: "Doctor Email", columnId: COL.doctorEmail, fn: () => writeEmail(p.id, COL.doctorEmail, p.doctorEmail) });
  if (p.doctorFax) tasks.push({ label: "Doctor Fax", columnId: COL.doctorFax, fn: () => writeEmail(p.id, COL.doctorFax, p.doctorFax) });
  if (clinicLabelId !== null) {
    tasks.push({ label: "Clinic Name", columnId: COL.clinicName, fn: () => writeDropdownIds(p.id, COL.clinicName, [clinicLabelId]) });
  }
  if (p.clinicAddress) tasks.push({ label: "Clinic Address", columnId: COL.clinicAddress, fn: () => writeLocation(p.id, COL.clinicAddress, p.clinicAddress, p.clinicAddressLat ?? 0, p.clinicAddressLng ?? 0) });

  // ── Insurance Plan (copied from Stedi plan name) ──
  if (p.stediPlanName?.trim()) {
    tasks.push({ label: "Insurance Plan", columnId: COL.insurancePlan, fn: () => writeDropdownLabels(p.id, COL.insurancePlan, [p.stediPlanName.trim()]) });
  }

  // ── Active / Not Active (derived from Stedi Eligibility Active) ──
  const activeText = p.stediEligibilityActive?.toLowerCase().trim();
  if (activeText === "yes") {
    tasks.push({ label: "Active/Not Active", columnId: COL.activeNotActive, fn: () => writeStatusIndex(p.id, COL.activeNotActive, 0) });
  } else if (activeText === "no") {
    tasks.push({ label: "Active/Not Active", columnId: COL.activeNotActive, fn: () => writeStatusIndex(p.id, COL.activeNotActive, 1) });
  }

  // ── Serving / Product ──
  statusWriteTask(tasks, p.id, "Referral Type", COL.referralType, p.referralType, REFERRAL_TYPE_INDEX);
  statusWriteTask(tasks, p.id, "Referral Source", COL.referralSource, p.referralSource, REFERRAL_SOURCE_INDEX);
  statusWriteTask(tasks, p.id, "Request Type", COL.requestType, p.requestType, REQUEST_TYPE_INDEX);
  statusWriteTask(tasks, p.id, "CGM Cross-Sell", COL.cgmCrossSell, p.cgmCrossSell, CGM_CROSS_SELL_INDEX);
  statusWriteTask(tasks, p.id, "Serving", COL.serving, p.serving, SERVING_INDEX);
  statusWriteTask(tasks, p.id, "Pump Type", COL.pumpType, p.pumpType, PUMP_TYPE_INDEX);
  statusWriteTask(tasks, p.id, "CGM Type", COL.cgmType, p.cgmType, CGM_TYPE_INDEX);
  statusWriteTask(tasks, p.id, "IP Coverage Path", COL.insulinPumpCoveragePath, p.insulinPumpCoveragePath, INSULIN_PUMP_COVERAGE_PATH_INDEX);
  statusWriteTask(tasks, p.id, "CGM Coverage Path", COL.cgmCoveragePath, p.cgmCoveragePath, CGM_COVERAGE_PATH_INDEX);

  // ── Move to Onboarding (stage advancer — written LAST after verification) ──
  const onboardingLabel = onboardingAction === "advance" ? "Advance to MN" : "Need More Info.";
  const onboardingIdx = MOVE_TO_ONBOARDING_INDEX[onboardingLabel];
  if (onboardingIdx !== undefined) {
    tasks.push({ label: "Move to Onboarding", columnId: COL.moveToOnboarding, fn: () => writeStatusIndex(p.id, COL.moveToOnboarding, onboardingIdx) });
  }

  // ---- Execute with read-back verification before advancing stage ----
  const failures = await executeWritesWithVerification({
    itemId: p.id,
    tasks,
    stageColumnId: COL.moveToOnboarding,
    executeWithRetry,
    readColumns: readColumnTexts,
    writeDebug: (id, msg) => writeText(id, COL.joshDebug, msg),
  });

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} column(s) failed after retries. Failed: ${failures.map((f) => f.split(":")[0]).join(", ")}`,
    );
  }
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
  /** Simple status write for pre-Stedi sync (no stage advancer involved). */
  const statusPromise = (
    itemId: string, colId: string, label: string, indexMap: Record<string, number>,
  ): Promise<void> | null => {
    if (!label) return null;
    const idx = indexMap[label];
    if (idx === undefined) return null;
    return writeStatusIndex(itemId, colId, idx);
  };

  const tasks: (Promise<void> | null)[] = [];

  // Name
  tasks.push(writeItemName(p.id, p.name));

  // Demographics
  tasks.push(writeText(p.id, COL.dob, p.dob));
  if (p.ptPhone) tasks.push(writePhone(p.id, COL.ptPhone, phoneDigits(p.ptPhone)));
  if (p.email) tasks.push(writeText(p.id, COL.email, p.email));
  tasks.push(statusPromise(p.id, COL.gender, p.gender, GENDER_INDEX));
  if (p.patientAddress) tasks.push(writeLocation(p.id, COL.patientAddress, p.patientAddress, p.patientAddressLat ?? 0, p.patientAddressLng ?? 0));

  // Insurance
  tasks.push(statusPromise(p.id, COL.generalInsurance, p.generalInsurance, GENERAL_INSURANCE_INDEX));
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
