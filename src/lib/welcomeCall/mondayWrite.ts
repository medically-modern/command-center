import { writeStatusIndex, writeStatusClear, writeCheckbox, writeNumber, writeLocation, writeText, writeLongText, writeDate, clearDateColumn, writePhone, readColumnTexts, COL, BOARD_ID } from "./mondayApi";
import { executeWritesWithVerification, type WriteProgressPhase } from "../shared/verifiedWrite";
import { planPhoneWrite } from "../shared/phoneCell";
import { appendIntakeToNotes } from "./callIntake";
import { appendStampedNote } from "@/lib/shared/noteStamp";
import { assertTextLikeFits } from "../shared/longText";
import { expectedPos, POS_INDEX } from "../shared/pos";
import { resolveNextOrderWrite, servingIncludesCgm, servingIncludesPump } from "./workflow";
import { infusionSetWriteAction } from "./infusionSelection";
import { coercePumpQty } from "@/lib/shared/servingLines";
// ⚠️ The next-order default must compute from the SAME date the card shows —
// see shared/lastBillDate.ts for why one column alone reads blank.
import { resolveLastBillDates } from "@/lib/shared/lastBillDate";
import { coerceMonitorQty } from "@/lib/shared/monitorQty";
import { frequencyState, daysToLabel, ORDER_FREQUENCY_INDEX } from "./orderFrequency";
import { phoneSlotsFor, caregiverFor, phoneSlotWrites, caregiverConsentJustGiven, caregiverConsentNote } from "./phoneSlots";
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

/**
 * Write a status by label id, or CLEAR the column when the id is null.
 *
 * ⚠️ Monday clears a status with `{}` and there is no "index: null" — passing
 * null to `writeStatusIndex` would serialise `{"index":null}`, which the API
 * takes as a value it cannot read. The phone columns need both halves: a
 * removed second number has to clear Alternate Contact, not leave it standing
 * against a number that is gone.
 */
async function writeStatusOrClear(itemId: string, columnId: string, id: number | null): Promise<void> {
  if (id === null) {
    await writeStatusClear(itemId, columnId);
    return;
  }
  await writeStatusIndex(itemId, columnId, id);
}

/**
 * A quantity as Monday wants it, where a BLANK is a clear and not a zero.
 *
 * ⚠️ `Number("")` is 0, so routing a blank through `Number()` writes a real
 * quantity and reports success. Two of this board's live automations compare
 * quantities with "is empty" / "is equal to" (7918341011 gates "monitor only"
 * on **Pump Qty is empty**), so the difference is not cosmetic — see
 * `lib/shared/monitorQty.ts` for the whole chain.
 */
function blankOrNumber(v: string): number | "" {
  return (v ?? "").trim() === "" ? "" : Number(v);
}

/** The same value as `change_multiple_column_values` wants it — the DECLARED
 *  `value` on a WriteTask must match what `fn` sends, or the gateway's durable
 *  fast path forwards something different from the client path (§5.2). */
function blankOrText(v: string): string {
  return (v ?? "").trim() === "" ? "" : String(Number(v));
}

/** Declared value for a status task: `{}` is Monday's clear, matching
 *  `writeStatusOrClear` above. */
