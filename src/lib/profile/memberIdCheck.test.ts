import { describe, it, expect } from "vitest";
import { checkMemberIdReentry, normalizeMemberId } from "./memberIdCheck";

describe("normalizeMemberId", () => {
  it("upper-cases and strips cosmetic separators", () => {
    expect(normalizeMemberId("74373-5619")).toBe("743735619");
    expect(normalizeMemberId(" jlj730667355 ")).toBe("JLJ730667355");
    expect(normalizeMemberId("8FS 0017 985301")).toBe("8FS0017985301");
  });

  it("treats null/undefined as empty", () => {
    expect(normalizeMemberId(null)).toBe("");
    expect(normalizeMemberId(undefined)).toBe("");
  });
});

describe("checkMemberIdReentry", () => {
  it("flags the Raska case — prescriber name re-entered over the verified ID", () => {
    // Item 12624053600, 2026-07-24. Stedi confirmed coverage on 743735619;
    // the re-entry field received the prescriber's name instead.
    const check = checkMemberIdReentry({
      memberId1: "LINDSAY GAETANI",
      workingMemberId: "743735619",
    });
    expect(check.mismatch).toBe(true);
    expect(check.verified).toBe("743735619");
    expect(check.entered).toBe("LINDSAY GAETANI");
  });

  it("passes a matching re-entry", () => {
    expect(
      checkMemberIdReentry({ memberId1: "743735619", workingMemberId: "743735619" }).mismatch,
    ).toBe(false);
  });

  it("does not flag cosmetic formatting differences", () => {
    expect(
      checkMemberIdReentry({ memberId1: "74373-5619", workingMemberId: "743735619" }).mismatch,
    ).toBe(false);
    expect(
      checkMemberIdReentry({ memberId1: "jlj730667355", workingMemberId: "JLJ730667355" }).mismatch,
    ).toBe(false);
    expect(
      checkMemberIdReentry({ memberId1: "  743735619  ", workingMemberId: "743735619" }).mismatch,
    ).toBe(false);
  });

  it("flags a genuinely different ID, not just non-numeric junk", () => {
    // A transposed digit is the quiet failure this is really for.
    expect(
      checkMemberIdReentry({ memberId1: "743735691", workingMemberId: "743735619" }).mismatch,
    ).toBe(true);
  });

  it("stays quiet when there is nothing authoritative to compare against", () => {
    // Pre-redesign items have no working Member ID.
    expect(
      checkMemberIdReentry({ memberId1: "743735619", workingMemberId: "" }).mismatch,
    ).toBe(false);
    expect(
      checkMemberIdReentry({ memberId1: "743735619", workingMemberId: null }).mismatch,
    ).toBe(false);
  });

  it("stays quiet on a blank re-entry — the send-off checklist owns that", () => {
    expect(
      checkMemberIdReentry({ memberId1: "", workingMemberId: "743735619" }).mismatch,
    ).toBe(false);
    expect(
      checkMemberIdReentry({ memberId1: "   ", workingMemberId: "743735619" }).mismatch,
    ).toBe(false);
  });
});
