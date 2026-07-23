/**
 * A secondary insurance other than "None" forces patient OOP to $0 in BOTH
 * estimators — even when Stedi shows a live deductible and coinsurance. The
 * secondary (NY Medicaid or Medicare Supplement) picks up the patient's
 * remaining balance, so the rep must never quote a cost. The board options are
 * "None" / "NY Medicaid" / "Medicare Supplement" (Welcome Call color_mm241kqp,
 * Subscription color_mm25cr82); the estimators zero OOP for anything but "None".
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

  it("secondary Medicare Supplement also zeroes the estimate (not just Medicaid)", () => {
    const r = estimateOop({
      ...NY_MEDICAID_SECONDARY_WITH_REAL_COSTS,
      primaryInsurance: "Cigna",
      secondaryInsurance: "Medicare Supplement",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.patientOwes).toBe(0);
    expect(r.medicaidCovers).toBe(true);
    expect(r.medicaidNote).toContain("Medicare Supplement");
  });

  it("profile estimator: secondary Medicare Supplement → $0 First + Recurring", () => {
    const { first, recurring } = computeFirstAndRecurring({
      ...NY_MEDICAID_SECONDARY_WITH_REAL_COSTS,
      primaryInsurance: "Cigna",
      secondaryInsurance: "Medicare Supplement",
    });
    expect(first.val).toBe("$0");
    expect(recurring.val).toBe("$0");
  });

  it("secondary 'None' does NOT zero the estimate — real cost share applies", () => {
    const r = estimateOop({
      ...NY_MEDICAID_SECONDARY_WITH_REAL_COSTS,
      primaryInsurance: "Cigna",
      secondaryInsurance: "None",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.medicaidCovers).toBe(false);
    expect(r.patientOwes).toBeGreaterThan(0);
  });
});
