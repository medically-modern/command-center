/**
 * The patient screen's pure rules (§5.39) — the four-stage stepper, the info
 * strip, the read-only snapshot, and where each "Open" link goes.
 *
 * Everything here reads the dossier the Comms Hub already builds (§5.28). No
 * board read, no write, no second opinion about who a patient is.
 */
import { MANAGER_ORIGIN_PARAM, PIN_DEEP_LINK_PARAM } from "@/lib/shared/managerOrigin";
import type { DossierItem, PatientDossier } from "@/lib/commsHub/dossier";
import { PIPELINE_ORDER } from "@/lib/commsHub/pipelineOrder";
import { COMPLETED_STAGE_ROUTES } from "@/lib/systemMgmt/stageCompletion";
import { intakeProfileHref } from "@/lib/profile/intakeLink";
import { BOARD_ID as PROFILE_SEND_OFF_BOARD } from "@/lib/profile/mondayApi";

/** Query keys the page reads. */
export const VIEW_PARAM = "view";
export const SIDE_PARAM = "side";
export const STEP_PARAM = "step";
export const SNAP_PARAM = "snap";
/**
 * Which SUB-STAGE tool the embedded panel is showing (§5.39c).
 *
 * ⚠️ Separate from `snap`, which names the RECORD (§5.42's per-item tabs) — a
 * stage can hold several records AND several tools, and the two questions have
 * different answers. Brandon's mockup reuses `snap` for the sub-stage because
 * his sample data has one record per stage; ours does not.
 */
export const TOOL_PARAM = "tool";
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

/**
 * Which view the screen OPENS on when the URL names none.
 *
 * ⚠️ Josh, 2026-09-22: *"it should open up to their subscription page if
 * they're on it, and the onboarding tab if subscription profile does not
 * exist"* — which is Brandon's own default (`patientMain`: `q.view || (j.mode
 * === 'subscription' ... ? 'subscription' : 'onboarding')`). A patient who has
 * reached Subscription is being SERVED; the onboarding trail behind them is
 * history, so landing on it and making them press a toggle opens the wrong half
 * of the record.
 *
 * ⚠️ **Keyed on the ROW'S EXISTENCE, never on a status** — the same rule the
 * toggle itself follows (`subscriptionItem`). The row is created at Final
 * Profile Confirmation, so a patient stuck in Insurance whose row was created
 * early still lands on it; reading a status would send exactly the patient the
 * view exists for to the other tab.
 *
 * ⚠️ An explicit `?view=` always wins, or a link naming a view would not open
 * it and Back would not restore it.
 */
export function defaultView(dossier: PatientDossier | null): PatientView {
  return subscriptionItem(dossier) ? "subscription" : "onboarding";
}

