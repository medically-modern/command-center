/**
 * Pins the contract of Info Collection's exit
 * (unverifiedWrite.advanceToProfileCleanUp):
 *
 *   1. every left-pane data column, written and READ BACK
 *   2. Intake Sub-Stage → "Profile Clean-Up"   (the advancer, held back)
 *   3. move the item to the Profile Clean-Up group
 *
 * IN THAT ORDER, and the order is the whole safety argument. The advancer must
 * not fire before the data it advertises is indexed (§5.2), and the MOVE must
 * come last because the group is what decides the queue: a patient whose move
 * failed is still in Info Collection, still in the rep's sidebar, still one
 * button press from retrying. Moving first would hand them to a queue while
 * the board still said Info Collection.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Patient } from "./workflow";

const calls = vi.hoisted(() => [] as string[]);
const moveFails = vi.hoisted(() => ({ value: false }));

vi.mock("./mondayApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mondayApi")>();
  return {
    ...actual,
    writeStatusIndex: vi.fn(async (_itemId: string, columnId: string, index: number) => {
      calls.push(`status:${columnId}:${index}`);
    }),
    writeText: vi.fn(async (_itemId: string, columnId: string) => {
      calls.push(`text:${columnId}`);
    }),
    writeItemName: vi.fn(async () => { calls.push("name"); }),
    // Returns the ARRAY shape ReadColumnsFn expects. The snapshot phase reads
    // BEFORE any write and the verify phase reads after, so the value has to
    // differ between the two or snapshot-diff verification never passes:
    // "" first, then "written" — a landed write, as far as the protocol can
    // tell. What this test is asserting is the ORDER, not the diffing.
    readColumnTexts: vi.fn(async (_itemId: string, ids: string[]) => {
      const written = calls.length > 0;
      return ids.map((id) => ({ id, text: written ? "written" : "" }));
    }),
    moveItemToGroup: vi.fn(async (_itemId: string, groupId: string) => {
      if (moveFails.value) throw new Error("group move refused");
      calls.push(`move:${groupId}`);
    }),
  };
});

// The verified-write protocol is exercised for real; only Monday is mocked.
import { advanceToProfileCleanUp } from "./unverifiedWrite";
import { COL, GROUPS } from "./mondayApi";
import { INTAKE_SUB_STAGE_INDEX } from "./mondayMapping";

const patient = { id: "42" } as Patient;
const edits = { dob: "01/02/1980", currentOopCost: "120" };

describe("advanceToProfileCleanUp", () => {
  beforeEach(() => {
    calls.length = 0;
    moveFails.value = false;
  });

  it("writes the data first, then the advancer, then the move", async () => {
    const res = await advanceToProfileCleanUp(patient, { edits });
    expect(res.ok).toBe(true);

    const advancer = `status:${COL.intakeSubStage}:${INTAKE_SUB_STAGE_INDEX["Profile Clean-Up"]}`;
    const move = `move:${GROUPS.profileCleanUp}`;
    expect(calls).toContain(advancer);
    expect(calls).toContain(move);

    // Data before advancer before move. Indexes, not equality, because
    // buildIntakeTasks' own column list is free to change.
    const advancerAt = calls.indexOf(advancer);
    const moveAt = calls.indexOf(move);
    expect(advancerAt).toBeGreaterThan(0);          // something was written first
    expect(moveAt).toBe(calls.length - 1);          // the move is last
    expect(moveAt).toBeGreaterThan(advancerAt);
  });

  it("writes the sub-stage by the index Monday actually assigned", () => {
    // Index 0 does not exist on this column (§5.12) and Monday drops a status
    // write for an unknown index without erroring.
    expect(INTAKE_SUB_STAGE_INDEX["Profile Clean-Up"]).toBe(1);
  });

  it("refuses to advance when there is no data to verify", async () => {
    // verifiedWrite skips its snapshot and read-back phases entirely when the
    // task list is empty, so the advancer would fire unverified — the one
    // shape that silently defeats the protocol.
    const res = await advanceToProfileCleanUp(patient, { edits: {} });
    expect(res.ok).toBe(false);
    expect(res.errors[0].error).toMatch(/refusing to advance/i);
    expect(calls).toEqual([]);
  });

  it("reports a failed move as NOT ok, and says the patient is still in the queue", async () => {
    moveFails.value = true;
    const res = await advanceToProfileCleanUp(patient, { edits });
    expect(res.ok).toBe(false);
    // The rep's next move is to press Advance again — the message has to say
    // so, because the board now reads "Profile Clean-Up" while the patient is
    // still sitting in their list.
    expect(res.errors[0].error).toMatch(/still in your queue/i);
    expect(res.errors[0].error).toMatch(/press Advance again/i);
  });

  it("does not touch Move to Onboarding — that is the NEXT stage's advancer", async () => {
    await advanceToProfileCleanUp(patient, { edits });
    expect(calls.some((c) => c.includes(COL.moveToOnboarding))).toBe(false);
  });
});
