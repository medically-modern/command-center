/**
 * The age-based default for "whose number is this?" (Brandon, 2026-09-11).
 *
 * The interesting cases are all about NOT answering: a DOB we cannot read, a
 * board answer that already exists, and the day either side of a birthday.
 */
import { describe, it, expect } from "vitest";
import { ageFromDob, defaultOwnerForAge, slotsFromPatient, ADULT_AGE } from "./phoneSlots";

const src = (over: Record<string, string> = {}) => ({
  phone: "(555) 555-0100",
  alternatePhone: "",
  primaryContact: "",
  alternateContact: "",
  canText: "",
  dob: "",
  ...over,
});

describe("ageFromDob", () => {
  it("reads both shapes the live DOB column actually holds", () => {
    // Unpadded and padded both occur on the board — 12/5/1960 and 02/24/1981.
    expect(ageFromDob("12/5/1960", "2026-09-11")).toBe(65);
    expect(ageFromDob("02/24/1981", "2026-09-11")).toBe(45);
  });

  it("reads an ISO date too, in case the column is ever normalised", () => {
    expect(ageFromDob("1981-02-24", "2026-09-11")).toBe(45);
  });

  it("has not had the birthday yet this month", () => {
    expect(ageFromDob("09/12/2005", "2026-09-11")).toBe(20);
    expect(ageFromDob("09/11/2005", "2026-09-11")).toBe(21);
    expect(ageFromDob("10/01/2005", "2026-09-11")).toBe(20);
  });

  it("is null for anything it cannot read, rather than a guess", () => {
    for (const bad of ["", "   ", "unknown", "13/01/1990", "01/45/1990", "1990", "n/a"]) {
      expect(ageFromDob(bad, "2026-09-11")).toBeNull();
    }
  });
});

describe("defaultOwnerForAge", () => {
  it("adults are the patient, minors are a caregiver", () => {
    expect(defaultOwnerForAge("01/01/1980", "2026-09-11")).toBe("patient");
    expect(defaultOwnerForAge("01/01/2016", "2026-09-11")).toBe("caregiver");
  });

  it("21 exactly is an adult", () => {
    expect(ADULT_AGE).toBe(21);
    expect(defaultOwnerForAge("09/11/2005", "2026-09-11")).toBe("patient");
    expect(defaultOwnerForAge("09/12/2005", "2026-09-11")).toBe("caregiver");
  });

  /* ⚠️ The whole safety property. A default that guessed on absent data would
     record an answer nobody gave — and the send WRITES this column. Blank
     leaves the gate asking. */
  it("answers nothing when there is no readable DOB", () => {
    expect(defaultOwnerForAge("", "2026-09-11")).toBe("");
    expect(defaultOwnerForAge("not a date", "2026-09-11")).toBe("");
  });
});

describe("slotsFromPatient applies the default", () => {
  it("fills a blank Primary Contact", () => {
    expect(slotsFromPatient(src({ dob: "06/02/2016" }), "2026-09-11")[0].owner).toBe("caregiver");
    expect(slotsFromPatient(src({ dob: "06/02/1970" }), "2026-09-11")[0].owner).toBe("patient");
  });

  /* The board is the source of truth; this only fills a column nobody wrote. */
  it("never overrides what the board says", () => {
    const s = slotsFromPatient(src({ dob: "06/02/2016", primaryContact: "Patient" }), "2026-09-11");
    expect(s[0].owner).toBe("patient");
  });

  it("leaves the slot blank when the DOB is unreadable", () => {
    expect(slotsFromPatient(src({ dob: "" }), "2026-09-11")[0].owner).toBe("");
  });

  /* ⚠️ Slot 1 only. "The patient is an adult" says nothing about whose SECOND
     number this is, and a wrong owner there writes the wrong Alternate Contact. */
  it("does not guess the alternate slot's owner", () => {
    const s = slotsFromPatient(
      src({ dob: "06/02/1970", alternatePhone: "(555) 555-0199" }),
      "2026-09-11",
    );
    expect(s).toHaveLength(2);
    expect(s[1].owner).toBe("");
  });
});
