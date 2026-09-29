/**
 * Provider (doctor) edits on the Medical Evaluation board — which fields, and
 * which values Monday would silently drop.
 *
 * The header card's Edit grid (`SendRequestHeaderCard`, on Send Request,
 * Confirm Receipt, Chase Clinicals and Doctor Appointments) used to write
 * nothing of its own: edits sat in the page's local overlay until the stage's
 * advance wrote them, and Doctor Appointments' advance never did. So a rep who
 * got a new provider or a corrected fax had no way to put it on the board
 * without moving the patient, and a script regenerated in the meantime still
 * carried the old provider, because DocExport reads the BOARD (2026-09-29).
 * The card's Save provider button now writes the fields the rep touched, and
 * this is the rule it checks first.
 */
import { planEmailWrite } from "@/lib/shared/emailCell";
import { planPhoneWrite } from "@/lib/shared/phoneCell";
import { faxEditToColumnValue, isFaxAddress, toFaxAddress } from "@/lib/shared/faxAddress";

/** The six fields the Edit grid shows, in write order. Clinic is LAST: its
 *  writer is the one that can refuse (a label the board doesn't have), and a
 *  refusal there must not stop the fax or phone from landing. */
export const DOCTOR_EDIT_FIELDS = [
  "doctorName",
  "doctorNpi",
  "doctorPhone",
  "doctorFax",
  "doctorEmail",
  "clinicName",
] as const;

export type DoctorEditField = (typeof DOCTOR_EDIT_FIELDS)[number];

/** Fields the rep changed and hasn't saved yet. */
export type DoctorDraft = Partial<Record<DoctorEditField, string>>;

export const DOCTOR_FIELD_LABEL: Record<DoctorEditField, string> = {
  doctorName: "Doctor Name",
  doctorNpi: "Doctor NPI",
  doctorPhone: "Doctor Phone",
  doctorFax: "Doctor Fax",
  doctorEmail: "Doctor Email",
  clinicName: "Clinic Name",
};

export function isDoctorEditField(key: string): key is DoctorEditField {
  return (DOCTOR_EDIT_FIELDS as readonly string[]).includes(key);
}

/**
 * Which staged fields can't be saved as typed, by label. Checked BEFORE the
 * first write, so a bad field can't leave a half-saved record.
 *
 * ⚠️ `writePhone` and `writeEmail` SKIP a value they can't parse; they don't
 * throw. Without this check a 9-digit phone "saves" green having written
 * nothing — the DVS page's `unwritableDoctorFields` lesson.
 * ⚠️ The fax is held to the deliverable shape (`isFaxAddress`), not merely to
 * "an address": a truncated number would save as `215555010@rcfax.com`, and a
 * fax to it goes nowhere with nothing saying so. A blank is a deliberate clear
 * and passes.
 */
export function unsavableDoctorFields(draft: DoctorDraft): string[] {
  const bad: string[] = [];
  if (draft.doctorPhone !== undefined && planPhoneWrite(draft.doctorPhone).action === "skip") {
    bad.push("Doctor Phone (needs 10 digits)");
  }
  if (draft.doctorFax !== undefined) {
    const fax = faxEditToColumnValue(draft.doctorFax);
    if (fax && !isFaxAddress(fax)) bad.push("Doctor Fax (needs a 10-digit fax number)");
  }
  if (draft.doctorEmail !== undefined && planEmailWrite(draft.doctorEmail).action === "skip") {
    bad.push("Doctor Email (not a valid address)");
  }
  return bad;
}

/**
 * Send Request's To box after the doctor's fax/email changed from `prev` to
 * `next` in the header card's Edit grid.
 *
 * ⚠️ The box used to be seeded ONCE, at mount, so a corrected fax never
 * reached it and the re-send went back to the old number (2026-09-29: the
 * board's fax was the office's PHONE line). The prefilled entry
 * is replaced IN PLACE; an address the rep added by hand is never touched.
 * Returns `null` when the prefilled entry is no longer in the box — the rep
 * removed it, so the box is theirs and stops following.
 *
 * Compared as fax addresses, so "(215) 555-0100" and "2155550100@rcfax.com"
 * are one recipient rather than two faxes to the same office.
 */
export function followDoctorContact(recipients: string[], prev: string, next: string): string[] | null {
  if (prev === next) return recipients;
  if (prev && !recipients.includes(prev)) return null;
  const same = (a: string, b: string) => toFaxAddress(a).toLowerCase() === toFaxAddress(b).toLowerCase();
  const rest = recipients.filter((r) => r !== prev);
  if (!next || rest.some((r) => same(r, next))) return rest;
  if (prev) return recipients.map((r) => (r === prev ? next : r));
  return [next, ...rest];
}
