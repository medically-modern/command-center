import { describe, it, expect } from "vitest";
import type { Patient } from "./workflow";
import { evaluateUnlock } from "./intakeUnlock";
import {
  primaryInsuranceForGeneral, cashPayMirrorEdit, benefitCheckApplies, verifiedInsuranceStepApplies,
  memberIdRequired, applyCashPayReadiness, advanceLabelFor, advanceLabelForLive,
  CASH_PAY_SKIPS_TO_WELCOME_CALL, ADVANCE_TO_MN, ADVANCE_TO_WELCOME_CALL,
} from "./cashPayIntake";

const pt = (over: Partial<Patient> = {}) => ({
  generalInsurance: "", primaryInsurance: "",
  formProceedPreference: "Send request now",
  intakeCallComplete: "", stediErrorDescription: "",
  stediEligibilityActive: "", stediPlanName: "",
  requestType: "", cgmCoveragePath: "", insulinPumpCoveragePath: "",
  formCgmPreference: "", formPumpPreference: "", formPumpNeed: "",
  cgmDataAwareness: "",
  ...over,
} as unknown as Patient);

/** Debbie: no insurance on file, nothing from Stedi, authorised the request. */
const debbie = pt({ generalInsurance: "Cash Pay", primaryInsurance: "Cash Pay" });
/** The same patient before anyone marked her cash pay — the stuck state. */
const stuck = pt({});

describe("the gate that stranded Debbie", () => {
  it("an insured patient with no benefit check still cannot advance", () => {
    const u = evaluateUnlock(stuck);
    expect(u.unlocked).toBe(false);
    expect(u.conditions.map((c) => c.id)).toContain("stediRan");
    expect(u.conditions.map((c) => c.id)).toContain("active");
  });

  it("a cash pay patient advances — the two insurance conditions drop", () => {
    const u = evaluateUnlock(debbie);
    expect(u.unlocked).toBe(true);
    expect(u.conditions.map((c) => c.id)).toEqual(["authorised"]);
  });

  it("General Insurance alone is enough — Primary may not be mirrored yet", () => {
    expect(evaluateUnlock(pt({ generalInsurance: "Cash Pay" })).unlocked).toBe(true);
  });

  it("Primary Insurance alone is enough — a downstream row carries only that", () => {
    expect(evaluateUnlock(pt({ primaryInsurance: "Cash Pay" })).unlocked).toBe(true);
  });

  it("⚠️ cash pay does NOT mean unchecked — authorisation still gates", () => {
    const notAuthorised = pt({
      generalInsurance: "Cash Pay",
      formProceedPreference: "Schedule a call",
      intakeCallComplete: "",
    });
    const u = evaluateUnlock(notAuthorised);
    expect(u.unlocked).toBe(false);
    expect(u.conditions.find((c) => c.id === "authorised")?.passed).toBe(false);
  });

  it("⚠️ and the coverage paths still gate — they decide what ships", () => {
    const cgmNoPath = pt({ generalInsurance: "Cash Pay", requestType: "CGM" });
    const u = evaluateUnlock(cgmNoPath);
    expect(u.unlocked).toBe(false);
    expect(u.conditions.map((c) => c.id)).toContain("cgmPath");

    const withPath = pt({
      generalInsurance: "Cash Pay", requestType: "CGM", cgmCoveragePath: "Insulin",
    });
    expect(evaluateUnlock(withPath).unlocked).toBe(true);
  });

  it("an insured patient's gate is completely unchanged", () => {
    const insured = pt({
      generalInsurance: "Aetna", primaryInsurance: "Aetna Commercial",
      stediEligibilityActive: "Yes", stediPlanName: "Aetna Choice",
    });
    expect(evaluateUnlock(insured).unlocked).toBe(true);
    expect(evaluateUnlock(insured).conditions.map((c) => c.id))
      .toEqual(["authorised", "stediRan", "active"]);
  });
});

describe("picking Cash Pay mirrors it into Primary Insurance", () => {
  it("mirrors when General Insurance becomes Cash Pay", () => {
    expect(primaryInsuranceForGeneral("Cash Pay", "")).toBe("Cash Pay");
    expect(primaryInsuranceForGeneral("Cash Pay", "Aetna Commercial")).toBe("Cash Pay");
  });

  it("does not re-write a Primary that already says Cash Pay", () => {
    expect(primaryInsuranceForGeneral("Cash Pay", "Cash Pay")).toBeNull();
  });

  it("⚠️ never touches Primary for any other payer — it must not blank it", () => {
    expect(primaryInsuranceForGeneral("Aetna", "Aetna Commercial")).toBeNull();
    expect(primaryInsuranceForGeneral("", "Aetna Commercial")).toBeNull();
    expect(primaryInsuranceForGeneral("Medicaid", "")).toBeNull();
  });
});

