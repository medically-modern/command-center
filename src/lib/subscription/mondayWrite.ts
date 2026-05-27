import { writeStatusIndex, writeNumber, writeLocation, writeText, writeLongText, writeDate, writeDropdownIds, writePhone, writeEmail, COL } from "./mondayApi";
import type { Patient } from "./workflow";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;

interface WriteTask {
  label: string;
  columnId: string;
  fn: () => Promise<unknown>;
}

async function executeWithRetry(task: WriteTask): Promise<string | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await task.fn();
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[mondayWrite:subscription] ${task.label} (${task.columnId}) failed attempt ${attempt + 1}/${MAX_RETRIES + 1}: ${msg}`,
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

  // Status — display-only, NOT sent to Monday

  // Ordering Cycle
  if (p.orderingCycleIndex !== null)
    tasks.push({ label: "Ordering Cycle", columnId: COL.orderingCycle, fn: () => writeStatusIndex(p.id, COL.orderingCycle, p.orderingCycleIndex!) });

  // Subscription
  if (p.subscriptionIndex !== null)
    tasks.push({ label: "Subscription", columnId: COL.subscription, fn: () => writeStatusIndex(p.id, COL.subscription, p.subscriptionIndex!) });

  // Order Type
  if (p.orderTypeIndex !== null)
    tasks.push({ label: "Order Type", columnId: COL.orderType, fn: () => writeStatusIndex(p.id, COL.orderType, p.orderTypeIndex!) });

  // Sensors Type
  if (p.sensorsTypeIndex !== null)
    tasks.push({ label: "Sensors Type", columnId: COL.sensorsType, fn: () => writeStatusIndex(p.id, COL.sensorsType, p.sensorsTypeIndex!) });

  // Supplies Type
  if (p.suppliesTypeIndex !== null)
    tasks.push({ label: "Supplies Type", columnId: COL.suppliesType, fn: () => writeStatusIndex(p.id, COL.suppliesType, p.suppliesTypeIndex!) });

  // Infusion Sets
  if (p.infusionSet1Index !== null)
    tasks.push({ label: "Infusion Set 1", columnId: COL.infusionSet1, fn: () => writeStatusIndex(p.id, COL.infusionSet1, p.infusionSet1Index!) });
  if (p.infusionSet2Index !== null)
    tasks.push({ label: "Infusion Set 2", columnId: COL.infusionSet2, fn: () => writeStatusIndex(p.id, COL.infusionSet2, p.infusionSet2Index!) });

  // Quantities
  if (p.infQty1 !== "")
    tasks.push({ label: "Inf. Qty 1", columnId: COL.infQty1, fn: () => writeNumber(p.id, COL.infQty1, Number(p.infQty1)) });
  if (p.infQty2 !== "")
    tasks.push({ label: "Inf. Qty 2", columnId: COL.infQty2, fn: () => writeNumber(p.id, COL.infQty2, Number(p.infQty2)) });

  // Next Order date
  if (p.nextOrder)
    tasks.push({ label: "Next Order", columnId: COL.nextOrder, fn: () => writeDate(p.id, COL.nextOrder, p.nextOrder) });

  // Phone edit
  if (p.phoneEdited !== null && p.phoneEdited !== "")
    tasks.push({ label: "Phone", columnId: COL.phone, fn: () => writePhone(p.id, COL.phone, p.phoneEdited!) });

  // Address edit
  if (p.addressEdited !== null) {
    const lat = p.addressLat ?? 0;
    const lng = p.addressLng ?? 0;
    tasks.push({ label: "Address", columnId: COL.address, fn: () => writeLocation(p.id, COL.address, p.addressEdited!, lat, lng) });
  }

  // Member ID edits
  if (p.memberId1Edited !== null && p.memberId1Edited !== "")
    tasks.push({ label: "Member ID 1", columnId: COL.memberId1, fn: () => writeText(p.id, COL.memberId1, p.memberId1Edited!) });
  if (p.memberId2Edited !== null && p.memberId2Edited !== "")
    tasks.push({ label: "Member ID 2", columnId: COL.memberId2, fn: () => writeText(p.id, COL.memberId2, p.memberId2Edited!) });

  // Secondary insurance
  if (p.secondaryInsuranceIndex !== null)
    tasks.push({ label: "Secondary Insurance", columnId: COL.secondaryInsurance, fn: () => writeStatusIndex(p.id, COL.secondaryInsurance, p.secondaryInsuranceIndex!) });

  // Sensors Auth Status
  if (p.sensorsAuthStatusIndex !== null)
    tasks.push({ label: "Sensors Auth Status", columnId: COL.sensorsAuthStatus, fn: () => writeStatusIndex(p.id, COL.sensorsAuthStatus, p.sensorsAuthStatusIndex!) });

  // Supplies Auth Status
  if (p.suppliesAuthStatusIndex !== null)
    tasks.push({ label: "Supplies Auth Status", columnId: COL.suppliesAuthStatus, fn: () => writeStatusIndex(p.id, COL.suppliesAuthStatus, p.suppliesAuthStatusIndex!) });

  // Auth IDs
  if (p.sensorsAuthId)
    tasks.push({ label: "Sensors Auth ID", columnId: COL.sensorsAuthId, fn: () => writeText(p.id, COL.sensorsAuthId, p.sensorsAuthId) });
  if (p.infusionSetAuthId)
    tasks.push({ label: "Infusion Set Auth ID", columnId: COL.infusionSetAuthId, fn: () => writeText(p.id, COL.infusionSetAuthId, p.infusionSetAuthId) });
  if (p.cartridgeAuthId)
    tasks.push({ label: "Cartridge Auth ID", columnId: COL.cartridgeAuthId, fn: () => writeText(p.id, COL.cartridgeAuthId, p.cartridgeAuthId) });

  // Doctor (use edited override if present, else base value)
  const doctorVal = p.doctorEdited ?? p.doctor;
  if (doctorVal)
    tasks.push({ label: "Doctor", columnId: COL.doctor, fn: () => writeText(p.id, COL.doctor, doctorVal) });

  const npiVal = p.npiEdited ?? p.npi;
  if (npiVal)
    tasks.push({ label: "NPI", columnId: COL.npi, fn: () => writeText(p.id, COL.npi, npiVal) });

  // Doctor Address
  if (p.doctorAddressEdited !== null)
    tasks.push({ label: "Doctor Address", columnId: COL.doctorAddress, fn: () => writeLocation(p.id, COL.doctorAddress, p.doctorAddressEdited!, p.doctorAddressLat ?? 0, p.doctorAddressLng ?? 0) });

  // Doctor Phone
  if (p.doctorPhoneEdited !== null && p.doctorPhoneEdited !== "")
    tasks.push({ label: "Doctor Phone", columnId: COL.doctorPhone, fn: () => writePhone(p.id, COL.doctorPhone, p.doctorPhoneEdited!) });

  // Doctor Fax (email column type)
  if (p.doctorFaxEdited !== null && p.doctorFaxEdited !== "")
    tasks.push({ label: "Doctor Fax", columnId: COL.doctorFax, fn: () => writeEmail(p.id, COL.doctorFax, p.doctorFaxEdited!) });

  // Primary Insurance
  if (p.primaryInsuranceEdited !== null)
    tasks.push({ label: "Primary Insurance", columnId: COL.primaryInsurance, fn: () => writeStatusIndex(p.id, COL.primaryInsurance, p.primaryInsuranceEdited!) });

  // Secondary Insurance (use edited override if present)
  const secInsIdx = p.secondaryInsuranceEdited ?? p.secondaryInsuranceIndex;
  if (secInsIdx !== null)
    tasks.push({ label: "Secondary Insurance", columnId: COL.secondaryInsurance, fn: () => writeStatusIndex(p.id, COL.secondaryInsurance, secInsIdx!) });

  // Fax / Parachute
  const faxVal = p.faxParachuteEdited ?? p.faxParachute;
  if (faxVal)
    tasks.push({ label: "Fax/Parachute", columnId: COL.faxParachute, fn: () => writeStatusIndex(p.id, COL.faxParachute, faxVal === "Parachute" ? 1 : 0) });

  // ---- Execute all writes in parallel with retries ----
  const results = await Promise.all(tasks.map(executeWithRetry));
  const failures = results.filter((r): r is string => r !== null);

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} column(s) failed after retries. Failed: ${failures.map((f) => f.split(":")[0]).join(", ")}`,
    );
  }
}

/**
 * Immediately push notes to Monday's denial reason long_text column.
 */
export async function sendNotesToMonday(itemId: string, notes: string): Promise<void> {
  await writeLongText(itemId, COL.denialReason, notes);
}
