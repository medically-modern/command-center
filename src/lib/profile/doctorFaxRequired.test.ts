/**
 * One rule, three surfaces. The tests exist because the gap this closes was a
 * rule that lived on one page and a banner on another page claiming it.
 */
import { describe, it, expect } from "vitest";
import {
  DOCTOR_FAX_ROW_LABEL,
  doctorFaxMissing,
  faxMethodChosen,
  hasDoctorFax,
} from "./doctorFaxRequired";

describe("faxMethodChosen", () => {
  it("is the board's exact Fax label", () => {
    expect(faxMethodChosen({ clinicalsMethod: "Fax" })).toBe(true);
    expect(faxMethodChosen({ clinicalsMethod: " Fax " })).toBe(true);
  });

  it("is not the other real methods", () => {
    expect(faxMethodChosen({ clinicalsMethod: "Parachute" })).toBe(false);
    expect(faxMethodChosen({ clinicalsMethod: "Email" })).toBe(false);
  });

  it("⚠️ is NOT a blank method", () => {
    /* Brandon asked for "if method is fax". A blank is unanswered — and it is
       ~36 of the 78 live rows, against 3 that say Fax, so reading it as a fax
       would turn a rule that blocks nobody into one that blocks three dozen
       patients. §5.9 does route a blank to the fax chase queue; widening this
       is a decision, recorded in the module header. */
    expect(faxMethodChosen({ clinicalsMethod: "" })).toBe(false);
    expect(faxMethodChosen({ clinicalsMethod: "   " })).toBe(false);
    expect(faxMethodChosen({})).toBe(false);
  });
});

describe("hasDoctorFax", () => {
  it("is presence only — the column is an rcfax address, not a number", () => {
    expect(hasDoctorFax({ doctorFax: "7186799822@rcfax.com" })).toBe(true);
    // Presence, never format (§5.32b's line for the blank doctor phone).
    expect(hasDoctorFax({ doctorFax: "not a fax" })).toBe(true);
    expect(hasDoctorFax({ doctorFax: "  " })).toBe(false);
    expect(hasDoctorFax({})).toBe(false);
  });
});

describe("doctorFaxMissing — what the gate and the banner both read", () => {
  it("fires on Fax with no number", () => {
    expect(doctorFaxMissing({ clinicalsMethod: "Fax", doctorFax: "" })).toBe(true);
  });

  it("is quiet once a fax is on file", () => {
    // All three live Fax rows on 2026-09-17 are this case, which is why the
    // new readiness row blocks nobody on the day it ships.
    expect(doctorFaxMissing({ clinicalsMethod: "Fax", doctorFax: "9132732474@rcfax.com" })).toBe(false);
  });

  it("is quiet for a faxless Parachute patient", () => {
    // The common shape in Already In System — 20+ live rows.
    expect(doctorFaxMissing({ clinicalsMethod: "Parachute", doctorFax: "" })).toBe(false);
  });

  it("is quiet for a blank method", () => {
    expect(doctorFaxMissing({ clinicalsMethod: "", doctorFax: "" })).toBe(false);
  });
});

describe("the row label", () => {
  it("is one string for both checklists", () => {
    expect(DOCTOR_FAX_ROW_LABEL).toBe("Doctor Fax");
  });
});
