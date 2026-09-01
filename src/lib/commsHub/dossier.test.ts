import { describe, it, expect } from "vitest";
import { buildDossier, nameMatchAccepted, pickActive, stagesCompleted, type DossierItem } from "./dossier";
import { PIPELINE_ORDER, pipelineIndex } from "./pipelineOrder";

const PROFILE = 18406352652, ME = 18406060017, INS = 18410601299, WC = 18410804557, SUB = 18407459988;
const CLAIMS = 18413019028;

function item(boardId: number, over: Partial<DossierItem> = {}): DossierItem {
  return {
    itemId: `${boardId}-1`,
    name: "Richard Devane",
    phone: "+13475550101",
    boardId,
    boardName: String(boardId),
    groupId: "g",
    groupTitle: "Working",
    isCompleted: false,
    isStuck: false,
    route: "/x",
    stageAdvancerText: "",
    notes: "",
    nextActionDate: "",
    daysSinceStage: "",
    ...over,
  };
}

describe("pipeline order", () => {
  it("runs Profile Send Off → Medical Evaluation → Insurance → Welcome Call", () => {
    // ⚠️ CLAUDE.md §6's diagram puts Welcome Call second; ROLES, the Profile
    // Send Off "Advance to MN" automation and OVERSIGHT_SECTIONS all say this.
    expect(pipelineIndex(PROFILE)).toBeLessThan(pipelineIndex(ME));
    expect(pipelineIndex(ME)).toBeLessThan(pipelineIndex(INS));
    expect(pipelineIndex(INS)).toBeLessThan(pipelineIndex(WC));
    expect(pipelineIndex(WC)).toBeLessThan(pipelineIndex(SUB));
  });

  it("does not treat Secondary Claims as a stage", () => {
    expect(pipelineIndex(CLAIMS)).toBe(-1);
  });
});

describe("pickActive", () => {
  it("takes the furthest-along open record", () => {
    const a = pickActive([item(PROFILE, { isCompleted: true }), item(ME), item(INS)]);
    expect(a?.boardId).toBe(INS);
  });

  it("skips completed and stuck records", () => {
    expect(pickActive([item(INS, { isCompleted: true }), item(ME)])?.boardId).toBe(ME);
    expect(pickActive([item(INS, { isStuck: true }), item(ME)])?.boardId).toBe(ME);
  });

  it("never picks a non-pipeline board", () => {
    // Secondary Claims runs alongside a real stage; opening it as "the live
    // stage" tells a rep nothing about the patient's progress.
    expect(pickActive([item(CLAIMS)])).toBeNull();
  });

  it("returns null when everything is finished — there is no live stage", () => {
    expect(pickActive([item(PROFILE, { isCompleted: true }), item(SUB, { isCompleted: true })])).toBeNull();
  });
});

describe("buildDossier", () => {
  it("marks each board completed / active / not reached", () => {
    const d = buildDossier([
      item(PROFILE, { isCompleted: true }),
      item(ME, { isCompleted: true }),
      item(INS, { stageAdvancerText: "Benefits / SoS" }),
    ]);
    const state = (b: number) => d.path.find((s) => s.board.boardId === b)?.state;
    expect(state(PROFILE)).toBe("completed");
    expect(state(ME)).toBe("completed");
    expect(state(INS)).toBe("active");
    expect(state(WC)).toBe("notReached");
    expect(d.active?.boardId).toBe(INS);
    expect(stagesCompleted(d.path)).toBe(2);
  });

  it("has one step per pipeline board, always, so the chain reads the same for everybody", () => {
    expect(buildDossier([]).path.map((s) => s.board.boardId)).toEqual(PIPELINE_ORDER.map((b) => b.boardId));
  });

  it("calls a stuck record parked, not active", () => {
    const d = buildDossier([item(ME, { isStuck: true, groupTitle: "Stuck" })]);
    expect(d.path.find((s) => s.board.boardId === ME)?.state).toBe("parked");
    expect(d.active).toBeNull();
  });

  it("prefers the completed record when a board was run twice", () => {
    // An Update Clinicals loop leaves a live ME item beside the completed one;
    // the badge stands for the finished stage.
    const d = buildDossier([
      item(ME, { itemId: "old", isCompleted: true }),
      item(ME, { itemId: "new" }),
      item(SUB, { itemId: "sub" }),
    ]);
    const step = d.path.find((s) => s.board.boardId === ME);
    expect(step?.state).toBe("completed");
    expect(step?.item?.itemId).toBe("old");
    expect(d.active?.itemId).toBe("sub");
  });

  it("lists Secondary Claims under 'also on' rather than in the chain", () => {
    const d = buildDossier([item(SUB), item(CLAIMS, { boardName: "Secondary Claims" })]);
    expect(d.alsoOn.map((i) => i.boardId)).toEqual([CLAIMS]);
    expect(d.path.some((s) => s.board.boardId === CLAIMS)).toBe(false);
  });

  it("falls back through the trail for a name and number", () => {
    const d = buildDossier([
      item(PROFILE, { isCompleted: true, name: "Richard Devane", phone: "+13475550101" }),
      item(ME, { name: "", phone: "" }),
    ]);
    expect(d.name).toBe("Richard Devane");
    expect(d.phone).toBe("+13475550101");
  });
});

describe("nameMatchAccepted — a name is not an identity", () => {
  const WANT = "+13475550101";

  it("accepts a record whose phone agrees", () => {
    expect(nameMatchAccepted({ phone: WANT }, WANT)).toBe(true);
  });

  it("accepts a record with NO phone — that is the completed record this pass exists to find", () => {
    expect(nameMatchAccepted({ phone: "" }, WANT)).toBe(true);
  });

  it("REJECTS a namesake carrying a different number", () => {
    // Two patients called Maria Garcia. Admitting this would render one
    // person's notes and stage on the other's conversation, and hand
    // sendMessage the wrong Monday item to attribute an outbound text to.
    expect(nameMatchAccepted({ phone: "+16095550199" }, WANT)).toBe(false);
  });
});
