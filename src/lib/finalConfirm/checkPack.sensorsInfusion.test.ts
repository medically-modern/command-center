/**
 * The sensors-only infusion invariant — now owned by the check pack (C15).
 *
 * History, because this rule has been re-broken once already: raised twice in
 * review on PR #21. When "Not Serving" can't be resolved from the live board,
 * the Sensors selector leaves the previous pump-side infusion set sitting in
 * patient state, and the Final Confirm writer persists that product index onto
 * a record now marked sensors-only. A toast was the first fix and wasn't
 * enough — advisory, and the send still went through — so it became a HARD
 * gate (`validatePatientForSend`).
 *
 * That gate was removed on 2026-08-03 when Final Confirm went advisory-only
 * (Brandon: nothing ever blocks Send). C15 inherits the invariant at RED
 * severity, which puts it top-of-panel and in every send dialog.
 *
 * The handoff assumed C15 already covered this. It did not: C15's
 * `expectedSubscriptionType` keyed on INDEXES only, so the original failure
 * mode — a real set label with no index yet — sailed straight through. These
 * cases are ported verbatim from the deleted gate's suite so the gap can't
 * reopen silently.
 */
import { describe, it, expect } from "vitest";

import { runFinalChecks } from "./checkPack";
import { basePatient } from "./checkPack.test";
import type { Patient } from "./workflow";

const fires = (over: Partial<Patient>): boolean =>
  runFinalChecks({ ...basePatient(), ...over }).some((f) => f.id === "C15_SUBSCRIPTION_MISMATCH");

describe("C15 — sensors-only infusion invariant (inherited from the removed send gate)", () => {
  it("fires when Sensors still carries a real infusion set", () => {
    expect(fires({ subscriptionType: "Sensors", infusionSet1: 'AutoSoft XC 6 mm 23"' })).toBe(true);
  });

  it("fires when both slots are stuck", () => {
    expect(
      fires({
        subscriptionType: "Sensors",
        infusionSet1: 'AutoSoft XC 6 mm 23"',
        infusionSet2: 'TruSteel 6 mm 23"',
      }),
    ).toBe(true);
  });

  it("fires on a blank label that still carries a live index — the index is what gets written", () => {
    // An item pointing at a label deleted from the board reads back with empty
    // text but a live index. A label-only test would wave it through while
    // sendPatientToMonday writes that dead index onto a sensors record.
    expect(fires({ subscriptionType: "Sensors", infusionSet1: "", infusionSet1Index: 107 })).toBe(true);
  });

  it("fires on a label the board has since renumbered — labels are the contract", () => {
    expect(fires({ subscriptionType: "Sensors", infusionSet1: 'QuickSet 18"' })).toBe(true);
  });

  it("stays quiet when both slots are Not Serving", () => {
    expect(
      fires({ subscriptionType: "Sensors", infusionSet1: "Not Serving", infusionSet2: "Not Serving" }),
    ).toBe(false);
  });

  it("stays quiet when Not Serving carries an index", () => {
    expect(
      fires({
        subscriptionType: "Sensors",
        infusionSet1: "Not Serving",
        infusionSet1Index: 104,
        infusionSet2: "Not Serving",
        infusionSet2Index: 12,
      }),
    ).toBe(false);
  });

  it("stays quiet when both slots are genuinely unset — blank label AND null index", () => {
    // A never-set column writes nothing (the writer skips a null index), so it
    // is not the contradiction this rule guards against.
    expect(fires({ subscriptionType: "Sensors" })).toBe(false);
  });

  it("ignores whitespace-only labels", () => {
    expect(fires({ subscriptionType: "Sensors", infusionSet1: "   " })).toBe(false);
  });

  it("stays quiet for a Supplies subscription carrying an infusion set", () => {
    expect(fires({ subscriptionType: "Supplies", infusionSet1: 'AutoSoft XC 6 mm 23"' })).toBe(false);
  });

  it("fires for Sensors & Supplies with no CGM product — wider than the old gate, deliberately", () => {
    // The gate only ever looked at the Sensors case. C15 compares the whole
    // subscription against the products, so "Sensors & Supplies" with an
    // infusion set but no CGM is a real mismatch the gate used to miss.
    expect(fires({ subscriptionType: "Sensors & Supplies", infusionSet1: 'AutoSoft XC 6 mm 23"' })).toBe(true);
  });
});
