/**
 * Doctor Appointments — the outreach rules (2026-08-03).
 *
 * WHAT THIS STAGE IS. While chasing a doctor's office for clinicals the office
 * sometimes says "we haven't seen this patient recently — they need to come in".
 * The chase is dead until the visit happens. The rep flips the patient with the
 * "Doctor Appointment Required" button on either chase page, and one rule
 * decides where they go:
 *
 *     Appointment Date SET   ⇒ a normal Chase patient, snoozed to appt + 1.
 *     Appointment Date BLANK ⇒ the Doctor Appointments outreach queue (here).
 *
 * That single rule is the whole state machine — there is no separate status
 * column for "scheduled vs unscheduled", and the queue never contains a patient
 * who already has a date. When outreach lands a date the patient goes straight
 * back to Chase, snoozed. Nothing else exits this stage except escalation.
 *
 * WHY THE ATTEMPT COLUMNS ARE THE COUNTER. Chase owns MN Attempts
 * (color_mm1wz0vg) board-wide. Reusing it would hand a patient who already
 * spent two chase attempts exactly one outreach attempt before escalating, and
 * would spend the chase counter on the way back. So the count is DERIVED from
 * how many of the three Appt Attempt columns are filled — which also means a
 * note is mandatory on every attempt (an empty column is an unused slot, so a
 * note-less save would be invisible to the counter and the rep would get a free
 * retry forever). `canLogAttempt` enforces that.
 *
 * ESCALATION. Three filled attempts with no appointment date ⇒ Escalation
 * (color_mm1x7997) index 0, Manager Intervention. NOT index 2 — index 2 is the
 * "proposed stuck" signal that pulls a patient out of every queue awaiting a
 * Final Decision, and an unreachable patient is a manager task, not a
 * pipeline exit. Oversight's Appointments bar keys on index 0 AND this
 * sub-stage (see oversightApi CHART_FILTERS) so it can't scoop up escalated
 * chase patients, which share the column.
 *
 * The escalation column being shared is also why `enterDoctorAppointments`
 * CLEARS it on the way in (mondayWrite): a manager working an escalated chase
 * patient who clicks the button would otherwise deliver them into this queue
 * already escalated — and escalated patients are hidden from this sidebar, so
 * they'd be invisible on arrival. Same stale-carry-over bug evaluateReentry.ts
 * exists to undo; don't create a second instance of it.
 */
import type { Patient } from "./workflow";
import { addBusinessDaysIso, addCalendarDaysIso, etToday } from "./etDate";

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/** What the rep heard. Only `booked` changes the patient's state; everything
 *  else is "try again later" or "hand it over". */
export type ApptOutcome =
  | "booked"        // reached, appointment booked — the ONLY success
  | "willCall"      // reached, patient says they'll call the office
  | "noAnswer"      // no answer / no response
  | "leftMessage"   // voicemail / text left
  | "wontSchedule"; // reached, patient won't schedule

export const APPT_OUTCOME_LABEL: Record<ApptOutcome, string> = {
  booked: "Patient booked an appointment",
  willCall: "Spoke — patient will call the office",
  noAnswer: "No answer / no response",
  leftMessage: "Left message",
  wontSchedule: "Spoke — patient won't schedule",
};

export type ApptMethod = "Phone call" | "Text message" | "Email" | "Patient portal";

export const APPT_METHODS: ApptMethod[] = [
  "Phone call",
  "Text message",
  "Email",
  "Patient portal",
];

/**
 * Days between outreach attempts, indexed by the attempt just logged (1-based).
 * Escalating rather than flat: attempt 2 the next day catches a different time
 * of day, and the last gap being a week is what makes "we genuinely tried"
 * defensible to a manager. Chase gives a fax room a flat +3 (ChaseClinicalsPanel
 * nadBumpDays); a flat +1 here would burn all three inside one working week and
 * escalate anyone on vacation.
 *
 * ── CHANGE THE CADENCE HERE AND NOWHERE ELSE ──
 */
export const APPT_ATTEMPT_CADENCE_BUSINESS_DAYS = [1, 3, 5] as const;

/** Calendar days to wait when the patient says they'll call the office
 *  themselves. Calendar, not business — it's a patient-side promise, and the
 *  result is weekend-clamped anyway. */
