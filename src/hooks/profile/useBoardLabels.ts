// React binding for `lib/profile/boardLabels` — live status labels for the
// Profile Send Off pickers.
//
// WHY THIS IS A HOOK AND NOT A `useEffect` PER PAGE: two pages draw these
// dropdowns, and the refresh rules below are what make "a label added on Monday
// shows up in the Command Center" true rather than nearly true. Duplicated
// across two pages they would drift, and the drift is invisible — a picker
// silently one label short is the failure mode this whole module exists to fix.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchBoardLabels,
  toLiveIndex,
  BOARD_LABELS_TTL_MS,
  type LiveLabels,
} from "@/lib/profile/boardLabels";

export interface UseBoardLabelsResult {
  /** Per column id. A column is ABSENT until it loads — callers fall back to
   *  their hardcoded list for anything not in here. */
  labels: Record<string, LiveLabels>;
  /** The write half: label → index, per column. Hand this to the write paths. */
  index: Record<string, Record<string, number>>;
  /** Options for one picker: the board's list if we have it, the caller's
   *  hardcoded list if we don't. Never an empty select. */
  optionsFor: (columnId: string, fallback: string[]) => string[];
}

export function useBoardLabels(columnIds: string[]): UseBoardLabelsResult {
  // Join the ids so the effect doesn't re-run on every render from a fresh
  // array literal at the call site.
  const idsKey = columnIds.join(",");
  const [labels, setLabels] = useState<Record<string, LiveLabels>>({});
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    if (ids.length === 0) return;
    let cancelled = false;

    const run = () => {
      fetchBoardLabels(ids)
        .then((l) => {
          // Merge rather than replace: a later pass that fails for one column
          // must not drop a label set we already had, or a picker that was
          // showing the board's list falls back mid-shift.
          if (!cancelled && alive.current) setLabels((prev) => ({ ...prev, ...l }));
        })
        // fetchBoardLabels never rejects; this is belt-and-braces so a future
        // change there can't take a page down over a dropdown.
        .catch(() => { /* hardcoded fallback already in place */ });
    };

    run();

    // Re-fetch on the cache's own cadence. Without this the effect never
    // re-runs — none of its dependencies change over time — so a page left
    // mounted keeps its first result for ever and the TTL is dead code for it.
    // Reps hold these pages open all day, which is exactly the window in which
    // somebody adds a payer on Monday.
    const timer = window.setInterval(run, BOARD_LABELS_TTL_MS);

    // And on refocus, which is the actual scenario: a rep switches to Monday,
    // sees the new payer, switches back. `fetchBoardLabels` is cached, so a
    // focus inside the TTL costs no request.
    const onFocus = () => { if (!cancelled && alive.current) run(); };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [idsKey]);

  const index = useMemo(() => toLiveIndex(labels), [labels]);

  const optionsFor = useCallback(
    (columnId: string, fallback: string[]) => labels[columnId]?.options ?? fallback,
    [labels],
  );

  return { labels, index, optionsFor };
}
