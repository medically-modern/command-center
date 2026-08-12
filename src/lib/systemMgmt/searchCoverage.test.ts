import { describe, it, expect } from "vitest";
import { BOARDS, rowRouting, type BoardDef } from "./mondayApi";
import { COMPLETED_STAGE_ROUTES } from "./stageCompletion";

const board = (id: number): BoardDef => {
  const b = BOARDS.find((x) => x.boardId === id);
  if (!b) throw new Error(`board ${id} missing from BOARDS`);
  return b;
};

const INSURANCE = 18410601299;
const MASHEKE = 18406060017;
const PROFILE = 18406352652;
const WELCOME = 18410804557;

describe("search board coverage", () => {
  it("covers every board the Command Center works", () => {
    // Search is the one place with no queue rule: if the app touches a board,
    // its patients must be findable. DTC Intake and Secondary Claims were
    // missing entirely until 2026-08-12.
    const ids = BOARDS.map((b) => b.boardId).sort();
    expect(ids).toEqual(
      [
        18392794310, // DTC Intake
        18406060017, // Medical Evaluation
        18406352652, // Profile Send Off
        18407459988, // Subscription
        18410601299, // Insurance
        18410804557, // Welcome Call
        18413019028, // Secondary Claims
      ].sort(),
    );
  });

  it("gives every board a phone column, so phone search reaches all of them", () => {
    // patientLookup (inbound calls) keys off this same registry.
    for (const b of BOARDS) expect(b.phoneColId).toMatch(/^phone/);
  });

  it("marks exactly one completed group per board that has one", () => {
    for (const b of BOARDS) {
      const done = b.groupRoutes.filter((g) => g.isCompleted);
      expect(done.length, `${b.boardName} completed groups`).toBeLessThanOrEqual(1);
    }
  });

  it("routes every completed group that has a review page", () => {
    for (const b of BOARDS) {
      if (!b.groupRoutes.some((g) => g.isCompleted)) continue;
      const route = COMPLETED_STAGE_ROUTES[b.boardId];
      // Boards without a review page (DTC Intake, Claims) are allowed to have
      // none — the row still reads COMPLETED, it just doesn't open.
      if (route) expect(route).toMatch(/^\//);
    }
  });
});

describe("rowRouting", () => {
  it("sends the DVS group to the DVS page", () => {
    // The group was added to the Insurance board in Aug 2026 and nothing in
    // Search read it — the reported bug.
    const r = rowRouting(board(INSURANCE), { id: "group_mm5gp2r2", title: "DVS" }, "DVS");
    expect(r).toMatchObject({ roleRoute: "/dvs", pipelineStage: "DVS", hasPage: true });
  });

  it("sends a stage-DVS patient parked in Benefits to DVS, not Benefits", () => {
    // Stage-DVS items linger in whatever group an automation left them (§5.8),
    // and Benefits is the one queue that deliberately excludes them.
    const r = rowRouting(board(INSURANCE), { id: "group_mm1xr3q3", title: "Benefits" }, "DVS");
    expect(r.roleRoute).toBe("/dvs");
  });

  it("still routes an ordinary Benefits patient to Benefits", () => {
    const r = rowRouting(
      board(INSURANCE),
      { id: "group_mm1xr3q3", title: "Benefits" },
      "Benefits / SoS",
    );
    expect(r.roleRoute).toBe("/benefits");
  });

  it("routes an UNKNOWN group nowhere — never to the home page", () => {
    // Every group is searched now, so unknown ones are routine: a board grows a
    // group, or renames one. The old "/" default sent the rep to the app's home
    // screen, which reads as the click having worked.
    const r = rowRouting(board(INSURANCE), { id: "group_brand_new", title: "Whatever" }, "");
    expect(r).toMatchObject({ roleRoute: "", hasPage: false, pipelineStage: "Whatever" });
  });

  it("shows a searchable-but-unworkable group under its own name", () => {
    const r = rowRouting(board(MASHEKE), { id: "group_mm1xyczx", title: "Stuck" }, "");
    expect(r).toMatchObject({ pipelineStage: "Stuck", hasPage: false });
  });

  it("marks completed rows completed, with no page of their own", () => {
    const r = rowRouting(
      board(MASHEKE),
      { id: "group_mm1x5q4e", title: "Completed" },
      "Completed",
    );
    expect(r).toMatchObject({ isCompleted: true, hasPage: false });
  });

  it("never lets a live stage label describe a finished record", () => {
    // A completed item whose advancer still reads a working stage would
    // otherwise be listed as if it were in that queue.
    const r = rowRouting(
      board(INSURANCE),
      { id: "group_mm2vw3c0", title: "Completed" },
      "Benefits / SoS",
    );
    expect(r).toMatchObject({ pipelineStage: "Completed", isCompleted: true, hasPage: false });
  });

  it("routes Already In System to its own role page", () => {
    // §5.10: the role is group OR status, and the group had no search entry.
    const r = rowRouting(
      board(PROFILE),
      { id: "group_mm64b83h", title: "Already In System" },
      "",
    );
    expect(r.roleRoute).toBe("/in-system-referrals");
  });

  it("keeps Welcome Call's two working groups on their own pages", () => {
    expect(
      rowRouting(board(WELCOME), { id: "group_mm1wvq8p", title: "Welcome Call" }, "").roleRoute,
    ).toBe("/welcome-call");
    expect(
      rowRouting(board(WELCOME), { id: "group_mm2x8jtj", title: "Final Profile Confirmation" }, "")
        .roleRoute,
    ).toBe("/final-confirm");
  });
});
