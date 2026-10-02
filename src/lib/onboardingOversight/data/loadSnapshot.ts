/**
 * Orchestrates cache + fetch + build (BUILD-SPEC §5.2): paint from cache, then items-only,
 * then history. Per-board cursors only advance after every page of that board succeeded,
 * so a failed board is retried next refresh instead of silently losing events.
 */
import type { Dict } from "../types";
import type { AccessView, BoardKey, FaxData, FetchError, ItemRow, RawEvent } from "../types";
import { OO_CONFIG } from "../config";
import { fetchBoardItems, fetchExcludedIntCounts } from "./fetchItems";
import { fetchEscClasses } from "../v2/escClass";
import { fetchColumnEvents, fetchGroupMoves, parseDrops } from "./fetchActivity";
import { fetchFax } from "./fetchFax";
import { fetchCommsSla } from "./fetchCommsSla";
import { cacheKey, defaultKV, type KV } from "./cache";
import { buildSnapshot, type FullSnapshot } from "../model/buildSnapshot";
import { MONDAY_VIA_GATEWAY } from "@/lib/shared/mondayEndpoint";

export interface CacheBlob { schemaVersion: number; events: RawEvent[]; items: ItemRow[]; cursors: Partial<Record<BoardKey, number>>; groupCursors: Partial<Record<BoardKey, number>>; fax: FaxData | null; faxAt: number; snapshotAt: number;
  /** Fixed at the first cold group-move fetch; kept on warm loads (review A-1). */ groupHistoryStartMs?: number;
  /** Cumulative unparsed activity rows (review N1): stays until Reset cache. */ parseDropsTotal?: number;
  /** When each board's items were last fetched successfully (review N1). */ itemsAt?: Partial<Record<BoardKey, number>> }
export type LoadPhase = "cache" | "items" | "history" | "done";
export interface LoadProgress { phase: LoadPhase; message: string }

type Board4 = "INT" | "MN" | "INS" | "WC";
const BOARDS: Board4[] = ["MN", "INS", "WC", "INT"];

async function limited<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }));
  return out;
}

export async function readCache(kv: KV = defaultKV): Promise<CacheBlob | null> {
  const b = await kv.get(cacheKey());
  return b && b.schemaVersion === OO_CONFIG.schemaVersion ? (b as CacheBlob) : null;
}
export async function resetCache(kv: KV = defaultKV) { await kv.del(cacheKey()); }

export function snapshotFromCache(c: CacheBlob, access: AccessView | null): FullSnapshot {
  return buildSnapshot({ snapshotAt: c.snapshotAt, items: c.items, events: c.events, access, commsSla: null, fax: c.fax, excludedIntCounts: null,
    cursors: c.cursors, fetchErrors: [], mode: MONDAY_VIA_GATEWAY ? "gateway" : "direct", groupHistoryStartMs: c.groupHistoryStartMs, parseDropsTotal: c.parseDropsTotal, itemsAt: c.itemsAt });
}

/**
 * Full refresh. Calls onPartial with an items-only snapshot first (cold loads), then returns the full one.
 */
/** Fetchers are injectable so the loader's cursor and cache rules can be tested without a network. */
export interface LoaderDeps {
  fetchBoardItems: typeof fetchBoardItems; fetchExcludedIntCounts: typeof fetchExcludedIntCounts; fetchColumnEvents: typeof fetchColumnEvents;
  fetchGroupMoves: typeof fetchGroupMoves; fetchFax: typeof fetchFax; fetchCommsSla: typeof fetchCommsSla;
  /** optional so existing injected deps (tests) keep working; absent = no live classification */
  fetchEscClasses?: typeof fetchEscClasses;
}
const DEFAULT_DEPS: LoaderDeps = { fetchBoardItems, fetchExcludedIntCounts, fetchColumnEvents, fetchGroupMoves, fetchFax, fetchCommsSla, fetchEscClasses };
/** Bumped by a cache reset: an in-flight refresh started before the reset must not write its stale blob back. */
let generation = 0;
export const bumpGeneration = () => ++generation;

