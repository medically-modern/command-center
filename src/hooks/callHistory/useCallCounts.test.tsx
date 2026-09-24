/**
 * useCallCounts — the read behind "We called N · They called M" on the patient
 * screen. Every rule here is one whose failure is silent on screen: a count
 * that is stale, partial, or a 0 standing in for a failed read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ArchivedCallRow } from "@/lib/callHistory/callCounts";

const fetchCalls = vi.hoisted(() => vi.fn());
const fetchOldest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/callHistory/archivedRecordings", () => ({ archiveAvailable: () => true }));
vi.mock("@/lib/callHistory/callCounts", async (orig) => ({
  ...(await orig<typeof import("@/lib/callHistory/callCounts")>()),
  fetchArchivedCalls: fetchCalls,
  fetchArchiveOldest: fetchOldest,
}));

import { __resetCallCountsForTests, useCallCounts } from "./useCallCounts";

const call = (callId: string, direction: "Inbound" | "Outbound", result = "Accepted"): ArchivedCallRow => ({
  callId,
  direction,
  result,
  legResults: [],
  durationSec: result === "Accepted" ? 90 : 0,
  startedAt: "2026-09-20T15:00:00.000Z",
});

/** A promise the test resolves or rejects by hand. */
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
  __resetCallCountsForTests();
  fetchCalls.mockReset();
  fetchOldest.mockReset();
  fetchOldest.mockResolvedValue("2026-06-18T14:00:00.000Z");
});
afterEach(() => vi.clearAllMocks());

describe("useCallCounts", () => {
  it("counts the patient's calls and names when our records begin", async () => {
    fetchCalls.mockResolvedValue({
      rows: [call("a", "Outbound"), call("b", "Outbound", "No Answer"), call("c", "Inbound", "Missed")],
      capped: false,
    });
    const { result } = renderHook(() => useCallCounts("(555) 555-0100"));
    expect(result.current.loading).toBe(true);
    expect(result.current.counts).toBeNull();
    await waitFor(() => expect(result.current.counts).not.toBeNull());
    expect(result.current.counts).toMatchObject({ weCalled: 2, weReached: 1, theyCalled: 1, theyMissed: 1 });
    await waitFor(() => expect(result.current.since).toBe("2026-06-18T14:00:00.000Z"));
  });

  it("⚠️ ALL OR NOTHING across the two numbers — no total from one of them", async () => {
    const primary = deferred<{ rows: ArchivedCallRow[]; capped: boolean }>();
    const alt = deferred<{ rows: ArchivedCallRow[]; capped: boolean }>();
    fetchCalls.mockImplementation((p: string) => (p.endsWith("0100") ? primary.promise : alt.promise));
    const { result } = renderHook(() => useCallCounts("5555550100", "5555550199"));
    await act(async () => primary.resolve({ rows: [call("a", "Outbound")], capped: false }));
    expect(result.current.counts).toBeNull();
    expect(result.current.loading).toBe(true);
    await act(async () => alt.resolve({ rows: [call("b", "Inbound"), call("c", "Outbound")], capped: false }));
    expect(result.current.counts).toMatchObject({ total: 3, weCalled: 2, theyCalled: 1 });
    expect(result.current.altTotal).toBe(2);
  });

  it("⚠️ a FAILED read shows no numbers, and the next open asks again", async () => {
    fetchCalls.mockRejectedValueOnce(new Error("502"));
    const first = renderHook(() => useCallCounts("5555550100"));
    await waitFor(() => expect(first.result.current.failed).toBe(true));
    expect(first.result.current.counts).toBeNull();
    first.unmount();

    fetchCalls.mockResolvedValueOnce({ rows: [call("a", "Inbound")], capped: false });
    const second = renderHook(() => useCallCounts("5555550100"));
    await waitFor(() => expect(second.result.current.counts?.theyCalled).toBe(1));
    expect(second.result.current.failed).toBe(false);
    expect(fetchCalls).toHaveBeenCalledTimes(2);
  });

  it("every open re-reads, and the last answer paints meanwhile", async () => {
    fetchCalls.mockResolvedValueOnce({ rows: [call("a", "Outbound")], capped: false });
    const first = renderHook(() => useCallCounts("5555550100"));
    await waitFor(() => expect(first.result.current.counts?.weCalled).toBe(1));
    first.unmount();

    const again = deferred<{ rows: ArchivedCallRow[]; capped: boolean }>();
    fetchCalls.mockReturnValueOnce(again.promise);
    const second = renderHook(() => useCallCounts("5555550100"));
    // Painted from the last answer at once, not a spinner…
    expect(second.result.current.counts?.weCalled).toBe(1);
    // …and replaced by the fresh one.
    await act(async () => again.resolve({ rows: [call("a", "Outbound"), call("b", "Outbound")], capped: false }));
    expect(second.result.current.counts?.weCalled).toBe(2);
    expect(fetchCalls).toHaveBeenCalledTimes(2);
  });

  it("a failed RE-read keeps the earlier answer on screen", async () => {
    fetchCalls.mockResolvedValueOnce({ rows: [call("a", "Outbound")], capped: false });
    const first = renderHook(() => useCallCounts("5555550100"));
    await waitFor(() => expect(first.result.current.counts?.weCalled).toBe(1));
    first.unmount();
    fetchCalls.mockRejectedValueOnce(new Error("blip"));
    const second = renderHook(() => useCallCounts("5555550100"));
    await waitFor(() => expect(fetchCalls).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(second.result.current.counts?.weCalled).toBe(1);
    expect(second.result.current.failed).toBe(false);
  });

  it("one read per number at a time — two screens mounting together share it", async () => {
    const d = deferred<{ rows: ArchivedCallRow[]; capped: boolean }>();
    fetchCalls.mockReturnValue(d.promise);
    renderHook(() => useCallCounts("5555550100"));
    renderHook(() => useCallCounts("5555550100"));
    expect(fetchCalls).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ rows: [], capped: false }));
  });

  it("the same number twice, or reformatted, is one number and one read", async () => {
    fetchCalls.mockResolvedValue({ rows: [call("a", "Inbound")], capped: false });
    const { result, rerender } = renderHook(({ p, a }) => useCallCounts(p, a), {
      initialProps: { p: "5555550100", a: "(555) 555-0100" },
    });
    await waitFor(() => expect(result.current.counts?.total).toBe(1));
    expect(result.current.altTotal).toBe(0);
    rerender({ p: "+1 555-555-0100", a: "" });
    await act(async () => {});
    expect(fetchCalls).toHaveBeenCalledTimes(1);
  });

  it("no usable number asks nothing and shows nothing", () => {
    const { result } = renderHook(() => useCallCounts("555-0100"));
    expect(result.current.available).toBe(false);
    expect(fetchCalls).not.toHaveBeenCalled();
  });
});
