/**
 * Shared write-then-verify-then-advance utility.
 *
 * Monday's API returns 200 on a column write before the value is fully
 * indexed. If an automation triggers on a status change (e.g. Stage
 * Advancer = "Complete"), it can read stale pre-write values from other
 * columns. This utility prevents that race condition by:
 *
 *   1. Snapshotting all data columns BEFORE writing (Phase 0)
 *   2. Writing all data columns in parallel (Phase 1)
 *   3. Polling until every written column has been indexed (Phase 2)
 *   4. Only then writing the stage advancer column(s) (Phase 3)
 *
 * Verification logic (Phase 2):
 *   - If a task has `expectedText`: column must match it exactly
 *   - Otherwise: column must differ from the pre-write snapshot
 *   - Edge case — writing the same value that was already there:
 *     after 3 consecutive stable reads, assume the write landed
 *     (the automation will read the correct value either way)
 *
 * If verification times out, the stage advancer is NOT written and the
 * function throws — surfacing the problem instead of silently shipping
 * stale data downstream.
 */

// ── Types ──────────────────────────────────────────────────────

import { gatewaySendAvailable, submitSend } from "./gatewaySend";

/** Progress milestones for UIs that block the screen during a send.
 *  Gateway path: posting → accepted → confirmed.
 *  Client fallback path: writing → verifying → confirmed. */
export type WriteProgressPhase =
  | "posting"
  | "accepted"
  | "writing"
  | "verifying"
  | "confirmed";

/**
 * Thrown (only when `requireDone` is set) when the gateway durably accepted
 * the job but we stopped waiting before it was CONFIRMED written in Monday
 * (slow queue / offline outbox). The job WILL still run server-side, so the
 * caller must NOT retry or fall back to a client-side write — surface it as
 * "queued, do not repeat" instead.
 */
export class GatewayPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayPendingError";
  }
}

/**
 * Thrown when a status/dropdown write asked Monday to create a label and Monday
 * did NOT actually create it — the item ends up pointing at a label index that
 * carries no text, so every read-back returns "" and exact-match verification
 * can never pass.
 *
 * Why this needs its own error (2026-08-11 incident): a rep added a new ICD-10
 * code on the Evaluate panel, Monday stamped the item with index 5 but never
 * wrote the label into the column's settings (index 5 is a stale slot on that
 * board — it has a `labels_positions_v2` entry and no label, inherited by every
 * board duplicated from the same template). Verification then failed
 * identically on all 8 attempts and the stage advancer was never written. The
 * generic timeout message said "Monday may be unusually slow — retry the send",
 * so the rep retried five times, which could never work. This state is
 * permanent until someone adds the label to the board, and the message has to
 * say so.
 */
export class MissingBoardLabelError extends Error {
  constructor(
    readonly columnLabel: string,
    readonly columnId: string,
    readonly missingLabel: string,
  ) {
    super(
      `Monday did not create the ${columnLabel} label "${missingLabel}" — the column has no such label, ` +
        `so the value can't be read back and the stage was NOT advanced. Retrying will not help. ` +
        `Add "${missingLabel}" to the ${columnLabel} column on the board, then pick it from the list and send again.`,
    );
    this.name = "MissingBoardLabelError";
  }
}

/**
 * Which label writes landed on a label the board doesn't actually have.
 *
 * Pure so the diagnosis is unit-testable without a live board. Only considers
 * tasks that asked for a NON-EMPTY exact text: a clear (expectedText "") that
 * failed to verify is an ordinary timeout, not a missing label.
 */
export function findMissingBoardLabels(
  unverified: { label: string; columnId: string; expectedText?: string }[],
  labelsByColumn: Map<string, string[]>,
): { label: string; columnId: string; missingLabel: string }[] {
  const out: { label: string; columnId: string; missingLabel: string }[] = [];
  for (const t of unverified) {
    const want = t.expectedText;
    if (!want) continue; // undefined (snapshot-diff) or "" (a clear)
    const known = labelsByColumn.get(t.columnId);
    // No entry = unreadable column. Empty list = we read something we couldn't
    // parse (e.g. a dropdown's settings shape). Either way we don't know enough
    // to accuse the board, so fall through to the generic timeout message —
    // a wrong "add this label" is worse than a vague one.
    if (!known || known.length === 0) continue;
    if (!known.includes(want)) out.push({ label: t.label, columnId: t.columnId, missingLabel: want });
  }
  return out;
}

