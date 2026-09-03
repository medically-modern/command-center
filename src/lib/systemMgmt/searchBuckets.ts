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

/** Does the Stage Advancer say Stuck, on a board whose vocabulary we know? */
function advancerSaysStuck(p: BucketInput): boolean {
  const text = (p.stageAdvancerText ?? "").trim();
  if (!text) return false;
  const label = STUCK_LABELS[p.boardId];
  if (label && text === label) return true;
  // The boards that have a Stuck label all spell it with "Stuck" first
  // ("Stuck", "Stuck / Don't Proceed"). A board not in STUCK_LABELS that grows
  // one is far likelier to follow that shape than to be a real stage.
  return /^stuck\b/i.test(text);
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
