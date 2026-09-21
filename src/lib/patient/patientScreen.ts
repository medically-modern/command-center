/**
 * The patient screen's pure rules (§5.39) — the four-stage stepper, the info
 * strip, the read-only snapshot, and where each "Open" link goes.
 *
 * Everything here reads the dossier the Comms Hub already builds (§5.28). No
 * board read, no write, no second opinion about who a patient is.
 */
import type { DossierItem, PatientDossier } from "@/lib/commsHub/dossier";
import { PIPELINE_ORDER } from "@/lib/commsHub/pipelineOrder";
import { COMPLETED_STAGE_ROUTES } from "@/lib/systemMgmt/stageCompletion";

/** Query keys the page reads. */
export const VIEW_PARAM = "view";
export const SIDE_PARAM = "side";
export const STEP_PARAM = "step";
export const SNAP_PARAM = "snap";
/** Profile | Orders inside the Subscription view (§5.45) — in the URL like
 *  every other pane choice on this screen, so a link can name one. */
export const SUB_PARAM = "sub";
/** Carries the board, because a Monday item id alone does not say which board
 *  it is on and `fetchDossierItemsForPick` needs both. */
export const BOARD_PARAM = "board";

export type PatientView = "onboarding" | "subscription";
export type PatientSide = "texts" | "calls";

export function parseView(raw: string | null): PatientView {
  return raw === "subscription" ? "subscription" : "onboarding";
}
export function parseSide(raw: string | null): PatientSide {
  return raw === "calls" ? "calls" : "texts";
}

/** The Subscription board — not a pipeline stage, so it is the OTHER view
 *  rather than a fifth step, exactly as the mockup has it. */
export const SUBSCRIPTION_BOARD = 18407459988;

/**
 * The four macro stages of the stepper, as Brandon draws them.
 *
 * ⚠️ **Four, not six.** `PIPELINE_ORDER` has six boards; the mockup's stepper is
 * `repeat(4, 1fr)` and its `SNAP_ORDER` keys 0–3. DTC Intake folds into Intake
 * (it is read-only and has no page — §3), and Subscription is the other VIEW.
 * So the stepper is the four boards a patient is actually *worked* on.
 */
export interface MacroStage {
  key: string;
  label: string;
  /** Boards that belong to this stage, in pipeline order. */
  boards: number[];
}

export const MACRO_STAGES: readonly MacroStage[] = [
  { key: "intake", label: "Intake", boards: [18392794310, 18406352652] },
  { key: "mn", label: "Medical Necessity", boards: [18406060017] },
  { key: "insurance", label: "Insurance", boards: [18410601299] },
  { key: "welcome", label: "Welcome Call", boards: [18410804557] },
] as const;

export type StepState = "done" | "now" | "stuck" | "todo";

export interface StageStep {
  stage: MacroStage;
  state: StepState;
  /** Every record the patient has on this stage's boards, pipeline order. */
  items: DossierItem[];
  /** The one the snapshot opens on. */
  lead: DossierItem | null;
  /** 0–1, for the bar under the step. */
  progress: number;
}

const rank = (boardId: number) => PIPELINE_ORDER.findIndex((b) => b.boardId === boardId);

/**
 * Turn the dossier into the four steps.
 *
 * ⚠️ **"Done" is decided by HOW FAR THE PATIENT GOT, not by this board's own
 * flag.** A patient live on Insurance completed Medical Necessity whether or not
 * that item's Completed group was read correctly — the board hop is a
 * create-item automation, so the later record's existence IS the evidence
 * (§5.38). Reading `isCompleted` alone would draw a finished stage as unstarted
 * the moment a group id moved, which is §5.18's hand-maintained-list hazard.
 */
