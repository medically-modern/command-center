/**
 * The three one-shot reads behind Reports & Metrics (§5.52), each with its
 * own answer, its own error and its own loading flag — so a failed orders read
 * takes out the orders tile and nothing else.
 *
 * ⚠️ **Read on open, never polled.** A report is not a queue; the pipeline
 * snapshot beside it (`useSystemPatients`) has its own cadence and its own
 * cache. Refresh is the reader's. `reports.test.tsx` scans for a timer.
 *
 * ⚠️ A failed read is REPORTED, never rendered as zero: "0 open orders" is the
 * wrong answer a manager acts on by doing nothing (the SLA card's own rule).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchFormLeadRows, fetchOrderRows, fetchSubscriptionRows } from "@/lib/reports/reportsApi";
import type { FormLeadRow, SubscriptionRow } from "@/lib/reports/reportsRules";
import type { Order } from "@/lib/orders/workflow";

export interface Read<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

const idle = <T,>(): Read<T> => ({ data: null, error: null, loading: true });

export interface ReportsData {
  subscriptions: Read<SubscriptionRow[]>;
  formLeads: Read<FormLeadRow[]>;
  orders: Read<Order[]>;
  /** Any of the three still in flight. */
  loading: boolean;
  refetch: () => void;
}

function useRead<T>(load: () => Promise<T>, gen: number): Read<T> {
  const [state, setState] = useState<Read<T>>(idle);
  const want = useRef(0);
  useEffect(() => {
    const mine = ++want.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    load().then(
      (data) => { if (want.current === mine) setState({ data, error: null, loading: false }); },
      (e) => {
        if (want.current !== mine) return;
        // A failed refresh keeps the previous answer on screen, marked stale by
        // the error beside it — never replaces it with nothing.
        setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : String(e), loading: false }));
      },
    );
    // No cleanup bump is needed: a refresh bumps `want` before the older read
    // can resolve, and a resolve after unmount is a setState React 18 ignores.
    // `gen` is the refresh counter; `load` is a stable module function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen]);
  return state;
}

export function useReportsData(): ReportsData {
  const [gen, setGen] = useState(0);
  const subscriptions = useRead(fetchSubscriptionRows, gen);
  const formLeads = useRead(fetchFormLeadRows, gen);
  const orders = useRead(fetchOrderRows, gen);
  const refetch = useCallback(() => setGen((g) => g + 1), []);
  return {
    subscriptions, formLeads, orders,
    loading: subscriptions.loading || formLeads.loading || orders.loading,
    refetch,
  };
}
