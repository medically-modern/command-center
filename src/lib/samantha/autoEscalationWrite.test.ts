/**
 * What a send is allowed to write to the Escalation column.
 *
 * There is NO Escalate toggle in the Insurance UI (Josh, 2026-08-03) — the only
 * escalation affordance is the Propose Stuck popup, plus the manager decision
 * buttons and the board automations. Before this, the send re-wrote whatever
 * label the patient already carried (`p.escalated` is hydrated FROM the board),
 * which silently promoted pending proposals past their review and silently
 * cleared flags the page hadn't polled yet.
 *
 * So the rule these tests pin is: a send touches this column only when an AUTO
 * rule decides one, and an auto rule only ever raises.
 */
import { describe, it, expect } from "vitest";
import { autoEscalationWrite } from "./mondayWrite";

const FINAL = "Final Escalation Required";
const MANAGER = "Manager Escalation Required";

describe("autoEscalationWrite", () => {
  it("writes nothing when no auto rule fired — this is the Submit Auth case", () => {
    // Submit Auth has no auto escalation rule, so it always passes null. That
    // is what keeps a rep's Propose Stuck (Manager + stamp) sitting in Manager
    // Intervention until a manager reviews it, instead of the next send of the
    // same patient promoting them to Final with no note and no decision.
    expect(autoEscalationWrite(null, undefined)).toBeNull();
  });

  it("leaves an existing label alone when no auto rule fired", () => {
    // The silent-promotion and silent-clearing bugs, stated directly: a patient
    // already carrying a label must come out of an ordinary send unchanged.
    for (const label of [MANAGER, FINAL]) {
      expect(autoEscalationWrite(null, label), label).toBeNull();
    }
  });

  it("raises to Final for the pump-SoS hold", () => {
    // The hold writes no stage, so the patient stays AT Auth Outstanding —
    // whose only manager rung is Final Decisions.
    expect(autoEscalationWrite("final", undefined)).toBe("final");
    expect(autoEscalationWrite("final", MANAGER)).toBe("final");
  });

  it("raises to Manager for a denial", () => {
    // A denial moves the patient to Auth Denied, a stage under construction
    // with no charts at either rung — so Manager, rather than pre-judging it.
    expect(autoEscalationWrite("manager", undefined)).toBe("manager");
    expect(autoEscalationWrite("manager", MANAGER)).toBe("manager");
  });

  it("never lowers Final — a denial can't undo a manager's promotion", () => {
    expect(autoEscalationWrite("manager", FINAL)).toBeNull();
  });

  it("never writes Done, so a send cannot clear an escalation", () => {
    // Only the manager's "Send back to pipeline" clears one at these stages.
    // (Benefits is the exception and doesn't go through this helper: escalation
    // there is derived from the universal checks, so re-sending with the facts
    // fixed is *meant* to clear it.)
    const everyInput = [null, "manager", "final"] as const;
    for (const auto of everyInput) {
      for (const label of [undefined, MANAGER, FINAL]) {
        expect(autoEscalationWrite(auto, label), `${auto} / ${label}`).not.toBe("done");
      }
    }
  });
});
