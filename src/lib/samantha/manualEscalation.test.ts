/**
 * Which rung the send's Escalate toggle writes, per stage.
 *
 * The rung is not cosmetic: it decides WHICH manager column the patient lands
 * in, and an escalated patient is out of the rep's queue either way — so a rung
 * with no chart above it is a patient nobody can see (insuranceCoverage.test).
 */
import { describe, it, expect } from "vitest";
import { manualEscalationLevel } from "./mondayWrite";

describe("manualEscalationLevel", () => {
  it("Submit Auth goes straight to Final", () => {
    // Josh 2026-08-03. That stage's Manager rung is the two-step Propose Stuck
    // review, whose chart bar keys on the stamped reason a proposal leaves
    // behind. The toggle stamps nothing, so a toggled patient sitting at
    // Manager had no proposal for anyone to review.
    expect(manualEscalationLevel("submitAuth", true)).toBe("final");
  });

  it("Auth Outstanding also goes to Final — its only manager rung", () => {
    // Josh 2026-08-03. The Manager Intervention chart built for this stage
    // earlier the same night was removed: an Auth Outstanding escalation should
    // only ever land in Final Decisions, so Manager is not a destination here.
    expect(manualEscalationLevel("authOutstanding", true)).toBe("final");
  });

  it("Benefits never escalates from the flag — it is derived from the checks", () => {
    // The Escalate button is gone at Benefits (redesign §5). Honouring a
    // hydrated flag there would make a patient impossible to de-escalate by
    // fixing the facts and re-sending.
    expect(manualEscalationLevel("benefits", true)).toBe("done");
  });

  it("writes Done when the toggle is off, so it round-trips through Monday", () => {
    for (const ctx of ["benefits", "submitAuth", "authOutstanding"] as const) {
      expect(manualEscalationLevel(ctx, false), ctx).toBe("done");
    }
  });
});
