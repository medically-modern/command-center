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

import {
  emptyProgress, recallTotal, rememberTotal, type LoadProgress,
} from "@/lib/careCoordinator/loadProgress";

export interface BoardPoll<T> {
  data: T | null;
  /** True until the FIRST read settles; later polls are silent. */
  loading: boolean;
  /** Message of the last failed read, or null when the last read succeeded. */
  error: string | null;
  /** Epoch ms of the last successful read, or null. */
  lastOkAt: number | null;
  /**
   * How far the read in flight has got. `null` whenever nothing should be
   * SHOWN — see `visible` below; the bar renders straight off this.
   */
  progress: LoadProgress | null;
  refetch: () => void;
}

/**
 * @param totalKey  Identifies this column's remembered row total, so a
 *   percentage survives a reload. Omit and the bar stays honest but
 *   indeterminate — it will never invent one.
 */
export function useBoardPoll<T>(
  fetcher: (onPage?: (rows: number) => void) => Promise<T>,
  intervalMs: number,
  totalKey?: string,
): BoardPoll<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  /**
   * ⚠️ A background poll shows NOTHING. The bar exists for the first load and
   * for a Refresh the coordinator pressed — a bar reappearing every 60s on a
   * page somebody reads all day is the noise that teaches people to ignore it
   * (§5.28's naming-progress rule, same reason). `visible` is a ref because it
   * is read inside `run` without re-arming the interval.
   */
  const visible = useRef(true);
  // Coalesce: a Refresh click while a poll is in flight must not start a
  // second read of a 1,700-row group.
  const inflight = useRef<Promise<void> | null>(null);
  const alive = useRef(true);

  const run = useCallback(() => {
    if (inflight.current) return inflight.current;

    const show = visible.current;
    // Snapshot the remembered total ONCE per run, so the denominator can't
    // move under the bar mid-load.
    let live = emptyProgress(totalKey ? recallTotal(totalKey) : null);
    if (show) setProgress(live);

    inflight.current = (async () => {
      try {
        const next = await fetcher((rows) => {
          if (!alive.current) return;
          // Accumulate only: the intake read runs three groups in parallel and
          // their pages interleave, so a report is "N more rows", never a
          // position.
          live = { ...live, loaded: live.loaded + rows, pages: live.pages + 1 };
          if (show) setProgress(live);
        });
        if (!alive.current) return;
        setData(next);
        setError(null);
        setLastOkAt(Date.now());
        // ⚠️ Remembered ONLY here — after a run that completed. A total kept
        // from a failed or half-finished read would park every later bar at
        // "100%" with rows still arriving.
        if (totalKey && live.loaded > 0) rememberTotal(totalKey, live.loaded);
        if (show) setProgress({ ...live, done: true });
      } catch (e) {
        if (!alive.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        inflight.current = null;
        if (alive.current) {
          setLoading(false);
          // Whatever happened, the bar stops claiming a read is in flight.
          setProgress(null);
          visible.current = false;
        }
      }
    })();
    return inflight.current;
  }, [fetcher, totalKey]);

  useEffect(() => {
    alive.current = true;
    void run();
    const id = setInterval(() => void run(), intervalMs);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [run, intervalMs]);

  return {
    data, loading, error, lastOkAt, progress,
    // A Refresh the coordinator pressed is worth showing; the 60s tick is not.
    refetch: () => { visible.current = true; void run(); },
  };
}
