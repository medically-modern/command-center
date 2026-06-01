/**
 * Shared write-then-verify-then-advance utility.
 *
 * Monday's API returns 200 on a column write before the value is fully
 * indexed. If an automation triggers on a status change (e.g. Stage
 * Advancer = "Complete"), it can read stale pre-write values from other
 * columns. This utility prevents that race condition by:
 *
 *   1. Writing all data columns in parallel (Phase 1)
 *   2. Reading the item back and verifying every column landed (Phase 2)
 *   3. Only then writing the stage advancer column (Phase 3)
 *
 * If verification times out, the stage advancer is NOT written and the
 * function throws — surfacing the problem instead of silently shipping
 * stale data downstream.
 */

// ── Types ──────────────────────────────────────────────────────

export interface WriteTask {
  label: string;
  columnId: string;
  fn: () => Promise<unknown>;
  /** Expected `text` value after the write lands. When provided, the
   *  read-back loop compares against this. When omitted, the column is
   *  excluded from verification (fire-and-forget). Only columns that
   *  feed into downstream automations need verification — but it's cheap
   *  to verify everything, so prefer setting this. */
  expectedText?: string;
}

interface ColumnSnapshot {
  id: string;
  text: string | null;
}

/** A function that reads column values for an item. Each mondayApi module
 *  has its own `gql` wrapper, so callers pass a thin adapter. */
export type ReadColumnsFn = (
  itemId: string,
  columnIds: string[],
) => Promise<ColumnSnapshot[]>;

interface VerifiedWriteOpts {
  itemId: string;
  /** All write tasks including the stage advancer. */
  tasks: WriteTask[];
  /** Column ID(s) of the stage advancer (or equivalent trigger columns).
   *  These columns are written LAST, after all other columns are verified.
   *  Accepts a single string or an array. */
  stageColumnId: string | string[];
  /** Retry wrapper — typically the same `executeWithRetry` each module
   *  already has. */
  executeWithRetry: (task: WriteTask) => Promise<string | null>;
  /** Adapter for reading columns back from Monday. */
  readColumns: ReadColumnsFn;
  /** Max read-back attempts before giving up. Default 8 (~12s). */
  maxVerifyAttempts?: number;
  /** Delay between read-back attempts in ms. Default 1500. */
  verifyIntervalMs?: number;
  /** Optional: write a debug message on failure. */
  writeDebug?: (itemId: string, msg: string) => Promise<void>;
}

// ── Core ───────────────────────────────────────────────────────

/**
 * Execute column writes with read-back verification before advancing
 * the stage.
 *
 * Returns an array of failure messages (empty = all succeeded).
 * Throws if the stage advancer write itself fails.
 */
export async function executeWritesWithVerification(
  opts: VerifiedWriteOpts,
): Promise<string[]> {
  const {
    itemId,
    tasks,
    stageColumnId,
    executeWithRetry,
    readColumns,
    maxVerifyAttempts = 8,
    verifyIntervalMs = 1500,
    writeDebug,
  } = opts;

  // Split tasks — stage column(s) run last
  const stageIds = new Set(
    Array.isArray(stageColumnId) ? stageColumnId : [stageColumnId],
  );
  const stageTasks = tasks.filter((t) => stageIds.has(t.columnId));
  const dataTasks = tasks.filter((t) => !stageIds.has(t.columnId));

  // ── Phase 1: write all data columns in parallel ──────────
  const dataResults = await Promise.all(dataTasks.map(executeWithRetry));
  const dataFailures = dataResults.filter((r): r is string => r !== null);

  // If any data writes failed, log and bail — don't advance stage with
  // incomplete data.
  if (dataFailures.length > 0) {
    if (writeDebug) {
      const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
      const msg = `[${ts}] ${dataFailures.length} write(s) failed (stage NOT advanced):\n${dataFailures.join("\n")}`;
      try { await writeDebug(itemId, msg); } catch { /* best-effort */ }
    }
    return dataFailures;
  }

  // ── Phase 2: read-back verification ──────────────────────
  // Only verify columns that declared an expectedText.
  const verifiable = dataTasks.filter((t) => t.expectedText !== undefined);

  if (verifiable.length > 0) {
    const colIds = verifiable.map((t) => t.columnId);
    const expected = new Map(
      verifiable.map((t) => [t.columnId, t.expectedText!]),
    );

    let verified = false;
    for (let attempt = 1; attempt <= maxVerifyAttempts; attempt++) {
      const snapshot = await readColumns(itemId, colIds);
      const actual = new Map(snapshot.map((c) => [c.id, c.text ?? ""]));

      const mismatches: string[] = [];
      for (const [colId, exp] of expected) {
        const act = actual.get(colId) ?? "";
        if (act !== exp) {
          const task = verifiable.find((t) => t.columnId === colId);
          mismatches.push(
            `${task?.label ?? colId}: expected "${exp}", got "${act}"`,
          );
        }
      }

      if (mismatches.length === 0) {
        console.log(
          `[verifiedWrite] All ${verifiable.length} columns verified on attempt ${attempt}`,
        );
        verified = true;
        break;
      }

      console.warn(
        `[verifiedWrite] Attempt ${attempt}/${maxVerifyAttempts}: ${mismatches.length} column(s) not yet indexed`,
        mismatches,
      );

      if (attempt < maxVerifyAttempts) {
        await new Promise((r) => setTimeout(r, verifyIntervalMs));
      }
    }

    if (!verified) {
      const msg = `Stage advancer NOT written: ${verifiable.length} column(s) failed read-back verification after ${maxVerifyAttempts} attempts (~${Math.round((maxVerifyAttempts * verifyIntervalMs) / 1000)}s). Monday may be unusually slow — retry the send.`;
      console.error(`[verifiedWrite] ${msg}`);
      if (writeDebug) {
        try { await writeDebug(itemId, `[${new Date().toISOString().slice(0, 19)}] ${msg}`); } catch { /* best-effort */ }
      }
      throw new Error(msg);
    }
  }

  // ── Phase 3: write stage advancer(s) ───────────────────
  for (const st of stageTasks) {
    const stageErr = await executeWithRetry(st);
    if (stageErr) {
      throw new Error(`${st.label} failed after retries: ${stageErr}`);
    }
  }

  return []; // all succeeded
}
