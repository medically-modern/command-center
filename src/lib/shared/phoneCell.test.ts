import { describe, it, expect } from "vitest";
import {
  isValidUsPhone,
  phoneDigits,
  phoneRejectionReason,
  planPhoneWrite,
} from "./phoneCell";

describe("phoneDigits", () => {
  it("strips the formatting reps actually type", () => {
    // The exact string from the 2026-08-03 Welcome Call report.
    expect(phoneDigits("917-968-9304")).toBe("9179689304");
    expect(phoneDigits("(917) 656-7209")).toBe("9176567209");
    expect(phoneDigits("917.656.7209")).toBe("9176567209");
    expect(phoneDigits("917 656 7209")).toBe("9176567209");
  });

  it("passes bare digits through", () => {
    expect(phoneDigits("9179689304")).toBe("9179689304");
  });

  it("drops a US country code", () => {
    expect(phoneDigits("+1 917 968 9304")).toBe("9179689304");
    expect(phoneDigits("1-917-968-9304")).toBe("9179689304");
  });

  it("handles blank input", () => {
    expect(phoneDigits("")).toBe("");
    expect(phoneDigits(null)).toBe("");
    expect(phoneDigits(undefined)).toBe("");
  });
});

describe("isValidUsPhone", () => {
  it("accepts any format of a real 10-digit number", () => {
    expect(isValidUsPhone("917-968-9304")).toBe(true);
    expect(isValidUsPhone("(917) 656-7209")).toBe(true);
    expect(isValidUsPhone("+1 917 968 9304")).toBe(true);
  });

  it("rejects short, long and empty", () => {
    expect(isValidUsPhone("656-7209")).toBe(false);
    expect(isValidUsPhone("917-968-9304 x12")).toBe(false);
    expect(isValidUsPhone("")).toBe(false);
  });
});

describe("phoneRejectionReason", () => {
  it("passes a valid number in any format", () => {
    expect(phoneRejectionReason("917-968-9304")).toBeNull();
    expect(phoneRejectionReason("(917) 656-7209")).toBeNull();
  });

  it("treats blank as a legitimate clear, not a rejection", () => {
    expect(phoneRejectionReason("")).toBeNull();
    expect(phoneRejectionReason("   ")).toBeNull();
    expect(phoneRejectionReason(null)).toBeNull();
  });

  it("explains a short number", () => {
    expect(phoneRejectionReason("656-7209")).toContain("only 7 digits");
  });

  it("explains an extension instead of silently truncating it", () => {
    const reason = phoneRejectionReason("917-968-9304 x12");
    expect(reason).toContain("12 digits");
    expect(reason).toContain("extension");
  });

  it("explains input with no digits at all", () => {
    expect(phoneRejectionReason("call the office")).toContain("no digits");
  });
});

describe("planPhoneWrite", () => {
  it("normalises formatted input instead of letting Monday reject it", () => {
    expect(planPhoneWrite("917-968-9304")).toEqual({
      action: "write",
      phone: "9179689304",
    });
    expect(planPhoneWrite("(917) 656-7209")).toEqual({
      action: "write",
      phone: "9176567209",
    });
  });

  it("clears when the caller genuinely means empty", () => {
    expect(planPhoneWrite("")).toEqual({ action: "clear" });
    expect(planPhoneWrite("   ")).toEqual({ action: "clear" });
    expect(planPhoneWrite(null)).toEqual({ action: "clear" });
  });

  it("SKIPS an unusable number rather than aborting a bulk send", () => {
    // A 50-column verified send must not die because some stored phone has an
    // extension on it — that is the failure mode this whole module exists for.
    expect(planPhoneWrite("917-968-9304 x12")).toEqual({ action: "skip" });
    expect(planPhoneWrite("656-7209")).toEqual({ action: "skip" });
    expect(planPhoneWrite("call the office")).toEqual({ action: "skip" });
  });
});
