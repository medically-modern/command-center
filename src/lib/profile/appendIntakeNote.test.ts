/**
 * `appendIntakeNote` re-reads the notes when the caller passes none. A failed
 * re-read used to fall back to "" and then WRITE — and `change_column_value`
 * replaces the column, so one Monday blip overwrote a patient's whole call
 * log with a single line. It aborts now (fixed 2026-09-24, §5.20b).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ readFails: false, written: [] as string[] }));

vi.mock("./mondayApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mondayApi")>();
  return {
    ...actual,
    readColumnTexts: vi.fn(async (_itemId: string, ids: string[]) => {
      if (state.readFails) throw new Error("Monday 503");
      return ids.map((id) => ({ id, text: "[9/1/26, 9:00 AM] Patient Intake: earlier line —JH" }));
    }),
    writeText: vi.fn(async (_itemId: string, _columnId: string, text: string) => {
      state.written.push(text);
    }),
  };
});

import { appendIntakeNote } from "./unverifiedWrite";

describe("appendIntakeNote", () => {
  beforeEach(() => {
    state.readFails = false;
    state.written = [];
  });

  it("a failed re-read writes nothing and says why", async () => {
    state.readFails = true;
    const res = await appendIntakeNote("42", "new line");
    expect(res.ok).toBe(false);
    expect(res.errors[0].error).toMatch(/nothing was written/);
    expect(state.written).toEqual([]);
  });

  it("a good re-read appends onto the history, under the caller's stage label", async () => {
    const res = await appendIntakeNote("42", "new line", undefined, "Referral Intake");
    expect(res.ok).toBe(true);
    expect(state.written).toHaveLength(1);
    expect(state.written[0]).toContain("earlier line");
    expect(state.written[0]).toMatch(/Referral Intake: new line/);
  });

  it("defaults to the Patient Intake label", async () => {
    await appendIntakeNote("42", "new line", "");
    expect(state.written[0]).toMatch(/Patient Intake: new line/);
  });
});
