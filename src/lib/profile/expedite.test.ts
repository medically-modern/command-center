/**
 * Writing the Expedited mark (§5.56).
 *
 * Run: npx vitest run src/lib/profile/expedite.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const api = vi.hoisted(() => ({
  writeStatusIndex: vi.fn(async () => {}),
  clearStatusColumn: vi.fn(async () => {}),
  readColumnTexts: vi.fn(async () => [] as { id: string; text: string | null }[]),
}));
vi.mock("./mondayApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mondayApi")>()),
  ...api,
}));

import { COL } from "./mondayApi";
import { expeditedAdvanceTask, writeExpedited } from "./expedite";
import { buildAdvanceTasks } from "./unverifiedWrite";
import { EXPEDITED_COL, EXPEDITED_INDEX } from "../shared/expedited";
import type { Patient } from "./workflow";

const patient = (over: Partial<Patient> = {}) => ({ id: "42", name: "Pat", ...over }) as Patient;
const fast = { tries: 3, delayMs: 0 };

beforeEach(() => {
  api.writeStatusIndex.mockClear();
  api.clearStatusColumn.mockClear();
  api.readColumnTexts.mockReset();
});

describe("the column", () => {
  it("is Profile Send Off's Expedited column, written by the id read back from the board", () => {
    expect(COL.expedited).toBe(EXPEDITED_COL.profileSendOff);
    expect(COL.expedited).toBe("color_mm7pywyh");
    expect(EXPEDITED_INDEX).toBe(2);
  });
});

describe("writeExpedited — the manager's tick", () => {
  it("ticking writes the label by INDEX, then confirms it reads back", async () => {
    api.readColumnTexts.mockResolvedValue([{ id: COL.expedited, text: "Expedited" }]);
    await expect(writeExpedited("42", true, fast)).resolves.toBe(true);
    expect(api.writeStatusIndex).toHaveBeenCalledWith("42", COL.expedited, 2);
    expect(api.clearStatusColumn).not.toHaveBeenCalled();
  });

  it("unticking CLEARS the column (blank = normal) and confirms it is blank", async () => {
    api.readColumnTexts.mockResolvedValue([{ id: COL.expedited, text: null }]);
    await expect(writeExpedited("42", false, fast)).resolves.toBe(true);
    expect(api.clearStatusColumn).toHaveBeenCalledWith("42", COL.expedited);
    expect(api.writeStatusIndex).not.toHaveBeenCalled();
  });

  it("keeps reading until Monday catches up", async () => {
    api.readColumnTexts
      .mockResolvedValueOnce([{ id: COL.expedited, text: "" }])
      .mockRejectedValueOnce(new Error("429"))
      .mockResolvedValueOnce([{ id: COL.expedited, text: "Expedited" }]);
    await expect(writeExpedited("42", true, fast)).resolves.toBe(true);
    expect(api.readColumnTexts).toHaveBeenCalledTimes(3);
  });

  it("an unconfirmed write resolves false — it is NOT reported as a failure", async () => {
    api.readColumnTexts.mockResolvedValue([{ id: COL.expedited, text: "" }]);
    await expect(writeExpedited("42", true, fast)).resolves.toBe(false);
  });

  it("a failed WRITE throws, and nothing is read", async () => {
    api.writeStatusIndex.mockRejectedValueOnce(new Error("boom"));
    await expect(writeExpedited("42", true, fast)).rejects.toThrow("boom");
    expect(api.readColumnTexts).not.toHaveBeenCalled();
  });
});

describe("expeditedAdvanceTask — the mark inside the verified advance", () => {
  it("is nothing for a normal patient — the batch never writes a clear", () => {
    // A rep's screen can trail a manager's tick by a poll; a clear written from
    // that copy would silently un-expedite the patient.
    expect(expeditedAdvanceTask(patient())).toBeNull();
    expect(expeditedAdvanceTask(patient({ expedited: "" }))).toBeNull();
  });

  it("writes and VERIFIES the label for an expedited patient", async () => {
    const t = expeditedAdvanceTask(patient({ expedited: "Expedited" }));
    expect(t).toMatchObject({
      columnId: COL.expedited,
      value: { index: 2 },           // the gateway fast path sends THIS …
      expectedText: "Expedited",     // … and read-back is an exact match
    });
    await t!.fn();                   // … and the client path writes the same
    expect(api.writeStatusIndex).toHaveBeenCalledWith("42", COL.expedited, 2);
  });

  it("rides the Clean-Up → MN advance batch (buildAdvanceTasks)", () => {
    const cols = (p: Patient) => buildAdvanceTasks(p, { edits: { dob: "01/02/1990" }, verified: {} })
      .map((t) => t.columnId);
    expect(cols(patient({ expedited: "Expedited" }))).toContain(COL.expedited);
    expect(cols(patient())).not.toContain(COL.expedited);
  });

  it("rides the Referral Intake advance batch too, ahead of the advancer", () => {
    const src = readFileSync(resolve(__dirname, "./mondayWrite.ts"), "utf8");
    const send = src.slice(src.indexOf("export async function sendPatientToMonday"));
    const xp = send.indexOf("expeditedAdvanceTask(p)");
    const adv = send.indexOf('tasks.push({ label: "Move to Onboarding"');
    expect(xp).toBeGreaterThan(-1);
    expect(adv).toBeGreaterThan(xp);
  });
});
