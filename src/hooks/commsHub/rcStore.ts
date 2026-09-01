/**
 * A shared, TTL'd, self-throttling store for one RingCentral read.
 *
 * The Communications Hub has three lists that each poll RingCentral — texts,
 * calls, voicemails, faxes — and writing that loop four times is how one of
 * them ends up without a guard. So the loop is written once, here, to the
 * rules INCIDENT_2026-08-20_RINGCENTRAL.md §8 bought:
 *
 * 1. **One request set per store, shared by every consumer.** The state lives
 *    at module scope inside the closure; a single `inflight` promise coalesces
 *    simultaneous mounts.
 * 2. **A stable snapshot reference.** `useSyncExternalStore` returns the
 *    module snapshot, whose identity changes only when the data does, so a
 *    caller listing it in a dep array cannot spin (rule 2).
 * 3. **Nothing fire-and-forget in a render-driven effect.** The hook's effect
 *    depends on `enabled` alone — a boolean, which cannot change identity —
 *    and every path through `refresh` returns early unless the TTL expired.
 *
 * A failure is deliberately quiet and backs off exactly as far as a success
 * would: a failing RingCentral must never be retried faster than a working one.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { RC_VIA_GATEWAY } from "@/lib/fax/ringcentralApi";

export interface RcStoreState<T> {
  /** Null until the first load lands. */
  data: T | null;
  loading: boolean;
  error: string | null;
  /** When the data was last read, for a "just now" caption. */
  fetchedAt: number;
}

export interface RcStoreHook<T> extends RcStoreState<T> {
  /** Read again now, ignoring the TTL. What a Refresh button calls. */
  reload: () => void;
}

export function createRcStore<T>(load: () => Promise<T>, ttlMs: number) {
  const EMPTY: RcStoreState<T> = { data: null, loading: false, error: null, fetchedAt: 0 };
  let snapshot: RcStoreState<T> = EMPTY;
  let inflight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const emit = (next: RcStoreState<T>) => {
    snapshot = next;
    for (const l of listeners) l();
  };
  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  };
  const getSnapshot = () => snapshot;

  function refresh(force = false): Promise<void> {
    if (!RC_VIA_GATEWAY) return Promise.resolve();
    if (inflight) return inflight;
    if (!force && Date.now() - snapshot.fetchedAt < ttlMs) return Promise.resolve();
    // A hidden tab skips its polls; the visibility listener below picks it up
    // the moment somebody looks again. A forced reload is a human asking, so
    // it runs regardless.
    if (!force && typeof document !== "undefined" && document.hidden) return Promise.resolve();

    emit({ ...snapshot, loading: true });
    inflight = load()
      .then((data) => emit({ data, loading: false, error: null, fetchedAt: Date.now() }))
      .catch((e: unknown) =>
        emit({
          data: snapshot.data,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
          fetchedAt: Date.now(),
        }),
      )
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  function useStore(enabled = true): RcStoreHook<T> {
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    useEffect(() => {
      if (!enabled) return;
      void refresh();
      const id = setInterval(() => void refresh(), ttlMs);
      const onVisible = () => {
        if (!document.hidden) void refresh();
      };
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        clearInterval(id);
        document.removeEventListener("visibilitychange", onVisible);
      };
      // `enabled` is a boolean, so it cannot change identity between renders.
    }, [enabled]);

    const reload = useCallback(() => void refresh(true), []);
    // Memoised on the snapshot, so the returned object is stable exactly as
    // long as the data is — rule 2 again, this time for the wrapper.
    return useMemo(() => ({ ...state, reload }), [state, reload]);
  }

  return { useStore, refresh, reset: () => emit(EMPTY) };
}