export const WILL_CALL_SNOOZE_DAYS = 7;

/**
 * Calendar days to wait after "won't schedule".
 *
 * ⚠️ OPEN — Katie has not ruled on this. Built as "burns an attempt, snooze and
 * try again" because that's the reversible default: it keeps the doc's own rule
 * that escalation comes from EXHAUSTING the attempts, and it avoids flooding
 * Final Decisions with patients who said "not right now, I'm travelling".
 * If Katie decides a refusal is terminal, set WONT_SCHEDULE_ESCALATES = true —
 * that's the entire change.
 */
export const WONT_SCHEDULE_SNOOZE_DAYS = 14;
export const WONT_SCHEDULE_ESCALATES = false;

// ---------------------------------------------------------------------------
// Attempt log
// ---------------------------------------------------------------------------

export interface ApptAttempt {
  slot: 1 | 2 | 3;
  /** "M/D/YY, h:mm PM" as written. */
  date: string;
  method: string;
  outcome: string;
  note: string;
  raw: string;
}

/** The three attempt column values in slot order. */
export function apptAttemptRaw(p: Pick<Patient, "apptAttempt1" | "apptAttempt2" | "apptAttempt3">): (string | undefined)[] {
  return [p.apptAttempt1, p.apptAttempt2, p.apptAttempt3];
}

/**
 * Column format: `M/D/YY, h:mm PM · {method} — {outcome} · {note} —{initials}`
 * Mirrors the chase attempt format (parseAttemptValue in lib/masheke/attemptLog)
 * so both stages read the same shape. Round-tripped by apptOutreach.test.ts —
 * a change here that isn't matched in the parser silently blanks history.
 */
export function formatApptAttempt(opts: {
  date: string;
  method: string;
  outcome: ApptOutcome;
  note: string;
  initials?: string;
}): string {
  const head = `${opts.date} · ${opts.method} — ${APPT_OUTCOME_LABEL[opts.outcome]}`;
  const body = opts.note.trim() ? ` · ${opts.note.trim()}` : "";
  const sig = opts.initials ? ` —${opts.initials}` : "";
  return `${head}${body}${sig}`;
}

/** Parse one stored attempt value back out. Tolerant of legacy/hand-edited
 *  values — anything unparseable becomes the note so nothing is ever lost. */
export function parseApptAttempt(slot: 1 | 2 | 3, raw: string): ApptAttempt {
  const parts = raw.split(" · ");
  const date = (parts[0] ?? "").trim();
  const middle = (parts[1] ?? "").trim();
  const note = parts.slice(2).join(" · ").trim();
  const dash = middle.indexOf(" — ");
  if (parts.length >= 2 && dash >= 0) {
    return {
      slot,
      date,
      method: middle.slice(0, dash).trim(),
      outcome: middle.slice(dash + 3).trim(),
      note,
      raw,
    };
  }
  // No recognisable method/outcome segment — keep the whole thing as the note.
  return { slot, date: parts.length > 1 ? date : "", method: "", outcome: "", note: parts.length > 1 ? [middle, note].filter(Boolean).join(" · ") : raw, raw };
}

/** Every logged attempt, in slot order. */
export function apptAttempts(p: Pick<Patient, "apptAttempt1" | "apptAttempt2" | "apptAttempt3">): ApptAttempt[] {
  const out: ApptAttempt[] = [];
  apptAttemptRaw(p).forEach((raw, i) => {
    if (raw && raw.trim()) out.push(parseApptAttempt((i + 1) as 1 | 2 | 3, raw));
  });
  return out;
}

/** How many attempts have been logged (0–3). This IS the counter. */
export function apptAttemptCount(p: Pick<Patient, "apptAttempt1" | "apptAttempt2" | "apptAttempt3">): number {
  return apptAttempts(p).length;
}

/** The slot the next attempt writes into, or null when all three are spent. */
export function nextApptSlot(
  p: Pick<Patient, "apptAttempt1" | "apptAttempt2" | "apptAttempt3">,
): 1 | 2 | 3 | null {
  const n = apptAttemptCount(p);
  return n >= 3 ? null : ((n + 1) as 1 | 2 | 3);
}

