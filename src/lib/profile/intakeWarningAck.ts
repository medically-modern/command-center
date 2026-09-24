/**
 * Tick or untick one CONFIRM warning (§5.20b) — the only write this feature
 * makes besides the clear in `triggerStediRun`.
 *
 * Order, and each step is load-bearing:
 *
 *  1. RE-READ the ticks. Monday has no compare-and-set and `change_column_value`
 *     replaces the column, so writing from the page's copy would silently undo
 *     a tick another rep made since the last poll (§5.28's rule for notes).
 *     A failed read ABORTS — before anything is written.
 *  2. STAMP the intake notes — who, when, which warning, and for an override
 *     the reason (Josh, 2026-09-24). The note is the record, so it goes first:
 *     a failed note means no tick, never a tick nobody can account for.
 *  3. WRITE the ticks.
 *
 * A failure after step 2 leaves a note with no tick; the rep sees the error and
 * presses again, which writes a second note. That is the cheap direction.
 */

import { COL, readColumnTexts, writeText } from "./mondayApi";
import { appendIntakeNote } from "./unverifiedWrite";
import { ackNoteLine, requiresReason, withAck, type IntakeWarning } from "./intakeWarnings";

export async function setIntakeWarningAck(
  itemId: string,
  warning: Pick<IntakeWarning, "key" | "label" | "type">,
  on: boolean,
  opts: {
    /** The note stamp's stage label — "Patient Intake", "Referral Intake"… */
    stage: string;
    /** Required when ticking an override-type warning (`requiresReason`). */
    reason?: string;
  },
): Promise<string> {
  if (on && requiresReason(warning) && !(opts.reason ?? "").trim()) {
    throw new Error("Add the reason for the override first — it goes into the intake notes.");
  }

  const cols = await readColumnTexts(itemId, [COL.intakeWarningAcks]);
  const current = cols.find((c) => c.id === COL.intakeWarningAcks)?.text ?? "";
  const next = withAck(current, warning.key, on);

  const noted = await appendIntakeNote(
    itemId, ackNoteLine(warning, on, on ? opts.reason : undefined), undefined, opts.stage,
  );
  if (!noted.ok) {
    throw new Error(noted.errors.map((e) => e.error).join(" · ") || "Couldn't add the note.");
  }

  await writeText(itemId, COL.intakeWarningAcks, next);
  return next;
}
