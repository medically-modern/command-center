// Tests for the Evaluate MN returning-patient self-heal predicate
// (evaluateReentry.ts). The masheke poll clears a STALE "Escalation Required"
// flag on Evaluate MN patients so they reappear in the rep's active queue —
// but must NEVER clear a legitimate 3rd-attempt SOP escalation (counter >= 3),
// and must fail SAFE on a blank/unreadable counter (leave it, don't clear).
// Run: npx vitest run src/lib/masheke/evaluateReentry.test.ts
import { describe, it, expect } from "vitest";
import { evaluationCounterValue, hasStaleEvaluateEscalation } from "./evaluateReentry";
import type { Patient } from "./workflow";

const p = (over: Partial<Patient>): Patient =>
  ({ id: "x", name: "n", dob: "", notes: "", ...over } as Patient);

describe("evaluationCounterValue — parse contract", () => {
  it("returns null for blank / undefined (NOT 1 — must fail safe)", () => {
    expect(evaluationCounterValue(p({}))).toBeNull();
    expect(evaluationCounterValue(p({ evaluationCounter: "" }))).toBeNull();
    expect(evaluationCounterValue(p({ evaluationCounter: "   " }))).toBeNull();
    expect(evaluationCounterValue(p({ evaluationCounter: undefined }))).toBeNull();
  });
  it("returns null for non-numeric strings", () => {
    expect(evaluationCounterValue(p({ evaluationCounter: "abc" }))).toBeNull();
    expect(evaluationCounterValue(p({ evaluationCounter: "n/a" }))).toBeNull();
  });
  it("parses integers and decimals", () => {
    expect(evaluationCounterValue(p({ evaluationCounter: "0" }))).toBe(0);
    expect(evaluationCounterValue(p({ evaluationCounter: "2" }))).toBe(2);
    expect(evaluationCounterValue(p({ evaluationCounter: "3" }))).toBe(3);
    expect(evaluationCounterValue(p({ evaluationCounter: "2.5" }))).toBe(2.5);
  });
});

describe("hasStaleEvaluateEscalation", () => {
  it("flags an escalated Evaluate MN patient with a concrete low counter (stale carry-over)", () => {
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalation: "Escalation Required", evaluationCounter: "1" }))).toBe(true);
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalation: "Escalation Required", evaluationCounter: "2" }))).toBe(true);
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalation: "Escalation Required", evaluationCounter: "0" }))).toBe(true);
  });

  it("does NOT flag a legitimate 3rd-attempt SOP escalation (counter >= 3)", () => {
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalation: "Escalation Required", evaluationCounter: "3" }))).toBe(false);
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalation: "Escalation Required", evaluationCounter: "5" }))).toBe(false);
  });

  it("FAILS SAFE on a blank / unreadable counter — leaves it for a manager", () => {
    // If numeric_mm4bhjc8 were ever dropped from the read set every counter reads
    // blank; treating blank as attempt 1 would wrongly clear real >=3 escalations.
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalation: "Escalation Required" }))).toBe(false);
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalation: "Escalation Required", evaluationCounter: "" }))).toBe(false);
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalation: "Escalation Required", evaluationCounter: "oops" }))).toBe(false);
  });

  it("does NOT flag patients in other stages (escalation is legitimate there)", () => {
    expect(hasStaleEvaluateEscalation(p({ subStage: "Chase Clinicals", escalation: "Escalation Required", evaluationCounter: "1" }))).toBe(false);
    expect(hasStaleEvaluateEscalation(p({ subStage: "Send Request", escalation: "Escalation Required", evaluationCounter: "1" }))).toBe(false);
    expect(hasStaleEvaluateEscalation(p({ subStage: "Confirm Receipt", escalation: "Escalation Required", evaluationCounter: "2" }))).toBe(false);
  });

  it("does NOT flag a non-escalated Evaluate MN patient", () => {
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", evaluationCounter: "1" }))).toBe(false);
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalation: "Done", evaluationCounter: "1" }))).toBe(false);
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalation: "", evaluationCounter: "1" }))).toBe(false);
  });
});
