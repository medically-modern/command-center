/**
 * Pure snapshot builder: items + events -> holder spans + journeys (BUILD-SPEC §3.2, §4.1).
 * Same input always gives the same output; metrics read only the result.
 */
import type { Dict } from "../types";
import type { AccessView, BoardKey, CommsSla, FaxData, FetchError, HolderSpan, ItemRow, PipelineBoard, RawEvent, Snapshot } from "../types";
import { OO_CONFIG } from "../config";
import { buildItemSpans } from "./holders";
import { buildJourneys } from "./journeys";
import { markBulk } from "../data/parseEvent";

export interface SnapshotInput {
  snapshotAt: number; items: ItemRow[]; events: RawEvent[]; access: AccessView | null; commsSla: CommsSla | null;
  fax: FaxData | null; excludedIntCounts: { total: number; escalated: number } | null; cursors: Partial<Record<BoardKey, number>>;
  fetchErrors: FetchError[]; mode: string; groupHistoryStartMs?: number; parseDropsTotal?: number; itemsAt?: Partial<Record<BoardKey, number>>;
}

export interface SnapshotExtras { historyMismatchItems: string[]; deletedEventItems: string[]; deletedWhileParked: string[]; parseDropsTotal: number; itemsAt: Partial<Record<BoardKey, number>> }

export function buildSnapshot(input: SnapshotInput, cfg = OO_CONFIG): Snapshot & { extras: SnapshotExtras } {
  const events = markBulk(dedupe(input.events), cfg);
  const pipeline: PipelineBoard[] = ["INT", "MN", "INS", "WC"];
  const itemsByKey = new Map<string, ItemRow>();
  for (const it of input.items) itemsByKey.set(`${it.boardKey}:${it.itemId}`, it);
  const evByItem = new Map<string, RawEvent[]>();
  for (const e of events) { const k = `${e.boardKey}:${e.itemId}`; (evByItem.get(k) ?? evByItem.set(k, []).get(k)!).push(e); }
  const spans: HolderSpan[] = [];
  const historyMismatchItems: string[] = [];
  for (const it of input.items) {
    if (!pipeline.includes(it.boardKey as PipelineBoard)) continue;
    const r = buildItemSpans(it.boardKey as PipelineBoard, it, evByItem.get(`${it.boardKey}:${it.itemId}`) ?? [], input.snapshotAt, cfg, input.groupHistoryStartMs);
    spans.push(...r.spans);
    if (r.historyMismatch) historyMismatchItems.push(`${it.boardKey}:${it.itemId}`);
  }
  // R4: events for items no longer present.
  const deletedEventItems: string[] = []; const deletedWhileParked: string[] = [];
  for (const [k, evs] of evByItem) {
    if (itemsByKey.has(k)) continue;
    const board = k.split(":")[0] as BoardKey;
    // INT items in excluded groups are never fetched (DH-08), so their absence is not a deletion (review A-3).
    if (!pipeline.includes(board as PipelineBoard) || board === "INT") continue;
    evs.sort((a, b) => a.atMs - b.atMs || a.eventId.localeCompare(b.eventId));
    deletedEventItems.push(k);
    const lastEsc = [...evs].reverse().find((e) => e.columnId === (cfg.escalationColumn as Dict)[board]);
    const lastStage = [...evs].reverse().find((e) => e.columnId === (cfg.stageColumn as Dict)[board]);
    if ((lastEsc && [0, 2].includes(lastEsc.toIndex ?? -1)) || (lastStage && ((cfg.stuckLabels as Dict)[board] ?? []).includes(lastStage.toIndex))) deletedWhileParked.push(k);
  }
  return {
    schemaVersion: cfg.schemaVersion, snapshotAt: input.snapshotAt, items: input.items, events, spans,
    journeys: buildJourneys(input.items, events, cfg), access: input.access, commsSla: input.commsSla, fax: input.fax,
    excludedIntCounts: input.excludedIntCounts, cursors: input.cursors, fetchErrors: input.fetchErrors, mode: input.mode,
    extras: { historyMismatchItems, deletedEventItems, deletedWhileParked, parseDropsTotal: input.parseDropsTotal ?? 0, itemsAt: input.itemsAt ?? {} },
  };
}

function dedupe(events: RawEvent[]): RawEvent[] {
  const seen = new Set<string>(); const out: RawEvent[] = [];
  for (const e of events) { const k = `${e.boardKey}:${e.eventId}`; if (!seen.has(k)) { seen.add(k); out.push(e); } }
  return out;
}
export type FullSnapshot = ReturnType<typeof buildSnapshot>;