export async function refreshSnapshot(opts: { access: AccessView | null; periodDays: number; kv?: KV; onProgress?: (p: LoadProgress) => void; onPartial?: (s: FullSnapshot) => void; now?: number; deps?: Partial<LoaderDeps> }): Promise<FullSnapshot> {
  const kv = opts.kv ?? defaultKV;
  const deps = { ...DEFAULT_DEPS, ...(opts.deps ?? {}) };
  const myGen = generation;
  for (const k of Object.keys(parseDrops)) delete parseDrops[k];
  const refreshStartMs = opts.now ?? Date.now();
  const cache = await readCache(kv);
  const errors: FetchError[] = [];
  const say = (phase: LoadPhase, message: string) => opts.onProgress?.({ phase, message });
  const mode = MONDAY_VIA_GATEWAY ? "gateway" : "direct";

  say("items", "Loading current items…");
  const itemTasks: (() => Promise<ItemRow[]>)[] = [
    () => deps.fetchBoardItems("INT", [...OO_CONFIG.groups.INT.inPipeline]),
    () => deps.fetchBoardItems("MN"), () => deps.fetchBoardItems("INS"), () => deps.fetchBoardItems("WC"), () => deps.fetchBoardItems("SUB"),
  ];
  const itemResults = await limited(itemTasks.map((t, i) => async () => {
    try { return await t(); } catch (e: unknown) { errors.push({ board: (["INT", "MN", "INS", "WC", "SUB"] as BoardKey[])[i], message: String((e as Error)?.message ?? e), atMs: Date.now() }); return null; }
  }), OO_CONFIG.maxConcurrentBoards);
  // A board whose item fetch failed keeps its cached items (shown with the partial state).
  const items: ItemRow[] = []; const itemsAt: Partial<Record<BoardKey, number>> = { ...(cache?.itemsAt ?? {}) };
  (["INT", "MN", "INS", "WC", "SUB"] as BoardKey[]).forEach((b, i) => { if (itemResults[i]) itemsAt[b] = refreshStartMs; items.push(...(itemResults[i] ?? (cache?.items.filter((x) => x.boardKey === b) ?? []))); });
  const groupHistoryStartMs = cache?.groupHistoryStartMs ?? Math.max(Date.parse(OO_CONFIG.historyStart), refreshStartMs - OO_CONFIG.groupMoves.lookbackDays * 86400000);
  // Two kinds of escalation, live (CR-17): read the notes stamp for escalated items only; keep one word per item.
  // A failure leaves those items Unclassified and is reported (the header labels it), never guessed.
  for (const b of ["INT", "MN", "INS", "WC"] as const) {
    if (!itemResults[(["INT", "MN", "INS", "WC", "SUB"] as BoardKey[]).indexOf(b)]) continue; // cached items keep their cached class
    if (!deps.fetchEscClasses) break;
    try { const cls = await deps.fetchEscClasses(b, items); for (const it of items) if (it.boardKey === b && cls[it.itemId]) it.escClass = cls[it.itemId]; }
    catch (e: unknown) { errors.push({ board: b, message: `escalation kinds unavailable: ${String((e as Error)?.message ?? e)}`, atMs: Date.now() }); }
  }
  let excluded: { total: number; escalated: number } | null = null;
  try { excluded = await deps.fetchExcludedIntCounts(); } catch { excluded = null; }

  const prevEvents = cache?.events ?? [];
  if (!cache) opts.onPartial?.(buildSnapshot({ snapshotAt: refreshStartMs, items, events: [], access: opts.access, commsSla: null, fax: null,
    excludedIntCounts: excluded, cursors: {}, fetchErrors: errors, mode }));

  const cursors = { ...(cache?.cursors ?? {}) }; const groupCursors = { ...(cache?.groupCursors ?? {}) };
  const newEvents: RawEvent[] = [];
  const histStart = Date.parse(OO_CONFIG.historyStart);
  await limited(BOARDS.map((b) => async () => {
    try {
      const from = cursors[b] != null ? cursors[b]! - 15 * 60_000 : histStart;
      const evs = await deps.fetchColumnEvents(b, from, refreshStartMs, (n) => say("history", `Loading history: ${b} page ${n}`));
      newEvents.push(...evs); cursors[b] = refreshStartMs; // committed only after all pages succeeded
    } catch (e: unknown) { errors.push({ board: b, message: String((e as Error)?.message ?? e), atMs: Date.now() }); }
    try {
      const gFrom = groupCursors[b] != null ? groupCursors[b]! - 15 * 60_000 : groupHistoryStartMs;
      newEvents.push(...(await deps.fetchGroupMoves(b, gFrom, refreshStartMs))); groupCursors[b] = refreshStartMs;
    } catch (e: unknown) { errors.push({ board: b, message: `group moves: ${String((e as Error)?.message ?? e)}`, atMs: Date.now() }); }
  }), OO_CONFIG.maxConcurrentBoards);

  let fax = cache?.fax ?? null; let faxAt = cache?.faxAt ?? 0;
  if (refreshStartMs - faxAt > OO_CONFIG.faxRefreshMs) {
    try { fax = await deps.fetchFax(refreshStartMs); faxAt = refreshStartMs; } catch (e: unknown) { errors.push({ board: "FAX", message: String((e as Error)?.message ?? e), atMs: Date.now() }); }
  }
  let commsSla = null;
  try { commsSla = await deps.fetchCommsSla(opts.periodDays); } catch (e: unknown) { errors.push({ board: "COMMS", message: String((e as Error)?.message ?? e), atMs: Date.now() }); }

  const seen = new Set<string>(); const events: RawEvent[] = [];
  // Freshly parsed copies win over cached ones.
  for (const e of [...newEvents, ...prevEvents]) { const k = `${e.boardKey}:${e.eventId}`; if (!seen.has(k)) { seen.add(k); events.push(e); } }
  const parseDropsTotal = (cache?.parseDropsTotal ?? 0) + Object.values(parseDrops).reduce((a, n) => a + (n ?? 0), 0);
  const blob: CacheBlob = { schemaVersion: OO_CONFIG.schemaVersion, events, items, cursors, groupCursors, fax, faxAt, snapshotAt: refreshStartMs, groupHistoryStartMs, parseDropsTotal, itemsAt };
  if (myGen === generation) await kv.set(cacheKey(), blob); // a reset happened mid-refresh: do not resurrect the old cache
  say("done", "Up to date");
  return buildSnapshot({ snapshotAt: refreshStartMs, items, events, access: opts.access, commsSla, fax, excludedIntCounts: excluded, cursors, fetchErrors: errors, mode, groupHistoryStartMs, parseDropsTotal, itemsAt });
}
