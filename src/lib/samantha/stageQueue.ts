/**
 * Which Insurance queue owns a patient, given the Stage Advancer value a send
 * just wrote.
 *
 * Used by the optimistic advance hiding (lib/shared/pendingAdvance.ts) to answer
 * the one question a page must get right before hiding a patient it just sent:
 * **did that send take them out of THIS queue?**
 *
 * ⚠️ On this board a send does not always advance. `authOutstandingOutcome`
 * returns a null stage for "nothing resolved yet" (the Stage Advancer is left
 * alone and the patient stays in Auth Outstanding), and Benefits writes
 * `benefitsSos` — still a Benefits problem — for a blocker or an incomplete
 * check. Hiding on either of those takes a patient who is still this rep's work
 * off their own screen, which is the failure this whole mechanism exists to
 * avoid. So the rule is not "did the send succeed" but "does the value it wrote
 * belong to a different queue".
 *
 * ⚠️ `dvs` is not a group. The Insurance queues drop stage-DVS patients by
 * FILTER wherever they sit (§5.8 — no group-move automation exists for it), so
 * landing there leaves every queue immediately even though nothing moved.
 */
import { STAGE_INDEX } from "./mondayMapping";
import type { GROUPS } from "./mondayApi";

/** The three worked queues, keyed as `useMondayPatients`' `activeGroup`. */
export type SamQueue = Extract<keyof typeof GROUPS, "benefits" | "submitAuth" | "authOutstanding">;

/** The queue a Stage Advancer value leaves the patient in, or `null` for the
 *  values that belong to no worked queue at all (complete · authDenied ·
 *  stuck · dvs — each of which is somewhere else entirely). */
export function queueForStageIndex(stageIndex: number): SamQueue | null {
  switch (stageIndex) {
    case STAGE_INDEX.benefitsSos:
      return "benefits";
    case STAGE_INDEX.authorization:
      return "submitAuth";
    case STAGE_INDEX.authOutstanding:
      return "authOutstanding";
    default:
      // complete · authDenied · stuck · dvs — none of them this rep's queue.
      return null;
  }
}

/**
 * True when a send that wrote `stageIndex` takes the patient out of `queue`.
 *
 * @param stageIndex what the send wrote to the Stage Advancer, or `null` for a
 *   send that deliberately left the column alone — which is never an advance.
 */
export function stageLeavesQueue(stageIndex: number | null, queue: SamQueue): boolean {
  if (stageIndex === null) return false;
  return queueForStageIndex(stageIndex) !== queue;
}