function statusValue(id: number | null): unknown {
  return id === null ? {} : { index: id };
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
  /* ⚠️ `!== null` alone — an EMPTY edit is a real answer here.
     The guard used to be `!== "" `, which silently dropped a rep clearing the
     field: the input went blank, the send reported success and the board kept
     the old ID. Brandon's Block A makes that clear load-bearing — answering
     "No secondary" CLEARS Member ID 2, because a leftover ID under "None" is a
     contradiction the next reader has to resolve. Null still means untouched. */
  /* ⚠️ `typeof === "string"`, not `!== null`. Undefined is UNTOUCHED, the same
     as null — a Patient mapped before this field existed has no key at all, and
     `undefined !== null` is true, so the loose guard pushed a task whose `value`
     was undefined. One such task disables the gateway's durable fast path for
     the WHOLE send (§5.2). An empty STRING is still a real edit, which is what
     lets "No secondary" clear Member ID 2. */
  /* Order Frequency. ⚠️ The EFFECTIVE value is written, including a payer
     default the rep never touched — otherwise a defaulted cadence stays blank
     on the board and the Subscription hop has nothing to copy. That is the
     whole point of moving this off the notes block. */
  {
    const f = frequencyState({
      boardLabel: p.orderFrequency,
      edited: p.orderFrequencyEdited,
      primaryInsurance: p.primaryInsuranceEdited ?? p.primaryInsurance,
      secondaryInsurance: p.secondaryInsuranceEdited ?? p.secondaryInsurance,
    });
    const label = daysToLabel(f.days);
    const index = ORDER_FREQUENCY_INDEX[label];
    // ⚠️ Never write an index the column doesn't have — Monday drops it without
    // erroring (§5.20). An unmapped label means the rules and the board have
    // drifted, and writing nothing is the visible failure.
    if (index !== undefined)
      tasks.push({ label: "Order Frequency", columnId: COL.orderFrequency, value: { index }, fn: () => writeStatusIndex(p.id, COL.orderFrequency, index) });
  }
  /* ── Phone slots & caregiver (§5.31d) ──
     The STAR decides: the starred slot becomes Primary Phone, the other becomes
     Alternate Phone, and only the final state of the call is written however
     many times the star moved.

     ⚠️ `null` from `phoneSlotWrites` means CLEAR, not skip — these columns are
     the source of truth now, so a removed second number has to remove Alternate
     Contact with it, and a caregiver who is no longer on either slot has their
     name and HIPAA tick cleared. A standing authorisation against a patient who
     no longer shares their account is a record that says the wrong thing.

     ⚠️ Every `value` is a real value, never `undefined` — one undefined task
     disables the gateway's durable fast path for the WHOLE send (§5.2), the
     trap `writeTaskParity.test.ts` caught on Member ID 2. */
  {
    const w = phoneSlotWrites(phoneSlotsFor(p), caregiverFor(p));
    const statusValue = (id: number | null) => (id === null ? {} : { index: id });

    /* ⚠️ A phone task's declared `value` must be the bytes `writePhone` really
       sends — `{phone, countryShortName}`, never the bare string. The gateway's
       durable fast path sends the DECLARED value (§5.2), so a bare string would
       reach a phone column and be refused at HTTP 200 with "invalid value,
       please check our API documentation for the correct data structure for
       this column" (§10). Caught by `writeTaskParity.test.ts`, which is the
       only thing that would have.
       ⚠️ An UNPARSEABLE number pushes NO TASK: `writePhone` skips it, so a task
       declaring `{}` would CLEAR a real number instead of leaving it alone. The
       gate refuses these before the send anyway (`phoneSlotGaps`); this is the
       second line. A blank IS a clear — that is how a removed second number
       takes Alternate Phone with it. */
    const phoneTask = (label: string, columnId: string, value: string) => {
      const plan = planPhoneWrite(value);
      if (plan.action === "skip") return;
      tasks.push({
        label,
        columnId,
        value: plan.action === "write" ? { phone: plan.phone, countryShortName: "US" } : {},
        fn: () => writePhone(p.id, columnId, value),
      });
    };
    phoneTask("Primary Phone", COL.phone, w.primaryPhone);
    phoneTask("Alternate Phone", COL.alternatePhone, w.alternatePhone);
    tasks.push({ label: "Primary Contact", columnId: COL.primaryContact, value: statusValue(w.primaryContactId), fn: () => writeStatusOrClear(p.id, COL.primaryContact, w.primaryContactId) });
    tasks.push({ label: "Alternate Contact", columnId: COL.alternateContact, value: statusValue(w.alternateContactId), fn: () => writeStatusOrClear(p.id, COL.alternateContact, w.alternateContactId) });
    tasks.push({ label: "Can Text", columnId: COL.canText, value: statusValue(w.canTextId), fn: () => writeStatusOrClear(p.id, COL.canText, w.canTextId) });
    tasks.push({ label: "Caregiver Name", columnId: COL.caregiverName, value: w.caregiverName, fn: () => writeText(p.id, COL.caregiverName, w.caregiverName) });
    tasks.push({ label: "Caregiver Authorized", columnId: COL.caregiverAuthorized, value: w.caregiverAuthorized ? { checked: "true" } : {}, fn: () => writeCheckbox(p.id, COL.caregiverAuthorized, w.caregiverAuthorized) });
  }

  if (typeof p.memberId2Edited === "string")
    tasks.push({ label: "Member ID 2", columnId: COL.memberId2, value: p.memberId2Edited, fn: () => writeText(p.id, COL.memberId2, p.memberId2Edited as string) });
  if (typeof p.insuranceNotesEdited === "string")
    tasks.push({ label: "Insurance Notes", columnId: COL.insuranceNotes, value: p.insuranceNotesEdited, fn: () => writeText(p.id, COL.insuranceNotes, p.insuranceNotesEdited as string) });

  // ⚠️ This module's writeNumber takes a NUMBER and always sends String(num) as
  // a PLAIN STRING — no skip, no cleaning (unlike profile's, which cleans and
  // may write nothing). The `String(Number(...))` on the quantity fields below
  // is deliberate parity with the fn, not redundancy: a non-numeric field sends
  // "NaN" today and must keep doing so. Monitor Qty is the ONE exception — it
  // is coerced first, so "NaN" can no longer reach that column.

  // Monitor Qty is BINARY — always written, always "0" or "1", never blank.
  // This used to be `if (p.monitorQty !== "")`, i.e. a blank wrote NOTHING while
  // the form's own toggle rendered that blank as "0 — No". The board's four
  // order-creation automations compare this column with `is equal to`, so the
  // empty cell that left behind matched no branch at all — see
  // lib/shared/monitorQty.ts for the four automations and the 84%-blank scan.
  const monitorQtyToWrite = coerceMonitorQty(p.monitorQty);
  tasks.push({ label: "Monitor Qty", columnId: COL.monitorQty, value: monitorQtyToWrite, fn: () => writeNumber(p.id, COL.monitorQty, Number(monitorQtyToWrite)) });
  // Pump Qty is coerced to 0 when Serving does not sell a pump DEVICE. The form
  // disables the control, but a value already on the board — or one set before
  // Serving was corrected — still reaches here otherwise, which is exactly how
  // Bradan French's `1` survived a Welcome Call save on a `Supplies + CGM`
  // profile and shipped a pump. See lib/shared/servingLines.ts.
  const pumpQtyToWrite = coercePumpQty(p.pumpQty, p.servingEdited ?? p.serving);
  if (pumpQtyToWrite !== "") tasks.push({ label: "Pump Qty", columnId: COL.pumpQty, value: String(Number(pumpQtyToWrite)), fn: () => writeNumber(p.id, COL.pumpQty, Number(pumpQtyToWrite)) });
  // The two infusion quantities are ALWAYS written, blank included, because a
  // blank here is a REMOVAL and not an absence of opinion. Brandon, 2026-09-09:
  // "If Set 2 is removed, restore Qty 1's default and write blanks to Infusion
  // Set 2 / Qty Inf. 2 on Monday — don't leave the old values on the board."
  // The old `if (p.qtyInf2 !== "")` guard meant a rep who dropped the second set
  // saw it clear on screen, pressed Send, got a green toast, and left the old
  // set and quantity sitting on the row — which then rode to the Order board and
  // Cardinal as a second set the patient never agreed to. Same `!== ""` shape as
  // the Member ID 2 bug fixed on 2026-09-09 (§5.31c).
  // ⚠️ `blankOrNumber` exists because `Number("")` is 0: funnelling the blank
  // through `Number()` writes a zero and reports success, and 0 is a real
  // quantity, not a clear.
  tasks.push({ label: "Infusion Set 1 Qty", columnId: COL.qtyInf1, value: blankOrText(p.qtyInf1), fn: () => writeNumber(p.id, COL.qtyInf1, blankOrNumber(p.qtyInf1)) });
  tasks.push({ label: "Infusion Set 2 Qty", columnId: COL.qtyInf2, value: blankOrText(p.qtyInf2), fn: () => writeNumber(p.id, COL.qtyInf2, blankOrNumber(p.qtyInf2)) });
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

  // The set column goes with its quantity, never one without the other — see the
  // quantities above for why an emptied slot must reach the board.
  // ⚠️ But an emptied slot and a slot we FAILED TO READ look identical from the
  // index alone, so `infusionSetWriteAction` reads the label too: a null index
  // beside a live label is a bad read, and clearing there would destroy a real
  // selection. It returns "skip" and no task is pushed at all.
  const setTask = (label: string, columnId: string, index: number | null, boardLabel: string) => {
    const action = infusionSetWriteAction(index, boardLabel);
    if (action === "skip") return;
    tasks.push({
      label,
      columnId,
      // `{}` is Monday's clear for a status column, and the DECLARED value has
      // to be what `fn` sends or the gateway's durable fast path forwards
      // something the client path does not (§5.2).
      value: action === "clear" ? {} : { index: index! },
      fn: () => writeStatusOrClear(p.id, columnId, action === "clear" ? null : index!),
    });
  };
  setTask("Infusion Set 1", COL.infusionSet1, p.infusionSet1Index, p.infusionSet1);
  setTask("Infusion Set 2", COL.infusionSet2, p.infusionSet2Index, p.infusionSet2);
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
    { label: "IP Next Order Date", columnId: COL.ipNextOrderDate, edited: p.ipNextOrderDateEdited, mondayDate: p.ipNextOrderDate, lastBillDates: resolveLastBillDates([{ sos: p.sosLastBillIp, legacy: p.ipLastBillDate }]), served: pumpServed },
    { label: "Sensors Next Order Date", columnId: COL.sensorsNextOrderDate, edited: p.sensorsNextOrderDateEdited, mondayDate: p.sensorsNextOrderDate, lastBillDates: resolveLastBillDates([{ sos: p.sosLastBillSensors, legacy: p.sensorsLastBillDate }, { sos: p.sosLastBillMonitor, legacy: p.cgmLastBillDate }]), served: cgmServed },
    { label: "Supplies Next Order Date", columnId: COL.suppliesNextOrderDate, edited: p.suppliesNextOrderDateEdited, mondayDate: p.suppliesNextOrderDate, lastBillDates: resolveLastBillDates([{ sos: p.sosLastBillInfusionSet, legacy: p.infusionSetLastBillDate }, { sos: p.sosLastBillCartridge, legacy: p.cartridgeLastBillDate }]), served: pumpServed },
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
  const notesBase = appendIntakeToNotes(p.notes, p.callIntake);
  /* ⚠️ The HIPAA consent audit line, stamped ONLY on the off→on transition
     (`caregiverConsentJustGiven` compares against what the BOARD holds). The
     checkbox records the CURRENT state; this records that consent was obtained,
     by whom and when — the half a checkbox cannot carry, and the half Brandon
     asked for by name. Stamping on "is it ticked now" instead would re-append
     the same line on every subsequent send until the log is a wall of claims
     about one conversation. */
  const notesToWrite = caregiverConsentJustGiven(p)
    ? appendStampedNote(notesBase, caregiverConsentNote(), "Welcome Call")
    : notesBase;
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
  // Binary, always written — same rule and same reason as the send above. This
  // writer fires the welcome-call autotext automation, so it must not leave the
  // column in the unclassifiable blank state either.
  tasks.push(writeNumber(p.id, COL.monitorQty, Number(coerceMonitorQty(p.monitorQty))));
  // Same Serving coercion as buildDataTasks above — this writer fires the
  // welcome-call autotext automation, so it must not stamp a pump quantity the
  // Serving label does not support either.
  const pumpQtyToWrite = coercePumpQty(p.pumpQty, p.servingEdited ?? p.serving);
  if (pumpQtyToWrite !== "") tasks.push(writeNumber(p.id, COL.pumpQty, Number(pumpQtyToWrite)));
  // Always written, blank = clear — same contract as buildDataTasks above, and
  // this writer must match it or the two send paths would disagree about
  // whether a removed set is really removed.
  tasks.push(writeNumber(p.id, COL.qtyInf1, blankOrNumber(p.qtyInf1)));
  tasks.push(writeNumber(p.id, COL.qtyInf2, blankOrNumber(p.qtyInf2)));
  if (p.qtyCartridge !== "") tasks.push(writeNumber(p.id, COL.qtyCartridge, Number(p.qtyCartridge)));

  // Infusion Sets + Subscription Type + Order Handling
  // Same three-way rule as the send above — an unmappable label is skipped, not
  // cleared. The two writers must agree about what a removal is.
  if (infusionSetWriteAction(p.infusionSet1Index, p.infusionSet1) !== "skip")
    tasks.push(writeStatusOrClear(p.id, COL.infusionSet1, p.infusionSet1Index));
  if (infusionSetWriteAction(p.infusionSet2Index, p.infusionSet2) !== "skip")
    tasks.push(writeStatusOrClear(p.id, COL.infusionSet2, p.infusionSet2Index));
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
  // Same clear-is-an-answer rule, and the same undefined-is-untouched guard.
  if (typeof p.memberId2Edited === "string")
    tasks.push(writeText(p.id, COL.memberId2, p.memberId2Edited));
  if (typeof p.insuranceNotesEdited === "string")
    tasks.push(writeText(p.id, COL.insuranceNotes, p.insuranceNotesEdited));

  // Address
  if (p.addressEdited !== null) {
    const lat = p.addressLat ?? 0;
    const lng = p.addressLng ?? 0;
    tasks.push(writeLocation(p.id, COL.address, p.addressEdited, lat, lng));
  }

  /* ── The phone slots (§5.31d) ──
     ⚠️ This writer had NO phone column in its push at all, and the automation
     it fires — 7918318033, "Welcome Call Text → Send → Send SMS from RC Number"
     — reads **Primary Phone**. That was harmless only while the banner's own
     Save button owned that column; now the STAR does, so a rep who stars the
     caregiver's cell and presses this would have texted the number the board
     still held. Brandon's handoff calls this out by name.

     Written in Phase 1 with everything else, so the value is committed before
     Phase 2 flips the trigger. Same shapes and the same skip-vs-clear rules as
     `buildDataTasks` — an unparseable number writes nothing rather than
     clearing a real one. */
  {
    const w = phoneSlotWrites(phoneSlotsFor(p), caregiverFor(p));
    const pushPhone = (columnId: string, value: string) => {
      if (planPhoneWrite(value).action === "skip") return;
      tasks.push(writePhone(p.id, columnId, value));
    };
    pushPhone(COL.phone, w.primaryPhone);
    pushPhone(COL.alternatePhone, w.alternatePhone);
    tasks.push(writeStatusOrClear(p.id, COL.primaryContact, w.primaryContactId));
    tasks.push(writeStatusOrClear(p.id, COL.alternateContact, w.alternateContactId));
    tasks.push(writeStatusOrClear(p.id, COL.canText, w.canTextId));
    tasks.push(writeText(p.id, COL.caregiverName, w.caregiverName));
    tasks.push(writeCheckbox(p.id, COL.caregiverAuthorized, w.caregiverAuthorized));
  }

  // Phase 1: wait for every data field to commit
  await Promise.all(tasks);

  // Phase 2: now flip Welcome Call Text to Send so the Monday automation fires
  // with up-to-date column values.
  await writeStatusIndex(p.id, COL.welcomeCallText, 0);
}

