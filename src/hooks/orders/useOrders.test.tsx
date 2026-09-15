// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

/**
 * The two-tier read (§5.25) for orders. Both hazards fail SILENTLY, which is
 * why they are pinned here rather than left to a screenshot:
 *   1. a list row is `partial` and `detail` never falls back to one — a
 *      narrow row renders every column the list did not ask for as "";
 *   2. a slow detail answer must never paint the previous order into the one
 *      now open (`detailIdRef`).
 * Plus: a failed poll keeps the previous list, and an order Monday no longer
 * has reads as gone rather than as empty.
 */
const fetchOrders = vi.fn();
const fetchOrderById = vi.fn();

vi.mock("@/lib/orders/mondayApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/orders/mondayApi")>("@/lib/orders/mondayApi");
  return {
    ...actual,
    hasToken: () => true,
    fetchOrders: (...a: unknown[]) => fetchOrders(...a),
    fetchOrderById: (...a: unknown[]) => fetchOrderById(...a),
  };
});

import { useOrders, resetOrdersSessionCache } from "./useOrders";
import { COL } from "@/lib/orders/mondayApi";

function listRow(id: string, name: string) {
  return {
    id, name, group: { id: "group_mm18v6n3" },
    column_values: [{ id: COL.orderStatus, text: "Order", value: JSON.stringify({ index: 0 }) }],
  };
}
function fullItem(id: string, name: string, dob: string) {
  return {
    id, name, group: { id: "group_mm18v6n3", title: "Order" },
    column_values: [
      { id: COL.orderStatus, text: "Order", value: JSON.stringify({ index: 0 }) },
      { id: COL.dob, text: dob, value: null },
    ],
    assets: [],
  };
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

beforeEach(() => {
  resetOrdersSessionCache();
  fetchOrders.mockReset();
  fetchOrderById.mockReset();
  fetchOrders.mockResolvedValue([listRow("1", "Ann Test"), listRow("2", "Bob Test")]);
  fetchOrderById.mockImplementation(async (id: string) => fullItem(id, id === "1" ? "Ann Test" : "Bob Test", id === "1" ? "01/01/1980" : "02/02/1990"));
});
afterEach(() => vi.useRealTimers());

describe("two tiers", () => {
  it("list rows are partial; the detail record is not, and carries the full columns", async () => {
    const { result } = renderHook(() => useOrders(null));
    await waitFor(() => expect(result.current.orders).toHaveLength(2));
    expect(result.current.orders[0].partial).toBe(true);
    expect(result.current.orders[0].dob).toBe("");

    act(() => result.current.loadDetail("1"));
    await waitFor(() => expect(result.current.detail?.id).toBe("1"));
    expect(result.current.detail?.partial).toBeUndefined();
    expect(result.current.detail?.dob).toBe("01/01/1980");
  });

  it("a slow answer for the previous order never lands on the one now open", async () => {
    const slow = deferred<ReturnType<typeof fullItem>>();
    fetchOrderById.mockImplementation((id: string) => (id === "1" ? slow.promise : Promise.resolve(fullItem("2", "Bob Test", "02/02/1990"))));
    const { result } = renderHook(() => useOrders(null));
    await waitFor(() => expect(result.current.orders).toHaveLength(2));

    act(() => result.current.loadDetail("1"));
    act(() => result.current.loadDetail("2"));
    await waitFor(() => expect(result.current.detail?.id).toBe("2"));
    // Now the first answer arrives, late.
    await act(async () => { slow.resolve(fullItem("1", "Ann Test", "01/01/1980")); });
    expect(result.current.detail?.id).toBe("2");
    expect(result.current.detail?.dob).toBe("02/02/1990");
  });

  it("clearing the selection clears the detail", async () => {
    const { result } = renderHook(() => useOrders(null));
    await waitFor(() => expect(result.current.orders).toHaveLength(2));
    act(() => result.current.loadDetail("1"));
    await waitFor(() => expect(result.current.detail?.id).toBe("1"));
    act(() => result.current.loadDetail(null));
    expect(result.current.detail).toBeNull();
  });
});

describe("failure modes", () => {
  it("a failed poll keeps the previous list and reports the error", async () => {
    const { result } = renderHook(() => useOrders(null));
    await waitFor(() => expect(result.current.orders).toHaveLength(2));
    fetchOrders.mockRejectedValueOnce(new Error("Monday request failed (503)"));
    await act(async () => { await result.current.refetch(true); });
    expect(result.current.orders).toHaveLength(2);
    expect(result.current.error).toMatch(/503/);
    // And the next success clears it.
    await act(async () => { await result.current.refetch(true); });
    expect(result.current.error).toBeNull();
  });

  it("an order Monday no longer has reads as gone, not as blank", async () => {
    fetchOrderById.mockResolvedValue(null);
    const { result } = renderHook(() => useOrders(null));
    await waitFor(() => expect(result.current.orders).toHaveLength(2));
    act(() => result.current.loadDetail("1"));
    await waitFor(() => expect(result.current.detailGone).toBe(true));
    expect(result.current.detail).toBeNull();
  });
});

describe("deep links", () => {
  it("injects an order that is not in the list, at full width", async () => {
    const { result } = renderHook(() => useOrders("9"));
    await waitFor(() => expect(result.current.orders.some((o) => o.id === "9")).toBe(true));
    expect(fetchOrderById).toHaveBeenCalledWith("9");
    expect(result.current.orders.find((o) => o.id === "9")?.partial).toBeUndefined();
  });
});
