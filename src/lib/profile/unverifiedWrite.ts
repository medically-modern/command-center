/**
 * Write-back for the Unverified Referrals (DTC + CareCentrix) intake stage.
 *
 * Separate from mondayWrite.ts on purpose: that module serves the Verified
 * Referrals send-off and must not change. This one owns only the columns the
 * intake stage touches.
 *
 * Two rules this file exists to enforce:
 *
 *  1. **Status columns are written by INDEX, never by label** (HANDOFF §5.2).
 *     Labels come off the board at runtime, so a rename on Monday would break
 *     a label-based write — silently, because Monday drops a status write for
 *     an unknown label without erroring. Index survives renames.
 *
 *  2. **Provided ≠ verified.** Nothing here writes the verified doctor columns
 *     (doctorName / doctorPhone / doctorNpi / clinicName / clinicAddress).
 *     Those belong to Select Correct Provider. The patient's own answers live
 *     in the Provided * columns and are never overwritten (HANDOFF §6.0).
 */

import {
  COL, GROUPS, writeStatusIndex, writeText, writeNumber, writeLongText, writeItemName,
  writePhone, writeEmail, writeLocation, writeDropdownIds, writeDropdownLabels,
  readColumnTexts, moveItemToGroup, writeDate,
} from "./mondayApi";
import { executeWritesWithVerification } from "../shared/verifiedWrite";
import { CLINICALS_METHOD_INDEX } from "./mondayMapping";
import type { Patient } from "./workflow";
import { appendStampedNote } from "../shared/noteStamp";
import { userInitials } from "../shared/auth";
import {
  GENERAL_INSURANCE_INDEX, PRIMARY_INSURANCE_INDEX,
  SECONDARY_INSURANCE_INDEX, SERVING_INDEX, MOVE_TO_ONBOARDING_INDEX,
  REQUEST_TYPE_INDEX, CGM_COVERAGE_PATH_INDEX, INSULIN_PUMP_COVERAGE_PATH_INDEX,
  REFERRAL_TYPE_INDEX, REFERRAL_SOURCE_INDEX, GENDER_INDEX, FOLLOW_UP_INDEX,
  CGM_TYPE_INDEX, PUMP_TYPE_INDEX,
} from "./mondayMapping";

/** label → index for every status column this stage writes.
 *  Indices are the ones the columns were created with; they are stable across
 *  label renames, which is exactly why we write them instead of the text. */
export const INTAKE_STATUS_INDEX = {
  selfAdvocacy: { High: 0, Low: 1 },
  cgmDataAwareness: {
    "Patient has existing data": 0,
    "Doctor is aware": 1,
    "Neither applies": 2,
    "Both apply": 3,
  },
  intakeCallComplete: { Yes: 0 },
  formProceedPreference: { "Send request now": 0, "Wants a call first": 1 },
  formBookingStatus: { Scheduled: 0, Unscheduled: 1 },
  formInsuranceVia: { "Photo of card": 0, "Entered manually": 1, "Not provided": 2 },
  formPumpNeed: { "Need a new pump": 0, "Only need supplies": 1 },
  formReasonForInquiry: {
    "Pharmacy is too expensive": 0,
    "Denied by insurance": 1,
    "I need a new supplier": 2,
    "I want off the finger prick / try a pump": 3,
  },
  formCgmPreference: {
    "Freestyle Libre 3 Plus": 0,
    "Dexcom G7": 1,
    "Medtronic Guardian 4": 2,
    "Any will work": 3,
  },
  formPumpPreference: {
    "Tandem t:slim X2": 0,
    "Tandem Mobi": 1,
    "Beta Bionics iLet": 2,
    "Not sure": 3,
  },
  formSecondaryProvided: {
    "Anthem or Blue Cross Blue Shield": 0,
    UnitedHealthcare: 1,
    Aetna: 2,
    Cigna: 3,
    Humana: 4,
    // Monday did NOT honour the index we asked for on create: it left 5 blank
    // and put NYS Medicaid at 11. Verified against the live board 2026-08-06.
    // Index is the truth here — do not "tidy" this back to 5.
    Medicare: 6,
    Fidelis: 7,
    "NYSHIP Empire": 8,
    Other: 9,
    None: 10,
    "NYS Medicaid": 11,
  },
} as const;

export type IntakeStatusField = keyof typeof INTAKE_STATUS_INDEX;

export interface IntakeWriteResult {
  ok: boolean;
  /** Columns that failed, with why. Empty on a clean save. */
  errors: { label: string; columnId: string; error: string }[];
}

interface WriteTask {
  label: string;
  columnId: string;
  fn: () => Promise<unknown>;
}

/** Resolve a status label to its index, or undefined when the label isn't one
 *  we know. An unknown label is skipped rather than guessed — writing the
 *  wrong index would silently file the patient under the wrong answer. */
