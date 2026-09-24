/**
 * The State line on the Care Coordinator card (Brandon, 2026-09-24).
 *
 * Fixtures are the SHAPES measured on the live boards that day — the form's
 * State column over 106 rows, and the Welcome Call address over 300 — with the
 * street and zip digits replaced. See `usState.ts` for the counts.
 */
import { describe, it, expect } from "vitest";
import { stateCode, stateFromAddress, stateLabel } from "./usState";

describe("stateCode — the web form's State answer", () => {
  it.each([
    ["Florida", "FL"],
    ["florida", "FL"],
    ["maryland", "MD"],
    ["New York", "NY"],
    ["South Carolina", "SC"],
    ["North Carolina", "NC"],
    ["West Virginia", "WV"],
    ["Washington", "WA"],
  ])("reads the full name %s as %s", (raw, code) => {
    expect(stateCode(raw)).toBe(code);
  });

  it.each([["AZ"], ["FL"], ["WY"], ["SD"], ["NC"]])("keeps the code %s", (raw) => {
    expect(stateCode(raw)).toBe(raw);
  });

  it("upper-cases a lower-case code", () => {
    expect(stateCode("ny")).toBe("NY");
  });

  it("reads the same patient the same whichever shape the form wrote", () => {
    // Ann Hawkins's row was created with `WA` and a later step rewrote it to
    // `Washington` — one answer, two spellings.
    expect(stateCode("WA")).toBe(stateCode("Washington"));
  });

  it("reads a state with the spaces or a zip stuck to it", () => {
    expect(stateCode("Newyork 10950")).toBe("NY");
    expect(stateCode("NY 10950")).toBe("NY");
  });

  it("prints anything else VERBATIM — never a guess, never dropped", () => {
    // Not a US state. N/A would claim they told us nothing.
    expect(stateCode("Ontario")).toBe("Ontario");
    expect(stateCode("  somewhere   odd ")).toBe("somewhere odd");
    // Two letters that are not a code we know are not a state either.
    expect(stateCode("ZZ")).toBe("ZZ");
  });

  it("blank is blank, which the card renders as N/A", () => {
    expect(stateCode("")).toBe("");
    expect(stateCode(null)).toBe("");
    expect(stateCode(undefined)).toBe("");
    expect(stateLabel(stateCode(""))).toBe("N/A");
    expect(stateLabel("NY")).toBe("NY");
  });
});

describe("stateFromAddress — the Welcome Call board's patient Address", () => {
  it.each([
    ["1 Main St, Brooklyn, NY 11201, US", "NY"],
    ["1 Main St, Hoboken, NJ 07030, USA", "NJ"],
    ["1 Main St, Albany, NY 12207, United States", "NY"],
    ["1 Main St, Rochester, NY 14604", "NY"],
    ["1 Main St, Albany, NY, USA", "NY"],
    ["1 Main St, Houston, TX, 77001", "TX"],
    ["1 Main St, Washington, DC 20001", "DC"],
    ["1 Main St, suite 100 Jamestown New York, 14701", "NY"],
    ["1 Main St, Olympia WA 98501", "WA"],
    ["1 Main St, Albany, ny 12207", "NY"],
  ])("reads %s as %s", (raw, code) => {
    expect(stateFromAddress(raw)).toBe(code);
  });

  // The shapes of the seven live addresses (of 297 non-blank) the first cut
  // could not read, 2026-09-24 — every one of them a real patient's state.
  // After this all 297 resolve.
  it.each([
    // A zip with a digit missing.
    ["1 Main St, Kansas City, MO 6410", "MO"],
    // No commas at all between street, city and state, state lower-cased.
    ["12 Main ave Apt 9B Bronx Ny 10451", "NY"],
    // A country typed after the zip with no comma before it.
    ["1 Main St, Albany, NY 12207-1234 US", "NY"],
    ["1 Main St, Hoboken, NJ 07030 United States", "NJ"],
    ["1 Main St, Brooklyn, NY 11201 US", "NY"],
    ["1 Main St, Brooklyn, NY 11201  US", "NY"],
  ])("reads the live shape %s as %s", (raw, code) => {
    expect(stateFromAddress(raw)).toBe(code);
  });

  it("never reads a state out of the STREET", () => {
    // The walk stops at the first segment that is not a country or a zip, and
    // a street line in that position is not a state however it is spelled.
    expect(stateFromAddress("123 Virginia Ave")).toBe("");
    expect(stateFromAddress("123 Main St NE")).toBe("");
    expect(stateFromAddress("1 Main St, Apt 3B")).toBe("");
    // A state name mid-segment is a street, not a state.
    expect(stateFromAddress("12 Washington St, Hoboken")).toBe("");
  });

  it("prefers the longest name, so West Virginia is not Virginia", () => {
    expect(stateFromAddress("1 Main St, Morgantown West Virginia, 26505")).toBe("WV");
  });

  it("an address with no readable state is blank, which the card renders as N/A", () => {
    expect(stateFromAddress("")).toBe("");
    expect(stateFromAddress(null)).toBe("");
    expect(stateFromAddress("1 Main St, Somewhere")).toBe("");
    expect(stateFromAddress("1 Main St, Somewhere, ZZ 12345")).toBe("");
  });
});
