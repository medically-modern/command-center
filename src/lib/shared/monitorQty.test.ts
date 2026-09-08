import { describe, it, expect } from "vitest";
import { coerceMonitorQty } from "./monitorQty";

describe("coerceMonitorQty", () => {
  it("keeps the two real answers", () => {
    expect(coerceMonitorQty("1")).toBe("1");
    expect(coerceMonitorQty("0")).toBe("0");
  });

  it("turns a BLANK into 0 — the whole point", () => {
    // The board's automations compare with `is equal to`, so a blank matched
    // neither the "monitor = 1" branches nor the "monitor = 0" one. 84% of the
    // Welcome Call board sat in this state on 2026-09-08.
    expect(coerceMonitorQty("")).toBe("0");
    expect(coerceMonitorQty("   ")).toBe("0");
    expect(coerceMonitorQty(null)).toBe("0");
    expect(coerceMonitorQty(undefined)).toBe("0");
  });

  it("treats any positive quantity as 1, not just a literal 1", () => {
    // Final Confirm's control is a free number input: a typed 2 matches none of
    // the four equality gates either, which is the same silent misclassification.
    expect(coerceMonitorQty("2")).toBe("1");
    expect(coerceMonitorQty("1.0")).toBe("1");
    expect(coerceMonitorQty(" 1 ")).toBe("1");
  });

  it("fails to 0 on anything unreadable, never to 1", () => {
    // 1 would ship a monitor nobody ordered; 0 at worst under-reports a value
    // that was never legible.
    expect(coerceMonitorQty("abc")).toBe("0");
    expect(coerceMonitorQty("NaN")).toBe("0");
    expect(coerceMonitorQty("-1")).toBe("0");
  });

  it("only ever returns the two strings a numeric column can be compared on", () => {
    for (const v of ["", " ", "0", "1", "2", "abc", "-3", "1.5", null, undefined]) {
      expect(["0", "1"]).toContain(coerceMonitorQty(v));
    }
  });
});