export function statusIndexFor(field: IntakeStatusField, label: string | undefined): number | undefined {
  if (!label) return undefined;
  const map = INTAKE_STATUS_INDEX[field] as Record<string, number>;
  return map[label.trim()];
}

/** Everything a rep can edit on the intake stage. All optional — a partial
 *  save must never blank a column the rep didn't touch. */
export interface IntakeEdits {
  // Demographics the rep can correct. Name and phone come off the form as the
  // patient typed them, so they are the two most likely to need fixing before
  // the benefits check runs against them.
  name?: string;
  ptPhone?: string;
  dob?: string;
  email?: string;
  formState?: string;
  /** Not asked on the intake form — the rep or Stedi supplies it. */
  gender?: string;
  /** The mockup's one genuinely MISSING datum, not just an unrendered one:
   *  location_mm1xhw17 is empty on every form patient and downstream stages
   *  need it to ship. Lat/lng ride along because Monday's location column
   *  takes them together with the address text. */
  patientAddress?: string;
  patientAddressLat?: number | null;
  patientAddressLng?: number | null;

  // Referral routing — where this patient came from. Board automations also
  // set Type from Source on item creation; a rep correcting it here wins,
  // because those only run once, at create.
  referralType?: string;
  referralSource?: string;

  // Product decision. These share their Monday columns with the Serving &
  // Coverage card on the right pane — one value, two places to edit it, so
  // both bind to the same patient field and this writes it once.
  requestType?: string;
  cgmCoveragePath?: string;
  insulinPumpCoveragePath?: string;
  /** The DEVICE, distinct from the patient's stated preference
   *  (formCgmPreference / formPumpPreference). Both were read into Patient and
   *  had no write path, so the mockup's CGM Type / Pump Type dropdowns — two of
   *  the four §5.2 names — were invisible AND unsaveable. */
  cgmType?: string;
  pumpType?: string;

  // Insurance (left pane — what the patient told us, and what Stedi reads)
  generalInsurance?: string;
  workingMemberId?: string;
  formInsuranceVia?: string;
  formInsuranceOther?: string;
  formSecondaryProvided?: string;
  formSecondaryMemberId?: string;

  // Product
  formReasonForInquiry?: string;
  formPumpNeed?: string;
  formCgmPreference?: string;
  formPumpPreference?: string;

  // Provided doctor info — rep can correct what the patient gave us.
  // These are NOT the verified doctor columns.
  formProvidedDoctorName?: string;
  formProvidedClinicPhone?: string;
  /**
   * The one exception to "provided ≠ verified" (§6.0), on Josh's call: the
   * mockup's Provided Doctor Info → Clinic Address writes the VERIFIED clinic
   * address column, `location_mm1xjnfv`. There is no separate provided-address
   * column and one isn't wanted.
   *
   * That means two builders can emit a task for this column — here, and
   * buildDoctorTasks when a provider is picked in step 3. `buildAdvanceTasks`
   * de-duplicates so the provider's wins; see the note there.
   */
  clinicAddress?: string;
  clinicAddressLat?: number | null;
  clinicAddressLng?: number | null;

  // Call handling
  formProceedPreference?: string;
  formCallSlot?: string;
  formBookingStatus?: string;
  intakeCallComplete?: boolean;
  attemptCounter?: number;

  // Insurance follow-up. Both columns were already READ into Patient; nothing
  // ever wrote them, so the mockup's "Start Insurance Follow-Up" had a place to
  // land and no way to get there.
  followUp?: string;
  followUpDate?: string;

  // Care assessment / cost — rep-entered on the call
  selfAdvocacy?: string;
  currentOopCost?: string;
  cgmDataAwareness?: string;

  // `notes` is deliberately NOT here. The Call Log is append-only and stamped
  // (the mockup says so under the card, and §9 makes it the app-wide rule), so
  // it cannot ride along in a bulk save that overwrites whatever it is given.
  // Use `appendIntakeNote` instead.
}

/**
 * The write tasks for a rep's edits, built but NOT run.
 *
 * Exposed separately from `writeIntakeEdits` because the Save button and the
 * Advance need the same columns written through different machinery: Save runs
 * them loose (one bad column shouldn't discard the rest of a rep's typing),
 * while Advance has to hand them to `executeWritesWithVerification` so they are
 * read back BEFORE the stage advancer fires. Two call sites, one list — a
 * second copy is how a column ends up saved on one path and dropped on the other.
 */
