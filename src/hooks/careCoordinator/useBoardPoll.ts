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

/**
 * The last good result of each keyed read, for the life of the TAB.
 *
 * ⚠️ **THIS IS WHY GOING TO A PATIENT AND BACK IS NOT A SECOND WAIT** (Brandon,
 * 2026-09-17: *"Any way to increase load speed of patient intake list? When you
 * go to a profile, then back, it takes a bit to load each time."*). It was not
 * slowness in the read so much as the read starting from nothing every time:
 * this page unmounts when the coordinator opens a chart, so coming back mounted
 * a fresh hook with `data: null` and re-ran Patient Intake's ~1,754 rows — four
 * sequential Monday pages — behind a skeleton, several times an hour, for rows
 * that had not moved.
 *
 * Seeded synchronously on mount, so the columns are on screen in the first
 * paint, and refreshed in the background immediately after. The coordinator
 * sees the list she left, then it updates in place.
 *
 * ⚠️ **IN MEMORY, NEVER localStorage.** §5.25 records what putting a board
 * queue in localStorage costs: 4–8 MB of patients against a ~5 MB quota, so
 * `persistPatientCache` swallowed a `QuotaExceededError` and the cache was
 * silently dead for weeks. A reload is a fresh read, which is the correct
 * behaviour anyway — this only ever short-circuits a navigation inside one tab.
 *
 * ⚠️ Keyed by `totalKey`, so a read with no key opts out entirely rather than
 * sharing a bucket with an unrelated one.
 */
const lastGood = new Map<string, { data: unknown; at: number }>();

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
  /**
   * Re-read now, and RESOLVE when that read settles.
   *
   * ⚠️ The promise is the point: `loading` above is "until the FIRST read
   * settles", so a caller that drove a spinner off it would show nothing at all
   * for a Refresh the coordinator pressed — and a button that looks like it did
   * nothing gets pressed again. Coalesced, so it resolves with whatever read is
   * already in flight rather than starting a second pass over 1,700 rows.
   */
  refetch: () => Promise<void>;
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
  // ⚠️ Read ONCE, in a lazy initialiser, not on every render: the seed decides
  // the first paint and nothing after it, and re-reading the map mid-session
  // would let a background refresh land twice.
  const seed = useRef(totalKey ? lastGood.get(totalKey) : undefined).current;

  const [data, setData] = useState<T | null>((seed?.data as T | undefined) ?? null);
  // A seeded hook is NOT loading — there is something real on screen. This is
  // what stops the skeleton flashing over a list the coordinator can already
  // read.
  const [loading, setLoading] = useState(!seed);
  const [error, setError] = useState<string | null>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(seed?.at ?? null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  /**
   * ⚠️ A background poll shows NOTHING. The bar exists for the first load and
   * for a Refresh the coordinator pressed — a bar reappearing every 60s on a
   * page somebody reads all day is the noise that teaches people to ignore it
   * (§5.28's naming-progress rule, same reason). `visible` is a ref because it
   * is read inside `run` without re-arming the interval.
   */
  // Seeded ⇒ the first run is a background refresh, so it draws no load bar:
  // a progress bar over a list that is already on screen is the noise §5.28's
  // naming-progress rule exists to avoid.
  const visible = useRef(!seed);
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
        const at = Date.now();
        setLastOkAt(at);
        // ⚠️ Cached only after a run that COMPLETED, for the same reason the
        // remembered total is: `fetchGroup` throws rather than returning the
        // pages it got (see mondayApi.ts), so a half-read never reaches here —
        // and a truncated list seeded into the next mount would read as
        // "those patients are done".
        if (totalKey) lastGood.set(totalKey, { data: next, at });
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
    refetch: () => { visible.current = true; return run() ?? Promise.resolve(); },
  };
}
