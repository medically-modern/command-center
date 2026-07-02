/**
 * NYSHIP (Empire Plan) is a $0-patient-OOP payer in BOTH estimators — even
 * when Stedi shows a live deductible and coinsurance. Pins the business rule
 * so it isn't lost when the rate schedule / special cases are next re-synced
 * with the Railway financial backend.
 */
import { describe, it, expect } from "vitest";
import { estimateOop } from "./oopEstimator";
import { computeFirstAndRecurring } from "@/lib/profile/oopEstimate";

const NYSHIP_WITH_REAL_COSTS = {
  primaryInsurance: "NYSHIP",
  secondaryInsurance: "",
  serving: "CGM & Pump & Supplies",
  deductibleRemaining: "1500",
  stediCoinsurance: "20",
  oopMaxRemaining: "6000",
};

describe("NYSHIP $0 OOP", () => {
  it("welcome-call estimator forces $0 despite deductible/coinsurance", () => {
    const r = estimateOop(NYSHIP_WITH_REAL_COSTS);
    if (!r.ok) throw new Error(r.reason);
    expect(r.patientOwes).toBe(0);
    expect(r.insurancePays).toBe(r.totalAllowed);
    expect(r.canCalculateCosts).toBe(true);
    expect(r.medicaidNote).toContain("no patient cost share");
  });

  it("profile estimator writes $0 for both First-Order and Recurring", () => {
    const { first, recurring } = computeFirstAndRecurring(NYSHIP_WITH_REAL_COSTS);
    expect(first.val).toBe("$0");
    expect(recurring.val).toBe("$0");
  });

  it("a non-zero payer still computes real costs (rule didn't over-reach)", () => {
    const r = estimateOop({ ...NYSHIP_WITH_REAL_COSTS, primaryInsurance: "Cigna" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.patientOwes).toBeGreaterThan(0);
  });
});