export interface WriteTask {
  label: string;
  columnId: string;
  fn: () => Promise<unknown>;
  /** Raw Monday value for this column in change_multiple_column_values shape
   *  ({ index } for status, { text } for long_text, { date } for date, a plain
   *  string for text). When EVERY task in a send carries one AND the gateway is
   *  configured, the whole transaction is handed to the server-side /send.
   *  Optional, so flows adopt it incrementally; without it the client-side path
   *  runs unchanged. */
  value?: unknown;
  /** Optional: expected `text` value after the write. When provided,
   *  takes priority over snapshot-diff verification. */
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
  /** Board id — required to engage the gateway /send fast path. */
  boardId?: string;
  /** Human label for the outbox/audit (e.g. "Evaluate send"). */
  label?: string;
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
  /** Consecutive stable reads before assuming a same-value write landed.
   *  Default 3. */
  stableReadsThreshold?: number;
  /** Optional: write a debug message on failure. */
  writeDebug?: (itemId: string, msg: string) => Promise<void>;
  /** Reads a status/dropdown column's live label set from the board settings.
   *  Used ONLY to explain a verification failure: if an exact-match write never
   *  landed and the label isn't on the column, Monday failed to create it and
   *  no amount of retrying will fix it (see MissingBoardLabelError). Supply it
   *  wherever `createLabelsIfMissing` is used; without it the engine falls back
   *  to the generic timeout message. */
  readColumnLabels?: (columnId: string) => Promise<string[]>;
  /** Forwarded to the gateway /send so specific flows (e.g. Evaluate's
   *  Diagnosis + consolidated ask) can create new labels server-side. The
   *  client-side fallback path creates labels via each task's own `fn`, so this
   *  only affects the gateway fast path. */
  createLabelsIfMissing?: boolean;
  /** Progress milestones — lets a panel block its screen until Monday
   *  confirms (see WriteProgressPhase). */
  onProgress?: (phase: WriteProgressPhase) => void;
  /** When true, "accepted by the gateway" is NOT success: the call only
   *  resolves once the job is CONFIRMED done in Monday. If the wait runs out
   *  while the job is still queued/processing (or parked offline), throws
   *  GatewayPendingError instead of silently succeeding — and never falls
   *  back to the client path (the queued job will still run; a second
   *  client-side transaction would double-write). */
  requireDone?: boolean;
  /** How long the gateway path polls for job completion (default 20s). */
  waitForDoneMs?: number;
}

