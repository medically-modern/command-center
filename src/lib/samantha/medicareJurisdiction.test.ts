// Tests for the Medicare A&B MAC jurisdiction helper (display-only Benefits pill
// + In-Network hazard gate). Run: npx vitest run src/lib/samantha/medicareJurisdiction.test.ts
import { describe, it, expect } from "vitest";
import {
  isMedicareABOnly, medicareJurisdictionForState, stateFromAddress, medicareJurisdictionPill,
} from "./medicareJurisdiction";

describe("isMedicareABOnly", () => {
  it("true for Medicare A&B with no secondary", () => {
    expect(isMedicareABOnly("Medicare A&B", "")).toBe(true);
    expect(isMedicareABOnly("Medicare A&B", "None")).toBe(true);
  });
  it("false once a real secondary is present", () => {
    expect(isMedicareABOnly("Medicare A&B", "NY Medicaid")).toBe(false);
    expect(isMedicareABOnly("Medicare A&B", "Medicare Supplement")).toBe(false);
  });
  it("false for any non-A&B primary", () => {
    expect(isMedicareABOnly("Fidelis Medicaid", "")).toBe(false);
    expect(isMedicareABOnly("", "")).toBe(false);
  });
});

describe("medicareJurisdictionForState", () => {
  it("maps representative states to the right MAC", () => {
    expect(medicareJurisdictionForState("NY")).toBe("A"); // Noridian JE
    expect(medicareJurisdictionForState("OH")).toBe("B"); // CGS
    expect(medicareJurisdictionForState("TX")).toBe("C"); // Palmetto
    expect(medicareJurisdictionForState("CA")).toBe("D"); // Noridian JF
    expect(medicareJurisdictionForState("wy")).toBe("D"); // case-insensitive
  });
  it("returns null for an unmapped code", () => {
    expect(medicareJurisdictionForState("ZZ")).toBeNull();
    expect(medicareJurisdictionForState("")).toBeNull();
  });
});

describe("stateFromAddress", () => {
  it("pulls the state before the ZIP", () => {
    expect(stateFromAddress("2093 Wantagh Ave, Wantagh, NY 11793")).toBe("NY");
    expect(stateFromAddress("4821 Cedar Springs Rd, Dallas, TX 75219")).toBe("TX");
    expect(stateFromAddress("1 Main St, Portland, OR 97201-1234")).toBe("OR");
  });
  it("returns '' when no state resolves", () => {
    expect(stateFromAddress("")).toBe("");
    expect(stateFromAddress("no state here")).toBe("");
  });
});

describe("medicareJurisdictionPill", () => {
  it("Medicare A&B + NY address → Jurisdiction A / Noridian JE", () => {
    expect(medicareJurisdictionPill("Medicare A&B", "None", "10 Elm St, Albany, NY 12203")).toEqual({
      jurisdiction: "A", state: "NY", contractor: "Noridian JE",
    });
  });
  it("null when a secondary is present (not A&B-only)", () => {
    expect(medicareJurisdictionPill("Medicare A&B", "NY Medicaid", "10 Elm St, Albany, NY 12203")).toBeNull();
  });
  it("null for a non-Medicare primary", () => {
    expect(medicareJurisdictionPill("Horizon BCBS", "None", "10 Elm St, Albany, NY 12203")).toBeNull();
  });
  it("null when the address state doesn't resolve", () => {
    expect(medicareJurisdictionPill("Medicare A&B", "None", "address with no state")).toBeNull();
  });
});
