// React binding for `lib/shared/payerLabels` — live Primary Insurance options
// for the Welcome Call, Final Confirm and Subscription pickers.
//
// WHY A HOOK AND NOT A `useEffect` PER PAGE: three pickers on three stages need
// the same refresh rules, and those rules are what make "a payer added on Monday
// shows up in the Command Center" true rather than nearly true. Duplicated per
// page they would drift, and the drift is invisible — a picker silently one
// payer short is exactly the failure this whole module exists to fix.
//
// This is deliberately the same shape as `hooks/profile/useBoardLabels.ts`,
// which does the job for Profile Send Off. It is a separate hook rather than a
// generalisation of that one because `profile/boardLabels.ts` is hardwired to a
// single BOARD_ID, while `shared/statusOptions.ts` underneath this one is
// board-parameterised — which is the property these three boards need.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchPayerOptions,
  payerOptionsOrFallback,
  withCurrentPayer,
  type PayerBoardKey,
} from "@/lib/shared/payerLabels";
import { STATUS_OPTIONS_TTL_MS, type StatusOption } from "@/lib/shared/statusOptions";

export interface UsePayerOptionsResult {
  /** The board's own list, or `[]` until it loads / if it cannot be reached. */
  live: StatusOption[];
  /** True once the board answered — pickers may use this to explain a fallback. */
  loaded: boolean;
  /**
   * What to render: the board's list when we have it, the caller's hardcoded
   * list when we don't, plus the value the ITEM holds if neither offers it.
   *
   * ⚠️ The index travels with the option, so whichever list wins, the index the
   * picker hands back was sourced from the same place as the label the rep read.
   */
  optionsFor: (
    fallback: readonly StatusOption[],
    currentLabel?: string | null,
    currentIndex?: number | null,
  ) => StatusOption[];
}

export function usePayerOptions(board: PayerBoardKey): UsePayerOptionsResult {
  const [live, setLive] = useState<StatusOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = () => {
      fetchPayerOptions(board)
        .then((opts) => {
          if (cancelled || !alive.current) return;
          // ⚠️ Only ever REPLACE with a non-empty answer. A later pass that
          // fails must not drop a list we already had, or a picker that was
          // showing the board's payers falls back mid-shift — and a rep who
          // just saw the new payer would watch it disappear.
          if (opts.length > 0) {
            setLive(opts);
            setLoaded(true);
          }
        })
        // fetchPayerOptions never rejects; belt-and-braces so a future change
        // there cannot take a stage page down over a dropdown.
        .catch(() => {
          /* fallback already in place */
        });
    };

    run();

    // Re-fetch on the cache's own cadence. Without this the effect never re-runs
    // — none of its dependencies change over time — so a page left mounted keeps
    // its first result for ever and the TTL is dead code for it. Reps hold these
    // pages open all day, which is exactly the window in which somebody adds a
    // payer on Monday.
    const timer = window.setInterval(run, STATUS_OPTIONS_TTL_MS);

    // And on refocus, which is the actual scenario: a rep switches to Monday,
    // sees the new payer, switches back. The fetch is cached, so a focus inside
    // the TTL costs no request.
    const onFocus = () => {
      if (!cancelled && alive.current) run();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [board]);

  const optionsFor = useCallback(
    (
      fallback: readonly StatusOption[],
      currentLabel?: string | null,
      currentIndex?: number | null,
    ) => withCurrentPayer(payerOptionsOrFallback(live, fallback), currentLabel, currentIndex),
    [live],
  );

  return useMemo(() => ({ live, loaded, optionsFor }), [live, loaded, optionsFor]);
}
