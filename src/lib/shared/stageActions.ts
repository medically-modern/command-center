/**
 * Stage action bar — which buttons a role page's header shows, per stage and
 * per manager-view origin.
 *
 * ── This file is the seam. ──
 * Every click-in destination (8 stages × 4 origins) resolves its buttons here,
 * so giving ONE page's ONE entry point a different button set is a one-line
 * edit to OVERRIDES below — no page surgery, no risk to the other 31 cells.
 * Today almost every cell resolves to the same two defaults on purpose; the
 * point is that they CAN diverge, not that they currently do.
 *
 * To change a single destination, add its cell:
 *
 *   const OVERRIDES = {
 *     "auth-outstanding": {
 *       "manager-processor": ["proposeStuck", "returnToQueue"],
 *     },
 *   };
 *
 * Resolution order: OVERRIDES[stage][origin] → the origin default → BASE.
 */
import type { ManagerOrigin } from "./managerOrigin";

/** Role pages that render a stage action bar. */
export type StageKey =
  | "evaluate"
  | "send-request"
  | "confirm-receipt"
  | "chase-fax"
  | "chase-parachute"
  | "benefits"
  | "submit-auth"
  | "auth-outstanding";

/**
 * A button the bar can render.
 * - `proposeStuck`   — the rep's ask: flag the patient and send them to a manager.
 * - `approveStuck`   — the manager's approval: patient really is Stuck.
 * - `returnToQueue`  — the manager's rejection: send the patient back into the
 *                      pipeline, into the queue they came from. (Josh calls this
 *                      "send back to pipeline"; same action, same write.)
 */
export type StageAction = "proposeStuck" | "approveStuck" | "returnToQueue";

/** What a page shows when nobody came from an oversight manager column. */
const BASE: readonly StageAction[] = ["proposeStuck"];

/**
 * Per-origin defaults. Final Decisions is the one that genuinely differs today:
 * the patient arrived BECAUSE they were already proposed stuck, so the manager
 * needs the decision pair, and Propose Stuck is deliberately dropped rather
 * than shown as a no-op.
 */
const BY_ORIGIN: Record<ManagerOrigin, readonly StageAction[]> = {
  overview: BASE,
  "manager-processor": BASE,
  "final-decisions": ["approveStuck", "returnToQueue"],
};

/**
 * Per-(stage × origin) overrides. Empty by design — this is the hook for the
 * "minute specific changes" that only apply to one page's one entry point.
 */
const OVERRIDES: Partial<Record<StageKey, Partial<Record<ManagerOrigin, readonly StageAction[]>>>> = {};

/** Resolve the button set for a stage page opened from `origin` (null = rep). */
export function actionsFor(stage: StageKey, origin: ManagerOrigin | null): readonly StageAction[] {
  if (!origin) return BASE;
  return OVERRIDES[stage]?.[origin] ?? BY_ORIGIN[origin] ?? BASE;
}

/** True when the bar should render the manager's decision pair at all. */
export function isDecisionOrigin(origin: ManagerOrigin | null): boolean {
  return origin === "final-decisions";
}
