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
    setLoading(true);
    setError(null);
    fetchStatusOptions(boardId, ids)
      .then((o) => {
        if (!cancelled && alive.current) setOptions(o);
      })
      .catch((e) => {
        if (!cancelled && alive.current) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled && alive.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId, idsKey, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const ids = idsKey ? idsKey.split(",") : [];
  const ready = ids.length > 0 && ids.every((id) => (options[id]?.length ?? 0) > 0);

  return { options, loading, error, ready, reload };
}
