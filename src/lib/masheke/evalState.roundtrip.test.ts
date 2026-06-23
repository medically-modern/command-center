// Round-trip tests for the IP-requirement Monday sync (Option A).
// Proves the rep's exact Yes/No/Invalid answers survive a write→read cycle
// through Monday's reason dropdowns, so Send Request can read the board instead
// of the browser cache. Run: npx vitest run src/lib/masheke/evalState.roundtrip.test.ts
import { describe, it, expect } from "vitest";
import {
  computeIpReasonLists,
  seedRequirementsFromMonday,
  seedEvalStateFromPatient,
  computeMnChecklist,
  type EvalState,
} from "./evalState";
import type { Patient } from "./workflow";

const basePatient = (over: Partial<Patient> = {}): Patient => ({
  id: "1",
  name: "Test Patient",
  dob: "",
  notes: "",
  serving: "Insulin Pump",
  ipCoveragePath: "1st Pump >6M Diagnosed",
  ipScriptReceived: "Yes",
  medicalNecessity: "Not Established", // i.e. already evaluated at least once
  ...over,
});

// Exactly what Brandon entered in the screenshot.
const brandonState: EvalState = {
  ipCoveragePath: "1st Pump >6M Diagnosed",
  ipScriptReceived: "Yes",
  ipScriptValid: "Valid",
  ipEducationV: "Invalid",
  ipThreeInjectionsV: "Yes",
  ipCgmUseV: "No", // No == Missing
  ipBsIssuesV: "Invalid",
  clinReceived3: "Yes",
};

describe("computeIpReasonLists — write side", () => {
  it("routes Invalid → invalid list and No(=Missing) → missing list", () => {
    const { invalid, missing } = computeIpReasonLists(brandonState, true);
    expect(invalid).toEqual(
      expect.arrayContaining(["Diabetes Education invalid", "Blood Sugar Issues invalid"]),
    );
    expect(missing).toEqual(expect.arrayContaining(["CGM Use Missing"]));
  });

  it("never mislabels a No as 'invalid' (Brandon's bug)", () => {
    const { invalid, missing } = computeIpReasonLists(brandonState, true);
    expect(invalid).not.toContain("CGM Use invalid");
    expect(missing).not.toContain("CGM Use invalid");
    expect(missing).toContain("CGM Use Missing");
  });

  it("emits nothing for a met (Yes) requirement", () => {
    const { invalid, missing } = computeIpReasonLists(brandonState, true);
    expect([...invalid, ...missing].some((s) => s.startsWith("3+ Injections"))).toBe(false);
  });
});

describe("seedRequirementsFromMonday — read side", () => {
  it("reconstructs the rep's exact answers from the two dropdowns", () => {
    const { invalid, missing } = computeIpReasonLists(brandonState, true);
    const patient = basePatient({
      ipMnInvalidReasons: invalid.join(", "),
      ipMnNoReasons: missing.join(", "),
      mrsClinicals: "MR Received",
    });
    const seeded = seedRequirementsFromMonday(patient);
    expect(seeded.ipEducationV).toBe("Invalid");
    expect(seeded.ipThreeInjectionsV).toBe("Yes"); // met → absent from lists → Yes
    expect(seeded.ipCgmUseV).toBe("No");
    expect(seeded.ipBsIssuesV).toBe("Invalid");
    expect(seeded.clinReceived3).toBe("Yes");
  });

  it("does NOT invent Yes for an un-evaluated patient", () => {
    const seeded = seedRequirementsFromMonday(
      basePatient({ medicalNecessity: "", ipMnInvalidReasons: "", ipMnNoReasons: "" }),
    );
    expect(seeded.ipEducationV).toBeUndefined();
    expect(seeded.ipCgmUseV).toBeUndefined();
    expect(seeded.ipBsIssuesV).toBeUndefined();
  });

  it("seeds CGM Language from its own column", () => {
    expect(seedRequirementsFromMonday(basePatient({ cgmLanguage: "Invalid" })).cgmLanguage).toBe("Invalid");
    expect(seedRequirementsFromMonday(basePatient({ cgmLanguage: "No" })).cgmLanguage).toBe("No");
  });

  it("seeds IP script Invalid from the invalid dropdown", () => {
    const { invalid } = computeIpReasonLists(
      { ...brandonState, ipScriptValid: "Invalid" },
      true,
    );
    expect(invalid).toContain("Insulin Pump Script invalid");
    const seeded = seedRequirementsFromMonday(basePatient({ ipMnInvalidReasons: invalid.join(", ") }));
    expect(seeded.ipScriptValid).toBe("Invalid");
  });
});

describe("full round-trip — Send Request checklist from Monday == from cache", () => {
  it("produces an identical checklist whether read from local state or rebuilt from Monday", () => {
    const showCgm = false;
    const showIp = true;

    // 1) What the rep saw locally (cache).
    const fromCache = computeMnChecklist(brandonState, showCgm, showIp);

    // 2) Persist to Monday, then read it all back.
    const { invalid, missing } = computeIpReasonLists(brandonState, true);
    const patient = basePatient({
      ipMnInvalidReasons: invalid.join(", "),
      ipMnNoReasons: missing.join(", "),
      mrsClinicals: "MR Received",
    });
    const seeded = seedEvalStateFromPatient(patient);
    const fromMonday = computeMnChecklist(seeded, showCgm, showIp);

    // The two must agree — that's the whole point of "Monday as source of truth".
    expect(fromMonday.documents).toEqual(fromCache.documents);
    expect(fromMonday.language).toEqual(fromCache.language);
  });
});
