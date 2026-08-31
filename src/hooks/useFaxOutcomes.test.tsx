/**
 * The safety properties of the shared fax-outcome store.
 *
 * These are not incidental: a per-patient RingCentral read from a component
 * that re-renders on every patient switch is exactly the shape of
 * INCIDENT_2026-08-20_RINGCENTRAL.md, which throttled the whole account and
 * blocked texting for 80 minutes. What follows pins the brakes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

const fetchRecentOutboundFaxes = vi.fn();
vi.mock("@/lib/fax/ringcentralApi", () => ({
  RC_VIA_GATEWAY: true,
  fetchRecentOutboundFaxes: (...args: unknown[]) => fetchRecentOutboundFaxes(...args),
}));

import { useFaxOutcomes, __resetFaxOutcomesForTest } from "./useFaxOutcomes";

const RECORDS = [
  {
    messageStatus: "SendingFailed",
    creationTime: "2026-08-28T20:54:30.000Z",
    lastModifiedTime: "2026-08-28T21:05:48.252Z",
    to: [{ phoneNumber: "+19198435515", messageStatus: "SendingFailed", faxErrorCode: "CallFailed" }],
  },
];

function Probe({ tag }: { tag: string }) {
  const { outcomes } = useFaxOutcomes();
  return <span data-testid={tag}>{outcomes ? outcomes.get("9198435515")?.state ?? "none" : "loading"}</span>;
}

describe("useFaxOutcomes", () => {
  beforeEach(() => {
    __resetFaxOutcomesForTest();
    fetchRecentOutboundFaxes.mockReset();
    fetchRecentOutboundFaxes.mockResolvedValue(RECORDS);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("makes ONE request no matter how many badges are mounted", async () => {
    render(
      <>
        <Probe tag="a" />
        <Probe tag="b" />
        <Probe tag="c" />
        <Probe tag="d" />
        <Probe tag="e" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("a")).toHaveTextContent("failed"));
    // Five consumers, one network load — the whole point of the module store.
    expect(fetchRecentOutboundFaxes).toHaveBeenCalledTimes(1);
    for (const tag of ["b", "c", "d", "e"]) {
      expect(screen.getByTestId(tag)).toHaveTextContent("failed");
    }
  });

  it("does not re-fetch inside the TTL, however often it re-renders", async () => {
    const { rerender } = render(<Probe tag="a" />);
    await waitFor(() => expect(screen.getByTestId("a")).toHaveTextContent("failed"));
    for (let i = 0; i < 25; i++) rerender(<Probe tag="a" />);
    expect(fetchRecentOutboundFaxes).toHaveBeenCalledTimes(1);
  });

  it("keeps the last good data when RingCentral fails, and backs off the same as a success", async () => {
    render(<Probe tag="a" />);
    await waitFor(() => expect(screen.getByTestId("a")).toHaveTextContent("failed"));

    fetchRecentOutboundFaxes.mockRejectedValue(new Error("429 throttled"));
    await act(async () => {
      vi.advanceTimersByTime(130_000); // past the TTL
    });
    await waitFor(() => expect(fetchRecentOutboundFaxes).toHaveBeenCalledTimes(2));
    // The badge does not flicker off, and a failing RC is not hammered.
    expect(screen.getByTestId("a")).toHaveTextContent("failed");
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(fetchRecentOutboundFaxes).toHaveBeenCalledTimes(2);
  });

  it("skips polls while the tab is hidden, and refreshes the moment it is looked at again", async () => {
    const setHidden = (v: boolean) =>
      Object.defineProperty(document, "hidden", { value: v, configurable: true });
    try {
      render(<Probe tag="a" />);
      await waitFor(() => expect(fetchRecentOutboundFaxes).toHaveBeenCalledTimes(1));

      // Rep switches to another tab for five minutes: every poll is skipped.
      setHidden(true);
      await act(async () => {
        vi.advanceTimersByTime(300_000);
      });
      expect(fetchRecentOutboundFaxes).toHaveBeenCalledTimes(1);

      // They come back. The badge must not stay stale until the next tick.
      setHidden(false);
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await waitFor(() => expect(fetchRecentOutboundFaxes).toHaveBeenCalledTimes(2));

      // Tabbing back and forth inside the TTL costs nothing extra.
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(fetchRecentOutboundFaxes).toHaveBeenCalledTimes(2);
    } finally {
      setHidden(false);
    }
  });

  it("never calls RingCentral when there is no gateway", async () => {
    vi.resetModules();
    vi.doMock("@/lib/fax/ringcentralApi", () => ({
      RC_VIA_GATEWAY: false,
      fetchRecentOutboundFaxes,
    }));
    const mod = await import("./useFaxOutcomes");
    mod.__resetFaxOutcomesForTest();
    function Bare() {
      const { outcomes } = mod.useFaxOutcomes();
      return <span data-testid="bare">{outcomes ? "loaded" : "idle"}</span>;
    }
    render(<Bare />);
    expect(screen.getByTestId("bare")).toHaveTextContent("idle");
    expect(fetchRecentOutboundFaxes).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/fax/ringcentralApi");
  });
});
