import { describe, expect, it } from "vitest";
import {
  MAX_RETRY_MS,
  RETRY_STEPS_MS,
  retryAfterMs,
  retryDelayMs,
} from "./reconcileBackoff.mjs";

/**
 * The ladder exists because a failed reconcile used to cost a full hour of the
 * gateway not knowing its own subscription — long enough for the monitor to
 * page six times about an outage that wasn't happening. What it must NOT do is
 * turn a rate limit into a retry loop that keeps the rate limit alive, so both
 * halves are pinned: it recovers fast, and it gives up.
 */
describe("retryDelayMs", () => {
  it("climbs, so a stuck reconcile backs off instead of hammering", () => {
    const steps = RETRY_STEPS_MS.map((_, i) => retryDelayMs(i));
    expect(steps).toEqual([...RETRY_STEPS_MS]);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
  });

  it("retries within a minute, so one blip is one alert and not six", () => {
    expect(retryDelayMs(0)).toBeLessThanOrEqual(60_000);
  });

  // The bound is the whole safety argument: past it, the hourly pass takes over.
  it("gives up once the ladder is spent", () => {
    expect(retryDelayMs(RETRY_STEPS_MS.length)).toBeNull();
    expect(retryDelayMs(99)).toBeNull();
  });

  it("spans a sensible window in total", () => {
    const total = RETRY_STEPS_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(5 * 60_000);
    expect(total).toBeLessThan(60 * 60_000);
  });

  it("refuses a nonsense attempt rather than picking a delay", () => {
    expect(retryDelayMs(-1)).toBeNull();
    expect(retryDelayMs(1.5)).toBeNull();
    expect(retryDelayMs(undefined)).toBeNull();
  });

  // A 429 is the service saying how long it wants to be left alone. Honouring
  // it is what clears a throttle; ignoring it is what extends one.
  it("waits as long as RingCentral asked when that is longer", () => {
    expect(retryDelayMs(0, 90_000)).toBe(90_000);
  });

  it("never lets Retry-After SHORTEN the wait", () => {
    expect(retryDelayMs(4, 1_000)).toBe(RETRY_STEPS_MS[4]);
  });

  it("caps an absurd Retry-After, since the hourly pass is the backstop", () => {
    expect(retryDelayMs(0, 3_600_000)).toBe(MAX_RETRY_MS);
  });

  it("ignores a junk Retry-After instead of waiting NaN", () => {
    expect(retryDelayMs(0, NaN)).toBe(RETRY_STEPS_MS[0]);
    expect(retryDelayMs(0, "soon")).toBe(RETRY_STEPS_MS[0]);
  });
});

describe("retryAfterMs", () => {
  it("reads RingCentral's seconds", () => {
    expect(retryAfterMs("60")).toBe(60_000);
    expect(retryAfterMs(30)).toBe(30_000);
  });

  it("returns 0 for a missing header — the normal case", () => {
    expect(retryAfterMs(null)).toBe(0);
    expect(retryAfterMs(undefined)).toBe(0);
    expect(retryAfterMs("")).toBe(0);
  });

  // The HTTP-date form is legal and RingCentral doesn't use it. Guessing at one
  // would be worse than falling back to our own step.
  it("returns 0 for an HTTP-date rather than guessing", () => {
    expect(retryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT")).toBe(0);
  });

  it("returns 0 for zero or negative values", () => {
    expect(retryAfterMs("0")).toBe(0);
    expect(retryAfterMs("-5")).toBe(0);
  });
});
