/**
 * Turns a raw monday activity_logs row into a RawEvent (BUILD-SPEC §2.4, §3.1, §3.2.2).
 * monday's created_at is a 17-digit count of 100-ns ticks since the epoch.
 */
import type { Dict } from "../types";
import type { BoardKey, RawEvent } from "../types";
import { OO_CONFIG } from "../config";

export interface ActivityRow { id: string; event: string; created_at: string; user_id: string | number; data: string }

export function ticksToMs(createdAt: string): number {
  return Number(BigInt(createdAt) / 10000n);
}

function labelIndex(v: Dict, board: BoardKey, col: string): number | null {
  const idx = v?.label?.index ?? v?.index;
  if (typeof idx === "number") return idx;
  if (idx != null && !Number.isNaN(Number(idx))) return Number(idx);
  // Text-only label payloads: resolve through config.labelText for stage columns (prototype review R2).
  const text = v?.label?.text ?? v?.label;
  if (typeof text === "string" && col === (OO_CONFIG.stageColumn as Dict)[board]) {
    const m = (OO_CONFIG.labelText as Dict)[board]?.[text];
    if (typeof m === "number") return m;
  }
  return null;
}

/** Returns null (and does not throw) for rows that cannot be parsed. */
export function parseEvent(boardKey: BoardKey, row: ActivityRow): RawEvent | null {
  let data: Dict;
  try { data = typeof row.data === "string" ? JSON.parse(row.data) : row.data; } catch { return null; }
  if (!data) return null;
  const itemId = String(data.pulse_id ?? data.pulse?.id ?? "");
  if (!itemId) return null;
  let atMs: number;
  try { atMs = ticksToMs(String(row.created_at)); } catch { return null; }
  const base = { eventId: String(row.id), boardKey, itemId, atMs, userId: Number(row.user_id), bulk: data.is_batch_action === true };
  if (row.event === "move_pulse_from_group") {
    // VERIFY-2 V1: group_id is the SOURCE group; destination is dest_group.id. Never use group_id as destination.
    const fromGroupId = data.source_group?.id != null ? String(data.source_group.id) : undefined;
    const toGroupId = data.dest_group?.id != null ? String(data.dest_group.id) : undefined;
    if (!toGroupId && !fromGroupId) return null;
    return { ...base, columnId: "__group__", event: "move_pulse_from_group", toIndex: null, fromIndex: null, fromGroupId, toGroupId };
  }
  if (row.event !== "update_column_value") return null;
  const columnId = String(data.column_id ?? "");
  if (!columnId) return null;
  const toText = typeof data.value?.label?.text === "string" ? data.value.label.text : typeof data.value?.label === "string" ? data.value.label : null;
  const rawNum = data.value?.number ?? (typeof data.value?.text === "string" && /^\d+$/.test(data.value.text) ? Number(data.value.text) : null);
  const toNum = rawNum == null || Number.isNaN(Number(rawNum)) ? null : Number(rawNum);
  const toDate = typeof data.value?.date === "string" ? data.value.date : null, fromDate = typeof data.previous_value?.date === "string" ? data.previous_value.date : null;
  return { ...base, columnId, event: "update_column_value", toIndex: labelIndex(data.value, boardKey, columnId), fromIndex: labelIndex(data.previous_value, boardKey, columnId), toText, toNum, ...(toDate || fromDate ? { toDate, fromDate } : {}) };
}

/**
 * Marks bulk events (§3.1): same user + same (column, from, to) on >= minItems distinct items within
 * windowSeconds; or monday's is_batch_action; or inside an operator ignoreEventWindows window.
 */
export function markBulk(events: RawEvent[], cfg = OO_CONFIG): RawEvent[] {
  const winMs = cfg.bulk.windowSeconds * 1000;
  const groups = new Map<string, RawEvent[]>();
  for (const e of events) {
    const k = `${e.boardKey}|${e.userId}|${e.columnId}|${e.fromIndex}|${e.toIndex}|${e.toGroupId ?? ""}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(e);
  }
  const bulkIds = new Set<string>();
  for (const list of groups.values()) {
    if (list.length < cfg.bulk.minItems) continue;
    list.sort((a, b) => a.atMs - b.atMs);
    let j = 0;
    for (let i = 0; i < list.length; i++) {
      while (list[i].atMs - list[j].atMs > winMs) j++;
      const items = new Set(list.slice(j, i + 1).map((e) => e.itemId));
      if (items.size >= cfg.bulk.minItems) for (const e of list.slice(j, i + 1)) bulkIds.add(e.eventId);
    }
  }
  const windows = (cfg.ignoreEventWindows ?? []).map((w) => ({ board: w.board, from: Date.parse(w.from), to: Date.parse(w.to) }));
  return events.map((e) => {
    const inWindow = windows.some((w) => w.board === e.boardKey && e.atMs >= w.from && e.atMs < w.to);
    return e.bulk || inWindow || bulkIds.has(e.eventId) ? { ...e, bulk: true } : e;
  });
}
