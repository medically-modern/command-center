/**
 * The live search hook's contract: debounce, latest-wins, no cache.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const searchPatientsLive = vi.fn();
vi.mock("@/lib/systemMgmt/mondayApi", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/systemMgmt/mondayApi")>();
  return { ...mod, searchPatientsLive: (...a: unknown[]) => searchPatientsLive(...a) };
});

import { useLiveSearch, LIVE_SEARCH_DEBOUNCE_MS, LIVE_SEARCH_REFRESH_MS } from "./useLiveSearch";
import type { SystemPatient } from "@/lib/systemMgmt/mondayApi";

const row = (name: string): SystemPatient => ({
  id: name, name, phone: "", boardId: 1, boardName: "B", groupId: "g", groupTitle: "G",
  roleRoute: "", pipelineStage: "", escalated: false, escalationText: "", escalationLevel: null,
  escalationNotes: "", hasPage: false, isCompleted: false, daysSinceStage: "", notes: "",
  stageAdvancerText: "", nextActionDate: "",
});

/** A promise the test resolves by hand, plus the AbortSignal it was given. */
function pending() {
  let resolve!: (v: SystemPatient[]) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<SystemPatient[]>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  searchPatientsLive.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useLiveSearch", () => {
  it("does not ask Monday until the debounce elapses, then once", async () => {
    const p = pending();
    searchPatientsLive.mockReturnValue(p.promise);
    const { result, rerender } = renderHook(({ q }) => useLiveSearch(q), { initialProps: { q: "jo" } });
    rerender({ q: "jos" });
    rerender({ q: "jose" });
    expect(searchPatientsLive).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(LIVE_SEARCH_DEBOUNCE_MS); });
    expect(searchPatientsLive).toHaveBeenCalledTimes(1);
    expect(searchPatientsLive.mock.calls[0][0]).toBe("jose");
    expect(result.current.searching).toBe(true);
    await act(async () => { p.resolve([row("Jose Delgado")]); });
    expect(result.current.searching).toBe(false);
    expect(result.current.results.map((r) => r.name)).toEqual(["Jose Delgado"]);
    expect(result.current.searchedQuery).toBe("jose");
  });

  it("latest wins: a slow answer to an older query never paints over a newer one", async () => {
    const first = pending();
    const second = pending();
    searchPatientsLive.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(({ q }) => useLiveSearch(q), { initialProps: { q: "jose" } });
    await act(async () => { vi.advanceTimersByTime(LIVE_SEARCH_DEBOUNCE_MS); });
    const firstSignal = searchPatientsLive.mock.calls[0][1] as AbortSignal;
    rerender({ q: "jose delgado" });
    await act(async () => { vi.advanceTimersByTime(LIVE_SEARCH_DEBOUNCE_MS); });
    expect(searchPatientsLive).toHaveBeenCalledTimes(2);
    expect(firstSignal.aborted).toBe(true);
    // Second answers first, then the stale first one lands.
    await act(async () => { second.resolve([row("Jose Delgado")]); });
    await act(async () => { first.resolve([row("Jose Delgado"), row("Joseph Odom")]); });
    expect(result.current.results.map((r) => r.name)).toEqual(["Jose Delgado"]);
    expect(result.current.searchedQuery).toBe("jose delgado");
  });

  it("asks nothing for a too-short query and clears what was on screen", async () => {
    searchPatientsLive.mockResolvedValue([row("Jose Delgado")]);
    const { result, rerender } = renderHook(({ q }) => useLiveSearch(q), { initialProps: { q: "jose" } });
    await act(async () => { vi.advanceTimersByTime(LIVE_SEARCH_DEBOUNCE_MS); });
    expect(result.current.results).toHaveLength(1);
    rerender({ q: "j" });
    expect(result.current.tooShort).toBe(true);
    expect(result.current.results).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(LIVE_SEARCH_DEBOUNCE_MS * 2); });
    expect(searchPatientsLive).toHaveBeenCalledTimes(1);
  });

  it("reports a failure instead of substituting anything older", async () => {
    searchPatientsLive.mockRejectedValue(new Error("Monday request failed (503)"));
    const { result } = renderHook(() => useLiveSearch("jose"));
    await act(async () => { vi.advanceTimersByTime(LIVE_SEARCH_DEBOUNCE_MS); });
    expect(result.current.error).toContain("503");
    expect(result.current.results).toHaveLength(0);
    expect(result.current.searching).toBe(false);
  });

  it("re-asks Monday on the refresh interval while a query is on screen", async () => {
    searchPatientsLive.mockResolvedValue([row("Jose Delgado")]);
    renderHook(() => useLiveSearch("jose"));
    await act(async () => { vi.advanceTimersByTime(LIVE_SEARCH_DEBOUNCE_MS); });
    expect(searchPatientsLive).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(LIVE_SEARCH_REFRESH_MS); });
    expect(searchPatientsLive).toHaveBeenCalledTimes(2);
    expect(searchPatientsLive.mock.calls[1][0]).toBe("jose");
  });
});
