/**
 * The Patient Intake sub-stage split — Info Collection / Profile Clean-Up
 * (Josh, 2026-08-19). Same pattern as the Chase Clinicals fax/parachute split
 * (CLAUDE.md §5.9) and the three-way Profile Send Off split (§5.10): ONE
 * stage on the board, sliced into app roles that must agree everywhere.
 *
 *   unverifiedReferrals ("Non-Referral Intake — Info Collection",
 *     /unverified-referrals) — the two DTC form groups. LEFT PANE ONLY. The rep
 *     collects what the patient told us and, once the unlock gate passes,
 *     presses Advance.
 *   intakeCleanup ("Intake — Profile Clean-Up", /profile-cleanup) — the
 *     Profile Clean-Up group. Left AND right pane, right pane already open.
 *     Exits to Medical Necessity exactly as the combined page did.
 *
 * The two are MUTUALLY EXCLUSIVE and cover the whole population, so role
 * counts still sum to the group totals (§5.8 counting contract) and no patient
 * is worked twice.
 *
 * ⚠️ THE GROUP IS THE QUEUE MARKER, NOT THE COLUMN — and that asymmetry is
 * deliberate. `Intake Sub-Stage` is written first (as the verified write's
 * stage advancer, so every data column is read back before it fires) and the
 * item is moved second. If the move fails, the patient is still in the form
 * group, so they are still in the rep's OWN queue: visible, and Advance can
 * simply be pressed again. Keying membership off the column instead would put
 * a half-advanced patient in a queue whose group they aren't in — the invisible
 * failure §5.10 keeps re-learning. Nothing but this app writes the column, so
 * there is no "arrived with it blank" case to tolerate (unlike Already In
 * System, where a board automation does the moving).
 *
 * This module is the canonical rule for the SPA. The SAME rule is duplicated
 * where it can't be imported — change all of them together or the burndown,
 * the sidebar and the oversight charts drift apart:
 *   1. src/hooks/useRoleCounts.ts        (profile board count task)
 *   2. scripts/snapshot-baseline.mjs     (build-time baseline, plain JS)
 *   3. services/baseline-cron/index.mjs  (9 AM Railway baseline, plain JS)
 *   4. src/lib/oversight/oversightApi.ts (CHART_FILTERS profile-send-off-*)
 */

/** The Profile Clean-Up group on the Profile Send Off board. Must match
 *  `GROUPS.profileCleanUp` in mondayApi.ts, oversightApi's
 *  `PROFILE_CLEANUP_GROUP` and useRoleCounts' `PROFILE_CLEANUP_GROUP_ID`. */
export const PROFILE_CLEANUP_GROUP = "group_mm6c3rhb";

/** The two DTC form groups Info Collection works. Must match
 *  `GROUPS.newFormPartial` / `GROUPS.newFormCompleted`. */
export const INFO_COLLECTION_GROUPS = ["group_mm5z87zt", "group_mm5zgeak"] as const;

/** Which of the two intake sub-stage roles a patient belongs to. */
export type IntakeSubStageRole = "infoCollection" | "cleanup";

/**
 * The one queue an intake patient belongs to.
 *
 * Deliberately takes the GROUP alone. The sub-stage column is the board's
 * record of the same fact, but reading it here would let a patient whose group
 * move failed disappear from the queue that can retry the advance.
 */
export function intakeSubStageRole(groupId: string | null | undefined): IntakeSubStageRole {
  return (groupId ?? "") === PROFILE_CLEANUP_GROUP ? "cleanup" : "infoCollection";
}

/** True when the patient has been advanced to Profile Clean-Up. */
export function isProfileCleanUp(groupId: string | null | undefined): boolean {
  return intakeSubStageRole(groupId) === "cleanup";
}
