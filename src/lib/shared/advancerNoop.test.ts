import { describe, it, expect } from "vitest";
import { isAdvancerNoop, advancerNoopMessage, advancerNoopLogLine, ADVANCER_NOOP_TAG } from "./advancerNoop";

describe("isAdvancerNoop", () => {
  it("flags a write of the value the column already holds", () => {
    // The Betty Dillingham / Eddie Quintero case: Move to Onboarding already
    // reads "Advance to MN", so automation 7917676280 ("when status CHANGES
    // to") fires nothing and the patient never moves.
    expect(isAdvancerNoop("Advance to MN", "Advance to MN")).toBe(true);
  });

  it("does NOT flag a real advance", () => {
    expect(isAdvancerNoop("", "Advance to MN")).toBe(false);
    expect(isAdvancerNoop("Already Serving", "Advance to MN")).toBe(false);
  });

  it("treats an unreadable snapshot as unknown, never as a no-op", () => {
    // The pre-write snapshot is best-effort for stage columns. Claiming a
    // no-op here would tell a rep nothing moved when it did — worse than the
    // silence this check replaces.
    expect(isAdvancerNoop(undefined, "Advance to MN")).toBe(false);
  });

  it("makes no claim when the caller did not declare a target", () => {
    // Advancers that don't pass expectedText keep the old behaviour exactly.
    expect(isAdvancerNoop("Advance to MN", undefined)).toBe(false);
    expect(isAdvancerNoop(undefined, undefined)).toBe(false);
  });

  it("is exact, not fuzzy — a different label is a real change", () => {
    expect(isAdvancerNoop("advance to mn", "Advance to MN")).toBe(false);
    expect(isAdvancerNoop("Advance to MN ", "Advance to MN")).toBe(false);
  });

  it("catches the intake sub-stage case too", () => {
    expect(isAdvancerNoop("Profile Clean-Up", "Profile Clean-Up")).toBe(true);
    expect(isAdvancerNoop("Info Collection", "Profile Clean-Up")).toBe(false);
  });
});

describe("messages", () => {
  it("names the column and the value the rep can see on the board", () => {
    const m = advancerNoopMessage("Move to Onboarding", "Advance to MN");
    expect(m).toContain("Move to Onboarding");
    expect(m).toContain("Advance to MN");
    expect(m).toContain("already");
  });

  it("log line carries the greppable tag and the identifiers", () => {
    const l = advancerNoopLogLine("12895834887", "color_mm1zmeb3", "Move to Onboarding", "Advance to MN");
    expect(l).toContain(ADVANCER_NOOP_TAG);
    expect(l).toContain("12895834887");
    expect(l).toContain("color_mm1zmeb3");
  });
});
