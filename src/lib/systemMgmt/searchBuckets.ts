/**
 * The three folders System Management → Search sorts its results into.
 *
 * A patient is a separate Monday item on every board they have passed through
 * (§6), so one name returns three to five rows: the finished Profile Send Off
 * record, the finished Medical Evaluation record, the live Insurance record …
 * Rendered as one flat list those look alike, and a rep scanning for a name
 * clicks the first row carrying it — reported as Search showing "the wrong
 * profiles" (Katie via Josh, 2026-09-03). The folders make the distinction the
 * rep is actually making:
 *
 * - **active**    — being worked somewhere in the pipeline. Escalated and
 *                   Proposed Stuck rows stay here: a manager still owns them and
 *                   they are still moving.
 * - **completed** — the item sits in a board's Completed group. History, not
 *                   work; it opens the finished record in review mode.
 * - **stuck**     — the item sits in a Stuck group, or its Stage Advancer reads
 *                   that board's Stuck label (the app's own "Mark as Stuck"
 *                   writes the label and a board automation does the move, so
 *                   for a moment only the label says so).
 *
 * Completed is checked FIRST, as `profileStatus` does: a stale Stuck label on a
 * finished item must not resurrect it. The group lists are the shared ones from
 * `profileStatus.ts`, whose test pins them to the `BOARDS` registry in both
 * directions, so a board that grows a Stuck group without being listed fails
 * the build rather than silently filing its patients under Active.
 */
import { STUCK_GROUP_IDS } from "@/lib/shared/profileStatus";
import { STUCK_LABELS, type SystemPatient } from "./mondayApi";
import { completedStageForPatient } from "./stageCompletion";

export type SearchBucket = "active" | "completed" | "stuck";

export const SEARCH_BUCKETS: readonly SearchBucket[] = ["active", "completed", "stuck"];

export const SEARCH_BUCKET_LABEL: Record<SearchBucket, string> = {
  active: "Active",
  completed: "Completed",
  stuck: "Stuck",
};

export type BucketInput = Pick<
  SystemPatient,
  "isCompleted" | "groupId" | "boardId" | "stageAdvancerText"
>;

/**
 * Every Stage Advancer label that means "stuck", per board — EXACT strings,
 * read off the live boards' `settings_str` on 2026-09-03 (§9: labels are the
 * contract). The three boards the app can itself mark Stuck reuse
 * `STUCK_LABELS`; DTC Intake's MASTER STAGE `color_mkyw6287` has two of its
 * own, and one of them ("Can't Proceed") does not contain the word Stuck at
 * all — which is why this is a list and not a pattern. A board absent here
 * classifies by group alone.
 */
export const STUCK_ADVANCER_LABELS: Record<number, readonly string[]> = {
  18406060017: [STUCK_LABELS[18406060017]],           // Medical Evaluation — "Stuck"
  18410601299: [STUCK_LABELS[18410601299]],           // Insurance — "Stuck / Don't Proceed"
  18410804557: [STUCK_LABELS[18410804557]],           // Welcome Call — "Stuck / Don't Proceed"
  18392794310: ["Stuck Final Review", "Can't Proceed"], // DTC Intake — MASTER STAGE
};

/** Does the Stage Advancer say Stuck, in this board's own vocabulary? */
function advancerSaysStuck(p: BucketInput): boolean {
  const text = (p.stageAdvancerText ?? "").trim();
  if (!text) return false;
  return (STUCK_ADVANCER_LABELS[p.boardId] ?? []).includes(text);
}

export function searchBucket(p: BucketInput): SearchBucket {
  if (p.isCompleted) return "completed";
  if (p.groupId && STUCK_GROUP_IDS.includes(p.groupId)) return "stuck";
  if (advancerSaysStuck(p)) return "stuck";
  return "active";
}

export type BucketedResults<T extends BucketInput = SystemPatient> = Record<SearchBucket, T[]>;

/** Split ranked results into the three folders, preserving order within each. */
export function bucketResults<T extends BucketInput>(results: readonly T[]): BucketedResults<T> {
  const out: BucketedResults<T> = { active: [], completed: [], stuck: [] };
  for (const p of results) out[searchBucket(p)].push(p);
  return out;
}

/**
 * Can a rep OPEN this row — is there a Command Center page for it?
 *
 * Two things open: a live stage page (`hasPage`), or a finished board's record
 * in review mode (`completedStageForPatient`). Everything else — DTC Intake and
 * Secondary Claims (no role page anywhere), a Subscription "Not Active" row,
 * an item parked in a Stuck group — used to render as a full profile row that
 * dead-ended on a toast when clicked: "shouldn't show a profile unless we have
 * a UI for it" (Josh, 2026-09-03). Search renders those as a NOTE instead —
 * the patient is in the system, here is the board and group, check Monday —
 * rather than dropping them, because "not found" would be a lie about a
 * patient we can see.
 */
export function rowIsWorkable(
  p: Pick<SystemPatient, "id" | "boardId" | "boardName" | "isCompleted" | "hasPage">,
): boolean {
  return p.hasPage || completedStageForPatient(p) !== null;
}

/** Workable profiles first, then the "check Monday" notes, each in rank order. */
export function workableFirst<T extends Parameters<typeof rowIsWorkable>[0]>(rows: readonly T[]): T[] {
  const yes: T[] = [];
  const no: T[] = [];
  for (const r of rows) (rowIsWorkable(r) ? yes : no).push(r);
  return [...yes, ...no];
}
