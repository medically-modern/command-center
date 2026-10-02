/**
 * Shared metric context: the period window, filters, and fast lookups over the snapshot.
 * Every metric function takes (snapshot, config, query) and uses only this (BUILD-SPEC §3.1).
 */
import type { Dict } from "../types";
import type { HolderSpan, ItemRow, Journey, MetricQuery, PipelineBoard } from "../types";
import type { FullSnapshot } from "../model/buildSnapshot";
import { OO_CONFIG } from "../config";
import { businessHoursBetween, etDateKey } from "../time/businessTime";

export type Cfg = typeof OO_CONFIG;

export interface Ctx {
  snap: FullSnapshot; cfg: Cfg; q: MetricQuery;
  now: number; start: number; priorStart: number;
  bh: (a: number, b: number) => number;
  allowed: (it: { boardKey: string; itemId: string }) => boolean;
  itemByKey: Map<string, ItemRow>;
  spansByItem: Map<string, HolderSpan[]>;
  current: Map<string, HolderSpan>;
  journeys: Journey[];
  filtersOn: boolean;
  todayEt: string;
  duplicateKeys: Set<string>;
}

export const key = (b: string, id: string) => `${b}:${id}`;

const cache = new WeakMap<object, Map<string, Ctx>>();
export function ctxFor(snap: FullSnapshot, q: MetricQuery, cfg: Cfg = OO_CONFIG): Ctx {
  const ck = JSON.stringify(q);
  const m = cache.get(snap) ?? new Map<string, Ctx>(); cache.set(snap, m);
  const hit = m.get(ck); if (hit) return hit;
  const now = snap.snapshotAt; const day = 86400000;
  const itemByKey = new Map(snap.items.map((i) => [key(i.boardKey, i.itemId), i]));
  const spansByItem = new Map<string, HolderSpan[]>();
  for (const s of snap.spans) { const k = key(s.boardKey, s.itemId); (spansByItem.get(k) ?? spansByItem.set(k, []).get(k)!).push(s); }
  const current = new Map<string, HolderSpan>();
  for (const [k, list] of spansByItem) current.set(k, list[list.length - 1]);
  const f = q.filters ?? {};
  const filtersOn = !!(f.referralSource?.length || f.expeditedOnly);
  const journeys = snap.journeys.filter((j) => (!f.referralSource?.length || f.referralSource.includes(j.referralSource ?? "unknown")) && (!f.expeditedOnly || j.expedited));
  const allowedKeys = new Set<string>();
  if (filtersOn) for (const j of journeys) { for (const it of Object.values(j.primary)) if (it) allowedKeys.add(key(it.boardKey, it.itemId)); for (const d of j.duplicates) allowedKeys.add(key(d.boardKey, d.itemId)); }
  const holidays = [...cfg.holidays];
  const c: Ctx = { snap, cfg, q, now, start: now - q.periodDays * day, priorStart: now - 2 * q.periodDays * day,
    bh: (a, b) => businessHoursBetween(a, b, holidays, cfg.clock), allowed: (it) => !filtersOn || allowedKeys.has(key(it.boardKey, it.itemId)),
    itemByKey, spansByItem, current, journeys, filtersOn, todayEt: etDateKey(now),
    duplicateKeys: new Set(snap.journeys.flatMap((j) => j.duplicates.map((d) => key(d.boardKey, d.itemId)))) };
  m.set(ck, c); return c;
}

export const PIPELINE: PipelineBoard[] = ["INT", "MN", "INS", "WC"];
export const isPipeline = (b: string): b is PipelineBoard => (PIPELINE as string[]).includes(b);

/** Current item is in an in-pipeline group (INT excludes partial leads etc.). */
export function inPipelineGroup(c: Ctx, it: ItemRow): boolean {
  const g = (c.cfg.groups as Dict)[it.boardKey];
  return !g || g.inPipeline.includes(it.groupId);
}

/** Snooze per CC queue rules keyed by stage label (§3.6 A-01). */
export function isSnoozed(c: Ctx, it: ItemRow): boolean {
  const rules: Dict = (c.cfg.snooze as Dict)[it.boardKey];
  if (!rules) return false;
  const stage = it.values[(c.cfg.stageColumn as Dict)[it.boardKey]]?.index;
  const rule = stage != null ? rules.byLabel[stage] : undefined;
  if (!rule || rule === "never") return false;
  const date = it.values[rules.dateCol]?.date ?? null;
  const after = !!date && date > c.todayEt;
  if (rule === "dateAfterToday") return after;
  const status = it.values[rules.statusCol]?.index;
  return status === rules.followUpLabel && (!date || after);
}

export function spanBh(c: Ctx, s: HolderSpan): number { return c.bh(s.startMs, s.endMs ?? c.now); }

/** Speed metrics use only primary items outside import windows (R8, §3.1). */
export function speedEligible(c: Ctx, it: ItemRow): boolean {
  if (c.cfg.importWindows.some((w) => w.board === it.boardKey && it.createdAtMs >= Date.parse(w.from) && it.createdAtMs < Date.parse(w.to))) return false;
  return !c.duplicateKeys.has(key(it.boardKey, it.itemId));
}

/** Largest possible age of an item (since creation): the honest bound for a synthetic span. */
export const maxAgeBd = (c: Ctx, k: string) => { const it = c.itemByKey.get(k); return it ? c.bh(it.createdAtMs, c.now) / 24 : null; };
