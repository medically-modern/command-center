/**
 * useOrders — the order board in two tiers (§5.25's shape).
 *
 *   LIST   every order on the board, slim columns, every 60s. ~1,480 rows ×
 *          30 columns — what the sidebar, the overview and the stock view's
 *          "open orders" counts need, and nothing more.
 *   DETAIL the ONE order the rep opens, every column plus its files, fetched
 *          on select and refreshed silently with each poll while it stays open
 *          (tracking numbers and delivery dates land through the day).
 *
 * Rules that are correctness, not tidiness:
 *   - A list row is stamped `partial` and the page never renders one as the
 *     open order: `col()` defaults a missing column to "", so a narrow row is
 *     indistinguishable from an order whose columns are blank.
 *   - A failed poll KEEPS the previous list and reports `error`; the notice
 *     under the header says so (§9's StaleDataNotice). `fetchOrders` throws
 *     on a mid-pagination failure rather than returning the pages it got, so a
 *     truncated list can never be committed as the whole board.
 *   - Every async apply re-checks `detailIdRef` (the §5.28 rule): a slow
 *     answer must not paint the previous order into the one now open.
 *   - Nothing is cached in localStorage. The intake cache's quota failure was
 *     silent for weeks (§5.25); a module-scope copy gives the same instant
 *     paint on a return visit within the session and cannot fail that way.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Order } from "@/lib/orders/workflow";
import { fetchOrderById, fetchOrders, hasToken } from "@/lib/orders/mondayApi";
import { mondayItemToOrder } from "@/lib/orders/mondayMapping";

export const ORDERS_POLL_MS = 60_000;

// Session memory (see header). `detailCache` makes re-opening an order
// instant; the silent refresh on select keeps it honest.
let lastList: Order[] | null = null;
let lastListAt: number | null = null;
const detailCache = new Map<string, Order>();

/** Test seam. */
export function resetOrdersSessionCache(): void {
  lastList = null;
  lastListAt = null;
  detailCache.clear();
}

export interface UseOrdersResult {
  orders: Order[];
  /** A visible (non-silent) list fetch is in flight. */
  loading: boolean;
  /** This mount's first fetch has not landed — the blocking overlay. */
  initialLoading: boolean;
  /** Rows received so far by the fetch in flight — a count, for the sidebar. */
  loadedRows: number;
  error: string | null;
  lastFetchedAt: number | null;
  refetch: (silent?: boolean) => Promise<void>;
  /** The open order at full width, or null. Never a partial list row. */
  detail: Order | null;
  detailLoading: boolean;
  detailError: string | null;
  /** True when Monday no longer has the open order. */
  detailGone: boolean;
  loadDetail: (id: string | null) => void;
}

export function useOrders(injectedOrderId?: string | null): UseOrdersResult {
  const [orders, setOrders] = useState<Order[]>(lastList ?? []);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadedRows, setLoadedRows] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(lastListAt);

  const [detail, setDetail] = useState<Order | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailGone, setDetailGone] = useState(false);

  const mountedRef = useRef(true);
  const inflightRef = useRef<Promise<void> | null>(null);
  const detailIdRef = useRef<string | null>(null);
  const injectedRef = useRef<string | null | undefined>(injectedOrderId);
  injectedRef.current = injectedOrderId;

  const fetchDetail = useCallback(async (id: string, silent: boolean) => {
    if (!hasToken()) return;
    if (!silent && mountedRef.current) {
      setDetailLoading(true);
      setDetailError(null);
    }
    try {
      const item = await fetchOrderById(id);
      if (!mountedRef.current || detailIdRef.current !== id) return;
      if (!item) {
        detailCache.delete(id);
        setDetailGone(true);
        setDetail(null);
        return;
      }
      const full = mondayItemToOrder(item);
      detailCache.set(id, full);
      setDetail(full);
      setDetailGone(false);
      setDetailError(null);
    } catch (e) {
      if (!mountedRef.current || detailIdRef.current !== id) return;
      setDetailError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current && detailIdRef.current === id && !silent) setDetailLoading(false);
    }
  }, []);

  const loadDetail = useCallback(
    (id: string | null) => {
      if (detailIdRef.current === id) return;
      detailIdRef.current = id;
      setDetailGone(false);
      setDetailError(null);
      if (!id) {
        setDetail(null);
        setDetailLoading(false);
        return;
      }
      const cached = detailCache.get(id) ?? null;
      // A cached record paints synchronously and is refreshed silently; an
      // unknown one shows the spinner. Either way `detail` is never a list row.
      setDetail(cached);
      void fetchDetail(id, !!cached);
    },
    [fetchDetail],
  );

  const refetch = useCallback(async (silent = false) => {
    if (inflightRef.current) return inflightRef.current;
    if (!hasToken()) {
      if (mountedRef.current) {
        setError("Monday is not configured — no gateway URL and no API token.");
        setInitialLoading(false);
      }
      return;
    }
    if (mountedRef.current) {
      if (!silent) setLoading(true);
      setLoadedRows(0);
    }
    const run = (async () => {
      try {
        let got = 0;
        const items = await fetchOrders(({ added }) => {
          got += added;
          if (mountedRef.current) setLoadedRows(got);
        });
        if (!mountedRef.current) return;
        const list = items.map((it) => mondayItemToOrder(it, { partial: true }));

        // A deep-linked order that is not on the board's list (deleted, or
        // simply not yet fetched) is injected at full width so the page can
        // still open it. Failure here is not a list failure.
        const inj = injectedRef.current;
        if (inj && !list.some((o) => o.id === inj)) {
          try {
            const item = await fetchOrderById(inj);
            if (item) {
              const full = mondayItemToOrder(item);
              detailCache.set(inj, full);
              list.unshift(full);
            }
          } catch {
            /* the list stands on its own */
          }
          if (!mountedRef.current) return;
        }

        lastList = list;
        lastListAt = Date.now();
        setOrders(list);
        setLastFetchedAt(lastListAt);
        setError(null);

        // The open order rides along on every poll so a rep watching a
        // shipment sees the tracking number land without clicking anything.
        const openId = detailIdRef.current;
        if (openId) void fetchDetail(openId, true);
      } catch (e) {
        if (mountedRef.current) setError(e instanceof Error ? e.message : "Failed to load orders from Monday");
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setInitialLoading(false);
        }
        inflightRef.current = null;
      }
    })();
    inflightRef.current = run;
    return run;
  }, [fetchDetail]);

  useEffect(() => {
    mountedRef.current = true;
    void refetch(lastList !== null);
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refetch(true);
    }, ORDERS_POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refetch]);

  return {
    orders, loading, initialLoading, loadedRows, error, lastFetchedAt, refetch,
    detail, detailLoading, detailError, detailGone, loadDetail,
  };
}
