/**
 * useInfusionStock — ONE shared read of the Cardinal SKU Tracker.
 *
 * Every infusion-set slot on the Welcome Call form wants a stock pill; the
 * FETCH deliberately is not per slot, per set or per patient. Built to
 * INCIDENT_2026-08-20's rules, the same as `useFaxOutcomes`:
 *
 * 1. **One request set, shared by every consumer.** The store is at module
 *    scope, so N mounted pills cost what one costs, and a single `inflight`
 *    promise coalesces simultaneous mounts.
 * 2. **The returned value is a stable reference** — `useSyncExternalStore`
 *    hands back the module snapshot, whose identity changes only when the data
 *    does, so a caller listing it in a dep array cannot spin.
 * 3. **Nothing is fire-and-forget in a render-driven effect** — the only effect
 *    runs on mount with `[]` deps and `refresh()` returns early unless the TTL
 *    has genuinely expired.
 *
 * The TTL is long on purpose: the tracker is scraped ONCE A DAY by a cron, so
 * a shorter window would spend requests to re-read a number that cannot have
 * moved. `STOCK_STALE_DAYS` in the rules is what protects against a scraper
 * that has actually stopped.
 *
 * A failure is silent — no toast, no retry storm. `index` stays null and the
 * pills simply don't render, which is what the form showed before they existed.
 * ⚠️ It must stay NULL rather than becoming an empty Map: an empty index reads
 * as "No stock data" on every set, which looks like a working feature
 * reporting bad news.
 */
import { useEffect, useSyncExternalStore } from "react";
import { fetchInfusionStock } from "@/lib/welcomeCall/stockApi";
import { indexStock, type StockRow } from "@/lib/welcomeCall/infusionStock";

export interface InfusionStockState {
  /** Join key → tracker row. Null until a load has actually succeeded. */
  index: Map<string, StockRow> | null;
  loading: boolean;
  error: string | null;
}

/** Scraped daily, so half an hour is already far tighter than the signal. */
const TTL_MS = 30 * 60_000;

const EMPTY: InfusionStockState = { index: null, loading: false, error: null };

let snapshot: InfusionStockState = EMPTY;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: InfusionStockState) {
  snapshot = next;
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): InfusionStockState {
  return snapshot;
}

function refresh(): Promise<void> {
  if (inflight) return inflight;
  if (Date.now() - fetchedAt < TTL_MS) return Promise.resolve();
  if (typeof document !== "undefined" && document.hidden) return Promise.resolve();

  emit({ ...snapshot, loading: true });
  inflight = fetchInfusionStock()
    .then((rows) => {
      fetchedAt = Date.now();
      emit({ index: indexStock(rows), loading: false, error: null });
    })
    .catch((e: unknown) => {
      // Back off exactly as far as a success would: a failing board must not be
      // retried faster than a working one. The previous index is KEPT — a
      // half-hour-old answer beats blanking every pill on one 503 (§9 records
      // ten Monday failures in a single day).
      fetchedAt = Date.now();
      emit({
        index: snapshot.index,
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useInfusionStock(): InfusionStockState {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    void refresh();
  }, []);
  return state;
}
