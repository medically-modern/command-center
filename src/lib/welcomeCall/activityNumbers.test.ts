import { describe, it, expect } from "vitest";
import { activityNumbers, canTextForNumber } from "./activityMatch";
import { slotsFromPatient, starSlot } from "./phoneSlots";

const patient = {
  phone: "(555) 555-0100",
  alternatePhone: "5555550101",
  primaryContact: "Patient",
  alternateContact: "Caregiver",
  canText: "Yes",
  dob: "01/01/1970",
};

describe("activityNumbers", () => {
  it("offers both slots, starred first", () => {
    expect(activityNumbers(slotsFromPatient(patient))).toEqual([
      { label: "Primary", number: "(555) 555-0100" },
      { label: "Alternate", number: "5555550101" },
    ]);
  });

  it("follows the STAR, not the board column", () => {
    /* The bug this exists for: the box read `phoneEdited ?? phone` — the Primary
       Phone column — so moving the star left the header dialling and texting the
       number the rep had just demoted. */
    const moved = starSlot(slotsFromPatient(patient), 1);
    expect(activityNumbers(moved)[0]).toEqual({ label: "Primary", number: "5555550101" });
  });

  it("drops an abandoned + Add number rather than showing a blank tab", () => {
    expect(
      activityNumbers([
        { number: "(555) 555-0100", starred: true },
        { number: "   ", starred: false },
      ]),
    ).toHaveLength(1);
  });

  it("collapses one number typed two ways", () => {
    // Two entries would fetch the same thread twice and offer a choice that is
    // not a choice.
    expect(
      activityNumbers([
        { number: "(555) 555-0100", starred: true },
        { number: "5555550100", starred: false },
      ]),
    ).toEqual([{ label: "Primary", number: "(555) 555-0100" }]);
  });

  it("keeps a number it cannot parse, so the box can say so", () => {
    const out = activityNumbers([{ number: "ask mom", starred: true }]);
    expect(out).toEqual([{ label: "Primary", number: "ask mom" }]);
  });

  it("is empty for a patient with no number on file", () => {
    expect(activityNumbers(slotsFromPatient({ ...patient, phone: "", alternatePhone: "" }))).toEqual([]);
  });
});

describe("canTextForNumber — the Can Text answer for the number on screen (§5.50)", () => {
  const slots = [
    { number: "(555) 555-0100", canText: "yes" as const },
    { number: "555.555.0199", canText: "no" as const },
    { number: "5555550177", canText: "" as const },
  ];

  it("matches on DIGITS, the same identity the box de-duplicates on", () => {
    expect(canTextForNumber(slots, "+15555550100")).toBe("yes");
    expect(canTextForNumber(slots, "(555) 555-0199")).toBe("no");
  });

  // ⚠️ Only an explicit No blocks the composer (§5.31d). A blank is unknown,
  // and a number no slot holds says nothing at all.
  it("reads a blank answer, an unknown number or no number as unknown — never a No", () => {
    expect(canTextForNumber(slots, "555-555-0177")).toBe("unknown");
    expect(canTextForNumber(slots, "555-555-0000")).toBe("unknown");
    expect(canTextForNumber(slots, "")).toBe("unknown");
  });
});
