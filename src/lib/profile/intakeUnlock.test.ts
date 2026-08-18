import { describe, it, expect } from "vitest";
import { evaluateUnlock, patientAuthorised, stediRanCleanly } from "./intakeUnlock";
import type { Patient } from "./workflow";

const base = {
  formProceedPreference: "",
  intakeCallComplete: "",
  stediErrorDescription: "",
  stediEligibilityActive: "",
  stediPlanName: "",
  stediInNetwork: "",
} as unknown as Patient;

const p = (over: Partial<Patient>): Patient => ({ ...base, ...over }) as Patient;

describe("patientAuthorised", () => {
  it("passes when the patient chose to send now", () => {
    expect(patientAuthorised(p({ formProceedPreference: "Send request now" }))).toBe(true);
  });

  it("does NOT pass on 'wants a call first' alone", () => {
    // The whole point of the condition: asking for a call is not authorisation.
    expect(patientAuthorised(p({ formProceedPreference: "Wants a call first" }))).toBe(false);
  });

  it("passes once the rep has completed the intake call", () => {
    expect(
      patientAuthorised(p({ formProceedPreference: "Wants a call first", intakeCallComplete: "Yes" })),
    ).toBe(true);
  });

  it("does not pass when the form never answered and no call happened", () => {
    expect(patientAuthorised(p({}))).toBe(false);
  });
});

describe("stediRanCleanly", () => {
  it("fails when the check errored, even with other results present", () => {
    expect(
      stediRanCleanly(p({ stediErrorDescription: "Subscriber not found", stediEligibilityActive: "Yes" })),
    ).toBe(false);
  });

  it("fails when nothing has come back yet", () => {
    expect(stediRanCleanly(p({}))).toBe(false);
  });

  it("passes on a clean run", () => {
    expect(stediRanCleanly(p({ stediEligibilityActive: "Yes" }))).toBe(true);
  });
});

describe("evaluateUnlock", () => {
  it("stays locked until every condition passes", () => {
    const almost = evaluateUnlock(
      p({
        formProceedPreference: "Send request now",
        stediEligibilityActive: "Yes",
        stediInNetwork: "", // missing
      }),
    );
    expect(almost.unlocked).toBe(false);
    expect(almost.conditions.find((c) => c.id === "inNetwork")?.passed).toBe(false);
  });

  it("unlocks when all four pass", () => {
    const ready = evaluateUnlock(
      p({
        formProceedPreference: "Send request now",
        stediEligibilityActive: "Yes",
        stediInNetwork: "Yes",
      }),
    );
    expect(ready.unlocked).toBe(true);
    expect(ready.conditions.every((c) => c.passed)).toBe(true);
  });

  it("surfaces the Stedi error text in the hint so the rep can act on it", () => {
    const failed = evaluateUnlock(p({ stediErrorDescription: "DOB mismatch" }));
    expect(failed.conditions.find((c) => c.id === "stediRan")?.hint).toContain("DOB mismatch");
  });

  it("is locked with no patient selected", () => {
    expect(evaluateUnlock(null).unlocked).toBe(false);
  });
});

describe("coverage paths block the advance (Josh, 2026-08-18)", () => {
  const passing = {
    formProceedPreference: "Send request now",
    stediEligibilityActive: "Yes",
    stediInNetwork: "Yes",
  };

  it("a pump request with no pump path stays locked, and says which path", () => {
    const s = evaluateUnlock(p({ ...passing, requestType: "Insulin Pump" }));
    expect(s.unlocked).toBe(false);
    const c = s.conditions.find((x) => x.id === "pumpPath");
    expect(c?.passed).toBe(false);
    expect(c?.hint).toContain("Insulin Pump Coverage Path");
  });

  it("a CGM signal without the CGM path stays locked", () => {
    const s = evaluateUnlock(p({ ...passing, formCgmPreference: "Dexcom G7" }));
    expect(s.unlocked).toBe(false);
    expect(s.conditions.find((x) => x.id === "cgmPath")?.passed).toBe(false);
  });

  it("unlocks once the in-play paths are chosen", () => {
    const s = evaluateUnlock(p({
      ...passing,
      requestType: "Insulin Pump + CGM",
      insulinPumpCoveragePath: "Medical Necessity",
      cgmCoveragePath: "Insulin",
    }));
    expect(s.unlocked).toBe(true);
  });

  it("never demands a path for a product that isn't in play", () => {
    const s = evaluateUnlock(p({ ...passing }));
    expect(s.conditions.some((x) => x.id === "cgmPath" || x.id === "pumpPath")).toBe(false);
    expect(s.unlocked).toBe(true);
  });
});
