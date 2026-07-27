/**
 * The stage action bar seam. These tests pin the two rules that matter when
 * someone edits the OVERRIDES table: a rep's page never loses Propose Stuck,
 * and a Final Decisions click-in never shows it.
 */
import { describe, it, expect } from "vitest";
import { actionsFor, isDecisionOrigin, type StageKey } from "./stageActions";
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
];

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
      expect(actionsFor(stage, "manager-processor")).toEqual(["proposeStuck"]);
    }
  });

  it("swaps Propose Stuck for the decision pair on Final Decisions", () => {
    for (const stage of STAGES) {
      const actions = actionsFor(stage, "final-decisions");
      // The patient is already proposed stuck — proposing again is a no-op.
      expect(actions).not.toContain("proposeStuck");
      expect(actions).toEqual(["escalateStuck", "returnToQueue"]);
    }
  });

  it("never returns an empty bar", () => {
    for (const stage of STAGES) {
      for (const origin of [null, "overview", "manager-processor", "final-decisions"] as const) {
        expect(actionsFor(stage, origin).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("isDecisionOrigin", () => {
  it("is true only for Final Decisions", () => {
    expect(isDecisionOrigin("final-decisions")).toBe(true);
    expect(isDecisionOrigin("manager-processor")).toBe(false);
    expect(isDecisionOrigin("overview")).toBe(false);
    expect(isDecisionOrigin(null)).toBe(false);
  });
});
