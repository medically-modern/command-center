import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import RcBusyCountdown from "./RcBusyCountdown";
import { RcBusyError, rcBusyError } from "@/lib/fax/ringcentralApi";

describe("RingCentral 'wait' countdown (Josh, 2026-10-01)", () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it("counts down and retries exactly once when it reaches zero", () => {
    const onRetry = vi.fn();
    render(<RcBusyCountdown retryAt={1_000_000 + 65_000} onRetry={onRetry} />);
    expect(screen.getByTestId("rc-busy").textContent).toContain("1:05");
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByTestId("rc-busy").textContent).toContain("0:35");
    expect(onRetry).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(40_000));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("reads the wait from the gateway's body, then Retry-After, else a minute", async () => {
    const body = new Response(JSON.stringify({ retryAfterMs: 42_000 }), { status: 429 });
    expect((await rcBusyError(body)).retryAt).toBe(1_000_000 + 42_000);
    const header = new Response("{}", { status: 429, headers: { "Retry-After": "20" } });
    expect((await rcBusyError(header)).retryAt).toBe(1_000_000 + 20_000);
    const none = new Response("nope", { status: 429 });
    const e = await rcBusyError(none);
    expect(e).toBeInstanceOf(RcBusyError);
    expect(e.retryAt).toBe(1_000_000 + 60_000);
  });

  it("is wired where call history is read", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    expect(read("src/lib/fax/ringcentralApi.ts")).toMatch(/if \(res\.status === 429\) throw await rcBusyError\(res\);/);
    expect(read("src/components/shared/CallHistoryList.tsx")).toMatch(/<RcBusyCountdown retryAt=\{busyUntil\} onRetry=\{\(\) => void load\(\)\} \/>/);
    expect(read("src/components/welcomeCall/PatientActivityCard.tsx")).toMatch(/<RcBusyCountdown retryAt=\{busyUntil\} onRetry=\{reload\} \/>/);
  });
});
