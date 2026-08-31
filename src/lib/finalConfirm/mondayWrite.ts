import { writeStatusIndex, writeStatusLabel, writeLongText, writeText, writeNumber, writeLocation, writeDate, writePhone, writeEmail, writeDropdownIds, renameItem, readColumnTexts, COL, BOARD_ID } from "./mondayApi";
import { executeWritesWithVerification, type WriteProgressPhase } from "../shared/verifiedWrite";
import { planPhoneWrite } from "../shared/phoneCell";
import { planEmailWrite } from "../shared/emailCell";
import { expectedPos, POS_INDEX } from "../shared/pos";
import { coercePumpQty } from "../shared/servingLines";
import type { Patient } from "./workflow";
import { CLINIC_NAME_OPTIONS, servingIncludesCgm, servingIncludesPump } from "./workflow";

// Stage Advancer: index 4 = Completed
const STAGE_ADVANCER_COMPLETED = 4;

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

  // ─── Item name (always write — cheap no-op if unchanged) ──
  if (typeof p.name === "string" && p.name.trim() !== "") {
    tasks.push({
      label: "Patient Name",
      columnId: "name",
      // change_multiple_column_values expresses the item name as the key "name"
      // carrying a PLAIN STRING (the documented working shape).
      value: p.name.trim(),
      fn: () => renameItem(p.id, p.name.trim()),
    });
  }

  // ─── Demographics edits ───────────────────────────────────
  // DOB (text column)
  tasks.push({ label: "DOB", columnId: COL.dob, value: p.dob, fn: () => writeText(p.id, COL.dob, p.dob) });

  // Phone (phone column — needs {phone, countryShortName} JSON)
  if (p.phoneEdited !== null && p.phoneEdited !== "") {
    // writePhone SKIPS an unparseable number (writes nothing). A task carrying
    // `{}` would CLEAR the column instead, so an unparseable value pushes no
    // task at all — byte-for-byte today's no-op.
    const phonePlan = planPhoneWrite(p.phoneEdited);
    if (phonePlan.action !== "skip")
      tasks.push({ label: "Phone", columnId: COL.phone, value: phonePlan.action === "write" ? { phone: phonePlan.phone, countryShortName: "US" } : {}, fn: () => writePhone(p.id, COL.phone, p.phoneEdited!) });
  }

  // Email (text column — patient email is stored as plain text, not email type)
  if (p.emailEdited !== null && p.emailEdited !== "")
    tasks.push({ label: "Email", columnId: COL.email, value: p.emailEdited!, fn: () => writeText(p.id, COL.email, p.emailEdited!) });

  // Address (location column — needs {address, lat, lng} JSON)
  if (p.addressEdited !== null && p.addressEdited !== "") {
    const lat = p.addressLat ?? 0;
    const lng = p.addressLng ?? 0;
    tasks.push({ label: "Address", columnId: COL.address, value: { address: p.addressEdited!, lat, lng }, fn: () => writeLocation(p.id, COL.address, p.addressEdited!, lat, lng) });
  }

  // Gender (status column)
  if (p.genderIndex !== null)
    tasks.push({ label: "Gender", columnId: COL.gender, value: { index: p.genderIndex! }, fn: () => writeStatusIndex(p.id, COL.gender, p.genderIndex!) });

  // ─── Insurance edits ──────────────────────────────────────
  // Primary Insurance (status column)
  if (p.primaryInsuranceIndex !== null)
    tasks.push({ label: "Primary Insurance", columnId: COL.primaryInsurance, value: { index: p.primaryInsuranceIndex! }, fn: () => writeStatusIndex(p.id, COL.primaryInsurance, p.primaryInsuranceIndex!) });

  // Member ID 1 (text column)
  tasks.push({ label: "Member ID 1", columnId: COL.memberId1, value: p.memberId1, fn: () => writeText(p.id, COL.memberId1, p.memberId1) });

  // Secondary Insurance (status column)
  if (p.secondaryInsuranceEdited !== null && p.secondaryInsuranceIndex !== null)
    tasks.push({ label: "Secondary Insurance", columnId: COL.secondaryInsurance, value: { index: p.secondaryInsuranceIndex! }, fn: () => writeStatusIndex(p.id, COL.secondaryInsurance, p.secondaryInsuranceIndex!) });

  // Member ID 2 (text column)
  if (p.memberId2Edited !== null && p.memberId2Edited !== "")
    tasks.push({ label: "Member ID 2", columnId: COL.memberId2, value: p.memberId2Edited!, fn: () => writeText(p.id, COL.memberId2, p.memberId2Edited!) });

  // Deductible fields (all text columns)
  tasks.push({ label: "Deductible", columnId: COL.deductible, value: p.deductible, fn: () => writeText(p.id, COL.deductible, p.deductible) });
  tasks.push({ label: "Deductible Remaining", columnId: COL.deductibleRemaining, value: p.deductibleRemaining, fn: () => writeText(p.id, COL.deductibleRemaining, p.deductibleRemaining) });
  tasks.push({ label: "Co-Insurance %", columnId: COL.coInsurance, value: p.coInsurance, fn: () => writeText(p.id, COL.coInsurance, p.coInsurance) });
  tasks.push({ label: "OOP Max", columnId: COL.oopMax, value: p.oopMax, fn: () => writeText(p.id, COL.oopMax, p.oopMax) });
  tasks.push({ label: "OOP Max Remaining", columnId: COL.oopMaxRemaining, value: p.oopMaxRemaining, fn: () => writeText(p.id, COL.oopMaxRemaining, p.oopMaxRemaining) });

  // ─── Doctor edits ────────────────────────────────────────
  // Doctor Name (text column)
  tasks.push({ label: "Doctor Name", columnId: COL.doctorName, value: p.doctorName, fn: () => writeText(p.id, COL.doctorName, p.doctorName) });

  // Doctor NPI (text column)
  tasks.push({ label: "Doctor NPI", columnId: COL.doctorNpi, value: p.doctorNpi, fn: () => writeText(p.id, COL.doctorNpi, p.doctorNpi) });

  // Doctor Phone (phone column — needs {phone, countryShortName} JSON)
  if (p.doctorPhone) {
    // Same skip semantics as the patient phone above: unparseable → no task.
    const doctorPhonePlan = planPhoneWrite(p.doctorPhone);
    if (doctorPhonePlan.action !== "skip")
      tasks.push({ label: "Doctor Phone", columnId: COL.doctorPhone, value: doctorPhonePlan.action === "write" ? { phone: doctorPhonePlan.phone, countryShortName: "US" } : {}, fn: () => writePhone(p.id, COL.doctorPhone, p.doctorPhone) });
  }

  // Doctor Email (email column — needs {text, email} JSON)
  if (p.doctorEmail) {
    // writeEmail SKIPS an unparseable address (writes nothing) and CLEARS with
    // { text: "", email: "" } — not {}. Mirror both branches exactly.
    const doctorEmailPlan = planEmailWrite(p.doctorEmail);
    const doctorEmailClean = doctorEmailPlan.action === "write" ? doctorEmailPlan.email : "";
    if (doctorEmailPlan.action !== "skip")
      tasks.push({ label: "Doctor Email", columnId: COL.doctorEmail, value: { text: doctorEmailClean, email: doctorEmailClean }, fn: () => writeEmail(p.id, COL.doctorEmail, p.doctorEmail) });
  }

  // Doctor Fax (email column — Monday stores fax as email type, needs {text, email} JSON)
  if (p.doctorFax) {
    // Same as Doctor Email — this is the column emailCell's skip exists to
    // protect (a fax number sitting behind a drifted label).
    const doctorFaxPlan = planEmailWrite(p.doctorFax);
    const doctorFaxClean = doctorFaxPlan.action === "write" ? doctorFaxPlan.email : "";
    if (doctorFaxPlan.action !== "skip")
      tasks.push({ label: "Doctor Fax", columnId: COL.doctorFax, value: { text: doctorFaxClean, email: doctorFaxClean }, fn: () => writeEmail(p.id, COL.doctorFax, p.doctorFax) });
  }

  // Clinicals Method (status column)
  if (p.clinicalsMethodIndex !== null)
    tasks.push({ label: "Clinicals Method", columnId: COL.clinicalsMethod, value: { index: p.clinicalsMethodIndex! }, fn: () => writeStatusIndex(p.id, COL.clinicalsMethod, p.clinicalsMethodIndex!) });

  // Clinic Name (dropdown column — needs {ids: [id]} JSON, look up by label)
  if (p.clinicName) {
    const clinicOpt = CLINIC_NAME_OPTIONS.find((o) => o.label === p.clinicName);
    if (clinicOpt)
      tasks.push({ label: "Clinic Name", columnId: COL.clinicName, value: { ids: [clinicOpt.id] }, fn: () => writeDropdownIds(p.id, COL.clinicName, [clinicOpt.id]) });
  }

  // Clinic Address (location column — needs {address, lat, lng} JSON)
  if (p.clinicAddressEdited !== null && p.clinicAddressEdited !== "") {
    const clat = p.clinicAddressLat ?? 0;
    const clng = p.clinicAddressLng ?? 0;
    tasks.push({ label: "Clinic Address", columnId: COL.clinicAddress, value: { address: p.clinicAddressEdited!, lat: clat, lng: clng }, fn: () => writeLocation(p.id, COL.clinicAddress, p.clinicAddressEdited!, clat, clng) });
  }

  // Carecentrix Intake ID (text column — only when referral source is CareCentrix)
  if (p.carecentrixIntakeId)
    tasks.push({ label: "Carecentrix Intake ID", columnId: COL.carecentrixIntakeId, value: p.carecentrixIntakeId, fn: () => writeText(p.id, COL.carecentrixIntakeId, p.carecentrixIntakeId) });

  // ─── Medical Necessity edits ─────────────────────────────
  // Diagnosis (status column — written by label; createIfMissing=true so
  // custom ICD-10 codes become permanent statuses on Monday)
  // HOISTED out of the batch on purpose: change_multiple_column_values carries
  // ONE transaction-wide create_labels_if_missing flag, so batching this write
  // would let every other label-shaped write in this send mint junk board
  // labels. Every remaining write here is index- or dropdown-id-based (strict),
  // and this one stays a lone create-labels-allowed mutation.
  //
  // It keeps the module's own retry wrapper, so it still gets 3 attempts with
  // backoff exactly as it did while it was task #N of the batch, and a
  // persistent failure still aborts the send with the stage NOT advanced.
  //
  // ⚠️ THE HOIST ONLY MAKES THE LABEL EXIST — it is NOT the write that counts.
  // Monday acks a column write BEFORE the value is indexed (§5.2), so a
  // hoisted write that left the batch would also leave `verifyColIds`, and the
  // Stage Advancer could fire while this column was still stale — handing the
  // create-item automation the previous or a blank Diagnosis. "It was written
  // first so it has had longer to index" is a timing argument, not the
  // read-back guarantee §9 requires ("verify before you advance").
  //
  // So the two jobs are split. The awaited call below guarantees the LABEL
  // EXISTS (it is the only write allowed to create one). The task pushed
  // straight after writes the same value inside the STRICT batch — no
  // create-labels flag needed, because the label exists by then — which puts
  // the column back in `verifyColIds` and holds the advancer until Monday
  // reads the value back. One extra mutation, and the stage boundary is
  // honest again.
  //
  // The hoist is still a plain client-side write, so it does not ride the
  // gateway's durable offline outbox: an offline send fails here rather than
  // queueing, before anything else on the item has changed.
  if (p.diagnosis) {
    const diagnosisFailure = await executeWithRetry({
      label: "Diagnosis (create label)",
      columnId: COL.diagnosis,
      fn: () => writeStatusLabel(p.id, COL.diagnosis, p.diagnosis, true),
    });
    if (diagnosisFailure) {
      throw new Error(`Diagnosis failed after retries — stage NOT advanced. ${diagnosisFailure}`);
    }
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
      label: "Diagnosis",
      columnId: COL.diagnosis,
      value: { label: p.diagnosis },
      expectedText: p.diagnosis,
      fn: () => writeStatusLabel(p.id, COL.diagnosis, p.diagnosis, true),
    });
  }

  // MR Expiry Date (date column — needs {date: "YYYY-MM-DD"} JSON)
  tasks.push({ label: "MR Expiry Date", columnId: COL.mrExpiryDate, value: p.mrExpiryDate ? { date: p.mrExpiryDate } : {}, fn: () => writeDate(p.id, COL.mrExpiryDate, p.mrExpiryDate) });

  // Request Type (status column)
  if (p.requestTypeIndex !== null)
    tasks.push({ label: "Request Type", columnId: COL.requestType, value: { index: p.requestTypeIndex! }, fn: () => writeStatusIndex(p.id, COL.requestType, p.requestTypeIndex!) });

  // ─── Product / Order edits ────────────────────────────────
  // Serving + Pump/CGM Type + Coverage Paths are written on every Send so
  // Split Order's "Not Serving" overrides land on Monday. For a non-split
  // submit, these are no-ops (writing the value already on Monday).
  if (p.servingIndex !== null)
    tasks.push({ label: "Serving", columnId: COL.serving, value: { index: p.servingIndex! }, fn: () => writeStatusIndex(p.id, COL.serving, p.servingIndex!) });

  if (p.pumpTypeIndex !== null)
    tasks.push({ label: "Pump Type", columnId: COL.pumpType, value: { index: p.pumpTypeIndex! }, fn: () => writeStatusIndex(p.id, COL.pumpType, p.pumpTypeIndex!) });

  if (p.cgmTypeIndex !== null)
    tasks.push({ label: "CGM Type", columnId: COL.cgmType, value: { index: p.cgmTypeIndex! }, fn: () => writeStatusIndex(p.id, COL.cgmType, p.cgmTypeIndex!) });

  if (p.cgmCoveragePathIndex !== null)
    tasks.push({ label: "CGM Coverage Path", columnId: COL.cgmCoveragePath, value: { index: p.cgmCoveragePathIndex! }, fn: () => writeStatusIndex(p.id, COL.cgmCoveragePath, p.cgmCoveragePathIndex!) });

  if (p.ipCoveragePathIndex !== null)
    tasks.push({ label: "IP Coverage Path", columnId: COL.ipCoveragePath, value: { index: p.ipCoveragePathIndex! }, fn: () => writeStatusIndex(p.id, COL.ipCoveragePath, p.ipCoveragePathIndex!) });

  // Auth Results — same reasoning. Split sets some to Not Serving (index 7).
  if (p.cgmAuthResultIndex !== null)
    tasks.push({ label: "CGM Auth Result", columnId: COL.cgmAuthResult, value: { index: p.cgmAuthResultIndex! }, fn: () => writeStatusIndex(p.id, COL.cgmAuthResult, p.cgmAuthResultIndex!) });

  if (p.sensorsAuthResultIndex !== null)
    tasks.push({ label: "Sensors Auth Result", columnId: COL.sensorsAuthResult, value: { index: p.sensorsAuthResultIndex! }, fn: () => writeStatusIndex(p.id, COL.sensorsAuthResult, p.sensorsAuthResultIndex!) });

  if (p.ipAuthResultIndex !== null)
    tasks.push({ label: "IP Auth Result", columnId: COL.ipAuthResult, value: { index: p.ipAuthResultIndex! }, fn: () => writeStatusIndex(p.id, COL.ipAuthResult, p.ipAuthResultIndex!) });

  if (p.infusionSetAuthResultIndex !== null)
    tasks.push({ label: "Infusion Set Auth Result", columnId: COL.infusionSetAuthResult, value: { index: p.infusionSetAuthResultIndex! }, fn: () => writeStatusIndex(p.id, COL.infusionSetAuthResult, p.infusionSetAuthResultIndex!) });

  if (p.cartridgeAuthResultIndex !== null)
    tasks.push({ label: "Cartridge Auth Result", columnId: COL.cartridgeAuthResult, value: { index: p.cartridgeAuthResultIndex! }, fn: () => writeStatusIndex(p.id, COL.cartridgeAuthResult, p.cartridgeAuthResultIndex!) });

  if (p.subscriptionTypeIndex !== null)
    tasks.push({ label: "Subscription Type", columnId: COL.subscriptionType, value: { index: p.subscriptionTypeIndex! }, fn: () => writeStatusIndex(p.id, COL.subscriptionType, p.subscriptionTypeIndex!) });

  if (p.infusionSet1Index !== null)
    tasks.push({ label: "Infusion Set 1", columnId: COL.infusionSet1, value: { index: p.infusionSet1Index! }, fn: () => writeStatusIndex(p.id, COL.infusionSet1, p.infusionSet1Index!) });

  // Always write number cells — empty string clears the cell on Monday
  // (necessary for Split Order, where Pump Qty / Qty Inf 1/2 are cleared so
  // automations gated on "is empty" can fire).
  tasks.push({
    label: "Infusion Set 1 Qty",
    columnId: COL.qtyInf1,
    value: p.qtyInf1 === "" ? "" : String(Number(p.qtyInf1)),
    fn: () => writeNumber(p.id, COL.qtyInf1, p.qtyInf1 === "" ? "" : Number(p.qtyInf1)),
  });

  if (p.infusionSet2Index !== null)
    tasks.push({ label: "Infusion Set 2", columnId: COL.infusionSet2, value: { index: p.infusionSet2Index! }, fn: () => writeStatusIndex(p.id, COL.infusionSet2, p.infusionSet2Index!) });

  tasks.push({
    label: "Infusion Set 2 Qty",
    columnId: COL.qtyInf2,
    value: p.qtyInf2 === "" ? "" : String(Number(p.qtyInf2)),
    fn: () => writeNumber(p.id, COL.qtyInf2, p.qtyInf2 === "" ? "" : Number(p.qtyInf2)),
  });

  tasks.push({
    label: "Qty Cartridge",
    columnId: COL.qtyCartridge,
    value: p.qtyCartridge === "" ? "" : String(Number(p.qtyCartridge)),
    fn: () => writeNumber(p.id, COL.qtyCartridge, p.qtyCartridge === "" ? "" : Number(p.qtyCartridge)),
  });

  tasks.push({
    label: "Monitor Qty",
    columnId: COL.monitorQty,
    value: p.monitorQty === "" ? "" : String(Number(p.monitorQty)),
    fn: () => writeNumber(p.id, COL.monitorQty, p.monitorQty === "" ? "" : Number(p.monitorQty)),
  });

  // Pump Qty — coerced to 0 when Serving does not sell a pump DEVICE.
  // This is the last gate before the Subscription hop creates the order, so it
  // is the one that actually stops a pump. Bradan French (2026-08-03) cleared
  // Final Confirm carrying Pump Qty 1 on a `Supplies + CGM` profile and Cardinal
  // shipped a t:slim the next morning. Serving is trusted only when KNOWN — the
  // same contract as the next-order-date clears below. See shared/servingLines.
  const pumpQtyToWrite = coercePumpQty(p.pumpQty, p.serving);
  tasks.push({
    label: "Pump Qty",
    columnId: COL.pumpQty,
    value: pumpQtyToWrite === "" ? "" : String(Number(pumpQtyToWrite)),
    fn: () => writeNumber(p.id, COL.pumpQty, pumpQtyToWrite === "" ? "" : Number(pumpQtyToWrite)),
  });

  // Medicare Prior Pump Date (Original-Medicare-only MM/YYYY text). Always write
  // so an empty value clears the cell (matches the other text/number fields here).
  tasks.push({
    label: "Medicare Prior Pump Date",
    columnId: COL.medicarePriorPumpDate,
    value: p.medicarePriorPumpDate,
    fn: () => writeText(p.id, COL.medicarePriorPumpDate, p.medicarePriorPumpDate),
  });

  // Monitor Purchase Date — same always-write contract, same reason.
  tasks.push({
    label: "Monitor Purchase Date",
    columnId: COL.monitorPurchaseDate,
    value: p.monitorPurchaseDate,
    fn: () => writeText(p.id, COL.monitorPurchaseDate, p.monitorPurchaseDate),
  });

  if (p.orderHandlingIndex !== null)
    tasks.push({ label: "Order Handling", columnId: COL.orderHandling, value: { index: p.orderHandlingIndex! }, fn: () => writeStatusIndex(p.id, COL.orderHandling, p.orderHandlingIndex!) });

  // POS — rides the send like any other editable field. A stored value is
  // never recomputed: Welcome Call owns the rule, this stage owns the override.
  // If the rep's value contradicts the rule, C23 says so in the review dialog
  // and the override lands in the audit line; the value itself stands.
  //
  // A BLANK one is different, and does get filled. The rule's else-branch gives
  // every payer a value, so the only way POS is empty here is a patient who
  // cleared Welcome Call before POS existed — the in-flight cohort at the time
  // this shipped. Skipping the write would advance them to Subscription / New
  // Order with a blank POS and nothing to notice it: C23_POS_11 only speaks up
  // for out-of-state Blues, so a blank that should read Home is silent. Filling
  // it is not the auto-rewrite the spec forbids — there is no stored value and
  // no rep decision to overwrite, and it is the same rule Welcome Call would
  // have applied. (Found in review on PR #25.)
  const posIndexToWrite = p.posIndex ?? POS_INDEX[expectedPos(p.primaryInsurance, p.addressEdited ?? p.address)];
  tasks.push({ label: "POS", columnId: COL.pos, value: { index: posIndexToWrite }, fn: () => writeStatusIndex(p.id, COL.pos, posIndexToWrite) });

  // ─── Notes ────────────────────────────────────────────────
  if (typeof p.notes === "string" && p.notes.trim() !== "")
    tasks.push({ label: "Notes", columnId: COL.notes, value: { text: p.notes }, fn: () => writeLongText(p.id, COL.notes, p.notes) });

  // ─── Last Bill Dates (always write current value) ────────────
  const lastBillDateEntries: { label: string; dateVal: string; colId: string }[] = [
    { label: "CGM Last Bill Date", dateVal: p.lastBillDateMonitor, colId: COL.lastBillDate.monitor },
    { label: "Sensors Last Bill Date", dateVal: p.lastBillDateSensors, colId: COL.lastBillDate.sensors },
    { label: "IP Last Bill Date", dateVal: p.lastBillDateIp, colId: COL.lastBillDate.insulin_pump },
    { label: "Infusion Set Last Bill Date", dateVal: p.lastBillDateInfusionSet, colId: COL.lastBillDate.infusion_set },
    { label: "Cartridge Last Bill Date", dateVal: p.lastBillDateCartridge, colId: COL.lastBillDate.cartridge },
  ];
  for (const entry of lastBillDateEntries) {
    tasks.push({ label: entry.label, columnId: entry.colId, value: entry.dateVal ? { date: entry.dateVal } : {}, fn: () => writeDate(p.id, entry.colId, entry.dateVal) });
  }

  // ─── Next Order Dates ────────────────────────────────────────
  // MM-1042: a product's next order date must be empty when it isn't being
  // served. These are read-only pass-throughs from the board, so a stale date
  // on a not-served line (e.g. the Welcome Call step's "today" default) would
  // otherwise be re-persisted here on every Send — clear it instead. Serving is
  // trusted only when known, so unknown serving leaves the value untouched.
  const servingKnown = p.serving.trim() !== "";
  const cgmServed = !servingKnown || servingIncludesCgm(p.serving);
  const pumpServed = !servingKnown || servingIncludesPump(p.serving);
  const nextOrderDateEntries: { label: string; dateVal: string; colId: string; served: boolean }[] = [
    { label: "IP Next Order Date", dateVal: p.nextOrderDateIp, colId: COL.nextOrderDate.insulin_pump, served: pumpServed },
    { label: "Sensors Next Order Date", dateVal: p.nextOrderDateSensors, colId: COL.nextOrderDate.sensors, served: cgmServed },
    { label: "Supplies Next Order Date", dateVal: p.nextOrderDateSupplies, colId: COL.nextOrderDate.supplies, served: pumpServed },
  ];
  for (const entry of nextOrderDateEntries) {
    const dateVal = entry.served ? entry.dateVal : "";
    // Skip a no-op empty write (a not-served line already blank on the board):
    // executeWritesWithVerification reads back every task, so an empty→empty
    // write is a wasted Monday round-trip. Mirrors resolveNextOrderWrite's
    // null-skip in the Welcome Call path.
    if (dateVal !== "" || entry.dateVal !== "") {
      tasks.push({ label: entry.label, columnId: entry.colId, value: dateVal ? { date: dateVal } : {}, fn: () => writeDate(p.id, entry.colId, dateVal) });
    }
  }

  // ─── Escalation ───────────────────────────────────────────
  if (p.escalated)
    tasks.push({ label: "Escalation", columnId: COL.escalation, value: { index: 0 }, fn: () => writeStatusIndex(p.id, COL.escalation, 0) });

  // ─── Stage Advancer (added to tasks — verified write handles ordering) ───
  tasks.push({
    label: "Stage Advancer",
    columnId: COL.stageAdvancer,
    value: { index: STAGE_ADVANCER_COMPLETED },
    fn: () => writeStatusIndex(p.id, COL.stageAdvancer, STAGE_ADVANCER_COMPLETED),
  });

  // ---- Execute with read-back verification before advancing stage ----
  const failures = await executeWritesWithVerification({
    itemId: p.id,
    boardId: String(BOARD_ID),
    tasks,
    stageColumnId: COL.stageAdvancer,
    executeWithRetry,
    readColumns: readColumnTexts,
    writeDebug: (id, msg) => writeText(id, COL.joshDebug, msg),
    onProgress: opts?.onProgress,
    requireDone: opts?.requireDone,
    waitForDoneMs: opts?.waitForDoneMs,
  });

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} column(s) failed after retries. Check "Josh Debug" column. Failed: ${failures.map((f) => f.split(":")[0]).join(", ")}`,
    );
  }
}