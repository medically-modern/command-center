/**
 * A tab stuck behind ANOTHER tab's registration can take the phone over
 * (2026-09-23). A follower only mirrors its leader, so a stuck leader holds
 * every tab of the browser — and reloading the tab you are looking at does
 * nothing, because it just mirrors the same leader again. The escape hatch is
 * the header's phone icon (and the home badge's "Use this tab"), offered once
 * another tab has been "registering" without a break for STUCK_ELSEWHERE_MS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { PhoneSnapshot } from "@/lib/softphone/types";

const state = vi.hoisted(() => ({
  snap: null as unknown as PhoneSnapshot,
  takeOver: vi.fn(),
}));

vi.mock("@/hooks/softphone/useSoftphone", () => ({
  useSoftphone: () => ({
    ...state.snap,
    takeOver: state.takeOver,
    setRingMuted: () => {},
  }),
}));
vi.mock("@/components/AccessProvider", () => ({
  useAccessContext: () => ({ email: "rep@example.com", config: {} }),
}));
// No sign-in gate in tests: the badge treats everyone as an assigned answerer.
vi.mock("@/lib/shared/auth", () => ({ authRequired: () => false, getIdToken: () => null, onAuthChange: () => () => {} }));

import CallConnectionBadge, { OFF_ELSEWHERE_MS, STUCK_ELSEWHERE_MS } from "./CallConnectionBadge";

function snap(over: Partial<PhoneSnapshot>): PhoneSnapshot {
  return {
    leader: false,
    enabled: true,
    ringMuted: false,
    registration: "registering",
    registrationError: "Reconnecting to RingCentral…",
    lastError: null,
    rings: [],
    call: null,
    ...over,
  };
}

const phoneButton = () => screen.getAllByRole("button")[0];

beforeEach(() => {
  vi.useFakeTimers();
  state.takeOver.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("a tab stuck behind another tab's registration", () => {
  it("is offered the phone once the other tab has sat on connecting for STUCK_ELSEWHERE_MS", () => {
    state.snap = snap({});
    render(<CallConnectionBadge compact />);

    // Early on it is just "connecting" — nothing to press.
    expect(phoneButton()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(phoneButton());
    expect(state.takeOver).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(STUCK_ELSEWHERE_MS);
    });
    expect(phoneButton()).toHaveAttribute("aria-disabled", "false");
    expect(phoneButton().getAttribute("title")).toMatch(/Another tab is stuck connecting/);
    fireEvent.click(phoneButton());
    expect(state.takeOver).toHaveBeenCalledTimes(1);
  });

  it("the home badge says so in words and offers Use this tab", () => {
    state.snap = snap({});
    render(<CallConnectionBadge />);
    expect(screen.queryByText("Use this tab")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(STUCK_ELSEWHERE_MS);
    });
    expect(screen.getByText("Another tab is stuck connecting")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Use this tab"));
    expect(state.takeOver).toHaveBeenCalledTimes(1);
  });

  it("a leader that is actually retrying never trips it — each error restarts the wait", () => {
    state.snap = snap({});
    const { rerender } = render(<CallConnectionBadge compact />);
    act(() => {
      vi.advanceTimersByTime(STUCK_ELSEWHERE_MS - 5_000);
    });
    // The leader gave up an attempt and is waiting to retry, then tries again.
    state.snap = snap({ registration: "error", registrationError: "Can't reach RingCentral's phone server. Retrying…" });
    rerender(<CallConnectionBadge compact />);
    state.snap = snap({});
    rerender(<CallConnectionBadge compact />);
    act(() => {
      vi.advanceTimersByTime(STUCK_ELSEWHERE_MS - 5_000);
    });
    expect(phoneButton()).toHaveAttribute("aria-disabled", "true");
  });

  it("this tab being the one that is connecting offers nothing — there is nowhere to move it", () => {
    state.snap = snap({ leader: true });
    render(<CallConnectionBadge compact />);
    act(() => {
      vi.advanceTimersByTime(STUCK_ELSEWHERE_MS * 2);
    });
    expect(phoneButton()).toHaveAttribute("aria-disabled", "true");
  });

  it("never mid-call: a stuck tab on a call is left alone", () => {
    state.snap = snap({
      call: { callId: "c1", phone: "5555550123", direction: "outbound", status: "connected", connectedAt: 1, muted: false },
    });
    render(<CallConnectionBadge compact />);
    act(() => {
      vi.advanceTimersByTime(STUCK_ELSEWHERE_MS);
    });
    expect(phoneButton()).toHaveAttribute("aria-disabled", "true");
  });
});

describe("⚠️ a connected tab behind a tab that has NO phone at all (§5.13c)", () => {
  // Josh, 2026-09-30: connected, yet "Not connected for calls" — the tab holding
  // the phone was on a build from before he connected, and every tab mirrored it.
  it("is offered the phone after OFF_ELSEWHERE_MS instead of sitting on 'Not connected'", () => {
    state.snap = snap({ registration: "off", registrationError: null });
    render(<CallConnectionBadge />);
    expect(screen.queryByText("Use this tab")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(OFF_ELSEWHERE_MS);
    });
    expect(screen.getByText("Another tab has the phone but isn't connected")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Use this tab"));
    expect(state.takeOver).toHaveBeenCalledTimes(1);
  });

  it("the header's phone icon becomes the takeover too", () => {
    state.snap = snap({ registration: "off", registrationError: null });
    render(<CallConnectionBadge compact />);
    act(() => {
      vi.advanceTimersByTime(OFF_ELSEWHERE_MS);
    });
    expect(phoneButton()).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(phoneButton());
    expect(state.takeOver).toHaveBeenCalledTimes(1);
  });

  it("never offered by the tab that IS the phone, or mid-call", () => {
    state.snap = snap({ leader: true, registration: "off", registrationError: null });
    const { unmount } = render(<CallConnectionBadge compact />);
    act(() => {
      vi.advanceTimersByTime(OFF_ELSEWHERE_MS * 3);
    });
    expect(phoneButton()).toHaveAttribute("aria-disabled", "true");
    unmount();
    state.snap = snap({
      registration: "off",
      registrationError: null,
      call: { callId: "c1", phone: "5555550123", direction: "outbound", status: "connected", connectedAt: 1, muted: false },
    });
    render(<CallConnectionBadge compact />);
    act(() => {
      vi.advanceTimersByTime(OFF_ELSEWHERE_MS * 3);
    });
    expect(state.takeOver).not.toHaveBeenCalled();
  });
});