/**
 * Mark this patient Stuck, with a reason.
 *
 * ⚠️ **This is what replaced "Don't Advance"** (Josh, 2026-09-11: *"remove
 * don't advance completely"*). That button was broken in a way worth
 * remembering: BOTH end-of-call choices wrote Stage Advancer → Review Profile,
 * which is the move to Final Profile Confirmation — so the button labelled
 * "hold this patient" moved them forward.
 *
 * ⚠️ **Not a Propose Stuck, and deliberately not pretending to be one.** This
 * board has no propose→approve ladder: `StageActionBar` does not render here,
 * `StageKey` has no `welcome-call`, and the Escalation column carries only
 * "Escalation Required" and "Done" — no index 2 for the ladder to write, and
 * Monday drops a write to a label that does not exist at HTTP 200 with no
 * error. This is the DIRECT exit, which is the same call already made for
 * Profile Send Off (§5.10, Josh 2026-08-20: "no propose stuck anywhere").
 *
 * ⚠️ **Reason FIRST, advancer second** — the §5.10 ordering rule. A failed
 * advancer then leaves a stamped patient still in the rep's queue, visible and
 * retryable; the other order parks somebody in the Stuck group with no
 * explanation of why. And the reason is REQUIRED because this board has no
 * stuck-reason column: the stamped note is the only record that will exist.
 *
 * ⚠️ Appends onto the polled copy of Notes, like every other stage-page note
 * path — the same one-poll lost-update exposure, not a new one.
 */
export async function markStuckWithReason(p: Patient, reason: string): Promise<void> {
  const text = reason.trim();
  if (!text) throw new Error("A reason is required to mark a patient stuck");
  const notes = appendStampedNote(p.notes, `Marked stuck — ${text}`, "Welcome Call");
  await assertTextLikeFits(BOARD_ID, COL.notes, notes, "Welcome Call Notes");
  await writeLongText(p.id, COL.notes, notes);
  await writeStatusIndex(p.id, COL.stageAdvancer, STAGE_ADVANCER_STUCK);
}

/** Stage Advancer `color_mm1ws96t` — 0 Review Profile · 2 Stuck / Don't
 *  Proceed · 4 Completed · 7 Welcome Call. Read off the live board. */
export const STAGE_ADVANCER_STUCK = 2;

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