/**
 * Pins the two-write contract of the Already In System queue's "Move to
 * Profile Send Off" exit (mondayWrite.moveToProfileSendOff):
 *
 *   1. Already In System → "No" (index write — an examined answer, not blank)
 *   2. move the item to 1. Intake
 *
 * IN THAT ORDER. Flag-first is what makes a half-failure safe: an un-moved
 * item stays in the Already In System queue by GROUP, and a moved-but-
 * still-"Yes" item would stay by FLAG — either way the patient remains
 * visible and the rep can retry (§5.10's "group OR status" role rule).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Patient } from "./workflow";

const calls = vi.hoisted(() => [] as string[]);

vi.mock("./mondayApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mondayApi")>();
  return {
    ...actual,
    writeStatusIndex: vi.fn(async (_itemId: string, columnId: string, index: number) => {
      calls.push(`status:${columnId}:${index}`);
    }),
    moveItemToGroup: vi.fn(async (_itemId: string, groupId: string) => {
      calls.push(`move:${groupId}`);
    }),
  };
});

import { moveToProfileSendOff } from "./mondayWrite";
import { COL, GROUPS, writeStatusIndex } from "./mondayApi";
import { ALREADY_IN_SYSTEM_INDEX } from "./mondayMapping";

const patient = { id: "42" } as Patient;

describe("moveToProfileSendOff (Already In System → back into the pipeline)", () => {
  beforeEach(() => {
    calls.length = 0;
    vi.mocked(writeStatusIndex).mockClear();
  });

  it("writes Already In System → 'No' FIRST, then moves the item to 1. Intake", async () => {
    await moveToProfileSendOff(patient);
    expect(calls).toEqual([
      `status:${COL.alreadyInSystem}:${ALREADY_IN_SYSTEM_INDEX["No"]}`,
      `move:${GROUPS.intake}`,
    ]);
  });

  it("targets the intake group Verified Referrals reads — not Patient Intake, not the form groups", () => {
    expect(GROUPS.intake).toBe("group_mm1xf2jb");
    // "No" must be a real board label index (Yes=0 / No=1 — the 2026-08-18
    // automation 7922049614 keys on index 0, which this write must never hit).
    expect(ALREADY_IN_SYSTEM_INDEX["No"]).toBe(1);
  });

  it("does NOT move when the flag write fails — the patient stays put, retryable", async () => {
    vi.mocked(writeStatusIndex).mockRejectedValueOnce(new Error("boom"));
    await expect(moveToProfileSendOff(patient)).rejects.toThrow("boom");
    expect(calls).toEqual([]);
  });
});
