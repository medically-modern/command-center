/**
 * Reads for Reports & Metrics — and ONLY reads (§5.52).
 *
 * Three slim, one-shot board reads, through the same endpoint switch every
 * module uses (`MONDAY_API_URL` + both header sets, §5.1 · §5.33). Nothing
 * here writes, nothing here polls: a report is not a queue. The page's own
 * hook runs these once on open and again on Refresh.
 *
 * ⚠️ Column ids are IMPORTED from each slice's `mondayApi.ts`, never retyped —
 * a column renamed there is renamed here (the coordinator's rule, §5.30).
 *
 * ⚠️ Each read throws on a failed page rather than returning what it has: a
 * truncated list on a page of COUNTS is a wrong number with nothing erroring
 * (§9's absence-is-not-evidence trap, and the orders slice's own reason for
 * `fetchOrders` throwing). The page shows the failure per source instead.
 *
 * ⚠️ The orders read is the orders page's own `fetchOrders` — ~1,480 rows in
 * three sequential pages, the cost of ONE `/orders` poll — mapped by its own
 * `mondayItemToOrder` so `orderStage`/`orderFlags` read the columns they were
 * written for. A slimmer list would be a second copy of which columns those
 * rules need (§5.51c: every fact on an order is the orders slice's rule).
 */
import { MONDAY_API_URL, mondayAuthHeaders, mondayIdentityHeaders } from "@/lib/shared/mondayEndpoint";
import { BOARD_ID as SUB_BOARD_ID, COL as SUB_COL, GROUPS as SUB_GROUPS } from "@/lib/subscription/mondayApi";
import { BOARD_ID as PROFILE_BOARD_ID, COL as PROFILE_COL } from "@/lib/profile/mondayApi";
import { INTAKE_FORM_GROUP_IDS } from "@/lib/careCoordinator/mondayApi";
import { fetchOrders } from "@/lib/orders/mondayApi";
import { mondayItemToOrder } from "@/lib/orders/mondayMapping";
import type { Order } from "@/lib/orders/workflow";
import type { FormLeadRow, SubscriptionRow } from "./reportsRules";

interface RawItem {
  id: string;
  group: { id: string } | null;
  column_values: { id: string; text: string | null }[];
}

interface PageResult {
  cursor: string | null;
  items: RawItem[];
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...mondayAuthHeaders(), ...mondayIdentityHeaders() },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Monday read failed: HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  }
  return json.data as T;
}

const PAGE = 500;
const ITEM_FIELDS = `id group { id } column_values(ids: $cols) { id text }`;

/**
 * Every item in one board group, all pages, the named columns only.
 * `compare_value` is inlined, not a variable — Monday rejects a `[String!]`
 * variable in that position (see lib/scheduledCalls/mondayApi.ts).
 */
async function readGroup(boardId: string | number, groupId: string, cols: string[]): Promise<RawItem[]> {
  const first = await gql<{ boards: { items_page: PageResult }[] }>(
    `query ($boardId: ID!, $cols: [String!]) {
       boards(ids: [$boardId]) {
         items_page(limit: ${PAGE}, query_params: { rules: [{ column_id: "group", compare_value: ${JSON.stringify([groupId])} }] }) {
           cursor
           items { ${ITEM_FIELDS} }
         }
       }
     }`,
    { boardId: String(boardId), cols },
  );
  const page = first.boards?.[0]?.items_page;
  const all: RawItem[] = [...(page?.items ?? [])];
  let cursor = page?.cursor ?? null;
  while (cursor) {
    const next = await gql<{ next_items_page: PageResult }>(
      `query ($cursor: String!, $cols: [String!]) {
         next_items_page(limit: ${PAGE}, cursor: $cursor) { cursor items { ${ITEM_FIELDS} } }
       }`,
      { cursor, cols },
    );
    all.push(...(next.next_items_page?.items ?? []));
    cursor = next.next_items_page?.cursor ?? null;
  }
  return all;
}

function text(item: RawItem, colId: string): string {
  return item.column_values.find((c) => c.id === colId)?.text ?? "";
}

/** The Subscriptions group: status, days-to-order and MR on every row. */
export async function fetchSubscriptionRows(): Promise<SubscriptionRow[]> {
  const rows = await readGroup(SUB_BOARD_ID, SUB_GROUPS.subscriptions, [SUB_COL.status, SUB_COL.daysToOrder, SUB_COL.mr]);
  return rows.map((r) => ({
    status: text(r, SUB_COL.status),
    daysToOrder: text(r, SUB_COL.daysToOrder),
    mr: text(r, SUB_COL.mr),
  }));
}

/**
 * The two DTC form groups — Drop-off Step only, ~1,750 rows in four pages.
 * The coordinator reads the same groups at ~25 columns; this page needs one.
 */
export async function fetchFormLeadRows(): Promise<FormLeadRow[]> {
  const pages = await Promise.all(
    INTAKE_FORM_GROUP_IDS.map((g) => readGroup(PROFILE_BOARD_ID, g, [PROFILE_COL.formDropOffStep])),
  );
  return pages.flat().map((r) => ({
    id: r.id,
    groupId: r.group?.id ?? "",
    dropOffStep: text(r, PROFILE_COL.formDropOffStep),
  }));
}

/** Every order on the board, as the orders page reads its list (§5.35). */
export async function fetchOrderRows(): Promise<Order[]> {
  const items = await fetchOrders();
  return items.map((i) => mondayItemToOrder(i, { partial: true }));
}
