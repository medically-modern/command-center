/**
 * Every "…, NY 11706" string below is a REAL `Stedi Address` (`text_mm5fqm4s`)
 * read off the live Profile Send Off board on 2026-08-19, not an invented case.
 * The audit that motivated this module is in the module header; these tests are
 * what stops it silently regressing to "nothing ever fires".
 */
import { describe, expect, it } from "vitest";
import {
  addressFormatIssue,
  foldUnitOntoStreet,
  isBenefitsCheckAddress,
} from "./addressFormat";
import { titleCaseAddress } from "./workflow";

/** What the intake page does to a Stedi address before it lands in the field. */
const asFilled = (raw: string) => foldUnitOntoStreet(titleCaseAddress(raw));

describe("foldUnitOntoStreet", () => {
  it("moves a unit segment onto the street line — the preset reps are taught", () => {
    expect(foldUnitOntoStreet("9 Brentwood Rd, Apt 6 A, Bay Shore, NY 11706"))
      .toBe("9 Brentwood Rd Apt 6 A, Bay Shore, NY 11706");
    expect(foldUnitOntoStreet("3930 Arbor Trace Dr, Unit U, Lynn Haven, FL 32444"))
      .toBe("3930 Arbor Trace Dr Unit U, Lynn Haven, FL 32444");
    expect(foldUnitOntoStreet("34-13 31 Street, 1st Floor, Astoria, NY 11106"))
      .toBe("34-13 31 Street 1st Floor, Astoria, NY 11106");
  });

  it("folds a bare unit identifier — a number, a letter, a floor", () => {
    expect(foldUnitOntoStreet("659 Conkin Rd, 2C, Binghamton, NY 13903"))
      .toBe("659 Conkin Rd 2C, Binghamton, NY 13903");
    expect(foldUnitOntoStreet("405 Park Ave, F, Rutherford, NJ 07070"))
      .toBe("405 Park Ave F, Rutherford, NJ 07070");
    expect(foldUnitOntoStreet("68 Seven Springs Mountain Rd, 301, Monroe, NY 10950"))
      .toBe("68 Seven Springs Mountain Rd 301, Monroe, NY 10950");
    expect(foldUnitOntoStreet("192 Bay 28Th St, Fl 2, Brooklyn, NY 11214"))
      .toBe("192 Bay 28Th St Fl 2, Brooklyn, NY 11214");
  });

  it("keeps a trailing country where Places puts it", () => {
    expect(foldUnitOntoStreet("30 Ravine Avenue, Apt 4B, Wyckoff, NJ 07481, USA"))
      .toBe("30 Ravine Avenue Apt 4B, Wyckoff, NJ 07481, USA");
  });

  it("leaves an already-correct address exactly as it is", () => {
    for (const a of [
      "3935 Sunset Ave, Seaford, NY 11783",
      "219 W Springfield St Apt 4, Boston, MA 02118",
      "1746 45th Street, Brooklyn, NY 11204",
      "30 Ravine Avenue, Wyckoff, NJ 07481, USA",
    ]) {
      expect(foldUnitOntoStreet(a)).toBe(a);
    }
  });

  /* The whole point of the fold is that it makes NO judgement call. A name is
     not a unit, so where it belongs is a guess — and guessing is what puts a
     parcel at the wrong door. It stays put, and the flag below reports it. */
  it("refuses to fold a middle segment that isn't a unit", () => {
    const careOf = "20 Thornton Ave, C/O Julie Vanfleet, Auburn, NY 13021";
    expect(foldUnitOntoStreet(careOf)).toBe(careOf);
  });

  it("leaves an address it doesn't fully understand alone", () => {
    // No state+zip tail — reshaping this would be guessing which part is what.
    const noZip = "9 Brentwood Rd, Apt 6 A, Bay Shore, New York";
    expect(foldUnitOntoStreet(noZip)).toBe(noZip);
    expect(foldUnitOntoStreet("")).toBe("");
  });
});

