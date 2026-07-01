// Acceptance tests for the Profile OOP estimator.
// Pins the handoff's worked examples + the two Profile-only rules
// (CGM monitor excluded, United Medicare 0% coinsurance).
// Run: npx vitest run src/lib/profile/oopEstimate.test.ts
import { describe, it, expect } from "vitest";
import { estimateOop, computeFirstAndRecurring, formatOop } from "./oopEstimate";

describe("profile OOP — handoff worked examples", () => {
  it("Humana CGM, $900 deductible remaining → First $900, Recurring $0", () => {
    const r = computeFirstAndRecurring({
      serving: "CGM",
      primaryInsurance: "Humana",
      secondaryInsurance: "",
      stediCoinsurance: "0",
      deductibleRemaining: "900",
      oopMaxRemaining: "9147.04",
    });
    expect(r.first.val).toBe("$900");
    expect(r.recurring.val).toBe("$0");
    expect(r.hasPump).toBe(false);
  });

  it("Anthem BCBS Commercial pump, $500 ded / 20% → First ~$1,310, Recurring ~$70", () => {
    const r = computeFirstAndRecurring({
      serving: "Insulin Pump",
      primaryInsurance: "Anthem BCBS Commercial",
      secondaryInsurance: "",
      stediCoinsurance: "20",
      deductibleRemaining: "500",
      oopMaxRemaining: "",
    });
    expect(r.first.val).toBe("$1,310.2");
    expect(r.recurring.val).toBe("$70.2");
    expect(r.hasPump).toBe(true);
  });

  it("Medicaid primary → $0 / $0", () => {
    const r = computeFirstAndRecurring({
      serving: "Insulin Pump + CGM",
      primaryInsurance: "Fidelis Medicaid",
      secondaryInsurance: "",
      stediCoinsurance: "",
      deductibleRemaining: "",
      oopMaxRemaining: "",
    });
    expect(r.first.val).toBe("$0");
    expect(r.recurring.val).toBe("$0");
  });

  it("Medicare A&B → $0 / $0", () => {
    const r = computeFirstAndRecurring({
      serving: "CGM",
      primaryInsurance: "Medicare A&B",
      secondaryInsurance: "",
      stediCoinsurance: "20",
      deductibleRemaining: "0",
      oopMaxRemaining: "",
    });
    expect(r.first.val).toBe("$0");
    expect(r.recurring.val).toBe("$0");
  });
});

describe("profile OOP — Profile-only rules", () => {
  it("excludes the CGM monitor (E2103) from the lines", () => {
    const r = estimateOop({
      serving: "CGM",
      primaryInsurance: "Humana",
      secondaryInsurance: "",
      stediCoinsurance: "0",
      deductibleRemaining: "0",
      oopMaxRemaining: "",
    });
    expect(r.ok).toBe(true);
    // Only sensors — no "CGM Monitor" line.
    const products = (r.lines ?? []).map((l) => l.product);
    expect(products).toContain("CGM Sensors");
    expect(products).not.toContain("CGM Monitor");
    // Humana sensor_rate 317.97 × 3 = 953.91 (monitor 295.36 NOT added)
    expect(r.totalAllowed).toBe(953.91);
  });

  it("United Medicare = 0% coinsurance (patient pays deductible only)", () => {
    const r = estimateOop({
      serving: "CGM",
      primaryInsurance: "United Medicare",
      secondaryInsurance: "",
      stediCoinsurance: "20", // Stedi says 20% but override forces 0%
      deductibleRemaining: "500",
      oopMaxRemaining: "",
    });
    expect(r.ok).toBe(true);
    expect(r.coinsurancePct).toBe(0);
    // sensors 176.55×3 = 529.65 allowed; deductible 500 applied; coins 0 → owes 500
    expect(r.patientOwes).toBe(500);
  });

  it("dual secondary Medicaid → $0", () => {
    const r = estimateOop({
      serving: "Supplies + CGM",
      primaryInsurance: "United Medicare",
      secondaryInsurance: "NY Medicaid",
      stediCoinsurance: "20",
      deductibleRemaining: "1000",
      oopMaxRemaining: "",
    });
    expect(r.medicaidCovers).toBe(true);
    expect(formatOop(r).val).toBe("$0");
  });

  it("missing rate → N/A", () => {
    const r = estimateOop({
      serving: "Insulin Pump",
      primaryInsurance: "BCBS TN", // all rates null
      secondaryInsurance: "",
      stediCoinsurance: "20",
      deductibleRemaining: "500",
      oopMaxRemaining: "",
    });
    expect(formatOop(r).val).toBe("N/A");
  });

  it("missing benefits → Need benefits", () => {
    const r = estimateOop({
      serving: "CGM",
      primaryInsurance: "Cigna",
      secondaryInsurance: "",
      stediCoinsurance: "",
      deductibleRemaining: "",
      oopMaxRemaining: "",
    });
    expect(formatOop(r).val).toBe("Need benefits");
  });
});
