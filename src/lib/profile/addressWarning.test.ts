import { describe, expect, it } from "vitest";
import { addressWarning } from "./workflow";

describe("addressWarning", () => {
  it("accepts a properly formatted address", () => {
    expect(addressWarning("1746 45th Street, Brooklyn, NY 11204")).toBeUndefined();
    expect(addressWarning("1105 Marigold Drive, Webster, NY 14580")).toBeUndefined();
  });

  it("allows short legitimate caps (state codes, USA, APT, FL 2)", () => {
    expect(addressWarning("1150 Saint Nicholas Ave FL 2, New York, NY 10032")).toBeUndefined();
    expect(addressWarning("30 Ravine Avenue, Wyckoff, NJ 07481, USA")).toBeUndefined();
    expect(addressWarning("22 Main St APT 3B, Albany, NY 12205")).toBeUndefined();
  });

  it("flags a partially ALL-CAPS address (didn't come from the matcher)", () => {
    expect(addressWarning("1746 45th Street, BROOKLYN, NY 11204")).toMatch(/ALL-CAPS/);
    expect(addressWarning("1504 SHERIDAN AVE APT 2R, Bronx, NY 10457")).toMatch(/ALL-CAPS/);
  });

  it("still flags a fully ALL-CAPS address", () => {
    expect(addressWarning("453B EFFINGHAM AVE, BRONX, NY 10473")).toMatch(/ALL-CAPS/);
  });

  it("keeps the zip checks", () => {
    expect(addressWarning("1746 45th Street, Brooklyn, NY 11204-1234")).toMatch(/XXXXX-XXXX/);
    expect(addressWarning("1746 45th Street, Brooklyn, NY")).toMatch(/5-digit zip/);
  });

  // The reported case (Brandon, 2026-08-11): a zip, no caps, and every check
  // passed — while the state was spelled out, un-abbreviated, and welded to
  // the city with no comma. The address was on its way to a shipping label.
  it("flags an address with no 2-letter state code before the zip", () => {
    expect(addressWarning("300 east 3rd street, suite 3114 Jamestown New York, 14702"))
      .toMatch(/Street, City, ST 12345/);
    expect(addressWarning("1746 45th Street, Brooklyn, New York 11204"))
      .toMatch(/Street, City, ST 12345/);
  });

  it("flags a run-on address with no commas", () => {
    expect(addressWarning("300 east 3rd street suite 3114 Jamestown New York 14702"))
      .toMatch(/Street, City, ST 12345/);
  });

  it("flags a missing city or missing street", () => {
    expect(addressWarning("1746 45th Street, 11204")).toMatch(/Street, City, ST 12345/);
    expect(addressWarning("Brooklyn, NY 11204")).toMatch(/Street, City, ST 12345/);
  });

  it("accepts territory and military codes", () => {
    expect(addressWarning("100 Calle Luna, San Juan, PR 00901")).toBeUndefined();
    expect(addressWarning("PSC 1234 Box 5678, APO, AE 09123")).toBeUndefined();
  });

  it("accepts a hand-typed address in the right shape (the matcher isn't required)", () => {
    // No patient can be stranded behind a Places lookup that won't find their
    // house — typing the canonical shape passes.
    expect(addressWarning("PO Box 412, Jamestown, NY 14701")).toBeUndefined();
  });

  it("still accepts the Places 'formatted_address' fallback with a country", () => {
    expect(addressWarning("30 Ravine Avenue, Wyckoff, NJ 07481, USA")).toBeUndefined();
    expect(addressWarning("30 Ravine Avenue, Wyckoff, NJ 07481, United States")).toBeUndefined();
  });

  it("prefers the more specific zip message over the shape message", () => {
    expect(addressWarning("300 east 3rd street, Jamestown New York, 14702-1234"))
      .toMatch(/XXXXX-XXXX/);
  });
});
