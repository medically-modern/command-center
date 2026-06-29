import { describe, it, expect } from "vitest";
import { buildRequestTemplate } from "./requestTemplate";
import type { MnChecklist } from "./evalState";
import type { Patient } from "./workflow";

/** Minimal "everything on file" checklist for an insulin-pump-only patient. */
function completeChecklist(): MnChecklist {
  return {
    established: true,
    documents: [
      { label: "Insulin Pump Script", state: "ok" },
      { label: "CGM Script", state: "na" },
      { label: "Clinicals", state: "ok" },
    ],
    language: [
      { label: "CGM Language", state: "na", subItems: [] },
      { label: "Insulin Pump Language", state: "ok", subItems: [] },
    ],
    mr: { received: true, expired: false, diagnosisOk: true },
  };
}

function basePatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: "1",
    name: "Cristian Ogando Reyes",
    dob: "01/08/2002",
    referralSource: "Tandem",
    pumpType: "t:slim",
    requestType: "Insulin Pump",
    cgmType: "Not Serving",
    notes: "",
    ...overrides,
  };
}

describe("buildRequestTemplate — DOB in serving line", () => {
  it("places the DOB immediately after the patient name (partner line)", () => {
    const body = buildRequestTemplate(basePatient(), completeChecklist());
    expect(body).toContain(
      "We are working with Tandem to serve Cristian Ogando Reyes (DOB: 01/08/2002) a t:slim insulin pump.",
    );
  });

  it("includes the DOB on the non-partner serving line too", () => {
    const body = buildRequestTemplate(basePatient({ referralSource: "Self" }), completeChecklist());
    expect(body).toContain("Cristian Ogando Reyes (DOB: 01/08/2002)");
    expect(body).toMatch(/We are serving Cristian Ogando Reyes \(DOB: 01\/08\/2002\) with /);
  });

  it("omits the DOB segment entirely when DOB is blank", () => {
    const body = buildRequestTemplate(basePatient({ dob: "" }), completeChecklist());
    expect(body).toContain("We are working with Tandem to serve Cristian Ogando Reyes a t:slim insulin pump.");
    expect(body).not.toContain("DOB:");
  });
});
