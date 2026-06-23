// Step-2 (Script / Clinicals Evaluation) full save+read audit.
// A: every coverage/language selection is written to Monday (buildScriptCoverageWrites).
// B: every selection is read back accurately on Send Request — CGM, Insulin Pump,
//    and Medical Records (seedEvalStateFromPatient -> computeMnChecklist).
import { describe, it, expect } from "vitest";
import {
  buildScriptCoverageWrites,
  seedEvalStateFromPatient,
  computeMnChecklist,
  computeDoctorAskList,
  type EvalState,
  type MnState,
} from "./evalState";
import type { Patient } from "./workflow";

const basePatient = (over: Partial<Patient> = {}): Patient => ({
  id: "1",
  name: "Test",
  dob: "",
  notes: "",
  serving: "Insulin Pump + CGM",
  medicalNecessity: "Not Established", // already evaluated at least once
  ...over,
});

const recentVisit = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
};

// Read a patient's Monday columns back into the checklist exactly as Send Request does.
const checklist = (over: Partial<Patient>, showCgm: boolean, showIp: boolean) =>
  computeMnChecklist(seedEvalStateFromPatient(basePatient(over)), showCgm, showIp);
const docState = (cl: ReturnType<typeof checklist>, label: string): MnState | undefined =>
  cl.documents.find((d) => d.label === label)?.state;
const langState = (cl: ReturnType<typeof checklist>, label: string): MnState | undefined =>
  cl.language.find((l) => l.label === label)?.state;

// ---------------------------------------------------------------- WRITE (A)
describe("A — buildScriptCoverageWrites saves every coverage/language selection", () => {
  it("served CGM persists path + language even when the script was NOT received", () => {
    const w = buildScriptCoverageWrites(
      { cgmScriptReceived: "No", cgmCoveragePath: "Insulin", cgmLanguage: "Invalid" } as EvalState,
      true,
      false,
    );
    expect(w).toContainEqual({ field: "cgmCoveragePath", value: "Insulin" });
    expect(w).toContainEqual({ field: "cgmLanguage", value: "Invalid" });
  });

  it("served IP persists the coverage path regardless of received state", () => {
    const w = buildScriptCoverageWrites({ ipCoveragePath: "OOW Pump" } as EvalState, false, true);
    expect(w).toContainEqual({ field: "ipCoveragePath", value: "OOW Pump" });
  });

  it("not-served product writes 'Not Serving' (greyed) and no CGM Language", () => {
    const w = buildScriptCoverageWrites({} as EvalState, false, true);
    expect(w).toContainEqual({ field: "cgmCoveragePath", value: "Not Serving" });
    expect(w.find((x) => x.field === "cgmLanguage")).toBeUndefined();
    expect(w).toContainEqual({ field: "ipCoveragePath", value: null }); // served IP, no path yet → clear
  });

  it("clears CGM Language for a non-language-bearing path", () => {
    const w = buildScriptCoverageWrites(
      { cgmCoveragePath: "Missing", cgmLanguage: "Yes" } as EvalState,
      true,
      false,
    );
    expect(w).toContainEqual({ field: "cgmLanguage", value: null });
  });
});

// ---------------------------------------------------------------- READ (B): CGM
describe("B — CGM read-back: every selection", () => {
  it("Received Yes (+ valid) → CGM Script ok", () => {
    const cl = checklist(
      { serving: "CGM", cgmScriptReceived: "Yes", cgmCoveragePath: "Insulin", cgmLanguage: "Yes" },
      true,
      false,
    );
    expect(docState(cl, "CGM Script")).toBe("ok");
    expect(langState(cl, "CGM Language")).toBe("ok");
  });

  it("Received Invalid → CGM Script invalid", () => {
    const cl = checklist(
      {
        serving: "CGM",
        cgmScriptReceived: "Yes",
        cgmMnInvalidReasons: "CGM Script invalid",
        cgmCoveragePath: "Insulin",
        cgmLanguage: "Yes",
      },
      true,
      false,
    );
    expect(docState(cl, "CGM Script")).toBe("invalid");
  });

  it("Received No → CGM Script missing", () => {
    const cl = checklist(
      { serving: "CGM", cgmScriptReceived: "No", cgmCoveragePath: "Insulin", cgmLanguage: "Yes" },
      true,
      false,
    );
    expect(docState(cl, "CGM Script")).toBe("missing");
  });

  it("CGM Language No → missing, Invalid → invalid", () => {
    const no = checklist(
      { serving: "CGM", cgmScriptReceived: "Yes", cgmCoveragePath: "Hypo", cgmLanguage: "No" },
      true,
      false,
    );
    expect(langState(no, "CGM Language")).toBe("missing");
    const inv = checklist(
      { serving: "CGM", cgmScriptReceived: "Yes", cgmCoveragePath: "Hypo", cgmLanguage: "Invalid" },
      true,
      false,
    );
    expect(langState(inv, "CGM Language")).toBe("invalid");
  });

  it("Not served (greyed) → CGM Script + Language na", () => {
    const cl = checklist({ serving: "Insulin Pump" }, false, true);
    expect(docState(cl, "CGM Script")).toBe("na");
    expect(langState(cl, "CGM Language")).toBe("na");
  });
});

