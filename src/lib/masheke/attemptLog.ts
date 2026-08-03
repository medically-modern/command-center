/**
 * Shared attempt-log format for the masheke per-attempt text columns.
 *
 * Confirm Receipt, Chase Clinicals and Doctor Appointments each own three text
 * columns holding one attempt apiece. They share this wire format:
 *
 *     "M/D/YY, h:mm PM · {note} —{initials}"
 *
 * Extracted out of ChaseClinicalsPanel (2026-08-03) when Doctor Appointments
 * needed the same parse/format. Keep it in ONE place: a format change that
 * isn't matched in the parser doesn't error, it silently blanks the attempt
 * history on screen while the data sits fine in Monday.
 */
import { formatDateTimeShort } from "./etDate";

export interface AttemptChip {
  attempt: number;
  /** The timestamp segment, as stored. */
  date: string;
  note: string;
  raw: string;
}

/**
 * Parse a stored attempt value. Handles three shapes so no history is ever
 * lost on screen:
 *   - current:  "6/12/26, 2:33 PM · note —BE"
 *   - legacy:   "Name — 6/12/26"
 *   - bare:     "6/12/26"  (attempt logged before notes were required)
 */
export function parseAttemptValue(attempt: number, raw: string): AttemptChip {
  const parts = raw.split(" · ");
  if (parts.length >= 2) {
    const [date, ...rest] = parts;
    return { attempt, date: date.trim(), note: rest.join(" · ").trim(), raw };
  }
  const m = raw.match(/^(.+?)\s+—\s+(.+)$/);
  if (m) return { attempt, date: m[2], note: m[1], raw };
  return { attempt, date: raw, note: "", raw };
}

/** Build an attempt value. `date` must already be ET (etNow). */
export function formatAttemptValue(note: string, date: Date, initials = ""): string {
  const datePart = formatDateTimeShort(date);
  const n = note.trim();
  const sfx = initials ? ` —${initials}` : "";
  return (n ? `${datePart} · ${n}` : datePart) + sfx;
}

/**
 * Append a line to a running long_text notes body (newest last), preserving
 * what's there. Monday's long_text has no server-side append, so the whole
 * value is rewritten from the in-memory notes plus the new line.
 */
export function appendNoteLine(existing: string | undefined, line: string): string {
  const prev = (existing ?? "").trimEnd();
  return prev ? `${prev}\n${line}` : line;
}