export function buildIntakeTasks(
  itemId: string,
  edits: IntakeEdits,
  /**
   * §5.2 — live label→index maps read off the board, keyed by column id.
   *
   * ⚠️ Required for correctness once the PICKER is live: a label renamed on
   * Monday appears in the dropdown immediately, but the hardcoded map has
   * never heard of it, and `mapped()` SKIPS an unknown label rather than
   * guessing an index. The rep would pick the new label, hit Save, and the
   * column would silently keep its old value. Live map first, hardcoded
   * fallback second.
   */
  liveIndex: Record<string, Record<string, number>> = {},
): WriteTask[] {
  const tasks: WriteTask[] = [];

  const text = (label: string, columnId: string, value: string | undefined) => {
    // `undefined` = untouched. An empty string IS a deliberate clear.
    if (value === undefined) return;
    tasks.push({ label, columnId, fn: () => writeText(itemId, columnId, value) });
  };

  const status = (label: string, columnId: string, field: IntakeStatusField, value: string | undefined) => {
    const idx = statusIndexFor(field, value);
    if (idx === undefined) return;
    tasks.push({ label, columnId, fn: () => writeStatusIndex(itemId, columnId, idx) });
  };

  /** Status write against a map that lives in mondayMapping (shared with the
   *  send-off page), rather than this file's own INTAKE_STATUS_INDEX. */
  const mapped = (label: string, columnId: string, map: Record<string, number>, value?: string) => {
    if (value === undefined) return;
    // Live map wins — it knows labels added or renamed on the board since this
    // code was written. Falls back to the hardcoded one when the settings
    // fetch failed, so the write path degrades exactly like the picker does.
    const idx = liveIndex[columnId]?.[value.trim()] ?? map[value.trim()];
    if (idx === undefined) return;
    tasks.push({ label, columnId, fn: () => writeStatusIndex(itemId, columnId, idx) });
  };

  // Demographics
  // The item NAME is the patient's name — there is no name column.
  if (edits.name !== undefined && edits.name.trim()) {
    const nm = edits.name.trim();
    tasks.push({ label: "Name", columnId: "name", fn: () => writeItemName(itemId, nm) });
  }
  if (edits.ptPhone !== undefined) {
    const ph = edits.ptPhone;
    tasks.push({ label: "Phone", columnId: COL.ptPhone, fn: () => writePhone(itemId, COL.ptPhone, ph) });
  }
  text("DOB", COL.dob, edits.dob);
  text("Email", COL.email, edits.email);
  text("State", COL.formState, edits.formState);
  mapped("Gender", COL.gender, GENDER_INDEX, edits.gender);
  if (edits.patientAddress !== undefined) {
    const addr = edits.patientAddress;
    const lat = edits.patientAddressLat ?? 0;
    const lng = edits.patientAddressLng ?? 0;
    tasks.push({
      label: "Address", columnId: COL.patientAddress,
      fn: () => writeLocation(itemId, COL.patientAddress, addr, lat, lng),
    });
  }

  // Referral routing
  mapped("Referral Source", COL.referralSource, REFERRAL_SOURCE_INDEX, edits.referralSource);
  mapped("Referral Type", COL.referralType, REFERRAL_TYPE_INDEX, edits.referralType);

  // Product decision
  mapped("Request Type", COL.requestType, REQUEST_TYPE_INDEX, edits.requestType);
  mapped("CGM Type", COL.cgmType, CGM_TYPE_INDEX, edits.cgmType);
  mapped("Pump Type", COL.pumpType, PUMP_TYPE_INDEX, edits.pumpType);
  mapped("CGM Coverage Path", COL.cgmCoveragePath, CGM_COVERAGE_PATH_INDEX, edits.cgmCoveragePath);
  mapped("Insulin Pump Coverage Path", COL.insulinPumpCoveragePath,
    INSULIN_PUMP_COVERAGE_PATH_INDEX, edits.insulinPumpCoveragePath);

  // Insurance — General Insurance + Member ID are what the benefits check runs
  // against, so they are the two the rep most often corrects.
  // General Insurance predates this stage — reuse the page's existing index
  // map rather than keeping a second copy that could drift from it.
  if (edits.generalInsurance !== undefined) {
    const gi = GENERAL_INSURANCE_INDEX[edits.generalInsurance.trim()];
    if (gi !== undefined) {
      tasks.push({
        label: "General Insurance",
        columnId: COL.generalInsurance,
        fn: () => writeStatusIndex(itemId, COL.generalInsurance, gi),
      });
    }
  }
  text("Member ID (working)", COL.memberIdWorking, edits.workingMemberId);
  status("Insurance Provided Via", COL.formInsuranceVia, "formInsuranceVia", edits.formInsuranceVia);
  text("Insurance (Other)", COL.formInsuranceOther, edits.formInsuranceOther);
  status("Secondary Insurance (as provided)", COL.formSecondaryProvided, "formSecondaryProvided", edits.formSecondaryProvided);
  text("Secondary Member ID (as provided)", COL.formSecondaryMemberId, edits.formSecondaryMemberId);

  // Product
  status("Reason for Inquiry", COL.formReasonForInquiry, "formReasonForInquiry", edits.formReasonForInquiry);
  status("Pump Need", COL.formPumpNeed, "formPumpNeed", edits.formPumpNeed);
  status("Provided CGM Preference", COL.formCgmPreference, "formCgmPreference", edits.formCgmPreference);
  status("Provided Pump Preference", COL.formPumpPreference, "formPumpPreference", edits.formPumpPreference);

  // Provided doctor info (never the verified columns)
  text("Provided Doctor Name", COL.formProvidedDoctorName, edits.formProvidedDoctorName);
  text("Provided Clinic Phone", COL.formProvidedClinicPhone, edits.formProvidedClinicPhone);
  if (edits.clinicAddress !== undefined) {
    const addr = edits.clinicAddress;
    const lat = edits.clinicAddressLat ?? 0;
    const lng = edits.clinicAddressLng ?? 0;
    tasks.push({
      label: "Clinic Address", columnId: COL.clinicAddress,
      fn: () => writeLocation(itemId, COL.clinicAddress, addr, lat, lng),
    });
  }

  // Call handling
  status("Proceed Preference", COL.formProceedPreference, "formProceedPreference", edits.formProceedPreference);
  text("Call Slot", COL.formCallSlot, edits.formCallSlot);
  status("Booking Status", COL.formBookingStatus, "formBookingStatus", edits.formBookingStatus);
  if (edits.intakeCallComplete) {
    status("Intake Call Complete", COL.intakeCallComplete, "intakeCallComplete", "Yes");
  }
  if (edits.attemptCounter !== undefined) {
    tasks.push({
      label: "Attempt Counter",
      columnId: COL.attemptCounter,
      fn: () => writeNumber(itemId, COL.attemptCounter, String(edits.attemptCounter)),
    });
  }

  // Care assessment / cost
  status("Self Advocacy", COL.selfAdvocacy, "selfAdvocacy", edits.selfAdvocacy);
  text("Current Out-of-Pocket Cost", COL.currentOopCost, edits.currentOopCost);
  status("CGM Data & Doctor Awareness", COL.cgmDataAwareness, "cgmDataAwareness", edits.cgmDataAwareness);

  // Insurance follow-up. The status column has exactly one label ("Follow Up",
  // index 1), so this is a flag rather than a choice — the DATE is the payload.
  if (edits.followUp !== undefined) {
    const on = edits.followUp.trim() !== "";
    if (on) {
      tasks.push({
        label: "Follow Up", columnId: COL.followUp,
        fn: () => writeStatusIndex(itemId, COL.followUp, FOLLOW_UP_INDEX.followUp),
      });
    }
  }
  if (edits.followUpDate !== undefined) {
    const d = edits.followUpDate;
    tasks.push({ label: "Follow Up Date", columnId: COL.followUpDate, fn: () => writeDate(itemId, COL.followUpDate, d) });
  }

  return tasks;
}

