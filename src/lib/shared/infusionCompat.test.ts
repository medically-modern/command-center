/**
 * The matrix is shared by Welcome Call (inline) and Final Confirm (C24), so it
 * is pinned here once rather than in either caller.
 */
import { describe, it, expect } from "vitest";
import { infusionSetIssue, infusionSetFamily } from "./infusionCompat";

describe("infusionSetFamily", () => {
  it("classifies the real board labels", () => {
    expect(infusionSetFamily('AutoSoft XC 6 mm 23"')).toBe("tandem");
    expect(infusionSetFamily('TruSteel 6 mm 23"')).toBe("tandem");
    expect(infusionSetFamily('VariSoft 13 mm 23"')).toBe("tandem");
    expect(infusionSetFamily('Contact 6 mm 23"')).toBe("ilet");
    expect(infusionSetFamily('Inset 6 mm 23"')).toBe("ilet");
    expect(infusionSetFamily('Mio Advance Clear 9 mm 23"')).toBe("medtronic");
  });

  it("returns unknown for a label it hasn't been taught", () => {
    expect(infusionSetFamily('QuickSet 18"')).toBe("unknown");
    expect(infusionSetFamily('Luer 6 mm 32"')).toBe("unknown");
  });
});

describe("infusionSetIssue", () => {
  it("passes a matching pump and set", () => {
    expect(infusionSetIssue("t:slim", 'AutoSoft XC 6 mm 23"')).toBeNull();
    expect(infusionSetIssue("iLet", 'Contact 6 mm 23"')).toBeNull();
    expect(infusionSetIssue("Minimed 780G", 'Mio Advance Clear 9 mm 23"')).toBeNull();
  });

  it("flags a set from the wrong family", () => {
    const issue = infusionSetIssue("iLet", 'TruSteel 6 mm 23"');
    expect(issue?.kind).toBe("incompatible");
    expect(issue?.detail).toContain("would ship unusable sets");
  });

  it('treats 5" tubing as Mobi-only', () => {
    expect(infusionSetIssue("Mobi", 'AutoSoft XC 6 mm 5"')).toBeNull();
    const issue = infusionSetIssue("t:slim", 'AutoSoft XC 6 mm 5"');
    expect(issue?.kind).toBe("five-inch-not-mobi");
  });

  it("stays SILENT on an unrecognised set rather than guessing", () => {
    // A set added to the board that nobody has classified must not start
    // throwing false errors at reps.
    expect(infusionSetIssue("t:slim", 'QuickSet 18"')).toBeNull();
    expect(infusionSetIssue("iLet", 'Luer 6 mm 32"')).toBeNull();
  });

  it("stays silent on blanks and unknown pumps", () => {
    expect(infusionSetIssue("", 'TruSteel 6 mm 23"')).toBeNull();
    expect(infusionSetIssue("t:slim", "")).toBeNull();
    expect(infusionSetIssue("Not Serving", 'TruSteel 6 mm 23"')).toBeNull();
  });

  it("names both sides in the headline so the rep can see the clash", () => {
    expect(infusionSetIssue("Minimed 780G", 'AutoSoft XC 6 mm 23"')?.title)
      .toBe('AutoSoft XC 6 mm 23" ✗ Minimed 780G');
  });
});
