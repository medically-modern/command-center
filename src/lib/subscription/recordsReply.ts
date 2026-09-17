/**
 * "The office replied, but sent no new records."
 *
 * The normal end of a records chase is a fax full of progress notes: Masheke
 * uploads them, enters the visit date, MN Expiry moves six months out and the
 * patient is current again. This module is the OTHER ending, which until now
 * had nowhere to go (Brandon, 2026-09-16). The office faxes back to say the
 * patient has not been seen since 2025, or has moved to another practice, and
 * Masheke has read a real answer that the system has no way to record — so
 * nothing happens next, and the same office gets chased again.
 *
 * Three replies, one line each into MR Request Log:
 *
 *   Same old records  — nothing new exists yet; optionally, when the patient is next in
 *   New provider      — they have moved practice; optionally, who to
 *   Other             — anything else, in her words
 *
 * The line lands in the SAME column `email-serivce` writes its sends to, so
 * the column reads as one conversation:
 *
 *   [Sep 14, 2026, 12:01 PM] Sent to 5555550100@RCFAX.COM (fax) · MR Expired request · 2 files attached
 *   [Sep 16, 2026, 2:33 PM] Update Clinicals: Same old records — next appt 10/13/2026 —ME
 *
 * ⚠️ An appointment date is offered on "Same old records" ONLY, and that is a
 * safety rule rather than a shortcut. The date is not a note: a board
 * automation flips MR Rechase the day after it and the service faxes the
 * office again. The item's Doctor Fax is the OLD practice, so arming that from
 * a "New provider" reply would send the follow-up to the very office that just
 * told us the patient had left. Whoever wires the new provider's details into
 * the doctor columns should revisit this — until then, the two must not meet.
 */

/** Which of the three answers the office gave. */
export type RecordsReplyChoice = "same-records" | "new-provider" | "other";

export interface RecordsReplyOption {
  id: RecordsReplyChoice;
  /** What the picker shows. */
  label: string;
  /** One line under it, so the choice is not guessed from two words. */
  hint: string;
  /** Does this answer take a Next Doc Appt Date? See the warning above. */
  takesAppointment: boolean;
  /** The free-text field this answer offers, if any. */
  detail?: { label: string; placeholder: string; required: boolean };
}

export const RECORDS_REPLY_OPTIONS: readonly RecordsReplyOption[] = [
  {
    id: "same-records",
    label: "Same old records",
    hint: "The office sent what they already had — nothing newer exists yet.",
    takesAppointment: true,
  },
  {
    id: "new-provider",
    label: "New provider",
    hint: "The patient has moved to another practice.",
    takesAppointment: false,
    detail: {
      label: "New provider details",
      placeholder: "Name, practice, phone or fax — whatever the office gave you",
      required: false,
    },
  },
  {
    id: "other",
    label: "Other",
    hint: "Anything else worth recording about the reply.",
    takesAppointment: false,
    detail: {
      label: "What they said",
      placeholder: "e.g. patient has not been seen since 2025 and will not return calls",
      required: true,
    },
  },
] as const;

export function recordsReplyOption(choice: RecordsReplyChoice | null): RecordsReplyOption | null {
  return RECORDS_REPLY_OPTIONS.find((o) => o.id === choice) ?? null;
}

export interface RecordsReplyDraft {
  choice: RecordsReplyChoice | null;
  /** yyyy-mm-dd as an <input type="date"> gives it, or "". */
  apptDate: string;
  /** The free-text detail for whichever option offers one. */
  detail: string;
}

export const EMPTY_RECORDS_REPLY: RecordsReplyDraft = { choice: null, apptDate: "", detail: "" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-10-13" → "10/13/2026". Mirrors workflow.formatDateMDY, for the note body. */
function mdy(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

/**
 * Only the fields the chosen answer actually offers survive. A rep who types a
 * provider name, changes their mind and picks "Same old records" must not have
 * that stray text written to the board under the wrong heading — and the
 * appointment date least of all, since writing it arms a fax.
 */
export function prunedRecordsReply(draft: RecordsReplyDraft): RecordsReplyDraft {
  const option = recordsReplyOption(draft.choice);
  if (!option) return { ...EMPTY_RECORDS_REPLY };
  return {
    choice: draft.choice,
    apptDate: option.takesAppointment ? draft.apptDate.trim() : "",
    detail: option.detail ? draft.detail.trim() : "",
  };
}

/**
 * Why this reply cannot be saved yet, in words a rep can act on. Empty means
 * it is good to go, and the Save control reads exactly this list — a disabled
 * button with no stated reason is a dead end.
 */
export function recordsReplyProblems(draft: RecordsReplyDraft): string[] {
  const option = recordsReplyOption(draft.choice);
  if (!option) return ["Pick what the office came back with."];

  const pruned = prunedRecordsReply(draft);
  const problems: string[] = [];
  if (option.detail?.required && !pruned.detail) {
    problems.push(`Add ${option.detail.label.toLowerCase()} — "${option.label}" on its own records nothing.`);
  }
  if (pruned.apptDate && !ISO_DATE.test(pruned.apptDate)) {
    problems.push("That appointment date is not a date.");
  }
  return problems;
}

export function canSaveRecordsReply(draft: RecordsReplyDraft): boolean {
  return recordsReplyProblems(draft).length === 0;
}

/**
 * True when the appointment entered has already been and gone.
 *
 * Not an error — an office may well say "they came in last Tuesday" — but it
 * is worth saying out loud, because monday's date automations fire on arrival
 * and never retroactively, so a past date arms nothing. The follow-up chase
 * this field exists to schedule will simply not happen.
 */
export function appointmentAlreadyPassed(draft: RecordsReplyDraft, today: string): boolean {
  const { apptDate } = prunedRecordsReply(draft);
  if (!ISO_DATE.test(apptDate) || !ISO_DATE.test(today)) return false;
  return apptDate < today;
}

/**
 * The line that goes into MR Request Log, WITHOUT the timestamp and initials —
 * `shared/noteStamp.appendStampedNote` adds both, so every line in the column
 * carries one format.
 *
 * Returns "" when the draft is not saveable, so no caller can write half an
 * answer.
 */
export function recordsReplyNote(draft: RecordsReplyDraft): string {
  if (!canSaveRecordsReply(draft)) return "";
  const option = recordsReplyOption(draft.choice);
  if (!option) return "";

  const pruned = prunedRecordsReply(draft);
  const parts = [option.label];
  if (pruned.detail) parts.push(pruned.detail);
  if (pruned.apptDate) parts.push(`next appt ${mdy(pruned.apptDate)}`);
  return parts.join(" — ");
}

/** The Next Doc Appt Date to write, or "" when this reply sets none. */
export function recordsReplyApptDate(draft: RecordsReplyDraft): string {
  if (!canSaveRecordsReply(draft)) return "";
  const { apptDate } = prunedRecordsReply(draft);
  return ISO_DATE.test(apptDate) ? apptDate : "";
}
