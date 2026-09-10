/**
 * The progress half of `useBoardPoll`. The rules worth pinning are the ones a
 * coordinator would notice being wrong: a bar that reappears every minute, a
 * percentage learned from a run that failed, and a bar left on screen after
 * the read finished.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useBoardPoll } from "./useBoardPoll";
import { recallTotal } from "@/lib/careCoordinator/loadProgress";

/** A fetcher that reports two pages and resolves when we say so. */
function pagedFetcher(pages: number[], fail = false) {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const fn = async (onPage?: (rows: number) => void) => {
    for (const n of pages) onPage?.(n);
    await gate;
    if (fail) throw new Error("Monday 503");
    return pages.reduce((a, b) => a + b, 0);
  };
  return { fn, release: () => act(() => { release(); }) };
}

describe("useBoardPoll progress", () => {
  beforeEach(() => { localStorage.clear(); vi.useRealTimers(); });

  it("accumulates interleaved page reports and finishes at done", async () => {
    const { fn, release } = pagedFetcher([500, 500, 500, 254]);
    const { result } = renderHook(() => useBoardPoll(fn, 60_000, "intake"));

    await waitFor(() => expect(result.current.progress?.loaded).toBe(1754));
    // Four pages, reported out of order across three parallel groups — the
    // hook may only ever add.
    expect(result.current.progress?.pages).toBe(4);
    expect(result.current.progress?.done).toBe(false);

    release();
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Cleared once the read resolved — the bar does not linger.
    expect(result.current.progress).toBeNull();
  });

  it("remembers the total only from a run that COMPLETED", async () => {
    const bad = pagedFetcher([500, 500], true);
    const { result, unmount } = renderHook(() => useBoardPoll(bad.fn, 60_000, "k1"));
    await waitFor(() => expect(result.current.progress?.loaded).toBe(1000));
    bad.release();
    await waitFor(() => expect(result.current.error).toBe("Monday 503"));
    // A half-finished read must not become the next load's denominator.
    expect(recallTotal("k1")).toBeNull();
    unmount();

    const good = pagedFetcher([500, 500, 200]);
    const two = renderHook(() => useBoardPoll(good.fn, 60_000, "k1"));
    good.release();
    await waitFor(() => expect(two.result.current.loading).toBe(false));
    expect(recallTotal("k1")).toBe(1200);
  });

  it("shows NOTHING for a background poll, and shows again for a pressed Refresh", async () => {
    vi.useFakeTimers();
    let reports = 0;
    let settle: () => void = () => {};
    const fn = async (onPage?: (rows: number) => void) => {
      onPage?.(10);
      reports++;
      await new Promise<void>((r) => { settle = r; });
      return 10;
    };
    const { result } = renderHook(() => useBoardPoll(fn, 1000, "k2"));

    // First load: visible.
    await vi.waitFor(() => expect(result.current.progress).not.toBeNull());
    await act(async () => { settle(); await Promise.resolve(); });
    await vi.waitFor(() => expect(result.current.loading).toBe(false));

    // The 1s interval tick: runs, but paints no bar.
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(reports).toBeGreaterThan(1);
    expect(result.current.progress).toBeNull();
    await act(async () => { settle(); await Promise.resolve(); });

    // A Refresh the coordinator pressed is worth showing.
    act(() => { result.current.refetch(); });
    await vi.waitFor(() => expect(result.current.progress).not.toBeNull());
    await act(async () => { settle(); await Promise.resolve(); });
    vi.useRealTimers();
  });

  it("carries the remembered total into the next load, so the bar has a denominator", async () => {
    const first = pagedFetcher([300]);
    const a = renderHook(() => useBoardPoll(first.fn, 60_000, "k3"));
    first.release();
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    a.unmount();

    const second = pagedFetcher([150]);
    const b = renderHook(() => useBoardPoll(second.fn, 60_000, "k3"));
    await waitFor(() => expect(b.result.current.progress?.loaded).toBe(150));
    expect(b.result.current.progress?.expected).toBe(300);
    second.release();
  });
});
