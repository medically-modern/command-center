// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

/**
 * The two-tier read (CLAUDE.md — Patient Intake): the sidebar list is fetched
 * with LIST_COLUMN_IDS, the open patient with the full set. Both hazards named
 * in the plan before it was built are pinned here, because both fail SILENTLY:
 *
 *  1. The as-received snapshot. It is first-write-wins, so if the narrow LIST
 *     row seeded it, `getReceived` would be frozen at nine columns forever and
 *     the panes reading it (the call slot the PATIENT picked, before a rep
 *     overrode it — one column doing two jobs, §5.20) would read blank.
 *  2. Optimistic overlays. The panes render from `detail`, so an edit that only
 *     patched the list would show in the sidebar and nowhere else, while still
 *     being saved.
 *
 * Plus the rule that makes the whole thing safe: a list row is stamped
 * `partial`, and `detail` never falls back to one.
 */

const fetchGroupItems = vi.fn();
const fetchItemById = vi.fn();

vi.mock("@/lib/profile/mondayApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/profile/mondayApi")>(
    "@/lib/profile/mondayApi",
  );
  return {
    ...actual,
    hasToken: () => true,
    fetchGroupItems: (...a: unknown[]) => fetchGroupItems(...a),
    fetchItemById: (...a: unknown[]) => fetchItemById(...a),
  };
});

import { useMondayPatients } from "./useMondayPatients";
import { COL, LIST_COLUMN_IDS } from "@/lib/profile/mondayApi";

/** A row as the NARROW list read returns it: only the slim columns exist. */
function listRow(id: string, name: string) {
  return {
    id,
    name,
    group: { id: "group_mm5z87zt" },
    column_values: [
      { id: COL.attemptCounter, text: "1", value: null },
      { id: COL.referralSource, text: "Patient", value: null },
    ],
  };
}

/** The same patient as the FULL detail read returns it. */
function fullItem(id: string, name: string, callSlot: string) {
  return {
    id,
    name,
    group: { id: "group_mm5z87zt" },
    column_values: [
      { id: COL.attemptCounter, text: "1", value: null },
      { id: COL.referralSource, text: "Patient", value: null },
      { id: COL.formCallSlot, text: callSlot, value: null },
      { id: COL.dob, text: "01/02/1980", value: null },
    ],
  };
}

const OPTS = { listColumns: LIST_COLUMN_IDS };

beforeEach(() => {
  localStorage.clear();
  fetchGroupItems.mockReset();
  fetchItemById.mockReset();
  fetchGroupItems.mockResolvedValue([listRow("1", "Ann Lee")]);
  fetchItemById.mockResolvedValue(fullItem("1", "Ann Lee", "Tue 9:00 AM"));
});

afterEach(() => vi.useRealTimers());

describe("two-tier read", () => {
  it("fetches the list with the slim column set", async () => {
    renderHook(() => useMondayPatients(null, "group_mm5z87zt", OPTS));
    await waitFor(() => expect(fetchGroupItems).toHaveBeenCalled());
    expect(fetchGroupItems.mock.calls[0][2]).toBe(LIST_COLUMN_IDS);
  });

  it("still fetches the list at full width when no column set is given", async () => {
    renderHook(() => useMondayPatients(null, "group_mm5z87zt"));
    await waitFor(() => expect(fetchGroupItems).toHaveBeenCalled());
    // ProfilePage relies on this — it must be untouched by the intake change.
    expect(fetchGroupItems.mock.calls[0][2]).toBeUndefined();
  });

  it("stamps list rows partial, and the detail record not", async () => {
    const { result } = renderHook(() => useMondayPatients(null, "group_mm5z87zt", OPTS));
    await waitFor(() => expect(result.current.patients).toHaveLength(1));
    expect(result.current.patients[0].partial).toBe(true);

    act(() => result.current.loadDetail("1"));
    await waitFor(() => expect(result.current.detail).not.toBeNull());
    expect(result.current.detail?.partial).toBeUndefined();
  });

  it("leaves rows unstamped when the read was full", async () => {
    const { result } = renderHook(() => useMondayPatients(null, "group_mm5z87zt"));
    await waitFor(() => expect(result.current.patients).toHaveLength(1));
    expect(result.current.patients[0].partial).toBeUndefined();
  });
});

describe("hazard 1 — the as-received snapshot comes from the DETAIL read", () => {
  it("keeps the patient's own form answer, not the narrow row's blank", async () => {
    const { result } = renderHook(() => useMondayPatients(null, "group_mm5z87zt", OPTS));
    await waitFor(() => expect(result.current.patients).toHaveLength(1));

    // The list has already been through the hook. If it had seeded the
    // snapshot, this would be "" forever (first-write-wins).
    act(() => result.current.loadDetail("1"));
    await waitFor(() => expect(result.current.detail).not.toBeNull());

    expect(result.current.getReceived("1")?.formCallSlot).toBe("Tue 9:00 AM");
  });

  it("does not let a later board value overwrite the snapshot", async () => {
    const { result } = renderHook(() => useMondayPatients(null, "group_mm5z87zt", OPTS));
    act(() => result.current.loadDetail("1"));
    await waitFor(() => expect(result.current.detail).not.toBeNull());

    // A rep overrides the slot on the board; the next refresh must not move the
    // as-received record — it is the only surviving trace of the patient's pick.
    fetchItemById.mockResolvedValue(fullItem("1", "Ann Lee", "Thu 3:00 PM"));
    await act(async () => { await result.current.refetch(true); });

    expect(result.current.detail?.formCallSlot).toBe("Thu 3:00 PM");
    expect(result.current.getReceived("1")?.formCallSlot).toBe("Tue 9:00 AM");
  });
});

