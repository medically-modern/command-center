import { describe, it, expect } from "vitest";
import { benefitInputs, oopReason, parseBenefit, fmtCoinsurance } from "./oopContext";
import { estimateOop } from "./oopEstimator";
import type { OopEstimate } from "./oopEstimator";

const SOURCE = {
  deductibleRemaining: "",
  stediCoinsurance: "",
  oopMaxRemaining: "",
  stediQmb: "",
};

function est(over: Partial<OopEstimate>): OopEstimate {
  return {
    ok: true,
    lines: [],
    totalAllowed: 1000,
    appliedDeductible: 0,
    postDeductible: 1000,
    coinsurancePct: 0,
    patientCoinsurance: 0,
    patientOwesRaw: 0,
    oopMaxRemaining: null,
    patientOwes: 0,
    insurancePays: 1000,
    medicaidCovers: false,
    medicaidNote: "",
    canCalculateCosts: true,
    missingFields: [],
    ...over,
  };
}

describe("parseBenefit — blank is NOT zero", () => {
  it("reads numbers through the shapes the board holds", () => {
    expect(parseBenefit("0")).toBe(0);
    expect(parseBenefit("$1,500.00")).toBe(1500);
    expect(parseBenefit("20%")).toBe(20);
  });

  it("returns null for blank, whitespace and junk — never 0", () => {
    expect(parseBenefit("")).toBeNull();
    expect(parseBenefit("   ")).toBeNull();
    expect(parseBenefit("n/a")).toBeNull();
    // The whole point: a missing deductible and a met deductible must not
    // render the same. §5.20's "unknown is not a no", in dollars.
    expect(parseBenefit("")).not.toBe(parseBenefit("0"));
  });
});

describe("fmtCoinsurance — Stedi sends it both ways round", () => {
  it("normalises a decimal the way resolveCoinsurance does", () => {
    expect(fmtCoinsurance(0.2)).toBe("20%");
    expect(fmtCoinsurance(20)).toBe("20%");
    expect(fmtCoinsurance(0)).toBe("0%");
  });
});

describe("benefitInputs", () => {
  it("prints an em dash for a column nobody filled in", () => {
    const rows = benefitInputs(SOURCE);
    expect(rows.map((r) => r.value)).toEqual(["—", "—", "—"]);
    expect(rows.every((r) => !r.known)).toBe(true);
  });

  it("is Mariacamila Salazar's live row, 2026-09-17", () => {
    const rows = benefitInputs({
      deductibleRemaining: "0",
      stediCoinsurance: "0",
      oopMaxRemaining: "191",
      stediQmb: "",
    });
    expect(rows).toEqual([
      { label: "Deductible left", value: "$0.00", known: true },
      { label: "Coinsurance", value: "0%", known: true },
      // The fact Katie could not see: she has NOT hit her out-of-pocket max.
      { label: "OOP max left", value: "$191.00", known: true },
    ]);
  });

  it("adds QMB only when it is a Yes", () => {
    expect(benefitInputs({ ...SOURCE, stediQmb: "Yes" })).toHaveLength(4);
    expect(benefitInputs({ ...SOURCE, stediQmb: "No" })).toHaveLength(3);
    expect(benefitInputs({ ...SOURCE, stediQmb: "" })).toHaveLength(3);
  });
});

describe("oopReason — which $0 is this?", () => {
  it("says nothing when the card already prints medicaidNote", () => {
    expect(oopReason(est({ medicaidCovers: true, medicaidNote: "x" }), SOURCE)).toBe("");
  });

  it("says nothing when the estimate could not be computed", () => {
    expect(
      oopReason(est({ canCalculateCosts: false, patientOwes: null, patientOwesRaw: null }), SOURCE),
    ).toBe("");
  });

  it("names the deductible and the coinsurance when both are why", () => {
    const r = oopReason(est({}), { ...SOURCE, deductibleRemaining: "0", stediCoinsurance: "0" });
    expect(r).toBe("Nothing to collect on this fill — their deductible is met and this plan charges no coinsurance.");
  });

  it("does NOT claim a met deductible when the column is blank", () => {
    const r = oopReason(est({}), { ...SOURCE, stediCoinsurance: "0" });
    expect(r).toBe("Nothing to collect on this fill — this plan charges no coinsurance.");
    expect(r).not.toContain("deductible is met");
  });

  it("distinguishes a spent out-of-pocket maximum from a met deductible", () => {
    const r = oopReason(
      est({ patientOwes: 0, patientOwesRaw: 240, appliedDeductible: 240, coinsurancePct: 20 }),
      { ...SOURCE, deductibleRemaining: "800", oopMaxRemaining: "0" },
    );
    expect(r).toContain("out-of-pocket maximum is already met");
    expect(r).toContain("$240.00");
  });

  it("names the cap when the OOP max trims a non-zero share", () => {
    const r = oopReason(
      est({ patientOwes: 50, patientOwesRaw: 240, appliedDeductible: 240, coinsurancePct: 20 }),
      { ...SOURCE, oopMaxRemaining: "50" },
    );
    expect(r).toBe("Capped at $50.00, the rest of their out-of-pocket maximum — the full share would be $240.00.");
  });

  it("splits deductible from coinsurance in the ordinary case", () => {
    const r = oopReason(
      est({
        totalAllowed: 1000,
        appliedDeductible: 400,
        postDeductible: 600,
        coinsurancePct: 20,
        patientCoinsurance: 120,
        patientOwesRaw: 520,
        patientOwes: 520,
        insurancePays: 480,
      }),
      { ...SOURCE, deductibleRemaining: "400", stediCoinsurance: "20" },
    );
    expect(r).toBe("$400.00 of their remaining deductible, then 20% of the $600.00 left.");
  });

  it("says the deductible is met when only coinsurance is owed", () => {
    const r = oopReason(
      est({
        appliedDeductible: 0,
        postDeductible: 1000,
        coinsurancePct: 20,
        patientCoinsurance: 200,
        patientOwesRaw: 200,
        patientOwes: 200,
      }),
      { ...SOURCE, deductibleRemaining: "0", stediCoinsurance: "20" },
    );
    expect(r).toBe("20% coinsurance on $1,000.00 — their deductible is met.");
  });
});

describe("Mariacamila Salazar end to end", () => {
  it("is $0 on coinsurance, not on a spent out-of-pocket maximum", () => {
    const result = estimateOop({
      primaryInsurance: "Fidelis Low-Cost",
      secondaryInsurance: "None",
      serving: "Insulin Pump + CGM",
      infusionSets: 3,
      deductibleRemaining: "0",
      stediCoinsurance: "0",
      oopMaxRemaining: "191",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patientOwes).toBe(0);
    expect(result.medicaidCovers).toBe(false);
    const reason = oopReason(result, {
      deductibleRemaining: "0",
      stediCoinsurance: "0",
      oopMaxRemaining: "191",
      stediQmb: "",
    });
    expect(reason).toContain("no coinsurance");
    expect(reason).not.toContain("out-of-pocket maximum");
  });
});
