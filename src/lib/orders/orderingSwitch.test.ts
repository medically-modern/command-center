import { describe, it, expect, vi, beforeEach } from "vitest";

const api = vi.hoisted(() => ({
  readColumnText: vi.fn(),
  writeStatusIndex: vi.fn(),
}));
vi.mock("./mondayApi", async () => {
  const actual = await vi.importActual<typeof import("./mondayApi")>("./mondayApi");
  return { ...actual, readColumnText: api.readColumnText, writeStatusIndex: api.writeStatusIndex };
});

import { ORDERING_FROM_COMMAND_CENTER } from "./config";
import { canMarkOrdered, markOrdered, placeabilityReason } from "./mondayWrite";

/**
 * Josh, 2026-09-15: observation only — orders are still placed on the board.
 * This test is the reminder that flipping the switch is a DECISION, taken
 * with CLAUDE.md §5.35's checklist read, not a stray edit. Update it when the
 * decision is made.
 */
describe("the ordering switch", () => {
  it("is OFF", () => {
    expect(ORDERING_FROM_COMMAND_CENTER).toBe(false);
  });

  it("refuses to write while off, without touching Monday", async () => {
    await expect(markOrdered("1")).rejects.toThrow(/not switched on/);
    expect(api.readColumnText).not.toHaveBeenCalled();
    expect(api.writeStatusIndex).not.toHaveBeenCalled();
  });
});

describe("what may be placed — the guard the write will run behind", () => {
  beforeEach(() => {
    api.readColumnText.mockReset();
    api.writeStatusIndex.mockReset();
  });

  it("only an order sitting at “Order”", () => {
    expect(canMarkOrdered("Order")).toBe(true);
    expect(canMarkOrdered("Ordered")).toBe(false);
    expect(canMarkOrdered("Process Claim")).toBe(false);
    expect(canMarkOrdered("Paid Cash")).toBe(false);
    expect(canMarkOrdered("On Hold")).toBe(false);
    expect(canMarkOrdered("Stuck")).toBe(false);
    expect(canMarkOrdered("Return in Progress")).toBe(false);
    expect(canMarkOrdered("")).toBe(false);
    expect(canMarkOrdered("Something New")).toBe(false);
  });

  it("says why, in a sentence a rep can read", () => {
    expect(placeabilityReason("Process Claim")).toMatch(/already been placed/);
    expect(placeabilityReason("On Hold")).toMatch(/on hold/);
    expect(placeabilityReason("Order")).toBe("");
  });
});
