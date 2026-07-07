import { writeStatusIndex, writeNumber, writeLocation, writeText, writeLongText, writeDate, writePhone, readColumnTexts, COL } from "./mondayApi";
import { executeWritesWithVerification } from "../shared/verifiedWrite";
import type { Patient } from "./workflow";

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
        `[mondayWrite:welcomeCall] ${task.label} (${task.columnId}) failed attempt ${attempt + 1}/${MAX_RETRIES + 1}: ${msg}`,
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

export async function sendPatientToMonday(p: Patient): Promise<void> {
  const tasks: WriteTask[] = [];

  // Phone edit
  if (p.phoneEdited !== null && p.phoneEdited !== "") {
    tasks.push({
      label: "Phone",
      columnId: COL.phone,
      fn: () => writePhone(p.id, COL.phone, p.phoneEdited!),
    });
  }

  // Serving override
  if (p.servingIndexEdited !== null)
    tasks.push({ label: "Serving", columnId: COL.serving, fn: () => writeStatusIndex(p.id, COL.serving, p.servingIndexEdited!) });

  // CGM Type override
  if (p.cgmTypeIndex !== null)
    tasks.push({ label: "CGM Type", columnId: COL.cgmType, fn: () => writeStatusIndex(p.id, COL.cgmType, p.cgmTypeIndex!) });

  // Pump Type override
  if (p.pumpTypeIndex !== null)
    tasks.push({ label: "Pump Type", columnId: COL.pumpType, fn: () => writeStatusIndex(p.id, COL.pumpType, p.pumpTypeIndex!) });

  // Primary Insurance (only if edited)
  if (p.primaryInsuranceIndexEdited !== null)
    tasks.push({ label: "Primary Insurance", columnId: COL.primaryInsurance, fn: () => writeStatusIndex(p.id, COL.primaryInsurance, p.primaryInsuranceIndexEdited!) });

  // Member ID 1 (only if edited)
  if (p.memberId1Edited !== null && p.memberId1Edited !== "")
    tasks.push({ label: "Member ID 1", columnId: COL.memberId1, fn: () => writeText(p.id, COL.memberId1, p.memberId1Edited!) });

  // Secondary Insurance (only if edited)
  if (p.secondaryInsuranceEdited !== null && p.secondaryInsuranceIndex !== null)
    tasks.push({ label: "Secondary Insurance", columnId: COL.secondaryInsurance, fn: () => writeStatusIndex(p.id, COL.secondaryInsurance, p.secondaryInsuranceIndex!) });

  // Member ID 2 (only if edited)
  if (p.memberId2Edited !== null && p.memberId2Edited !== "")
    tasks.push({ label: "Member ID 2", columnId: COL.memberId2, fn: () => writeText(p.id, COL.memberId2, p.memberId2Edited!) });

  if (p.monitorQty !== "") tasks.push({ label: "Monitor Qty", columnId: COL.monitorQty, fn: () => writeNumber(p.id, COL.monitorQty, Number(p.monitorQty)) });
  if (p.pumpQty !== "") tasks.push({ label: "Pump Qty", columnId: COL.pumpQty, fn: () => writeNumber(p.id, COL.pumpQty, Number(p.pumpQty)) });
  if (p.qtyInf1 !== "") tasks.push({ label: "Infusion Set 1 Qty", columnId: COL.qtyInf1, fn: () => writeNumber(p.id, COL.qtyInf1, Number(p.qtyInf1)) });
  if (p.qtyInf2 !== "") tasks.push({ label: "Infusion Set 2 Qty", columnId: COL.qtyInf2, fn: () => writeNumber(p.id, COL.qtyInf2, Number(p.qtyInf2)) });
  if (p.qtyCartridge !== "") tasks.push({ label: "Qty Cartridge", columnId: COL.qtyCartridge, fn: () => writeNumber(p.id, COL.qtyCartridge, Number(p.qtyCartridge)) });

  if (p.infusionSet1Index !== null)
    tasks.push({ label: "Infusion Set 1", columnId: COL.infusionSet1, fn: () => writeStatusIndex(p.id, COL.infusionSet1, p.infusionSet1Index!) });
  if (p.infusionSet2Index !== null)
    tasks.push({ label: "Infusion Set 2", columnId: COL.infusionSet2, fn: () => writeStatusIndex(p.id, COL.infusionSet2, p.infusionSet2Index!) });
  if (p.subscriptionTypeIndex !== null)
    tasks.push({ label: "Subscription Type", columnId: COL.subscriptionType, fn: () => writeStatusIndex(p.id, COL.subscriptionType, p.subscriptionTypeIndex!) });
  if (p.welcomeCallTextIndex !== null)
    tasks.push({ label: "Welcome Call Text", columnId: COL.welcomeCallText, fn: () => writeStatusIndex(p.id, COL.welcomeCallText, p.welcomeCallTextIndex!) });
  if (p.orderHandlingIndex !== null)
    tasks.push({ label: "Order Handling", columnId: COL.orderHandling, fn: () => writeStatusIndex(p.id, COL.orderHandling, p.orderHandlingIndex!) });
  if (p.advanceDecisionIndex !== null)
    tasks.push({ label: "Advance Decision", columnId: COL.advanceDecision, fn: () => writeStatusIndex(p.id, COL.advanceDecision, p.advanceDecisionIndex!) });

  if (p.addressEdited !== null) {
    const lat = p.addressLat ?? 0;
    const lng = p.addressLng ?? 0;
    tasks.push({ label: "Address", columnId: COL.address, fn: () => writeLocation(p.id, COL.address, p.addressEdited!, lat, lng) });
  }

  // Next order dates (only if edited)
  if (p.ipNextOrderDateEdited !== null && p.ipNextOrderDateEdited !== "")
    tasks.push({ label: "IP Next Order Date", columnId: COL.ipNextOrderDate, fn: () => writeDate(p.id, COL.ipNextOrderDate, p.ipNextOrderDateEdited!) });
  if (p.sensorsNextOrderDateEdited !== null && p.sensorsNextOrderDateEdited !== "")
    tasks.push({ label: "Sensors Next Order Date", columnId: COL.sensorsNextOrderDate, fn: () => writeDate(p.id, COL.sensorsNextOrderDate, p.sensorsNextOrderDateEdited!) });
  if (p.suppliesNextOrderDateEdited !== null && p.suppliesNextOrderDateEdited !== "")
    tasks.push({ label: "Supplies Next Order Date", columnId: COL.suppliesNextOrderDate, fn: () => writeDate(p.id, COL.suppliesNextOrderDate, p.suppliesNextOrderDateEdited!) });

  // Notes
  if (typeof p.notes === "string" && p.notes.trim() !== "") {
    tasks.push({ label: "Notes", columnId: COL.notes, fn: () => writeLongText(p.id, COL.notes, p.notes) });
  }

  // Escalation toggle — if flagged, write Escalation Required
  if (p.escalated) {
    tasks.push({ label: "Escalation", columnId: COL.escalation, fn: () => writeStatusIndex(p.id, COL.escalation, 0) });
  }

  // Stage advancer — Review Profile
  tasks.push({ label: "Stage Advancer", columnId: COL.stageAdvancer, fn: () => writeStatusIndex(p.id, COL.stageAdvancer, 0) });

  // ---- Execute with read-back verification before advancing stage ----
  const failures = await executeWritesWithVerification({
    itemId: p.id,
    tasks,
    stageColumnId: COL.stageAdvancer,
    executeWithRetry,
    readColumns: readColumnTexts,
    writeDebug: (id, msg) => writeText(id, COL.joshDebug, msg),
  });

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} column(s) failed after retries. Check "Josh Debug" column. Failed: ${failures.map((f) => f.split(":")[0]).join(", ")}`,
    );
  }
}

/**
 * Welcome Call Text flow:
 *  1. Push every form field that the auto-text might consume (CGM type, monitor qty,
 *     pump type, infusion sets + qtys, subscription type, order handling, address,
 *     and any insurance / member-ID edits) FIRST.
 *  2. THEN flip Welcome Call Text status to Send (index 0).
 *
 * The two phases are sequenced — Monday's automation reads column values when the
 * status flips, so the data writes must be fully committed before the trigger fires.
 */
export async function sendWelcomeCallTextToMonday(p: Patient): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  // Serving override
  if (p.servingIndexEdited !== null)
    tasks.push(writeStatusIndex(p.id, COL.serving, p.servingIndexEdited));

  // CGM Type
  if (p.cgmTypeIndex !== null)
    tasks.push(writeStatusIndex(p.id, COL.cgmType, p.cgmTypeIndex));

  // Pump Type — re-write so Monday has the latest source value before the automation fires
  if (p.pumpTypeIndex !== null)
    tasks.push(writeStatusIndex(p.id, COL.pumpType, p.pumpTypeIndex));

  // Numbers
  if (p.monitorQty !== "") tasks.push(writeNumber(p.id, COL.monitorQty, Number(p.monitorQty)));
  if (p.pumpQty !== "") tasks.push(writeNumber(p.id, COL.pumpQty, Number(p.pumpQty)));
  if (p.qtyInf1 !== "") tasks.push(writeNumber(p.id, COL.qtyInf1, Number(p.qtyInf1)));
  if (p.qtyInf2 !== "") tasks.push(writeNumber(p.id, COL.qtyInf2, Number(p.qtyInf2)));
  if (p.qtyCartridge !== "") tasks.push(writeNumber(p.id, COL.qtyCartridge, Number(p.qtyCartridge)));

  // Infusion Sets + Subscription Type + Order Handling
  if (p.infusionSet1Index !== null)
    tasks.push(writeStatusIndex(p.id, COL.infusionSet1, p.infusionSet1Index));
  if (p.infusionSet2Index !== null)
    tasks.push(writeStatusIndex(p.id, COL.infusionSet2, p.infusionSet2Index));
  if (p.subscriptionTypeIndex !== null)
    tasks.push(writeStatusIndex(p.id, COL.subscriptionType, p.subscriptionTypeIndex));
  if (p.orderHandlingIndex !== null)
    tasks.push(writeStatusIndex(p.id, COL.orderHandling, p.orderHandlingIndex));

  // Primary insurance & Member ID 1 (only if locally edited)
  if (p.primaryInsuranceIndexEdited !== null)
    tasks.push(writeStatusIndex(p.id, COL.primaryInsurance, p.primaryInsuranceIndexEdited));
  if (p.memberId1Edited !== null && p.memberId1Edited !== "")
    tasks.push(writeText(p.id, COL.memberId1, p.memberId1Edited));

  // Secondary insurance & Member ID 2 (only if locally edited)
  if (p.secondaryInsuranceEdited !== null && p.secondaryInsuranceIndex !== null)
    tasks.push(writeStatusIndex(p.id, COL.secondaryInsurance, p.secondaryInsuranceIndex));
  if (p.memberId2Edited !== null && p.memberId2Edited !== "")
    tasks.push(writeText(p.id, COL.memberId2, p.memberId2Edited));

  // Address
  if (p.addressEdited !== null) {
    const lat = p.addressLat ?? 0;
    const lng = p.addressLng ?? 0;
    tasks.push(writeLocation(p.id, COL.address, p.addressEdited, lat, lng));
  }

  // Phase 1: wait for every data field to commit
  await Promise.all(tasks);

  // Phase 2: now flip Welcome Call Text to Send so the Monday automation fires
  // with up-to-date column values.
  await writeStatusIndex(p.id, COL.welcomeCallText, 0);
}

/**
 * Immediately push phone to Monday (called on check-mark press).
 */
export async function sendPhoneToMonday(itemId: string, phone: string): Promise<void> {
  await writePhone(itemId, COL.phone, phone);
}

/**
 * Immediately push secondary insurance to Monday (called when dropdown changes).
 */
export async function sendSecondaryInsuranceToMonday(itemId: string, statusIndex: number): Promise<void> {
  await writeStatusIndex(itemId, COL.secondaryInsurance, statusIndex);
}

/**
 * Immediately push notes to Monday (called on Add press).
 */
export async function sendNotesToMonday(itemId: string, notes: string): Promise<void> {
  await writeLongText(itemId, COL.notes, notes);
}

/**
 * Immediately push call attempts count to Monday (called on +1 press).
 */
export async function sendCallAttemptsToMonday(itemId: string, count: number): Promise<void> {
  await writeText(itemId, COL.callAttempts, String(count));
}

/** Follow-up index — "Done" label at index 1 is used as our Follow-up marker. */
export const FOLLOW_UP_STATUS_INDEX = 1;

/**
 * Mark a patient for follow up: set Follow Up status + Follow Up Date.
 * Called from CallAttemptsCounter when +1 is clicked.
 */
export async function sendFollowUpToMonday(itemId: string, date: string): Promise<void> {
  await Promise.all([
    writeStatusIndex(itemId, COL.followUp, FOLLOW_UP_STATUS_INDEX),
    writeDate(itemId, COL.followUpDate, date),
  ]);
}