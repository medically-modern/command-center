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
 *       "manager-intervention": ["proposeStuck", "returnToQueue"],
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
  | "auth-outstanding"
  | "dvs"
  | "doctor-appointments"
  /** Unverified Referrals — the DTC + CareCentrix intake stage. */
  | "unverified-intake";

/**
 * A button the bar can render.
 * - `proposeStuck`   — the rep's ask: flag the patient and send them to a manager.
 * - `approveStuck`   — the manager's approval: patient really is Stuck.
 * - `returnToQueue`  — the manager's rejection: send the patient back into the
 *                      pipeline, into the queue they came from. (Josh calls this
 *                      "send back to pipeline"; same action, same write.)
 * - `returnToManager`— Final Decisions hands the patient DOWN a rung, to Manager
 *                      Intervention, instead of out to the rep queue. Katie fixes
 *                      the underlying problem on Monday and gives it back to
 *                      Janelle. Only wired for DVS today (see OVERRIDES).
 */
export type StageAction = "proposeStuck" | "approveStuck" | "returnToQueue" | "returnToManager";

/** What a page shows when nobody came from an oversight manager column. */
const BASE: readonly StageAction[] = ["proposeStuck"];

/**
 * Per-origin defaults.
 *
 * Manager Intervention gets **Send back to pipeline** alongside Propose Stuck
 * (Josh, 2026-08-02): an escalated patient is invisible to the rep — excluded
 * from her sidebar and her burndown count — so clearing the escalation is the
 * only way back, and before this it existed only in Final Decisions. Janelle
 * needed it for every situation she can resolve herself, not just stuck ones.
 *
 * Final Decisions keeps the decision pair, and Propose Stuck is deliberately
 * dropped there rather than shown as a no-op — the patient is already final.
 */
const BY_ORIGIN: Record<ManagerOrigin, readonly StageAction[]> = {
  overview: BASE,
  "manager-intervention": ["proposeStuck", "returnToQueue"],
  "final-decisions": ["approveStuck", "returnToQueue"],
};

/**
 * Per-(stage × origin) overrides — the hook for changes that apply to exactly
 * one page's one entry point.
 *
 * DVS × Final Decisions is the live example: the fix for a failed DVS run is
 * made in Monday by the final reviewer, and the patient then goes back to the
 * MANAGER queue to be re-watched — not out to a rep, who has no DVS actions,
 * and not to Stuck. So this one cell swaps in `returnToManager`.
 */
const OVERRIDES: Partial<Record<StageKey, Partial<Record<ManagerOrigin, readonly StageAction[]>>>> = {
  dvs: {
    "final-decisions": ["approveStuck", "returnToManager", "returnToQueue"],
  },
};

/** Resolve the button set for a stage page opened from `origin` (null = rep). */
export function actionsFor(stage: StageKey, origin: ManagerOrigin | null): readonly StageAction[] {
  if (!origin) return BASE;
  return OVERRIDES[stage]?.[origin] ?? BY_ORIGIN[origin] ?? BASE;
}

/** True when the bar should render the manager's decision pair at all. */
export function isDecisionOrigin(origin: ManagerOrigin | null): boolean {
  return origin === "final-decisions";
}

/**
 * Which escalation a Propose Stuck writes on the Insurance board — one rung UP
 * from wherever the patient already is (Josh, 2026-08-02).
 *
 * The ladder is processor → Janelle (Manager Intervention) → Katie (Final
 * Decisions). This used to key off the STAGE alone — Submit Auth proposals went
 * to Manager, everything else to Final — which made Janelle's own Propose Stuck
 * a no-op at Submit Auth: it re-wrote the Manager label the patient already had,
 * so a patient could never reach Katie from the page (only from the Oversight
 * drill-down's separate "Escalate to Final Decisions" button).
 *
 * Two things promote to Final, and either is sufficient:
 *   - the patient ALREADY carries an escalation, so this proposal is the second
 *     one (Final is the top rung, so an already-Final patient stays there rather
 *     than dropping back to Manager because of what stage they happen to be on),
 *     or
 *   - the click came from Manager Intervention, i.e. Janelle is the one asking.
 *
 * Otherwise Submit Auth, DVS and Doctor Appointments start at Manager — each
 * has a manager-review step of its own — and Benefits / Auth Outstanding go
 * straight to Final, which is the existing behaviour: for those two, the rep's
 * proposal IS the escalation.
 *
 * Doctor Appointments follows the same ladder for its "won't schedule / wants
 * to cancel" outcome (Josh, 2026-08-03): a rep's proposal reaches Manager
 * Intervention, and a manager proposing from there sends it to Final Decisions.
 */
export function proposeStuckLevel(
  stage: StageKey,
  origin: ManagerOrigin | null,
  /** The patient's current Insurance Escalation label, if any. */
  escalationLabel?: string | null,
): "manager" | "final" {
  const label = (escalationLabel ?? "").trim();
  if (label === "Manager Escalation Required" || label === "Final Escalation Required") return "final";
  if (origin === "manager-intervention") return "final";
  return stage === "submit-auth" || stage === "dvs" || stage === "doctor-appointments"
    ? "manager"
    : "final";
}
