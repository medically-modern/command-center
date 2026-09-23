/**
 * The patient screen's top-bar contact fields — the email, and what the two
 * pencils write (§5.46g).
 *
 * Josh, 2026-09-22: *"keep going, add email and the edit pencils to the top
 * bar"*. Brandon's card is *Patient name · DOB · **Email** · Phone with the
 * edit pencil*; live rendered name · DOB · phone, read-only, and the email was
 * not on the screen at all.
 *
 * ⚠️ **The write is the Comms Hub's `dossierApi.updatePatientContact`, not a
 * writer of this slice's own.** Two INDEPENDENT writers for one column is what
 * §5.31c and §5.31d record going wrong — and §5.31d is the sharper precedent,
 * because the Welcome Call banner's phone editor was DELETED for exactly that.
 * This module is the RULE (which column, which shape, and what else has to
 * move with it); the mutation lives in one place beside `appendNoteToRecord`,
 * which is the shape `patientScreen.test.ts`' no-writer scan blesses.
 */
import type { DossierItem, PatientDossier } from "@/lib/commsHub/dossier";
import { PIPELINE_ORDER } from "@/lib/commsHub/pipelineOrder";
import { BOARDS } from "@/lib/systemMgmt/mondayApi";
import { CONTACT_COL } from "@/lib/patient/contacts";
import { anchorItem } from "@/lib/patient/infoStrip";
import { phoneDigits, phoneRejectionReason } from "@/lib/shared/phoneCell";
import { isEmailAddress, readEmailCell } from "@/lib/shared/emailCell";

const DTC_INTAKE = 18392794310;
const PROFILE_SEND_OFF = 18406352652;
const MEDICAL_EVALUATION = 18406060017;
const INSURANCE = 18410601299;
const WELCOME_CALL = 18410804557;
const SUBSCRIPTION = 18407459988;

export type EmailColType = "text" | "email";

/**
 * The patient's own email address, per board — read live 2026-09-22.
 *
 * ⚠️ **TWO SHAPES, and Monday refuses the wrong one at HTTP 200.** The four
 * pipeline boards carry `text_mm1xc140`, a PLAIN TEXT column that takes a bare
 * string; Subscription and DTC Intake carry `email_*` columns, which take
 * `{email, text}`. Writing a bare string to an email column — or an object to a
 * text column — comes back 200 with a GraphQL `errors[]` and nothing written
 * (§5.28 · §10's most common silent failure), which here reads as "the address
 * didn't save" with nothing erroring. The type is declared so the writer cannot
 * guess it from the id prefix.
 *
 * ⚠️ **Secondary Claims is deliberately ABSENT.** Its only address column is
 * `email_mm425p3n` "Patient Stripe Email" — where a payment receipt goes, not
 * how we reach the patient — and rendering it under "Email" would be a
 * plausible wrong answer rather than a blank (§5.28's rule for a column whose
 * meaning is not verified).
 */
export const EMAIL_COL: Record<number, { id: string; type: EmailColType }> = {
  [DTC_INTAKE]: { id: "email_mkwrdzzw", type: "email" },
  [PROFILE_SEND_OFF]: { id: "text_mm1xc140", type: "text" },
  [MEDICAL_EVALUATION]: { id: "text_mm1xc140", type: "text" },
  [INSURANCE]: { id: "text_mm1xc140", type: "text" },
  [WELCOME_CALL]: { id: "text_mm1xc140", type: "text" },
  [SUBSCRIPTION]: { id: "email_mkp01rrw", type: "email" },
};

/** What `dossierApi.dossierCols` must fetch for this board. */
export function emailColumns(boardId: number): string[] {
  const c = EMAIL_COL[boardId];
  return c ? [c.id] : [];
}

const rank = (boardId: number) => PIPELINE_ORDER.findIndex((b) => b.boardId === boardId);

/** One record's address, however that board stores it. */
export function emailOf(item: DossierItem): string {
  const c = EMAIL_COL[item.boardId];
  if (!c) return "";
  // ⚠️ `readEmailCell` rather than the raw text: an email column renders a
  // drifted label as "Dr. Smith - a@b.com", and handing THAT to a mailto link
  // — or back to Monday as an address — is the 2026-08-03 Benefits incident.
  return readEmailCell({ text: item.cols?.[c.id] ?? "" });
}

/**
 * The patient's email, read ACROSS their records, furthest-along board first.
 *
 * ⚠️ Same rule as the info strip (§5.46f) and for the same reason: reading the
 * active record alone shows an em dash for anyone whose live record is on a
 * board that does not carry the column, and a later board's value is the
 * corrected one.
 */
export function patientEmail(dossier: PatientDossier | null): string {
  const items = [...(dossier?.items ?? [])].sort((a, b) => rank(b.boardId) - rank(a.boardId));
  for (const it of items) {
    const v = emailOf(it).trim();
    if (v) return v;
  }
  return "";
}

export interface ContactTarget {
  item: DossierItem;
  /** Always present — every board in the registry declares one. */
  phoneColId: string;
  emailColId: string | null;
  emailType: EmailColType | null;
  /** Cleared when the primary number's digits change — see `contactWrites`. */
  canTextColId: string | null;
  /** Why nothing here may be written, or "" when it may. */
  refusal: string;
}

/**
 * Which record a pencil writes to.
 *
 * ⚠️ **The ANCHOR** — the live record, falling back for a stuck patient
 * (`anchorItem`, §5.46f). A screen that spans six boards has to name one, and
 * the live record is the one every other writer in the app would have used.
 *
 * ⚠️ **A COMPLETED record is refused.** `anchorItem` only reaches one when every
 * record is finished, and §5.38's rule is that a completed item is read-only in
 * new code: its columns ARE the snapshot the stepper renders, so editing one
 * rewrites history rather than correcting a record anybody is working.
 */
