/**
 * FAX board ("Faxes, Calls, VMS, Parachute") inbound volume (BUILD-SPEC §2.10, §5.2, B-07).
 * Only id, created_at and group are read: item names identify senders and are never requested.
 */
import type { Dict } from "../types";
import { gql } from "./gql";
import type { FaxData } from "../types";
import { OO_CONFIG } from "../config";
import { etDateKey } from "../time/businessTime";

export const FAX_GROUPS: Record<string, string> = {
  group_title: "Faxes", group_mm05pbhz: "Calls", group_mm05stvg: "Text Messages", topics: "Miss Voicemails",
};

function weekStartKey(ms: number): string {
  const key = etDateKey(ms);
  const d = new Date(`${key}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7; // Monday-start weeks
  return new Date(d.getTime() - back * 86400000).toISOString().slice(0, 10);
}

export async function fetchFax(nowMs: number): Promise<FaxData> {
  const since = etDateKey(nowMs - 84 * 86400000);
  const board = OO_CONFIG.boards.FAX;
  let items: { created_at: string; group: { id: string } }[] = [];
  try { items = await fetchFaxRecent(board, since); }
  catch { items = await fetchFaxAll(board); } // fallback (spec §5.2): all items, same fields, filtered below by created_at
  return summarizeFax(items, nowMs, board);
}

async function fetchFaxAll(board: string) {
  const items: { created_at: string; group: { id: string } }[] = [];
  let d: Dict = await gql(`query($b:[ID!]){ complexity{before after reset_in_x_seconds} boards(ids:$b){ items_page(limit:500){ cursor items{ id created_at group{ id } } } } }`, { b: [board] });
  items.push(...(d.boards?.[0]?.items_page?.items ?? [])); let cursor: string | null = d.boards?.[0]?.items_page?.cursor ?? null;
  while (cursor) { d = await gql(`query($c:String!){ complexity{before after reset_in_x_seconds} next_items_page(limit:500,cursor:$c){ cursor items{ id created_at group{ id } } } }`, { c: cursor }); items.push(...(d.next_items_page?.items ?? [])); cursor = d.next_items_page?.cursor ?? null; }
  return items;
}

async function fetchFaxRecent(board: string, since: string) {
  const items: { created_at: string; group: { id: string } }[] = [];
  const first = `query($b:[ID!],$since:CompareValue!){ complexity{before after reset_in_x_seconds} boards(ids:$b){ items_page(limit:500, query_params:{rules:[{column_id:"date_mm1bsv9z", compare_value:$since, operator:greater_than_or_equals}]}){ cursor items{ id created_at group{ id } } } } }`;
  let d: Dict = await gql(first, { b: [board], since: ["EXACT", since] });
  const page = d.boards?.[0]?.items_page;
  items.push(...(page?.items ?? []));
  let cursor: string | null = page?.cursor ?? null;
  while (cursor) {
    d = await gql(`query($c:String!){ complexity{before after reset_in_x_seconds} next_items_page(limit:500,cursor:$c){ cursor items{ id created_at group{ id } } } }`, { c: cursor });
    items.push(...(d.next_items_page?.items ?? []));
    cursor = d.next_items_page?.cursor ?? null;
  }
  return items;
}

export async function summarizeFax(items: { created_at: string; group: { id: string } }[], nowMs: number, board: string): Promise<FaxData> {
  const weeksMap = new Map<string, Record<string, number>>();
  for (const it of items) {
    const ms = Date.parse(it.created_at);
    if (ms < nowMs - 84 * 86400000) continue;
    const w = weekStartKey(ms);
    const g = FAX_GROUPS[it.group?.id] ?? "Other";
    const rec = weeksMap.get(w) ?? {};
    rec[g] = (rec[g] ?? 0) + 1;
    weeksMap.set(w, rec);
  }
  // Fill empty weeks so a zero week (feed outage, DH-15) is visible.
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    const w = weekStartKey(nowMs - i * 7 * 86400000);
    weeks.push({ weekStart: w, byGroup: weeksMap.get(w) ?? {} });
  }
  const neverClosed: Record<string, number> = {};
  for (const [gid, name] of Object.entries(FAX_GROUPS)) {
    try {
      const q = `query($b:ID!,$g:[CompareValue!]!){ complexity{before after reset_in_x_seconds} aggregate(query:{from:{type:TABLE,id:$b}, query:{rules:[{column_id:"status",compare_value:[0],operator:any_of},{column_id:"group",compare_value:$g,operator:any_of}]}, select:[{type:FUNCTION,function:{function:COUNT_ITEMS},as:"n"}]}){ results{ entries{ alias value{ ... on AggregateBasicAggregationResult { result } } } } } }`;
      const r: Dict = await gql(q, { b: board, g: [gid] });
      neverClosed[name] = Number(r.aggregate?.results?.[0]?.entries?.[0]?.value?.result ?? 0);
    } catch { /* aggregate unavailable: leave blank, tile says so */ }
  }
  return { weeks, neverClosed };
}
