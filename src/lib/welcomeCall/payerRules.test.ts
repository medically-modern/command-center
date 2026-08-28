import { describe, it, expect } from "vitest";
import {
  payerInfusionCap,
  payerCapNote,
  supplyLengthDays,
  isMedicaidPlan,
  supplyLengthNote,
  DEFAULT_INFUSION_CAP,
} from "./payerRules";

describe("payerInfusionCap", () => {
  it("caps Aetna at 4", () => {
    expect(payerInfusionCap("Aetna Commercial")).toEqual({ cap: 4, payerLabel: "Aetna" });
    expect(payerInfusionCap("Aetna Medicare").cap).toBe(4);
  });

  it("caps the Blue family at 9", () => {
    for (const p of ["Horizon BCBS", "BCBS TN", "BCBS FL", "BCBS WY"]) {
      expect(payerInfusionCap(p).cap).toBe(9);
    }
  });

  it("matches every Anthem plan on the board", () => {
    for (const p of [
      "Anthem BCBS Commercial",
      "Anthem BCBS Medicare",
      "Anthem BCBS Medicaid (JLJ)",
      "Anthem BCBS Low-Cost (JLJ)",
    ]) {
      expect(payerInfusionCap(p)).toEqual({ cap: 9, payerLabel: "Anthem" });
    }
  });

  it("gives Anthem precedence over the generic BCBS pattern", () => {
    // Both patterns match "Anthem BCBS Commercial". Anthem is listed first, so
    // it wins. Same number today — pinned so a future change to either is loud.
    expect(payerInfusionCap("Anthem BCBS Commercial").payerLabel).toBe("Anthem");
  });

  it("falls back to the conservative default for unrecognised payers", () => {
    for (const p of ["Medicare A&B", "NYSHIP", "Humana", "Cigna", "Fidelis Medicaid", "UMR", ""]) {
      expect(payerInfusionCap(p)).toEqual({ cap: DEFAULT_INFUSION_CAP, payerLabel: null });
    }
  });

  it("names the payer in the note when one matched, and doesn't when it didn't", () => {
    expect(payerCapNote(payerInfusionCap("Aetna Commercial"))).toBe("Aetna caps infusion sets at 4 per order.");
    expect(payerCapNote(payerInfusionCap("Humana"))).toContain("can be lowered, not raised");
  });
});

describe("supply length", () => {
  it("shortens to 60 days for a Medicaid primary", () => {
    expect(supplyLengthDays("Medicaid", "")).toBe(60);
    expect(supplyLengthDays("United Medicaid", "")).toBe(60);
    expect(supplyLengthDays("Fidelis Medicaid", "")).toBe(60);
  });

  it("shortens to 60 days when Medicaid is only the SECONDARY", () => {
    // A commercial primary with Medicaid secondary still bills at the Medicaid
    // cadence — the rule reads both columns.
    expect(supplyLengthDays("Aetna Commercial", "NY Medicaid")).toBe(60);
    expect(isMedicaidPlan("Aetna Commercial", "NY Medicaid")).toBe(true);
  });

  it("is 90 days for everyone else", () => {
    expect(supplyLengthDays("Medicare A&B", "")).toBe(90);
    expect(supplyLengthDays("Aetna Commercial", "Medicare Supplement")).toBe(90);
    expect(supplyLengthDays("", "")).toBe(90);
  });

  it("is case-insensitive", () => {
    expect(supplyLengthDays("MEDICAID", "")).toBe(60);
  });

  it("words the note the way the prototype did", () => {
    expect(supplyLengthNote("Medicaid", "")).toBe("Medicaid — 60 day supply");
    expect(supplyLengthNote("Humana", "")).toBe("90 day supply");
  });
});
