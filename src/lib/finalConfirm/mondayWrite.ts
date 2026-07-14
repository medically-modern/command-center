import { writeStatusIndex, writeStatusLabel, writeLongText, writeText, writeNumber, writeLocation, writeDate, writePhone, writeEmail, writeDropdownIds, renameItem, readColumnTexts, COL } from "./mondayApi";
import { executeWritesWithVerification } from "../shared/verifiedWrite";
import type { Patient } from "./workflow";
import { CLINIC_NAME_OPTIONS } from "./workflow";

// Stage Advancer: index 4 = Completed
const STAGE_ADVANCER_COMPLETED = 4;

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
        `[mondayWrite:finalConfirm] ${task.label} (${task.columnId}) failed attempt ${attempt + 1}/${MAX_RETRIES + 1}: ${msg}`,
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
 * Push all edits for a final-profile-confirmed patient to Monday.
 * Then flip Stage Advancer → Completed so Monday automations can
 * move the item to Subscription & Order boards.
 */
export async function sendPatientToMonday(p: Patient): Promise<void> {
  const tasks: WriteTask[] = [];

  // ─── Item name (always write — cheap no-op if unchanged) ──
  if (typeof p.name === "string" && p.name.trim() !== "") {
    tasks.push({
      label: "Patient Name",
      columnId: "name",
      fn: () => renameItem(p.id, p.name.trim()),
    });
  }

  // ─── Demographics edits ───────────────────────────────────
  // DOB (text column)
  tasks.push({ label: "DOB", columnId: COL.dob, fn: () => writeText(p.id, COL.dob, p.dob) });

  // Phone (phone column — needs {phone, countryShortName} JSON)
  if (p.phoneEdited !== null && p.phoneEdited !== "")
    tasks.push({ label: "Phone", columnId: COL.phone, fn: () => writePhone(p.id, COL.phone, p.phoneEdited!) });

  // Email (text column — patient email is stored as plain text, not email type)
  if (p.emailEdited !== null && p.emailEdited !== "")
    tasks.push({ label: "Email", columnId: COL.email, fn: () => writeText(p.id, COL.email, p.emailEdited!) });

  // Address (location column — needs {address, lat, lng} JSON)
  if (p.addressEdited !== null && p.addressEdited !== "") {
    const lat = p.addressLat ?? 0;
    const lng = p.addressLng ?? 0;
    tasks.push({ label: "Address", columnId: COL.address, fn: () => writeLocation(p.id, COL.address, p.addressEdited!, lat, lng) });
  }

  // Gender (status column)
  if (p.genderIndex !== null)
    tasks.push({ label: "Gender", columnId: COL.gender, fn: () => writeStatusIndex(p.id, COL.gender, p.genderIndex!) });

  // ─── Insurance edits ──────────────────────────────────────
  // Primary Insurance (status column)
  if (p.primaryInsuranceIndex !== null)
    tasks.push({ label: "Primary Insurance", columnId: COL.primaryInsurance, fn: () => writeStatusIndex(p.id, COL.primaryInsurance, p.primaryInsuranceIndex!) });

  // Member ID 1 (text column)
  tasks.push({ label: "Member ID 1", columnId: COL.memberId1, fn: () => writeText(p.id, COL.memberId1, p.memberId1) });

  // Secondary Insurance (status column)
  if (p.secondaryInsuranceEdited !== null && p.secondaryInsuranceIndex !== null)
    tasks.push({ label: "Secondary Insurance", columnId: COL.secondaryInsurance, fn: () => writeStatusIndex(p.id, COL.secondaryInsurance, p.secondaryInsuranceIndex!) });

  // Member ID 2 (text column)
  if (p.memberId2Edited !== null && p.memberId2Edited !== "")
    tasks.push({ label: "Member ID 2", columnId: COL.memberId2, fn: () => writeText(p.id, COL.memberId2, p.memberId2Edited!) });

  // Deductible fields (all text columns)
  tasks.push({ label: "Deductible", columnId: COL.deductible, fn: () => writeText(p.id, COL.deductible, p.deductible) });
  tasks.push({ label: "Deductible Remaining", columnId: COL.deductibleRemaining, fn: () => writeText(p.id, COL.deductibleRemaining, p.deductibleRemaining) });
  tasks.push({ label: "Co-Insurance %", columnId: COL.coInsurance, fn: () => writeText(p.id, COL.coInsurance, p.coInsurance) });
  tasks.push({ label: "OOP Max", columnId: COL.oopMax, fn: () => writeText(p.id, COL.oopMax, p.oopMax) });
  tasks.push({ label: "OOP Max Remaining", columnId: COL.oopMaxRemaining, fn: () => writeText(p.id, COL.oopMaxRemaining, p.oopMaxRemaining) });

  // ─── Doctor edits ────────────────────────────────────────
  // Doctor Name (text column)
  tasks.push({ label: "Doctor Name", columnId: COL.doctorName, fn: () => writeText(p.id, COL.doctorName, p.doctorName) });

  // Doctor NPI (text column)
  tasks.push({ label: "Doctor NPI", columnId: COL.doctorNpi, fn: () => writeText(p.id, COL.doctorNpi, p.doctorNpi) });

  // Doctor Phone (phone column — needs {phone, countryShortName} JSON)
  if (p.doctorPhone)
    tasks.push({ label: "Doctor Phone", columnId: COL.doctorPhone, fn: () => writePhone(p.id, COL.doctorPhone, p.doctorPhone) });

  // Doctor Email (email column — needs {text, email} JSON)
  if (p.doctorEmail)
    tasks.push({ label: "Doctor Email", columnId: COL.doctorEmail, fn: () => writeEmail(p.id, COL.doctorEmail, p.doctorEmail) });

  // Doctor Fax (email column — Monday stores fax as email type, needs {text, email} JSON)
  if (p.doctorFax)
    tasks.push({ label: "Doctor Fax", columnId: COL.doctorFax, fn: () => writeEmail(p.id, COL.doctorFax, p.doctorFax) });

  // Clinicals Method (status column)
  if (p.clinicalsMethodIndex !== null)
    tasks.push({ label: "Clinicals Method", columnId: COL.clinicalsMethod, fn: () => writeStatusIndex(p.id, COL.clinicalsMethod, p.clinicalsMethodIndex!) });

  // Clinic Name (dropdown column — needs {ids: [id]} JSON, look up by label)
  if (p.clinicName) {
    const clinicOpt = CLINIC_NAME_OPTIONS.find((o) => o.label === p.clinicName);
    if (clinicOpt)
      tasks.push({ label: "Clinic Name", columnId: COL.clinicName, fn: () => writeDropdownIds(p.id, COL.clinicName, [clinicOpt.id]) });
  }

  // Clinic Address (location column — needs {address, lat, lng} JSON)
  if (p.clinicAddressEdited !== null && p.clinicAddressEdited !== "") {
    const clat = p.clinicAddressLat ?? 0;
    const clng = p.clinicAddressLng ?? 0;
    tasks.push({ label: "Clinic Address", columnId: COL.clinicAddress, fn: () => writeLocation(p.id, COL.clinicAddress, p.clinicAddressEdited!, clat, clng) });
  }

  // Carecentrix Intake ID (text column — only when referral source is CareCentrix)
  if (p.carecentrixIntakeId)
    tasks.push({ label: "Carecentrix Intake ID", columnId: COL.carecentrixIntakeId, fn: () => writeText(p.id, COL.carecentrixIntakeId, p.carecentrixIntakeId) });

  // ─── Medical Necessity edits ─────────────────────────────
  // Diagnosis (status column — written by label; createIfMissing=true so
  // custom ICD-10 codes become permanent statuses on Monday)
  if (p.diagnosis)
    tasks.push({ label: "Diagnosis", columnId: COL.diagnosis, fn: () => writeStatusLabel(p.id, COL.diagnosis, p.diagnosis, true) });

  // MR Expiry Date (date column — needs {date: "YYYY-MM-DD"} JSON)
  tasks.push({ label: "MR Expiry Date", columnId: COL.mrExpiryDate, fn: () => writeDate(p.id, COL.mrExpiryDate, p.mrExpiryDate) });

  // Request Type (status column)
  if (p.requestTypeIndex !== null)
    tasks.push({ label: "Request Type", columnId: COL.requestType, fn: () => writeStatusIndex(p.id, COL.requestType, p.requestTypeIndex!) });

  // ─── Product / Order edits ────────────────────────────────
  // Serving + Pump/CGM Type + Coverage Paths are written on every Send so
  // Split Order's "Not Serving" overrides land on Monday. For a non-split
  // submit, these are no-ops (writing the value already on Monday).
  if (p.servingIndex !== null)
    tasks.push({ label: "Serving", columnId: COL.serving, fn: () => writeStatusIndex(p.id, COL.serving, p.servingIndex!) });

  if (p.pumpTypeIndex !== null)
    tasks.push({ label: "Pump Type", columnId: COL.pumpType, fn: () => writeStatusIndex(p.id, COL.pumpType, p.pumpTypeIndex!) });

  if (p.cgmTypeIndex !== null)
    tasks.push({ label: "CGM Type", columnId: COL.cgmType, fn: () => writeStatusIndex(p.id, COL.cgmType, p.cgmTypeIndex!) });

  if (p.cgmCoveragePathIndex !== null)
    tasks.push({ label: "CGM Coverage Path", columnId: COL.cgmCoveragePath, fn: () => writeStatusIndex(p.id, COL.cgmCoveragePath, p.cgmCoveragePathIndex!) });

  if (p.ipCoveragePathIndex !== null)
    tasks.push({ label: "IP Coverage Path", columnId: COL.ipCoveragePath, fn: () => writeStatusIndex(p.id, COL.ipCoveragePath, p.ipCoveragePathIndex!) });

  // Auth Results — same reasoning. Split sets some to Not Serving (index 7).
  if (p.cgmAuthResultIndex !== null)
    tasks.push({ label: "CGM Auth Result", columnId: COL.cgmAuthResult, fn: () => writeStatusIndex(p.id, COL.cgmAuthResult, p.cgmAuthResultIndex!) });

  if (p.sensorsAuthResultIndex !== null)
    tasks.push({ label: "Sensors Auth Result", columnId: COL.sensorsAuthResult, fn: () => writeStatusIndex(p.id, COL.sensorsAuthResult, p.sensorsAuthResultIndex!) });

  if (p.ipAuthResultIndex !== null)
    tasks.push({ label: "IP Auth Result", columnId: COL.ipAuthResult, fn: () => writeStatusIndex(p.id, COL.ipAuthResult, p.ipAuthResultIndex!) });

  if (p.infusionSetAuthResultIndex !== null)
    tasks.push({ label: "Infusion Set Auth Result", columnId: COL.infusionSetAuthResult, fn: () => writeStatusIndex(p.id, COL.infusionSetAuthResult, p.infusionSetAuthResultIndex!) });

  if (p.cartridgeAuthResultIndex !== null)
    tasks.push({ label: "Cartridge Auth Result", columnId: COL.cartridgeAuthResult, fn: () => writeStatusIndex(p.id, COL.cartridgeAuthResult, p.cartridgeAuthResultIndex!) });

  if (p.subscriptionTypeIndex !== null)
    tasks.push({ label: "Subscription Type", columnId: COL.subscriptionType, fn: () => writeStatusIndex(p.id, COL.subscriptionType, p.subscriptionTypeIndex!) });

  if (p.infusionSet1Index !== null)
    tasks.push({ label: "Infusion Set 1", columnId: COL.infusionSet1, fn: () => writeStatusIndex(p.id, COL.infusionSet1, p.infusionSet1Index!) });

  // Always write number cells — empty string clears the cell on Monday
  // (necessary for Split Order, where Pump Qty / Qty Inf 1/2 are cleared so
  // automations gated on "is empty" can fire).
  tasks.push({
    label: "Infusion Set 1 Qty",
    columnId: COL.qtyInf1,
    fn: () => writeNumber(p.id, COL.qtyInf1, p.qtyInf1 === "" ? "" : Number(p.qtyInf1)),
  });

  if (p.infusionSet2Index !== null)
    tasks.push({ label: "Infusion Set 2", columnId: COL.infusionSet2, fn: () => writeStatusIndex(p.id, COL.infusionSet2, p.infusionSet2Index!) });

  tasks.push({
    label: "Infusion Set 2 Qty",
    columnId: COL.qtyInf2,
    fn: () => writeNumber(p.id, COL.qtyInf2, p.qtyInf2 === "" ? "" : Number(p.qtyInf2)),
  });

  tasks.push({
    label: "Qty Cartridge",
    columnId: COL.qtyCartridge,
    fn: () => writeNumber(p.id, COL.qtyCartridge, p.qtyCartridge === "" ? "" : Number(p.qtyCartridge)),
  });

  tasks.push({
    label: "Monitor Qty",
    columnId: COL.monitorQty,
    fn: () => writeNumber(p.id, COL.monitorQty, p.monitorQty === "" ? "" : Number(p.monitorQty)),
  });

  tasks.push({
    label: "Pump Qty",
    columnId: COL.pumpQty,
    fn: () => writeNumber(p.id, COL.pumpQty, p.pumpQty === "" ? "" : Number(p.pumpQty)),
  });

  // Medicare Prior Pump Date (Original-Medicare-only MM/YYYY text). Always write
  // so an empty value clears the cell (matches the other text/number fields here).
  tasks.push({
    label: "Medicare Prior Pump Date",
    columnId: COL.medicarePriorPumpDate,
    fn: () => writeText(p.id, COL.medicarePriorPumpDate, p.medicarePriorPumpDate),
  });

  if (p.orderHandlingIndex !== null)
    tasks.push({ label: "Order Handling", columnId: COL.orderHandling, fn: () => writeStatusIndex(p.id, COL.orderHandling, p.orderHandlingIndex!) });

  // ─── Notes ────────────────────────────────────────────────
  if (typeof p.notes === "string" && p.notes.trim() !== "")
    tasks.push({ label: "Notes", columnId: COL.notes, fn: () => writeLongText(p.id, COL.notes, p.notes) });

  // ─── Last Bill Dates (always write current value) ────────────
  const lastBillDateEntries: { label: string; dateVal: string; colId: string }[] = [
    { label: "CGM Last Bill Date", dateVal: p.lastBillDateMonitor, colId: COL.lastBillDate.monitor },
    { label: "Sensors Last Bill Date", dateVal: p.lastBillDateSensors, colId: COL.lastBillDate.sensors },
    { label: "IP Last Bill Date", dateVal: p.lastBillDateIp, colId: COL.lastBillDate.insulin_pump },
    { label: "Infusion Set Last Bill Date", dateVal: p.lastBillDateInfusionSet, colId: COL.lastBillDate.infusion_set },
    { label: "Cartridge Last Bill Date", dateVal: p.lastBillDateCartridge, colId: COL.lastBillDate.cartridge },
  ];
  for (const entry of lastBillDateEntries) {
    tasks.push({ label: entry.label, columnId: entry.colId, fn: () => writeDate(p.id, entry.colId, entry.dateVal) });
  }

  // ─── Next Order Dates (user-editable, written directly) ──
  const nextOrderDateEntries: { label: string; dateVal: string; colId: string }[] = [
    { label: "IP Next Order Date", dateVal: p.nextOrderDateIp, colId: COL.nextOrderDate.insulin_pump },
    { label: "Sensors Next Order Date", dateVal: p.nextOrderDateSensors, colId: COL.nextOrderDate.sensors },
    { label: "Supplies Next Order Date", dateVal: p.nextOrderDateSupplies, colId: COL.nextOrderDate.supplies },
  ];
  for (const entry of nextOrderDateEntries) {
    tasks.push({ label: entry.label, columnId: entry.colId, fn: () => writeDate(p.id, entry.colId, entry.dateVal) });
  }

  // ─── Escalation ───────────────────────────────────────────
  if (p.escalated)
    tasks.push({ label: "Escalation", columnId: COL.escalation, fn: () => writeStatusIndex(p.id, COL.escalation, 0) });

  // ─── Stage Advancer (added to tasks — verified write handles ordering) ───
  tasks.push({
    label: "Stage Advancer",
    columnId: COL.stageAdvancer,
    fn: () => writeStatusIndex(p.id, COL.stageAdvancer, STAGE_ADVANCER_COMPLETED),
  });

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