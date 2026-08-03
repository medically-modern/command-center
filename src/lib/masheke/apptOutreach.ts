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
 * who already has a date.
 *
 * THREE WAYS OUT, and only three (Josh, 2026-08-03):
 *   1. An appointment date  → back to Chase, snoozed to appt + 1. The happy path.
 *   2. Three spent attempts → Escalation index 0, Manager Intervention.
 *   3. "Won't schedule / wants to cancel" → Propose Stuck, at ANY attempt. It
 *      climbs the shared ladder (stageActions.proposeStuckLevel): a rep's
 *      proposal lands in Manager Intervention (index 0), and a manager
 *      proposing from there promotes it to Final Decisions (index 2).
 * Everything else keeps the patient right here, snoozed for
 * APPT_ATTEMPT_SNOOZE_BUSINESS_DAYS.
 *
 (3) doesn't wait for the third attempt because it's a rep JUDGMENT about what
 * they were told, not a counter running out. It goes UP one rung rather than
 * straight to Final so a manager actually reviews the refusal before the
 * patient can leave the pipeline.
 *
 * WHERE THE ATTEMPTS LIVE. Every note this stage writes goes to MN Workflow
 * Notes (`long_text_mm27zjt2`) — there are no per-attempt columns (Josh,
 * 2026-08-03). The count is derived by matching attempt lines in that body
 * (`apptAttemptsFromNotes`), which is why the line format is a contract and why
 * a note is mandatory on every attempt: a note-less save would be
 * indistinguishable from no attempt and hand the rep unlimited retries.
 *
 * Chase's MN Attempts column (color_mm1wz0vg) is deliberately NOT reused — it is
 * board-wide, so a patient who spent two chase attempts would arrive with one
 * outreach attempt left, and the chase counter would be spent on the way back.
 *
 OVERSIGHT. The stage owns a full row across all three manager columns —
 * `doctor-appointments` (active) / `-manager` (escalation index 0) /
 * `-final` (index 2). Between them they cover every escalation value, which is
 * what guarantees an outreach patient is never in a state that matches no chart
 * (§7 — that would make them invisible app-wide). All three open
 * /doctor-appointments, never the chase UI: the work is calling the patient.
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
import { RETURNED_TO_QUEUE_TAG } from "./proposedStuck";

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
  | "wontSchedule"; // reached, patient won't schedule or wants to cancel

export const APPT_OUTCOME_LABEL: Record<ApptOutcome, string> = {
  booked: "Patient booked an appointment",
  willCall: "Spoke — patient will call the office",
  noAnswer: "No answer / no response",
  leftMessage: "Left message",
  wontSchedule: "Spoke — won't schedule / wants to cancel",
};

export type ApptMethod = "Phone call" | "Text message" | "Email";

export const APPT_METHODS: ApptMethod[] = ["Phone call", "Text message", "Email"];

/**
 * Business days a logged attempt snoozes the patient — Brandon's v3 matrix
 * ("No answer or left message: 1 business day"), confirmed by Josh 2026-08-03.
 * FLAT: every outcome except a booking or a refusal gets the same gap. The rep
 * texts, writes a note, submits; the patient is back tomorrow to check for a
 * reply.
 *
 * ── CHANGE THE CADENCE HERE AND NOWHERE ELSE ──
 */
export const APPT_ATTEMPT_SNOOZE_BUSINESS_DAYS = 1;


// ---------------------------------------------------------------------------
// Attempt log
// ---------------------------------------------------------------------------

export interface ApptAttempt {
  slot: 1 | 2 | 3;
  /** "M/D/YY, h:mm PM" as written. */
  date: string;
  method: string;
  outcome: string;
  /** The rep's note, with the initials suffix still attached. */
  note: string;
  raw: string;
}

/**
 * The one line an outreach attempt writes, appended to MN Workflow Notes
 * (Josh, 2026-08-03 — there are no per-attempt columns; every note this stage
 * produces lands in `long_text_mm27zjt2` alongside every other stage's):
 *
 *   8/3/26, 1:38 PM · Phone call — No answer / no response · sent her a text… —JH
 *
 * ⚠️ THIS LINE IS THE ATTEMPT COUNTER. `apptAttemptsFromNotes` counts the lines
 * in the notes body that match it, so the shape is a contract, not cosmetics: a
 * change here that isn't matched in the parser doesn't error, it silently
 * resets a patient's attempt count and hands the rep unlimited retries.
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

/** Every outcome label, for recognising an attempt line in the notes. */
const OUTCOME_LABELS = new Set<string>(Object.values(APPT_OUTCOME_LABEL));
const METHOD_NAMES = new Set<string>(APPT_METHODS);

/**
 * Is this notes line one of THIS stage's attempts?
 *
 * Keyed on the `{known method} — {known outcome}` segment rather than a tag,
 * because that's what the agreed line format gives us. Both vocabularies are
 * closed sets owned by this module, and no other stage writes that shape into
 * MN notes, so a false positive would need someone to hand-type a line that
 * looks exactly like an outreach attempt.
 */
