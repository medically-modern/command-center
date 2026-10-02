import { describe, it, expect } from "vitest";
import { demoSnapshot } from "../__fixtures__/demoSnapshot";
import { buildV2 } from "./model";
import { DEFAULT_STEPS } from "./steps";
import { largestRemainder, pastDueShares } from "./shares";

describe("overview past-due shares (Brandon)", () => {
  it("V2-S1 the two header %s sum to 100 and each box's rows sum to its header (count and %)", () => {
    const sh = pastDueShares(buildV2(demoSnapshot(), DEFAULT_STEPS).buckets);
    if (sh.total) expect(sh.esc.pct + sh.proc.pct).toBe(100);
    for (const box of [sh.esc, sh.proc]) { expect(box.rows.reduce((n, r) => n + r.b.pastDue, 0)).toBe(box.n); expect(box.rows.reduce((n, r) => n + r.pct, 0)).toBe(box.pct); }
  });
  it("V2-S3 rows are sorted purely by Past Due, largest first (priority does not reorder)", () => {
    const sh = pastDueShares(buildV2(demoSnapshot(), DEFAULT_STEPS).buckets);
    for (const box of [sh.esc, sh.proc]) for (let i = 1; i < box.rows.length; i++) expect(box.rows[i].b.pastDue).toBeLessThanOrEqual(box.rows[i - 1].b.pastDue);
  });
  it("V2-S2 largest remainder keeps whole numbers exact", () => { expect(largestRemainder([1, 1, 1], 100)).toEqual([34, 33, 33]); expect(largestRemainder([66, 35, 4], 59).reduce((a, b) => a + b, 0)).toBe(59); });
});
