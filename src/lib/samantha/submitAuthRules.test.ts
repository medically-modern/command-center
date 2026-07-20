import { describe, expect, it } from "vitest";
import {
  authHomePlan,
  dvsRoutedProducts,
  isBcbsFamily,
  isMltcPlan,
  modifierRoute,
  modifiersFor,
  submitAuthCards,
  validateSubmitAuthForSubmit,
} from "./submitAuthRules";
import type { InsuranceState, Patient, ProductCodeState } from "./workflow";
import { EMPTY_INSURANCE } from "./workflow";

const state = (p: Partial<ProductCodeState>): ProductCodeState => ({
  status: "pending",
  ...p,
});

function makePatient(overrides: Partial<Patient>): Patient {
  return {
    id: "1",
    name: "Test Patient",
    dob: "1970-01-01",
    product: "CGM",
    payer: "",
    doctorName: "",
    doctorClinic: "",
    contactMethod: "parachute",
    stage: "advanced",
    pillars: {},
    pathwayChecks: {},
    chaseStep: 0,
    faxPhase: 1,
    notes: "",
    receivedAt: "",
    lastUpdated: "",
    owner: "Samantha",
    insurance: structuredClone(EMPTY_INSURANCE),
    ...overrides,
  } as Patient;
}

const insWith = (codes: InsuranceState["codes"]): InsuranceState => ({
  ...structuredClone(EMPTY_INSURANCE),
  codes,
});

describe("submitAuthCards — board label Required, not DVS-routed (handoff §1/§6)", () => {
  it("only verbatim 'Required' board labels get a card", () => {
    const p = makePatient({
      serving: "Insulin Pump + CGM",
      primaryInsurance: "Horizon BCBS",
      insurance: insWith({
        "cgm-monitor": state({ _mondayAuthLabel: "No Auth Needed", auth: "not-required" }),
        "cgm-sensors": state({ _mondayAuthLabel: "Required", auth: "required" }),
        pump: state({ _mondayAuthLabel: "Required", auth: "required" }),
        // hydration maps Submitted → auth "required" too — must NOT card
        "infusion-sets": state({ _mondayAuthLabel: "Submitted", auth: "required" }),
        // blank label (column empty) → no card
        cartridges: state({}),
      }),
    });
    expect(submitAuthCards(p).map((r) => r.product)).toEqual(["sensors", "insulin_pump"]);
  });

  it("DVS-routed Medicaid supplies never get a card even at Required", () => {
    const p = makePatient({
      serving: "Insulin Pump",
      primaryInsurance: "Fidelis Medicaid",
      secondaryInsurance: "NY Medicaid",
      insurance: insWith({
        pump: state({ _mondayAuthLabel: "Required", auth: "required" }),
        "infusion-sets": state({ _mondayAuthLabel: "Required", auth: "required" }),
        cartridges: state({ _mondayAuthLabel: "Required", auth: "required" }),
      }),
    });
    expect(submitAuthCards(p).map((r) => r.product)).toEqual(["insulin_pump"]);
    expect(dvsRoutedProducts(p).map((r) => r.product)).toEqual(["infusion_set", "cartridge"]);
  });
});

describe("validateSubmitAuthForSubmit (handoff §7)", () => {
  const base = () =>
    makePatient({
      serving: "CGM",
      primaryInsurance: "Horizon BCBS",
      insurance: insWith({
        "cgm-sensors": state({ _mondayAuthLabel: "Required", auth: "required" }),
        "cgm-monitor": state({ _mondayAuthLabel: "No Auth Needed", auth: "not-required" }),
      }),
    });

  it("requires Method + Submission Date per card; Auth ID is optional", () => {
    const p = base();
    expect(validateSubmitAuthForSubmit(p)).toEqual([
      "A4239 · Submission Method",
      "A4239 · Submission Date",
    ]);
    p.insurance!.codes["cgm-sensors"] = state({
      _mondayAuthLabel: "Required",
      auth: "required",
      authSubmissionMethod: "Availity Portal",
      authSubmissionDate: "2026-07-20",
    });
    expect(validateSubmitAuthForSubmit(p)).toEqual([]);
  });

  it("Call/Fax methods additionally require a number", () => {
    const p = base();
    p.insurance!.codes["cgm-sensors"] = state({
      _mondayAuthLabel: "Required",
      auth: "required",
      authSubmissionMethod: "Fax",
      authSubmissionDate: "2026-07-20",
    });
    expect(validateSubmitAuthForSubmit(p)).toEqual(["A4239 · Fax Number"]);
    p.insurance!.codes["cgm-sensors"]!.callFaxNumber = "(555) 123-4567";
    expect(validateSubmitAuthForSubmit(p)).toEqual([]);
  });

  it("zero cards → nothing to validate → send allowed", () => {
    const p = makePatient({
      serving: "Supplies Only",
      primaryInsurance: "Medicaid",
      insurance: insWith({
        "infusion-sets": state({ _mondayAuthLabel: "Required", auth: "required" }),
        cartridges: state({ _mondayAuthLabel: "Required", auth: "required" }),
      }),
    });
    expect(submitAuthCards(p)).toEqual([]);
    expect(validateSubmitAuthForSubmit(p)).toEqual([]);
  });
});