/**
 * Append one line to the Call Log — the ONLY way this stage writes notes.
 *
 * The column is append-only and stamped (`[ET timestamp] Patient Intake: … —XX`,
 * CLAUDE.md §9). It used to sit in `IntakeEdits` and be written with a plain
 * `text()` overwrite of whatever the page held, which was inert only because
 * nothing rendered a notes box: the first save from a bound textarea would have
 * replaced the entire history with one line.
 *
 * Reads the current log itself rather than trusting the caller, for the same
 * reason `writeEscalationNote` does — a concurrent edit must not be clobbered.
 */
export async function appendIntakeNote(
  itemId: string, note: string, existingNotes?: string,
): Promise<IntakeWriteResult> {
  const body = note.trim();
  if (!body) {
    return { ok: false, errors: [{ label: "Note", columnId: COL.notes, error: "Nothing to add." }] };
  }
  let prior = existingNotes;
  if (prior === undefined) {
    try {
      const cols = await readColumnTexts(itemId, [COL.notes]);
      prior = cols.find((c) => c.id === COL.notes)?.text ?? "";
    } catch {
      prior = "";
    }
  }
  try {
    // ⚠️ writeText, NOT writeLongText. `notes` is text_mm389fs — a TEXT
    // column, which takes a bare JSON string. writeLongText sends
    // `{"text": …}`, the long_text shape, and Monday rejects it outright with
    // "invalid value, please check our API documentation for the correct data
    // structure for this column". The escalation log next door IS long_text,
    // which is how the two got crossed.
    await writeText(
      itemId, COL.notes,
      appendStampedNote(prior, body, "Patient Intake", { initials: userInitials() }),
    );
    return { ok: true, errors: [] };
  } catch (e) {
    return {
      ok: false,
      errors: [{ label: "Note", columnId: COL.notes, error: e instanceof Error ? e.message : String(e) }],
    };
  }
}

/** Run a task list to completion, collecting per-column failures rather than
 *  throwing on the first one — so one rejected column can't discard the rest of
 *  a save, and the UI can name exactly what didn't land. */
