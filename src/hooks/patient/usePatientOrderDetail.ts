/**
 * The ONE order the patient screen's Orders tab shows in full (Brandon's order
 * card, pixel-match Phase 2) — read at full width, the way `/orders` reads its
 * open order.
 *
 * ⚠️⚠️ **A LIST ROW IS NEVER RENDERED AS THE OPEN ORDER** (§5.25 · §5.35). The
 * history table's rows come from `LIST_COLUMN_IDS`, so every column the list
 * did not ask for is "" — indistinguishable from a blank board cell. The card
 * reads the signed-by, the substitution, the ship-to and Cardinal's sync time,
 * none of which a list row carries, so it waits for this read instead of
 * painting a plausible, wrong order.
 *
 * The INCIDENT_2026-08-20 guards, because it runs on a screen a rep clicks
 * through: read when an order is SELECTED (the latest, when the tab opens),
 * never on a timer; one request per order at a time; a module cache that
 * PAINTS a re-opened order at once while it is read again; a `want` ref so a
 * slow answer cannot paint the previous order into the open one; and a failure
 * that is not cached, so selecting it again retries.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOrderById, hasToken } from "@/lib/orders/mondayApi";
import { mondayItemToOrder } from "@/lib/orders/mondayMapping";
import type { Order } from "@/lib/orders/workflow";

const cache = new Map<string, Order>();
const inflight = new Map<string, Promise<Order | null>>();

export function clearPatientOrderDetailCache(): void {
  cache.clear();
  inflight.clear();
}

function read(id: string): Promise<Order | null> {
  let p = inflight.get(id);
  if (!p) {
    p = fetchOrderById(id)
      .then((item) => (item ? mondayItemToOrder(item) : null))
      // ⚠️ On the CHAINED promise, or an older pass clears the slot while the
      // one behind it is still running (§5.28).
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}

export function usePatientOrderDetail(orderId: string | null): {
  order: Order | null;
  loading: boolean;
  error: string;
  /** The order is no longer on the board (deleted, or moved off it). */
  gone: boolean;
  reload: () => void;
} {
  const [order, setOrder] = useState<Order | null>(() => (orderId ? cache.get(orderId) ?? null : null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [gone, setGone] = useState(false);
  const want = useRef(orderId);

  const run = useCallback(async () => {
    want.current = orderId;
    setError("");
    setGone(false);
    if (!orderId) {
      setOrder(null);
      return;
    }
    // The cache paints; it is never the answer on its own — a selection is
    // always read again, because an order moves (shipped, delivered) while a
    // rep reads it.
    setOrder(cache.get(orderId) ?? null);
    if (!hasToken()) {
      setError("Monday is not configured for this build.");
      return;
    }
    setLoading(true);
    try {
      const full = await read(orderId);
      if (want.current !== orderId) return;
      if (!full) {
        cache.delete(orderId);
        setOrder(null);
        setGone(true);
        return;
      }
      cache.set(orderId, full);
      setOrder(full);
    } catch (e) {
      // NOT cached — selecting it again retries.
      if (want.current === orderId) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (want.current === orderId) setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void run();
  }, [run]);

  return { order, loading, error, gone, reload: () => void run() };
}
