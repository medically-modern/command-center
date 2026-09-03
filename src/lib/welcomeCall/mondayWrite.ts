import { writeStatusIndex, writeNumber, writeLocation, writeText, writeLongText, writeDate, clearDateColumn, writePhone, readColumnTexts, COL, BOARD_ID } from "./mondayApi";
import { executeWritesWithVerification, type WriteProgressPhase } from "../shared/verifiedWrite";
import { planPhoneWrite } from "../shared/phoneCell";
import { appendIntakeToNotes } from "./callIntake";
import { assertTextLikeFits } from "../shared/longText";
import { expectedPos, POS_INDEX } from "../shared/pos";
import { resolveNextOrderWrite, servingIncludesCgm, servingIncludesPump } from "./workflow";
import { coercePumpQty } from "@/lib/shared/servingLines";
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

  // Phone edit
  if (p.phoneEdited !== null && p.phoneEdited !== "") {
    // writePhone SKIPS an unparseable number (writes nothing). A task carrying
    // `{}` would CLEAR a real patient phone number instead, so an unparseable
    // value pushes no task at all — byte-for-byte today's no-op.
    const phonePlan = planPhoneWrite(p.phoneEdited);
    if (phonePlan.action !== "skip") {
      tasks.push({
        label: "Phone",
        columnId: COL.phone,
        value: phonePlan.action === "write" ? { phone: phonePlan.phone, countryShortName: "US" } : {},
        fn: () => writePhone(p.id, COL.phone, p.phoneEdited!),
      });
    }
  }

  // Serving override
  if (p.servingIndexEdited !== null)
    tasks.push({ label: "Serving", columnId: COL.serving, value: { index: p.servingIndexEdited! }, fn: () => writeStatusIndex(p.id, COL.serving, p.servingIndexEdited!) });

  // CGM Type override
  if (p.cgmTypeIndex !== null)
    tasks.push({ label: "CGM Type", columnId: COL.cgmType, value: { index: p.cgmTypeIndex! }, fn: () => writeStatusIndex(p.id, COL.cgmType, p.cgmTypeIndex!) });

  // Pump Type override
  if (p.pumpTypeIndex !== null)
    tasks.push({ label: "Pump Type", columnId: COL.pumpType, value: { index: p.pumpTypeIndex! }, fn: () => writeStatusIndex(p.id, COL.pumpType, p.pumpTypeIndex!) });

  // Primary Insurance (only if edited)
  if (p.primaryInsuranceIndexEdited !== null)
    tasks.push({ label: "Primary Insurance", columnId: COL.primaryInsurance, value: { index: p.primaryInsuranceIndexEdited! }, fn: () => writeStatusIndex(p.id, COL.primaryInsurance, p.primaryInsuranceIndexEdited!) });

  // Member ID 1 (only if edited)
  if (p.memberId1Edited !== null && p.memberId1Edited !== "")
    tasks.push({ label: "Member ID 1", columnId: COL.memberId1, value: p.memberId1Edited!, fn: () => writeText(p.id, COL.memberId1, p.memberId1Edited!) });

  // Secondary Insurance (only if edited)
  if (p.secondaryInsuranceEdited !== null && p.secondaryInsuranceIndex !== null)
    tasks.push({ label: "Secondary Insurance", columnId: COL.secondaryInsurance, value: { index: p.secondaryInsuranceIndex! }, fn: () => writeStatusIndex(p.id, COL.secondaryInsurance, p.secondaryInsuranceIndex!) });

  // Member ID 2 (only if edited)
  if (p.memberId2Edited !== null && p.memberId2Edited !== "")
    tasks.push({ label: "Member ID 2", columnId: COL.memberId2, value: p.memberId2Edited!, fn: () => writeText(p.id, COL.memberId2, p.memberId2Edited!) });

  // ⚠️ This module's writeNumber takes a NUMBER and always sends String(num) as
  // a PLAIN STRING — no skip, no cleaning (unlike profile's, which cleans and
  // may write nothing). The `String(Number(...))` here is deliberate parity with
  // the fn, not redundancy: a non-numeric field sends "NaN" today and must keep
  // doing so.
  if (p.monitorQty !== "") tasks.push({ label: "Monitor Qty", columnId: COL.monitorQty, value: String(Number(p.monitorQty)), fn: () => writeNumber(p.id, COL.monitorQty, Number(p.monitorQty)) });
  // Pump Qty is coerced to 0 when Serving does not sell a pump DEVICE. The form
  // disables the control, but a value already on the board — or one set before
  // Serving was corrected — still reaches here otherwise, which is exactly how
  // Bradan French's `1` survived a Welcome Call save on a `Supplies + CGM`
  // profile and shipped a pump. See lib/shared/servingLines.ts.
  const pumpQtyToWrite = coercePumpQty(p.pumpQty, p.servingEdited ?? p.serving);
  if (pumpQtyToWrite !== "") tasks.push({ label: "Pump Qty", columnId: COL.pumpQty, value: String(Number(pumpQtyToWrite)), fn: () => writeNumber(p.id, COL.pumpQty, Number(pumpQtyToWrite)) });
  if (p.qtyInf1 !== "") tasks.push({ label: "Infusion Set 1 Qty", columnId: COL.qtyInf1, value: String(Number(p.qtyInf1)), fn: () => writeNumber(p.id, COL.qtyInf1, Number(p.qtyInf1)) });
  if (p.qtyInf2 !== "") tasks.push({ label: "Infusion Set 2 Qty", columnId: COL.qtyInf2, value: String(Number(p.qtyInf2)), fn: () => writeNumber(p.id, COL.qtyInf2, Number(p.qtyInf2)) });
  if (p.qtyCartridge !== "") tasks.push({ label: "Qty Cartridge", columnId: COL.qtyCartridge, value: String(Number(p.qtyCartridge)), fn: () => writeNumber(p.id, COL.qtyCartridge, Number(p.qtyCartridge)) });

  // Medicare Prior Pump Date (Original-Medicare-only MM/YYYY text). Always write so
  // an empty value clears the cell — the form zeroes local state once the field is
  // no longer eligible (insurance changed / Pump Qty set to 1), so a date entered
  // and then reversed in-session is cleared on the board instead of persisting.
  // writeText sends the bare string, so `value: ""` IS the clear here — it must
  // not be turned into {} or skipped.
  tasks.push({ label: "Medicare Prior Pump Date", columnId: COL.medicarePriorPumpDate, value: p.medicarePriorPumpDate, fn: () => writeText(p.id, COL.medicarePriorPumpDate, p.medicarePriorPumpDate) });

  // Monitor Purchase Date — same always-write contract as the pump date above,
  // for the same reason: the form zeroes local state once the field stops being
  // eligible, so writing unconditionally is what clears the board cell.
  tasks.push({ label: "Monitor Purchase Date", columnId: COL.monitorPurchaseDate, value: p.monitorPurchaseDate, fn: () => writeText(p.id, COL.monitorPurchaseDate, p.monitorPurchaseDate) });

  if (p.infusionSet1Index !== null)
    tasks.push({ label: "Infusion Set 1", columnId: COL.infusionSet1, value: { index: p.infusionSet1Index! }, fn: () => writeStatusIndex(p.id, COL.infusionSet1, p.infusionSet1Index!) });
  if (p.infusionSet2Index !== null)
    tasks.push({ label: "Infusion Set 2", columnId: COL.infusionSet2, value: { index: p.infusionSet2Index! }, fn: () => writeStatusIndex(p.id, COL.infusionSet2, p.infusionSet2Index!) });
  if (p.subscriptionTypeIndex !== null)
    tasks.push({ label: "Subscription Type", columnId: COL.subscriptionType, value: { index: p.subscriptionTypeIndex! }, fn: () => writeStatusIndex(p.id, COL.subscriptionType, p.subscriptionTypeIndex!) });
  if (p.welcomeCallTextIndex !== null)
    tasks.push({ label: "Welcome Call Text", columnId: COL.welcomeCallText, value: { index: p.welcomeCallTextIndex! }, fn: () => writeStatusIndex(p.id, COL.welcomeCallText, p.welcomeCallTextIndex!) });
  if (p.orderHandlingIndex !== null)
    tasks.push({ label: "Order Handling", columnId: COL.orderHandling, value: { index: p.orderHandlingIndex! }, fn: () => writeStatusIndex(p.id, COL.orderHandling, p.orderHandlingIndex!) });
  if (p.advanceDecisionIndex !== null)
    tasks.push({ label: "Advance Decision", columnId: COL.advanceDecision, value: { index: p.advanceDecisionIndex! }, fn: () => writeStatusIndex(p.id, COL.advanceDecision, p.advanceDecisionIndex!) });

  if (p.addressEdited !== null) {
    const lat = p.addressLat ?? 0;
    const lng = p.addressLng ?? 0;
    tasks.push({ label: "Address", columnId: COL.address, value: { address: p.addressEdited!, lat, lng }, fn: () => writeLocation(p.id, COL.address, p.addressEdited!, lat, lng) });
  }

  // POS — dictated by logic, never by the rep. A pure function of Primary
  // Insurance + address (out-of-state Blue → Office, everyone else → Home), so
  // there is no POS control anywhere in the Welcome Call UI. Computed from the
  // EFFECTIVE values as they stand at submit, because an address or payer the
  // rep just corrected is the one that should drive it.
  //
  // The else-branch covers every payer, so this always writes — the column is
  // never left blank after Welcome Call. This is a DATA task deliberately: it
  // must land before the Stage Advancer flips (below), or the create-item
  // automations copy a blank/stale POS onto the Subscription / New Order
  // boards, silently and with no error (CLAUDE.md §5.2).
  const posLabel = expectedPos(
    p.primaryInsuranceEdited ?? p.primaryInsurance,
    p.addressEdited ?? p.address,
  );
  tasks.push({
    label: "POS",
    columnId: COL.pos,
    value: { index: POS_INDEX[posLabel] },
    fn: () => writeStatusIndex(p.id, COL.pos, POS_INDEX[posLabel]),
  });

  // Next order dates — always sync the date the UI is showing (edit → existing
  // Monday value → computed default) so the displayed default actually lands on
  // the board. Computed at send time, never read from a mount effect; skip only
  // when the effective value already matches Monday (avoids a same-value write).
  //
  // MM-1042: only a product that is actually being served gets a date. Without
  // this gate the computed default falls through to "today" for a not-served
  // line (no edit, no board value, no last-bill history), which is how the
  // Sensors date was landing on the same day as supplies/pump. `served` is
  // resolved from the effective serving value; when serving is unknown we leave
  // the existing behavior untouched rather than risk clearing good data.
  const effServing = p.servingEdited ?? p.serving;
  const servingKnown = effServing.trim() !== "";
  const cgmServed = !servingKnown || servingIncludesCgm(effServing);
  const pumpServed = !servingKnown || servingIncludesPump(effServing);
  const nextOrderDateWrites: {
    label: string;
    columnId: string;
    edited: string | null;
    mondayDate: string;
    lastBillDates: string[];
    served: boolean;
  }[] = [
    { label: "IP Next Order Date", columnId: COL.ipNextOrderDate, edited: p.ipNextOrderDateEdited, mondayDate: p.ipNextOrderDate, lastBillDates: [p.ipLastBillDate], served: pumpServed },
    { label: "Sensors Next Order Date", columnId: COL.sensorsNextOrderDate, edited: p.sensorsNextOrderDateEdited, mondayDate: p.sensorsNextOrderDate, lastBillDates: [p.sensorsLastBillDate, p.cgmLastBillDate], served: cgmServed },
    { label: "Supplies Next Order Date", columnId: COL.suppliesNextOrderDate, edited: p.suppliesNextOrderDateEdited, mondayDate: p.suppliesNextOrderDate, lastBillDates: [p.infusionSetLastBillDate, p.cartridgeLastBillDate], served: pumpServed },
  ];
  for (const w of nextOrderDateWrites) {
    const value = resolveNextOrderWrite({ served: w.served, edited: w.edited, mondayDate: w.mondayDate, lastBillDates: w.lastBillDates });
    if (value === null) continue;
    // An empty result means "clear this date". This module's writeDate always
    // sends { date: ... }, which Monday does NOT treat as a clear — the empty
    // clear must go through clearDateColumn ({} payload). Non-empty values use
    // writeDate as before.
    const fn = value === ""
      ? () => clearDateColumn(p.id, w.columnId)
      : () => writeDate(p.id, w.columnId, value);
    // The batched value mirrors the SAME ternary as the fn above. A flat
    // `{ date: value }` would send `{ date: "" }` for the clear case, which
    // Monday does not treat as a clear — it would silently leave a stale Next
    // Order Date on the board (the MM-1042 class of bug).
    tasks.push({ label: w.label, columnId: w.columnId, value: value === "" ? {} : { date: value }, fn });
  }

  // ---- Notes (+ the no-column intake block) ----
  // The nine Welcome Call facts the board has no columns for ride out here,
  // appended as one delimited, parseable block (lib/welcomeCall/callIntake.ts).
  // Nothing is appended when the rep didn't touch those fields, so an ordinary
  // call's notes log is unchanged.
  const notesToWrite = appendIntakeToNotes(p.notes, p.callIntake);
  if (typeof notesToWrite === "string" && notesToWrite.trim() !== "") {
    // ⚠️ Monday long-text columns hold 2000 chars and truncate SILENTLY,
    // dropping the NEWEST content — i.e. the block we just appended, which is
    // the one thing here with no other home (CLAUDE.md §10). Fail loudly before
    // the write instead of reporting success and losing the rep's answers.
    await assertTextLikeFits(BOARD_ID, COL.notes, notesToWrite, "Welcome Call Notes");
    tasks.push({ label: "Notes", columnId: COL.notes, value: notesToWrite, fn: () => writeLongText(p.id, COL.notes, notesToWrite) });
  }

  // Escalation toggle — if flagged, write Escalation Required
  if (p.escalated) {
    tasks.push({ label: "Escalation", columnId: COL.escalation, value: { index: 0 }, fn: () => writeStatusIndex(p.id, COL.escalation, 0) });
  }

  // Stage advancer — Review Profile
  tasks.push({ label: "Stage Advancer", columnId: COL.stageAdvancer, value: { index: 0 }, fn: () => writeStatusIndex(p.id, COL.stageAdvancer, 0) });

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
  // Same Serving coercion as buildDataTasks above — this writer fires the
  // welcome-call autotext automation, so it must not stamp a pump quantity the
  // Serving label does not support either.
  const pumpQtyToWrite = coercePumpQty(p.pumpQty, p.servingEdited ?? p.serving);
  if (pumpQtyToWrite !== "") tasks.push(writeNumber(p.id, COL.pumpQty, Number(pumpQtyToWrite)));
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