/**
 * The stage action bar seam. These tests pin the two rules that matter when
 * someone edits the OVERRIDES table: a rep's page never loses Propose Stuck,
 * and a Final Decisions click-in never shows it.
 */
import { describe, it, expect } from "vitest";
import { actionsFor, isDecisionOrigin, proposeStuckLevel, type StageKey } from "./stageActions";
import { managerOriginFromParams, MANAGER_ORIGIN_PARAM } from "./managerOrigin";

const STAGES: StageKey[] = [
  "evaluate",
  "send-request",
  "confirm-receipt",
  "chase-fax",
  "chase-parachute",
  "benefits",
  "submit-auth",
  "auth-outstanding",
  "dvs",
];

const MANAGER = "Manager Escalation Required";
const FINAL = "Final Escalation Required";

describe("managerOriginFromParams", () => {
  it("reads a valid origin", () => {
    const p = new URLSearchParams(`${MANAGER_ORIGIN_PARAM}=final-decisions`);
    expect(managerOriginFromParams(p)).toBe("final-decisions");
  });

  it("treats a missing or unknown origin as an ordinary page", () => {
    // An old bookmarked oversight link (pre-param) must not hide a rep's
    // buttons — null has to mean "ordinary", never "manager".
    expect(managerOriginFromParams(new URLSearchParams(""))).toBeNull();
    expect(managerOriginFromParams(new URLSearchParams(`${MANAGER_ORIGIN_PARAM}=bogus`))).toBeNull();
  });
});

describe("actionsFor", () => {
  it("gives a rep Propose Stuck on every stage", () => {
    for (const stage of STAGES) {
      expect(actionsFor(stage, null)).toEqual(["proposeStuck"]);
    }
  });

  it("keeps Propose Stuck for the two non-decision manager columns", () => {
    for (const stage of STAGES) {
      expect(actionsFor(stage, "overview")).toEqual(["proposeStuck"]);
      expect(actionsFor(stage, "manager-intervention")).toContain("proposeStuck");
    }
  });

  // Josh, 2026-08-02: an escalated patient is invisible to the rep — off her
  // sidebar and out of her burndown count — so clearing the escalation is the
  // only way back, and it existed only in Final Decisions.
  it("gives Manager Intervention its own send-back-to-pipeline", () => {
    for (const stage of STAGES) {
      expect(actionsFor(stage, "manager-intervention")).toContain("returnToQueue");
    }
  });

  it("only DVS × Final Decisions can hand a patient back DOWN to a manager", () => {
    expect(actionsFor("dvs", "final-decisions")).toContain("returnToManager");
    for (const stage of STAGES.filter((s) => s !== "dvs")) {
      expect(actionsFor(stage, "final-decisions")).not.toContain("returnToManager");
    }
    // …and never to a rep or to Manager Intervention, on any stage.
    for (const stage of STAGES) {
      expect(actionsFor(stage, null)).not.toContain("returnToManager");
      expect(actionsFor(stage, "manager-intervention")).not.toContain("returnToManager");
    }
  });
});

/**
 * The escalation ladder: processor → Manager Intervention → Final Decisions.
 * Before 2026-08-02 this keyed off the STAGE alone, which made Janelle's own
 * Propose Stuck a no-op at Submit Auth — it rewrote the Manager label the
 * patient already had, so nothing could reach Katie from the page.
 */
describe("proposeStuckLevel", () => {
  it("starts a Submit Auth or DVS patient at Manager Intervention", () => {
    expect(proposeStuckLevel("submit-auth", null, "")).toBe("manager");
    expect(proposeStuckLevel("dvs", null, undefined)).toBe("manager");
  });

  it("sends Benefits and Auth Outstanding straight to Final", () => {
    // Neither has a manager-review step of its own.
    expect(proposeStuckLevel("benefits", null, "")).toBe("final");
    expect(proposeStuckLevel("auth-outstanding", null, "")).toBe("final");
  });

  it("promotes to Final when the patient is ALREADY flagged for a manager", () => {
    for (const stage of STAGES) {
      expect(proposeStuckLevel(stage, null, MANAGER)).toBe("final");
    }
  });

  it("promotes to Final when the proposal comes FROM Manager Intervention", () => {
    // Janelle asking is the second rung by definition, even on a patient whose
    // escalation label hasn't been written yet.
    expect(proposeStuckLevel("submit-auth", "manager-intervention", "")).toBe("final");
    expect(proposeStuckLevel("dvs", "manager-intervention", "")).toBe("final");
  });

  it("does not treat an already-Final patient as a fresh Submit Auth proposal", () => {
    // Final is the top rung — re-proposing keeps it there rather than dropping
    // back to Manager because the stage happens to be Submit Auth.
    expect(proposeStuckLevel("submit-auth", "final-decisions", FINAL)).toBe("final");
  });

  it("ignores whitespace around the label", () => {
    expect(proposeStuckLevel("submit-auth", null, `  ${MANAGER}  `)).toBe("final");
  });
});

describe("actionsFor (decision origin)", () => {
  it("swaps Propose Stuck for the decision pair on Final Decisions", () => {
    for (const stage of STAGES) {
      const actions = actionsFor(stage, "final-decisions");
      // The patient is already proposed stuck — proposing again is a no-op.
      expect(actions).not.toContain("proposeStuck");
      // Both decisions are always reachable; DVS adds a third (hand back DOWN
      // to Manager Intervention) rather than replacing either.
      expect(actions).toContain("approveStuck");
      expect(actions).toContain("returnToQueue");
    }
    for (const stage of STAGES.filter((s) => s !== "dvs")) {
      expect(actionsFor(stage, "final-decisions")).toEqual(["approveStuck", "returnToQueue"]);
    }
  });

  it("never returns an empty bar", () => {
    for (const stage of STAGES) {
      for (const origin of [null, "overview", "manager-intervention", "final-decisions"] as const) {
        expect(actionsFor(stage, origin).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("isDecisionOrigin", () => {
  it("is true only for Final Decisions", () => {
    expect(isDecisionOrigin("final-decisions")).toBe(true);
    expect(isDecisionOrigin("manager-intervention")).toBe(false);
    expect(isDecisionOrigin("overview")).toBe(false);
    expect(isDecisionOrigin(null)).toBe(false);
  });
});
