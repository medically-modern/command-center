/**
 * Paged activity_logs fetch per board (BUILD-SPEC §5.2): column-filtered stage/escalation events,
 * and a separate group-filtered query for group moves (moves OUT of the listed source groups).
 * A board's cursor only advances when every page succeeded (the caller commits it).
 */
import { gql } from "./gql";
import { parseEvent, type ActivityRow } from "./parseEvent";
import type { BoardKey, RawEvent } from "../types";
import { OO_CONFIG } from "../config";

const Q_COLS = `query OoActivity($board: [ID!], $from: ISO8601DateTime, $to: ISO8601DateTime, $cols: [String], $page: Int, $limit: Int) {
  complexity { before after reset_in_x_seconds }
  boards(ids: $board) { activity_logs(from: $from, to: $to, column_ids: $cols, limit: $limit, page: $page) { id event created_at user_id data } } }`;
const Q_GROUPS = `query OoGroupMoves($board: [ID!], $from: ISO8601DateTime, $to: ISO8601DateTime, $groups: [String], $page: Int, $limit: Int) {
  complexity { before after reset_in_x_seconds }
  boards(ids: $board) { activity_logs(from: $from, to: $to, group_ids: $groups, limit: $limit, page: $page) { id event created_at user_id data } } }`;

export const parseDrops: Record<string, number> = {};

async function pageAll(query: string, vars: Record<string, unknown>, board: BoardKey, keep: (e: string) => boolean, onPage?: (n: number) => void): Promise<RawEvent[]> {
  const out: RawEvent[] = []; let dropped = 0;
  const limit = OO_CONFIG.activityPageLimit;
  for (let page = 1; page <= 500; page++) {
    const data = await gql<{ boards: { activity_logs: ActivityRow[] }[] }>(query, { ...vars, page, limit });
    const rows = data.boards?.[0]?.activity_logs ?? [];
    for (const r of rows) {
      if (!keep(r.event)) continue;
      const e = parseEvent(board, r);
      if (e) out.push(e); else dropped++;
    }
    onPage?.(page);
    if (rows.length < limit) { parseDrops[board] = (parseDrops[board] ?? 0) + dropped; return out; }
  }
  // Page cap hit: fail the board so its cursor is NOT advanced (prototype review A17).
  throw new Error(`activity paging cap reached for ${board}`);
}

export async function fetchColumnEvents(board: Exclude<BoardKey, "SUB" | "FAX">, fromMs: number, toMs: number, onPage?: (n: number) => void) {
  return pageAll(Q_COLS, { board: [OO_CONFIG.boards[board]], from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(),
    cols: OO_CONFIG.activityColumns[board] }, board, (ev) => ev === "update_column_value", onPage);
}

export async function fetchGroupMoves(board: Exclude<BoardKey, "SUB" | "FAX">, fromMs: number, toMs: number) {
  if (!OO_CONFIG.groupMoves.enabled) return [];
  return pageAll(Q_GROUPS, { board: [OO_CONFIG.boards[board]], from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(),
    groups: OO_CONFIG.groupMoveSourceGroups[board] }, board, (ev) => ev === "move_pulse_from_group");
}
