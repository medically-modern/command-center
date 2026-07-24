// Core safety guarantees of the write engine + H2 (snapshot-abort).
// executeWritesWithVerification takes readColumns / executeWithRetry as injected
// deps, so we can drive every branch with mocks and no live Monday. The invariant
// under test: the stage advancer is written LAST and ONLY after the data columns
// are confirmed — otherwise the function returns failures or throws, and never
// advances. The gateway fast path is inert here (no boardId, gateway unconfigured).
// Run: npx vitest run src/lib/shared/verifiedWrite.test.ts
import { describe, it, expect, vi } from "vitest";
import { executeWritesWithVerification, type WriteTask } from "./verifiedWrite";

const noopFn = async () => null;
const dataTask = (columnId: string, expectedText?: string): WriteTask => ({
  label: columnId,
  columnId,
  fn: noopFn,
  ...(expectedText !== undefined ? { expectedText } : {}),
});
const stageTask = (): WriteTask => ({ label: "stage", columnId: "stage", fn: noopFn });

/** Did the engine write the stage advancer (i.e. actually advance)? */
const advanced = (exec: ReturnType<typeof vi.fn>) =>
  exec.mock.calls.some((c) => (c[0] as WriteTask).columnId === "stage");

const base = (over: Partial<Parameters<typeof executeWritesWithVerification>[0]>) => ({
  itemId: "1",
  stageColumnId: "stage",
  maxVerifyAttempts: 2,
  verifyIntervalMs: 1,
  ...over,
});

describe("executeWritesWithVerification", () => {
  it("happy path: verifies changed data, THEN advances the stage", async () => {
    const executeWithRetry = vi.fn().mockResolvedValue(null);
    const readColumns = vi
      .fn()
      .mockResolvedValueOnce([{ id: "c1", text: "old" }]) // Phase 0 snapshot
      .mockResolvedValue([{ id: "c1", text: "new" }]); // Phase 2 read-back (changed → verified)

    const result = await executeWritesWithVerification(
      base({ tasks: [dataTask("c1"), stageTask()], executeWithRetry, readColumns }),
    );

    expect(result).toEqual([]); // success
    expect(advanced(executeWithRetry)).toBe(true);
  });

  it("data write fails → returns failures and does NOT advance", async () => {
    const executeWithRetry = vi.fn((t: WriteTask) =>
      Promise.resolve(t.columnId === "c1" ? "c1 write failed" : null),
    );
    const readColumns = vi.fn().mockResolvedValue([{ id: "c1", text: "old" }]);

    const result = await executeWritesWithVerification(
      base({ tasks: [dataTask("c1"), stageTask()], executeWithRetry, readColumns }),
    );

    expect(result.length).toBeGreaterThan(0); // non-empty = failure signal
    expect(advanced(executeWithRetry)).toBe(false); // stage never flipped
  });

  it("verify times out (value never lands) → throws and does NOT advance", async () => {
    const executeWithRetry = vi.fn().mockResolvedValue(null);
    const readColumns = vi
      .fn()
      .mockResolvedValueOnce([{ id: "c1", text: "old" }]) // snapshot
      .mockResolvedValue([{ id: "c1", text: "other" }]); // never equals expected "want"

    await expect(
      executeWritesWithVerification(
        base({ tasks: [dataTask("c1", "want"), stageTask()], executeWithRetry, readColumns }),
      ),
    ).rejects.toThrow();
    expect(advanced(executeWithRetry)).toBe(false);
  });

  it("H2: snapshot read fails for a snapshot-diff column → aborts BEFORE writing (no advance, no writes)", async () => {
    const executeWithRetry = vi.fn().mockResolvedValue(null);
    const readColumns = vi.fn().mockRejectedValue(new Error("network down")); // all 3 snapshot tries fail

    await expect(
      executeWritesWithVerification(
        base({ tasks: [dataTask("c1"), stageTask()], executeWithRetry, readColumns }),
      ),
    ).rejects.toThrow(/pre-write snapshot/i);

    // Aborted before Phase 1 — nothing written at all (data OR stage).
    expect(executeWithRetry).not.toHaveBeenCalled();
    expect(readColumns).toHaveBeenCalledTimes(3); // retried the snapshot
  });

  it("H2: snapshot fails but every column has expectedText → proceeds (no over-abort) and advances once verified", async () => {
    const executeWithRetry = vi.fn().mockResolvedValue(null);
    let n = 0;
    const readColumns = vi.fn().mockImplementation(() => {
      n += 1;
      if (n <= 3) return Promise.reject(new Error("snapshot fail")); // 3 snapshot attempts fail
      return Promise.resolve([{ id: "c1", text: "want" }]); // verify read matches expectedText
    });

    const result = await executeWritesWithVerification(
      base({ tasks: [dataTask("c1", "want"), stageTask()], executeWithRetry, readColumns }),
    );

    expect(result).toEqual([]);
    expect(advanced(executeWithRetry)).toBe(true);
  });
});
