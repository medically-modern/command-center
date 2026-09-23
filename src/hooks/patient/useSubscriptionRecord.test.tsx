// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

/**
 * ⚠️⚠️ The patient screen's Subscription record is PAINTED from the cache and
 * never SENT from it (2026-09-23).
 *
 * A cache hit used to mean no read at all for the rest of the session, and the
 * tab's send was built on that record. The Subscription send writes every
 * board-mirrored column it holds, so a record read in the morning and sent in
 * the afternoon put the morning's Next Order, Order Type, sets, auth ids and
 * doctor back over anything written since — silently, with a green toast.
 */

const m = vi.hoisted(() => ({ byId: vi.fn() }));

vi.mock("@/lib/subscription/mondayApi", async () => ({
  ...(await vi.importActual<object>("@/lib/subscription/mondayApi")),
  fetchItemById: (...a: unknown[]) => m.byId(...a),
}));

import { useSubscriptionRecord, clearSubscriptionRecordCache } from "./useSubscriptionRecord";
import { COL } from "@/lib/subscription/mondayApi";

const item = (nextOrder: string) => ({
  id: "s1",
  name: "Test Patient",
  group: { id: "g" },
  column_values: [{ id: COL.nextOrder, text: nextOrder, value: JSON.stringify({ date: nextOrder }) }],
});

beforeEach(() => {
  vi.clearAllMocks();
  clearSubscriptionRecordCache();
});

describe("useSubscriptionRecord — the cache paints, the board decides", () => {
  it("re-reads on every open instead of trusting a record cached earlier in the session", async () => {
    m.byId.mockResolvedValue(item("2026-10-01"));
    const first = renderHook(() => useSubscriptionRecord("s1", true));
    await waitFor(() => expect(first.result.current.patient?.nextOrder).toBe("2026-10-01"));
    first.unmount();

    // Somebody moves the Next Order date on /subscription.
    m.byId.mockResolvedValue(item("2026-11-15"));
    const second = renderHook(() => useSubscriptionRecord("s1", true));

    // The cached copy paints at once — nothing blank while the read lands…
    expect(second.result.current.patient?.nextOrder).toBe("2026-10-01");
    // …and is then replaced by what the board holds now.
    await waitFor(() => expect(second.result.current.patient?.nextOrder).toBe("2026-11-15"));
    expect(m.byId).toHaveBeenCalledTimes(2);
    second.unmount();
  });

  it("a failed re-read keeps the painted record rather than hiding the form", async () => {
    m.byId.mockResolvedValue(item("2026-10-01"));
    const first = renderHook(() => useSubscriptionRecord("s1", true));
    await waitFor(() => expect(first.result.current.patient?.nextOrder).toBe("2026-10-01"));
    first.unmount();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    m.byId.mockRejectedValue(new Error("Monday 503"));
    const second = renderHook(() => useSubscriptionRecord("s1", true));
    await waitFor(() => expect(m.byId).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.patient?.nextOrder).toBe("2026-10-01");
    expect(second.result.current.error).toBe("");
    warn.mockRestore();
    second.unmount();
  });

  it("with nothing cached, a failed read is an error the screen shows", async () => {
    m.byId.mockRejectedValue(new Error("Monday 503"));
    const { result, unmount } = renderHook(() => useSubscriptionRecord("s1", true));
    await waitFor(() => expect(result.current.error).toBe("Monday 503"));
    expect(result.current.patient).toBeNull();
    unmount();
  });

  it("readFresh reads the board NOW — not the cache, not a read already in flight", async () => {
    m.byId.mockResolvedValue(item("2026-10-01"));
    const { result, unmount } = renderHook(() => useSubscriptionRecord("s1", true));
    await waitFor(() => expect(result.current.patient?.nextOrder).toBe("2026-10-01"));

    m.byId.mockResolvedValue(item("2026-12-20"));
    let fresh: Awaited<ReturnType<typeof result.current.readFresh>> | undefined;
    await act(async () => {
      fresh = await result.current.readFresh();
    });
    expect(fresh?.nextOrder).toBe("2026-12-20");
    // …and what the screen shows follows, so the rep sees what was sent.
    expect(result.current.patient?.nextOrder).toBe("2026-12-20");
    unmount();
  });

  it("readFresh refuses when the item has left the board — a send must not guess", async () => {
    m.byId.mockResolvedValue(item("2026-10-01"));
    const { result, unmount } = renderHook(() => useSubscriptionRecord("s1", true));
    await waitFor(() => expect(result.current.patient?.nextOrder).toBe("2026-10-01"));

    m.byId.mockResolvedValue(null);
    await expect(result.current.readFresh()).rejects.toThrow(/no longer on the Subscription board/);
    unmount();
  });
});
