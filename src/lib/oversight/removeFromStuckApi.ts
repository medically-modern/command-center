/**
 * Remove from Stuck — the Monday half (§5.57). The rules, and why each board
 * writes what it writes, are in `removeFromStuck.ts`; this only reads and sends.
 *
 * ⚠️ **One read when the manager opens the panel, one transaction when they
 * press** — never on render or a timer (INCIDENT_2026-08-20's rules). Every
 * call goes through `MONDAY_API_URL`, so production rides the gateway (§5.1).
 *
 * ⚠️⚠️ **Deliberately NOT an `executeWritesWithVerification` transaction**, and
 * the reason is the same one §5.34 gives for the Stuck ladder's own writers:
 * that ceremony exists so DATA columns are indexed before a trigger reads them,
 * and nothing here writes data for an automation to read — one group move, then
 * at most one Stage Advancer write. What it does keep from it is the part that
 * matters here: the result is READ BACK, and the success toast is only shown
 * once Monday itself says the patient is out of Stuck (Josh: *"with a notif
 * that it sucessfully sent to monday"*). HTTP 200 is not that (§9).
 *
 * ⚠️ **Group first, advancer second.** Insurance's Benefits automations can
 * re-route an arriving patient to DVS (advancer → DVS → their own group move);
 * writing the advancer last lets that routing run AFTER our move and win, as it
 * does on an ordinary arrival. The other order could drag a re-routed patient
 * back out of DVS. A failure between the two leaves the record still saying
 * Stuck on its advancer, which `canRemoveFromStuck` keeps offering the button
 * for, and a second press is safe: the move is then a no-op and the advancer
 * write lands.
 */
import { MONDAY_API_URL, mondayIdentityHeaders } from "../shared/mondayEndpoint";
import { appendNoteToRecord, patchCachedPlacement } from "../commsHub/dossierApi";
import {
  advancerWrite,
  stillStuck,
  stuckOriginFromLog,
  targetFromOrigin,
  type ActivityLogEntry,
  type StuckOrigin,
  type StuckPlan,
  type StuckTarget,
} from "./removeFromStuck";

const MONDAY_API_VERSION = "2024-10";

function getToken(): string {
  return (import.meta.env.VITE_MONDAY_API_TOKEN as string | undefined) ?? "";
}

/** ⚠️ Sends the bundled token EMPTY rather than refusing without one — the
 *  gateway injects the real one, and production deliberately ships none
 *  (§5.1: gate on `hasMondayAuth()`, never on the bundled token). */
