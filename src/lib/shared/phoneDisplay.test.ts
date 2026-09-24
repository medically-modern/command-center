import { describe, expect, it } from "vitest";
import { formatPhoneParen } from "./phoneDisplay";

describe("formatPhoneParen — Brandon's (xxx) xxx-xxxx (pixel-match item 2)", () => {
  it("formats ten digits whatever shape they arrive in", () => {
    expect(formatPhoneParen("5555550100")).toBe("(555) 555-0100");
    expect(formatPhoneParen("555-555-0100")).toBe("(555) 555-0100");
    expect(formatPhoneParen(" (555) 555 0100 ")).toBe("(555) 555-0100");
  });

  it("a US number with its leading 1 reads the same", () => {
    expect(formatPhoneParen("15555550100")).toBe("(555) 555-0100");
    expect(formatPhoneParen("+1 555 555 0100")).toBe("(555) 555-0100");
  });

  it("⚠️ anything it cannot read is shown as the board holds it, never mangled", () => {
    expect(formatPhoneParen("555-0100")).toBe("555-0100");
    expect(formatPhoneParen("555 555 0100 x12")).toBe("555 555 0100 x12");
  });

  it("blank is blank", () => {
    expect(formatPhoneParen("")).toBe("");
    expect(formatPhoneParen(undefined)).toBe("");
  });
});
