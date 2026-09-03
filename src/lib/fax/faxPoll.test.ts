import { describe, it, expect } from "vitest";
import { faxPollDelayMs, faxPollHorizonMs, FAX_MAX_POLLS } from "./faxPoll";

describe("faxPollDelayMs", () => {
  it("polls fast while RingCentral is still registering the fax", () => {
    expect(faxPollDelayMs(0)).toBe(5_000);
    expect(faxPollDelayMs(5)).toBe(5_000);
  });

  it("slows down as the wait gets long", () => {
    const delays = [0, 10, 20, 40].map(faxPollDelayMs);
    expect(delays).toEqual([5_000, 12_000, 30_000, 60_000]);
    // Monotonic — a schedule that sped up again would be a bug, not a tuning.
    for (let i = 1; i < FAX_MAX_POLLS; i++) {
      expect(faxPollDelayMs(i)!).toBeGreaterThanOrEqual(faxPollDelayMs(i - 1)!);
    }
  });

  it("stops, rather than polling a shared account for ever", () => {
    expect(faxPollDelayMs(FAX_MAX_POLLS)).toBeNull();
    expect(faxPollDelayMs(FAX_MAX_POLLS + 10)).toBeNull();
  });

  it("outlasts the slowest fax actually observed on this account", () => {
    // The live measurement behind this schedule (2026-09-03): the slowest Sent
    // took 1,625s and the slowest SendingFailed 991s. The OLD flat schedule
    // covered 480s and missed five of twelve — including three of four
    // failures, which are exactly what a rep is waiting to see.
    expect(faxPollHorizonMs()).toBeGreaterThan(1_625_000 / 1000 * 1000);
    expect(faxPollHorizonMs()).toBeGreaterThan(480_000);
  });

  it("buys that horizon without hammering RingCentral", () => {
    // ~4x the wall-clock of the old schedule for ~1.4x the requests. This polls
    // the shared RC account (INCIDENT_2026-08-20), so the count is the budget.
    expect(FAX_MAX_POLLS).toBeLessThanOrEqual(60);
    expect(faxPollHorizonMs() / FAX_MAX_POLLS).toBeGreaterThan(12_000);
  });
});
