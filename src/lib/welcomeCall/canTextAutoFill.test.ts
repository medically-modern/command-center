/**
 * The Can Text auto-fill (Josh, 2026-09-17). The rule only ever ADDS a "yes" to
 * a blank slot, so every test here is really about what it must NOT do.
 */
import { describe, it, expect } from "vitest";
import { canTextWasDerived, fillCanTextFromEvidence, type PhoneSlot } from "./phoneSlots";

const slot = (over: Partial<PhoneSlot> = {}): PhoneSlot => ({
  number: "(555) 555-0100",
  owner: "patient",
  starred: true,
  canText: "",
  ...over,
});

describe("fillCanTextFromEvidence", () => {
  it("fills a blank from evidence", () => {
    const out = fillCanTextFromEvidence([slot()], { "(555) 555-0100": "yes" });
    expect(out[0].canText).toBe("yes");
  });

  it("matches on DIGITS, not on the spelling", () => {
    // The gateway keys its answer by the string we sent, and the rep may have
    // reformatted the field since.
    expect(fillCanTextFromEvidence([slot({ number: "5555550100" })], { "(555) 555-0100": "yes" })[0].canText)
      .toBe("yes");
  });

  it("NEVER overwrites an answer the rep or the board already gave", () => {
    expect(fillCanTextFromEvidence([slot({ canText: "no" })], { "(555) 555-0100": "yes" })[0].canText)
      .toBe("no");
    expect(fillCanTextFromEvidence([slot({ canText: "yes" })], {})[0].canText).toBe("yes");
  });

  it("never writes a NO — absent evidence leaves the question unanswered", () => {
    const out = fillCanTextFromEvidence([slot()], {});
    expect(out[0].canText).toBe("");
  });

  it("fills only the slot the evidence is about", () => {
    const out = fillCanTextFromEvidence(
      [slot(), slot({ number: "(555) 555-0101", starred: false })],
      { "5555550101": "yes" },
    );
    expect(out[0].canText).toBe("");
    expect(out[1].canText).toBe("yes");
  });

  it("⚠️ returns the SAME ARRAY when nothing changes", () => {
    /* This is the loop guard, not a nicety: the caller writes the result back
       into the page overlay from an effect, so a fresh array every render is
       INCIDENT_2026-08-20's rule 2 with a state write attached. */
    const slots = [slot({ canText: "yes" })];
    expect(fillCanTextFromEvidence(slots, { "(555) 555-0100": "yes" })).toBe(slots);
    expect(fillCanTextFromEvidence(slots, {})).toBe(slots);
    const blank = [slot()];
    expect(fillCanTextFromEvidence(blank, {})).toBe(blank);
    // …and a NEW array exactly when it did something.
    expect(fillCanTextFromEvidence(blank, { "5555550100": "yes" })).not.toBe(blank);
  });

  it("ignores a blank number and junk evidence", () => {
    const blank = [slot({ number: "  " })];
    expect(fillCanTextFromEvidence(blank, { "": "yes" })).toBe(blank);
  });
});

describe("canTextWasDerived — the screen has to say so", () => {
  it("is true only for a yes our evidence supports", () => {
    expect(canTextWasDerived(slot({ canText: "yes" }), { "5555550100": "yes" })).toBe(true);
    expect(canTextWasDerived(slot({ canText: "yes" }), {})).toBe(false);
    expect(canTextWasDerived(slot({ canText: "no" }), { "5555550100": "yes" })).toBe(false);
    expect(canTextWasDerived(slot({ canText: "" }), { "5555550100": "yes" })).toBe(false);
  });

  it("does not claim a derivation for a different number", () => {
    expect(canTextWasDerived(slot({ canText: "yes" }), { "5555559999": "yes" })).toBe(false);
  });
});
