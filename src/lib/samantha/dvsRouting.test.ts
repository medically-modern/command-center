// DVS stage routing rules (HANDOFF-Josh-DVS.md §1/§7) — who skips the auth
// rail, and which auth-rail patients exit to DVS instead of Complete.
import { describe, expect, it } from "vitest";
import {
  allProductsDvsRouted,
  dvsAutoTrigger,
  hasDvsRoutedProducts,
  isStraightMedicaidPrimary,
  nyMedicaidCin,
  pumpClaimStatus,
} from "./dvsRouting";
import type { Patient } from "./workflow";

function p(over: Partial<Patient>): Patient {
  // Default CIN-shaped Member ID 1 so the routing gate passes unless a
  // test overrides it.
  return { id: "1", name: "t", secondaryInsurance: "None", memberId1: "KJ51074B", ...over } as Patient;
}

describe("nyMedicaidCin (XX11111X gate)", () => {
  it("accepts the CIN shape in Member ID 1, then Member ID 2", () => {
    expect(nyMedicaidCin(p({}))).toEqual({ cin: "KJ51074B", source: "Member ID 1" });
    expect(nyMedicaidCin(p({ memberId1: "74306887200", memberId2: "ec81836d" })))
      .toEqual({ cin: "EC81836D", source: "Member ID 2" });
  });
  it("rejects non-CIN shapes", () => {
    expect(nyMedicaidCin(p({ memberId1: "74306887200", memberId2: "" }))).toBeNull();
    expect(nyMedicaidCin(p({ memberId1: "KJ5107B", memberId2: "K51074BB" }))).toBeNull();
  });
  it("no CIN → no DVS routing at all, even for straight Medicaid", () => {
    const noCin = p({ primaryInsurance: "Medicaid", serving: "Supplies Only", memberId1: "12345", memberId2: "" });
    expect(hasDvsRoutedProducts(noCin)).toBe(false);
    expect(allProductsDvsRouted(noCin)).toBe(false);
    expect(dvsAutoTrigger(noCin)).toBeNull();
  });
});

describe("dvsAutoTrigger", () => {
  it("pump first for straight-Medicaid pump patients", () => {
    expect(dvsAutoTrigger(p({ primaryInsurance: "Medicaid", serving: "Insulin Pump" }))).toBe("pump");
  });
  it("supplies for supplies-only straight Medicaid and managed duals", () => {
    expect(dvsAutoTrigger(p({ primaryInsurance: "Medicaid", serving: "Supplies Only" }))).toBe("supplies");
    expect(dvsAutoTrigger(p({ primaryInsurance: "Fidelis Medicaid", secondaryInsurance: "NY Medicaid", serving: "Insulin Pump" }))).toBe("supplies");
  });
  it("null for commercial patients", () => {
    expect(dvsAutoTrigger(p({ primaryInsurance: "Horizon BCBS", serving: "Insulin Pump" }))).toBeNull();
  });
});

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

describe("pumpClaimStatus", () => {
  const p = (over: Partial<Patient>) => over as Patient;

  it("falls back to the shared/supplies column while the pump one is blank", () => {
    // Every patient today: the bot doesn't write IP Claims Status yet, so this
    // must behave exactly as the old single-column read did.
    expect(pumpClaimStatus(p({ claimsStatus: "Claims Paid" }))).toBe("Claims Paid");
    expect(pumpClaimStatus(p({ claimsStatus: "Claims Paid", ipClaimsStatus: "" }))).toBe("Claims Paid");
    expect(pumpClaimStatus(p({ claimsStatus: "Claims Paid", ipClaimsStatus: "   " }))).toBe("Claims Paid");
  });

  it("prefers the pump column once the bot writes it — self-healing switchover", () => {
    expect(
      pumpClaimStatus(p({ claimsStatus: "Claims Paid", ipClaimsStatus: "Claims Running" })),
    ).toBe("Claims Running");
    expect(
      pumpClaimStatus(p({ claimsStatus: "Claims Denied", ipClaimsStatus: "Claims Paid" })),
    ).toBe("Claims Paid");
  });

  it("is empty when neither column has a value", () => {
    expect(pumpClaimStatus(p({}))).toBe("");
  });

  // The gate this feeds is cosmetic: a genuinely failed pump claim is caught by
  // isManualReview off the raw columns, which never consult pumpClaimStatus.
  // Pinned so nobody 'simplifies' the two into one another.
  it("does not swallow a pump failure — the raw column still says Denied", () => {
    const patient = p({ claimsStatus: "Claims Paid", ipClaimsStatus: "Claims Denied" });
    expect(pumpClaimStatus(patient)).toBe("Claims Denied");
    expect(patient.ipClaimsStatus).toBe("Claims Denied");
  });
});