async function runTasks(tasks: WriteTask[]): Promise<IntakeWriteResult> {
  const settled = await Promise.allSettled(tasks.map((t) => t.fn()));
  const errors: IntakeWriteResult["errors"] = [];
  settled.forEach((r, i) => {
    if (r.status === "rejected") {
      errors.push({
        label: tasks[i].label,
        columnId: tasks[i].columnId,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  });
  return { ok: errors.length === 0, errors };
}

/**
 * Persist a rep's edits (the Save button). Every field is written
 * independently so one rejected column can't discard the rest of the save.
 * Returns what failed instead of throwing, so the UI can show "saved, except X"
 * rather than a blanket error.
 */
export function writeIntakeEdits(
  itemId: string,
  edits: IntakeEdits,
  liveIndex: Record<string, Record<string, number>> = {},
): Promise<IntakeWriteResult> {
  return runTasks(buildIntakeTasks(itemId, edits, liveIndex));
}

/** Bump the unified attempt counter. Automated email/text, autodialer and
 *  manual rep calls all roll into this one number (HANDOFF §10). */
export async function logContactAttempt(itemId: string, current: string | number): Promise<number> {
  const n = typeof current === "number" ? current : parseInt(String(current || "0"), 10);
  const next = (Number.isFinite(n) ? n : 0) + 1;
  await writeNumber(itemId, COL.attemptCounter, String(next));
  return next;
}


/** The five verified values on the right pane. These carry forward to Medical
 *  Necessity, so they are written separately from the left pane's raw claim —
 *  General Insurance / Member ID stay what the patient told us. */
export interface VerifiedEdits {
  primaryInsurance?: string;
  memberId1?: string;
  secondaryInsurance?: string;
  memberId2?: string;
  serving?: string;
}

/**
 * Persist the verified insurance decision. Member ID 2 is REQUIRED when
 * Secondary is NY Medicaid (HANDOFF §4) — the write is refused rather than
 * half-applied, because a Medicaid secondary with no ID fails downstream in a
 * way nobody traces back to here.
 */
/**
 * The one thing that refuses a verified-insurance write outright, returned as a
 * blocker rather than thrown so both the Save and the Advance can report it the
 * same way. Advance checks it FIRST — before any column is written — so a
 * refused advance doesn't leave a half-applied save behind it.
 */
export function verifiedInsuranceBlocker(edits: VerifiedEdits): IntakeWriteResult["errors"][number] | null {
  if ((edits.secondaryInsurance ?? "").trim() === "NY Medicaid" && !(edits.memberId2 ?? "").trim()) {
    return {
      label: "Member ID 2",
      columnId: COL.memberId2,
      error: "Required when Secondary Insurance is NY Medicaid.",
    };
  }
  return null;
}

/** The verified-insurance write tasks, built but NOT run — same split, and for
 *  the same reason, as `buildIntakeTasks`. */
export function buildVerifiedInsuranceTasks(itemId: string, edits: VerifiedEdits): WriteTask[] {
  const tasks: WriteTask[] = [];
  const status = (label: string, columnId: string, map: Record<string, number>, value?: string) => {
    if (value === undefined) return;
    const idx = map[value.trim()];
    if (idx === undefined) return;
    tasks.push({ label, columnId, fn: () => writeStatusIndex(itemId, columnId, idx) });
  };

  status("Primary Insurance", COL.primaryInsurance, PRIMARY_INSURANCE_INDEX, edits.primaryInsurance);
  status("Secondary Insurance", COL.secondaryInsurance, SECONDARY_INSURANCE_INDEX, edits.secondaryInsurance);
  status("Serving", COL.serving, SERVING_INDEX, edits.serving);
  if (edits.memberId1 !== undefined) {
    tasks.push({ label: "Member ID 1", columnId: COL.memberId1, fn: () => writeText(itemId, COL.memberId1, edits.memberId1 as string) });
  }
  if (edits.memberId2 !== undefined) {
    tasks.push({ label: "Member ID 2", columnId: COL.memberId2, fn: () => writeText(itemId, COL.memberId2, edits.memberId2 as string) });
  }

  return tasks;
}

/** Persist the verified insurance decision on its own (the right pane's Save). */
export async function writeVerifiedInsurance(
  itemId: string,
  edits: VerifiedEdits,
): Promise<IntakeWriteResult> {
  const blocker = verifiedInsuranceBlocker(edits);
  if (blocker) return { ok: false, errors: [blocker] };
  return runTasks(buildVerifiedInsuranceTasks(itemId, edits));
}

// ── Stage exits ─────────────────────────────────────────────────────────────
// The intake stage mirrors Medical Evaluation's escalation model rather than
// inventing a second one: index 0 raises to Manager Intervention, index 2 is
// the rep's Propose Stuck which promotes to Final Decisions, index 1 clears
// the escalation and puts the patient back in the rep pipeline.

export const INTAKE_ESCALATION_INDEX = {
  /** Escalated to a manager — leaves the rep queue and the burndown count. */
  required: 0,
  /** Resolved. "Send back to pipeline" writes this. */
  done: 1,
  /** The rep's proposal that the patient really is stuck → Final Decisions. */
  finalRequired: 2,
} as const;

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;

async function executeWithRetry(task: WriteTask): Promise<string | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await task.fn();
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[unverifiedWrite] ${task.label} (${task.columnId}) attempt ${attempt + 1}: ${msg}`);
      if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      else return `${task.label}: ${msg}`;
    }
  }
  return null;
}

/**
 * The VERIFIED doctor columns — what Select Correct Provider (step 3) chose.
 *
 * These are the eight the Advance-to-MN automation copies to Medical
 * Evaluation, and nothing on this page used to write them: DoctorSection
 * reports its pick through onUpdate, the page put it in an in-memory overlay,
 * and the overlay was never persisted. The rep's provider work was discarded
 * on every advance and the patient reached Send Request with no fax or email
 * to send to, and a blank Clinicals Method (which §5.9 reads as a fax chase).
 *
 * Mirrors mondayWrite.buildDataTasks' doctor block exactly — same columns,
 * same per-type helpers — so the two stages write a doctor identically.
 * Each is guarded on a value: a blank field means "not picked", never "clear
 * what's on the board".
 */
function buildDoctorTasks(p: Patient, clinicLabelId: number | null): WriteTask[] {
  const tasks: WriteTask[] = [];
  if (p.doctorName) tasks.push({ label: "Doctor Name", columnId: COL.doctorName, fn: () => writeText(p.id, COL.doctorName, p.doctorName) });
  if (p.doctorPhone) tasks.push({ label: "Doctor Phone", columnId: COL.doctorPhone, fn: () => writePhone(p.id, COL.doctorPhone, p.doctorPhone) });
  if (p.doctorNpi) tasks.push({ label: "Doctor NPI", columnId: COL.doctorNpi, fn: () => writeText(p.id, COL.doctorNpi, p.doctorNpi) });
  if (p.doctorEmail) tasks.push({ label: "Doctor Email", columnId: COL.doctorEmail, fn: () => writeEmail(p.id, COL.doctorEmail, p.doctorEmail) });
  if (p.doctorFax) tasks.push({ label: "Doctor Fax", columnId: COL.doctorFax, fn: () => writeEmail(p.id, COL.doctorFax, p.doctorFax) });
  const cm = CLINICALS_METHOD_INDEX[(p.clinicalsMethod ?? "").trim()];
  if (cm !== undefined) {
    tasks.push({ label: "Clinicals Method", columnId: COL.clinicalsMethod, fn: () => writeStatusIndex(p.id, COL.clinicalsMethod, cm) });
  }
  if (clinicLabelId !== null) {
    tasks.push({ label: "Clinic Name", columnId: COL.clinicName, fn: () => writeDropdownIds(p.id, COL.clinicName, [clinicLabelId]) });
  } else if (p.clinicName?.trim()) {
    // A clinic the Doctor DB knows but this board's dropdown doesn't yet —
    // create_labels_if_missing, the same path /profile uses for a new clinic.
    const cn = p.clinicName.trim();
    tasks.push({ label: "Clinic Name", columnId: COL.clinicName, fn: () => writeDropdownLabels(p.id, COL.clinicName, [cn]) });
  }
  if (p.clinicAddress) {
    tasks.push({
      label: "Clinic Address", columnId: COL.clinicAddress,
      fn: () => writeLocation(p.id, COL.clinicAddress, p.clinicAddress, p.clinicAddressLat ?? 0, p.clinicAddressLng ?? 0),
    });
  }
  return tasks;
}

/**
 * Advance to Medical Necessity — the stage's exit (mockup step 4).
 *
 * Built like Verified Referrals' send-off (`mondayWrite.sendPatientToMonday`),
 * because the hazard is identical: Move to Onboarding is a STAGE ADVANCER, and
 * board automation 7917676280 fires on it and copies 52 columns to Medical
 * Evaluation. Monday returns 200 on a column write before the value is
 * indexed, so an advancer flipped in the same breath as its sibling data can
 * hand the automation stale — or blank — values.
 *
 * So: every data column is written and READ BACK first, and Move to Onboarding
 * is written only once they have all landed. If verification times out this
 * throws and does NOT advance, which surfaces the problem instead of shipping
 * a half-built patient downstream.
 */
export interface AdvanceInput {
  /** The left pane's edits — written inside the verified transaction, not before it. */
  edits: IntakeEdits;
  /** Live label→index maps (§5.2). Same reason as buildIntakeTasks. */
  liveIndex?: Record<string, Record<string, number>>;
  /** The right pane's verified insurance — likewise. */
  verified: VerifiedEdits;
  clinicLabelId?: number | null;
}

/**
 * Every data column an advance writes, in one list — the left pane, the
 * verified insurance and the doctor.
 *
 * These used to be three separate passes: two un-verified ones fired by the
 * page, then a verified one covering the doctor columns alone. So of the 52
 * columns automation 7917676280 copies on the advancer, only the doctor block
 * was guaranteed indexed when it read them (CLAUDE.md §5.2 / §9).
 *
 * Split out from `advanceToMedicalNecessity` so the composition is testable
 * without a Monday token: the property that matters is that all three families
 * are in the SAME list, because that list is what gets read back before the
 * advancer is allowed to fire. The advancer itself is deliberately NOT here —
 * `executeWritesWithVerification` must receive it separately to hold it back.
 */
export function buildAdvanceTasks(p: Patient, opts: AdvanceInput): WriteTask[] {
  const all = [
    ...buildIntakeTasks(p.id, opts.edits, opts.liveIndex ?? {}),
    ...buildVerifiedInsuranceTasks(p.id, opts.verified),
    ...buildDoctorTasks(p, opts.clinicLabelId ?? null),
  ];

  // One task per column, LAST wins.
  //
  // Clinic Address is emitted by two builders — the left pane's Provided Doctor
  // Info writes `location_mm1xjnfv` (Josh: no separate provided-address column,
  // write the verified one), and buildDoctorTasks writes it again from the
  // provider picked in step 3. Without this, both would fire concurrently at
  // the same column inside one transaction: a race whose winner decides the
  // patient's clinic address, and a column verified against whichever landed.
  // Last wins because the doctor block is appended last, and a provider the rep
  // actually picked outranks what the patient told us.
  const byColumn = new Map<string, WriteTask>();
  for (const t of all) byColumn.set(t.columnId, t);
  return [...byColumn.values()];
}

export async function advanceToMedicalNecessity(
  p: Patient,
  opts: AdvanceInput,
): Promise<IntakeWriteResult> {
  // Refuse BEFORE writing anything. This used to run inside
  // writeVerifiedInsurance, which the page called after a full left-pane save —
  // so a blocked advance still left ~30 columns written behind it.
  const blocker = verifiedInsuranceBlocker(opts.verified);
  if (blocker) return { ok: false, errors: [blocker] };

  const tasks: WriteTask[] = buildAdvanceTasks(p, opts);

  // With no data columns, verifiedWrite skips its snapshot and read-back phases
  // entirely (`if (verifyColIds.length > 0)`) and the advancer fires unverified
  // — the one shape that silently defeats the whole protocol. Refuse instead:
  // an advance with nothing to carry forward is a bug in the caller, not a
  // patient who is ready.
  if (tasks.length === 0) {
    return {
      ok: false,
      errors: [{
        label: "Advance to MN",
        columnId: COL.moveToOnboarding,
        error: "Nothing to write — refusing to advance without verifying any data first.",
      }],
    };
  }

  // The advancer goes in LAST — executeWritesWithVerification holds it back
  // until every task above it verifies.
  tasks.push({
    label: "Move to Onboarding",
    columnId: COL.moveToOnboarding,
    fn: () => writeStatusIndex(p.id, COL.moveToOnboarding, MOVE_TO_ONBOARDING_INDEX["Advance to MN"]),
  });

  try {
    const failures = await executeWritesWithVerification({
      itemId: p.id,
      tasks,
      stageColumnId: COL.moveToOnboarding,
      executeWithRetry,
      readColumns: readColumnTexts,
    });
    if (failures.length > 0) {
      return {
        ok: false,
        errors: failures.map((f) => ({ label: f.split(":")[0], columnId: "", error: f })),
      };
    }
    return { ok: true, errors: [] };
  } catch (e) {
    return {
      ok: false,
      errors: [{
        label: "Advance to MN", columnId: COL.moveToOnboarding,
        error: e instanceof Error ? e.message : String(e),
      }],
    };
  }
}

/**
 * Record ONE stage decision, in the Call Log.
 *
 * Josh, 2026-08-11: there is no separate escalation-notes column any more.
 * Every decision lands in the ONE notes column with its rung named in the
 * line, the same way Medical Evaluation and Insurance stamp theirs.
 *
 * Two logs was the earlier design and it cost more than it gave: a manager had
 * to know which column to open, the two could disagree once either write
 * failed on its own, and the escalation copy did not travel to Medical
 * Necessity — the Call Log does, because `text_mm389fs` is copied into
 * masheke's `text_mm3xdze1` by the hop automation.
 *
 * No snapshot is passed in on purpose. appendIntakeNote re-reads the log
 * itself, which is what stops a line written between two saves being clobbered
 * — and the old signature took the ESCALATION log, so a caller that kept
 * passing it after this change would have handed the wrong column's text to
 * the Call Log writer.
 */
async function logDecision(
  itemId: string,
  line: string,
  errors: IntakeWriteResult["errors"],
): Promise<void> {
  const note = await appendIntakeNote(itemId, line);
  if (!note.ok) errors.push(...note.errors);
}

async function setEscalation(
  itemId: string, index: number, note: string,
): Promise<IntakeWriteResult> {
  const errors: IntakeWriteResult["errors"] = [];
  await logDecision(itemId, note, errors);
  try {
    await writeStatusIndex(itemId, COL.intakeEscalation, index);
  } catch (e) {
    errors.push({
      label: "Intake Escalation", columnId: COL.intakeEscalation,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return { ok: errors.length === 0, errors };
}

/** Rep → Manager Intervention. */
export function escalateIntake(itemId: string, reason: string) {
  return setEscalation(itemId, INTAKE_ESCALATION_INDEX.required, `Escalated: ${reason}`);
}

/**
 * Propose Stuck, one rung UP from wherever the patient already sits — the same
 * ladder Medical Evaluation and Submit Auth use (`stageActions.proposeStuckLevel`):
 * a rep's proposal lands in Manager Intervention, and a manager proposing from
 * there — or a proposal on an already-escalated patient — promotes to Final
 * Decisions.
 *
 * It used to write Final unconditionally, which skipped Manager Intervention
 * entirely: a rep could put a patient one click from leaving the pipeline with
 * no manager ever reviewing the proposal.
 */
export type ProposeStuckOrigin = "processor" | "manager-intervention" | "final-decisions";

/** Which rung the proposal was made FROM, for the note stamp. A processor's
 *  proposal gets no label — it's the ordinary case and naming it adds noise.
 *  The two manager columns are the ones worth recording, because a proposal
 *  made from them is a second opinion on someone else's. */
const PROPOSE_ORIGIN_LABEL: Record<ProposeStuckOrigin, string> = {
  processor: "",
  "manager-intervention": " — Manager Escalation",
  "final-decisions": " — Final Escalation",
};

/** The exact line written to both logs. Exported so the wording is testable
 *  without a Monday token — it's the thing a manager actually reads. */
export function proposeStuckNoteLine(reason: string, origin: ProposeStuckOrigin): string {
  return `Proposed stuck${PROPOSE_ORIGIN_LABEL[origin]}: ${reason}`;
}

export async function proposeIntakeStuck(
  itemId: string,
  reason: string,
  level: "manager" | "final" = "manager",
  origin: ProposeStuckOrigin = "processor",
): Promise<IntakeWriteResult> {
  const index = level === "final"
    ? INTAKE_ESCALATION_INDEX.finalRequired
    : INTAKE_ESCALATION_INDEX.required;
  return setEscalation(itemId, index, proposeStuckNoteLine(reason, origin));
}

/** Manager sends the patient back into the rep pipeline. */
export function returnIntakeToPipeline(itemId: string, note: string) {
  return setEscalation(itemId, INTAKE_ESCALATION_INDEX.done, `Returned to pipeline: ${note}`);
}

/**
 * Manager approves the rep's proposal — the patient really is Stuck, and leaves
 * the pipeline. Mirrors `oversightApi.approveProposedStuck`: stamped note, then
 * the exit, then clear the escalation.
 *
 * This used to write escalation index 2 — the index the patient ALREADY carried,
 * since index 2 is what put them in Final Decisions in the first place. So it
 * was a no-op that appended a note, toasted "marked Stuck" and navigated the
 * manager away, while the patient stayed in Final Decisions permanently. The
 * stage had no working terminal exit.
 *
 * The exit is a GROUP MOVE, not a status flip: unlike Medical Evaluation and
 * Insurance, this board's advancer (Move to Onboarding) has no "Stuck" option —
 * its labels are Already Serving / Advance to MN / Send Back To Referral /
 * Need More Info. The Stuck group is the board's own idiom for it, the same
 * `moveItemToGroup` the send-off's "Send back to Patient Intake" uses.
 */
export async function approveIntakeStuck(
  itemId: string, note: string,
): Promise<IntakeWriteResult> {
  const errors: IntakeWriteResult["errors"] = [];
  await logDecision(
    itemId,
    `Stuck approved${note.trim() ? `: ${note.trim()}` : ""}`,
    errors,
  );

  try {
    await moveItemToGroup(itemId, GROUPS.stuck);
  } catch (e) {
    errors.push({
      label: "Move to Stuck", columnId: GROUPS.stuck,
      error: e instanceof Error ? e.message : String(e),
    });
    // Bail WITHOUT clearing the escalation. Clearing it here would drop a
    // patient who never actually left back into the rep's queue while the
    // manager has been told they're stuck; leaving it means the row stays in
    // Final Decisions and the manager can simply retry.
    return { ok: false, errors };
  }

  // Clear the escalation LAST — it is what removes the row from Final
  // Decisions, so it must not happen unless the patient really has moved.
  try {
    await writeStatusIndex(itemId, COL.intakeEscalation, INTAKE_ESCALATION_INDEX.done);
  } catch (e) {
    errors.push({
      label: "Intake Escalation", columnId: COL.intakeEscalation,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return { ok: errors.length === 0, errors };
}