describe("addressFormatIssue", () => {
  it("says nothing about a blank or a well-formed address", () => {
    expect(addressFormatIssue("")).toBeUndefined();
    expect(addressFormatIssue("  ")).toBeUndefined();
    expect(addressFormatIssue("1746 45th Street, Brooklyn, NY 11204")).toBeUndefined();
    expect(addressFormatIssue("219 W Springfield St Apt 4, Boston, MA 02118")).toBeUndefined();
  });

  it("keeps every rule Profile Send Off already applies", () => {
    expect(addressFormatIssue("1746 45th Street, Brooklyn, NY 11204-1234")).toMatch(/XXXXX-XXXX/);
    expect(addressFormatIssue("1746 45th Street, Brooklyn, NY")).toMatch(/5-digit zip/);
    expect(addressFormatIssue("300 east 3rd street suite 3114 Jamestown New York 14702"))
      .toMatch(/Street, City, ST 12345/);
    expect(addressFormatIssue("453B EFFINGHAM AVE, BRONX, NY 10473")).toMatch(/ALL-CAPS/);
  });

  /* The new half: the app's own Cardinal guidelines (§5.17), which the intake
     page had never run. Each of these was silent before. */
  it("flags a C/O rider and names the required shape", () => {
    const issue = addressFormatIssue("20 Thornton Ave, C/O Julie Vanfleet, Auburn, NY 13021");
    expect(issue).toMatch(/C\/O Julie Vanfleet/);
    expect(issue).toMatch(/Street \+ Apt\/Suite on ONE line/);
  });

  it("flags a PO box — parcel carriers can't deliver to one", () => {
    expect(addressFormatIssue("PO Box 412, Jamestown, NY 14701")).toMatch(/PO Box/i);
  });

  it("flags a clinic name where the house number should be", () => {
    const issue = addressFormatIssue("Bassett Medical Center, Cooperstown, NY 13326");
    expect(issue).toBeDefined();
    expect(issue).toMatch(/Street \+ Apt\/Suite on ONE line/);
  });

  it("flags a unit glued onto the city — the silent-wrong-city case", () => {
    expect(addressFormatIssue("665 Saratoga Rd, Ste 400 Gansevoort, NY 12831")).toBeDefined();
  });
});

/**
 * End to end over the real board sample. Before this module every one of these
 * was accepted in silence; after it, the ones that CAN be repaired are, and the
 * ones that can't are reported.
 */
describe("a benefits-check address, as the page fills it in", () => {
  const REPAIRABLE = [
    "9 BRENTWOOD RD, APT 6 A, BAY SHORE, NY 11706",
    "34-13 31 STREET, 1ST FLOOR, ASTORIA, NY 11106",
    "405 PARK AVE, F, RUTHERFORD, NJ 07070",
    "3930 ARBOR TRACE DR, UNIT U, LYNN HAVEN, FL 32444",
    "659 Conkin Rd, 2C, Binghamton, NY 13903",
    "68 Seven Springs Mountain Rd, 301, Monroe, NY 10950",
    "192 Bay 28Th St, Fl 2, Brooklyn, NY 11214",
  ];

  it("repairs the unit-on-its-own-line shape and then has nothing to report", () => {
    for (const raw of REPAIRABLE) {
      const filled = asFilled(raw);
      expect(filled.split(",")).toHaveLength(3);
      expect(addressFormatIssue(filled)).toBeUndefined();
    }
  });

  it("still reports the one it cannot repair", () => {
    const filled = asFilled("20 Thornton Ave, C/O Julie Vanfleet, Auburn, NY 13021");
    expect(addressFormatIssue(filled)).toBeDefined();
  });

  it("leaves the already-clean ones untouched and unflagged", () => {
    for (const raw of [
      "3935 SUNSET AVE, SEAFORD, NY 11783",
      "219 W SPRINGFIELD ST APT 4, BOSTON, MA 02118",
      "1955 SEDGWICK AVE APT 5A, BRONX, NY 10453",
      "7221 GARDEN WOOD COURT, TUSCALOOSA, AL 35405",
    ]) {
      expect(addressFormatIssue(asFilled(raw))).toBeUndefined();
    }
  });
});

describe("isBenefitsCheckAddress", () => {
  it("recognises the payer's line however it was cased or folded", () => {
    const stedi = "9 BRENTWOOD RD, APT 6 A, BAY SHORE, NY 11706";
    expect(isBenefitsCheckAddress(asFilled(stedi), stedi, asFilled)).toBe(true);
    // …and without the normaliser too: the comparison ignores case and commas.
    expect(isBenefitsCheckAddress(asFilled(stedi), stedi)).toBe(true);
  });

  it("clears once the rep re-picks a different address", () => {
    expect(isBenefitsCheckAddress(
      "12 Other Street, Bay Shore, NY 11706",
      "9 BRENTWOOD RD, APT 6 A, BAY SHORE, NY 11706",
      asFilled,
    )).toBe(false);
  });

  it("is false when either side is empty — never claim provenance we don't have", () => {
    expect(isBenefitsCheckAddress("", "9 Brentwood Rd, Bay Shore, NY 11706")).toBe(false);
    expect(isBenefitsCheckAddress("9 Brentwood Rd, Bay Shore, NY 11706", "")).toBe(false);
    expect(isBenefitsCheckAddress(null, undefined)).toBe(false);
  });
});
