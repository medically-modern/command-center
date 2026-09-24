/**
 * `useContactTotals` — the Care Coordinator cards' all-time call and text
 * counts (Brandon, 2026-09-24). One batched Postgres read through the gateway
 * for every card on the page, never one per card, and never a RingCentral read.
 *
 * The four properties its header promises, each pinned here: batching,
 * caching with a TTL, a failure that is NOT cached as zero, and a stable
 * identity for a render that changed nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const fetchContactTotals = vi.fn();
let configured = true;

vi.mock("@/lib/assignedPatients/messagingApi", () => ({
  messagingConfigured: () => configured,
  fetchContactTotals: (...a: unknown[]) => fetchContactTotals(...(a as [])),
}));

import {
  TOTALS_BATCH, __resetContactTotalsForTest, invalidateContactTotals, totalsKey, useContactTotals,
} from "./useContactTotals";

const zero = { callsOut: 0, callsIn: 0, textsOut: 0, textsIn: 0, reachedByCall: false };
/** The gateway answers every number it is sent, keyed by the caller's spelling. */
function answer(numbers: string[], over: Record<string, Partial<typeof zero>> = {}) {
  const results: Record<string, typeof zero> = {};
  for (const n of numbers) results[n] = { ...zero, ...(over[totalsKey(n)] ?? {}) };
  return { results, coverage: { callsSince: "2026-06-18T16:00:00Z", textsSince: "2026-08-01T16:00:00Z" } };
}

describe("useContactTotals", () => {
  beforeEach(() => {
    __resetContactTotalsForTest();
    fetchContactTotals.mockReset();
    configured = true;
  });

  it("asks ONCE for every card, one spelling per number", async () => {
    fetchContactTotals.mockImplementation(async (nums: string[]) => answer(nums, { "3475550101": { callsOut: 5 } }));
    const phones = ["(347) 555-0101", "3475550101", "+1 347 555 0102", ""];
    const { result } = renderHook(() => useContactTotals(phones));
    await waitFor(() => expect(result.current.byNumber.get("3475550101")?.callsOut).toBe(5));
    expect(fetchContactTotals).toHaveBeenCalledTimes(1);
    // Two spellings of one number are one question.
    expect(fetchContactTotals.mock.calls[0][0]).toHaveLength(2);
    expect(result.current.byNumber.get("3475550102")).toEqual(zero);
    expect(result.current.coverage?.callsSince).toBe("2026-06-18T16:00:00Z");
  });

  it("chunks at the gateway's cap rather than sending one refused request", async () => {
    fetchContactTotals.mockImplementation(async (nums: string[]) => answer(nums));
    const phones = Array.from({ length: TOTALS_BATCH * 2 + 10 }, (_, i) => `34755${String(i).padStart(5, "0")}`);
    const { result } = renderHook(() => useContactTotals(phones));
    await waitFor(() => expect(result.current.byNumber.size).toBe(phones.length));
    expect(fetchContactTotals).toHaveBeenCalledTimes(3);
    for (const [nums] of fetchContactTotals.mock.calls) expect(nums.length).toBeLessThanOrEqual(TOTALS_BATCH);
  });

  it("⚠️ a failed read is NOT zero — no counters, and the next load asks again", async () => {
    fetchContactTotals.mockRejectedValueOnce(new Error("gateway down"));
    const { result, rerender } = renderHook(({ p }) => useContactTotals(p), {
      initialProps: { p: ["3475550101"] },
    });
    await waitFor(() => expect(fetchContactTotals).toHaveBeenCalledTimes(1));
    expect(result.current.byNumber.size).toBe(0);

    fetchContactTotals.mockImplementation(async (nums: string[]) => answer(nums, { "3475550101": { textsIn: 2 } }));
    // A new signature re-runs the load; the failed number was never cached.
    rerender({ p: ["3475550101", "3475550199"] });
    await waitFor(() => expect(result.current.byNumber.get("3475550101")?.textsIn).toBe(2));
  });

  it("returns the SAME object for a render that changed nothing (incident rule 2)", async () => {
    fetchContactTotals.mockImplementation(async (nums: string[]) => answer(nums));
    const { result, rerender } = renderHook(({ p }) => useContactTotals(p), {
      initialProps: { p: ["3475550101", "3475550102"] },
    });
    await waitFor(() => expect(result.current.byNumber.size).toBe(2));
    const first = result.current;
    // Same set, another order, a fresh array — still the same answer object.
    rerender({ p: ["3475550102", "3475550101"] });
    expect(result.current).toBe(first);
    expect(fetchContactTotals).toHaveBeenCalledTimes(1);
  });

  it("re-asks about one number after a call is logged", async () => {
    fetchContactTotals.mockImplementation(async (nums: string[]) => answer(nums, { "3475550101": { callsOut: 1 } }));
    const { result } = renderHook(() => useContactTotals(["3475550101"]));
    await waitFor(() => expect(result.current.byNumber.get("3475550101")?.callsOut).toBe(1));

    fetchContactTotals.mockImplementation(async (nums: string[]) => answer(nums, { "3475550101": { callsOut: 2 } }));
    act(() => invalidateContactTotals("(347) 555-0101"));
    await waitFor(() => expect(result.current.byNumber.get("3475550101")?.callsOut).toBe(2));
    expect(fetchContactTotals).toHaveBeenCalledTimes(2);
  });

  it("asks nothing in a build with no gateway", async () => {
    configured = false;
    const { result } = renderHook(() => useContactTotals(["3475550101"]));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchContactTotals).not.toHaveBeenCalled();
    expect(result.current.byNumber.size).toBe(0);
  });
});
