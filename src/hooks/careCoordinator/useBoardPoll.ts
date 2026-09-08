/**
 * One polled read, with the shape every queue hook in the app exposes:
 * `{ data, loading, error, refetch }`, where `error` is set by a failed poll
 * and cleared by the next good one — so `StaleDataNotice` can sit under the
 * header and say so (§9: "a failed READ is invisible unless a page says so").
 *
 * The dashboard mounts three of these, one per board, because the three reads
 * fail independently and the notice has to name WHICH column is stale.
 *
 * ⚠️ `fetcher` must be referentially stable (a module-level function), or the
 * effect below re-arms on every render — INCIDENT_2026-08-20 rule 2.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface BoardPoll<T> {
  data: T | null;
  /** True until the FIRST read settles; later polls are silent. */
  loading: boolean;
  /** Message of the last failed read, or null when the last read succeeded. */
  error: string | null;
  /** Epoch ms of the last successful read, or null. */
  lastOkAt: number | null;
  refetch: () => void;
}

export function useBoardPoll<T>(fetcher: () => Promise<T>, intervalMs: number): BoardPoll<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  // Coalesce: a Refresh click while a poll is in flight must not start a
  // second read of a 1,700-row group.
  const inflight = useRef<Promise<void> | null>(null);
  const alive = useRef(true);

  const run = useCallback(() => {
    if (inflight.current) return inflight.current;
    inflight.current = (async () => {
      try {
        const next = await fetcher();
        if (!alive.current) return;
        setData(next);
        setError(null);
        setLastOkAt(Date.now());
      } catch (e) {
        if (!alive.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        inflight.current = null;
        if (alive.current) setLoading(false);
      }
    })();
    return inflight.current;
  }, [fetcher]);

  useEffect(() => {
    alive.current = true;
    void run();
    const id = setInterval(() => void run(), intervalMs);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [run, intervalMs]);

  return { data, loading, error, lastOkAt, refetch: () => void run() };
}
