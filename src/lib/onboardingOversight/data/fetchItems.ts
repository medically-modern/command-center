/**
 * Current item state (BUILD-SPEC §5.2). Full refetch each refresh. Text of count-only
 * columns is reduced to nonEmpty at parse time and discarded; item names are never requested.
 */
import type { Dict } from "../types";
import { gql } from "./gql";
import type { BoardKey, ItemRow } from "../types";
import { OO_CONFIG } from "../config";

interface RawItem { id: string; name?: string; created_at: string; group: { id: string }; column_values: { id: string; type: string; text: string | null; value: string | null }[] }

export function parseItem(boardKey: BoardKey, raw: RawItem): ItemRow {
  const values: ItemRow["values"] = {};
  const countOnly = new Set<string>(OO_CONFIG.countOnlyColumns);
  let uid: string | null = null;
  const uidCol = (OO_CONFIG.uidColumn as Record<string, string>)[boardKey];
  for (const cv of raw.column_values ?? []) {
    const text = (cv.text ?? "").trim();
    if (cv.id === uidCol) uid = text ? text.toLowerCase() : null;
    // Count-only text keeps a number only when the whole text is digits (a count CC writes, e.g. call attempts); never other text.
    if (countOnly.has(cv.id)) { values[cv.id] = { nonEmpty: text !== "", ...(/^\d+$/.test(text) ? { num: Number(text) } : {}) }; continue; }
    let v: Dict = null;
    try { v = cv.value ? JSON.parse(cv.value) : null; } catch { v = null; }
    if (cv.type === "status") values[cv.id] = { index: typeof v?.index === "number" ? v.index : null, nonEmpty: v?.index != null };
    else if (cv.type === "date") values[cv.id] = { date: v?.date ?? null, nonEmpty: !!v?.date };
    else if (cv.type === "numbers" || cv.type === "numeric") { const n = Number(text); values[cv.id] = { nonEmpty: text !== "", ...(text !== "" && !Number.isNaN(n) ? { num: n } : {}) }; }
    else values[cv.id] = { nonEmpty: text !== "" }; // other text: presence only
  }
  return { boardKey, itemId: String(raw.id), groupId: raw.group?.id ?? "", createdAtMs: Date.parse(raw.created_at), uid, values, ...(typeof raw.name === "string" && raw.name ? { name: raw.name } : {}) };
}

const FIELDS = `cursor items { id name created_at group { id } column_values(ids: $cols) { id type text value } }`; // name: live UI only (CR-14), never exported

export async function fetchBoardItems(boardKey: Exclude<BoardKey, "FAX">, groupIds?: string[]): Promise<ItemRow[]> {
  const boardId = OO_CONFIG.boards[boardKey];
  const cols = (OO_CONFIG.itemColumns as Record<string, readonly string[]>)[boardKey];
  const out: ItemRow[] = [];
  let cursor: string | null = null;
  if (groupIds) {
    const q = `query($b:[ID!],$g:[String],$cols:[String!]){ complexity{before after reset_in_x_seconds} boards(ids:$b){ groups(ids:$g){ id items_page(limit:500){ ${FIELDS} } } } }`;
    const d: Dict = await gql(q, { b: [boardId], g: groupIds, cols });
    for (const g of d.boards?.[0]?.groups ?? []) {
      for (const it of g.items_page.items) out.push(parseItem(boardKey, it));
      cursor = g.items_page.cursor;
      while (cursor) cursor = await nextPage(boardKey, cursor, cols, out);
    }
    return out;
  }
  const q = `query($b:[ID!],$cols:[String!]){ complexity{before after reset_in_x_seconds} boards(ids:$b){ items_page(limit:500){ ${FIELDS} } } }`;
  const d: Dict = await gql(q, { b: [boardId], cols });
  for (const it of d.boards?.[0]?.items_page?.items ?? []) out.push(parseItem(boardKey, it));
  cursor = d.boards?.[0]?.items_page?.cursor ?? null;
  while (cursor) cursor = await nextPage(boardKey, cursor, cols, out);
  return out;
}

async function nextPage(boardKey: BoardKey, cursor: string, cols: readonly string[], out: ItemRow[]): Promise<string | null> {
  const q = `query($c:String!,$cols:[String!]){ complexity{before after reset_in_x_seconds} next_items_page(limit:500, cursor:$c){ ${FIELDS} } }`;
  const d: Dict = await gql(q, { c: cursor, cols });
  for (const it of d.next_items_page?.items ?? []) out.push(parseItem(boardKey, it));
  return d.next_items_page?.cursor ?? null;
}

/** Count of INT items in non-pipeline groups, and how many carry an escalation flag (DH-08). */
export async function fetchExcludedIntCounts(): Promise<{ total: number; escalated: number }> {
  const groups = [...OO_CONFIG.groups.INT.excludedCountOnly];
  const q = `query($b:ID!,$g:[CompareValue!]!,$esc:[CompareValue!]!){ complexity{before after reset_in_x_seconds}
    total: aggregate(query:{from:{type:TABLE,id:$b}, query:{rules:[{column_id:"group",compare_value:$g,operator:any_of}]}, select:[{type:FUNCTION,function:{function:COUNT_ITEMS},as:"n"}]}){ results{ entries{ alias value{ ... on AggregateBasicAggregationResult { result } } } } }
    esc: aggregate(query:{from:{type:TABLE,id:$b}, query:{rules:[{column_id:"group",compare_value:$g,operator:any_of},{column_id:"${OO_CONFIG.escalationColumn.INT}",compare_value:$esc,operator:any_of}]}, select:[{type:FUNCTION,function:{function:COUNT_ITEMS},as:"n"}]}){ results{ entries{ alias value{ ... on AggregateBasicAggregationResult { result } } } } } }`;
  const d: Dict = await gql(q, { b: OO_CONFIG.boards.INT, g: groups, esc: [0, 2] });
  const num = (x: Dict) => Number(x?.results?.[0]?.entries?.[0]?.value?.result ?? 0);
  return { total: num(d.total), escalated: num(d.esc) };
}
