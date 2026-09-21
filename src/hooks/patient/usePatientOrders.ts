/**
 * This patient's orders, for the patient screen's Subscription → Orders tab
 * (§5.45).
 *
 * ⚠️ Every INCIDENT_2026-08-20 guard, because this is a per-patient read on a
 * page a rep clicks through: fetched when the TAB is opened and never on a
 * timer, one in-flight request per phone, a module-scope cache so going back
 * and forth costs nothing, a `want` ref so a slow answer cannot paint the
 * previous patient's orders into the open one, and a FAILURE that is not cached
 * so re-opening retries (§5.28's `fetchDirectoryNames` lesson).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOrdersForPatient, type MondayItem } from "@/lib/orders/mondayApi";

const cache = new Map<string, MondayItem[]>();
const inflight = new Map<string, Promise<MondayItem[]>>();

export function clearPatientOrdersCache(): void {
  cache.clear();
  inflight.clear();
}

export function usePatientOrders(phone: string, enabled: boolean): {
  orders: MondayItem[] | null;
  loading: boolean;
  error: string;
} {
  const key = (phone ?? "").replace(/\D/g, "").slice(-10);
  const [orders, setOrders] = useState<MondayItem[] | null>(() => cache.get(key) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const want = useRef(key);

  const run = useCallback(async () => {
    want.current = key;
    if (!key || key.length < 10) {
      setOrders([]);
      return;
    }
    const hit = cache.get(key);
    if (hit) {
      setOrders(hit);
      return;
    }
    setLoading(true);
    setError("");
    try {
      let p = inflight.get(key);
      if (!p) {
        p = fetchOrdersForPatient(key);
        inflight.set(key, p);
        // ⚠️ The `finally` belongs to the CHAINED promise, or an older pass
        // clears the slot while the one behind it is still running and the next
        // call starts a third alongside (§5.28).
        p = p.finally(() => inflight.delete(key));
        inflight.set(key, p);
      }
      const rows = await p;
      cache.set(key, rows);
      // A slow answer for a patient the rep has already left is dropped.
      if (want.current === key) setOrders(rows);
    } catch (e) {
      // NOT cached — re-opening the tab retries rather than pinning it empty.
      if (want.current === key) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (want.current === key) setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    if (!enabled) return;
    void run();
  }, [enabled, run]);

  return { orders, loading, error };
}
