// Tests for the Evaluate MN returning-patient self-heal predicate
// (evaluateReentry.ts). The masheke poll clears a STALE "Escalation Required"
// flag on Evaluate MN patients so they reappear in the rep's active queue —
// but must NEVER clear a legitimate 3rd-attempt SOP escalation (counter >= 3),
// and must fail SAFE on a blank/unreadable counter (leave it, don't clear).
// Run: npx vitest run src/lib/masheke/evaluateReentry.test.ts
import { describe, it, expect } from "vitest";
import { evaluationCounterValue, hasStaleEvaluateEscalation } from "./evaluateReentry";
import { ESCALATION_INDEX } from "./mondayMapping";
import type { Patient } from "./workflow";

// Detection is INDEX-based (the board renamed the escalation labels 2026-07),
// so fixtures set escalationIndex — the field production actually reads — not
// the stale `escalation` label string.
const ESC = ESCALATION_INDEX.required; // 0 = (Manager) Escalation Required

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
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalationIndex: ESC, evaluationCounter: "1" }))).toBe(true);
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalationIndex: ESC, evaluationCounter: "2" }))).toBe(true);
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalationIndex: ESC, evaluationCounter: "0" }))).toBe(true);
  });

  it("still flags when the board shows the renamed 'Manager Escalation Required' label (index 0)", () => {
    // The regression this fixes: the old label-text match `escalation === "Escalation
    // Required"` returned false here because the live label is now "Manager Escalation
    // Required". Index-based detection ignores the label text entirely.
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalation: "Manager Escalation Required", escalationIndex: ESC, evaluationCounter: "1" }))).toBe(true);
  });

  it("does NOT flag a legitimate 3rd-attempt SOP escalation (counter >= 3)", () => {
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalationIndex: ESC, evaluationCounter: "3" }))).toBe(false);
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalationIndex: ESC, evaluationCounter: "5" }))).toBe(false);
  });

  it("FAILS SAFE on a blank / unreadable counter — leaves it for a manager", () => {
    // If numeric_mm4bhjc8 were ever dropped from the read set every counter reads
    // blank; treating blank as attempt 1 would wrongly clear real >=3 escalations.
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalationIndex: ESC }))).toBe(false);
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalationIndex: ESC, evaluationCounter: "" }))).toBe(false);
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalationIndex: ESC, evaluationCounter: "oops" }))).toBe(false);
  });

  it("does NOT flag patients in other stages (escalation is legitimate there)", () => {
    expect(hasStaleEvaluateEscalation(p({ subStage: "Chase Clinicals", escalationIndex: ESC, evaluationCounter: "1" }))).toBe(false);
    expect(hasStaleEvaluateEscalation(p({ subStage: "Send Request", escalationIndex: ESC, evaluationCounter: "1" }))).toBe(false);
    expect(hasStaleEvaluateEscalation(p({ subStage: "Confirm Receipt", escalationIndex: ESC, evaluationCounter: "2" }))).toBe(false);
  });

  it("does NOT flag a non-escalated Evaluate MN patient", () => {
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", evaluationCounter: "1" }))).toBe(false);
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalationIndex: ESCALATION_INDEX.done, evaluationCounter: "1" }))).toBe(false);
    expect(hasStaleEvaluateEscalation(p({ subStage: "Evaluate MN", escalationIndex: ESCALATION_INDEX.finalRequired, evaluationCounter: "1" }))).toBe(false);
  });
});