/** The view to render: what the URL says, else what the record implies. */
export function viewFor(raw: string | null, dossier: PatientDossier | null): PatientView {
  return raw === null || raw === "" ? defaultView(dossier) : parseView(raw);
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
  /* "Medical Evaluation" — Brandon's name for the stage, and the board's own
     (pixel-match Phase 2; Josh, 2026-09-24: "medical eval … yes go forward").
     It was "Medical Necessity" until then. ⚠️ The Communications Inbox's stage
     pill still says "Medical Necessity": that word comes from the gateway
     (`commsInboxRules.STAGE_PILLS`), and Communications is left as it is. */
  { key: "mn", label: "Medical Evaluation", boards: [18406060017] },
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
 * Brandon's stamp chip over the snapshot (pixel-match Phase 2): green
 * "Snapshot · as it looked when … was left" or blue "Live — the patient is
 * here now", in his colours, with `snapStateLabel`'s words.
 *
 * ⚠️ One case his sample data never meets, and ours does every day: a LIVE
 * record opened on a step the patient has already passed. It is not a
 * snapshot — Monday keeps no per-step history, so the values are today's — and
 * it is not where the patient is, so neither of his two chips is true of it.
 * It says "Live record · today's values", and the line under the tool carries
 * the rest (§5.38's per-board granularity).
 */
export interface SnapStamp {
  tone: "green" | "blue" | "amber" | "red";
  icon: "check" | "live" | "alert";
  text: string;
}

export function snapStamp(
  item: DossierItem | null,
  tool: { current: boolean; passed: boolean } | null,
): SnapStamp | null {
  if (!item) return null;
  if (item.isCompleted) return { tone: "green", icon: "check", text: snapStateLabel(item) };
  if (item.isStuck) return { tone: "red", icon: "alert", text: snapStateLabel(item) };
  if (item.isProposedStuck) return { tone: "amber", icon: "alert", text: snapStateLabel(item) };
  if (tool && !tool.current && tool.passed) return { tone: "blue", icon: "live", text: "Live record · today's values" };
  return { tone: "blue", icon: "live", text: snapStateLabel(item) };
}

/**
 * The line under Brandon's stage heading: how many steps, where the stage
 * stands, and what the tool below is showing.
 *
 * ⚠️ His says "each sub-stage below is the tool as it looked when the patient
 * left it" for every stage. That is true of a COMPLETED record only — a live
 * one shows today's values (§5.38) — so the tail follows the record.
 */
export function stageSubline(
  step: StageStep,
  subStepCount: number,
  item: DossierItem | null,
): string {
  const where =
    step.state === "done" ? "all complete"
      : step.state === "todo" ? "not started"
        : step.state === "stuck" ? stepCaption(step).toLowerCase()
          : "in progress";
  const count = subStepCount > 1 ? `${subStepCount} steps` : "";
  const tail = !item
    ? ""
    : item.isCompleted
      ? "the tool below is as the patient left it — read-only"
      : "the tool below shows today's values — read-only";
  return [count, where, tail].filter(Boolean).join(" · ");
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
/**
 * ⚠️ An ESCALATED record opens its tool in MANAGER mode (Brandon, 2026-10-02, via Onboarding Oversight: a manager
 * clicking a patient in their escalation list reached the plain queue page and got "This patient isn't in this
 * list"). Same params Pipeline Oversight and System Management search already send (`searchOpenUrl`), so all three
 * doors open the same screen: Manager Intervention for the manager rung, Final Decisions for the final rung.
 */
export function managerModeParams(item: DossierItem | null): string {
  if (!item || item.isCompleted || !item.escalationLevel) return "";
  const p = new URLSearchParams();
  p.set(MANAGER_ORIGIN_PARAM, item.escalationLevel === "final" ? "final-decisions" : "manager-intervention");
  p.set("manager", "1"); p.set("escalated", "1"); p.set(PIN_DEEP_LINK_PARAM, "1");
  return `&${p.toString()}`;
}

export function itemOpenHref(item: DossierItem | null): string | null {
  if (!item) return null;
  if (!item.isCompleted) {
    /* ⚠️ Profile Send Off is FOUR queues on one board, and which one a link
       opens is decided by the GROUP, not by the board's default route. The
       intake page reads `?source=` and defaults to **completed**, so a Partial
       Leads patient linked without it opens under the Completed selector — the
       chrome calls an abandoned form a successful one, and the patient is not
       in the list that was fetched. `intakeProfileHref` is the one builder for
       that (Jason Ortiz-Troxell, 2026-09-25); this call site was missed, and
       Mary Terrell (12895923748, Partial Leads) hit it again on 2026-09-30.
       Every other board has one route per item, so they are unchanged. */
    if (item.boardId === PROFILE_SEND_OFF_BOARD) {
      return intakeProfileHref(item.itemId, item.groupId, `from=patient${managerModeParams(item)}`);
    }
    return item.route ? `${item.route}?patientId=${item.itemId}&from=patient${managerModeParams(item)}` : null;
  }
  const route = COMPLETED_STAGE_ROUTES[item.boardId];
  if (!route) return null;
  return `${route}?patientId=${item.itemId}&completedStage=${item.boardId}&from=patient`;
}

/**
 * The same link, aimed at ONE sub-stage's tool (§5.39c).
 *
 * ⚠️ **`itemOpenHref`'s route is the board's default tool**, which is right for
 * a record with no sub-stage toggle and wrong the moment there is one: a
 * manager reading the Confirm Receipt panel who presses Open expects Confirm
 * Receipt, not Evaluate. The item id and the `completedStage` gate are
 * unchanged — only the route moves — so a completed record still opens in
 * review mode (§5.38) whichever tool it opens.
 *
 * ⚠️ Returns null for a sub-stage with no page (Auth Denied, §7), so the caller
 * renders plain text rather than a dead link.
 */
export function subStageOpenHref(item: DossierItem | null, route: string): string | null {
  if (!item || !route) return null;
  const tail = item.isCompleted ? `&completedStage=${item.boardId}` : "";
  return `${route}?patientId=${item.itemId}${tail}&from=patient${managerModeParams(item)}`;
}

export interface InfoFact {
  label: string;
  value: string;
  /** Rendered muted when the board simply has no answer. */
  missing?: boolean;
  /** This fact carries an edit pencil (§5.46g). The control and the write live
   *  in `components/patient/TopBarContact` and `lib/patient/contactEdit`; this
   *  is only which of the two it is. */
  field?: "phone" | "email";
}

const fact = (label: string, raw: string): InfoFact => ({
  label,
  value: raw.trim() || "—",
  missing: !raw.trim(),
});

/*
 * ⚠️ **`infoFacts` lived here and is GONE (§5.46f).** It returned Stage · Board
 * · Days in stage · Next action · DOB · Phone — six facts, of which only one
 * was Brandon's, and two of them (DOB and Phone) restated the top bar one row
 * above. The strip is now `lib/patient/infoStrip.ts`' eight, read across the
 * patient's records rather than off the active one. Do not re-add a second
 * strip builder here: the whole point is that one module owns those ids.
 */

/**
 * The top bar's four facts — name · DOB · email · phone, as the mockup has it.
 *
 * ⚠️ **The email is passed IN rather than read here**, because reading it means
 * `contactEdit`, which reads `infoStrip`, which reads this module — a cycle ES
 * modules tolerate right up until one side reads the other at init time and
 * gets `undefined`. The caller holds both and hands over the string.
 *
 * ⚠️ It really is four now. The comment said four and the function returned
 * THREE from the day it shipped until 2026-09-22 (§5.46g), which is how Email
 * stayed missing from a card whose own doc named it.
 */
export function topBarFacts(dossier: PatientDossier | null, email = ""): InfoFact[] {
  const a = dossier?.active ?? null;
  return [
    fact("Patient name", dossier?.name || a?.name || ""),
    fact("DOB", a?.dob || ""),
    { ...fact("Email", email), field: "email" },
    { ...fact("Phone", dossier?.phone || a?.phone || ""), field: "phone" },
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

/**
 * The Subscription board's Subscription Status column — Active · Paused · Not
 * Active. Declared here rather than imported from `subscriptionOverview`
 * (`OVERVIEW_COLS.status`), because that module imports `infoStrip`, which
 * imports this one: the import back would be a cycle. `patientScreen.test.ts`
 * pins the two ids equal.
 */
export const SUBSCRIPTION_STATUS_COL = "color_mm2t7tdy";

/**
 * The word under "Subscription" in the view toggle.
 *
 * ⚠️ **The subscription STATUS first** (Brandon's pixel-match item 2,
 * 2026-09-24: *"the Subscription toggle chip shows the subscription status
 * ("Active"), not the group name"*) — the group is "Subscriptions" for nearly
 * everybody, so it said nothing. A blank status falls back to what it said
 * before, never to an invented "Active".
 */
export function subscriptionCaption(item: DossierItem | null): string {
  if (!item) return "Not yet";
  if (item.isStuck) return "Stuck";
  const status = (item.cols?.[SUBSCRIPTION_STATUS_COL] ?? "").trim();
  return status || item.stageAdvancerText || item.groupTitle || "On the board";
}

/**
 * The word under "Onboarding" in the view toggle — Brandon's `vtoggle`:
 * *In progress* · *Lead* · *Done 4/21/2026*.
 *
 * The date and the lead verdict are handed in by the caller
 * (`infoStrip.onboardingCompletedOn` / `isWebFormLead`) rather than read here,
 * because `infoStrip` imports this module and the reverse would be a cycle.
 * ⚠️ They are the SAME readings the info strip prints, so the toggle and the
 * strip's Stage fact cannot disagree about one patient on one card.
 */
export function onboardingCaption(
  dossier: PatientDossier | null,
  opts: { completedOn?: string; lead?: boolean } = {},
): string {
  const steps = buildStages(dossier);
  if (steps.some((s) => s.state === "stuck")) return "Stuck";
  if (steps.every((s) => s.state === "done")) return opts.completedOn ? `Done ${opts.completedOn}` : "Done";
  if (opts.lead) return "Lead";
  if (steps.some((s) => s.state === "now")) return "In progress";
  return "Not started";
}