async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: getToken(),
      ...mondayIdentityHeaders(),
      "API-Version": MONDAY_API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Monday request failed (${res.status})`);
  const json = await res.json();
  // ⚠️ A refused value is HTTP 200 with `errors[]` (§9) — this is what raises it.
  if (json.errors) throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  return json.data as T;
}

/* ── Reading where they were ──────────────────────────────────────────────── */

/** Activity-log rows per page, and how many pages to look through. A patient
 *  parked for months still collects a few "days in stage" ticks a week, so the
 *  move into Stuck is rarely past the first page; five is the ceiling. */
const LOG_PAGE = 100;
const LOG_PAGES = 5;

/**
 * Where Monday's activity log says this item was just before Stuck, and the
 * step that matches it (null → the manager picks).
 *
 * ⚠️ The rows carry column VALUES — patient data — so nothing here logs them.
 */
export async function readStuckOrigin(
  plan: StuckPlan,
  itemId: string,
): Promise<{ origin: StuckOrigin | null; target: StuckTarget | null }> {
  const entries: ActivityLogEntry[] = [];
  for (let page = 1; page <= LOG_PAGES; page++) {
    const data = await gql<{ boards: { activity_logs: ActivityLogEntry[] | null }[] }>(
      `query ($board: [ID!], $item: [ID!], $limit: Int, $page: Int) {
         boards(ids: $board) {
           activity_logs(item_ids: $item, limit: $limit, page: $page) { event created_at data }
         }
       }`,
      { board: [String(plan.boardId)], item: [itemId], limit: LOG_PAGE, page },
    );
    const rows = data.boards?.[0]?.activity_logs ?? [];
    entries.push(...rows);
    const origin = stuckOriginFromLog(plan, entries);
    const target = targetFromOrigin(plan, origin);
    if (target || rows.length < LOG_PAGE) return { origin, target };
  }
  const origin = stuckOriginFromLog(plan, entries);
  return { origin, target: targetFromOrigin(plan, origin) };
}

/* ── Putting them back ────────────────────────────────────────────────────── */

interface Placement {
  groupId: string;
  groupTitle: string;
  advancerText: string;
  advancerIndex: number | null;
}

async function readPlacement(plan: StuckPlan, itemId: string): Promise<Placement> {
  // ⚠️ No `column_values` at all on a board with no advancer: an empty or null
  // `ids` list is not "no columns" to Monday, it is every column.
  const data = await gql<{
    items: {
      id: string;
      group: { id: string; title: string } | null;
      column_values?: { id: string; text: string | null; value: string | null }[];
    }[];
  }>(
    plan.advancerColId
      ? `query ($ids: [ID!], $cols: [String!]) {
           items(ids: $ids) { id group { id title } column_values(ids: $cols) { id text value } }
         }`
      : `query ($ids: [ID!]) { items(ids: $ids) { id group { id title } } }`,
    plan.advancerColId ? { ids: [itemId], cols: [plan.advancerColId] } : { ids: [itemId] },
  );
  const it = data.items?.[0];
  if (!it) throw new Error("Monday has no record with this id any more — nothing was changed.");
  const cell = plan.advancerColId ? it.column_values?.find((c) => c.id === plan.advancerColId) : undefined;
  let advancerIndex: number | null = null;
  try {
    const v = cell?.value ? JSON.parse(cell.value) : null;
    if (typeof v?.index === "number") advancerIndex = v.index;
  } catch {
    advancerIndex = null;
  }
  return {
    groupId: it.group?.id ?? "",
    groupTitle: it.group?.title ?? "",
    advancerText: (cell?.text ?? "").trim(),
    advancerIndex,
  };
}

async function moveToGroup(itemId: string, groupId: string): Promise<void> {
  await gql(
    `mutation ($item: ID!, $group: String!) { move_item_to_group(item_id: $item, group_id: $group) { id } }`,
    { item: itemId, group: groupId },
  );
}

async function writeAdvancer(plan: StuckPlan, itemId: string, value: { index: number } | { clear: true }): Promise<void> {
  await gql(
    `mutation ($board: ID!, $item: ID!, $col: String!, $value: JSON!) {
       change_column_value(board_id: $board, item_id: $item, column_id: $col, value: $value) { id }
     }`,
    {
      board: String(plan.boardId),
      item: itemId,
      col: plan.advancerColId,
      value: "index" in value ? JSON.stringify({ index: value.index }) : "{}",
    },
  );
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RemoveFromStuckResult {
  /** Where Monday now has them. */
  groupTitle: string;
  /** Monday showed them out of Stuck before anything was written. */
  alreadyOut: boolean;
  /** The "Removed from Stuck" line reached the record's notes. */
  noteSaved: boolean;
}

/**
 * Move one record out of Stuck to `target`, confirm it on Monday, then stamp
 * the record's notes.
 *
 * ⚠️ The note is LAST and best-effort: it records something that happened, so
 * it must not be written before the move lands (a failed move would leave a
 * note saying the patient was put back), and its failure must not read as the
 * move failing — the caller says so separately.
 */
export async function removeFromStuck(opts: {
  plan: StuckPlan;
  target: StuckTarget;
  itemId: string;
  notes: { columnId: string; columnType: "text" | "long_text" | null };
  /** The number the dossier was looked up by — `appendNoteToRecord`'s cache key. */
  lookupPhone: string;
}): Promise<RemoveFromStuckResult> {
  const { plan, target, itemId } = opts;
  if (!plan.targets.includes(target)) throw new Error("That stage isn't on this board — nothing was changed.");

  const before = await readPlacement(plan, itemId);
  if (!stillStuck(plan, before.groupId, before.advancerText)) {
    patchCachedPlacement(plan.boardId, itemId, {
      groupId: before.groupId,
      groupTitle: before.groupTitle,
      stageAdvancerText: before.advancerText,
    });
    return { groupTitle: before.groupTitle, alreadyOut: true, noteSaved: false };
  }

  if (before.groupId !== target.groupId) await moveToGroup(itemId, target.groupId);
  const adv = advancerWrite(plan, target, before.advancerText);
  // Writing the label it already holds would change nothing and fire nothing
  // (§9), so it is skipped rather than sent.
  if (adv && !("index" in adv && adv.index === before.advancerIndex)) await writeAdvancer(plan, itemId, adv);

  let after = await readPlacement(plan, itemId);
  for (let i = 0; i < 2 && stillStuck(plan, after.groupId, after.advancerText); i++) {
    await pause(1000);
    after = await readPlacement(plan, itemId);
  }
  if (stillStuck(plan, after.groupId, after.advancerText)) {
    throw new Error(
      `Monday still shows this patient as Stuck (${after.groupTitle || "no group"}${after.advancerText ? ` · ${after.advancerText}` : ""}). Press Remove from Stuck again, or move them on Monday.`,
    );
  }

  patchCachedPlacement(plan.boardId, itemId, {
    groupId: after.groupId,
    groupTitle: after.groupTitle,
    stageAdvancerText: after.advancerText,
  });

  let noteSaved = false;
  if (opts.notes.columnId) {
    try {
      await appendNoteToRecord({
        boardId: plan.boardId,
        itemId,
        columnId: opts.notes.columnId,
        columnType: opts.notes.columnType,
        text: `Removed from Stuck — back to ${target.label}.`,
        stage: target.label,
        phone: opts.lookupPhone,
      });
      noteSaved = true;
    } catch (e) {
      console.warn("[removeFromStuck] moved, but the note did not save", e instanceof Error ? e.message : e);
    }
  }
  return { groupTitle: after.groupTitle, alreadyOut: false, noteSaved };
}
