/**
 * Pins the tick writer's ORDER (§5.20b), because each step is load-bearing:
 *
 *   1. re-read the ticks — a failed read aborts before anything is written
 *   2. stamp the intake notes — a failed note means no tick
 *   3. write the ticks — built from the RE-READ value, so another rep's tick
 *      made since the last poll survives
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const board = vi.hoisted(() => ({ acks: "", readFails: false, noteFails: false, notes: [] as string[] }));

vi.mock("./mondayApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mondayApi")>();
  return {
    ...actual,
    readColumnTexts: vi.fn(async (_itemId: string, ids: string[]) => {
      calls.push("read");
      if (board.readFails) throw new Error("Monday 503");
      return ids.map((id) => ({ id, text: board.acks }));
    }),
    writeText: vi.fn(async (_itemId: string, columnId: string, text: string) => {
      calls.push(`write:${columnId}:${text}`);
    }),
  };
});
vi.mock("./unverifiedWrite", () => ({
  appendIntakeNote: vi.fn(async (_itemId: string, note: string, _existing: string | undefined, stage: string) => {
    calls.push(`note:${stage}`);
    board.notes.push(note);
    return board.noteFails
      ? { ok: false, errors: [{ label: "Note", columnId: "text_mm389fs", error: "rejected" }] }
      : { ok: true, errors: [] };
  }),
}));

import { setIntakeWarningAck } from "./intakeWarningAck";
import { COL } from "./mondayApi";

const PUMP = { key: "MEDICARE_PUMP_MEDICAID_ID", label: "Has NY Medicaid ID", type: "confirm" as const };
const MGMT = { key: "UHC_AETNA_PUMP_MGMT", label: "Management approved", type: "confirm" as const };

describe("setIntakeWarningAck", () => {
  beforeEach(() => {
    calls.length = 0;
    board.acks = "";
    board.readFails = false;
    board.noteFails = false;
    board.notes = [];
  });

  it("reads, stamps the note, then writes the ticks — in that order", async () => {
    const next = await setIntakeWarningAck("42", PUMP, true, { stage: "Patient Intake" });
    expect(next).toBe("MEDICARE_PUMP_MEDICAID_ID");
    expect(calls).toEqual([
      "read",
      "note:Patient Intake",
      `write:${COL.intakeWarningAcks}:MEDICARE_PUMP_MEDICAID_ID`,
    ]);
    expect(board.notes[0]).toBe("Intake warning confirmed: Has NY Medicaid ID (MEDICARE_PUMP_MEDICAID_ID)");
  });

  it("builds on the RE-READ ticks, so another rep's tick survives", async () => {
    board.acks = "SELF_REF_UHC";
    const next = await setIntakeWarningAck("42", PUMP, true, { stage: "Patient Intake" });
    expect(next).toBe("SELF_REF_UHC,MEDICARE_PUMP_MEDICAID_ID");
  });

  it("unticking removes only that KEY", async () => {
    board.acks = "SELF_REF_UHC,MEDICARE_PUMP_MEDICAID_ID";
    expect(await setIntakeWarningAck("42", PUMP, false, { stage: "Referral Intake" })).toBe("SELF_REF_UHC");
    expect(calls[1]).toBe("note:Referral Intake");
    expect(board.notes[0]).toMatch(/^Intake warning un-ticked:/);
  });

  it("a failed re-read writes NOTHING — no note, no tick", async () => {
    board.readFails = true;
    await expect(setIntakeWarningAck("42", PUMP, true, { stage: "Patient Intake" })).rejects.toThrow(/503/);
    expect(calls).toEqual(["read"]);
  });

  it("a failed note means no tick", async () => {
    board.noteFails = true;
    await expect(setIntakeWarningAck("42", PUMP, true, { stage: "Patient Intake" })).rejects.toThrow(/rejected/);
    expect(calls.some((c) => c.startsWith("write:"))).toBe(false);
  });

  it("an override needs a reason BEFORE anything is read or written", async () => {
    await expect(setIntakeWarningAck("42", MGMT, true, { stage: "Patient Intake", reason: "  " }))
      .rejects.toThrow(/reason/);
    expect(calls).toEqual([]);
  });

  it("an override's reason goes into the note", async () => {
    await setIntakeWarningAck("42", MGMT, true, { stage: "Patient Intake", reason: "Corey approved on the call" });
    expect(board.notes[0]).toBe(
      "Intake warning overridden: Management approved (UHC_AETNA_PUMP_MGMT) — Corey approved on the call",
    );
  });

  it("unticking an override needs no reason", async () => {
    board.acks = "UHC_AETNA_PUMP_MGMT";
    expect(await setIntakeWarningAck("42", MGMT, false, { stage: "Patient Intake" })).toBe("");
  });
});