export function contactTarget(dossier: PatientDossier | null): ContactTarget | null {
  const item = anchorItem(dossier);
  if (!item) return null;
  const board = BOARDS.find((b) => b.boardId === item.boardId);
  if (!board) return null;
  const email = EMAIL_COL[item.boardId] ?? null;
  return {
    item,
    phoneColId: board.phoneColId,
    emailColId: email?.id ?? null,
    emailType: email?.type ?? null,
    canTextColId: CONTACT_COL[item.boardId]?.canText ?? null,
    refusal: item.isCompleted
      ? `This patient's only records are completed, and a completed ${board.boardName} record is the snapshot of how that stage was left — it isn't edited from here.`
      : "",
  };
}

/** Why a typed phone number cannot be saved, or "" when it can. */
export function phoneRefusal(raw: string): string {
  return phoneRejectionReason(raw) ?? "";
}

/**
 * Why a typed address cannot be saved, or "" when it can.
 *
 * ⚠️ Checked BEFORE the write, never after — §5.31h's rule, and sharper here
 * than for a phone: the Calendly chip (§5.31e), the booking mirror (§5.15) and
 * the Gmail thread all join on this EXACT string, so a typo does not fail, it
 * reads as "not booked" and "no previous emails" for ever.
 */
export function emailRefusal(raw: string): string {
  const v = (raw ?? "").trim();
  if (!v) return ""; // a blank is a deliberate clear
  // ⚠️ `isEmailAddress` is the shared shape test, deliberately permissive
  // because it must keep accepting `<digits>@rcfax.com` (§5.5). Never a second
  // regex here.
  return isEmailAddress(v) ? "" : `"${v}" doesn't look like an email address.`;
}

export type ContactField = "phone" | "email";

/**
 * The column values one pencil writes.
 *
 * ⚠️⚠️ **CHANGING THE PRIMARY NUMBER CLEARS CAN TEXT, on every board that has
 * the column.** That is §5.31d's rule (`setSlotNumber`), not an extra: Can Text
 * is the STARRED slot's answer, i.e. this very number's, so a Yes about the old
 * line would otherwise ride onto a new one and the Day-20 reorder text would go
 * somewhere nobody can receive it. It is also what stops this pencil being the
 * second, worse copy of the editor §5.31d deleted from the Welcome Call banner.
 *
 * ⚠️ Compared on DIGITS, so reformatting `(555) 555-0100` is not a change and
 * does not cost the rep an answer they already gave.
 *
 * ⚠️ A blank is a deliberate CLEAR (`{}`), which is how every other writer in
 * this app empties a column — never `null`, which Monday reads as an
 * unreadable value (§5.31c).
 */
export function contactWrites(
  target: ContactTarget,
  field: ContactField,
  value: string,
): Record<string, unknown> {
  const v = (value ?? "").trim();

  if (field === "email") {
    if (!target.emailColId) return {};
    if (!v) return { [target.emailColId]: {} };
    return {
      [target.emailColId]: target.emailType === "email" ? { email: v, text: v } : v,
    };
  }

  const out: Record<string, unknown> = {};
  const digits = phoneDigits(v);
  out[target.phoneColId] = v ? { phone: digits, countryShortName: "US" } : {};

  const changed = phoneDigits(target.item.phone) !== digits;
  if (changed && target.canTextColId) out[target.canTextColId] = {};
  return out;
}

/**
 * The patient's Alternate Phone column on this record's board, or null.
 *
 * It exists on Welcome Call and Subscription only (§5.31d). On every other
 * board the Communications inbox offers "Link to <name>" instead of "Add as
 * alternate phone" — the history moves to the patient in the inbox and nothing
 * is written to Monday (COMMS_INBOX_PLAN.md §6, §9.3).
 */
export function alternatePhoneColId(target: ContactTarget | null): string | null {
  if (!target) return null;
  return CONTACT_COL[target.item.boardId]?.alternatePhone ?? null;
}

/** What the record holds in Alternate Phone now — shown on the button as
 *  "(replaces …)", so the rep sees what goes. "" when blank or no column. */
export function currentAlternatePhone(target: ContactTarget | null): string {
  const col = alternatePhoneColId(target);
  if (!col || !target) return "";
  return String(target.item.cols?.[col] ?? "").trim();
}

/**
 * The column value "Add as alternate phone" writes — the Alternate Phone
 * column and NOTHING else (COMMS_INBOX_PLAN.md §6, Josh's D1: *"fine"*).
 *
 * ⚠️ It REPLACES whatever alternate is there, as the mockup draws it; the
 * button names the number it replaces.
 *
 * ⚠️⚠️ Never Caregiver Name, Caregiver Authorized or Alternate Contact. Those
 * are consent records and the slot's Patient/Caregiver answer, and they stay
 * the Welcome Call page's — `phoneSlots.setSlotNumber` keeps the slot's answer
 * when its number changes, and so does this. The alternate slot has no Can
 * Text of its own, so nothing else needs clearing.
 *
 * ⚠️ The caller runs `phoneRefusal` FIRST: `planPhoneWrite` skips a number it
 * cannot parse, so an unchecked save would report success having written
 * nothing (§5.32d).
 *
 * Returns `{}` when the board has no Alternate Phone column, which
 * `updatePatientContact` refuses loudly rather than sending an empty write.
 */
export function alternatePhoneWrites(target: ContactTarget, value: string): Record<string, unknown> {
  const col = alternatePhoneColId(target);
  if (!col) return {};
  const digits = phoneDigits((value ?? "").trim());
  return { [col]: digits ? { phone: digits, countryShortName: "US" } : {} };
}
