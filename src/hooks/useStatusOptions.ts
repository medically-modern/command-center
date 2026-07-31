// React binding for `lib/shared/statusOptions` — live status-column options.
//
// See that module's header for why the SPA stopped hardcoding `{index,label}`
// tables. The short version: the index is the only binding, and a deleted index
// writes a blank without erroring, so the option list has to come from the board.
//
// The returned `ready` flag is the important one. Callers should DISABLE the
// control while it is false rather than rendering a hardcoded fallback — a stale
// index looks like a successful write and lands empty on the patient's order.

import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchStatusOptions,
  STATUS_OPTIONS_TTL_MS,
  type StatusOption,
} from "@/lib/shared/statusOptions";

export type UseStatusOptionsResult = {
  /** Live options per column id. `{}` until the first fetch resolves. */
  options: Record<string, StatusOption[]>;
  loading: boolean;
  /** Fetch error, if the last attempt failed. */
  error: string | null;
  /** True once every requested column has options — gate writes on this. */
  ready: boolean;
  reload: () => void;
};

export function useStatusOptions(
  boardId: number | string,
  columnIds: string[],
): UseStatusOptionsResult {
  // Join the ids so the effect doesn't re-run on every render from a fresh
  // array literal at the call site.
  const idsKey = columnIds.join(",");
  const [options, setOptions] = useState<Record<string, StatusOption[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    if (ids.length === 0) return;
    let cancelled = false;

    const run = () => {
      setLoading(true);
      setError(null);
      fetchStatusOptions(boardId, ids)
        .then((o) => {
          if (!cancelled && alive.current) setOptions(o);
        })
        .catch((e) => {
          if (!cancelled && alive.current) {
            // Drop the options as well as recording the error. Keeping the last
            // good set would leave `ready` true, so the control would stay
            // enabled and could still write an index that may since have been
            // deleted from the board — the exact failure this hook exists to
            // prevent. Disabled-and-explained beats enabled-and-maybe-wrong.
            setOptions({});
            setError(e instanceof Error ? e.message : String(e));
          }
        })
        .finally(() => {
          if (!cancelled && alive.current) setLoading(false);
        });
    };

    run();

    // Re-fetch on the same cadence as the cache TTL. Without this the effect
    // never re-runs — none of its dependencies change over time — so a form left
    // mounted keeps its first result forever and the TTL is dead code for it.
    // Reps hold these pages open all day, which is exactly the window in which
    // someone edits a board label.
    const timer = window.setInterval(run, STATUS_OPTIONS_TTL_MS);

    // Also refresh when the tab comes back to the foreground: a rep who switches
    // to Monday, edits a label and switches back should not have to wait out the
    // interval. `fetchStatusOptions` is cached, so a focus inside the TTL is a
    // no-op rather than a request.
    const onFocus = () => {
      if (!cancelled && alive.current) run();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [boardId, idsKey, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const ids = idsKey ? idsKey.split(",") : [];
  const ready = ids.length > 0 && ids.every((id) => (options[id]?.length ?? 0) > 0);

  return { options, loading, error, ready, reload };
}
