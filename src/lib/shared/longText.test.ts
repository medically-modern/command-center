import { describe, it, expect } from "vitest";
import {
  MONDAY_LONG_TEXT_MAX,
  assertLongTextFits,
  longTextFits,
  longTextOverflow,
} from "./longText";

const body = (n: number) => "x".repeat(n);

describe("longText — Monday's silent 2000-character truncation", () => {
  it("accepts a body exactly at the limit", () => {
    expect(longTextFits(body(MONDAY_LONG_TEXT_MAX))).toBe(true);
    expect(longTextOverflow(body(MONDAY_LONG_TEXT_MAX))).toBe(0);
    expect(() => assertLongTextFits(body(MONDAY_LONG_TEXT_MAX), "MN Workflow Notes")).not.toThrow();
  });

  it("rejects one character over", () => {
    expect(longTextFits(body(MONDAY_LONG_TEXT_MAX + 1))).toBe(false);
    expect(longTextOverflow(body(MONDAY_LONG_TEXT_MAX + 1))).toBe(1);
  });

  it("treats blank and missing bodies as fitting", () => {
    expect(longTextFits("")).toBe(true);
    expect(longTextFits(undefined)).toBe(true);
    expect(longTextFits(null)).toBe(true);
  });

  it("names the column and the exact overflow — the message has to be actionable", () => {
    // The real case that surfaced this: a rollup computed 2103 characters, the
    // write reported success, and Monday stored 2000.
    try {
      assertLongTextFits(body(2103), "MN Workflow Notes");
      throw new Error("should have thrown");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).toContain("MN Workflow Notes");
      expect(msg).toContain("103 characters");
      expect(msg).toContain("2000");
      // It must say nothing was saved — a rep who thinks a partial save
      // happened will not retype the note.
      expect(msg).toContain("nothing was saved");
    }
  });

  it("uses the singular for a one-character overflow", () => {
    expect(() => assertLongTextFits(body(2001), "Notes")).toThrow(/1 character over/);
  });
});
