import { writeStatusIndex, writeNumber, writeLocation, writeText, writeLongText, writeDate, writeDropdownIds, writePhone, writeEmail, writeCheckbox, clearStatusColumn, readColumnTexts, COL, BOARD_ID } from "./mondayApi";
import { executeWritesWithVerification, type WriteProgressPhase } from "../shared/verifiedWrite";
import { planPhoneWrite } from "../shared/phoneCell";
import { planEmailWrite } from "../shared/emailCell";
import type { Patient } from "./workflow";
import { mrRungForExpiry } from "./mrStatus";
import { appendNoteEntry, stampNoteEntry } from "../shared/noteStamp";
import { EXTRA_COL, extrasRefusals, type ExtrasEdit } from "./profileExtras";
import { resolveFaxParachuteWrite } from "./faxParachute";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;

export interface WriteTask {
  label: string;
  columnId: string;
  fn: () => Promise<unknown>;
  /** Raw Monday value in change_multiple_column_values shape — mirrors exactly
   *  what this task's write helper hands JSON.stringify. Every task must carry
   *  one or the gateway /send fast path stays disengaged. */
  value?: unknown;
  /** Verify this DATA column by exact read-back rather than by "it changed".
   *  Worth it for an append onto a column with a second writer: a snapshot diff
   *  says something moved, which is also true when somebody else's line landed
   *  and ours did not. (On a STAGE task the same field means something else —
   *  it opts into the advancer no-op guard — so do not add it to one lightly.) */
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
    /** The patient screen's extra columns (`profileExtras.ts`) — ONLY the ones
     *  the rep changed. Absent, the send is exactly what it always was, which
     *  is what `/subscription` gets. */
    extras?: ExtrasEdit;
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

  // Fax / Parachute — resolved from the LABEL, live board first (`faxParachute.ts`).
  // This was `faxVal === "Parachute" ? 1 : 0`, which rewrote every Email and
  // Dashboard patient to Fax on save. A value the board cannot name is left
  // alone; a rep's pick it cannot hold refuses the send here, before any write.
  const faxPlan = await resolveFaxParachuteWrite(p);
  if (faxPlan.action === "refuse") throw new Error(faxPlan.reason);
  if (faxPlan.action === "write") {
    const faxIdx = faxPlan.index;
    tasks.push({ label: "Fax/Parachute", columnId: COL.faxParachute, value: { index: faxIdx }, fn: () => writeStatusIndex(p.id, COL.faxParachute, faxIdx) });
  }

  // Patient screen only — see `buildExtrasTasks`. Rides the SAME verified
  // transaction, so the Order details card and the Contacts block land (or
  // fail) with the rest of the profile, in one gateway job.
  if (opts?.extras) tasks.push(...buildExtrasTasks(p.id, opts.extras));

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
 * The patient screen's extra Subscription columns (Brandon's pixel-match,
 * PIXEL_MATCH_PLAN.md §4.1): Order Frequency, the CGM and cartridge
 * quantities, and the Contacts block. Built from a DELTA (`diffExtras`), never
 * from a record, so nothing the rep did not change is written.
 *
 * ⚠️ Every task carries its real `value` — one `undefined` disables the
 * gateway's durable fast path for the WHOLE send (§5.2).
 * ⚠️ The refusals run here as well as on the Save: `writePhone` SKIPS a number
 * it cannot parse, so an unchecked alternate phone would come back green
 * having written nothing (§5.32d). A refused change set throws before any
 * write is issued.
 * ⚠️ A status clear is `{}`, never `{index: null}` (§5.31c).
 */
