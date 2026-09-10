import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Where the phone slots are READ FROM — scanned, because neither file is wrong
 * on its own and `tsc` is happy with both. Only the PAIR can be wrong.
 *
 * This is the `secondaryAnswerSource.test.ts` convention, and it exists for the
 * same reason that one does: §5.31c's secondary "Unknown" lived in component
 * state, invisible to the page, so the page's send gate went on reading the
 * column — and a patient already carrying NY Medicaid showed Unknown on screen
 * while Advance stayed shut on a CIN the rep had just recorded as unknown. A
 * gate with no passing move, shipped, and caught in review rather than by a
 * test (Greptile, PR #56).
 *
 * The exposure here is larger: `phoneSlotGaps` IS a gate input. Slots held in
 * the phone component would leave the gate reading columns the rep had already
 * edited past.
 */
const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

const SECTION = read("./PhoneSlotsSection.tsx");
const PAGE = read("../../pages/WelcomeCallPage.tsx");
const WRITE = read("../../lib/welcomeCall/mondayWrite.ts");

describe("the phone slots have ONE source", () => {
  it("the section reads through phoneSlotsFor / caregiverFor", () => {
    expect(SECTION).toMatch(/phoneSlotsFor\(patient\)/);
    expect(SECTION).toMatch(/caregiverFor\(patient\)/);
  });

  it("the section never reads the phone or caregiver COLUMNS directly", () => {
    // patient.phone / patient.alternatePhone / patient.primaryContact etc. are
    // the board's answer. Once the rep edits, the overlay is the answer.
    for (const col of [
      "patient.phone",
      "patient.alternatePhone",
      "patient.primaryContact",
      "patient.alternateContact",
      "patient.canText",
      "patient.caregiverName",
      "patient.caregiverAuthorized",
    ]) {
      expect(SECTION).not.toContain(col);
    }
  });

  it("the section holds no slot state of its own", () => {
    // A useState here is the bug this whole file exists to prevent.
    expect(SECTION).not.toMatch(/useState/);
  });

  it("the section writes back to the page overlay", () => {
    expect(SECTION).toMatch(/onFieldChange\("phoneSlotsEdited"/);
    expect(SECTION).toMatch(/onFieldChange\("caregiverEdited"/);
  });

  it("the page's send gate reads the same helper, not the columns", () => {
    expect(PAGE).toMatch(/phoneSlotGaps\(phoneSlotsFor\(selected\)\)/);
  });

  it("the send writes from the same helper too", () => {
    // Otherwise the board could receive something other than what the gate
    // approved — the two ends agreeing is the point.
    expect(WRITE).toMatch(/phoneSlotWrites\(phoneSlotsFor\(p\), caregiverFor\(p\)\)/);
  });
});

describe("the retired phone controls are gone, not merely unimported", () => {
  it("CallIntakeFields no longer exports a phone or caretaker section", () => {
    const fields = read("./CallIntakeFields.tsx");
    expect(fields).not.toMatch(/export function PhoneNumbersSection/);
    expect(fields).not.toMatch(/export function CaretakerSection/);
  });

  it("the banner has no second phone editor", () => {
    // Two controls writing one column is how they disagree — the reason the
    // Secondary Insurance select left this card the day before.
    const card = read("./PatientInfoCard.tsx");
    expect(card).not.toMatch(/function PhoneField/);
    expect(card).not.toMatch(/onSavePhone/);
  });
});
