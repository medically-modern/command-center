/**
 * The four folders System Management → Search sorts its results into.
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
 *                   for a moment only the label says so) — OR it is **Proposed
 *                   Stuck** (Escalation index 2, "Final Escalation Required"),
 *                   awaiting a manager's decision in Final Decisions. Josh,
 *                   2026-09-03, pointing at Gregory White on that very screen:
 *                   *"stuck patients absolutely do have a UI"*. To the manager
 *                   this search is for, a proposal and an approval are the same
 *                   queue; the Profile Status badge still tells them apart.
 *                   Manager Intervention (index 0) stays ACTIVE — that patient
 *                   is being worked, just by a manager.
 * - **orders**    — the item is on the **New Order Board**: one ORDER, not a
 *                   patient's stage. Checked FIRST, above Completed, because
 *                   this folder is the only place an order may appear (Josh,
 *                   2026-09-15: *"ONLY show them in a tab to the right of
 *                   stuck"*). Without that first check every order would file
 *                   under Active — no Stuck group, no escalation column, no
 *                   Completed flag — and a rep searching a name would get their
 *                   eight reorders in among the stages they were looking for.
 *
 * Orders is checked first of all (it is a whole board, not a state), then
 * Completed, as `profileStatus` does: a stale Stuck label on a finished item
 * must not resurrect it. The group lists are the shared ones from
 * `profileStatus.ts`, whose test pins them to the `BOARDS` registry in both
 * directions, so a board that grows a Stuck group without being listed fails
 * the build rather than silently filing its patients under Active.
 */
import { STUCK_GROUP_IDS } from "@/lib/shared/profileStatus";
import { STUCK_LABELS, type SystemPatient } from "./mondayApi";
import { isOrderRow } from "./ordersSearch";

export type SearchBucket = "active" | "completed" | "stuck" | "orders";

/** Tab order, left to right. Orders sits to the RIGHT of Stuck, as asked. */
export const SEARCH_BUCKETS: readonly SearchBucket[] = ["active", "completed", "stuck", "orders"];

/**
 * The folders a surface offers when it is asking **which PATIENT is this** —
 * the Communications Hub's "find this patient" pane, which shares this search.
 *
 * ⚠️ An order is not an identity, and picking one there is a SILENT wrong
 * answer: `dossierApi.fetchDossierItemsForPick` looks the picked row's board up
 * in `BOARDS`, which deliberately does not carry the order board
 * (`ordersSearch.ts`), so the pick contributes nothing and the pane renders
 * whatever the phone lookup already had — as though the rep's choice had taken.
 * The Hub therefore drops order rows before bucketing and offers these three.
 */
export const PATIENT_SEARCH_BUCKETS: readonly SearchBucket[] = ["active", "completed", "stuck"];

export const SEARCH_BUCKET_LABEL: Record<SearchBucket, string> = {
  active: "Active",
  completed: "Completed",
  stuck: "Stuck",
  orders: "Orders",
};

export type BucketInput = Pick<
  SystemPatient,
  "isCompleted" | "groupId" | "boardId" | "stageAdvancerText" | "escalationLevel"
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
  // ⚠️ First, ahead of everything: an order is only ever an order. See the
  // header — every other rule here would file it under Active.
  if (isOrderRow(p)) return "orders";
  if (p.isCompleted) return "completed";
  if (p.groupId && STUCK_GROUP_IDS.includes(p.groupId)) return "stuck";
  if (advancerSaysStuck(p)) return "stuck";
  if (p.escalationLevel === "final") return "stuck";
  return "active";
}

/**
 * How a sentence names what is in a folder.
 *
 * ⚠️ Three of the four labels are ADJECTIVES describing patients — "3 active
 * results", "no stuck patients" — and Orders is a noun for something that is
 * not a patient at all. Run through the same template it reads "3 orders
 * results" and "No orders patients matching …", so the phrasing is declared
 * here rather than derived from the label at each call site.
 */
export function bucketResultCount(bucket: SearchBucket, n: number): string {
  const s = n === 1 ? "" : "s";
  if (bucket === "orders") return `${n} order${s}`;
  return `${n} ${SEARCH_BUCKET_LABEL[bucket].toLowerCase()} result${s}`;
}

/** What an empty folder says it has none of: "No orders matching …". */
export function bucketEmptyNoun(bucket: SearchBucket): string {
  if (bucket === "orders") return "orders";
  return `${SEARCH_BUCKET_LABEL[bucket].toLowerCase()} patients`;
}

export type BucketedResults<T extends BucketInput = SystemPatient> = Record<SearchBucket, T[]>;

/** Split ranked results into the four folders, preserving order within each. */
export function bucketResults<T extends BucketInput>(results: readonly T[]): BucketedResults<T> {
  const out: BucketedResults<T> = { active: [], completed: [], stuck: [], orders: [] };
  for (const p of results) out[searchBucket(p)].push(p);
  return out;
}

