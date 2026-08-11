// Regression cover for the 2026-08-11 "ghost label" incident.
//
// A rep added a new ICD-10 code on the Evaluate panel. Monday stamped the item
// with a label INDEX but never wrote the label text into the column settings,
// so the column read back "" forever, exact-match verification failed all 8
// attempts, and the stage advancer was never written. The engine reported
// "Monday may be unusually slow — retry the send", so the rep retried five
// times on a state that could never resolve.
//
// These tests pin the two halves of the fix: the diagnosis is correct, and it
// is CONSERVATIVE — a wrong "add this label to the board" is worse than a
// vague timeout, so anything we can't be sure about must stay quiet.
// Run: npx vitest run src/lib/shared/missingBoardLabel.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  findMissingBoardLabels,
  MissingBoardLabelError,
  executeWritesWithVerification,
  type WriteTask,
} from "./verifiedWrite";

const task = (columnId: string, expectedText?: string, label = columnId) => ({
  label,
  columnId,
  ...(expectedText !== undefined ? { expectedText } : {}),
});

describe("findMissingBoardLabels", () => {
  it("flags a label the column does not have — the incident case", () => {
    const out = findMissingBoardLabels(
      [task("color_diag", "E10.35", "Diagnosis")],
      new Map([["color_diag", ["E10.65", "E11.9"]]]),
    );
    expect(out).toEqual([{ label: "Diagnosis", columnId: "color_diag", missingLabel: "E10.35" }]);
  });

  it("stays quiet when the label IS on the column (ordinary slow indexing)", () => {
    const out = findMissingBoardLabels(
      [task("color_diag", "E10.65")],
      new Map([["color_diag", ["E10.65", "E11.9"]]]),
    );
    expect(out).toEqual([]);
  });

  it("ignores snapshot-diff tasks — they carry no expected label at all", () => {
    const out = findMissingBoardLabels([task("c1")], new Map([["c1", ["Yes", "No"]]]));
    expect(out).toEqual([]);
  });

  it("ignores a CLEAR (expectedText \"\") — an empty column is not a missing label", () => {
    const out = findMissingBoardLabels([task("c1", "")], new Map([["c1", ["Yes", "No"]]]));
    expect(out).toEqual([]);
  });

  it("stays quiet when the column could not be read", () => {
    const out = findMissingBoardLabels([task("c1", "Nope")], new Map());
    expect(out).toEqual([]);
  });

  it("stays quiet on an unparseable/empty label set rather than accusing the board", () => {
    // e.g. a dropdown's settings shape, which this parser yields nothing for.
    const out = findMissingBoardLabels([task("c1", "Nope")], new Map([["c1", []]]));
    expect(out).toEqual([]);
  });
});

describe("executeWritesWithVerification — ghost label", () => {
  const base = {
    itemId: "1",
    stageColumnId: "stage",
    maxVerifyAttempts: 2,
    verifyIntervalMs: 1,
  };
  const stageTask = (): WriteTask => ({ label: "stage", columnId: "stage", fn: async () => null });
  const diagnosis = (): WriteTask => ({
    label: "Diagnosis",
    columnId: "color_diag",
    expectedText: "E10.35",
    fn: async () => null,
  });
  const advanced = (exec: ReturnType<typeof vi.fn>) =>
    exec.mock.calls.some((c) => (c[0] as WriteTask).columnId === "stage");

  it("throws the NAMED error and never advances when Monday didn't create the label", async () => {
    const executeWithRetry = vi.fn().mockResolvedValue(null);
    // Reads back "" forever — the ghost index has no text.
    const readColumns = vi.fn().mockResolvedValue([{ id: "color_diag", text: "" }]);
    const readColumnLabels = vi.fn().mockResolvedValue(["E10.65", "E11.9"]);

    const err = await executeWritesWithVerification({
      ...base,
      tasks: [diagnosis(), stageTask()],
      executeWithRetry,
      readColumns,
      readColumnLabels,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(MissingBoardLabelError);
    expect(err.message).toContain("E10.35");
    // The whole point: it must NOT tell the rep to retry.
    expect(err.message).toContain("Retrying will not help");
    expect(advanced(executeWithRetry)).toBe(false);
  });

  it("falls back to the generic timeout when the label exists (really just slow)", async () => {
    const executeWithRetry = vi.fn().mockResolvedValue(null);
    const readColumns = vi.fn().mockResolvedValue([{ id: "color_diag", text: "" }]);
    const readColumnLabels = vi.fn().mockResolvedValue(["E10.35", "E11.9"]);

    const err = await executeWritesWithVerification({
      ...base,
      tasks: [diagnosis(), stageTask()],
      executeWithRetry,
      readColumns,
      readColumnLabels,
    }).catch((e) => e);

    expect(err).not.toBeInstanceOf(MissingBoardLabelError);
    expect(err.message).toContain("retry the send");
    expect(advanced(executeWithRetry)).toBe(false);
  });

  it("a failing label lookup never masks the original failure", async () => {
    const executeWithRetry = vi.fn().mockResolvedValue(null);
    const readColumns = vi.fn().mockResolvedValue([{ id: "color_diag", text: "" }]);
    const readColumnLabels = vi.fn().mockRejectedValue(new Error("board read blew up"));

    const err = await executeWritesWithVerification({
      ...base,
      tasks: [diagnosis(), stageTask()],
      executeWithRetry,
      readColumns,
      readColumnLabels,
    }).catch((e) => e);

    expect(err.message).toContain("retry the send");
    expect(advanced(executeWithRetry)).toBe(false);
  });
});
