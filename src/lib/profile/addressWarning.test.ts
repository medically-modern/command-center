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
});