/** The column id for a slot. */
export function apptAttemptColumn(slot: 1 | 2 | 3, cols: { apptAttempt1: string; apptAttempt2: string; apptAttempt3: string }): string {
  return slot === 1 ? cols.apptAttempt1 : slot === 2 ? cols.apptAttempt2 : cols.apptAttempt3;
}

/**
 * A note is REQUIRED on every attempt. The three columns are the counter, so a
 * note-less save would leave the slot looking unused and hand the rep an
 * unlimited retry. Also matches Chase, which requires a note to complete.
 */
export function canLogAttempt(note: string, slot: 1 | 2 | 3 | null): boolean {
  return slot !== null && note.trim().length > 0;
}

// ---------------------------------------------------------------------------
// What an outcome does
// ---------------------------------------------------------------------------

export interface ApptOutcomeEffect {
  /** `booked` → back to Chase snoozed; `retry` → stay here, snoozed;
   *  `escalate` → Manager Intervention. */
  kind: "booked" | "retry" | "escalate";
  /** Next Action Date to write (YYYY-MM-DD, already weekend-clamped).
   *  Null only when escalating — an escalated patient is the manager's. */
  nextActionDate: string | null;
  /** Human sentence for the toast + the stamped note. */
  summary: string;
}

/**
 * Resolve an outcome into the writes it implies.
 *
 * `slot` is the attempt just logged (1-based) and drives the cadence.
 * `appointmentDate` is required for `booked` and ignored otherwise.
 * `today` is injectable for tests; defaults to ET today.
 */
export function resolveApptOutcome(opts: {
  outcome: ApptOutcome;
  slot: 1 | 2 | 3;
  appointmentDate?: string;
  today?: string;
}): ApptOutcomeEffect {
  const today = opts.today ?? etToday();

  if (opts.outcome === "booked") {
    const appt = (opts.appointmentDate ?? "").slice(0, 10);
    if (!appt) {
      // Guarded in the UI too, but never let a "success" through dateless —
      // it would return the patient to Chase due immediately with nothing to
      // wait for, and the whole point is the snooze.
      throw new Error("An appointment date is required to record a booked appointment.");
    }
    return {
      kind: "booked",
      nextActionDate: snoozeUntilAfterAppointment(appt),
      summary: `Appointment booked for ${appt} — returned to Chase Clinicals, snoozed until the day after.`,
    };
  }

  if (opts.outcome === "wontSchedule" && WONT_SCHEDULE_ESCALATES) {
    return {
      kind: "escalate",
      nextActionDate: null,
      summary: "Patient will not schedule — escalated to Manager Intervention.",
    };
  }

  // Every other outcome burns the slot. Third one with no date hands over.
  if (opts.slot >= 3) {
    return {
      kind: "escalate",
      nextActionDate: null,
      summary: "3 of 3 outreach attempts logged with no appointment — escalated to Manager Intervention.",
    };
  }

  if (opts.outcome === "willCall") {
    return {
      kind: "retry",
      nextActionDate: addCalendarDaysIso(today, WILL_CALL_SNOOZE_DAYS),
      summary: `Patient will call the office — following up in ${WILL_CALL_SNOOZE_DAYS} days.`,
    };
  }

  if (opts.outcome === "wontSchedule") {
    return {
      kind: "retry",
      nextActionDate: addCalendarDaysIso(today, WONT_SCHEDULE_SNOOZE_DAYS),
      summary: `Patient not ready to schedule — following up in ${WONT_SCHEDULE_SNOOZE_DAYS} days.`,
    };
  }

  const gap = APPT_ATTEMPT_CADENCE_BUSINESS_DAYS[opts.slot - 1] ?? 3;
  return {
    kind: "retry",
    nextActionDate: addBusinessDaysIso(today, gap),
    summary: `Attempt ${opts.slot} of 3 logged — trying again in ${gap} business day${gap === 1 ? "" : "s"}.`,
  };
}

/**
 * The snooze a known appointment produces: the day AFTER the visit, clamped off
 * the weekend. Never the appointment date itself — that surfaces the patient on
 * the morning of the visit, before anything can have been sent.
 */
