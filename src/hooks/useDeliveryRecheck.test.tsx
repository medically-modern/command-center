// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, renderHook } from "@testing-library/react";
import { useEffect, useState } from "react";
import { DELIVERY_RECHECK_MS, useDeliveryRecheck } from "./useDeliveryRecheck";

/**
 * The 2026-08-20 render loop. `IntakeMessages` listed this hook's result in an
 * effect's dependency array — the correct thing to write — and the hook handed
 * back a fresh object literal on every render, so the effect re-ran on every
 * render, setState'd, and re-rendered. It fired POST /messaging/conversation
 * thousands of times a second until the browser ran out of sockets, and the
 * flood pushed the shared RingCentral account over its rate limit, which took
 * the inbound-call subscription lookups down with it.
 *
 * Both halves are pinned here: the identity, and the loop it caused.
 */
describe("useDeliveryRecheck", () => {
  afterEach(() => vi.useRealTimers());

  it("hands back the SAME object across re-renders", () => {
    const { result, rerender } = renderHook(() => useDeliveryRecheck());
    const first = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(first);
    expect(result.current.cancel).toBe(first.cancel);
    expect(result.current.schedule).toBe(first.schedule);
  });

  // The regression itself, in the shape the card actually had: an effect that
  // depends on the whole hook result and sets state on every run.
  //
  // ⚠️ The CIRCUIT BREAKER is what makes this a usable test. React does not
  // abort this loop — the effect's deps genuinely changed each time, so there
  // is no "maximum update depth" to trip — and without the breaker the bug
  // reproduces as CI HANGING rather than failing, which is the one outcome
  // worse than no test. Verified against the pre-fix hook: it spins forever.
  it("does not re-run an effect that depends on the whole object", () => {
    const RUN_CAP = 10;
    let runs = 0;

    function Card() {
      const recheck = useDeliveryRecheck();
      const [, setMessages] = useState<string[]>([]);
      useEffect(() => {
        runs += 1;
        if (runs > RUN_CAP) return;
        recheck.cancel();
        // A NEW array every run, so React can never bail out on equality —
        // exactly what `setMessages([])` does in IntakeMessages.
        setMessages([]);
      }, [recheck]);
      return null;
    }

    render(<Card />);
    expect(runs).toBe(1);
  });

  it("still schedules both rechecks", () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const { result } = renderHook(() => useDeliveryRecheck());
    result.current.schedule(reload);

    vi.advanceTimersByTime(DELIVERY_RECHECK_MS[0]);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DELIVERY_RECHECK_MS[1]);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  // Cancellation is correctness, not tidiness: a timer surviving a patient
  // switch paints the previous patient's conversation into the open one.
  it("still cancels a pending recheck", () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const { result } = renderHook(() => useDeliveryRecheck());
    result.current.schedule(reload);
    result.current.cancel();

    vi.advanceTimersByTime(60_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it("cancels on unmount", () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const { result, unmount } = renderHook(() => useDeliveryRecheck());
    result.current.schedule(reload);
    unmount();

    vi.advanceTimersByTime(60_000);
    expect(reload).not.toHaveBeenCalled();
  });
});
