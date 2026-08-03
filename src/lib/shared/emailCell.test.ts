import { describe, it, expect } from "vitest";
import {
  extractEmailAddress,
  isEmailAddress,
  planEmailWrite,
  readEmailCell,
} from "./emailCell";

describe("isEmailAddress", () => {
  it("accepts ordinary and machine addresses", () => {
    expect(isEmailAddress("trajkobendo@gmail.com")).toBe(true);
    expect(isEmailAddress("9299929303@rcfax.com")).toBe(true);
    expect(isEmailAddress("Amanda.Bonano-Carambot@nyulangone.org")).toBe(true);
  });

  it("rejects anything carrying whitespace", () => {
    expect(isEmailAddress(" trajkobendo@gmail.com")).toBe(false);
    expect(isEmailAddress("a@b.com c@d.com")).toBe(false);
    expect(isEmailAddress(" ")).toBe(false);
    expect(isEmailAddress("")).toBe(false);
  });
});

describe("extractEmailAddress", () => {
  it("passes a clean address through", () => {
    expect(extractEmailAddress("a@b.com")).toBe("a@b.com");
  });

  it("trims stray whitespace", () => {
    expect(extractEmailAddress("  a@b.com  ")).toBe("a@b.com");
  });

  it("unwraps the '<label> - <address>' rendering Monday returns", () => {
    // The exact string the 2026-08-03 Benefits send tried to write.
    expect(
      extractEmailAddress(" trajkobendo@gmail.com - trajkobendo@gmail.com"),
    ).toBe("trajkobendo@gmail.com");
  });

  it("takes the ADDRESS half, not the label half, when they differ", () => {
    expect(extractEmailAddress("6098537271@rcfax.com - 6098537245@rcfax.com")).toBe(
      "6098537245@rcfax.com",
    );
  });

  it("handles a label that is not an address at all", () => {
    expect(extractEmailAddress("Dr. Smith - drsmith@clinic.org")).toBe(
      "drsmith@clinic.org",
    );
  });

  it("survives a hyphenated label", () => {
    expect(
      extractEmailAddress("Anderson-Galvez Office - beena.jacob@nyulangone.org"),
    ).toBe("beena.jacob@nyulangone.org");
  });

  it("returns empty when there is no address in there", () => {
    expect(extractEmailAddress("")).toBe("");
    expect(extractEmailAddress(" ")).toBe("");
    expect(extractEmailAddress("no address here")).toBe("");
    expect(extractEmailAddress(null)).toBe("");
    expect(extractEmailAddress(undefined)).toBe("");
  });
});

describe("readEmailCell", () => {
  it("prefers the raw value's email over the rendered text", () => {
    expect(
      readEmailCell({
        text: " trajkobendo@gmail.com - trajkobendo@gmail.com",
        value: '{"text":" trajkobendo@gmail.com","email":"trajkobendo@gmail.com"}',
      }),
    ).toBe("trajkobendo@gmail.com");
  });

  it("reads the ordinary matched pair", () => {
    expect(
      readEmailCell({
        text: "beena.jacob@nyulangone.org",
        value: '{"text":"beena.jacob@nyulangone.org","email":"beena.jacob@nyulangone.org"}',
      }),
    ).toBe("beena.jacob@nyulangone.org");
  });

  it("treats a whitespace-only stored address as empty", () => {
    expect(readEmailCell({ text: " ", value: '{"text":" ","email":" "}' })).toBe("");
  });

  it("falls back to text when value is missing or unparseable", () => {
    expect(readEmailCell({ text: "a@b.com", value: null })).toBe("a@b.com");
    expect(readEmailCell({ text: "a@b.com", value: "not json" })).toBe("a@b.com");
  });

  it("does not hide a non-address the board is holding", () => {
    // Better the rep sees the junk and fixes it than the field silently blanks;
    // planEmailWrite is what stops it being written back.
    expect(readEmailCell({ text: "call the office", value: null })).toBe(
      "call the office",
    );
  });

  it("handles an empty or absent column", () => {
    expect(readEmailCell({ text: null, value: null })).toBe("");
    expect(readEmailCell(undefined)).toBe("");
    expect(readEmailCell(null)).toBe("");
  });
});

describe("planEmailWrite", () => {
  it("writes a clean address", () => {
    expect(planEmailWrite("a@b.com")).toEqual({ action: "write", email: "a@b.com" });
  });

  it("normalises the composite instead of failing the send", () => {
    expect(
      planEmailWrite(" trajkobendo@gmail.com - trajkobendo@gmail.com"),
    ).toEqual({ action: "write", email: "trajkobendo@gmail.com" });
  });

  it("clears when the caller genuinely means empty", () => {
    expect(planEmailWrite("")).toEqual({ action: "clear" });
    expect(planEmailWrite(null)).toEqual({ action: "clear" });
    expect(planEmailWrite(undefined)).toEqual({ action: "clear" });
  });

  it("clears a whitespace-only value rather than re-writing the junk", () => {
    expect(planEmailWrite(" ")).toEqual({ action: "clear" });
  });

  it("SKIPS an unreadable value rather than clearing the column", () => {
    // A fax number we can't parse is still the office's fax number. Wiping it
    // would be data loss disguised as a fix.
    expect(planEmailWrite("call the office")).toEqual({ action: "skip" });
  });
});
