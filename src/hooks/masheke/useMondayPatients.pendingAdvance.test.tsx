// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

/**
 * Optimistic advance hiding (see lib/masheke/pendingAdvance.ts). Both halves of
 * Josh's ask are pinned here, because each fails in a way nobody would notice:
 *
 *  1. HIDE INSTANTLY. Leaving an advanced patient in the queue for up to 30s
 *     with a live Send button is what got three patients re-sent on 2026-09-03.
 *  2. BUT COME BACK IF THE WRITE DIDN'T LAND. Hiding on a send that failed
 *     removes the patient from the only queue that would surface them — the
 *     invisibility this codebase keeps paying for (§5.10, §5.12, §7). The board
 *     decides, and it is re-asked on every poll.
 */

const fetchGroupItems = vi.fn();

vi.mock("@/lib/masheke/mondayApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/masheke/mondayApi")>(
    "@/lib/masheke/mondayApi",
  );
  return {
    ...actual,
    hasToken: () => true,
    fetchGroupItems: (...a: unknown[]) => fetchGroupItems(...a),
    fetchItemById: vi.fn(async () => null),
    writeDate: vi.fn(async () => undefined),
    writeStatusIndex: vi.fn(async () => undefined),
  };
});

import { useMondayPatients } from "./useMondayPatients";
import { PENDING_ADVANCE_TTL_MS } from "@/lib/masheke/pendingAdvance";

/** A board row at the given Stage Advancer value. */
function row(id: string, name: string, subStage: string) {
  return {
    id,
    name,
    group: { id: "group_mm1xf2jb" },
    column_values: [
      // Stage Advancer — the only column these assertions turn on.
      { id: "color_mm1wyr92", text: subStage, value: null },
      // A Next Action Date, so the hook's backfill never tries to write.
      { id: "date_mm1wadgs", text: "2026-09-03", value: null },
    ],
  };
}

const ids = (list: { id: string }[]) => list.map((p) => p.id);

beforeEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  fetchGroupItems.mockReset();
});

describe("useMondayPatients — optimistic advance", () => {
  it("drops the patient from the queue the moment the send resolves", async () => {
    fetchGroupItems.mockResolvedValue([
      row("1", "Joseph Bowser", "Evaluate MN"),
      row("2", "Robert Bianco", "Evaluate MN"),
    ]);

    const { result } = renderHook(() => useMondayPatients("evaluate"));
    await waitFor(() => expect(ids(result.current.patients)).toEqual(["1", "2"]));

    act(() => result.current.markAdvanced("1"));

    // Instant — no poll, no refetch, no waiting on Monday to index the write.
    expect(ids(result.current.patients)).toEqual(["2"]);
  });

  it("keeps them hidden while Monday still reports the OLD stage", async () => {
    // The ordinary case: the advance landed but hasn't been indexed yet, so the
    // very next poll still says "Evaluate MN". Bouncing the patient back here
    // would recreate the re-send window this exists to close.
    fetchGroupItems.mockResolvedValue([row("1", "Joseph Bowser", "Evaluate MN")]);

    const { result } = renderHook(() => useMondayPatients("evaluate"));
    await waitFor(() => expect(ids(result.current.patients)).toEqual(["1"]));

    act(() => result.current.markAdvanced("1"));
    await act(async () => { await result.current.refetch(true); });

    expect(ids(result.current.patients)).toEqual([]);
  });

  it("BRINGS THEM BACK when the advance never landed", async () => {
    // The safety half. A gateway job can fail AFTER the SPA has already treated
    // the send as successful (pollDone's 20s window closes and the job resolves
    // "submitted"), so the app is never told. The board still saying
    // "Evaluate MN" past the TTL is the only evidence that matters.
    fetchGroupItems.mockResolvedValue([row("1", "Joseph Bowser", "Evaluate MN")]);

    const { result } = renderHook(() => useMondayPatients("evaluate"));
    await waitFor(() => expect(ids(result.current.patients)).toEqual(["1"]));

    const realNow = Date.now;
    act(() => result.current.markAdvanced("1"));
    expect(ids(result.current.patients)).toEqual([]);

    try {
      Date.now = () => realNow() + PENDING_ADVANCE_TTL_MS + 1;
      await act(async () => { await result.current.refetch(true); });
    } finally {
      Date.now = realNow;
    }

    expect(ids(result.current.patients)).toEqual(["1"]);
  });

  it("stops hiding once the board confirms the new stage", async () => {
    // The marker is spent on confirmation — from then on the patient is
    // filtered out on their own merits, so a return to Evaluate MN later (a
    // manager sending them back) shows up immediately rather than being
    // swallowed by a stale marker.
    fetchGroupItems.mockResolvedValue([row("1", "Joseph Bowser", "Evaluate MN")]);
    const { result } = renderHook(() => useMondayPatients("evaluate"));
    await waitFor(() => expect(ids(result.current.patients)).toEqual(["1"]));

    act(() => result.current.markAdvanced("1"));

    // Poll 1: the advance is visible on the board.
    fetchGroupItems.mockResolvedValue([row("1", "Joseph Bowser", "Send Request")]);
    await act(async () => { await result.current.refetch(true); });
    expect(ids(result.current.patients)).toEqual([]);

    // Poll 2: a manager returned them to Evaluate MN. No marker survives.
    fetchGroupItems.mockResolvedValue([row("1", "Joseph Bowser", "Evaluate MN")]);
    await act(async () => { await result.current.refetch(true); });
    expect(ids(result.current.patients)).toEqual(["1"]);
  });

  it("never hides anyone but the patient who was sent", async () => {
    fetchGroupItems.mockResolvedValue([
      row("1", "Joseph Bowser", "Evaluate MN"),
      row("2", "Robert Bianco", "Evaluate MN"),
      row("3", "Frank Fuller", "Evaluate MN"),
    ]);
    const { result } = renderHook(() => useMondayPatients("evaluate"));
    await waitFor(() => expect(ids(result.current.patients)).toEqual(["1", "2", "3"]));

    act(() => result.current.markAdvanced("2"));
    await act(async () => { await result.current.refetch(true); });

    expect(ids(result.current.patients)).toEqual(["1", "3"]);
  });
});

describe("useMondayPatients — a deep link does not undo the hide", () => {
  it("does not re-inject a patient this session just advanced", async () => {
    // A deep-linked `?patientId=` is normally exempt from the tab's queue rules
    // and is injected whatever stage it is in. Re-injecting one we hid a moment
    // ago would hand the rep back the live Send button the hide exists to take
    // away — the exact re-press this closes.
    fetchGroupItems.mockResolvedValue([row("1", "Joseph Bowser", "Evaluate MN")]);

    const { result } = renderHook(() => useMondayPatients("evaluate", "1"));
    await waitFor(() => expect(ids(result.current.patients)).toEqual(["1"]));

    act(() => result.current.markAdvanced("1"));
    await act(async () => { await result.current.refetch(true); });

    expect(ids(result.current.patients)).toEqual([]);
  });
});
