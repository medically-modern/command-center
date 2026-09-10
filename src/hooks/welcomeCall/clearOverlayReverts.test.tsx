// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

/**
 * ⚠️ `clearOverlay` must put the BOARD's values back on screen, not merely drop
 * the overlay entry.
 *
 * `patients` holds the MERGED patient — the board's row with the overlay
 * applied — so deleting the overlay changes nothing that is rendered. The rep's
 * edits stay up until a refetch happens to land, and a Send in that window
 * writes exactly the edits Reset claimed to discard. If the refetch FAILS there
 * is no window at all, just the wrong values with a stale-data notice beside
 * them (Greptile, PR #57).
 *
 * That mattered enough to pin because of what Reset promises: its own toast
 * says "Cleared local edits — refetching from Monday". This test asserts the
 * first half happens without waiting on the second.
 */

const fetchGroupItems = vi.fn();
const fetchItemById = vi.fn();

vi.mock("@/lib/welcomeCall/mondayApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/welcomeCall/mondayApi")>(
    "@/lib/welcomeCall/mondayApi",
  );
  return {
    ...actual,
    hasToken: () => true,
    fetchGroupItems: (...a: unknown[]) => fetchGroupItems(...a),
    fetchItemById: (...a: unknown[]) => fetchItemById(...a),
  };
});

import { useMondayPatients } from "./useMondayPatients";
import { COL } from "@/lib/welcomeCall/mondayApi";

/** A board row carrying a real infusion order. */
const boardItem = () => ({
  id: "p1",
  name: "Test Patient",
  group: { id: "group_mm1wvq8p" },
  column_values: [
    { id: COL.qtyInf1, text: "3", value: '"3"' },
    { id: COL.monitorQty, text: "1", value: '"1"' },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  fetchGroupItems.mockResolvedValue([boardItem()]);
  fetchItemById.mockResolvedValue(null);
});

describe("clearOverlay reverts the rendered patient", () => {
  it("restores the board's values without waiting for a refetch", async () => {
    const { result } = renderHook(() => useMondayPatients(null));
    await waitFor(() => expect(result.current.patients.length).toBe(1));
    expect(result.current.patients[0].qtyInf1).toBe("3");

    // The rep edits the order.
    act(() => result.current.update("p1", { qtyInf1: "9", monitorQty: "0" }));
    expect(result.current.patients[0].qtyInf1).toBe("9");
    expect(result.current.hasOverlay("p1")).toBe(true);

    // Reset. No refetch is allowed to run before we look.
    fetchGroupItems.mockImplementation(() => new Promise(() => {}));
    act(() => result.current.clearOverlay("p1"));

    expect(
      result.current.patients[0].qtyInf1,
      "the rep's edit is still on screen — a Send now would write the very value Reset discarded",
    ).toBe("3");
    expect(result.current.patients[0].monitorQty).toBe("1");
    expect(result.current.hasOverlay("p1")).toBe(false);
  });

  it("still reverts when the refetch fails outright", async () => {
    const { result } = renderHook(() => useMondayPatients(null));
    await waitFor(() => expect(result.current.patients.length).toBe(1));

    act(() => result.current.update("p1", { qtyInf1: "9" }));
    fetchGroupItems.mockRejectedValue(new Error("Monday 503"));
    act(() => result.current.clearOverlay("p1"));

    expect(result.current.patients[0].qtyInf1).toBe("3");
  });

  /* Nothing truer exists for a patient we have never fetched, and blanking
     would invent data. */
  it("leaves a patient with no board copy alone", async () => {
    const { result } = renderHook(() => useMondayPatients(null));
    await waitFor(() => expect(result.current.patients.length).toBe(1));
    act(() => result.current.clearOverlay("never-seen"));
    expect(result.current.patients[0].qtyInf1).toBe("3");
  });
});
