// Core safety guarantees of the write engine + H2 (snapshot-abort).
// executeWritesWithVerification takes readColumns / executeWithRetry as injected
// deps, so we can drive every branch with mocks and no live Monday. The invariant
// under test: the stage advancer is written LAST and ONLY after the data columns
// are confirmed — otherwise the function returns failures or throws, and never
// advances. The gateway fast path is inert here (no boardId, gateway unconfigured).
// Run: npx vitest run src/lib/shared/verifiedWrite.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildIdempotencyKey, executeWritesWithVerification, type WriteTask } from "./verifiedWrite";

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

// Typed as the real options object rather than a spread of a Partial: spreading
// `Partial<Opts>` made every required field optional, so each call site failed
// to typecheck (tsc -b, not CI's no-op `tsc --noEmit` — see CLAUDE.md §10).
// The three injected deps are what every test must supply; the rest have
// defaults here.
type Opts = Parameters<typeof executeWritesWithVerification>[0];
const base = (
  over: Partial<Opts> & Pick<Opts, "tasks" | "executeWithRetry" | "readColumns">,
): Opts => ({
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

// ── Phase 2b: the advancer that fires no automation ───────────────────
// Monday automations trigger on a status CHANGE. Writing the value a column
// already holds fires nothing — 200, no activity-log entry, no automation — so
// the engine used to report a clean send while the patient never moved.
// Betty Dillingham (12895834887) sat in the intake queue for five days this way.
describe("stage advancer no-op detection", () => {
  const stageWithTarget = (expectedText: string): WriteTask => ({
    label: "Move to Onboarding",
    columnId: "stage",
    expectedText,
    fn: noopFn,
  });

  it("refuses to 'advance' a column already at its target, and says so", async () => {
    const executeWithRetry = vi.fn().mockResolvedValue(null);
    const readColumns = vi
      .fn()
      // Phase 0 snapshot — the advancer ALREADY reads "Advance to MN"
      .mockResolvedValueOnce([
        { id: "c1", text: "old" },
        { id: "stage", text: "Advance to MN" },
      ])
      .mockResolvedValue([{ id: "c1", text: "new" }]);

    const result = await executeWritesWithVerification(
      base({
        tasks: [dataTask("c1"), stageWithTarget("Advance to MN")],
        executeWithRetry,
        readColumns,
      }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toContain("already");
    expect(result[0]).toContain("Advance to MN");
    // The whole point: the pointless mutation is never sent.
    expect(advanced(executeWithRetry)).toBe(false);
  });

  it("still advances when the value genuinely changes", async () => {
    const executeWithRetry = vi.fn().mockResolvedValue(null);
    const readColumns = vi
      .fn()
      .mockResolvedValueOnce([
        { id: "c1", text: "old" },
        { id: "stage", text: "" }, // blank → "Advance to MN" is a real change
      ])
      .mockResolvedValue([{ id: "c1", text: "new" }]);

    const result = await executeWritesWithVerification(
      base({
        tasks: [dataTask("c1"), stageWithTarget("Advance to MN")],
        executeWithRetry,
        readColumns,
      }),
    );

    expect(result).toEqual([]);
    expect(advanced(executeWithRetry)).toBe(true);
  });

  it("data columns are still written — only the ADVANCE is refused", async () => {
    // The rep's typing is not thrown away; what did not happen is the move.
    const executeWithRetry = vi.fn().mockResolvedValue(null);
    const readColumns = vi
      .fn()
      .mockResolvedValueOnce([
        { id: "c1", text: "old" },
        { id: "stage", text: "Advance to MN" },
      ])
      .mockResolvedValue([{ id: "c1", text: "new" }]);

    await executeWritesWithVerification(
      base({
        tasks: [dataTask("c1"), stageWithTarget("Advance to MN")],
        executeWithRetry,
        readColumns,
      }),
    );

    expect(executeWithRetry.mock.calls.some((c) => (c[0] as WriteTask).columnId === "c1")).toBe(true);
  });

  it("an advancer with no declared target keeps the old behaviour exactly", async () => {
    // Opt-in by design: flows that never pass expectedText are untouched.
    const executeWithRetry = vi.fn().mockResolvedValue(null);
    const readColumns = vi
      .fn()
      .mockResolvedValueOnce([{ id: "c1", text: "old" }])
      .mockResolvedValue([{ id: "c1", text: "new" }]);

    const result = await executeWritesWithVerification(
      base({ tasks: [dataTask("c1"), stageTask()], executeWithRetry, readColumns }),
    );

    expect(result).toEqual([]);
    expect(advanced(executeWithRetry)).toBe(true);
  });

  it("an unreadable snapshot never manufactures a no-op", async () => {
    // Every data column carries expectedText, so Phase 2's exact-match path
    // covers them without a baseline and the send proceeds. The advancer's
    // current value is simply unknown — and unknown must not read as "already
    // set", or a failed read would block a legitimate advance.
    const executeWithRetry = vi.fn().mockResolvedValue(null);
    const readColumns = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue([{ id: "c1", text: "new" }]);

    const result = await executeWritesWithVerification(
      base({
        tasks: [dataTask("c1", "new"), stageWithTarget("Advance to MN")],
        executeWithRetry,
        readColumns,
      }),
    );

    expect(result).toEqual([]);
    expect(advanced(executeWithRetry)).toBe(true);
  });
});


/**
 * The idempotency key is what the gateway dedupes a send on, and
 * `send_jobs.idempotency_key` is UNIQUE and never pruned — so a key derived
 * from the PAYLOAD ALONE made every repeat of an earlier DONE send a permanent
 * silent no-op that still reported success. Three real shapes hit it:
 *   · Subscription A → B → back to A (the third save matches the first)
 *   · saveNoAuthNeededToMonday, whose payload is a constant per item+product
 *   · a Final Confirm re-send after a manager's return, nothing edited
 * The key must therefore identify the SEND ATTEMPT. What it still has to
 * collapse — postSend's three POST tries and an offline-outbox replay — all
 * reuse the ONE key string built per transaction, so they are unaffected.
 */
describe("buildIdempotencyKey", () => {
  const data = { c1: "same", c2: { index: 3 } };
  const stage = { stage: { index: 1 } };

  it("gives two byte-identical sends DIFFERENT keys", () => {
    const a = buildIdempotencyKey("12937566870", data, stage);
    const b = buildIdempotencyKey("12937566870", data, stage);
    expect(a).not.toBe(b);
  });

  it("agrees on the item and the payload hash — only the attempt differs", () => {
    const a = buildIdempotencyKey("12937566870", data, stage).split(":");
    const b = buildIdempotencyKey("12937566870", data, stage).split(":");
    expect(a[0]).toBe("12937566870");
    expect(a[1]).toBe(b[1]);   // same payload → same hash, still legible in /audit
    expect(a[2]).not.toBe(b[2]); // …and that third part is why it still writes
  });

  it("separates different items and different payloads", () => {
    const a = buildIdempotencyKey("1", data, stage).split(":");
    const b = buildIdempotencyKey("2", data, stage).split(":");
    const c = buildIdempotencyKey("1", { c1: "other" }, stage).split(":");
    expect(a[0]).not.toBe(b[0]);
    expect(a[1]).not.toBe(c[1]);
  });

  it("never returns an empty attempt segment", () => {
    for (let i = 0; i < 200; i += 1) {
      const parts = buildIdempotencyKey("1", data, stage).split(":");
      expect(parts).toHaveLength(3);
      expect(parts[2].length).toBeGreaterThan(6);
    }
  });
});
