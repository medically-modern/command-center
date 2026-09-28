// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

/**
 * Mary Mathis, 2026-09-28. Josh proposed her stuck on the Welcome Call page —
 * which set the 15-minute pending-advance hide in his browser — then clicked
 * her in Pipeline Oversight's Manager Intervention column. The page's manager
 * views read the same Welcome Call group, so the hide refused the deep link:
 * the other escalated patients in the sidebar, and an empty panel.
 *
 * A link from Oversight or Search is PINNED (`?pin=1`) and must be shown; an
 * unpinned deep link (the Hub, the Fax panel, the dashboard — reps' doors)
 * still honours the hide, which is a rep's re-press guard.
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
    writeDate: vi.fn(async () => undefined),
  };
});

import { useMondayPatients } from "./useMondayPatients";
import { resetPendingAdvances } from "@/lib/shared/pendingAdvance";

const MARY = "12707050564";

/** A Welcome Call group row — ids only; no patient data is needed. */
function row(id: string) {
  return {
    id,
    name: `Patient ${id}`,
    group: { id: "group_mm1wvq8p" },
    column_values: [{ id: "color_mm1x7997", text: "Escalation Required", value: '{"index":0}' }],
  };
}

const ids = (list: { id: string }[]) => list.map((p) => p.id);

/** Wait for the first Monday read to COMMIT. ⚠️ Not just "Mary is listed": the
 *  previous render persisted its list to localStorage, and a new hook paints
 *  that cache before its own read lands — a test that stops there passes with
 *  the fix removed (it did, once). */
async function settle(hook: { result: { current: { initialLoading: boolean } } }) {
  await waitFor(() => expect(hook.result.current.initialLoading).toBe(false));
}

beforeEach(() => {
  resetPendingAdvances();
  localStorage.clear();
  fetchGroupItems.mockReset();
  fetchItemById.mockReset();
  fetchItemById.mockResolvedValue(null);
  fetchGroupItems.mockResolvedValue([row(MARY), row("2"), row("3"), row("4"), row("5")]);
});

/** Josh's Propose Stuck on the Welcome Call page: the ladder's done-handler marks her. */
async function proposeStuckInThisBrowser() {
  const page = renderHook(() => useMondayPatients(null));
  await waitFor(() => expect(ids(page.result.current.patients)).toContain(MARY));
  act(() => page.result.current.markAdvanced(MARY));
  expect(ids(page.result.current.patients)).not.toContain(MARY);
  page.unmount();
}

describe("Welcome Call — a pinned deep link beats this browser's hide", () => {
  it("Oversight's click (pinned) opens her although this browser just hid her", async () => {
    await proposeStuckInThisBrowser();
    const oversight = renderHook(() => useMondayPatients(MARY, MARY));
    await settle(oversight);
    expect(ids(oversight.result.current.patients)).toContain(MARY);
    // …and the other escalated patients are still there beside her.
    expect(ids(oversight.result.current.patients)).toEqual(expect.arrayContaining(["2", "3", "4", "5"]));
  });

  it("an UNPINNED deep link still honours the hide — the rep's re-press guard", async () => {
    await proposeStuckInThisBrowser();
    const hub = renderHook(() => useMondayPatients(MARY, null));
    await settle(hub);
    expect(ids(hub.result.current.patients)).toEqual(["2", "3", "4", "5"]);
  });

  it("a pinned patient she was NOT in the group for is injected past the hide", async () => {
    // e.g. a Final Decisions patient parked outside the Welcome Call group.
    await proposeStuckInThisBrowser();
    fetchGroupItems.mockResolvedValue([row("2")]);
    fetchItemById.mockResolvedValue(row(MARY));
    localStorage.clear(); // the cache would list her; this case is about the injection
    const oversight = renderHook(() => useMondayPatients(MARY, MARY));
    await settle(oversight);
    expect(ids(oversight.result.current.patients)).toContain(MARY);
  });

  it("acting on the pinned patient does not drop her from the page", async () => {
    const oversight = renderHook(() => useMondayPatients(MARY, MARY));
    await settle(oversight);
    expect(ids(oversight.result.current.patients)).toContain(MARY);
    act(() => oversight.result.current.markAdvanced(MARY));
    expect(ids(oversight.result.current.patients)).toContain(MARY);
    await act(async () => { await oversight.result.current.refetch(true); });
    expect(ids(oversight.result.current.patients)).toContain(MARY);
  });

  it("every OTHER patient on the page is still hidden by this browser's claims", async () => {
    const page = renderHook(() => useMondayPatients(null));
    await waitFor(() => expect(ids(page.result.current.patients)).toContain("2"));
    act(() => page.result.current.markAdvanced("2"));
    page.unmount();
    const oversight = renderHook(() => useMondayPatients(MARY, MARY));
    await settle(oversight);
    expect(ids(oversight.result.current.patients)).toContain(MARY);
    expect(ids(oversight.result.current.patients)).not.toContain("2");
  });
});
