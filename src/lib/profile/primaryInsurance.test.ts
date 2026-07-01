// Acceptance tests for the Primary/Secondary suggestion engine.
// Cases are the scrubbed real patients baked into the redesign prototype
// (profile-sendoff-redesign-v2.html TEST_PATIENTS), asserting the engine's
// deterministic routing rules. Run: npx vitest run src/lib/profile/primaryInsurance.test.ts
import { describe, it, expect } from "vitest";
import {
  suggestPrimary, suggestSecondary, isCoverageActive,
  type SuggestionInputs, type StediSnapshot,
} from "./primaryInsurance";

function mk(
  o: {
    gins: string; memberId?: string; address?: string; requestType?: string;
  } & Partial<StediSnapshot> & { active?: string },
): SuggestionInputs {
  return {
    stediDone: true,
    generalInsurance: o.gins,
    memberId: o.memberId ?? "",
    patientAddress: o.address ?? "",
    requestType: o.requestType ?? "CGM",
    stedi: {
      active: o.active ?? "Active",
      covtype: o.covtype ?? "",
      plan: o.plan ?? "",
      payerName: o.payerName ?? "",
      homeplan: o.homeplan ?? "",
      medid: o.medid ?? "",
      qmb: o.qmb ?? "No",
      ma: o.ma ?? false,
      mltc: o.mltc ?? false,
    },
  };
}

describe("suggestPrimary — payer routing", () => {
  it("returns null before Stedi runs", () => {
    expect(suggestPrimary({ ...mk({ gins: "Humana" }), stediDone: false })).toBeNull();
  });

  it("inactive coverage → no suggestion + INACTIVE warning", () => {
    const sg = suggestPrimary(mk({ gins: "Medicaid", active: "No" }));
    expect(sg?.value).toBeNull();
    expect(sg?.warnings.some((w) => w.code === "INACTIVE")).toBe(true);
  });

  it("Anthem + NJ address → Horizon BCBS (host Blue)", () => {
    const sg = suggestPrimary(mk({
      gins: "Anthem / BCBS", address: "30 Ravine Avenue, Wyckoff, NJ, USA",
      homeplan: "Horizon Blue Cross and Blue Shield of New Jersey", covtype: "Commercial",
    }));
    expect(sg?.value).toBe("Horizon BCBS");
  });

  it("Anthem JLJ Medicaid + pump → Anthem BCBS Medicaid (JLJ)", () => {
    const sg = suggestPrimary(mk({
      gins: "Anthem / BCBS", memberId: "JLJ735970080", requestType: "Insulin Pump",
      plan: "NEW YORK MEDICAID-LONG ISLAND- HARP", covtype: "Medicaid",
    }));
    expect(sg?.value).toBe("Anthem BCBS Medicaid (JLJ)");
  });

  it("Anthem NY Medicaid + Supplies Only → drops to plain Medicaid", () => {
    const sg = suggestPrimary(mk({
      gins: "Anthem / BCBS", memberId: "JLJ716456572", requestType: "Supplies Only",
      address: "1504 SHERIDAN AVE, BRONX, NY 10457", plan: "NEW YORK MEDICAID", covtype: "Medicaid",
    }));
    expect(sg?.value).toBe("Medicaid");
  });

  it("Fidelis Medicaid Managed Care → Fidelis Medicaid", () => {
    const sg = suggestPrimary(mk({
      gins: "Fidelis", requestType: "Insulin Pump",
      plan: "Fidelis Medicaid Managed Care", covtype: "Medicaid",
    }));
    expect(sg?.value).toBe("Fidelis Medicaid");
  });

  it("Fidelis Essential Plan → Fidelis Low-Cost", () => {
    const sg = suggestPrimary(mk({ gins: "Fidelis", plan: "Essential Plan 1", covtype: "Medicaid" }));
    expect(sg?.value).toBe("Fidelis Low-Cost");
  });

  it("Fidelis Wellcare Dual → Fidelis Medicare + NY Medicaid secondary", () => {
    const inp = mk({
      gins: "Fidelis", requestType: "Insulin Pump",
      plan: "Wellcare Fidelis Dual Liberty Sync (Upstate)", covtype: "Medicaid",
    });
    expect(suggestPrimary(inp)?.value).toBe("Fidelis Medicare");
    expect(suggestSecondary(inp)).toBe("NY Medicaid");
  });

  it("United DUAL COMPLETE → United Medicare + NY Medicaid secondary", () => {
    const inp = mk({
      gins: "United Healthcare", requestType: "Supplies + CGM",
      payerName: "NY UNITEDHEALTHCARE DUAL COMPLETE HMOPOS FULL H338",
      plan: "NY UNITEDHEALTHCARE DUAL COMPLETE HMOPOS FULL H338",
      covtype: "Medicare Advantage", ma: true,
    });
    expect(suggestPrimary(inp)?.value).toBe("United Medicare");
    expect(suggestSecondary(inp)).toBe("NY Medicaid");
  });

  it("straight Medicare A&B → Medicare A&B", () => {
    const sg = suggestPrimary(mk({ gins: "Medicare A&B", covtype: "Medicare A&B", payerName: "Medicare A&B" }));
    expect(sg?.value).toBe("Medicare A&B");
  });

  it("unmapped Medicare Advantage → no confident pick + MA_UNMAPPED", () => {
    const sg = suggestPrimary(mk({
      gins: "Medicare A&B", payerName: "Senior Whole Health Medicare Complete Care",
      plan: "Senior Whole Health Medicare Complete Care", covtype: "Medicare Advantage", ma: true, qmb: "Yes",
    }));
    expect(sg?.value).toBeNull();
    expect(sg?.warnings.some((w) => w.code === "MA_UNMAPPED")).toBe(true);
  });

  it("Humana Gold Plus (MA) → Humana", () => {
    const sg = suggestPrimary(mk({
      gins: "Humana", payerName: "Humana Gold Plus", plan: "Humana Gold Plus",
      covtype: "Medicare Advantage", ma: true,
    }));
    expect(sg?.value).toBe("Humana");
  });
});

describe("suggestSecondary — Medicaid backstop", () => {
  it("QMB=Yes → NY Medicaid", () => {
    expect(suggestSecondary(mk({ gins: "Humana", qmb: "Yes", plan: "Humana Gold Plus", ma: true }))).toBe("NY Medicaid");
  });
  it("Medicaid ID returned → NY Medicaid", () => {
    expect(suggestSecondary(mk({ gins: "Cigna", medid: "FB17532H", covtype: "Commercial" }))).toBe("NY Medicaid");
  });
  it("no backstop → no secondary", () => {
    expect(suggestSecondary(mk({ gins: "Cigna", covtype: "Commercial" }))).toBe("");
  });
});

describe("isCoverageActive", () => {
  it("treats Active / Yes as active", () => {
    expect(isCoverageActive({ active: "Active" } as StediSnapshot)).toBe(true);
    expect(isCoverageActive({ active: "Yes" } as StediSnapshot)).toBe(true);
    expect(isCoverageActive({ active: "No" } as StediSnapshot)).toBe(false);
  });
});