function isApptAttemptLine(line: string): boolean {
  const parts = line.split(" · ");
  if (parts.length < 2) return false;
  const dash = parts[1].indexOf(" — ");
  if (dash < 0) return false;
  return (
    METHOD_NAMES.has(parts[1].slice(0, dash).trim()) &&
    OUTCOME_LABELS.has(parts[1].slice(dash + 3).trim())
  );
}

/** Parse one attempt line. */
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
  return { slot, date: "", method: "", outcome: "", note: raw, raw };
}

/**
 * Lines that RESET the attempt count — everything before one belongs to a
 * previous pass through this stage and must not be held against the patient:
 *
 *  - the entry stamp, written every time a patient is moved in from Chase, so a
 *    patient who comes back a second time starts at attempt 1 rather than
 *    arriving pre-exhausted;
 *  - a manager's Return to Queue, which hands the patient back to the rep — and
 *    would otherwise hand them back with the counter already spent, including
 *    all the attempts the MANAGER logged while they were escalated.
 *
 * Without this, both cases silently lock the processor out of a patient they
 * are supposed to be working, with no error and no way to tell why.
 */
const RESET_MARKERS = [
  "Provider requires a new visit",
  RETURNED_TO_QUEUE_TAG,
];

function isResetLine(line: string): boolean {
  return RESET_MARKERS.some((m) => line.includes(m));
}

/**
 * Every outreach attempt in the CURRENT pass, oldest first, read back out of MN
 * Workflow Notes. Slots are assigned by position — the first matching line is
 * attempt 1 — so the numbering can never disagree with the count.
 *
 * Counting starts after the last reset marker (see above). Capped at the three
 * most recent so a manager's unlimited logging can't produce a slot 4.
 */
