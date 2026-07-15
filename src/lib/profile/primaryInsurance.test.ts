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
      managedMedicaid: o.managedMedicaid ?? "",
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

  // Rulebook example 11 (Lakisha Valdez): NYSDOH + Molina managed plan →
  // keep the Medicaid suggestion, warn supplies-only. Real Stedi writes
  // Coverage Type as plain "Medicaid" and the MCO in its own column.
  it("NYSDOH + Managed Medicaid (Molina) → Medicaid + supplies-only warning", () => {
    const sg = suggestPrimary(mk({
      gins: "Medicaid", payerName: "NYSDOH", covtype: "Medicaid",
      plan: "NEW YORK MEDICAID", managedMedicaid: "MOLINA HEALTHCARE OF NY INC MAINSTR",
    }));
    expect(sg?.value).toBe("Medicaid");
    const warn = sg?.warnings.find((w) => w.code === "MANAGED_MEDICAID");
    expect(warn?.message).toContain("MOLINA HEALTHCARE OF NY INC MAINSTR");
  });

  it("NYSDOH without managed plan → no managed-medicaid warning", () => {
    const sg = suggestPrimary(mk({ gins: "Medicaid", payerName: "NYSDOH", covtype: "Medicaid", plan: "NEW YORK MEDICAID" }));
    expect(sg?.value).toBe("Medicaid");
    expect(sg?.warnings.some((w) => w.code === "MANAGED_MEDICAID")).toBe(false);
  });

  it('Stedi "—" none-marker in Managed Medicaid → no warning', () => {
    const sg = suggestPrimary(mk({ gins: "Medicaid", payerName: "NYSDOH", covtype: "Medicaid", plan: "NEW YORK MEDICAID", managedMedicaid: "—" }));
    expect(sg?.warnings.some((w) => w.code === "MANAGED_MEDICAID")).toBe(false);
  });

  // The warning is scoped to the NYSDOH branch — a Medicaid plan routed to a
  // mapped carrier (here Aetna Better Health) must not pick it up even with a
  // populated Managed Medicaid column.
  it("mapped-carrier Medicaid + populated Managed Medicaid → no NYSDOH warning", () => {
    const sg = suggestPrimary(mk({
      gins: "Aetna", payerName: "AETNA BETTER HEALTH OF NEW YORK", covtype: "Medicaid",
      plan: "AETNA BETTER HEALTH MEDICAID", managedMedicaid: "AETNA BETTER HEALTH OF NEW YORK",
    }));
    expect(sg?.value).toBe("Medicaid"); // no pump requested → medicaidFork drops to plain Medicaid
    expect(sg?.warnings.some((w) => w.code === "MANAGED_MEDICAID")).toBe(false);
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
  it("non-CIN Medicaid ID on a CHP plan → no secondary", () => {
    // Emma Novick shape: Fidelis CHP kid, Stedi returned a non-CIN id and
    // QMB=No — the referral's wrong "NY Medicaid" claim must never surface
    // as an engine suggestion.
    expect(suggestSecondary(mk({
      gins: "Fidelis", plan: "Child Health Plus", covtype: "Medicaid", medid: "50980348",
    }))).toBe("");
  });
});

describe("isCoverageActive", () => {
  it("treats Active / Yes as active", () => {
    expect(isCoverageActive({ active: "Active" } as StediSnapshot)).toBe(true);
    expect(isCoverageActive({ active: "Yes" } as StediSnapshot)).toBe(true);
    expect(isCoverageActive({ active: "No" } as StediSnapshot)).toBe(false);
  });
});
