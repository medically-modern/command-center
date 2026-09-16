/**
 * The horizontal strip's lane packing — two calls at the same time sit one
 * above the other, never on top of each other.
 */
import { describe, it, expect } from "vitest";
import { initialScrollLeft, laneFor, splitName } from "@/lib/careCoordinator/lanes";

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

describe("laneFor — back-to-back is NOT an overlap", () => {
  it("keeps a call ending at 3:00 and one starting at 3:00 in the same lane", () => {
    // Brandon, 2026-09-16: "If one call ends at 3:00 and the next starts at
    // 3:00, they share a row." The rule was always right; what made it look
    // broken was the old MIN_BLOCK_PCT inflating every 10-minute call to ~55
    // minutes wide, so adjacent calls really did collide.
    const out = laneFor([
      { id: "first", start: 170, end: 180 },
      { id: "second", start: 180, end: 190 },
    ]);
    expect(out.every((b) => b.lane === 0)).toBe(true);
  });

  it("still drops a real overlap of one minute into a second lane", () => {
    const out = laneFor([
      { id: "first", start: 170, end: 181 },
      { id: "second", start: 180, end: 190 },
    ]);
    expect(out.map((b) => b.lane)).toEqual([0, 1]);
  });
});

describe("splitName", () => {
  it("puts the first name on one line and everything else on the next", () => {
    expect(splitName("Debra Collins")).toEqual({ first: "Debra", last: "Collins" });
  });

  it("keeps a double surname together rather than losing one", () => {
    expect(splitName("Lisa Nelson Rivera")).toEqual({ first: "Lisa", last: "Nelson Rivera" });
  });

  it("survives one name and no name", () => {
    expect(splitName("Cher")).toEqual({ first: "Cher", last: "" });
    expect(splitName("   ")).toEqual({ first: "", last: "" });
  });
});

describe("initialScrollLeft", () => {
  const START = 7 * 60; // the strip opens at 7 AM
  const PX = 240;

  it("opens one hour before now", () => {
    // 2:40 PM with the strip starting at 7 AM: the view should begin at 1:40 PM,
    // i.e. 6h40m in = 6.667 × 240px.
    expect(Math.round(initialScrollLeft(14 * 60 + 40, START, PX))).toBe(1600);
  });

  it("never scrolls backwards past the start of the day", () => {
    expect(initialScrollLeft(7 * 60 + 15, START, PX)).toBe(0);
    expect(initialScrollLeft(2 * 60, START, PX)).toBe(0);
  });
});
