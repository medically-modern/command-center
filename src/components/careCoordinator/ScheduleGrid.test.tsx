/**
 * The horizontal strip's lane packing — two calls at the same time sit one
 * above the other, never on top of each other.
 */
import { describe, it, expect } from "vitest";
import { laneFor } from "@/lib/careCoordinator/lanes";

describe("laneFor", () => {
  it("packs non-overlapping blocks into one lane and overlapping ones into more", () => {
    const out = laneFor([
      { id: "a", start: 600, end: 610 },
      { id: "b", start: 605, end: 615 },
      { id: "c", start: 610, end: 620 },
      { id: "d", start: 700, end: 710 },
    ]);
    expect(out.map((b) => `${b.id}:${b.lane}`)).toEqual(["a:0", "b:1", "c:0", "d:0"]);
  });

  it("sorts by start so an unsorted input packs the same way", () => {
    const out = laneFor([{ id: "late", start: 700, end: 710 }, { id: "early", start: 600, end: 610 }]);
    expect(out.map((b) => b.id)).toEqual(["early", "late"]);
    expect(out.every((b) => b.lane === 0)).toBe(true);
  });
});
