/**
 * Proposed-Stuck note stamping (Manager Views — 2026-07 rework).
 *
 * The stuck PROPOSAL no longer lives in its own column. A rep proposes stuck
 * by flipping Escalation → "Final Escalation Required" (color_mm1x7997 index 2,
 * ESCALATION_INDEX.finalRequired) and the reason is APPENDED to the MN workflow
 * notes (text_mm6vevjf), stamped so the manager can spot it. The Oversight
 * Final-Decisions drill-down extracts that stamped line back out for its
 * "Proposed Reason" column, and a manager returning the patient to the queue
 * can append their own stamped note to the same field.
 *
 * The tag string is the contract between the writer (ProposeStuckModal) and the
 * reader (OversightTab) — keep them in agreement via these helpers.
 */

/** Leading tag on the stamped reason line. */
export const PROPOSED_STUCK_TAG = "[Proposed Stuck";
/** Leading tag on a manager's "returned to queue" note line. */
export const RETURNED_TO_QUEUE_TAG = "[Returned to queue";
/** Leading tag on a manager's "approved stuck" note line. */
export const APPROVED_STUCK_TAG = "[Approved Stuck";
/** Leading tag on a manager's "escalated to Final Decisions" note line
 *  (Submit Auth two-step review, 2026-07-29). */
export const ESCALATED_TO_FINAL_TAG = "[Escalated to Final";
/** Leading tag when Final Decisions hands a patient back DOWN to Manager
 *  Intervention rather than out to the rep queue (DVS loop, 2026-08-02). */
export const RETURNED_TO_MANAGER_TAG = "[Returned to manager";

/** Tag body: "<TAG> · <date>" plus the author's initials when signed in, so a
 *  stamped line says WHO proposed/decided — same signature every other note
 *  line carries (lib/shared/noteStamp). Kept INSIDE the bracket so
 *  `extractProposedStuckReason` (which slices at the first "]") still returns
 *  the reason alone. */
function stampHead(tag: string, dateStr: string, initials: string): string {
  return initials ? `${tag} · ${dateStr} · ${initials}]` : `${tag} · ${dateStr}]`;
}

/** The line appended to MN notes when a rep proposes stuck. */
export function stampProposedStuck(reason: string, dateStr: string, initials = ""): string {
  return `${stampHead(PROPOSED_STUCK_TAG, dateStr, initials)} ${reason.trim()}`;
}

/** The line appended to MN notes when a manager returns a proposal to the queue. */
export function stampReturnedToQueue(note: string, dateStr: string, initials = ""): string {
  return `${stampHead(RETURNED_TO_QUEUE_TAG, dateStr, initials)} ${note.trim()}`;
}

/**
 * The line appended when a manager APPROVES a stuck proposal. Optional, like
 * the return note — it records WHY the patient was let go, which is the last
 * thing written before they leave the pipeline.
 */
export function stampApprovedStuck(note: string, dateStr: string, initials = ""): string {
  return `${stampHead(APPROVED_STUCK_TAG, dateStr, initials)} ${note.trim()}`;
}

/**
 * The line appended when a manager escalates a Submit Auth proposal from
 * Manager Intervention to Final Decisions. The note is REQUIRED (unlike the
 * approve/return notes): "why does this need a final decision" is the whole
 * payload the Final Decisions reviewer works from.
 */
export function stampEscalatedToFinal(note: string, dateStr: string, initials = ""): string {
  return `${stampHead(ESCALATED_TO_FINAL_TAG, dateStr, initials)} ${note.trim()}`;
}

/**
 * The line appended when Final Decisions sends a patient back DOWN to Manager
 * Intervention (DVS manual-review loop). Optional note — usually "what I fixed
 * on the board", which is what the manager needs before re-running.
 */
export function stampReturnedToManager(note: string, dateStr: string, initials = ""): string {
  return `${stampHead(RETURNED_TO_MANAGER_TAG, dateStr, initials)} ${note.trim()}`;
}

/** Append a stamped line to an existing notes body (blank-line separated). */
export function appendStampedLine(existing: string | undefined, line: string): string {
  const base = (existing ?? "").trimEnd();
  return base ? `${base}\n\n${line}` : line;
}

