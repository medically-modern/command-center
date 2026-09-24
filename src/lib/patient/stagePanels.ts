/**
 * The patient screen's sub-stage model (§5.39c) — which tools a board's one
 * item passed through, and which of them the patient actually reached.
 *
 * Brandon's handoff: *"Medical Evaluation and Insurance have several
 * sub-stages, so they get a toggle across them (Evaluate | Send Request |
 * Confirm Receipt | Chase Clinicals | Doctor Appointments; Benefits | Submit
 * Auth | Auth Outstanding | Auth Denied | DVS); sub-stages the patient never
 * reached are greyed out."*
 *
 * ⚠️⚠️ **ONE ITEM, SEVERAL TOOLS — and that is the whole reason this file
 * exists.** A patient is one item per BOARD (§6), and Medical Evaluation spans
 * five tools on that one item: the sub-stage is a COLUMN on it
 * (`stageAdvancerText`), not a separate record. So the stepper's per-record
 * tabs (§5.42's `snapTabLabel`) answer a different question — *which* record —
 * and cannot answer this one.
 *
 * ⚠️ **"Reached" is inferred from POSITION, and it is the honest half of a
 * fact we do not otherwise hold.** The board keeps no per-sub-stage history, so
 * all we know is where the item is NOW: everything at or before that point in
 * the board's own order has been passed through, everything after it has not.
 * That is right for the ordinary forward path and is deliberately generous in
 * one direction — a patient sent BACK a step (a manager's Return to Queue, a
 * re-evaluation) shows the later tools as reached, because they were. It is
 * never wrong the other way, which is the direction that would hide a tool a
 * rep needs to audit.
 *
 * ⚠️ **A COMPLETED record has reached everything**, whatever its advancer says:
 * the item is in the board's Completed group, so every tool on it is done. Its
 * advancer is frequently left on the last working value rather than a terminal
 * one, so reading position alone would grey out the tools a manager opens a
 * finished record to read.
 *
 * ⚠️ **Doctor Appointments is a SIDE BRANCH, not a sixth step** (§5.12): a
 * chase patient whose office asks for a visit is flipped there and comes back.
 * It is listed last because that is where Brandon puts it and where a rep looks
 * for it, NOT because it follows Chase — which is why `reachedIndex` treats the
 * position as a floor and the item's own sub-stage as proof, so a patient
 * sitting in Doctor Appointments does not read as having passed Chase twice.
 */
import type { DossierItem } from "@/lib/commsHub/dossier";

export interface SubStage {
  /** The board's own Stage Advancer / Sub-Stage label — the join key. */
  key: string;
  /** What the toggle says. */
  label: string;
  /** The tool's name, as the panel header and the Open link say it. */
  tool: string;
  /** The live page, for the Open link. Empty when the stage has no page. */
  route: string;
}

/** Medical Evaluation `18406060017` — Sub-Stage `color_mm1wyr92` IS the advancer. */
const MEDICAL_EVALUATION: SubStage[] = [
  { key: "Evaluate MN", label: "Evaluate", tool: "Evaluate MN", route: "/evaluate" },
  { key: "Send Request", label: "Send Request", tool: "Send Request", route: "/send-request" },
  { key: "Confirm Receipt", label: "Confirm Receipt", tool: "Confirm Receipt", route: "/confirm-receipt" },
  { key: "Chase Clinicals", label: "Chase Clinicals", tool: "Chase Clinicals", route: "/chase-fax" },
  { key: "Doctor Appointment", label: "Doctor Appts", tool: "Doctor Appointments", route: "/doctor-appointments" },
];

/** Insurance `18410601299` — Stage Advancer. */
const INSURANCE: SubStage[] = [
  { key: "Benefits / SoS", label: "Benefits", tool: "Benefits", route: "/benefits" },
  { key: "Submit Auth.", label: "Submit Auth", tool: "Submit Auth", route: "/submit-auth" },
  { key: "Auth. Outstanding", label: "Auth Outstanding", tool: "Auth Outstanding", route: "/auth-outstanding" },
  { key: "DVS", label: "DVS", tool: "DVS", route: "/dvs" },
  // ⚠️ Listed because the board has it and §7 requires that no state match
  // nothing, NOT because there is a tool: the stage is deliberately unbuilt, so
  // its route is empty and the panel says so rather than offering a dead link.
  { key: "Auth Denied", label: "Auth Denied", tool: "Auth Denied", route: "" },
];

/** Welcome Call `18410804557` — Stage Advancer `color_mm1ws96t`. */
const WELCOME_CALL: SubStage[] = [
  { key: "Welcome Call", label: "Welcome Call", tool: "Welcome Call", route: "/welcome-call" },
  { key: "Review Profile", label: "Final Confirm", tool: "Final Profile Confirmation", route: "/final-confirm" },
];

/**
 * ⚠️ **Profile Send Off is deliberately ABSENT.** Its two tools render inline
 * in `ProfilePage` (2,036 lines) and `UnverifiedReferralsPage` (4,047), not as
 * a prop-driven panel, so there is nothing to embed without splitting those two
 * pages first — the one place this repo's shell/body convention (§4) does not
 * already hold. That step keeps today's snapshot cards and says so, rather than
 * a toggle whose tabs open nothing.
 */
export const SUB_STAGES: Record<number, SubStage[]> = {
  18406060017: MEDICAL_EVALUATION,
  18410601299: INSURANCE,
  18410804557: WELCOME_CALL,
};

export interface SubStageStep extends SubStage {
  /** The patient passed through this tool (or is in it now). */
  reached: boolean;
  /** The item's sub-stage is this one — "Live — the patient is here now". */
  current: boolean;
  /**
   * The patient went THROUGH this tool and on — the check on its tab
   * (pixel-match Phase 2). Only on positive evidence: a finished record, or a
   * step before the item's own. ⚠️ An unrecognised advancer marks NOTHING
   * passed — the mirror of `reached`, which for the same reason greys nothing
   * out: a read we could not make sense of proves neither.
   */
  passed: boolean;
}

/** The board's sub-stages, or `[]` for a board with no embeddable tools. */
export function subStagesFor(item: DossierItem | null): SubStageStep[] {
  if (!item) return [];
  const defs = SUB_STAGES[item.boardId];
  if (!defs) return [];

  const advancer = (item.stageAdvancerText || "").trim();
  const at = defs.findIndex((s) => s.key === advancer);

  return defs.map((s, i) => ({
    ...s,
    // A finished record has been through all of them; an unrecognised advancer
    // (blank, or a label added to the board since) proves nothing, so nothing
    // is greyed out on the strength of a read we could not make sense of.
    reached: item.isCompleted || at < 0 || i <= at,
    current: !item.isCompleted && at >= 0 && i === at,
    passed: item.isCompleted || (at >= 0 && i < at),
  }));
}

/** Which sub-stage to open on: where the patient is, else the last reached. */
export function defaultSubStage(steps: SubStageStep[]): string {
  const live = steps.find((s) => s.current);
  if (live) return live.key;
  const reached = steps.filter((s) => s.reached);
  return reached.length > 0 ? reached[reached.length - 1].key : steps[0]?.key ?? "";
}

/** True when this board's tools can be embedded at all. */
export function hasSubStagePanels(boardId: number): boolean {
  return SUB_STAGES[boardId] !== undefined;
}
