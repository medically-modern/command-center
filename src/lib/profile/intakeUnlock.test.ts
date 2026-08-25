import { describe, it, expect } from "vitest";
import {
  evaluateUnlock, patientAuthorised, stediRanCleanly, networkAnswer, inNetwork,
} from "./intakeUnlock";
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

describe("networkAnswer", () => {
  it("reads the payer's Yes", () => {
    expect(networkAnswer(p({ stediInNetwork: "Yes" }))).toBe("yes");
    expect(networkAnswer(p({ stediInNetwork: "In-Network" }))).toBe("yes");
    expect(inNetwork(p({ stediInNetwork: "yes" }))).toBe(true);
  });

  it("reads a real negative as a negative", () => {
    expect(networkAnswer(p({ stediInNetwork: "No" }))).toBe("no");
    expect(networkAnswer(p({ stediInNetwork: "Out of Network" }))).toBe("no");
    expect(inNetwork(p({ stediInNetwork: "No" }))).toBe(false);
  });

  // The Thomas Swan case: Original Medicare has no network, so the eligibility
  // service writes the literal string. It is NOT a No.
  it("reports the board's literal Unknown as unknown, not as No", () => {
    expect(networkAnswer(p({ stediInNetwork: "Unknown" }))).toBe("unknown");
    expect(inNetwork(p({ stediInNetwork: "Unknown" }))).toBe(false);
  });

  it("treats an unrecognised value as unknown rather than a negative", () => {
    expect(networkAnswer(p({ stediInNetwork: "Not applicable" }))).toBe("unknown");
  });

  it("distinguishes nothing-came-back from a real answer", () => {
    expect(networkAnswer(p({ stediInNetwork: "" }))).toBe("none");
    expect(networkAnswer(p({ stediInNetwork: "   " }))).toBe("none");
    expect(networkAnswer(null)).toBe("none");
  });
});

describe("evaluateUnlock", () => {
  it("stays locked until every condition passes", () => {
    const almost = evaluateUnlock(
      p({
        formProceedPreference: "Send request now",
        stediEligibilityActive: "", // never ran
      }),
    );
    expect(almost.unlocked).toBe(false);
    expect(almost.conditions.find((c) => c.id === "stediRan")?.passed).toBe(false);
  });

  it("unlocks when every condition passes", () => {
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

  // Josh, 2026-08-25. The network answer is shown, never gated: an Original
  // Medicare patient can only ever come back Unknown, so gating on it left
  // whole populations in the queue with a greyed-out Advance and no way out.
  it("never blocks on the network answer, whatever it says", () => {
    const authorisedAndActive = {
      formProceedPreference: "Send request now",
      stediEligibilityActive: "Yes",
    };
    for (const v of ["", "Unknown", "No", "Out of Network", "Yes"]) {
      const s = evaluateUnlock(p({ ...authorisedAndActive, stediInNetwork: v }));
      expect(s.unlocked, `stediInNetwork=${JSON.stringify(v)}`).toBe(true);
      expect(s.conditions.some((c) => /network/i.test(c.label))).toBe(false);
    }
  });

  // Inactive coverage is a real, answerable fact about the patient and still
  // holds the advance — only the network condition was removed.
  it("still blocks on inactive coverage", () => {
    const s = evaluateUnlock(
      p({
        formProceedPreference: "Send request now",
        stediPlanName: "Some Plan",
        stediEligibilityActive: "No",
        stediInNetwork: "Yes",
      }),
    );
    expect(s.unlocked).toBe(false);
    expect(s.conditions.find((c) => c.id === "active")?.passed).toBe(false);
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