/**
 * Pull the most recent "[Proposed Stuck · …] <reason>" line's reason back out of
 * the MN notes body, so the manager sees it at a glance. Returns "" when no
 * stamped line is present. The LAST match wins (a returned-then-re-proposed
 * patient carries more than one stamp).
 */
export function extractProposedStuckReason(notes: string | undefined): string {
  if (!notes) return "";
  const lines = notes.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t.startsWith(PROPOSED_STUCK_TAG)) {
      const close = t.indexOf("]");
      return close >= 0 ? t.slice(close + 1).trim() : t;
    }
  }
  return "";
}

/** Leading tag on the Insurance Benefits auto-escalation line
 *  (`samantha/benefitsDerive.composeEscalationReason`): the rule's own reason,
 *  e.g. "In-Network = Out-of-Network; DME Benefits = Not Covered". */
export const AUTO_ESCALATED_TAG = "[Auto-escalated";

/** A `noteStamp` head, `[Aug 27, 2026, 11:45 AM] `. The year is required so a
 *  decision tag such as `[Proposed Stuck · …]` is never mistaken for one —
 *  those are matched by tag before this is tried. */
const NOTE_STAMP_HEAD = /^\[[^\]]*\d{4}[^\]]*\]\s*/;
/** The two intake decision bodies, after an optional `<Stage>: ` label. The
 *  rung label on a manager's proposal (" — Manager Escalation") is skipped. */
const INTAKE_DECISION = /^(?:[^:]*?:\s*)?(Proposed stuck(?:\s+—\s+[^:]*)?|Escalated):\s*(.*)$/i;
/** `noteStamp`'s signature, ` —MT`. Only stripped from a stamped line. */
const NOTE_SIGNATURE = /\s+—[A-Za-z]{1,4}$/;

/**
 * One line of the Profile Send Off Call Log read as an intake escalation.
 *
 * ⚠️ Intake does NOT use the `[Proposed Stuck · …]` tag. `profile/unverifiedWrite`
 * writes "Proposed stuck: <reason>" (`proposeStuckNoteLine`) and "Escalated:
 * <reason>" (`escalateIntake`) through `appendIntakeNote`, which stamps them, so
 * the board holds
 *   `[Aug 27, 2026, 11:45 AM] Patient Intake: Proposed stuck: <reason> —MT`.
 * A reader that only knew the tag showed every intake escalation reason blank
 * on Pipeline Oversight (found 2026-10-02: 200 of 200 escalated intake patients
 * sampled carried a reason; the drill-down showed none). Accepts the bare
 * unstamped body as well.
 */
export function intakeDecisionLine(
  line: string,
): { kind: "propose" | "escalate"; reason: string } | null {
  const t = line.trim();
  const head = t.match(NOTE_STAMP_HEAD);
  const body = head ? t.slice(head[0].length) : t;
  const m = body.match(INTAKE_DECISION);
  if (!m) return null;
  let reason = m[2].trim();
  if (head) reason = reason.replace(NOTE_SIGNATURE, "").trim();
  return { kind: /^Escalated$/i.test(m[1]) ? "escalate" : "propose", reason };
}

/**
 * Why this patient is escalated, for the Oversight drill-down's Escalation /
 * Proposed Reason column — the LAST reason line in the notes, in whichever
 * format its board writes:
 *   - `[Proposed Stuck · …] <reason>` — Medical Evaluation, Insurance, Welcome Call;
 *   - `[Auto-escalated · …] <reason>` — the Insurance Benefits auto rule;
 *   - `…: Proposed stuck: <reason>` / `…: Escalated: <reason>` — intake's Call Log.
 * "" when no reason was ever written (an SOP auto-escalation writes only the
 * status column).
 */
export function extractEscalationReason(notes: string | undefined): string {
  if (!notes) return "";
  const lines = notes.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t.startsWith(PROPOSED_STUCK_TAG) || t.startsWith(AUTO_ESCALATED_TAG)) {
      const close = t.indexOf("]");
      return close >= 0 ? t.slice(close + 1).trim() : t;
    }
    const intake = intakeDecisionLine(t);
    if (intake) return intake.reason;
  }
  return "";
}
