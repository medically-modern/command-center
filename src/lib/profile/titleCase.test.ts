// ALL-CAPS normalization for autoscraped intake data (name / address / email).
// Run: npx vitest run src/lib/profile/titleCase.test.ts
import { describe, it, expect } from "vitest";
import { titleCaseName, titleCaseAddress, normalizeEmailCase, addressWarning } from "./workflow";

describe("titleCaseName", () => {
  it("normalizes an all-caps name to First Last", () => {
    expect(titleCaseName("LAKISHA VALDEZ")).toBe("Lakisha Valdez");
  });

  it("handles hyphens and apostrophes per segment", () => {
    expect(titleCaseName("MARY-JANE O'BRIEN")).toBe("Mary-Jane O'Brien");
  });

  it("fixes Mc surnames", () => {
    expect(titleCaseName("SEAN MCDONALD")).toBe("Sean McDonald");
  });

  it("keeps roman-numeral suffixes uppercase", () => {
    expect(titleCaseName("JOHN SMITH III")).toBe("John Smith III");
  });

  it("keeps single-letter initials uppercase", () => {
    expect(titleCaseName("J SMITH")).toBe("J Smith");
  });

  it("normalizes only the shouty words in a mixed name", () => {
    expect(titleCaseName("John SMITH")).toBe("John Smith");
  });

  it("never touches an already-correct mixed-case name", () => {
    expect(titleCaseName("Sean McDonald")).toBe("Sean McDonald");
    expect(titleCaseName("Ana de la Cruz")).toBe("Ana de la Cruz");
  });

  it("handles empty input", () => {
    expect(titleCaseName("")).toBe("");
  });
});

describe("titleCaseAddress", () => {
  it("normalizes caps words but keeps short tokens (state codes, APT) caps", () => {
    expect(titleCaseAddress("1746 45TH STREET, BROOKLYN, NY 11204"))
      .toBe("1746 45th Street, Brooklyn, NY 11204");
    expect(titleCaseAddress("30 RAVINE AVENUE APT 4B, WYCKOFF, NJ, USA"))
      .toBe("30 Ravine Avenue APT 4B, Wyckoff, NJ, USA");
  });

  it("clears the addressWarning ALL-CAPS flag once normalized", () => {
    // "AVE" stays caps (3-letter exemption, same as the warning's rule) —
    // that's USPS-conventional and doesn't trip addressWarning.
    const fixed = titleCaseAddress("1504 SHERIDAN AVE, BRONX, NY 10457");
    expect(fixed).toBe("1504 Sheridan AVE, Bronx, NY 10457");
    expect(addressWarning(fixed)).toBeUndefined();
  });

  it("leaves a matcher-formatted address untouched", () => {
    const a = "1746 45th Street, Brooklyn, NY 11204";
    expect(titleCaseAddress(a)).toBe(a);
  });

  it("handles empty input", () => {
    expect(titleCaseAddress("")).toBe("");
  });
});

describe("normalizeEmailCase", () => {
  it("lowercases an all-caps email", () => {
    expect(normalizeEmailCase("JOHN.SMITH@GMAIL.COM")).toBe("john.smith@gmail.com");
  });

  it("leaves mixed-case emails as entered", () => {
    expect(normalizeEmailCase("John.Smith@gmail.com")).toBe("John.Smith@gmail.com");
  });

  it("handles empty input", () => {
    expect(normalizeEmailCase("")).toBe("");
  });
});