describe("the mirror as the pages apply it", () => {
  it("adds Primary to the patch that set General Insurance", () => {
    expect(cashPayMirrorEdit({ generalInsurance: "Cash Pay" }, ""))
      .toEqual({ generalInsurance: "Cash Pay", primaryInsurance: "Cash Pay" });
  });

  it("⚠️ passes every other patch through UNTOUCHED, by identity", () => {
    /* Both pages funnel EVERY field edit through this, so a patch it copies or
       widens is a patch that writes columns nobody edited. Identity is the
       cheapest proof it did nothing. */
    const patch = { name: "Debbie Hinze" };
    expect(cashPayMirrorEdit(patch, "")).toBe(patch);
    const blank = { generalInsurance: "" };
    expect(cashPayMirrorEdit(blank, "Aetna Commercial")).toBe(blank);
  });

  it("⚠️ a patch that does not name General Insurance is not judged on it", () => {
    /* `patch.generalInsurance === undefined` is the test, not truthiness: a
       rep correcting a phone number on a cash pay patient must not have
       Primary Insurance re-written underneath them on every keystroke. */
    const patch = { ptPhone: "5555550109" };
    expect(cashPayMirrorEdit(patch, "Cash Pay")).toBe(patch);
  });

  it("does not re-write a Primary that already says Cash Pay", () => {
    const patch = { generalInsurance: "Cash Pay" };
    expect(cashPayMirrorEdit(patch, "Cash Pay")).toBe(patch);
  });
});

describe("what the right pane asks for", () => {
  it("section 1 (Verified Insurance) and the benefit check are hidden", () => {
    expect(verifiedInsuranceStepApplies(debbie)).toBe(false);
    expect(benefitCheckApplies(debbie)).toBe(false);
    expect(memberIdRequired(debbie)).toBe(false);
  });

  it("all three still apply to an insured patient", () => {
    expect(verifiedInsuranceStepApplies(stuck)).toBe(true);
    expect(benefitCheckApplies(stuck)).toBe(true);
    expect(memberIdRequired(stuck)).toBe(true);
  });

  it("drops the rows a cash pay patient cannot satisfy", () => {
    // ⚠️ Serving and the coverage paths go too, from 2026-09-22 — a coverage
    // path is how a PAYER covers a product, and Serving is dropped on Josh's
    // instruction. cashPayReadinessRows.test.ts has the full list and scans
    // both pages for rows it has never heard of.
    const rows = [
      { label: "Primary Insurance", ok: true },
      { label: "Member ID 1", ok: false },
      { label: "Serving", ok: true },
      { label: "CGM Coverage Path", ok: true },
      { label: "CGM Type", ok: true },
      { label: "Doctor selected", ok: false },
    ];
    expect(applyCashPayReadiness(rows, debbie).map((r) => r.label))
      .toEqual(["CGM Type", "Doctor selected"]);
  });

  it("⚠️ keeps the DOCTOR row — Cardinal's order payload requires it", () => {
    const rows = [
      { label: "Member ID 1", ok: false },
      { label: "Doctor selected", ok: false },
      { label: "Doctor Fax", ok: false },
    ];
    const kept = applyCashPayReadiness(rows, debbie).map((r) => r.label);
    expect(kept).toContain("Doctor selected");
    expect(kept).toContain("Doctor Fax");
    expect(kept).not.toContain("Member ID 1");
  });

  it("leaves an insured patient's checklist exactly as it was", () => {
    const rows = [
      { label: "Primary Insurance", ok: true },
      { label: "Member ID 1", ok: true },
      { label: "Serving", ok: true },
    ];
    expect(applyCashPayReadiness(rows, stuck)).toEqual(rows);
  });
});

describe("which label Advance writes", () => {
  it("cash pay routes to Welcome Call, everyone else to MN", () => {
    expect(advanceLabelFor(debbie)).toBe(ADVANCE_TO_WELCOME_CALL);
    expect(advanceLabelFor(stuck)).toBe(ADVANCE_TO_MN);
  });

  /* ✅ LIVE since 2026-09-22, behind monday automation 7923595946, which was
     proved end to end against a throwaway item before the flag was flipped.
     If this ever needs turning off, set the flag to false — cash pay patients
     then advance on "Advance to MN" and land on Medical Evaluation, which is
     what they did before. */
  it("is LIVE — a cash pay patient routes to Welcome Call, everyone else to MN", () => {
    expect(CASH_PAY_SKIPS_TO_WELCOME_CALL).toBe(true);
    expect(advanceLabelForLive(debbie)).toBe(ADVANCE_TO_WELCOME_CALL);
    expect(advanceLabelForLive(stuck)).toBe(ADVANCE_TO_MN);
  });

  it("nobody is stranded while it is dark — cash pay still advances", () => {
    expect(evaluateUnlock(debbie).unlocked).toBe(true);
  });
});
