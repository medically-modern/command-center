import { describe, it, expect } from "vitest";
import { stageLeavesQueue, queueForStageIndex } from "./stageQueue";
import { STAGE_INDEX } from "./mondayMapping";

describe("stageLeavesQueue", () => {
  it("a send that wrote no stage never counts as an advance", () => {
    // Auth Outstanding's "nothing resolved yet" — the patient stays put, and
    // hiding them would take live work off the rep's own screen.
    expect(stageLeavesQueue(null, "authOutstanding")).toBe(false);
    expect(stageLeavesQueue(null, "benefits")).toBe(false);
    expect(stageLeavesQueue(null, "submitAuth")).toBe(false);
  });

  it("Benefits SoS keeps the patient in Benefits", () => {
    // A blocker or an incomplete check is still Benefits work.
    expect(stageLeavesQueue(STAGE_INDEX.benefitsSos, "benefits")).toBe(false);
  });

  it("Benefits → Authorization / Complete / DVS all leave Benefits", () => {
    expect(stageLeavesQueue(STAGE_INDEX.authorization, "benefits")).toBe(true);
    expect(stageLeavesQueue(STAGE_INDEX.complete, "benefits")).toBe(true);
    // Not a group move — the Insurance queues filter stage-DVS out wherever it
    // sits (§5.8), so the patient leaves regardless.
    expect(stageLeavesQueue(STAGE_INDEX.dvs, "benefits")).toBe(true);
  });

  it("Submit Auth advances to Auth Outstanding, and stays put on its own value", () => {
    expect(stageLeavesQueue(STAGE_INDEX.authOutstanding, "submitAuth")).toBe(true);
    expect(stageLeavesQueue(STAGE_INDEX.authorization, "submitAuth")).toBe(false);
  });

  it("Auth Outstanding leaves on every terminal value it can write", () => {
    expect(stageLeavesQueue(STAGE_INDEX.complete, "authOutstanding")).toBe(true);
    expect(stageLeavesQueue(STAGE_INDEX.authDenied, "authOutstanding")).toBe(true);
    expect(stageLeavesQueue(STAGE_INDEX.dvs, "authOutstanding")).toBe(true);
    expect(stageLeavesQueue(STAGE_INDEX.authOutstanding, "authOutstanding")).toBe(false);
  });

  it("every worked queue is reachable from its own stage index", () => {
    // Guards the mapping against a renumbered STAGE_INDEX: if a value stopped
    // resolving to its queue, that queue's sends would start hiding patients
    // who never left it.
    expect(queueForStageIndex(STAGE_INDEX.benefitsSos)).toBe("benefits");
    expect(queueForStageIndex(STAGE_INDEX.authorization)).toBe("submitAuth");
    expect(queueForStageIndex(STAGE_INDEX.authOutstanding)).toBe("authOutstanding");
  });

  it("stuck belongs to no worked queue", () => {
    expect(queueForStageIndex(STAGE_INDEX.stuck)).toBeNull();
    expect(stageLeavesQueue(STAGE_INDEX.stuck, "benefits")).toBe(true);
  });
});