export function buildStages(dossier: PatientDossier | null): StageStep[] {
  const items = dossier?.items ?? [];
  const activeBoard = dossier?.active?.boardId ?? 0;

  // The furthest board the patient has any record on, so earlier stages read
  // "done" even where their own item was never marked completed.
  const furthest = items.reduce((max, it) => Math.max(max, rank(it.boardId)), -1);

  return MACRO_STAGES.map((stage) => {
    const mine = items
      .filter((it) => stage.boards.includes(it.boardId))
      .sort((a, b) => rank(a.boardId) - rank(b.boardId));

    const isActive = mine.some((it) => it.boardId === activeBoard);
    /**
     * ⚠️ **A stuck GROUP and a stuck PROPOSAL both count (§5.43).** The second
     * is escalation index 2 sitting in an ordinary working group, which is what
     * `searchBuckets.searchBucket` files under Stuck — so reading only
     * `isStuck` here is what let the search and this screen describe one
     * patient two different ways.
     */
    const stuck = mine.some((it) => it.isStuck || it.isProposedStuck);
    const lastRank = Math.max(...stage.boards.map(rank));

    /**
     * ⚠️ **ORDER MATTERS, and it was wrong for a patient parked in a Stuck
     * group** (§5.42). `stuck` only won when the stage was ALSO the active one
     * — but `pickActive` skips stuck records by design, so a patient whose only
     * record on this stage is stuck has no active board here, fell past both
     * stuck branches and landed on the "there are items, so they must be
     * working" fallback. The stepper said **In progress** for somebody nobody
     * is working, which is the one thing a stuck patient must not look like.
     *
     * Moving PAST a stage still wins over having been stuck in it: a patient
     * who was stuck at Medical Necessity, was returned to the queue and is now
     * on Insurance completed that stage, whatever happened on the way.
     */
    let state: StepState;
    if (isActive && stuck) state = "stuck";
    else if (isActive) state = "now";
    else if (furthest > lastRank) state = "done";
    else if (stuck) state = "stuck";
    else if (mine.length && mine.every((it) => it.isCompleted)) state = "done";
    else if (mine.length) state = "now";
    else state = "todo";

    const lead =
      mine.find((it) => it.boardId === activeBoard) ??
      [...mine].reverse().find((it) => !it.isCompleted) ??
      mine[mine.length - 1] ??
      null;

    const progress = state === "done" ? 1 : state === "todo" ? 0 : 0.5;
    return { stage, state, items: mine, lead, progress };
  });
}

/**
 * What one snapshot tab is CALLED, when a stage holds more than one record.
 *
 * ⚠️⚠️ **TWO IDENTICAL TABS ARE A RECORD YOU CANNOT REACH** (§5.42). The tabs
 * were labelled by board name, which is the right answer for Intake — DTC
 * Intake and Profile Send Off are two boards in one stage — and says nothing at
 * all for a stage that ran TWICE on one board. A real patient had a completed
 * Medical Evaluation record and an escalated one beside it, both rendering as
 * "Medical Evaluation", and two completed Profile Send Off records, both
 * rendering as "Profile Send Off Board". Josh, 2026-09-21: *"make sure every
 * possible situation currently on the board isnt lost in this new ui view"* —
 * a tab you cannot tell from its neighbour is exactly that loss.
 *
 * So the label is whatever DISTINGUISHES this record from its siblings, tried
 * in order: the board (different boards), the group (the ordinary duplicate —
 * "Completed" vs "2. Medical Necessity"), the stage advancer, and finally the
 * item id, which is guaranteed unique and is what a rep would paste into Monday
 * anyway. ⚠️ Never fall through to a bare index: "1" and "2" identify nothing
 * and change order between polls.
 */
export function snapTabLabel(items: readonly DossierItem[], item: DossierItem): string {
  const unique = (pick: (i: DossierItem) => string) => {
    const mine = pick(item).trim();
    if (!mine) return "";
    return items.filter((i) => pick(i).trim() === mine).length === 1 ? mine : "";
  };
  return (
    unique((i) => i.boardName) ||
    unique((i) => i.groupTitle) ||
    unique((i) => i.stageAdvancerText) ||
    `${item.boardName || "Record"} #${item.itemId.slice(-4)}`
  );
}

/** Which step the page opens on: the live one, else the last one reached. */
export function defaultStepIndex(steps: StageStep[]): number {
  const live = steps.findIndex((s) => s.state === "now" || s.state === "stuck");
  if (live >= 0) return live;
  const lastDone = steps.map((s) => s.state).lastIndexOf("done");
  return lastDone >= 0 ? lastDone : 0;
}

export function stepCaption(step: StageStep): string {
  if (step.state === "todo") return "Not started";
  // ⚠️ A stuck GROUP and a stuck PROPOSAL are different facts and are named
  // differently (§5.43): the first is out of the pipeline, the second is a
  // manager decision that has not been made. "Stuck" for both would tell a rep
  // a patient has left when they are sitting in somebody's queue.
  if (step.state === "stuck") {
    const proposed = step.items.some((it) => it.isProposedStuck && !it.isStuck);
    return proposed ? "Stuck proposed — with a manager" : "Stuck";
  }
  if (step.state === "done") return "Completed";
  return step.lead?.stageAdvancerText || step.lead?.groupTitle || "In progress";
}

/**
 * What the chip over a snapshot says about the record on screen.
 *
 * ⚠️ A proposed-stuck record is LIVE — the patient really is here — but saying
 * only "the patient is here now" hides the one fact somebody needs, which is
 * that nothing moves until a manager decides. Completed wins over both: a
 * finished record is a snapshot whatever flag it still carries (§5.18's rule
 * that Completed is checked first, above Stuck).
 */
