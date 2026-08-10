import { describe, it, expect } from "vitest";
import { splitName, joinName } from "./nameParts";

describe("splitName", () => {
  it("splits an ordinary two-part name", () => {
    expect(splitName("Richard Clark")).toEqual({ first: "Richard", last: "Clark" });
  });

  it("splits on the LAST space, so a middle name stays with the first", () => {
    expect(splitName("Mary Jane Watson")).toEqual({ first: "Mary Jane", last: "Watson" });
  });

  it("puts a single-token name in FIRST, not last", () => {
    // In `last` it would render with an empty first box, which reads as data
    // loss to the rep even though nothing was lost.
    expect(splitName("Cher")).toEqual({ first: "Cher", last: "" });
  });

  it("tolerates blank, undefined and messy whitespace", () => {
    expect(splitName("")).toEqual({ first: "", last: "" });
    expect(splitName(undefined)).toEqual({ first: "", last: "" });
    expect(splitName("   ")).toEqual({ first: "", last: "" });
    expect(splitName("  Richard   Clark  ")).toEqual({ first: "Richard", last: "Clark" });
  });
});

describe("joinName", () => {
  it("recombines with a single space", () => {
    expect(joinName({ first: "Richard", last: "Clark" })).toBe("Richard Clark");
  });

  it("leaves no trailing space when a half is cleared", () => {
    expect(joinName({ first: "Richard", last: "" })).toBe("Richard");
    expect(joinName({ first: "", last: "Clark" })).toBe("Clark");
    expect(joinName({ first: "", last: "" })).toBe("");
  });
});

describe("round trip", () => {
  // joinName's output REPLACES the Monday item name, so anything that doesn't
  // round-trip is a patient's name being quietly rewritten on save.
  it.each([
    "Richard Clark",
    "Mary Jane Watson",
    "Cher",
    "Jean-Luc Picard",
    "Ana María Ruiz",
    "Ludwig van Beethoven",
  ])("survives split → join unchanged: %s", (name) => {
    expect(joinName(splitName(name))).toBe(name);
  });

  it("normalises only the whitespace it should", () => {
    expect(joinName(splitName("  Richard   Clark "))).toBe("Richard Clark");
  });
});
