/**
 * The matrix is shared by Welcome Call (inline) and Final Confirm (C24), so it
 * is pinned here once rather than in either caller.
 */
import { describe, it, expect } from "vitest";
import { infusionSetIssue, infusionSetFamily, PUMP_SET_FAMILY } from "./infusionCompat";

/** The live board vocabulary for `color_mm1x9paw`, shared by the sweeps below
 *  so the two can't drift apart. Read off the board 2026-08-31. */
const BOARD_SET_LABELS = [
  'AutoSoft XC 6 mm 23"', 'AutoSoft XC 6 mm 32"', 'AutoSoft XC 6 mm 43"',
  'AutoSoft XC 9 mm 23"', 'AutoSoft 30 13 mm 23"', 'TruSteel 6 mm 23"',
  'TruSteel 6 mm 32"', 'TruSteel 8 mm 23"', 'TruSteel 8 mm 32"',
  'VariSoft 13 mm 23"', 'VariSoft 13 mm 32"', 'VariSoft 17 mm 23"',
  'Contact 6 mm 23"', 'Inset 6 mm 23"', 'AutoSoft XC 6 mm 5"',
  'AutoSoft 90 6 mm 23"', 'AutoSoft 90 6 mm 43"', 'AutoSoft 90 9 mm 23"',
  'AutoSoft 90 9 mm 43"', 'Mio Advance Clear 9 mm 23"', 'QuickSet 18"',
  'AutoSoft XC 9 mm 43"', 'AutoSoft 30 13 mm 43"', 'Luer 6 mm 32"',
];

describe("infusionSetFamily", () => {
  it("classifies the real board labels", () => {
    expect(infusionSetFamily('AutoSoft XC 6 mm 23"')).toBe("tandem");
    expect(infusionSetFamily('TruSteel 6 mm 23"')).toBe("tandem");
    expect(infusionSetFamily('VariSoft 13 mm 23"')).toBe("tandem");
    expect(infusionSetFamily('Contact 6 mm 23"')).toBe("ilet");
    expect(infusionSetFamily('Inset 6 mm 23"')).toBe("ilet");
    expect(infusionSetFamily('Mio Advance Clear 9 mm 23"')).toBe("medtronic");
  });

  it("returns unknown only for Luer, which is a connector not a family", () => {
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

  it("flags a Luer set on a Tandem pump — reported from the floor", () => {
    // Luer is a CONNECTOR standard; Tandem pumps use t:lock, so the set cannot
    // physically attach. This returned null before 2026-08-28.
    for (const pump of ["t:slim", "Mobi"]) {
      const issue = infusionSetIssue(pump, 'Luer 6 mm 32"');
      expect(issue?.kind).toBe("incompatible");
      expect(issue?.detail).toContain("t:lock");
    }
  });

  it("classifies QuickSet as Medtronic", () => {
    expect(infusionSetFamily('QuickSet 18"')).toBe("medtronic");
    expect(infusionSetIssue("Minimed 780G", 'QuickSet 18"')).toBeNull();
    expect(infusionSetIssue("t:slim", 'QuickSet 18"')?.kind).toBe("incompatible");
  });

  it("reports an unclassified pairing as UNVERIFIED, never as silence", () => {
    // The original rule returned null here, so a rep got a clean screen that
    // looked exactly like a verified pass. Unknown must say it is unknown.
    const issue = infusionSetIssue("iLet", 'Luer 6 mm 32"');
    expect(issue?.kind).toBe("unverified");
    expect(issue?.detail).toContain("not a confirmed match");
  });

  it("leaves NO board label silently unchecked", () => {
    // The regression guard: every real set label, against every real pump,
    // must produce either a verdict or a positive "verified compatible".
    const BOARD = BOARD_SET_LABELS;
    const unclassified = BOARD.filter((l) => infusionSetFamily(l) === "unknown");
    // Only Luer, which is covered by the connector rule for Tandem and by the
    // unverified verdict elsewhere — deliberately not given a family.
    expect(unclassified).toEqual(['Luer 6 mm 32"']);

    for (const pump of ["t:slim", "Mobi", "iLet", "Minimed 780G"]) {
      for (const set of BOARD) {
        const issue = infusionSetIssue(pump, set);
        if (issue === null) {
          // Silence is only allowed for a set whose family we KNOW matches.
          expect(infusionSetFamily(set)).toBe(PUMP_SET_FAMILY[pump]);
        }
      }
    }
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

  /* The article bug: "with a iLet" reached reps on BOTH the amber and the red
   * message (2026-08-31). iLet is the one board label of the four that takes
   * "an", so this can't be fixed by hardcoding either article. */
  it("says 'an iLet' and 'a t:slim' — never 'a iLet'", () => {
    const amber = infusionSetIssue("iLet", 'Luer 6 mm 32"');
    expect(amber?.kind).toBe("unverified");
    expect(amber?.detail).toContain("with an iLet");
    expect(amber?.detail).not.toContain("a iLet");

    const red = infusionSetIssue("iLet", 'AutoSoft XC 6 mm 23"');
    expect(red?.kind).toBe("incompatible");
    expect(red?.detail).toContain("not compatible with an iLet");
    expect(red?.detail).toContain("Pick an iLet-compatible set");
    expect(red?.detail).not.toContain("a iLet");

    // The consonant pumps must keep "a".
    expect(infusionSetIssue("t:slim", 'Contact 6 mm 23"')?.detail).toContain("with a t:slim");
    expect(infusionSetIssue("Minimed 780G", 'TruSteel 6 mm 23"')?.detail)
      .toContain("with a Minimed 780G");
  });

  it("uses the right article in every message every pump can reach", () => {
    // Sweep the live board vocabulary: no message may contain "a <vowel>".
    const PUMPS = ["t:slim", "Mobi", "iLet", "Minimed 780G"];
    for (const pump of PUMPS) {
      for (const set of BOARD_SET_LABELS) {
        const detail = infusionSetIssue(pump, set)?.detail;
        if (!detail) continue;
        expect(detail, `${pump} + ${set}`).not.toMatch(/\ba [aeiou]/i);
      }
    }
  });
});