export function apptAttemptsFromNotes(notes: string | undefined): ApptAttempt[] {
  const all = (notes ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let start = 0;
  all.forEach((l, i) => {
    if (isResetLine(l)) start = i + 1;
  });
  const lines = all.slice(start).filter(isApptAttemptLine);
  return lines.slice(-3).map((raw, i) => parseApptAttempt((i + 1) as 1 | 2 | 3, raw));
}

/**
 * How many attempts are in the current pass, UNCAPPED. A manager working an
 * escalated patient logs as many as they like, so this can exceed 3 — it's what
 * the manager UI shows instead of "attempt N of 3".
 */
export function apptAttemptTotal(p: Pick<Patient, "mnEvalNotes">): number {
  const all = (p.mnEvalNotes ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let start = 0;
  all.forEach((l, i) => {
    if (isResetLine(l)) start = i + 1;
  });
  return all.slice(start).filter(isApptAttemptLine).length;
}

/**
 * Is the 3-attempt cap in force for this patient?
 *
 * NO once they are escalated (Josh, 2026-08-03): a manager in Manager
 * Intervention or Final Decisions documents as many attempts as it takes, and
 * leaves that queue only by promoting the Propose Stuck or by getting a date.
 * The cap exists to stop a REP chasing forever, and it has already done its job
 * by the time a patient reaches a manager.
 */
export function apptCapApplies(p: Pick<Patient, "escalationIndex">): boolean {
  return p.escalationIndex !== 0 && p.escalationIndex !== 2;
}

/** Every logged attempt for a patient. */
export function apptAttempts(p: Pick<Patient, "mnEvalNotes">): ApptAttempt[] {
  return apptAttemptsFromNotes(p.mnEvalNotes);
}

/** How many attempts have been logged (0–3). This IS the counter. */
export function apptAttemptCount(p: Pick<Patient, "mnEvalNotes">): number {
  return apptAttempts(p).length;
}

/**
 * The slot the next attempt writes into, or null when the rep has spent all
 * three. An ESCALATED patient never returns null — the cap doesn't apply to a
 * manager (see apptCapApplies) — so the slot clamps at 3 for display purposes.
 */
export function nextApptSlot(
  p: Pick<Patient, "mnEvalNotes" | "escalationIndex">,
): 1 | 2 | 3 | null {
  const n = apptAttemptCount(p);
  if (n < 3) return (n + 1) as 1 | 2 | 3;
  return apptCapApplies(p) ? null : 3;
}

/**
 * A note is REQUIRED on every attempt. The notes line IS the counter, so a
 * note-less save would be indistinguishable from no attempt at all and hand the
 * rep an unlimited retry. Also matches Chase, which requires a note to complete.
 */
export function canLogAttempt(note: string, slot: 1 | 2 | 3 | null): boolean {
  return slot !== null && note.trim().length > 0;
}

// ---------------------------------------------------------------------------
// What an outcome does
// ---------------------------------------------------------------------------

export interface ApptOutcomeEffect {
  /**
   * - `booked`       → back to Chase, snoozed to appointment + 1.
   * - `retry`        → stay in this queue, snoozed.
   * - `escalate`     → Manager Intervention (Escalation index 0). Only ever
   *                    reached by exhausting all three attempts.
   * - `proposeStuck` → Final Decisions (Escalation index 2). The rep's route
   *                    for a patient who won't schedule or wants to cancel —
   *                    a manager decides whether they leave the pipeline.
   */
  kind: "booked" | "retry" | "escalate" | "proposeStuck";
  /** Next Action Date to write (YYYY-MM-DD, already weekend-clamped).
   *  Null when escalating or proposing stuck — the patient is a manager's now. */
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
  /** Rung a "won't schedule" proposal lands on — see stageActions. */
  proposeStuckLevel?: "manager" | "final";
  /** False for an escalated patient a manager is working — no 3-attempt cap,
   *  so the third attempt logs like any other instead of escalating. */
  capApplies?: boolean;
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
    const nextAction = snoozeUntilAfterAppointment(appt, today);
    return {
      kind: "booked",
      nextActionDate: nextAction,
      summary:
        nextAction <= today
          ? `Appointment ${appt} recorded — returned to Chase Clinicals, due now.`
          : `Appointment ${appt} recorded — returned to Chase Clinicals, snoozed until ${nextAction}.`,
    };
  }

  // A patient who won't schedule, or wants to cancel outright, is a candidate
  // for LEAVING the pipeline — which is what Final Decisions is for. So this
  // routes through the board's existing Propose Stuck path (Escalation index 2)
  // rather than Manager Intervention, at ANY attempt. It is the rep's judgment
  // call, not a counter running out, so it doesn't wait for the third attempt.
  if (opts.outcome === "wontSchedule") {
    // Which RUNG this lands on is the caller's call — it follows the shared
    // ladder (lib/shared/stageActions.proposeStuckLevel): a rep's proposal goes
    // to Manager Intervention, a manager's from there goes to Final Decisions.
    const toFinal = opts.proposeStuckLevel === "final";
    return {
      kind: "proposeStuck",
      nextActionDate: null,
      summary: toFinal
        ? "Proposed stuck — sent to Final Decisions for a manager to approve or return."
        : "Proposed stuck — sent to Manager Intervention for review.",
    };
  }

  // Every other outcome burns the slot and the patient stays in this queue.
  // Only running out of attempts hands them over — and only while the cap is in
  // force, i.e. for a REP. A manager already past that gate logs freely and
  // leaves by promoting the Propose Stuck or by getting a date.
  if (opts.slot >= 3 && opts.capApplies !== false) {
    return {
      kind: "escalate",
      nextActionDate: null,
      summary: "3 of 3 outreach attempts logged with no appointment — escalated to Manager Intervention.",
    };
  }

  const gap = APPT_ATTEMPT_SNOOZE_BUSINESS_DAYS;
  return {
    kind: "retry",
    nextActionDate: addBusinessDaysIso(today, gap),
    summary: `Attempt ${opts.slot} of 3 logged — trying again in ${gap} business days.`,
  };
}

/**
 * The Next Action Date a known appointment produces: the day AFTER the visit,
 * clamped off the weekend. Never the appointment date itself — that surfaces
 * the patient on the morning of the visit, before anything can have been sent.
 *
 * NEVER EARLIER THAN TODAY, and never later than it needs to be (Josh,
 * 2026-08-03). A date can legitimately arrive after the fact — the office says
 * "she was seen last Thursday", or the patient says "I already went in" — and
 * there is nothing left to wait for, so those patients are due NOW rather than
 * snoozed to a date in the past. Returning a past date would technically work
 * (the queues treat NAD ≤ today as due) but it would show a stale follow-up
 * date on screen and in Monday, which reads as a bug.
 *
 * An appointment TODAY still snoozes to tomorrow: the visit hasn't produced
 * paperwork yet, which is the whole reason for the +1.
 */
export function snoozeUntilAfterAppointment(
  appointmentDate: string,
  today: string = etToday(),
): string {
  const dayAfter = addCalendarDaysIso(appointmentDate, 1);
  // Deliberately NOT weekend-clamped when it falls back to today: clamping a
  // Saturday forward would re-hide a patient who is due, the same reason
  // enterDoctorAppointments writes a raw etToday().
  return dayAfter > today ? dayAfter : today;
}

/** True when the patient has run out of attempts with no appointment on file. */
export function isApptExhausted(
  p: Pick<Patient, "mnEvalNotes" | "appointmentDate" | "escalationIndex">,
): boolean {
  return !p.appointmentDate && apptCapApplies(p) && apptAttemptCount(p) >= 3;
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

/**
 * The reason body for a Propose Stuck raised from this stage — "won't schedule
 * / wants to cancel". It is wrapped by `stampProposedStuck` (lib/masheke/
 * proposedStuck) so the line starts with the `[Proposed Stuck` tag that
 * Oversight's `extractProposedStuckReason` slices on; this function supplies
 * only what goes AFTER the closing bracket, which is what a manager reads in
 * the Final Decisions "Proposed Reason" column.
 *
 * Carries the stage and the attempt number because that column is shared with
 * every other masheke stage — without them a manager sees a bare sentence and
 * can't tell a patient who refused on the first call from one who refused after
 * three. The note is required by the panel (`canLogAttempt`).
 */
export function apptProposedStuckReason(opts: { slot: 1 | 2 | 3; note: string }): string {
  return `${APPT_NOTE_PREFIX}s · Attempt ${opts.slot} of 3 · ${opts.note.trim()}`;
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
