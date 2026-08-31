import { writeStatusIndex, writeNumber, writeLocation, writeText, writeLongText, writeDate, writeDropdownIds, writePhone, writeEmail, readColumnTexts, COL, BOARD_ID } from "./mondayApi";
import { executeWritesWithVerification, type WriteProgressPhase } from "../shared/verifiedWrite";
import { planPhoneWrite } from "../shared/phoneCell";
import { planEmailWrite } from "../shared/emailCell";
import type { Patient } from "./workflow";

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

export async function sendPatientToMonday(
  p: Patient,
  /** Blocking save: "the gateway accepted it" is NOT success — the call only
   *  resolves once Monday CONFIRMS the write, and throws GatewayPendingError if
   *  the wait runs out. The caller must surface that as "queued, don't repeat"
   *  and must NOT retry: the job is durable and will run, so a second send
   *  would write the same transaction twice. */
  opts?: {
    onProgress?: (phase: WriteProgressPhase) => void;
    requireDone?: boolean;
    waitForDoneMs?: number;
  },
): Promise<void> {
  const tasks: WriteTask[] = [];

  // Status — display-only, NOT sent to Monday

  // Ordering Cycle
  if (p.orderingCycleIndex !== null)
    tasks.push({ label: "Ordering Cycle", columnId: COL.orderingCycle, value: { index: p.orderingCycleIndex! }, fn: () => writeStatusIndex(p.id, COL.orderingCycle, p.orderingCycleIndex!) });

  // Subscription
  if (p.subscriptionIndex !== null)
    tasks.push({ label: "Subscription", columnId: COL.subscription, value: { index: p.subscriptionIndex! }, fn: () => writeStatusIndex(p.id, COL.subscription, p.subscriptionIndex!) });

  // Order Type
  if (p.orderTypeIndex !== null)
    tasks.push({ label: "Order Type", columnId: COL.orderType, value: { index: p.orderTypeIndex! }, fn: () => writeStatusIndex(p.id, COL.orderType, p.orderTypeIndex!) });

  // Sensors Type
  if (p.sensorsTypeIndex !== null)
    tasks.push({ label: "Sensors Type", columnId: COL.sensorsType, value: { index: p.sensorsTypeIndex! }, fn: () => writeStatusIndex(p.id, COL.sensorsType, p.sensorsTypeIndex!) });

  // Supplies Type
  if (p.suppliesTypeIndex !== null)
    tasks.push({ label: "Supplies Type", columnId: COL.suppliesType, value: { index: p.suppliesTypeIndex! }, fn: () => writeStatusIndex(p.id, COL.suppliesType, p.suppliesTypeIndex!) });

  // Infusion Sets
  if (p.infusionSet1Index !== null)
    tasks.push({ label: "Infusion Set 1", columnId: COL.infusionSet1, value: { index: p.infusionSet1Index! }, fn: () => writeStatusIndex(p.id, COL.infusionSet1, p.infusionSet1Index!) });
  if (p.infusionSet2Index !== null)
    tasks.push({ label: "Infusion Set 2", columnId: COL.infusionSet2, value: { index: p.infusionSet2Index! }, fn: () => writeStatusIndex(p.id, COL.infusionSet2, p.infusionSet2Index!) });

  // Quantities
  if (p.infQty1 !== "")
    tasks.push({ label: "Inf. Qty 1", columnId: COL.infQty1, value: String(Number(p.infQty1)), fn: () => writeNumber(p.id, COL.infQty1, Number(p.infQty1)) });
  if (p.infQty2 !== "")
    tasks.push({ label: "Inf. Qty 2", columnId: COL.infQty2, value: String(Number(p.infQty2)), fn: () => writeNumber(p.id, COL.infQty2, Number(p.infQty2)) });

  // Next Order date
  if (p.nextOrder)
    tasks.push({ label: "Next Order", columnId: COL.nextOrder, value: { date: p.nextOrder }, fn: () => writeDate(p.id, COL.nextOrder, p.nextOrder) });

  // Phone edit
  if (p.phoneEdited !== null && p.phoneEdited !== "") {
    // writePhone SKIPS an unparseable number (writes nothing). A task carrying
    // `{}` would CLEAR the column instead, so an unparseable value pushes no
    // task at all — byte-for-byte today's no-op.
    const phonePlan = planPhoneWrite(p.phoneEdited);
    if (phonePlan.action !== "skip")
      tasks.push({ label: "Phone", columnId: COL.phone, value: phonePlan.action === "write" ? { phone: phonePlan.phone, countryShortName: "US" } : {}, fn: () => writePhone(p.id, COL.phone, p.phoneEdited!) });
  }

  // Address edit
  if (p.addressEdited !== null) {
    const lat = p.addressLat ?? 0;
    const lng = p.addressLng ?? 0;
    tasks.push({ label: "Address", columnId: COL.address, value: { address: p.addressEdited!, lat, lng }, fn: () => writeLocation(p.id, COL.address, p.addressEdited!, lat, lng) });
  }

  // Member ID edits
  if (p.memberId1Edited !== null && p.memberId1Edited !== "")
    tasks.push({ label: "Member ID 1", columnId: COL.memberId1, value: p.memberId1Edited!, fn: () => writeText(p.id, COL.memberId1, p.memberId1Edited!) });
  if (p.memberId2Edited !== null && p.memberId2Edited !== "")
    tasks.push({ label: "Member ID 2", columnId: COL.memberId2, value: p.memberId2Edited!, fn: () => writeText(p.id, COL.memberId2, p.memberId2Edited!) });

  // Secondary insurance — DUPLICATE WRITE REMOVED.
  // This pushed `{ index: p.secondaryInsuranceIndex }`, the value read off the
  // board. The write further down does `p.secondaryInsuranceEdited ?? p.secondaryInsuranceIndex`,
  // so it covers this case exactly and, when a rep HAS edited the field, writes
  // the edited value instead. Its guard is strictly wider too, so nothing is
  // lost by dropping this one.
  //
  // Keeping both gave one transaction two opinions about one column. On the old
  // parallel path that was a race — the stale board value could land last and
  // silently discard the rep's edit. Batched, the task list folds into an object
  // keyed by columnId and the LAST push wins, which happens to be the correct
  // one; but a send that only works because of source ordering is not a
  // guarantee. Pinned by writeTaskParity.test.ts, which fails when one column
  // receives two different values in a send.

  // Sensors Auth Status
  if (p.sensorsAuthStatusIndex !== null)
    tasks.push({ label: "Sensors Auth Status", columnId: COL.sensorsAuthStatus, value: { index: p.sensorsAuthStatusIndex! }, fn: () => writeStatusIndex(p.id, COL.sensorsAuthStatus, p.sensorsAuthStatusIndex!) });

  // Supplies Auth Status
  if (p.suppliesAuthStatusIndex !== null)
    tasks.push({ label: "Supplies Auth Status", columnId: COL.suppliesAuthStatus, value: { index: p.suppliesAuthStatusIndex! }, fn: () => writeStatusIndex(p.id, COL.suppliesAuthStatus, p.suppliesAuthStatusIndex!) });

  // Auth IDs
  if (p.sensorsAuthId)
    tasks.push({ label: "Sensors Auth ID", columnId: COL.sensorsAuthId, value: p.sensorsAuthId, fn: () => writeText(p.id, COL.sensorsAuthId, p.sensorsAuthId) });
  if (p.infusionSetAuthId)
    tasks.push({ label: "Infusion Set Auth ID", columnId: COL.infusionSetAuthId, value: p.infusionSetAuthId, fn: () => writeText(p.id, COL.infusionSetAuthId, p.infusionSetAuthId) });
  if (p.cartridgeAuthId)
    tasks.push({ label: "Cartridge Auth ID", columnId: COL.cartridgeAuthId, value: p.cartridgeAuthId, fn: () => writeText(p.id, COL.cartridgeAuthId, p.cartridgeAuthId) });

  // Doctor (use edited override if present, else base value)
  const doctorVal = p.doctorEdited ?? p.doctor;
  if (doctorVal)
    tasks.push({ label: "Doctor", columnId: COL.doctor, value: doctorVal, fn: () => writeText(p.id, COL.doctor, doctorVal) });

  const npiVal = p.npiEdited ?? p.npi;
  if (npiVal)
    tasks.push({ label: "NPI", columnId: COL.npi, value: npiVal, fn: () => writeText(p.id, COL.npi, npiVal) });

  // Doctor Address
  if (p.doctorAddressEdited !== null)
    tasks.push({ label: "Doctor Address", columnId: COL.doctorAddress, value: { address: p.doctorAddressEdited!, lat: p.doctorAddressLat ?? 0, lng: p.doctorAddressLng ?? 0 }, fn: () => writeLocation(p.id, COL.doctorAddress, p.doctorAddressEdited!, p.doctorAddressLat ?? 0, p.doctorAddressLng ?? 0) });

  // Doctor Phone
  if (p.doctorPhoneEdited !== null && p.doctorPhoneEdited !== "") {
    // Same skip semantics as the patient phone above: unparseable → no task.
    const doctorPhonePlan = planPhoneWrite(p.doctorPhoneEdited);
    if (doctorPhonePlan.action !== "skip")
      tasks.push({ label: "Doctor Phone", columnId: COL.doctorPhone, value: doctorPhonePlan.action === "write" ? { phone: doctorPhonePlan.phone, countryShortName: "US" } : {}, fn: () => writePhone(p.id, COL.doctorPhone, p.doctorPhoneEdited!) });
  }

  // Doctor Fax (email column type)
  if (p.doctorFaxEdited !== null && p.doctorFaxEdited !== "") {
    // This is the column emailCell's skip exists to protect — a doctor's FAX
    // number in an email column. writeEmail SKIPS an unparseable value and
    // CLEARS with a bare {} in THIS module (not { email: "", text: "" }).
    const doctorFaxPlan = planEmailWrite(p.doctorFaxEdited);
    if (doctorFaxPlan.action !== "skip")
      tasks.push({ label: "Doctor Fax", columnId: COL.doctorFax, value: doctorFaxPlan.action === "write" ? { email: doctorFaxPlan.email, text: doctorFaxPlan.email } : {}, fn: () => writeEmail(p.id, COL.doctorFax, p.doctorFaxEdited!) });
  }

  // Primary Insurance
  if (p.primaryInsuranceEdited !== null)
    tasks.push({ label: "Primary Insurance", columnId: COL.primaryInsurance, value: { index: p.primaryInsuranceEdited! }, fn: () => writeStatusIndex(p.id, COL.primaryInsurance, p.primaryInsuranceEdited!) });

  // Secondary Insurance (use edited override if present)
  const secInsIdx = p.secondaryInsuranceEdited ?? p.secondaryInsuranceIndex;
  if (secInsIdx !== null)
    tasks.push({ label: "Secondary Insurance", columnId: COL.secondaryInsurance, value: { index: secInsIdx! }, fn: () => writeStatusIndex(p.id, COL.secondaryInsurance, secInsIdx!) });

  // Visit Date → MN Expiry (+6 months)
  if (p.visitDate) {
    const d = new Date(p.visitDate + "T00:00:00");
    d.setMonth(d.getMonth() + 6);
    const newExpiry = d.toISOString().slice(0, 10); // YYYY-MM-DD
    tasks.push({ label: "MN Expiry (from Visit Date)", columnId: COL.mnExpiry, value: { date: newExpiry }, fn: () => writeDate(p.id, COL.mnExpiry, newExpiry) });
  }

  // Fax / Parachute
  const faxVal = p.faxParachuteEdited ?? p.faxParachute;
  if (faxVal)
    tasks.push({ label: "Fax/Parachute", columnId: COL.faxParachute, value: { index: faxVal === "Parachute" ? 1 : 0 }, fn: () => writeStatusIndex(p.id, COL.faxParachute, faxVal === "Parachute" ? 1 : 0) });

  // ---- Execute all writes, verified ----
  // Empty stage list = every task is a verified data write and Phase 3
  // (advance) writes nothing: this board has NO stage advancer column.
  // Routing through verifiedWrite is what lets the gateway /send fast path
  // collapse the whole send into ONE change_multiple_column_values (Monday
  // rejects concurrent mutations against one item), and it adds the read-back
  // verification this send has never had (CLAUDE.md §10, audit finding H6).
  const failures = await executeWritesWithVerification({
    itemId: p.id,
    boardId: String(BOARD_ID),
    tasks,
    stageColumnId: [],
    executeWithRetry,
    readColumns: readColumnTexts,
    onProgress: opts?.onProgress,
    requireDone: opts?.requireDone,
    waitForDoneMs: opts?.waitForDoneMs,
  });

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} column(s) failed after retries. Failed: ${failures.map((f) => f.split(":")[0]).join(", ")}`,
    );
  }
}

/**
 * Immediately push notes to the Subscription Patient Notes column on Monday.
 */
export async function sendNotesToMonday(itemId: string, notes: string): Promise<void> {
  await writeLongText(itemId, COL.subscriptionNotes, notes);
}