export function snoozeUntilAfterAppointment(appointmentDate: string): string {
  return addCalendarDaysIso(appointmentDate, 1);
}

/** True when the patient has run out of attempts with no appointment on file. */
export function isApptExhausted(
  p: Pick<Patient, "apptAttempt1" | "apptAttempt2" | "apptAttempt3" | "appointmentDate">,
): boolean {
  return !p.appointmentDate && apptAttemptCount(p) >= 3;
}

// ---------------------------------------------------------------------------
// Note stamps (all land in MN Workflow Notes — long_text_mm27zjt2)
// ---------------------------------------------------------------------------

/** Prefix every Doctor Appointments note line carries, so a line is traceable
 *  in a column four other stages also write to. */
export const APPT_NOTE_PREFIX = "Patient Doctor Appointment";

const sig = (initials?: string) => (initials ? ` —${initials}` : "");

/** "7/29/26, 2:33 PM · Patient Doctor Appointment Attempt 2 · Phone call — No answer · note —BE" */
export function stampApptAttemptNote(opts: {
  stamp: string;
  slot: 1 | 2 | 3;
  method: string;
  outcome: ApptOutcome;
  note: string;
  initials?: string;
}): string {
  return (
    `${opts.stamp} · ${APPT_NOTE_PREFIX} Attempt ${opts.slot} · ` +
    `${opts.method} — ${APPT_OUTCOME_LABEL[opts.outcome]} · ${opts.note.trim()}${sig(opts.initials)}`
  );
}

/** Written from Chase when the office says a visit is already booked. */
export function stampAppointmentScheduled(opts: {
  stamp: string;
  appointmentDate: string;
  fromStage: string;
  note: string;
  initials?: string;
}): string {
  return (
    `${opts.stamp} · ${APPT_NOTE_PREFIX} · Scheduled appointment date ${opts.appointmentDate} ` +
    `(from ${opts.fromStage}) · ${opts.note.trim()}${sig(opts.initials)}`
  );
}

/** Written from Chase when the office says a visit is needed but not booked. */
export function stampAppointmentNeeded(opts: {
  stamp: string;
  fromStage: string;
  note: string;
  initials?: string;
}): string {
  return (
    `${opts.stamp} · ${APPT_NOTE_PREFIX} · Provider requires a new visit, none scheduled ` +
    `(from ${opts.fromStage}) · moved to Doctor Appointments${opts.note.trim() ? ` · ${opts.note.trim()}` : ""}${sig(opts.initials)}`
  );
}

/** Written when an appointment date lands and the patient goes back to Chase. */
export function stampReturnedToChase(opts: {
  stamp: string;
  appointmentDate: string;
  toStage: string;
  initials?: string;
}): string {
  return (
    `${opts.stamp} · ${APPT_NOTE_PREFIX} · Appointment ${opts.appointmentDate} recorded — ` +
    `returned to ${opts.toStage}, snoozed until the day after${sig(opts.initials)}`
  );
}

/** Written when the third attempt lands with no appointment. */
export function stampApptEscalated(opts: { stamp: string; initials?: string }): string {
  return (
    `${opts.stamp} · ${APPT_NOTE_PREFIX} · 3 of 3 attempts with no appointment — ` +
    `escalated to Manager Intervention${sig(opts.initials)}`
  );
}

// ---------------------------------------------------------------------------
// Where a patient goes back to
// ---------------------------------------------------------------------------

/**
 * Which chase role owns this patient, by the same rule as §5.9 — Clinicals
 * Method `Parachute` or `Email` ⇒ the Email & Parachute role, everything else
 * (Fax, blank) ⇒ Fax. Used to label the return and to place the patient on the
 * right Oversight row.
 */
export function chaseRoleFor(clinicalsMethod: string | undefined): "chaseFax" | "chaseParachute" {
  return clinicalsMethod === "Parachute" || clinicalsMethod === "Email"
    ? "chaseParachute"
    : "chaseFax";
}

export function chaseRoleLabel(clinicalsMethod: string | undefined): string {
  return chaseRoleFor(clinicalsMethod) === "chaseParachute"
    ? "Chase Clinicals — Email & Parachute"
    : "Chase Clinicals — Fax";
}
