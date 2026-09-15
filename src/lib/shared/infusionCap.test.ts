/**
 * The payer strings here are the LIVE Primary Insurance labels of
 * `color_mm1x157j` and the live Referral Source labels of `color_mm1w5wxr`
 * (both read back 2026-09-15), not invented ones.
 */
import { describe, it, expect } from "vitest";

import {
  payerInfusionCap,
  infusionSetCap,
  infusionSetTotal,
  DEFAULT_INFUSION_CAP,
} from "./infusionCap";

describe("infusionSetCap — the payer half", () => {
  it("raises the three 9-payers", () => {
    expect(infusionSetCap("Anthem BCBS Commercial", "").cap).toBe(9);
    expect(infusionSetCap("Horizon BCBS", "").cap).toBe(9);
    expect(infusionSetCap("Cigna", "").cap).toBe(9);
  });

  it("gives Aetna 4", () => {
    expect(infusionSetCap("Aetna Commercial", "")).toEqual({ cap: 4, payerLabel: "Aetna" });
    expect(infusionSetCap("Aetna Medicare", "").cap).toBe(4);
  });

  // ⚠️ `anthem.*commercial`, never `anthem` — the other three Anthem plans are 3.
  it("does not raise the other Anthem plans", () => {
    for (const p of ["Anthem BCBS Medicare", "Anthem BCBS Medicaid (JLJ)", "Anthem BCBS Low-Cost (JLJ)"]) {
      expect(infusionSetCap(p, ""), p).toEqual({ cap: DEFAULT_INFUSION_CAP, payerLabel: null });
    }
  });

  // ⚠️ No generic BCBS rule.
  it("does not raise BCBS TN/FL/WY", () => {
    for (const p of ["BCBS TN", "BCBS FL", "BCBS WY"]) {
      expect(infusionSetCap(p, "").cap, p).toBe(DEFAULT_INFUSION_CAP);
    }
  });

  it("falls to the conservative default for an unknown payer", () => {
    for (const p of ["", "Humana", "Medicare A&B", "Fidelis Medicaid", "Health Plans Inc (PHCS)"]) {
      expect(infusionSetCap(p, "").cap, p).toBe(DEFAULT_INFUSION_CAP);
    }
  });
});

/**
 * ⚠️ CareCentrix is the Referral SOURCE, not a payer — Primary Insurance has no
 * such label. All 33 live CareCentrix referrals are Horizon BCBS, which is why
 * this dimension AGREES with the payer list rather than replacing it.
 */
describe("infusionSetCap — the CareCentrix referral route", () => {
  it("raises an otherwise-default payer to 9", () => {
    expect(infusionSetCap("Humana", "CareCentrix")).toEqual({ cap: 9, payerLabel: "CareCentrix" });
  });

  it("is a no-op on the live population, which is all Horizon", () => {
    expect(infusionSetCap("Horizon BCBS", "CareCentrix").cap).toBe(9);
    expect(infusionSetCap("Horizon BCBS", "").cap).toBe(9);
  });

  // The HIGHER of the two wins — each is an independent statement.
  it("never LOWERS a cap the payer already earned", () => {
    expect(infusionSetCap("Anthem BCBS Commercial", "Doctor").cap).toBe(9);
    expect(infusionSetCap("Aetna Commercial", "Tandem").cap).toBe(4);
  });

  // ⚠️ A cap set too high is the dangerous direction, so every other source is 3.
  it("does not raise any other referral source", () => {
    for (const src of ["Patient", "Tandem", "Beta Bionics", "Doctor", "SNJ", "SNJ [2.0]", "Wellstart", "Solace Advocates", "District Endocrine", ""]) {
      expect(infusionSetCap("Humana", src).cap, src).toBe(DEFAULT_INFUSION_CAP);
    }
  });

  it("keeps the payer-only helper payer-only", () => {
    expect(payerInfusionCap("Humana").cap).toBe(DEFAULT_INFUSION_CAP);
  });
});

describe("infusionSetTotal", () => {
  // ⚠️ THE POINT OF THE RULE: neither slot breaks its own cap, the pair does.
  it("catches 3 + 3 on a default payer", () => {
    const v = infusionSetTotal("3", "3", "Humana", "Doctor");
    expect(v).toEqual({ total: 6, cap: 3, payerLabel: null, over: true });
  });

  it("allows the same order for a 9-payer and for a CareCentrix referral", () => {
    expect(infusionSetTotal("3", "3", "Horizon BCBS", "").over).toBe(false);
    expect(infusionSetTotal("3", "3", "Humana", "CareCentrix").over).toBe(false);
  });

  it("is a strict over, so exactly the cap passes", () => {
    expect(infusionSetTotal("3", "", "Humana", "").over).toBe(false);
    expect(infusionSetTotal("4", "", "Humana", "").over).toBe(true);
    expect(infusionSetTotal("4", "", "Aetna Commercial", "").over).toBe(false);
    expect(infusionSetTotal("5", "", "Aetna Commercial", "").over).toBe(true);
  });

  // The live board's only order above 3 on a default-cap payer: Horizon AND a
  // CareCentrix referral, so covered by either route.
  it("clears the one live 5-set order", () => {
    expect(infusionSetTotal("5", "", "Horizon BCBS", "CareCentrix").over).toBe(false);
  });

  // ⚠️ Blank is 0, not a parse failure that could read as a huge number.
  it("treats blank, whitespace and unparseable quantities as nothing", () => {
    for (const [a, b] of [["", ""], ["  ", ""], ["abc", ""], ["-2", ""]]) {
      expect(infusionSetTotal(a, b, "Humana", "").total, `${a}|${b}`).toBe(0);
    }
    expect(infusionSetTotal("", "", "Humana", "").over).toBe(false);
  });
});