export function buildExtrasTasks(itemId: string, edit: ExtrasEdit): WriteTask[] {
  const refused = extrasRefusals(edit);
  if (refused.length) throw new Error(refused.join("; "));

  const out: WriteTask[] = [];
  const status = (label: string, columnId: string, idx: number | null | undefined) => {
    if (idx === undefined) return;
    out.push(
      idx === null
        ? { label, columnId, value: {}, fn: () => clearStatusColumn(itemId, columnId) }
        : { label, columnId, value: { index: idx }, fn: () => writeStatusIndex(itemId, columnId, idx) },
    );
  };
  const number = (label: string, columnId: string, v: string | undefined) => {
    if (v === undefined) return;
    const t = v.trim();
    out.push({
      label,
      columnId,
      value: t === "" ? "" : String(Number(t)),
      fn: () => writeNumber(itemId, columnId, t === "" ? "" : Number(t)),
    });
  };

  status("Order Frequency", EXTRA_COL.orderFrequency, edit.orderFrequencyIndex);
  number("CGM Qty", EXTRA_COL.cgmQty, edit.cgmQty);
  number("Cartridge Qty", EXTRA_COL.cartridgeQty, edit.cartridgeQty);
  status("Primary Contact", EXTRA_COL.primaryContact, edit.primaryContactIndex);
  status("Alternate Contact", EXTRA_COL.alternateContact, edit.alternateContactIndex);
  if (edit.caregiverName !== undefined) {
    const name = edit.caregiverName;
    out.push({ label: "Caregiver Name", columnId: EXTRA_COL.caregiverName, value: name, fn: () => writeText(itemId, EXTRA_COL.caregiverName, name) });
  }
  if (edit.caregiverAuthorized !== undefined) {
    const on = edit.caregiverAuthorized;
    out.push({
      label: "Caregiver Authorized",
      columnId: EXTRA_COL.caregiverAuthorized,
      value: on ? { checked: "true" } : {},
      fn: () => writeCheckbox(itemId, EXTRA_COL.caregiverAuthorized, on),
    });
  }
  if (edit.alternatePhone !== undefined) {
    const raw = edit.alternatePhone;
    const plan = planPhoneWrite(raw);
    // `skip` cannot reach here — `extrasRefusals` refused it above — but a task
    // declaring `{}` for it would CLEAR a real number, so it is never pushed.
    if (plan.action !== "skip")
      out.push({
        label: "Alternate Phone",
        columnId: EXTRA_COL.alternatePhone,
        value: plan.action === "write" ? { phone: plan.phone, countryShortName: "US" } : {},
        fn: () => writePhone(itemId, EXTRA_COL.alternatePhone, raw),
      });
  }
  return out;
}

/**
 * Immediately push notes to the Subscription Patient Notes column on Monday.
 */
export async function sendNotesToMonday(itemId: string, notes: string): Promise<void> {
  await writeLongText(itemId, COL.subscriptionNotes, notes);
}

/**
 * Update Clinicals' "Update Visit Date" save: push MN Expiry out, and set the
 * MR status the new date implies.
 *
 * The MR half is the fix for Brandon's 2026-09-15 report — see
 * `mrStatus.ts` for why the board could never do it alone (its five
 * automations only ever count DOWN, and nothing on it sets MR Valid).
 *
 * ⚠️ MN EXPIRY IS THE DATA, MR IS THE TRIGGER — hence the verified write with
 * MR as `stageColumnId`, which is what holds it back until MN Expiry is
 * confirmed indexed. Two independent reasons, either alone sufficient:
 *
 *  1. Webhook 637064239 on this board is "when `color_mktyr8xg` changes, send
 *     a webhook" — so the MR write fires an external consumer, and Monday
 *     returns 200 on a column write BEFORE the value is indexed (§5.2). Firing
 *     MR first hands that consumer an item still carrying the OLD MN Expiry:
 *     the exact stale-sibling read the protocol exists to prevent.
 *  2. A half-failure must leave the safer state. Date first means a failed
 *     date write claims nothing; if the date lands and the status write fails,
 *     the row is where it is today — expiry pushed, status stale — which is no
 *     worse than before this function existed. The other order would assert
 *     that a patient's records are current on a row whose expiry never moved.
 *
 * ⚠️ NO `expectedText` on the MR task, deliberately. That field opts a column
 * into the §9 advancer no-op guard, which REFUSES the send when the column
 * already reads the target. Right for a stage advancer whose automation must
 * fire; wrong here — writing "MR Valid" onto a row already reading MR Valid is
 * a reconciliation we are happy to no-op, not a failure to report. Monday
 * silently discards the same-value write and no webhook fires.
 */
