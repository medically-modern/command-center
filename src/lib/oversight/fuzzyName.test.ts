import { describe, expect, it } from "vitest";
import { fuzzyNameMatch } from "./fuzzyName";

describe("fuzzyNameMatch", () => {
  it("matches everything on an empty query", () => {
    expect(fuzzyNameMatch("Vivian Dooher", "")).toBe(true);
    expect(fuzzyNameMatch("Vivian Dooher", "   ")).toBe(true);
  });

  it("matches case-insensitive substrings", () => {
    expect(fuzzyNameMatch("Vivian Dooher", "viv")).toBe(true);
    expect(fuzzyNameMatch("Vivian Dooher", "DOOHER")).toBe(true);
    expect(fuzzyNameMatch("Vivian Dooher", "an doo")).toBe(true);
  });

  it("requires every token to match", () => {
    expect(fuzzyNameMatch("Vivian Dooher", "vivian smith")).toBe(false);
  });

  it("matches 4+ char tokens as subsequences (typo tolerance)", () => {
    expect(fuzzyNameMatch("John Smith", "jsmth")).toBe(true);
    expect(fuzzyNameMatch("Vivian Dooher", "vvian")).toBe(true);
  });

  it("does not subsequence-match short tokens", () => {
    // "dr" is a subsequence of "Dooher" but too short for fuzzy matching
    expect(fuzzyNameMatch("Vivian Dooher", "dr")).toBe(false);
  });

  it("rejects non-matches", () => {
    expect(fuzzyNameMatch("Vivian Dooher", "gonzalez")).toBe(false);
  });
});
