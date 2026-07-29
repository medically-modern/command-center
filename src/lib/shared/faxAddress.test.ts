/**
 * The doctor Fax field writes into a Monday EMAIL column, so a bare number
 * fails the whole mutation ("Internal Server Error" → an "invalid email" toast
 * blamed on the Email box). toFaxAddress is what keeps the stored value a valid
 * address, and splitFaxAddress is what lets the rep still type just the number.
 */
import { describe, it, expect } from "vitest";
import { toFaxAddress, splitFaxAddress } from "./faxAddress";

describe("toFaxAddress", () => {
  it("turns a bare number into <digits>@rcfax.com", () => {
    expect(toFaxAddress("8653742115")).toBe("8653742115@rcfax.com");
  });

  it("strips formatting from a phone-style number", () => {
    expect(toFaxAddress("(865) 374-2115")).toBe("8653742115@rcfax.com");
    expect(toFaxAddress("865.374.2115")).toBe("8653742115@rcfax.com");
  });

  it("leaves an already-formatted @rcfax address alone", () => {
    expect(toFaxAddress("8653742115@rcfax.com")).toBe("8653742115@rcfax.com");
  });

  it("keeps a non-rcfax address the rep typed on purpose", () => {
    expect(toFaxAddress("orders@clinic.com")).toBe("orders@clinic.com");
  });

  it("trims whitespace", () => {
    expect(toFaxAddress("  8653742115  ")).toBe("8653742115@rcfax.com");
  });

  it("yields '' for empty or digit-less input rather than a stray suffix", () => {
    expect(toFaxAddress("")).toBe("");
    expect(toFaxAddress("   ")).toBe("");
    expect(toFaxAddress("---")).toBe("");
  });
});

describe("splitFaxAddress", () => {
  it("hides the suffix on a stored rcfax address", () => {
    expect(splitFaxAddress("8653742115@rcfax.com")).toEqual({ local: "8653742115", suffixed: true });
  });

  it("is case-insensitive about the suffix", () => {
    expect(splitFaxAddress("8653742115@RCFax.com")).toEqual({ local: "8653742115", suffixed: true });
  });

  it("shows a legacy bare number with the suffix implied", () => {
    expect(splitFaxAddress("8653742115")).toEqual({ local: "8653742115", suffixed: true });
  });

  it("shows some other address in full, no suffix", () => {
    expect(splitFaxAddress("orders@clinic.com")).toEqual({ local: "orders@clinic.com", suffixed: false });
  });

  it("treats a blank as an empty number, suffix implied", () => {
    expect(splitFaxAddress("")).toEqual({ local: "", suffixed: true });
  });

  it("does not strip a bare '@rcfax.com' into nothing-with-suffix", () => {
    expect(splitFaxAddress("@rcfax.com")).toEqual({ local: "@rcfax.com", suffixed: false });
  });

  it("round-trips through toFaxAddress", () => {
    const stored = "8653742115@rcfax.com";
    expect(toFaxAddress(splitFaxAddress(stored).local)).toBe(stored);
  });
});