export async function saveVisitDateVerified(
  itemId: string,
  expiryYmd: string,
): Promise<void> {
  const rung = mrRungForExpiry(expiryYmd);

  const tasks: WriteTask[] = [
    {
      label: "MN Expiry",
      columnId: COL.mnExpiry,
      value: { date: expiryYmd },
      fn: () => writeDate(itemId, COL.mnExpiry, expiryYmd),
    },
  ];

  // No readable date ⇒ no status claim (mrStatus.mrRungForExpiry returns null).
  // The date write still runs; we just do not guess a rung from a value we
  // could not parse.
  if (rung) {
    tasks.push({
      label: "MR",
      columnId: COL.mr,
      value: { index: rung.index },
      fn: () => writeStatusIndex(itemId, COL.mr, rung.index),
    });
  }

  const failures = await executeWritesWithVerification({
    itemId,
    boardId: String(BOARD_ID),
    label: "Update Clinicals — visit date",
    tasks,
    stageColumnId: rung ? [COL.mr] : [],
    executeWithRetry,
    readColumns: readColumnTexts,
  });

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} column(s) failed after retries. Failed: ${failures.map((f) => f.split(":")[0]).join(", ")}`,
    );
  }
}

/* ── The office replied, but sent no new records ──────────────────────────
      Records Masheke's reading of a fax that carried no clinicals, and — when
      the office named a date the patient is next in — schedules the follow-up
      chase off it. See lib/subscription/recordsReply.ts for the three answers
      and why only one of them takes a date. ─────────────────────────────── */

/**
 * Append one stamped line to MR Request Log, and optionally set Next Doc Appt
 * Date.
 *
 * ⚠️ THE LOG IS RE-READ IMMEDIATELY BEFORE THE APPEND, never taken from the
 * page's copy. Monday has no compare-and-set — `change_column_value` REPLACES
 * the value — and this column has a SECOND WRITER: `email-serivce`'s
 * `mr-request` appends a line every time it faxes an office, on its own
 * schedule, with nothing telling this page it happened. Appending onto a copy
 * the page loaded minutes ago would silently delete whichever lines landed in
 * between, and the thing deleted would be the record of the very request this
 * reply is answering. Re-reading narrows that to one round trip, the same
 * exposure every other note path in the app carries. A failed re-read ABORTS
 * rather than appending onto "" — the alternative is replacing the entire
 * history with one line.
 *
 * ⚠️ NEXT DOC APPT DATE IS THE STAGE ADVANCER HERE, so it is written LAST,
 * behind read-back verification of the note. It is not a note: a board
 * automation flips MR Rechase the day after it, and the service faxes the
 * office another records request. Arming that before the reason for it has
 * landed would leave a fax scheduled with nothing on the item explaining why —
 * the same reason Mark as Stuck stamps its reason before it moves an item.
 */
export async function recordRecordsReplyVerified(
  itemId: string,
  { noteLine, apptDate }: { noteLine: string; apptDate?: string },
): Promise<void> {
  const trimmed = noteLine.trim();
  if (!trimmed) throw new Error("Nothing to record — the reply produced no note line.");

  const existing = await readColumnTexts(itemId, [COL.mrRequestLog]);
  const current = existing.find((c) => c.id === COL.mrRequestLog);
  if (!current) {
    throw new Error(
      "Could not read MR Request Log, so the reply was not saved — appending now would replace the whole history. Try again.",
    );
  }
  const next = appendNoteEntry(current.text ?? "", stampNoteEntry(trimmed, "Update Clinicals"));

  const tasks: WriteTask[] = [
    {
      label: "MR Request Log",
      columnId: COL.mrRequestLog,
      value: next,
      expectedText: next,
      fn: () => writeLongText(itemId, COL.mrRequestLog, next),
    },
  ];

  if (apptDate) {
    tasks.push({
      label: "Next Doc Appt Date",
      columnId: COL.nextDocApptDate,
      value: { date: apptDate },
      fn: () => writeDate(itemId, COL.nextDocApptDate, apptDate),
    });
  }

  const failures = await executeWritesWithVerification({
    itemId,
    boardId: String(BOARD_ID),
    label: "Update Clinicals — office reply",
    tasks,
    // The date is held back until the note is confirmed indexed; with no date
    // there is nothing to advance and this is a plain verified write.
    stageColumnId: apptDate ? [COL.nextDocApptDate] : [],
    executeWithRetry,
    readColumns: readColumnTexts,
  });

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} column(s) failed after retries. Failed: ${failures.map((f) => f.split(":")[0]).join(", ")}`,
    );
  }
}
