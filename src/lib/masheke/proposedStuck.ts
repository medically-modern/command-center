/**
 * Proposed-Stuck note stamping (Manager Views — 2026-07 rework).
 *
 * The stuck PROPOSAL no longer lives in its own column. A rep proposes stuck
 * by flipping Escalation → "Final Escalation Required" (color_mm1x7997 index 2,
 * ESCALATION_INDEX.finalRequired) and the reason is APPENDED to the MN workflow
 * notes (long_text_mm27zjt2), stamped so the manager can spot it. The Oversight
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
