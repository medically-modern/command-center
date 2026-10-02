import { describe, it, expect } from "vitest";
import { businessHoursBetween, formatDuration, cdBetween } from "./businessTime";
import { percentile } from "./percentile";

const t = (s: string) => Date.parse(s);
describe("business time (BT) and percentiles (P)", () => {
  it("BT-1 counts Mon 09:00 to Mon 17:00 ET as 8 business hours", () => {
    expect(businessHoursBetween(t("2026-09-14T09:00:00-04:00"), t("2026-09-14T17:00:00-04:00"))).toBeCloseTo(8);
  });
  it("BT-2 counts Fri 17:00 to Mon 09:00 ET as 16 business hours (weekend excluded)", () => {
    expect(businessHoursBetween(t("2026-09-11T17:00:00-04:00"), t("2026-09-14T09:00:00-04:00"))).toBeCloseTo(16);
  });
  it("BT-3 excludes a configured holiday (Thanksgiving 2026-11-26)", () => {
    expect(businessHoursBetween(t("2026-11-25T00:00:00-05:00"), t("2026-11-27T00:00:00-05:00"), ["2026-11-26"])).toBeCloseTo(24);
  });
  it("BT-4 counts real elapsed hours across the 2026-03-08 DST change", () => {
    expect(businessHoursBetween(t("2026-03-06T12:00:00-05:00"), t("2026-03-09T12:00:00-04:00"))).toBeCloseTo(24);
  });
  it("BT-5 returns 0 when the end is before the start", () => { expect(businessHoursBetween(10, 5)).toBe(0); });
  it("BT-6 calendar mode returns raw hours", () => { expect(businessHoursBetween(0, 48 * 3600000, [], "calendar")).toBe(48); });
  it("BT-7 formats 5 bh as '5 h' and 30 bh as '1.3 bd'", () => { expect(formatDuration(5)).toBe("5 h"); expect(formatDuration(30)).toBe("1.3 bd"); });
  it("BT-9 shows 1518 hours as 63.3 calendar days", () => { expect(cdBetween(0, 1518 * 3600000)).toBeCloseTo(63.25, 1); });
  it("P-1 nearest-rank p50 of 1..10 is 5 and p90 is 9", () => { const v = [1,2,3,4,5,6,7,8,9,10]; expect(percentile(v, 50)).toBe(5); expect(percentile(v, 90)).toBe(9); });
  it("P-2 returns null below the minimum sample", () => { expect(percentile([1, 2, 3, 4], 50, 5)).toBeNull(); });
  it("P-4 gives the same answer for unsorted input", () => { expect(percentile([9, 1, 5], 50)).toBe(5); });
});