// ---------------------------------------------------------------- READ (B): IP
describe("B — Insulin Pump read-back: every selection", () => {
  const path = "1st Pump >6M Diagnosed";
  it("Received Yes → IP Script ok", () => {
    const cl = checklist(
      { ipCoveragePath: path, ipScriptReceived: "Yes", ipMnInvalidReasons: "", ipMnNoReasons: "" },
      false,
      true,
    );
    expect(docState(cl, "Insulin Pump Script")).toBe("ok");
  });

  it("Received Invalid → IP Script invalid", () => {
    const cl = checklist(
      { ipCoveragePath: path, ipScriptReceived: "Yes", ipMnInvalidReasons: "Insulin Pump Script invalid" },
      false,
      true,
    );
    expect(docState(cl, "Insulin Pump Script")).toBe("invalid");
  });

  it("Received No → IP Script missing", () => {
    const cl = checklist({ ipCoveragePath: path, ipScriptReceived: "No" }, false, true);
    expect(docState(cl, "Insulin Pump Script")).toBe("missing");
  });

  it("language requirement Invalid vs Missing read back distinctly", () => {
    const cl = checklist(
      {
        ipCoveragePath: path,
        ipScriptReceived: "Yes",
        ipMnInvalidReasons: "Diabetes Education invalid",
        ipMnNoReasons: "CGM Use Missing",
      },
      false,
      true,
    );
    const ipLang = cl.language.find((l) => l.label === "Insulin Pump Language");
    const sub = (label: string) => ipLang?.subItems.find((s) => s.label === label)?.state;
    expect(sub("Diabetes Education")).toBe("invalid");
    expect(sub("CGM Use")).toBe("missing");
    expect(sub("3+ Injections / Day")).toBe("ok"); // not in either list, evaluated → met
  });

  it("Not served → IP Script + Language na", () => {
    const cl = checklist({ serving: "CGM" }, true, false);
    expect(docState(cl, "Insulin Pump Script")).toBe("na");
    expect(langState(cl, "Insulin Pump Language")).toBe("na");
  });
});

// ---------------------------------------------------------------- READ (B): MR
describe("B — Medical Records read-back: every selection", () => {
  it("Clinicals received + recent visit → Clinicals ok; diagnosis seeded", () => {
    const cl = checklist(
      { mrsClinicals: "MR Received", lastVisit: recentVisit(), diagnosis: "E10.65" },
      false,
      true,
    );
    expect(docState(cl, "Clinicals")).toBe("ok");
    expect(cl.mr.diagnosis).toBe("E10.65");
  });

  it("Clinicals not received → Clinicals missing", () => {
    const cl = checklist({ mrsClinicals: "Collect" }, false, true);
    expect(docState(cl, "Clinicals")).toBe("missing");
  });

  it("Clinicals received but expired (>6 months) → Clinicals invalid", () => {
    const cl = checklist({ mrsClinicals: "MR Received", lastVisit: "2020-01-01" }, false, true);
    expect(docState(cl, "Clinicals")).toBe("invalid");
  });
});

describe("MN Request Consolidated regenerates on read-back (the Brandon 1 case)", () => {
  it("OOW Pump reloaded from Monday yields the OOW + malfunction + CGM language asks", () => {
    const patient = basePatient({
      cgmScriptReceived: "Yes",
      ipScriptReceived: "Yes",
      cgmCoveragePath: "Insulin",
      ipCoveragePath: "OOW Pump",
      cgmLanguage: "No",
      ipMnNoReasons: "Malfunction Missing, OOW Date not on script",
      oowDateValue: "2020-12-12",
      mrsClinicals: "MR Received",
      lastVisit: recentVisit(),
      diagnosis: "E10.65",
    });
    const seeded = seedEvalStateFromPatient(patient);
    // received-but-not-invalid script restores as Valid so the asks fire
    expect(seeded.ipScriptValid).toBe("Valid");
    const asks = computeDoctorAskList(seeded, patient, true, true);
    expect(asks).toContain("Insulin language");
    expect(asks).toContain("Non-repairable malfunction reason");
    expect(asks.some((a) => a.startsWith("Add OOW date of"))).toBe(true);
  });
});
