/**
 * The Patient Intake sub-stage split (§5.20) — the queue rule, and the
 * keep-in-agreement checks that catch the §5.10 bug class.
 *
 * The rule itself is one comparison. What these tests are really for is the
 * list of places that hardcode the same group id because they can't import
 * this module: two plain-JS baseline generators, the role-count hook and the
 * oversight chart filters. A group id that drifts in one of them doesn't
 * error — it makes a queue read zero.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  intakeSubStageRole, isProfileCleanUp,
  PROFILE_CLEANUP_GROUP, INFO_COLLECTION_GROUPS,
} from "./intakeSubStage";
import { GROUPS } from "./mondayApi";
import { INTAKE_SUB_STAGE_INDEX } from "./mondayMapping";
import { PROFILE_CLEANUP_GROUP as OVERSIGHT_CLEANUP_GROUP } from "../oversight/oversightApi";
import { GROUPS as SCHEDULED_CALL_GROUPS } from "../scheduledCalls/mondayApi";
import { DTC_FORM_GROUP_PARTIAL, DTC_FORM_GROUP_COMPLETED, dtcLeadRoute } from "./dtcFormFlag";
import { BOARDS } from "../systemMgmt/mondayApi";

describe("intakeSubStageRole", () => {
  it("routes the Profile Clean-Up group to the clean-up role", () => {
    expect(intakeSubStageRole(PROFILE_CLEANUP_GROUP)).toBe("cleanup");
    expect(isProfileCleanUp(PROFILE_CLEANUP_GROUP)).toBe(true);
  });

  it("routes both DTC form groups to Info Collection", () => {
    for (const gid of INFO_COLLECTION_GROUPS) {
      expect(intakeSubStageRole(gid)).toBe("infoCollection");
      expect(isProfileCleanUp(gid)).toBe(false);
    }
  });

  it("treats an unknown, blank or missing group as Info Collection", () => {
    // The default matters: it is what an item arriving from anywhere else
    // falls into, and Info Collection is the half that can still act on them.
    for (const gid of ["", null, undefined, "group_whatever", GROUPS.intake]) {
      expect(intakeSubStageRole(gid)).toBe("infoCollection");
    }
  });

  it("keys on the GROUP alone — never on the sub-stage column", () => {
    // The whole safety argument (see the module header): the column is written
    // first and the move second, so a patient whose move failed carries
    // "Profile Clean-Up" on the board while still sitting in a form group.
    // They must stay in the queue whose Advance button can retry.
    const source = readFileSync("src/lib/profile/intakeSubStage.ts", "utf8");
    const body = source.slice(source.indexOf("export function intakeSubStageRole"));
    expect(body).not.toContain("intakeSubStage:");
    expect(body).not.toContain(INTAKE_SUB_STAGE_INDEX["Profile Clean-Up"].toString());
  });
});

describe("keep-in-agreement", () => {
  it("matches GROUPS.profileCleanUp and the two form groups", () => {
    expect(PROFILE_CLEANUP_GROUP).toBe(GROUPS.profileCleanUp);
    expect([...INFO_COLLECTION_GROUPS].sort())
      .toEqual([GROUPS.newFormPartial, GROUPS.newFormCompleted].sort());
  });

  it("matches the oversight chart filters' copy", () => {
    expect(OVERSIGHT_CLEANUP_GROUP).toBe(PROFILE_CLEANUP_GROUP);
  });

  it("is one of the groups Scheduled Calls reads", () => {
    // An advance moves the item; a booked Calendly call must not move out of
    // the queue with it (§5.15 — the appointment exists, and nothing else
    // would ever surface it).
    expect(Object.values(SCHEDULED_CALL_GROUPS)).toContain(PROFILE_CLEANUP_GROUP);
  });

  it("is one of the groups the DTC-twin flag polls", () => {
    // A twin that has been advanced is still a twin. dtcFormFlag's own two
    // constants stay form-only (they answer "is this row a form lead"); the
    // FETCH is what has to widen, so this asserts the fetch, not them.
    const api = readFileSync("src/lib/profile/mondayApi.ts", "utf8");
    const leads = api.slice(api.indexOf("export async function fetchDtcFormLeads"));
    expect(leads.slice(0, 800)).toContain("GROUPS.profileCleanUp");
    expect([DTC_FORM_GROUP_PARTIAL, DTC_FORM_GROUP_COMPLETED])
      .not.toContain(PROFILE_CLEANUP_GROUP);
  });

  const readsGroup = (path: string) => readFileSync(path, "utf8").includes(PROFILE_CLEANUP_GROUP);

  it("is counted by useRoleCounts and BOTH baseline generators (§5.8)", () => {
    // The counting contract: a group missing from any of the three shows up as
    // phantom +in/-out chips in Operations all day, or as a role bar stuck at
    // zero while the sidebar lists patients.
    expect(readsGroup("src/hooks/useRoleCounts.ts"), "useRoleCounts.ts").toBe(true);
    expect(readsGroup("scripts/snapshot-baseline.mjs"), "snapshot-baseline.mjs").toBe(true);
    expect(readsGroup("services/baseline-cron/index.mjs"), "baseline-cron/index.mjs").toBe(true);
  });

  it("is a clickable Search row, routed to the Clean-Up page", () => {
    // `groupRoutes` is navigation metadata: a group missing from it is still
    // SEARCHED, it just isn't clickable (`rowRouting` returns route ""), which
    // dead-ends the click with no error.
    const b = BOARDS.find((x) => x.boardId === 18406352652);
    const g = b?.groupRoutes.find((x) => x.id === PROFILE_CLEANUP_GROUP);
    expect(g, "Profile Clean-Up missing from BOARDS groupRoutes").toBeTruthy();
    expect(g?.roleRoute).toBe("/profile-cleanup");
    expect(g?.isCompleted).toBeFalsy();
  });

  it("routes a DTC twin that has already advanced to the Clean-Up page", () => {
    // The lead poll reads this group, so `dtcLeadRoute` has to handle it. Left
    // to fall through, it returned `/profile` — a page the patient is not in
    // the queue of, offering the wrong exits (§5.10's deep-link trap).
    const lead = {
      id: "9", name: "A", groupId: PROFILE_CLEANUP_GROUP,
      dob: "", email: "", phone: "", alreadyInSystem: "", submittedOn: "",
    };
    expect(dtcLeadRoute(lead, "verified")).toBe("/profile-cleanup?patientId=9");
    expect(dtcLeadRoute(lead, "inSystem")).toBe("/profile-cleanup?patientId=9");
  });

  it("has a role registry entry and a route", () => {
    const config = readFileSync("src/lib/config.ts", "utf8");
    expect(config).toContain('id: "intakeCleanup"');
    expect(config).toContain('route: "/profile-cleanup"');
    expect(readFileSync("src/App.tsx", "utf8")).toContain('path="/profile-cleanup"');
  });
});

describe("INTAKE_SUB_STAGE_INDEX", () => {
  it("carries the indices Monday actually assigned, not 0 and 1", () => {
    // ⚠️ CLAUDE.md §5.12. The column was created asking for 0 and 1; Monday
    // assigned its own slots and returned {"1":"Profile Clean-Up",
    // "7":"Info Collection"}. Writing index 0 would set a label that does not
    // exist — which Monday accepts silently. Read back from settings_str.
    expect(INTAKE_SUB_STAGE_INDEX["Profile Clean-Up"]).toBe(1);
    expect(INTAKE_SUB_STAGE_INDEX["Info Collection"]).toBe(7);
  });
});
