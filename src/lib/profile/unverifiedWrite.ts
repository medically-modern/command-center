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

import { COL, writeStatusIndex, writeText, writeNumber } from "./mondayApi";
import {
  GENERAL_INSURANCE_INDEX, PRIMARY_INSURANCE_INDEX,
  SECONDARY_INSURANCE_INDEX, SERVING_INDEX,
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
  // Demographics the rep can correct
  dob?: string;
  email?: string;
  formState?: string;

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

  // Call handling
  formProceedPreference?: string;
  formCallSlot?: string;
  formBookingStatus?: string;
  intakeCallComplete?: boolean;
  attemptCounter?: number;

  // Care assessment / cost — rep-entered on the call
  selfAdvocacy?: string;
  currentOopCost?: string;
  cgmDataAwareness?: string;

  notes?: string;
}

/**
 * Persist a rep's edits. Every field is written independently so one rejected
 * column can't discard the rest of the save — the same reason the intake
 * backend falls back to per-column writes. Returns what failed instead of
 * throwing, so the UI can show "saved, except X" rather than a blanket error.
 */
export async function writeIntakeEdits(itemId: string, edits: IntakeEdits): Promise<IntakeWriteResult> {
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

  // Demographics
  text("DOB", COL.dob, edits.dob);
  text("Email", COL.email, edits.email);
  text("State", COL.formState, edits.formState);

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
      fn: () => writeNumber(itemId, COL.attemptCounter, edits.attemptCounter as number),
    });
  }

  // Care assessment / cost
  status("Self Advocacy", COL.selfAdvocacy, "selfAdvocacy", edits.selfAdvocacy);
  text("Current Out-of-Pocket Cost", COL.currentOopCost, edits.currentOopCost);
  status("CGM Data & Doctor Awareness", COL.cgmDataAwareness, "cgmDataAwareness", edits.cgmDataAwareness);

  text("Notes", COL.notes, edits.notes);

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

/** Bump the unified attempt counter. Automated email/text, autodialer and
 *  manual rep calls all roll into this one number (HANDOFF §10). */
export async function logContactAttempt(itemId: string, current: string | number): Promise<number> {
  const n = typeof current === "number" ? current : parseInt(String(current || "0"), 10);
  const next = (Number.isFinite(n) ? n : 0) + 1;
  await writeNumber(itemId, COL.attemptCounter, next);
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
export async function writeVerifiedInsurance(
  itemId: string,
  edits: VerifiedEdits,
): Promise<IntakeWriteResult> {
  if ((edits.secondaryInsurance ?? "").trim() === "NY Medicaid" && !(edits.memberId2 ?? "").trim()) {
    return {
      ok: false,
      errors: [{
        label: "Member ID 2",
        columnId: COL.memberId2,
        error: "Required when Secondary Insurance is NY Medicaid.",
      }],
    };
  }

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