export function snapStateLabel(item: DossierItem | null): string {
  if (!item) return "";
  if (item.isCompleted) return "Snapshot · as it looked when this stage was left";
  if (item.isStuck) return "Stuck — out of the pipeline until a manager moves them back";
  if (item.isProposedStuck) return "Live — stuck proposed, waiting on a manager's decision";
  return "Live — the patient is here now";
}

/**
 * Where a board record's "Open" goes.
 *
 * ⚠️ **A COMPLETED record opens in REVIEW MODE** — `?completedStage=` is what
 * `useCompletedStageReview` keys off, and it is a WRITE GATE, not a banner flag
 * (§7): without it a rep reading history could re-advance a finished patient,
 * and the advancer is what the board automations fire on. This is §5.38's
 * mechanism; the patient screen is simply a second caller of it.
 *
 * Returns null when the board has no page — an honest dead end, rendered as
 * plain text rather than a link that goes nowhere (§7's `UnworkableRow` rule).
 */
export function itemOpenHref(item: DossierItem | null): string | null {
  if (!item) return null;
  if (!item.isCompleted) {
    return item.route ? `${item.route}?patientId=${item.itemId}&from=patient` : null;
  }
  const route = COMPLETED_STAGE_ROUTES[item.boardId];
  if (!route) return null;
  return `${route}?patientId=${item.itemId}&completedStage=${item.boardId}&from=patient`;
}

export interface InfoFact {
  label: string;
  value: string;
  /** Rendered muted when the board simply has no answer. */
  missing?: boolean;
}

const fact = (label: string, raw: string): InfoFact => ({
  label,
  value: raw.trim() || "—",
  missing: !raw.trim(),
});

/**
 * The onboarding strip, read off the ACTIVE record.
 *
 * ⚠️ **A blank renders as an em dash and is MARKED missing, never as a zero or
 * an invented default.** Missing and empty are different facts everywhere else
 * in this app (§5.31f · §5.31g) and they are different here: a rep reading this
 * strip on a call must be able to tell "nobody has answered that" from "the
 * answer is none".
 */
export function infoFacts(dossier: PatientDossier | null): InfoFact[] {
  const a = dossier?.active ?? null;
  if (!a) return [];
  return [
    fact("Stage", a.stageAdvancerText || a.groupTitle),
    fact("Board", a.boardName),
    fact("Days in stage", a.daysSinceStage),
    fact("Next action", a.nextActionDate),
    fact("DOB", a.dob),
    fact("Phone", a.phone),
  ];
}

/** The top bar's four facts — name · DOB · email · phone, as the mockup has it. */
export function topBarFacts(dossier: PatientDossier | null): InfoFact[] {
  const a = dossier?.active ?? null;
  return [
    fact("Patient name", dossier?.name || a?.name || ""),
    fact("DOB", a?.dob || ""),
    fact("Phone", dossier?.phone || a?.phone || ""),
  ];
}

/** How far along the stepper reads, for the header's one-line summary. */
export function pathSummary(dossier: PatientDossier | null): string {
  if (!dossier) return "";
  const steps = buildStages(dossier);
  const done = steps.filter((s) => s.state === "done").length;
  const live = dossier.active;
  if (live) return `${done} of ${steps.length} stages complete · now on ${live.boardName}`;
  return `${done} of ${steps.length} stages complete`;
}

/**
 * Is this patient on the Subscription board at all?
 *
 * ⚠️ **The rule is the ROW'S EXISTENCE, not its status** (Brandon, 2026-09-18):
 * the row is created at Final Profile Confirmation, so a patient stuck in
 * Insurance whose row was created early can still open it. Reading a status
 * would hide exactly the patient the toggle exists to make reachable.
 */
export function subscriptionItem(dossier: PatientDossier | null): DossierItem | null {
  if (!dossier) return null;
  return dossier.items.find((i) => i.boardId === SUBSCRIPTION_BOARD) ?? null;
}

/** The word under "Subscription" in the view toggle. */
export function subscriptionCaption(item: DossierItem | null): string {
  if (!item) return "Not yet";
  if (item.isStuck) return "Stuck";
  return item.stageAdvancerText || item.groupTitle || "On the board";
}

/** The word under "Onboarding" in the view toggle. */
export function onboardingCaption(dossier: PatientDossier | null): string {
  const steps = buildStages(dossier);
  if (steps.some((s) => s.state === "stuck")) return "Stuck";
  if (steps.every((s) => s.state === "done")) return "Done";
  if (steps.some((s) => s.state === "now")) return "In progress";
  return "Not started";
}
