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
  writeLocation, writeItemName, writeDropdownIds, writeDropdownLabels, writeDate, cleanNumberValue,
  fetchItem, clearStatusColumn, readColumnTexts, moveItemToGroup, GROUPS, COL, BOARD_ID,
} from "./mondayApi";
import { executeWritesWithVerification } from "../shared/verifiedWrite";
import { planPhoneWrite } from "../shared/phoneCell";
import { planEmailWrite } from "../shared/emailCell";
import { stampNoteEntry } from "../shared/noteStamp";
import type { Patient } from "./workflow";
import {
  PRIMARY_INSURANCE_INDEX, GENERAL_INSURANCE_INDEX, SECONDARY_INSURANCE_INDEX,
  DOCTOR_STATUS_INDEX, CLINICALS_METHOD_INDEX, REFERRAL_TYPE_INDEX,
  REFERRAL_SOURCE_INDEX, PUMP_TYPE_INDEX, CGM_TYPE_INDEX, REQUEST_TYPE_INDEX,
  CGM_CROSS_SELL_INDEX, SERVING_INDEX, INSULIN_PUMP_COVERAGE_PATH_INDEX,
  CGM_COVERAGE_PATH_INDEX, GENDER_INDEX, MOVE_TO_ONBOARDING_INDEX,
  ALREADY_IN_SYSTEM_INDEX,
} from "./mondayMapping";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;

interface WriteTask {
  label: string;
  columnId: string;
  fn: () => Promise<unknown>;
  /** Raw Monday value in change_multiple_column_values shape — mirrors exactly
   *  what this task's write helper hands JSON.stringify. Every task must carry
   *  one or the gateway /send fast path stays disengaged. */
  value?: unknown;
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
  tasks.push({ label: taskLabel, columnId: colId, value: { index: idx }, fn: () => writeStatusIndex(itemId, colId, idx) });
}

/**
 * Build every data-column write task for a patient (everything EXCEPT the
 * "Move to Onboarding" stage advancer). Shared by the Advance path (which
 * appends the advancer and verifies) and the Send-back-to-Patient-Intake path
 * (which writes best-effort then moves groups).
 */
