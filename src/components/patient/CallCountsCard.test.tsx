/**
 * The Calls tab's "We called · They called" card — its states. Only "ready" may
 * carry numbers; every other state says what it is instead of drawing a 0.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { CallCountsCard, SLOW_AFTER_MS } from "./CallCountsCard";

afterEach(() => vi.useRealTimers());

describe("CallCountsCard", () => {
  it("draws nothing at all when there is nothing to ask", () => {
    const { container } = render(<CallCountsCard state={{ kind: "none" }} since={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("⚠️ a slow answer turns into a sentence, never a zero", () => {
    vi.useFakeTimers();
    render(<CallCountsCard state={{ kind: "waiting" }} since={null} />);
    expect(screen.getByTestId("call-counts").textContent).toContain("Counting calls");
    act(() => {
      vi.advanceTimersByTime(SLOW_AFTER_MS + 10);
    });
    const text = screen.getByTestId("call-counts").textContent ?? "";
    expect(text).toContain("haven't answered yet");
    expect(text).not.toMatch(/\d/);
  });

  it("'Never picked up yet' only when we have called, and nothing under a zero", () => {
    const { rerender } = render(
      <CallCountsCard
        state={{ kind: "ready", totals: { weCalled: 4, theyCalled: 0, total: 4, reached: false, altTotal: 0 } }}
        since={null}
      />,
    );
    expect(screen.getByTestId("call-counts").textContent).toContain("Never picked up yet");
    rerender(
      <CallCountsCard
        state={{ kind: "ready", totals: { weCalled: 0, theyCalled: 2, total: 2, reached: false, altTotal: 0 } }}
        since={null}
      />,
    );
    expect(screen.getByTestId("call-counts").textContent).not.toContain("picked up");
  });
});