describe("hazard 2 — optimistic overlays reach the detail record", () => {
  it("patches detail as well as the list", async () => {
    const { result } = renderHook(() => useMondayPatients(null, "group_mm5z87zt", OPTS));
    act(() => result.current.loadDetail("1"));
    await waitFor(() => expect(result.current.detail).not.toBeNull());

    act(() => result.current.updateLocal("1", { dob: "09/09/1999" }));

    expect(result.current.detail?.dob).toBe("09/09/1999");
    expect(result.current.patients[0].dob).toBe("09/09/1999");
  });

  it("survives a refetch — the edit is not clobbered by Monday's older value", async () => {
    const { result } = renderHook(() => useMondayPatients(null, "group_mm5z87zt", OPTS));
    act(() => result.current.loadDetail("1"));
    await waitFor(() => expect(result.current.detail).not.toBeNull());

    act(() => result.current.updateLocal("1", { dob: "09/09/1999" }));
    await act(async () => { await result.current.refetch(true); });

    // fetchItemById still returns 01/02/1980; the overlay must win.
    expect(result.current.detail?.dob).toBe("09/09/1999");
  });
});

describe("detail never falls back to a partial row", () => {
  it("stays null and reports an error when the detail fetch fails", async () => {
    fetchItemById.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useMondayPatients(null, "group_mm5z87zt", OPTS));
    await waitFor(() => expect(result.current.patients).toHaveLength(1));

    act(() => result.current.loadDetail("1"));
    await waitFor(() => expect(result.current.detailError).toBeTruthy());

    // The row exists and is tempting to show. It must not be shown: ~95 of its
    // fields are "" because they were never read.
    expect(result.current.detail).toBeNull();
  });

  it("stays null when the item is gone from the board", async () => {
    fetchItemById.mockResolvedValue(null);
    const { result } = renderHook(() => useMondayPatients(null, "group_mm5z87zt", OPTS));
    act(() => result.current.loadDetail("1"));
    await waitFor(() => expect(result.current.detailError).toBeTruthy());
    expect(result.current.detail).toBeNull();
  });

  it("clears the open patient when selection clears", async () => {
    const { result } = renderHook(() => useMondayPatients(null, "group_mm5z87zt", OPTS));
    act(() => result.current.loadDetail("1"));
    await waitFor(() => expect(result.current.detail).not.toBeNull());

    act(() => result.current.loadDetail(null));
    expect(result.current.detail).toBeNull();
  });
});

describe("refetch keeps the open patient fresh", () => {
  it("re-reads detail on a poll, which is what the Stedi watcher relies on", async () => {
    const { result } = renderHook(() => useMondayPatients(null, "group_mm5z87zt", OPTS));
    act(() => result.current.loadDetail("1"));
    await waitFor(() => expect(result.current.detail).not.toBeNull());
    const before = fetchItemById.mock.calls.length;

    // Stedi streams its result columns in one at a time; the page polls
    // `refetch` waiting for them. The list no longer carries stedi* columns, so
    // if refetch stopped refreshing detail the reveal would never fire.
    await act(async () => { await result.current.refetch(true); });
    expect(fetchItemById.mock.calls.length).toBeGreaterThan(before);
  });

  it("does not fetch detail when nothing is open", async () => {
    const { result } = renderHook(() => useMondayPatients(null, "group_mm5z87zt", OPTS));
    await waitFor(() => expect(result.current.patients).toHaveLength(1));
    await act(async () => { await result.current.refetch(true); });
    expect(fetchItemById).not.toHaveBeenCalled();
  });

  it("re-selecting the patient already open does not refetch", async () => {
    const { result } = renderHook(() => useMondayPatients(null, "group_mm5z87zt", OPTS));
    act(() => result.current.loadDetail("1"));
    await waitFor(() => expect(result.current.detail).not.toBeNull());
    const calls = fetchItemById.mock.calls.length;

    // The page calls this from an effect keyed on the selected id, which
    // re-runs on every list re-sort.
    act(() => result.current.loadDetail("1"));
    expect(fetchItemById.mock.calls.length).toBe(calls);
  });
});

describe("a slow response cannot paint over the patient the rep moved to", () => {
  it("discards a detail response for a patient no longer selected", async () => {
    let resolveFirst: ((v: unknown) => void) | undefined;
    fetchItemById.mockImplementationOnce(
      () => new Promise((res) => { resolveFirst = res; }),
    );
    fetchItemById.mockResolvedValue(fullItem("2", "Bob Ray", "Wed 1:00 PM"));

    const { result } = renderHook(() => useMondayPatients(null, "group_mm5z87zt", OPTS));
    act(() => result.current.loadDetail("1"));      // hangs
    act(() => result.current.loadDetail("2"));      // rep moves on
    await waitFor(() => expect(result.current.detail?.id).toBe("2"));

    // Patient 1's response finally lands. It must be dropped.
    await act(async () => {
      resolveFirst?.(fullItem("1", "Ann Lee", "Tue 9:00 AM"));
      await Promise.resolve();
    });
    expect(result.current.detail?.id).toBe("2");
    expect(result.current.detail?.name).toBe("Bob Ray");
  });
});
