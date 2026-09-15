/**
 * The fixtures here are the LIVE vocabulary of the A4230/A4232 Claim columns —
 * every distinct value across all 107 non-blank rows on the Welcome Call board
 * on 2026-09-15, not invented shapes. Re-run that scan before adding a verdict:
 *
 *   items_page(query_params: {rules: [{column_id: "text_mm28a3xt",
 *     compare_value: [""], operator: is_not_empty}]})
 */
import { describe, it, expect } from "vitest";

import { dvsClaimPaid } from "./dvsClaim";

describe("dvsClaimPaid", () => {
  it("accepts every PAID verdict the board carries", () => {
    for (const v of ["Paid: $456.00", "Paid: $108.30", "Paid: $455.00", "Paid: $107.30"]) {
      expect(dvsClaimPaid(v), v).toBe(true);
    }
  });

  // ⚠️ The verdict decides, the amount only explains. A $0.00 adjudication is
  // still DVS having accepted the claim; reading the figure to overrule the
  // word is the inversion `smsDelivery.ts` exists to prevent. Three live rows
  // carry it, all in Completed or Stuck.
  it("treats a zero-dollar adjudication as paid", () => {
    expect(dvsClaimPaid("Paid: $0.00")).toBe(true);
  });

  // ⚠️ This is why the rule parses instead of checking for non-blank. Every one
  // of these is a real live value, and every one would read as "paid" under a
  // blank check — silencing a warning on the strength of a DENIAL.
  it("rejects every verdict that is not a payment", () => {
    for (const v of [
      "Denied: Claim denied — see ePACES for details",
      "Denied: Maximum coverage amount met or exceeded for benefit period.",
      "ERROR — see Claims Error col",
      "Yes", // the one legacy row, from before the verdict format existed
    ]) {
      expect(dvsClaimPaid(v), v).toBe(false);
    }
  });

  it("treats an absent claim as no evidence", () => {
    for (const v of ["", "   ", null, undefined]) {
      expect(dvsClaimPaid(v)).toBe(false);
    }
  });

  // Anchored at the start and on a word boundary, so a verdict that merely
  // CONTAINS the word cannot pass.
  it("does not match a negated or embedded 'paid'", () => {
    for (const v of ["Not Paid", "Denied: nothing paid", "Unpaid", "Paidx"]) {
      expect(dvsClaimPaid(v), v).toBe(false);
    }
  });
});
