import { describe, it, expect } from "vitest";
import { computeNextOrder, effectiveNextOrder } from "./workflow";

/** Local-calendar YYYY-MM-DD — mirrors the implementation, which formats from
 *  local parts (not toISOString) so dates stay aligned with timezone-naive ET
 *  Monday values in any runtime. */
function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("computeNextOrder", () => {
  it("defaults to today (local YYYY-MM-DD) when there are no last bill dates", () => {
    expect(computeNextOrder([])).toBe(ymdLocal(new Date()));
  });

  it("returns the last bill date + 90 days", () => {
    const base = new Date(2026, 0, 1);
    base.setDate(base.getDate() + 90);
    expect(computeNextOrder(["2026-01-01"])).toBe(ymdLocal(base));
  });

  it("formats from local parts, not UTC (no east-of-UTC day rollback)", () => {
    // A bare toISOString() on local-midnight would roll this back a day in
    // east-of-UTC runtimes; the local-parts formatter keeps the calendar date.
    expect(computeNextOrder(["2026-03-15"])).toBe(ymdLocal(new Date(2026, 2, 15 + 90)));
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

  it("treats a cleared edit (\"\") as no edit and falls back, not as an empty result", () => {
    expect(effectiveNextOrder("", "2026-06-06", ["2026-01-01"])).toBe("2026-06-06");
    expect(effectiveNextOrder("", "", ["2026-01-01"])).toBe(computeNextOrder(["2026-01-01"]));
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
