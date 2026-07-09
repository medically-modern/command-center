import { describe, it, expect } from "vitest";
import { computeNextOrder, effectiveNextOrder } from "./workflow";

describe("computeNextOrder", () => {
  it("defaults to today (YYYY-MM-DD) when there are no last bill dates", () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expect(computeNextOrder([])).toBe(today.toISOString().slice(0, 10));
  });

  it("returns the last bill date + 90 days", () => {
    // Constructed exactly like the implementation so the assertion is TZ-agnostic.
    const base = new Date(2026, 0, 1);
    base.setDate(base.getDate() + 90);
    expect(computeNextOrder(["2026-01-01"])).toBe(base.toISOString().slice(0, 10));
  });

  it("uses the latest of multiple last bill dates", () => {
    expect(computeNextOrder(["2025-01-01", "2026-01-01", "2024-06-01"])).toBe(
      computeNextOrder(["2026-01-01"]),
    );
  });

  it("ignores blank entries", () => {
    expect(computeNextOrder(["", "2026-01-01", ""])).toBe(computeNextOrder(["2026-01-01"]));
  });
});

describe("effectiveNextOrder — the date on screen is the date that gets written", () => {
  it("prefers an explicit edit over the Monday value and the computed default", () => {
    expect(effectiveNextOrder("2026-05-05", "2026-06-06", ["2026-01-01"])).toBe("2026-05-05");
  });

  it("falls back to the existing Monday value when there is no edit", () => {
    expect(effectiveNextOrder(null, "2026-06-06", ["2026-01-01"])).toBe("2026-06-06");
  });

  it("falls back to the computed default when edit and Monday value are both empty", () => {
    expect(effectiveNextOrder(null, "", ["2026-01-01"])).toBe(computeNextOrder(["2026-01-01"]));
  });

  it("defaults to today when nothing is set and there is no last bill date", () => {
    expect(effectiveNextOrder(null, "", [])).toBe(computeNextOrder([]));
  });

  it("normalizes the result to a YYYY-MM-DD slice", () => {
    expect(effectiveNextOrder("2026-05-05T00:00:00", "", [])).toBe("2026-05-05");
  });
});