describe("modifiers (handoff §4 — hand-synced from claims-ui-tool)", () => {
  it("routes by billing payer name", () => {
    expect(modifierRoute("Horizon BCBS")).toBe("carecentrix");
    expect(modifierRoute("BCBS TN")).toBe("bcbs-tn");
    expect(modifierRoute("Anthem BCBS Commercial")).toBe("anthem-803");
    expect(modifierRoute("Anthem BCBS Low-Cost (JLJ)")).toBe("anthem-803");
    expect(modifierRoute("BCBS FL")).toBe("anthem-803");
    expect(modifierRoute("BCBS WY")).toBe("anthem-803");
    expect(modifierRoute("Medicare A&B")).toBeNull();
    expect(modifierRoute("Fidelis Medicaid")).toBeNull();
  });

  it("defaults: KX/NU on supplies+pump+monitor, KX alone on sensors", () => {
    expect(modifiersFor("A4230", "Medicare A&B")).toEqual({ mods: ["KX", "NU"], source: "default" });
    expect(modifiersFor("A4239", "Medicare A&B")).toEqual({ mods: ["KX"], source: "default" });
    expect(modifiersFor("E0784", "Cigna")).toEqual({ mods: ["KX", "NU"], source: "default" });
  });

  it("Anthem NY 803: KX supplies, A4239 = KF+KX+CG, pump/monitor fall through to defaults", () => {
    expect(modifiersFor("A4230", "Anthem BCBS Commercial")).toEqual({
      mods: ["KX"],
      source: "Anthem NY 803",
    });
    expect(modifiersFor("A4239", "Anthem BCBS Commercial")).toEqual({
      mods: ["KF", "KX", "CG"],
      source: "Anthem NY 803",
    });
    expect(modifiersFor("E0784", "Anthem BCBS Commercial")).toEqual({
      mods: ["KX", "NU"],
      source: "default",
    });
  });

  it("CareCentrix 11348 (Horizon): NU+SC supplies, NU pump/monitor/sensors", () => {
    expect(modifiersFor("A4230", "Horizon BCBS")).toEqual({ mods: ["NU", "SC"], source: "CareCentrix 11348" });
    expect(modifiersFor("A4239", "Horizon BCBS")).toEqual({ mods: ["NU"], source: "CareCentrix 11348" });
    expect(modifiersFor("E0784", "Horizon BCBS")).toEqual({ mods: ["NU"], source: "CareCentrix 11348" });
  });

  it("BCBS TN direct: NU on every line; unknown HCPC → null", () => {
    expect(modifiersFor("E2103", "BCBS TN")).toEqual({ mods: ["NU"], source: "BCBS TN direct" });
    expect(modifiersFor("Evaluate", "BCBS TN")).toBeNull();
  });
});

describe("MLTC (handoff §5 — Plan Name column is the whole rule)", () => {
  it("case-insensitive substring on the plan name", () => {
    expect(isMltcPlan("NEW YORK MLTC")).toBe(true);
    expect(isMltcPlan("new york mltc")).toBe(true);
    expect(isMltcPlan("Fidelis Medicaid Managed Care")).toBe(false);
    expect(isMltcPlan("")).toBe(false);
    expect(isMltcPlan(undefined)).toBe(false);
  });
});

describe("home plan (handoff §8)", () => {
  it("BCBS family with home ≠ host (first-word compare) → banner info", () => {
    const p = makePatient({
      primaryInsurance: "Anthem BCBS Commercial",
      homePlan: "BCBS Connecticut",
    });
    expect(authHomePlan(p)).toEqual({ home: "BCBS Connecticut", host: "Anthem BCBS Commercial" });
  });
  it("same family (Horizon BCBSNJ vs Horizon BCBS) → no banner", () => {
    const p = makePatient({ primaryInsurance: "Horizon BCBS", homePlan: "Horizon BCBSNJ" });
    expect(authHomePlan(p)).toBeNull();
  });
  it("non-BCBS payer or missing home plan → no banner", () => {
    expect(authHomePlan(makePatient({ primaryInsurance: "Cigna", homePlan: "BCBS Connecticut" }))).toBeNull();
    expect(authHomePlan(makePatient({ primaryInsurance: "Horizon BCBS" }))).toBeNull();
    expect(isBcbsFamily("Horizon BCBS")).toBe(true);
    expect(isBcbsFamily("Cigna")).toBe(false);
  });
});
