/**
 * Care Coordinator ownership, recorded in the NOTES LOG rather than a column.
 *
 * §9 asks for a `Care Coordinator Owner` column "to enable Phase 3 without a
 * later migration". Josh's call (2026-08-10): don't add one — stamp it into
 * the notes instead, and let any later stage key off the stamp.
 *
 * ⚠️ The vehicle matters, and "updates" would NOT have worked. Advance to MN
 * does not move this item — board automation CREATES a new item on Medical
 * Evaluation and copies COLUMNS. Monday updates don't come along, so a stamp
 * posted as an update would stay behind on Profile Send Off and be invisible
 * exactly where Phase 3 wants to read it.
 *
 * The notes column does carry: `text_mm389fs` is copied into Masheke's
 * `text_mm3xdze1`, which Evaluate already renders as read-only prior-stage
 * notes. So a line written here is readable from Medical Necessity onward with
 * no new column, no automation change, and no migration.
 *
 * THE LINE IS THE RECORD. Downstream code will match on it, so treat the shape
 * as a contract — same rule as the Doctor Appointments attempt line (§5.12).
 */

/** Label that opens the line. Downstream parsers match on this. */
export const CARE_COORDINATOR_LABEL = "Care Coordinator";

/** The note body. `appendStampedNote` wraps it with the ET timestamp, the
 *  stage and the author's initials, so this is only the payload. */
export function coordinatorNoteLine(name: string): string {
  return `${CARE_COORDINATOR_LABEL}: ${name.trim()}`;
}

/**
 * The coordinator currently assigned, read back out of the log.
 *
 * LAST wins — assignment can change hands, and the most recent line is the
 * current owner. Returns null when nobody has been assigned.
 *
 * Tolerates the full stamped form (`[Aug 10, 2026, 2:04 PM] Patient Intake:
 * Care Coordinator: Jane Doe —JH`) as well as a bare line, because the same
 * text is read on boards whose stamps were written by other stages.
 */
export function extractCoordinator(notes: string | undefined | null): string | null {
  const lines = (notes ?? "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(
      new RegExp(`${CARE_COORDINATOR_LABEL}:\\s*(.+?)\\s*(?:—[^—]*)?$`),
    );
    const name = m?.[1]?.trim();
    if (name) return name;
  }
  return null;
}
