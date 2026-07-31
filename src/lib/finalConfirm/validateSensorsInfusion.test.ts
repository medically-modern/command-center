// The sensors-only infusion invariant.
//
// Raised twice in review on PR #21: when "Not Serving" cannot be resolved from
// the live board, the Sensors selector leaves the previous pump-side infusion
// set in patient state, and the Final Confirm writer persists that product index
// onto a record now marked sensors-only. A toast was the first fix and was not
// enough — it is advisory, and the send still went through. This blocks it.

import { describe, it, expect } from "vitest";

import { validatePatientForSend } from "./workflow";

type P = Parameters<typeof validatePatientForSend>[0];

/** Only the fields this rule reads; everything else is irrelevant to it. */
const patient = (over: Partial<P>): P =>
  ({
    subscriptionType: "",
    infusionSet1: "",
    infusionSet2: "",
    ...over,
  }) as P;

describe("validatePatientForSend — sensors-only infusion invariant", () => {
  it("blocks the send when Sensors still carries a real infusion set", () => {
    const r = validatePatientForSend(
      patient({ subscriptionType: "Sensors", infusionSet1: 'AutoSoft XC 6 mm 23"' }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain("Infusion Set 1");
    expect(r.errors[0]).toContain('AutoSoft XC 6 mm 23"');
  });

  it("names both slots when both are stuck", () => {
    const r = validatePatientForSend(
      patient({
        subscriptionType: "Sensors",
        infusionSet1: 'AutoSoft XC 6 mm 23"',
        infusionSet2: 'TruSteel 6 mm 23"',
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain("Infusion Set 1");
    expect(r.errors[0]).toContain("Infusion Set 2");
  });

  it("allows Sensors when both slots are Not Serving", () => {
    const r = validatePatientForSend(
      patient({
        subscriptionType: "Sensors",
        infusionSet1: "Not Serving",
        infusionSet2: "Not Serving",
      }),
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("allows Sensors when both slots are blank — blank is not a product", () => {
    // A never-set column writes nothing (the writer skips a null index), so it
    // is not the contradiction this rule is guarding against.
    const r = validatePatientForSend(patient({ subscriptionType: "Sensors" }));
    expect(r.valid).toBe(true);
  });

  it("ignores whitespace-only labels", () => {
    const r = validatePatientForSend(
      patient({ subscriptionType: "Sensors", infusionSet1: "   " }),
    );
    expect(r.valid).toBe(true);
  });

  it("does not fire for Supplies or Sensors & Supplies", () => {
    for (const t of ["Supplies", "Sensors & Supplies"]) {
      const r = validatePatientForSend(
        patient({ subscriptionType: t, infusionSet1: 'AutoSoft XC 6 mm 23"' }),
      );
      expect(r.valid, `${t} should not be blocked`).toBe(true);
    }
  });

  it("reads the label, not an index — survives a board renumbering", () => {
    // The whole point of the migration: indexes move, labels are the contract.
    const r = validatePatientForSend(
      patient({ subscriptionType: "Sensors", infusionSet1: 'QuickSet 18"' }),
    );
    expect(r.valid).toBe(false);
  });
});
