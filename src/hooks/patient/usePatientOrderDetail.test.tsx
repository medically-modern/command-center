/**
 * The ONE order the patient screen's Orders tab shows in full. The guards are
 * INCIDENT_2026-08-20's, and each one fails silently: a stale order painted
 * into the open one, a failure pinned for the session, a request per render.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { MondayItem } from "@/lib/orders/mondayApi";

const fetchOrderById = vi.hoisted(() => vi.fn());
vi.mock("@/lib/orders/mondayApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/orders/mondayApi")>()),
  fetchOrderById,
  hasToken: () => true,
}));

import { clearPatientOrderDetailCache, usePatientOrderDetail } from "./usePatientOrderDetail";

const item = (id: string, name = "Jane Sample"): MondayItem => ({ id, name, column_values: [] });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  clearPatientOrderDetailCache();
  fetchOrderById.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("usePatientOrderDetail", () => {
  it("reads the selected order at full width", async () => {
    fetchOrderById.mockResolvedValue(item("1"));
    const { result } = renderHook(() => usePatientOrderDetail("1"));
    await waitFor(() => expect(result.current.order?.id).toBe("1"));
    expect(result.current.order?.partial).toBeFalsy();
    expect(fetchOrderById).toHaveBeenCalledWith("1");
  });

  it("nothing selected, nothing read", () => {
    const { result } = renderHook(() => usePatientOrderDetail(null));
    expect(result.current.order).toBeNull();
    expect(fetchOrderById).not.toHaveBeenCalled();
  });

  it("⚠️ the cache PAINTS a re-opened order, and it is read again anyway", async () => {
    fetchOrderById.mockResolvedValue(item("1", "First read"));
    const a = renderHook(() => usePatientOrderDetail("1"));
    await waitFor(() => expect(a.result.current.order?.name).toBe("First read"));
    a.unmount();

    const again = deferred<MondayItem>();
    fetchOrderById.mockReturnValueOnce(again.promise);
    const b = renderHook(() => usePatientOrderDetail("1"));
    // Painted at once from the cache…
    expect(b.result.current.order?.name).toBe("First read");
    expect(fetchOrderById).toHaveBeenCalledTimes(2);
    // …and replaced by the fresh read when it lands (an order moves).
    await act(async () => again.resolve(item("1", "Second read")));
    expect(b.result.current.order?.name).toBe("Second read");
  });

  it("⚠️ a FAILURE is not cached — reload reads again", async () => {
    fetchOrderById.mockRejectedValueOnce(new Error("Monday 503"));
    const { result } = renderHook(() => usePatientOrderDetail("1"));
    await waitFor(() => expect(result.current.error).toBe("Monday 503"));
    expect(result.current.order).toBeNull();

    fetchOrderById.mockResolvedValueOnce(item("1"));
    await act(async () => result.current.reload());
    await waitFor(() => expect(result.current.order?.id).toBe("1"));
    expect(result.current.error).toBe("");
  });

  it("⚠️ a slow answer for the previous order never paints into the open one", async () => {
    const slow = deferred<MondayItem>();
    fetchOrderById.mockImplementation((id: string) => (id === "A" ? slow.promise : Promise.resolve(item("B"))));
    const { result, rerender } = renderHook(({ id }) => usePatientOrderDetail(id), { initialProps: { id: "A" } });
    rerender({ id: "B" });
    await waitFor(() => expect(result.current.order?.id).toBe("B"));
    await act(async () => slow.resolve(item("A")));
    expect(result.current.order?.id).toBe("B");
  });

  it("an order no longer on the board says so", async () => {
    fetchOrderById.mockResolvedValue(null);
    const { result } = renderHook(() => usePatientOrderDetail("1"));
    await waitFor(() => expect(result.current.gone).toBe(true));
    expect(result.current.order).toBeNull();
  });

  it("two readers of one order share ONE request", async () => {
    const one = deferred<MondayItem>();
    fetchOrderById.mockReturnValue(one.promise);
    const a = renderHook(() => usePatientOrderDetail("1"));
    const b = renderHook(() => usePatientOrderDetail("1"));
    expect(fetchOrderById).toHaveBeenCalledTimes(1);
    await act(async () => one.resolve(item("1")));
    expect(a.result.current.order?.id).toBe("1");
    expect(b.result.current.order?.id).toBe("1");
  });
});
