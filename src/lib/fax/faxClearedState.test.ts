import { describe, it, expect } from "vitest";
import { faxDisplayCount, shouldMarkCleared } from "./faxClearedState";

const TODAY = "2026-06-26";
const YESTERDAY = "2026-06-25";

describe("faxDisplayCount — the reset-at-midnight latch", () => {
  it("shows 0 (Done!) for the rest of the day once cleared today, even when faxes arrive", () => {
    expect(faxDisplayCount(0, TODAY, TODAY)).toBe(0);
    expect(faxDisplayCount(3, TODAY, TODAY)).toBe(0); // new faxes suppressed while latched
  });

  it("shows the live count after midnight (cleared date no longer matches today)", () => {
    expect(faxDisplayCount(3, YESTERDAY, TODAY)).toBe(3);
  });

  it("shows the live count when never cleared", () => {
    expect(faxDisplayCount(5, null, TODAY)).toBe(5);
    expect(faxDisplayCount(0, null, TODAY)).toBe(0);
  });
});

describe("shouldMarkCleared — when to latch", () => {
  it("latches the first time the inbox hits zero today", () => {
    expect(shouldMarkCleared(0, null, TODAY)).toBe(true);
    expect(shouldMarkCleared(0, YESTERDAY, TODAY)).toBe(true);
  });

  it("does not re-write once already latched today", () => {
    expect(shouldMarkCleared(0, TODAY, TODAY)).toBe(false);
  });

  it("never latches while there are still unread faxes", () => {
    expect(shouldMarkCleared(2, null, TODAY)).toBe(false);
    expect(shouldMarkCleared(2, YESTERDAY, TODAY)).toBe(false);
    expect(shouldMarkCleared(2, TODAY, TODAY)).toBe(false);
  });
});