function buildDataTasks(p: Patient, clinicLabelId: number | null): WriteTask[] {
  const tasks: WriteTask[] = [];

  // ── Name ──
  // change_multiple_column_values expresses the item name as the key "name"
  // carrying a PLAIN STRING — the same shape writeItemName already sends via
  // change_simple_column_value, so batching this is behaviour-neutral.
  tasks.push({ label: "Name", columnId: "name", value: p.name, fn: () => writeItemName(p.id, p.name) });

  // ── Demographics ──
  tasks.push({ label: "DOB", columnId: COL.dob, value: p.dob, fn: () => writeText(p.id, COL.dob, p.dob) });
  if (p.ptPhone) {
    // writePhone SKIPS an unparseable number (writes nothing). A task carrying
    // `{}` would CLEAR the column instead, so an unparseable value pushes no
    // task at all — byte-for-byte today's no-op.
    const ptPhonePlan = planPhoneWrite(p.ptPhone);
    if (ptPhonePlan.action !== "skip")
      tasks.push({ label: "Phone", columnId: COL.ptPhone, value: ptPhonePlan.action === "write" ? { phone: ptPhonePlan.phone, countryShortName: "US" } : {}, fn: () => writePhone(p.id, COL.ptPhone, p.ptPhone) });
  }
  // NB: COL.email is a TEXT column here (text_mm1xc140), written with writeText
  // — not an email column, so it has no plan/skip/clear semantics.
  if (p.email) tasks.push({ label: "Email", columnId: COL.email, value: p.email, fn: () => writeText(p.id, COL.email, p.email) });
  statusWriteTask(tasks, p.id, "Gender", COL.gender, p.gender, GENDER_INDEX);
  if (p.patientAddress) tasks.push({ label: "Patient Address", columnId: COL.patientAddress, value: { address: p.patientAddress, lat: p.patientAddressLat ?? 0, lng: p.patientAddressLng ?? 0 }, fn: () => writeLocation(p.id, COL.patientAddress, p.patientAddress, p.patientAddressLat ?? 0, p.patientAddressLng ?? 0) });

  // ── Insurance ──
  statusWriteTask(tasks, p.id, "General Insurance", COL.generalInsurance, p.generalInsurance, GENERAL_INSURANCE_INDEX);
  statusWriteTask(tasks, p.id, "Primary Insurance", COL.primaryInsurance, p.primaryInsurance, PRIMARY_INSURANCE_INDEX);
  statusWriteTask(tasks, p.id, "Secondary Insurance", COL.secondaryInsurance, p.secondaryInsurance, SECONDARY_INSURANCE_INDEX);
  // Working Member ID — the column the Stedi service reads (text_mm4t8gbq).
  if (p.workingMemberId) tasks.push({ label: "Member ID (working)", columnId: COL.memberIdWorking, value: p.workingMemberId, fn: () => writeText(p.id, COL.memberIdWorking, p.workingMemberId) });
  // Member ID 1 — the final advancing ID (may override the working value for the
  // Fidelis-supplies-only → NY Medicaid case).
  if (p.memberId1) tasks.push({ label: "Member ID 1", columnId: COL.memberId1, value: p.memberId1, fn: () => writeText(p.id, COL.memberId1, p.memberId1) });
  if (p.memberId2) tasks.push({ label: "Member ID 2", columnId: COL.memberId2, value: p.memberId2, fn: () => writeText(p.id, COL.memberId2, p.memberId2) });

  // ── Working cost-sharing (numeric) ──
  const wCoins = p.workingCoinsurance || p.stediCoinsurance;
  const wDeduct = p.workingDeductible || p.stediIndividualDeductible;
  const wDeductRem = p.workingDeductibleRemaining || p.stediIndividualDeductibleRemaining;
  const wOop = p.workingOopMax || p.stediIndividualOopMax;
  const wOopRem = p.workingOopMaxRemaining || p.stediIndividualOopMaxRemaining;
  // writeNumber CLEANS ($, %, commas) and then RETURNS EARLY when nothing is
  // left, so the value Monday receives is the cleaned PLAIN STRING and a value
  // like "%" writes nothing at all. Clean at build time with the helper the
  // writer itself uses — never a second copy of the regex — and push no task
  // when the result is empty; `fn` still passes the RAW value, so the client
  // fallback path is byte-identical.
  const wCoinsNum = cleanNumberValue(wCoins);
  const wDeductNum = cleanNumberValue(wDeduct);
  const wDeductRemNum = cleanNumberValue(wDeductRem);
  const wOopNum = cleanNumberValue(wOop);
  const wOopRemNum = cleanNumberValue(wOopRem);
  if (wCoinsNum) tasks.push({ label: "Working Coinsurance", columnId: COL.workingCoinsurance, value: wCoinsNum, fn: () => writeNumber(p.id, COL.workingCoinsurance, wCoins) });
  if (wDeductNum) tasks.push({ label: "Working Deductible", columnId: COL.workingDeductible, value: wDeductNum, fn: () => writeNumber(p.id, COL.workingDeductible, wDeduct) });
  if (wDeductRemNum) tasks.push({ label: "Working Deductible Rem", columnId: COL.workingDeductibleRemaining, value: wDeductRemNum, fn: () => writeNumber(p.id, COL.workingDeductibleRemaining, wDeductRem) });
  if (wOopNum) tasks.push({ label: "Working OOP Max", columnId: COL.workingOopMax, value: wOopNum, fn: () => writeNumber(p.id, COL.workingOopMax, wOop) });
  if (wOopRemNum) tasks.push({ label: "Working OOP Max Rem", columnId: COL.workingOopMaxRemaining, value: wOopRemNum, fn: () => writeNumber(p.id, COL.workingOopMaxRemaining, wOopRem) });

  // ── OOP estimate (computed by the Calculate button; persisted on send-off too) ──
  if (p.oopFirst?.trim()) tasks.push({ label: "OOP First-Order", columnId: COL.oopFirst, value: p.oopFirst, fn: () => writeText(p.id, COL.oopFirst, p.oopFirst) });
  if (p.oopRecurring?.trim()) tasks.push({ label: "OOP Recurring", columnId: COL.oopRecurring, value: p.oopRecurring, fn: () => writeText(p.id, COL.oopRecurring, p.oopRecurring) });

  // ── Notes (running log) — persisted on send-off so edits aren't overlay-only ──
  if (p.notes?.trim()) tasks.push({ label: "Notes", columnId: COL.notes, value: p.notes, fn: () => writeText(p.id, COL.notes, p.notes) });

  // ── Doctor ──
  statusWriteTask(tasks, p.id, "Doctor Status", COL.doctorStatus, p.doctorStatus, DOCTOR_STATUS_INDEX);
  if (p.doctorName) tasks.push({ label: "Doctor Name", columnId: COL.doctorName, value: p.doctorName, fn: () => writeText(p.id, COL.doctorName, p.doctorName) });
  if (p.doctorPhone) {
    // Same skip semantics as the patient phone above: unparseable → no task.
    const doctorPhonePlan = planPhoneWrite(p.doctorPhone);
    if (doctorPhonePlan.action !== "skip")
      tasks.push({ label: "Doctor Phone", columnId: COL.doctorPhone, value: doctorPhonePlan.action === "write" ? { phone: doctorPhonePlan.phone, countryShortName: "US" } : {}, fn: () => writePhone(p.id, COL.doctorPhone, p.doctorPhone) });
  }
  if (p.doctorNpi) tasks.push({ label: "Doctor NPI", columnId: COL.doctorNpi, value: p.doctorNpi, fn: () => writeText(p.id, COL.doctorNpi, p.doctorNpi) });
  statusWriteTask(tasks, p.id, "Clinicals Method", COL.clinicalsMethod, p.clinicalsMethod, CLINICALS_METHOD_INDEX);
  if (p.doctorEmail) {
    // writeEmail SKIPS an unparseable address (writes nothing) and CLEARS with
    // { email: "", text: "" } — not {}. Mirror both branches exactly.
    const doctorEmailPlan = planEmailWrite(p.doctorEmail);
    const doctorEmailClean = doctorEmailPlan.action === "write" ? doctorEmailPlan.email : "";
    if (doctorEmailPlan.action !== "skip")
      tasks.push({ label: "Doctor Email", columnId: COL.doctorEmail, value: { email: doctorEmailClean, text: doctorEmailClean }, fn: () => writeEmail(p.id, COL.doctorEmail, p.doctorEmail) });
  }
  if (p.doctorFax) {
    // Same as Doctor Email — this is the column emailCell's skip exists to
    // protect (a fax number sitting behind a drifted label).
    const doctorFaxPlan = planEmailWrite(p.doctorFax);
    const doctorFaxClean = doctorFaxPlan.action === "write" ? doctorFaxPlan.email : "";
    if (doctorFaxPlan.action !== "skip")
      tasks.push({ label: "Doctor Fax", columnId: COL.doctorFax, value: { email: doctorFaxClean, text: doctorFaxClean }, fn: () => writeEmail(p.id, COL.doctorFax, p.doctorFax) });
  }
  if (clinicLabelId !== null) {
    tasks.push({ label: "Clinic Name", columnId: COL.clinicName, value: { ids: [clinicLabelId] }, fn: () => writeDropdownIds(p.id, COL.clinicName, [clinicLabelId]) });
  }
  if (p.clinicAddress) tasks.push({ label: "Clinic Address", columnId: COL.clinicAddress, value: { address: p.clinicAddress, lat: p.clinicAddressLat ?? 0, lng: p.clinicAddressLng ?? 0 }, fn: () => writeLocation(p.id, COL.clinicAddress, p.clinicAddress, p.clinicAddressLat ?? 0, p.clinicAddressLng ?? 0) });

  // ── Insurance Plan (copied from Stedi plan name) ──
  // HOISTED out of this task list — it is now written by sendPatientToMonday
  // before the verified batch runs. See the comment there for why.

  // ── Plan Begin Date (date column, from the Stedi ISO text) ──
  // Written before the advancer so the create-item automation can copy it
  // date→date to the next board. The TEXT column can't survive the hop:
  // Monday's automation engine human-formats ISO text ("2022-01-01" →
  // "01 January 2022") when mapping it into the created item.
  const planBegin = (p.stediPlanBeginDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(planBegin)) {
    // profile's writeDate has NO blank guard — it always sends { date }. The
    // regex above guarantees a non-blank ISO date here either way.
    tasks.push({ label: "Plan Begin Date", columnId: COL.planBeginDate, value: { date: planBegin }, fn: () => writeDate(p.id, COL.planBeginDate, planBegin) });
  }

  // ── Active / Not Active (derived from Stedi Eligibility Active) ──
  const activeText = p.stediEligibilityActive?.toLowerCase().trim();
  if (activeText === "yes") {
    tasks.push({ label: "Active/Not Active", columnId: COL.activeNotActive, value: { index: 0 }, fn: () => writeStatusIndex(p.id, COL.activeNotActive, 0) });
  } else if (activeText === "no") {
    tasks.push({ label: "Active/Not Active", columnId: COL.activeNotActive, value: { index: 1 }, fn: () => writeStatusIndex(p.id, COL.activeNotActive, 1) });
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

  return tasks;
}

/**
 * Send all patient data to Monday and ADVANCE to Medical Necessity.
 *
 * Uses verified writes: all data columns are written and polled for
 * indexing BEFORE the "Move to Onboarding" column fires "Advance to MN", so the
 * Monday automation triggered by that status change reads up-to-date values.
 *
 * @param p The local patient state to write
 * @param clinicLabelId If a clinic was selected from dropdown, pass its numeric id
 */
export async function sendPatientToMonday(
  p: Patient,
  clinicLabelId: number | null,
): Promise<void> {
  // ── Insurance Plan (copied from the Stedi plan name) ─────────────────────
  // HOISTED out of the verified batch on purpose: profile's writeDropdownLabels
  // hardcodes `create_labels_if_missing: true`, and
  // change_multiple_column_values carries ONE transaction-wide flag — so
  // batching this write would let every other label-shaped write in this send
  // mint junk board labels (CLAUDE.md §5.6). Every remaining write here is
  // index- or dropdown-id-based (strict), and this one stays a lone
  // create-labels-allowed mutation.
  //
  // It keeps the module's own retry wrapper, so it still gets 3 attempts with
  // backoff exactly as it did while it was a task in the batch, and a
  // persistent failure still aborts the send with the stage NOT advanced.
  //
  // ⚠️ THE HOIST ONLY MAKES THE LABEL EXIST — it is NOT the write that counts.
  // Monday acks a column write BEFORE the value is indexed (§5.2), so a write
  // that left the batch would also leave `verifyColIds`, and the Stage Advancer
  // could fire while this column was still stale — handing the create-item
  // automation the previous or a blank value. "It was written first so it has
  // had longer to index" is a timing argument, not the read-back guarantee §9
  // requires ("verify before you advance").
  //
  // So the two jobs are split. The awaited call guarantees the LABEL EXISTS
  // (it is the only write allowed to create one). The task pushed straight
  // after writes the same value inside the STRICT batch — no create-labels
  // flag needed, because the label exists by then — which puts the column back
  // in `verifyColIds` and holds the advancer until Monday reads the value
  // back. One extra mutation, and the stage boundary is honest again.
  //
  // The hoist is still a plain client-side write, so it does not ride the
  // gateway's durable offline outbox: an offline send fails here rather than
  // queueing, before anything else on the item has changed.
  if (p.stediPlanName?.trim()) {
    const planLabelFailure = await executeWithRetry({
      label: "Insurance Plan (create label)",
      columnId: COL.insurancePlan,
      fn: () => writeDropdownLabels(p.id, COL.insurancePlan, [p.stediPlanName.trim()]),
    });
    if (planLabelFailure) {
      throw new Error(`Insurance Plan failed after retries — stage NOT advanced. ${planLabelFailure}`);
    }
  }

  const tasks = buildDataTasks(p, clinicLabelId);

  // The verified half of the Insurance Plan write — see the hoist comment above.
  if (p.stediPlanName?.trim()) {
    const planLabel = p.stediPlanName.trim();
    // ⚠️ `expectedText` is REQUIRED here, not decoration. This column is written
    // TWICE — once by the hoist above, once in the batch — so the Phase 2
    // snapshot is taken AFTER the hoist rather than before the transaction.
    // If the hoist has not indexed by snapshot time the baseline holds the OLD
    // value, and snapshot-diff would then see "unchanged" on every poll and hit
    // the 3-stable-reads escape hatch, which assumes unchanged means
    // "same-value write, already correct". Here it can equally mean "still
    // stale", and the advancer would fire on the old value. An exact-match
    // check has no such escape hatch: it polls until Monday really reads the
    // label back, or throws with the stage NOT advanced.
    tasks.push({
      label: "Insurance Plan",
      columnId: COL.insurancePlan,
      value: { labels: [planLabel] },
      expectedText: planLabel,
      fn: () => writeDropdownLabels(p.id, COL.insurancePlan, [planLabel]),
    });
  }

  // ── Move to Onboarding (stage advancer — written LAST after verification) ──
  const onboardingIdx = MOVE_TO_ONBOARDING_INDEX["Advance to MN"];
  if (onboardingIdx !== undefined) {
    tasks.push({ label: "Move to Onboarding", columnId: COL.moveToOnboarding, value: { index: onboardingIdx }, fn: () => writeStatusIndex(p.id, COL.moveToOnboarding, onboardingIdx) });
  }

  // ---- Execute with read-back verification before advancing stage ----
  const failures = await executeWritesWithVerification({
    itemId: p.id,
    boardId: String(BOARD_ID),
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

/**
 * Take a patient out of the send-off queue: stamp why, then move them to the
 * board's **Stuck group**.
 *
 * The group IS the marker. Profile Send Off has no "Stuck" status label — its
 * Move to Onboarding column only offers Already Serving / Advance to MN / Send
 * Back To Referral / Need More Info — so nothing about the item says "stuck"
 * except which group it sits in. That also means the reason has nowhere else
 * to live, which is why it's required and stamped with who and when: every
 * item already in that group has an empty `stuck reason`, and a manager
 * looking at one later has no way to find out why it stopped.
 *
 * Reason first, move second: a failed move leaves a stamped patient still in
 * the queue (visible, retryable), where the other order would leave a patient
 * parked in Stuck with no explanation.
 */
export async function markStuck(p: Patient, reason: string, stage: string): Promise<void> {
  const text = reason.trim();
  if (!text) throw new Error("A reason is required to mark a patient stuck");
  await writeText(p.id, COL.stuckReason, stampNoteEntry(text, stage));
  await moveItemToGroup(p.id, GROUPS.stuck);
}

/**
 * The Already In System queue's "workable after all" exit (Josh, 2026-08-18 —
 * it REPLACES Advance to MN on that page): write Already In System → **"No"**,
 * then move the item back to **1. Intake**, where the §5.10 split makes it a
 * Verified Referral. "No" rather than blank on purpose — a rep examined the
 * referral and answered the question; a cleared column reads as never checked.
 *
 * Flag first, move second: either half-failure leaves the patient still
 * visible in the Already In System queue (that role is group OR status, so an
 * un-moved item stays by group and a moved-but-still-"Yes" item would stay by
 * flag), where the rep just retries. No verified-write ceremony needed — the
 * one board automation on this column (**7922049614**, added 2026-08-18)
 * fires on a change to "Yes" and moves the item INTO the in-system group;
 * writing "No" and a direct group move trigger nothing.
 */
export async function moveToProfileSendOff(p: Patient): Promise<void> {
  await writeStatusIndex(p.id, COL.alreadyInSystem, ALREADY_IN_SYSTEM_INDEX["No"]);
  await moveItemToGroup(p.id, GROUPS.intake);
}

/**
 * Pre-Stedi benefits inputs — General Insurance + working Member ID.
 * Written immediately (before "Run Stedi") so the Stedi check reads the
 * rep-entered values. Best-effort; not a stage advancer.
 */
export async function writeBenefitsInputs(
  itemId: string,
  generalInsurance: string,
  workingMemberId: string,
): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  const gi = GENERAL_INSURANCE_INDEX[generalInsurance];
  if (generalInsurance && gi !== undefined) jobs.push(writeStatusIndex(itemId, COL.generalInsurance, gi));
  if (workingMemberId) jobs.push(writeText(itemId, COL.memberIdWorking, workingMemberId));
  await Promise.all(jobs);
}

/**
 * Persist the patient Notes column immediately (append-log). Not a stage
 * advancer, so a plain write is fine; also written on send-off via buildDataTasks.
 */
export async function writeProfileNotes(itemId: string, notes: string): Promise<void> {
  await writeText(itemId, COL.notes, notes);
}

/**
 * Write the two OOP estimate columns (First-Order + Recurring). Triggered by
 * the "Calculate OOP Estimate" button after Serving is chosen; the UI then
 * reads the values back. Written in parallel; not a stage advancer.
 */
export async function writeOopEstimate(
  itemId: string,
  first: string,
  recurring: string,
): Promise<void> {
  await Promise.all([
    writeText(itemId, COL.oopFirst, first),
    writeText(itemId, COL.oopRecurring, recurring),
  ]);
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
  if (p.ptPhone) tasks.push(writePhone(p.id, COL.ptPhone, p.ptPhone));
  if (p.email) tasks.push(writeText(p.id, COL.email, p.email));
  tasks.push(statusPromise(p.id, COL.gender, p.gender, GENDER_INDEX));
  if (p.patientAddress) tasks.push(writeLocation(p.id, COL.patientAddress, p.patientAddress, p.patientAddressLat ?? 0, p.patientAddressLng ?? 0));

  // Insurance
  tasks.push(statusPromise(p.id, COL.generalInsurance, p.generalInsurance, GENERAL_INSURANCE_INDEX));
  // Working Member ID — the column the Stedi service READS (text_mm4t8gbq).
  // Falls back to Member ID 1 for pre-redesign items whose working field is blank.
  const workingId = (p.workingMemberId || p.memberId1 || "").trim();
  if (workingId) tasks.push(writeText(p.id, COL.memberIdWorking, workingId));
  if (p.memberId1) tasks.push(writeText(p.id, COL.memberId1, p.memberId1));
  if (p.memberId2) tasks.push(writeText(p.id, COL.memberId2, p.memberId2));

  await Promise.all(tasks.filter(Boolean));
}

/**
 * After writing, re-fetch the item from Monday and verify the four key
 * Stedi-input fields (Name, DOB, General Insurance, working Member ID) match
 * what we expected to write. The working Member ID is the column Stedi reads
 * (text_mm4t8gbq), so it's the one that must land before the check runs.
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
    workingMemberId: string;
  },
): Promise<{ ok: boolean; mismatches: string[] }> {
  const item = await fetchItem(itemId, [
    COL.dob,
    COL.generalInsurance,
    COL.memberIdWorking,
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
  if (cv(COL.memberIdWorking) !== expected.workingMemberId) {
    mismatches.push(
      `Member ID (Monday: "${cv(COL.memberIdWorking)}", expected: "${expected.workingMemberId}")`,
    );
  }
  return { ok: mismatches.length === 0, mismatches };
}
