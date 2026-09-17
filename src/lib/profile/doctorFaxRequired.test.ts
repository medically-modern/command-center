/**
 * One rule, three surfaces. The tests exist because the gap this closes was a
 * rule that lived on one page and a banner on another page claiming it.
 *
 * The fixtures are the LIVE exception set, read off Profile Send Off on
 * 2026-09-17 (~581 non-empty Doctor Fax values). That matters in both
 * directions: seven real values must be refused, and five must not be.
 */
import { describe, it, expect } from "vitest";
import {
  DOCTOR_FAX_ROW_LABEL,
  doctorFaxGap,
  doctorFaxMissing,
  doctorFormFaxRefusal,
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
    expect(faxMethodChosen({ clinicalsMethod: "Dashboard" })).toBe(false);
  });

  it("⚠️ is NOT a blank method", () => {
    /* Brandon asked for "if method is fax". A blank is unanswered — and reading
       it as a fax would pull in the 415 Fax-method rows with no fax at all, 359
       of them in the 8/25 bulk import. §5.9 does route a blank to the fax chase
       queue; widening this is a decision, recorded in the module header. */
    expect(faxMethodChosen({ clinicalsMethod: "" })).toBe(false);
    expect(faxMethodChosen({ clinicalsMethod: "   " })).toBe(false);
    expect(faxMethodChosen({})).toBe(false);
  });
});

describe("hasDoctorFax — an @rcfax.com address, not merely something typed", () => {
  it("accepts the ordinary shape", () => {
    expect(hasDoctorFax({ doctorFax: "7186799822@rcfax.com" })).toBe(true);
  });

  it("⚠️ accepts the two live shapes that MUST NOT be refused", () => {
    // A working fax refused is the one direction this check must never fail in.
    expect(hasDoctorFax({ doctorFax: "3367130547@RCFAX.com" })).toBe(true);   // live; domains are case-insensitive
    expect(hasDoctorFax({ doctorFax: "13102138290@rcfax.com" })).toBe(true);  // live; 11 digits, leading 1
    expect(hasDoctorFax({ doctorFax: "18432349057@rcfax.com" })).toBe(true);  // live
    expect(hasDoctorFax({ doctorFax: "19724066715@rcfax.com" })).toBe(true);  // live
    expect(hasDoctorFax({ doctorFax: "14065854650@rcfax.com" })).toBe(true);  // live
  });

  it("⚠️ refuses the seven live values a presence check called fine", () => {
    // Every one of these is on the board and a fax to it goes nowhere.
    expect(hasDoctorFax({ doctorFax: "smweissoffice@gmail.com" })).toBe(false); // an inbox in the fax field
    expect(hasDoctorFax({ doctorFax: "3156270554@rcfaxcom" })).toBe(false);     // the dot is missing
    expect(hasDoctorFax({ doctorFax: "fax@rcfax.com" })).toBe(false);           // local part is a word
    expect(hasDoctorFax({ doctorFax: "josh.pso@rcfax.com" })).toBe(false);      // local part is a handle
    expect(hasDoctorFax({ doctorFax: "805343557@rcfax.com" })).toBe(false);     // 9 digits — truncated
    expect(hasDoctorFax({ doctorFax: "423892505@rcfax.com" })).toBe(false);
    expect(hasDoctorFax({ doctorFax: "516832442@rcfax.com" })).toBe(false);
  });

  it("refuses the empty shapes", () => {
    expect(hasDoctorFax({ doctorFax: "@rcfax.com" })).toBe(false);
    expect(hasDoctorFax({ doctorFax: "  " })).toBe(false);
    expect(hasDoctorFax({})).toBe(false);
  });

  it("refuses a bare number — the column is an address (§5.5)", () => {
    // `toFaxAddress` is what turns a typed number into one; until it has run,
    // the value is not sendable.
    expect(hasDoctorFax({ doctorFax: "7186799822" })).toBe(false);
  });
});

describe("doctorFaxGap — blank and malformed are different messages", () => {
  it("names a blank field", () => {
    expect(doctorFaxGap({ clinicalsMethod: "Fax", doctorFax: "" })).toBe("blank");
  });

  it("names a filled field holding the wrong thing", () => {
    // Clara Perlstein's live row. "Add a fax" would point a rep at a box that
    // already has something in it.
    expect(doctorFaxGap({ clinicalsMethod: "Fax", doctorFax: "smweissoffice@gmail.com" })).toBe("malformed");
  });

  it("is null when there is nothing to report", () => {
    expect(doctorFaxGap({ clinicalsMethod: "Fax", doctorFax: "9132732474@rcfax.com" })).toBeNull();
    expect(doctorFaxGap({ clinicalsMethod: "Parachute", doctorFax: "" })).toBeNull();
    expect(doctorFaxGap({ clinicalsMethod: "", doctorFax: "" })).toBeNull();
  });
});

describe("doctorFaxMissing — what the gate and the banner both read", () => {
  it("fires on Fax with no fax", () => {
    expect(doctorFaxMissing({ clinicalsMethod: "Fax", doctorFax: "" })).toBe(true);
  });

  it("fires on Fax with an unsendable value", () => {
    expect(doctorFaxMissing({ clinicalsMethod: "Fax", doctorFax: "3156270554@rcfaxcom" })).toBe(true);
  });

  it("is quiet once a real fax address is on file", () => {
    // The three Fax rows in the worked groups on 2026-09-17 are all this case,
    // which is why the readiness row blocks nobody in them on the day it ships.
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

describe("doctorFormFaxRefusal — the requirement at the point of ENTRY", () => {
  it("⚠️ refuses a Fax doctor added with no fax — the default path", () => {
    // The form's Method defaults to "Fax", so this is what a rep gets by not
    // touching the dropdown. 22 of the 267 Fax records in the live Doctor
    // Database hold no fax; this is how they got there.
    const msg = doctorFormFaxRefusal("Fax", "");
    expect(msg).toBeTruthy();
    // Both ways out are named — the second is usually the right one.
    expect(msg).toMatch(/required/);
    expect(msg).toMatch(/Parachute or Email/);
  });

  it("accepts a typed number, because the save turns it into an address", () => {
    expect(doctorFormFaxRefusal("Fax", "8653742115")).toBeNull();
    expect(doctorFormFaxRefusal("Fax", "(865) 374-2115")).toBeNull();
    expect(doctorFormFaxRefusal("Fax", "8653742115@rcfax.com")).toBeNull();
  });

  it("⚠️ refuses an ordinary email pasted into the fax box", () => {
    // toFaxAddress keeps any "@" value verbatim, which is the hole the live
    // audit found on Clara Perlstein — an inbox in the fax column.
    const msg = doctorFormFaxRefusal("Fax", "smweissoffice@gmail.com");
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/can't be faxed/);
  });

  it("refuses a truncated number", () => {
    expect(doctorFormFaxRefusal("Fax", "865374211")).toBeTruthy();
  });

  it("is silent for the methods that need no fax", () => {
    expect(doctorFormFaxRefusal("Parachute", "")).toBeNull();
    expect(doctorFormFaxRefusal("Email", "")).toBeNull();
    // ~half the live Doctor Database is Parachute and 194 of those hold no fax.
    expect(doctorFormFaxRefusal("Parachute", "not a fax")).toBeNull();
  });
});
