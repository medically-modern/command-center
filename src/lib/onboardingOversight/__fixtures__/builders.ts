/**
 * Story-style fixture builders. Synthetic only: item IDs 9000000001+, UIDs 00000000-0000-4000-8000-0000000000NN.
 * No names, phones, emails or free text ever appear in fixtures (T-PII).
 */
import type { Dict } from "../types";
import type { BoardKey, ItemRow, RawEvent } from "../types";
import { OO_CONFIG } from "../config";

let n = 0;
export const uid = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, "0")}`;
export const at = (iso: string) => Date.parse(iso);

export function item(board: BoardKey, itemId: string, created: string, opts: { group?: string; uid?: string | null; values?: Record<string, number | string | null> } = {}): ItemRow {
  const values: ItemRow["values"] = {};
  for (const [col, v] of Object.entries(opts.values ?? {})) {
    if (col.startsWith("date_")) values[col] = { date: v as string | null, nonEmpty: v != null };
    else if (col.startsWith("text_")) values[col] = { nonEmpty: v != null && v !== "" };
    else values[col] = { index: v as number | null, nonEmpty: v != null };
  }
  const groups = (OO_CONFIG.groups as Dict)[board];
  return { boardKey: board, itemId, groupId: opts.group ?? groups?.inPipeline?.[0] ?? "topics", createdAtMs: at(created), uid: opts.uid ?? null, values };
}

/** ev("MN", "9000000101", "color_mm1x7997", null, 2, "2026-09-01T10:00:00-04:00", { user }) */
export function ev(board: BoardKey, itemId: string, col: string, from: number | null, to: number | null, when: string, o: { user?: number; bulk?: boolean } = {}): RawEvent {
  return { eventId: `e${++n}`, boardKey: board, itemId, columnId: col, event: "update_column_value", fromIndex: from, toIndex: to, atMs: at(when), userId: o.user ?? 100161122, bulk: !!o.bulk };
}
export function move(board: BoardKey, itemId: string, fromGroup: string, toGroup: string, when: string): RawEvent {
  return { eventId: `g${++n}`, boardKey: board, itemId, columnId: "__group__", event: "move_pulse_from_group", fromIndex: null, toIndex: null, fromGroupId: fromGroup, toGroupId: toGroup, atMs: at(when), userId: 100161122, bulk: false };
}
