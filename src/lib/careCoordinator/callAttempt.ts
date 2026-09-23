/**
 * Logging a call attempt FROM the Care Coordinator dashboard.
 *
 * ⚠️⚠️ **THIS IS THE FIRST THING ON THIS DASHBOARD THAT WRITES, and the line it
 * crosses was deliberate** (§5.30: *"The page is READ-ONLY … every exit
 * deep-links into the stage page whose verified write path does the work"*).
 * Josh authorised it on 2026-09-22, answering Brandon's *"when i make a call it
 * takes me out of command center … in the pop-up there should be 2 buttons:
 * Open Profile, Log Call Attempt (with notes)"* with *"yes masani is one of
 * them, add it"*. The reason the line existed still holds, so it is crossed the
 * narrowest possible way:
 *
 *   • **No new mutation.** Every write below is a call to the writer the stage
 *     page already uses — `profile/unverifiedWrite.logContactAttempt` and
 *     `appendIntakeNote` on intake, `welcomeCall/mondayWrite`'s three on the
 *     other column. Two writers for one column is how they disagree (§5.31c,
 *     §5.31d); calling the existing one from a second screen is what keeps
 *     there being one.
 *   • **Nothing else moves.** No stage advancer, no escalation, no group. A
 *     logged attempt leaves the patient exactly where they were, which is the
 *     whole contract of the button on the profile page too.
 *
 * ⚠️ **THE INTAKE FOLLOW UP *STATUS* IS STILL NEVER WRITTEN.** Only the DATE.
 * That status is the one-way door §5.10 records — the flag every intake list,
 * the role count and both baseline generators read — and `logContactAttempt`
 * is what guarantees it here, not this file. `careCoordinator/followUp.test.ts`
 * scans for it.
 */
import { appendIntakeNote, logContactAttempt } from "@/lib/profile/unverifiedWrite";
import {
  sendCallAttemptsToMonday, sendFollowUpToMonday, sendNotesToMonday,
} from "@/lib/welcomeCall/mondayWrite";
import { appendStampedNote } from "@/lib/shared/noteStamp";
import { fetchItemNotes, NOTES_COLUMN } from "./mondayApi";

/** Which column's patient this is — the two boards keep their own counter,
 *  their own follow-up date and their own notes column. */
export type CallColumn = "intake" | "welcome";

export interface CallAttemptTarget {
  column: CallColumn;
  itemId: string;
  name: string;
  /** The counter as the board has it; the write is always `current + 1`. */
  attempts: number;
}

export interface CallAttemptResult {
  /** The attempt number that was written. */
  attempt: number;
  /** The counter landed but the note did not — say so rather than reporting a
   *  clean save. An attempt with nothing saying what came of it is
   *  indistinguishable from no attempt to whoever picks the patient up next. */
  noteFailed?: string;
}

/**
 * Bump the counter, push the follow-up date, and stamp what happened.
 *
 * ⚠️ A note is REQUIRED and is refused here as well as in the dialog (Katie,
 * 2026-08-13 — the same rule the profile page and Doctor Appointments both
 * enforce). The counter alone records THAT someone called, never what was
 * said.
 *
 * ⚠️ The Welcome Call notes base is **re-read immediately before appending**,
 * never taken from the card's cached copy. Monday has no compare-and-set —
 * `change_column_value` REPLACES — and this dashboard memoises notes per
 * column load, so appending onto that copy would silently DELETE anything a
 * rep or an automation added in between (§5.28). Intake needs no re-read here
 * because `appendIntakeNote` does its own.
 */
export async function logCallAttempt(
  target: CallAttemptTarget, note: string, followUpDate: string,
): Promise<CallAttemptResult> {
  const body = note.trim();
  if (!body) throw new Error("Every call attempt has to say what happened.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(followUpDate)) throw new Error("Pick a follow-up date.");

  if (target.column === "intake") {
    const attempt = await logContactAttempt(target.itemId, target.attempts, followUpDate);
    const noted = await appendIntakeNote(target.itemId, `Call attempt ${attempt} — ${body}`);
    return {
      attempt,
      noteFailed: noted.ok ? undefined : noted.errors.map((e) => e.error).join(" · "),
    };
  }

  const attempt = (Number.isFinite(target.attempts) ? target.attempts : 0) + 1;
  await sendCallAttemptsToMonday(target.itemId, attempt);
  await sendFollowUpToMonday(target.itemId, followUpDate);
  try {
    const base = await fetchItemNotes(target.itemId, NOTES_COLUMN.welcome);
    await sendNotesToMonday(
      target.itemId,
      appendStampedNote(base, `Call attempt ${attempt} — ${body}`, "Welcome Call"),
    );
  } catch (e) {
    return { attempt, noteFailed: e instanceof Error ? e.message : String(e) };
  }
  return { attempt };
}
