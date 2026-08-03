/**
 * The POS rule, and the label guard that keeps it honest.
 *
 * POS decides how a claim is billed, and the rule matches Primary Insurance by
 * EXACT board label. That makes a board rename a silent, total failure: every
 * out-of-state Blue quietly becomes Home (the else-branch), no error, no blank
 * column, nothing on screen. The guard below is the only thing that would
 * notice — it fails the build instead of the billing.
 */
import { describe, it, expect } from "vitest";

import { BCBS_FAMILY, IN_FOOTPRINT_STATES, POS_INDEX, expectedPos, resolveState } from "./pos";
import { PRIMARY_INSURANCE_OPTIONS as FC_OPTIONS } from "@/lib/finalConfirm/workflow";
import { PRIMARY_INSURANCE_OPTIONS as WC_OPTIONS } from "@/lib/welcomeCall/workflow";

describe("BCBS family labels match the boards", () => {
  const fc = new Set(FC_OPTIONS.map((o) => o.label));
  const wc = new Set(WC_OPTIONS.map((o) => o.label));

  for (const label of BCBS_FAMILY) {
    it(`"${label}" exists on both boards' Primary Insurance column`, () => {
      expect(fc, `Final Confirm lost the label "${label}" — every ${label} patient silently bills POS Home`).toContain(label);
      expect(wc, `Welcome Call lost the label "${label}" — POS would be written Home for them`).toContain(label);
    });
  }

  it("the two boards' option lists agree with each other", () => {
    expect([...fc].sort()).toEqual([...wc].sort());
  });
});

describe("resolveState", () => {
  it("reads the two-letter state before a zip", () => {
    expect(resolveState("500 Oak Dr, Dallas, TX 75001")).toBe("TX");
  });

  it("reads a spelled-out state name", () => {
    expect(resolveState("12 Main St, Albany, New York 12203")).toBe("NY");
  });

  it("returns empty when there's no state to find", () => {
    expect(resolveState("")).toBe("");
    expect(resolveState("no state here")).toBe("");
  });
});

describe("expectedPos", () => {
  it("sends out-of-state Blue to Office — billed via Anthem NY 803 BlueCard", () => {
    expect(expectedPos("Anthem BCBS Commercial", "500 Oak Dr, Dallas, TX 75001")).toBe("Office");
    expect(expectedPos("Horizon BCBS", "1 Peachtree, Atlanta, GA 30303")).toBe("Office");
  });

  it("keeps in-footprint Blue at Home", () => {
    for (const [state, addr] of [
      ["NY", "12 Main St, Albany, NY 12203"],
      ["NJ", "9 Elm St, Newark, NJ 07102"],
      ["TN", "1 Broadway, Nashville, TN 37203"],
      ["FL", "5 Ocean Dr, Miami, FL 33139"],
      ["WY", "3 Bison Way, Cheyenne, WY 82001"],
    ]) {
      expect(IN_FOOTPRINT_STATES.has(state)).toBe(true);
      expect(expectedPos("Anthem BCBS Commercial", addr), `${state} should be Home`).toBe("Home");
    }
  });

  it("sends every non-Blue payer Home, wherever they live", () => {
    expect(expectedPos("Cigna", "500 Oak Dr, Dallas, TX 75001")).toBe("Home");
    expect(expectedPos("Medicare A&B", "500 Oak Dr, Dallas, TX 75001")).toBe("Home");
    expect(expectedPos("", "500 Oak Dr, Dallas, TX 75001")).toBe("Home");
  });

  it("falls back to Home when the address yields no state", () => {
    // Safe default rather than a throw, but it IS a silent wrong answer for an
    // out-of-state Blue with a malformed address — and C23 can't catch it,
    // since stored and expected are computed the same way.
    expect(expectedPos("Anthem BCBS Commercial", "")).toBe("Home");
    expect(expectedPos("Anthem BCBS Commercial", "somewhere unparseable")).toBe("Home");
  });

  it("maps to the board's status indexes", () => {
    expect(POS_INDEX[expectedPos("Anthem BCBS Commercial", "500 Oak Dr, Dallas, TX 75001")]).toBe(0);
    expect(POS_INDEX[expectedPos("Cigna", "12 Main St, Albany, NY 12203")]).toBe(1);
  });
});
