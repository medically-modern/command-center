// DVS stage routing rules (HANDOFF-Josh-DVS.md §1/§7) — who skips the auth
// rail, and which auth-rail patients exit to DVS instead of Complete.
import { describe, expect, it } from "vitest";
import {
  allProductsDvsRouted,
  hasDvsRoutedProducts,
  isStraightMedicaidPrimary,
} from "./dvsRouting";
import type { Patient } from "./workflow";

function p(over: Partial<Patient>): Patient {
  return { id: "1", name: "t", secondaryInsurance: "None", ...over } as Patient;
}

describe("straight Medicaid primary", () => {
  it("everything DVSes — pump + supplies skip the rail entirely", () => {
    const pt = p({ primaryInsurance: "Medicaid", serving: "Insulin Pump" });
    expect(isStraightMedicaidPrimary(pt)).toBe(true);
    expect(allProductsDvsRouted(pt)).toBe(true);
    expect(hasDvsRoutedProducts(pt)).toBe(true);
  });

  it("no serving selected → nothing to route", () => {
    const pt = p({ primaryInsurance: "Medicaid", serving: "" });
    expect(allProductsDvsRouted(pt)).toBe(false);
    expect(hasDvsRoutedProducts(pt)).toBe(false);
  });
});

describe("managed Medicaid duals (e.g. Fidelis Medicaid + NY Medicaid)", () => {
  it("supplies-only → ALL products DVS-routed (skips the rail)", () => {
    const pt = p({
      primaryInsurance: "Fidelis Medicaid",
      secondaryInsurance: "NY Medicaid",
      serving: "Supplies Only",
    });
    expect(allProductsDvsRouted(pt)).toBe(true);
    expect(hasDvsRoutedProducts(pt)).toBe(true);
  });

  it("pump + supplies → pump rides the rail, supplies DVS (has but not all)", () => {
    const pt = p({
      primaryInsurance: "Fidelis Medicaid",
      secondaryInsurance: "NY Medicaid",
      serving: "Insulin Pump",
    });
    expect(allProductsDvsRouted(pt)).toBe(false);
    expect(hasDvsRoutedProducts(pt)).toBe(true);
  });
});

describe("commercial patients", () => {
  it("no DVS routing at all", () => {
    const pt = p({ primaryInsurance: "Horizon BCBS", serving: "Insulin Pump + CGM" });
    expect(isStraightMedicaidPrimary(pt)).toBe(false);
    expect(allProductsDvsRouted(pt)).toBe(false);
    expect(hasDvsRoutedProducts(pt)).toBe(false);
  });
});
