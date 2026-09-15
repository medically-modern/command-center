/**
 * shared/lastBillDate — what is left after the legacy family was retired.
 *
 * The `resolveLastBill` / `resolveLastBillDates` pair that used to live here
 * chose between two columns per product; since 2026-09-15 there is one (the
 * "<product> SoS Last Bill" family) and every reader names it directly. The
 * module's header carries the audit that retired the other one. This file
 * keeps the display helper honest.
 */
import { describe, it, expect } from "vitest";

import { formatLastBill } from "./lastBillDate";

describe("formatLastBill", () => {
  it("renders the board's naive-ET string as MM/DD/YYYY", () => {
    expect(formatLastBill("2024-01-01")).toBe("01/01/2024");
    expect(formatLastBill("2026-12-31")).toBe("12/31/2026");
  });

  /* ⚠️ The whole reason this is string surgery. A Date built from a naive
     board value in a non-ET runtime lands on the previous day, and the result
     reads as a real date rather than as a bug (CLAUDE.md §9). This test would
     fail on a `new Date(...).toLocaleDateString()` implementation under the
     UTC container CI runs in. */
  it("never shifts the day", () => {
    expect(formatLastBill("2024-03-01")).toBe("03/01/2024");
    expect(formatLastBill("2024-01-01T00:00:00Z")).toBe("01/01/2024");
  });

  it("returns '' for anything that is not a leading YYYY-MM-DD", () => {
    expect(formatLastBill("")).toBe("");
    expect(formatLastBill("   ")).toBe("");
    expect(formatLastBill("01/01/2024")).toBe("");
  });
});
