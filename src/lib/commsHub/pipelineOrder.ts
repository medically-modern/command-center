/**
 * The patient tracker — which board comes after which.
 *
 * This is the order the Command Center's own role registry and Pipeline
 * Oversight both use, and it is what the dossier widget draws as a patient's
 * visual history:
 *
 *   DTC Intake → Profile Send Off → Medical Evaluation → Insurance
 *              → Welcome Call → Subscription
 *
 * ⚠️ **CLAUDE.md §6's ASCII diagram disagrees** — it puts Welcome Call second,
 * straight after Profile Send Off. Three things in the live app say otherwise
 * and agree with each other, so the diagram is the odd one out:
 *   1. Profile Send Off's only exit is **Advance to MN**, whose automation
 *      (7917676280) creates the **Medical Evaluation** item — §5.10/§5.20.
 *   2. `config.ts` ROLES runs profile → evaluate/chase → benefits/auth →
 *      welcomeCall → subscription.
 *   3. `OVERSIGHT_SECTIONS` runs intake → medical-evaluation → insurance →
 *      welcome-call.
 * Final Confirm's advancer then fires the create-item hop to Subscription
 * (§5.14), which closes the chain.
 *
 * Pure and dependency-free on purpose: the widget, the fax directory and the
 * tests all read it, and none of them should have to pull in the boards
 * registry to learn what order the stages go in.
 */

export interface PipelineBoard {
  boardId: number;
  /** Full board name, for a tooltip. */
  label: string;
  /** What the step chip says — short enough for six of them in a row. */
  short: string;
  /** The role page that shows what was gathered on that board. Empty where the
   *  Command Center has no page for it (DTC Intake is read-only — §3). */
  route: string;
}

export const PIPELINE_ORDER: readonly PipelineBoard[] = [
  { boardId: 18392794310, label: "DTC Intake",         short: "Intake",       route: "" },
  { boardId: 18406352652, label: "Profile Send Off",   short: "Profile",      route: "/profile" },
  { boardId: 18406060017, label: "Medical Evaluation", short: "MN",           route: "/evaluate" },
  { boardId: 18410601299, label: "Insurance",          short: "Insurance",    route: "/benefits" },
  { boardId: 18410804557, label: "Welcome Call",       short: "Welcome Call", route: "/welcome-call" },
  { boardId: 18407459988, label: "Subscription",       short: "Subscription", route: "/subscription" },
] as const;

/**
 * Secondary Claims (18413019028) is deliberately NOT a step. It is a parallel
 * reconciliation board a patient can sit on at the same time as a real stage,
 * so drawing it in the chain would imply a patient had moved somewhere they
 * hadn't. It still shows in the dossier's "also on" list.
 */
export const NON_PIPELINE_BOARDS: readonly number[] = [18413019028];

/** Position in the chain, or -1 for a board that isn't a stage. */
export function pipelineIndex(boardId: number): number {
  return PIPELINE_ORDER.findIndex((b) => b.boardId === boardId);
}

export function pipelineBoard(boardId: number): PipelineBoard | null {
  return PIPELINE_ORDER.find((b) => b.boardId === boardId) ?? null;
}