// ── Core ───────────────────────────────────────────────────────

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
    stableReadsThreshold = 3,
    writeDebug,
    readColumnLabels,
    boardId,
    label,
    createLabelsIfMissing,
    onProgress,
    requireDone,
    waitForDoneMs,
  } = opts;

  // ── Gateway fast path (Phase 2): hand the whole transaction to the durable,
  // idempotent server-side /send. Engages only when the gateway is configured
  // AND every task carries a raw `value`. ANY failure falls through to the
  // client-side verified write below, so this is purely additive.
  if (gatewaySendAvailable() && boardId && tasks.length > 0 && tasks.every((t) => t.value !== undefined)) {
    try {
      const stageSet = new Set(Array.isArray(stageColumnId) ? stageColumnId : [stageColumnId]);
      const dataColumns: Record<string, unknown> = {};
      const stageColumns: Record<string, unknown> = {};
      const verify: { columnId: string; expectedText?: string }[] = [];
      for (const t of tasks) {
        if (stageSet.has(t.columnId)) stageColumns[t.columnId] = t.value;
        else {
          dataColumns[t.columnId] = t.value;
          if (t.expectedText !== undefined) verify.push({ columnId: t.columnId, expectedText: t.expectedText });
        }
      }
      let h = 5381;
      const sig = JSON.stringify({ dataColumns, stageColumns });
      for (let i = 0; i < sig.length; i++) h = ((h << 5) + h + sig.charCodeAt(i)) | 0;
      const idempotencyKey = `${itemId}:${(h >>> 0).toString(36)}`;
      const outcome = await submitSend(
        { itemId, boardId, dataColumns, stageColumns, verify, idempotencyKey, label, createLabelsIfMissing },
        { waitForDone: true, waitForDoneMs, onPhase: onProgress },
      );
      if (outcome === "done" || !requireDone) return [];
      // requireDone and the job is durably queued but not yet confirmed in
      // Monday — it WILL run server-side (or flush from the browser outbox), so
      // do NOT fall through to the client path (that would run the transaction a
      // second time and double-write).
      throw new GatewayPendingError(
        outcome === "queued-offline"
          ? "You're offline — the save is parked in this browser and will submit automatically when you're back online. Do not repeat it."
          : outcome === "queued-unconfirmed"
            ? "The save is queued in this browser and will submit automatically. Do not repeat it."
            : "The server accepted the save and is still writing it to Monday. It will finish on its own — do not repeat this save.",
      );
    } catch (err) {
      if (err instanceof GatewayPendingError) throw err;
      console.warn("[verifiedWrite] gateway /send failed — falling back to client path:", err);
    }
  }

  // Split tasks — stage column(s) run last
  const stageIds = new Set(
    Array.isArray(stageColumnId) ? stageColumnId : [stageColumnId],
  );
  const stageTasks = tasks.filter((t) => stageIds.has(t.columnId));
  const dataTasks = tasks.filter((t) => !stageIds.has(t.columnId));

  // Collect column IDs we need to verify
  const verifyColIds = dataTasks.map((t) => t.columnId);

  // ── Phase 0: snapshot BEFORE writing ─────────────────────
  // Columns without `expectedText` are verified by snapshot-diff (Phase 2), which
  // can ONLY work against a pre-write baseline. If the snapshot read fails we must
  // NOT silently continue with an empty baseline — that degrades the check from
  // "did it change?" to "is it non-empty?", so a stale not-yet-indexed value would
  // falsely pass and we'd advance the stage on stale data (the exact race this
  // utility exists to prevent). Retry a few times; if we still can't read a
  // baseline AND any column relies on snapshot-diff, abort before writing anything.
  let beforeSnapshot = new Map<string, string>();
  if (verifyColIds.length > 0) {
    const needsSnapshot = dataTasks.some((t) => t.expectedText === undefined);
    let snapped = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const snap = await readColumns(itemId, verifyColIds);
        beforeSnapshot = new Map(snap.map((c) => [c.id, c.text ?? ""]));
        snapped = true;
        break;
      } catch (err) {
        console.warn(`[verifiedWrite] Pre-write snapshot attempt ${attempt}/3 failed:`, err);
        if (attempt < 3) await new Promise((r) => setTimeout(r, verifyIntervalMs));
      }
    }
    if (!snapped && needsSnapshot) {
      const msg =
        "Could not read the pre-write snapshot after 3 attempts — stage NOT advanced (read-back verification needs a baseline). Check the connection and retry.";
      console.error(`[verifiedWrite] ${msg}`);
      if (writeDebug) {
        try { await writeDebug(itemId, `[${new Date().toISOString().slice(0, 19)}] ${msg}`); } catch { /* best-effort */ }
      }
      throw new Error(msg);
    }
    // If the snapshot failed but EVERY data column carries expectedText, Phase 2's
    // exact-match path covers them without a baseline — safe to proceed.
  }

  // ── Phase 1: write all data columns in parallel ──────────
  onProgress?.("writing");
  const dataResults = await Promise.all(dataTasks.map(executeWithRetry));
  const dataFailures = dataResults.filter((r): r is string => r !== null);

  if (dataFailures.length > 0) {
    if (writeDebug) {
      const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
      const msg = `[${ts}] ${dataFailures.length} write(s) failed (stage NOT advanced):\n${dataFailures.join("\n")}`;
      try { await writeDebug(itemId, msg); } catch { /* best-effort */ }
    }
    return dataFailures;
  }

  // ── Phase 2: read-back verification ──────────────────────
  onProgress?.("verifying");
  if (verifyColIds.length > 0) {
    // Track how many consecutive reads each column has been "stable"
    // (unchanged from snapshot). Once a column hits the threshold,
    // we assume a same-value write and stop waiting.
    const stableCount = new Map<string, number>();
    let verified = false;
    // The tasks still unverified on the LAST attempt — used to explain the
    // failure (missing board label vs. genuinely slow indexing).
    let pendingTasks: WriteTask[] = [];

    for (let attempt = 1; attempt <= maxVerifyAttempts; attempt++) {
      const snapshot = await readColumns(itemId, verifyColIds);
      const actual = new Map(snapshot.map((c) => [c.id, c.text ?? ""]));

      const pending: string[] = [];
      pendingTasks = [];

      for (const task of dataTasks) {
        const colId = task.columnId;
        const currentVal = actual.get(colId) ?? "";
        const beforeVal = beforeSnapshot.get(colId) ?? "";

        // Method 1: expectedText provided — exact match
        if (task.expectedText !== undefined) {
          if (currentVal === task.expectedText) continue; // verified
          pending.push(`${task.label}: expected "${task.expectedText}", got "${currentVal}"`);
          pendingTasks.push(task);
          continue;
        }

        // Method 2: snapshot diff — value changed from before
        if (currentVal !== beforeVal) continue; // verified — value changed

        // Value hasn't changed from snapshot. Could be:
        //   (a) same-value write — already correct, automation safe
        //   (b) write not indexed yet — stale value
        // Track consecutive stable reads to distinguish.
        const prevStable = stableCount.get(colId) ?? 0;
        const newStable = prevStable + 1;
        stableCount.set(colId, newStable);

        if (newStable >= stableReadsThreshold) {
          // Assume same-value write — the automation will read the
          // correct value regardless.
          continue;
        }

        pending.push(`${task.label}: unchanged from snapshot "${beforeVal}" (stable read ${newStable}/${stableReadsThreshold})`);
        pendingTasks.push(task);
      }

      if (pending.length === 0) {
        console.log(
          `[verifiedWrite] All ${dataTasks.length} columns verified on attempt ${attempt}`,
        );
        verified = true;
        break;
      }

      console.warn(
        `[verifiedWrite] Attempt ${attempt}/${maxVerifyAttempts}: ${pending.length} column(s) pending`,
        pending,
      );

      if (attempt < maxVerifyAttempts) {
        await new Promise((r) => setTimeout(r, verifyIntervalMs));
      }
    }

    if (!verified) {
      // Before blaming latency, check the one cause that latency can never
      // resolve: the write asked Monday to create a label and Monday didn't,
      // so the column holds a text-less index that will read back "" forever.
      let missingLabelMsg: string | null = null;
      let missingLabelErr: MissingBoardLabelError | null = null;
      if (readColumnLabels && pendingTasks.some((t) => t.expectedText)) {
        try {
          const cols = [...new Set(pendingTasks.filter((t) => t.expectedText).map((t) => t.columnId))];
          const labelsByColumn = new Map<string, string[]>();
          await Promise.all(
            cols.map(async (id) => {
              try { labelsByColumn.set(id, await readColumnLabels(id)); }
              catch { /* unreadable column → stays out of the map, stays quiet */ }
            }),
          );
          const missing = findMissingBoardLabels(pendingTasks, labelsByColumn);
          if (missing.length > 0) {
            const m = missing[0];
            missingLabelErr = new MissingBoardLabelError(m.label, m.columnId, m.missingLabel);
            missingLabelMsg = missingLabelErr.message;
          }
        } catch { /* diagnosis is best-effort — never mask the original failure */ }
      }

      const msg =
        missingLabelMsg ??
        `Stage advancer NOT written: column(s) failed read-back verification after ${maxVerifyAttempts} attempts (~${Math.round((maxVerifyAttempts * verifyIntervalMs) / 1000)}s). Monday may be unusually slow — retry the send.`;
      console.error(`[verifiedWrite] ${msg}`);
      if (writeDebug) {
        try { await writeDebug(itemId, `[${new Date().toISOString().slice(0, 19)}] ${msg}`); } catch { /* best-effort */ }
      }
      throw missingLabelErr ?? new Error(msg);
    }
  }

  // ── Phase 3: write stage advancer(s) ───────────────────
  for (const st of stageTasks) {
    const stageErr = await executeWithRetry(st);
    if (stageErr) {
      throw new Error(`${st.label} failed after retries: ${stageErr}`);
    }
  }

  onProgress?.("confirmed");
  return []; // all succeeded
}
