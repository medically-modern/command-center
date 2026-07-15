/**
 * Secondary "NY Medicaid" forces patient OOP to $0 in BOTH estimators —
 * even when Stedi shows a live deductible and coinsurance. Medicaid picks up
 * the patient's remaining balance, so the rep must never quote a cost.
 * "NY Medicaid" is the exact status label on the Welcome Call board
 * (color_mm241kqp, id 1) and the Subscription board (color_mm25cr82, id 1);
 * the estimators match any label containing "medicaid", case-insensitive.
 */
import { describe, it, expect } from "vitest";
import { estimateOop } from "./oopEstimator";
import { computeFirstAndRecurring } from "@/lib/profile/oopEstimate";

const NY_MEDICAID_SECONDARY_WITH_REAL_COSTS = {
  primaryInsurance: "Medicare A&B",
  secondaryInsurance: "NY Medicaid",
  serving: "CGM & Pump & Supplies",
  deductibleRemaining: "1500",
  stediCoinsurance: "20",
  oopMaxRemaining: "6000",
};

describe("secondary NY Medicaid → $0 OOP", () => {
  it("welcome-call estimator forces $0 despite deductible/coinsurance", () => {
    const r = estimateOop({
      ...NY_MEDICAID_SECONDARY_WITH_REAL_COSTS,
      primaryInsurance: "Cigna", // non-zero payer — only the secondary zeroes it
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.patientOwes).toBe(0);
    expect(r.insurancePays).toBe(r.totalAllowed);
    expect(r.medicaidCovers).toBe(true);
    expect(r.medicaidNote).toContain("NY Medicaid");
    expect(r.canCalculateCosts).toBe(true);
  });

  it("welcome-call estimator: $0 with Medicare A&B primary (dual-eligible)", () => {
    const r = estimateOop(NY_MEDICAID_SECONDARY_WITH_REAL_COSTS);
    if (!r.ok) throw new Error(r.reason);
    expect(r.patientOwes).toBe(0);
  });

  it("profile estimator writes $0 for both First-Order and Recurring (subscription fill)", () => {
    const { first, recurring } = computeFirstAndRecurring({
      ...NY_MEDICAID_SECONDARY_WITH_REAL_COSTS,
      primaryInsurance: "Cigna",
    });
    expect(first.val).toBe("$0");
    expect(recurring.val).toBe("$0");
  });

  it("secondary Medicare Supplement does NOT zero the estimate (rule didn't over-reach)", () => {
    const r = estimateOop({
      ...NY_MEDICAID_SECONDARY_WITH_REAL_COSTS,
      primaryInsurance: "Cigna",
      secondaryInsurance: "Medicare Supplement",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.medicaidCovers).toBe(false);
    expect(r.patientOwes).toBeGreaterThan(0);
  });
});
