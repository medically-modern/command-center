/**
 * useSkuTracker — ONE shared read of the Cardinal SKU Tracker, full rows.
 *
 * The structural twin of `useInfusionStock` (§5.31b), which reads three
 * columns of the same board for the Welcome Call pills; this one carries the
 * whole row for the Orders page. Same guards, because the reasons are the
 * same (INCIDENT_2026-08-20):
 *   1. one module-scope store, one coalescing `inflight`;
 *   2. a stable snapshot identity via `useSyncExternalStore`;
 *   3. a 30-minute TTL against a scraper that runs once a day at 9:05 ET;
 *   4. a failure KEEPS the previous rows and never caches an empty answer —
 *      an empty table reads as "nothing is tracked", which is a lie.
 */
import { useEffect, useSyncExternalStore } from "react";
import { fetchSkuTracker, isRunLogRow, type SkuTrackerRow } from "@/lib/orders/skuTrackerApi";

export interface SkuTrackerState {
  /** Every row, run-log row included. Null until a load has succeeded. */
  rows: SkuTrackerRow[] | null;
  loading: boolean;
  error: string | null;
  fetchedAt: number | null;
}

const TTL_MS = 30 * 60_000;
const EMPTY: SkuTrackerState = { rows: null, loading: false, error: null, fetchedAt: null };

let snapshot: SkuTrackerState = EMPTY;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: SkuTrackerState) {
  snapshot = next;
  for (const l of listeners) l();
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function getSnapshot(): SkuTrackerState {
  return snapshot;
}

/** Test seam. */
export function resetSkuTrackerStore(): void {
  snapshot = EMPTY;
  fetchedAt = 0;
  inflight = null;
}

export function refreshSkuTracker(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && Date.now() - fetchedAt < TTL_MS) return Promise.resolve();
  if (!force && typeof document !== "undefined" && document.hidden) return Promise.resolve();

  emit({ ...snapshot, loading: true });
  inflight = fetchSkuTracker()
    .then((rows) => {
      fetchedAt = Date.now();
      emit({ rows, loading: false, error: null, fetchedAt });
    })
    .catch((e: unknown) => {
      // Back off as far as a success would; keep what we had.
      fetchedAt = Date.now();
      emit({ ...snapshot, loading: false, error: e instanceof Error ? e.message : String(e) });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useSkuTracker(): SkuTrackerState {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    void refreshSkuTracker();
  }, []);
  return state;
}

/** The tracker's own "Last run: …" headline, from the Run Log row's name. */
export function skuTrackerLastRun(rows: readonly SkuTrackerRow[] | null): string {
  const log = rows?.find(isRunLogRow);
  return log?.name?.trim() ?? "";
}
