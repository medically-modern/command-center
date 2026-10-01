/**
 * Remove from Stuck — a manager undoing a Stuck, from the patient screen
 * (Brandon, 2026-10-01: *"add a Remove from Stuck button to the patient profile
 * page, which undo's a stuck … only managers"*; Josh: *"automatically any one
 * with manager privilege gets that button … with a notif that it successfully
 * sent to monday"*). CLAUDE.md §5.57.
 *
 * Pure. The Monday reads and writes live in `removeFromStuckApi.ts`; what a
 * board's Stuck MEANS, and what putting a patient back WRITES, is here so it can
 * be tested without a board.
 *
 * ⚠️⚠️ **"BACK" IS WHERE MONDAY SAYS THEY WERE, NEVER A GUESS.** Being Stuck is
 * a group (§5.18), and nothing on the item remembers the group it left. The
 * item's own ACTIVITY LOG does: moving into Stuck is a `move_pulse_from_group`
 * event carrying `source_group`, and on the three boards whose Stuck is an
 * advancer label, the advancer change into it carries `previous_value`.
 * `stuckOriginFromLog` reads both. When the log has no such event — the April
 * import put items straight into Stuck, so the oldest rows have none — the
 * manager picks the stage; nothing is preselected on a hunch.
 *
 * ⚠️⚠️ **EVERY WRITE BELOW WAS CHECKED AGAINST THE BOARD'S LIVE AUTOMATIONS
 * (2026-10-01, `list_automations` on all four boards).** What each target sets
 * off is said in its `caveat`, which the confirm panel shows before the press.
 * Label ids are read off each column's `settings_str` the same day — never
 * inferred (§9).
 *
 *   · **Welcome Call, the Welcome Call step: the advancer is CLEARED, never set
 *     back to "Welcome Call" (7).** A change to 7 runs seven "set Autotext Type"
 *     workflows (7918358649 … 7920267249), and Autotext Type is what the board's
 *     welcome texts fire on (573200740 … 603174271: *"YOUR CGM IS APPROVED AND
 *     READY FOR SHIPMENT …"*). Writing 7 back could text the patient their
 *     welcome message a second time. The Welcome Call queue reads the GROUP
 *     (`welcomeCall/mondayApi` `GROUPS.welcomeCall`), so nothing needs the 7;
 *     the rep's Send writes "Review Profile" from blank exactly as it does
 *     from 7. And it is cleared ONLY while it still says "Stuck / Don't
 *     Proceed" — an item dragged into Stuck by hand kept its "Welcome Call",
 *     and that is left alone.
 *   · ⚠️ That clear is NOT §9's forbidden "repair by clearing the advancer".
 *     That rule is about an advancer that already FIRED — the downstream item
 *     exists, so the next press makes a duplicate. "Stuck / Don't Proceed"
 *     creates nothing downstream; it only moves the item to the Stuck group.
 *   · **Medical Evaluation and Insurance: the advancer IS the queue**
 *     (sub-stage / stage), so it is written back to the step they left, and
 *     that runs the same board automations an ordinary arrival there does —
 *     named in each caveat.
 *   · **Profile Send Off: the group is the whole marker** (§5.10 — its Move to
 *     Onboarding column has no Stuck label), so only the group moves.
 *     ⚠️ Its `stuck reason` text column is NEVER written here: automation
 *     7918293476 moves the item INTO Stuck on any change to it, so clearing
 *     the old reason would put the patient straight back.
 *
 * ⚠️ **The Escalation column is not touched.** Approving a Stuck already set it
 * to Done (Welcome Call, Medical Evaluation) or blank (Insurance), which is
 * what puts the patient in the rep's queue rather than back in Final
 * Decisions. Restoring the "Final Escalation Required" they carried before the
 * approval would undo the manager's decision as well as the Stuck.
 */

/** What happens to the board's Stage Advancer when a patient goes back. */
export type AdvancerAction =
  /** Write this label id — the step's own arrival value. */
  | { kind: "write"; index: number }
  /** Clear it, but only while it still says the board's Stuck label. */
  | { kind: "clearIfStuck" }
  /** The board has no advancer that means Stuck (Profile Send Off). */
  | { kind: "none" };

export interface StuckTarget {
  /** Stable key, used by the picker. */
  key: string;
  /** What the manager reads — the stage's own name on the board. */
  label: string;
  /** The working group the item goes back to. */
  groupId: string;
  advancer: AdvancerAction;
  /**
   * The Stage Advancer label ids that mean "this step" in an activity-log
   * entry, for matching the log's `previous_value`. Empty when the step is
   * not told apart by the advancer (Profile Send Off).
   */
  advancerIndexes: readonly number[];
  /** What else Monday does when the patient lands here — shown before the press. */
  caveat?: string;
}

export interface StuckPlan {
  boardId: number;
  boardName: string;
  /** The board's Stuck group. */
  stuckGroupId: string;
  /** Stage Advancer column, or null where Stuck is a group only. */
  advancerColId: string | null;
  /** The advancer label id that means Stuck, or null. */
  stuckAdvancerIndex: number | null;
  /** …and its text, exactly as the board spells it. */
  stuckAdvancerText: string;
  /**
   * Which half of the log decides the step. The GROUP where the queue reads
   * the group (Welcome Call, Profile Send Off); the ADVANCER where it reads the
   * advancer — every Medical Evaluation step shares one group, and an
   * Insurance DVS item lingers in whichever group an automation last left it
   * (§3), so its group says nothing.
   */
  matchBy: "group" | "advancer";
  targets: readonly StuckTarget[];
}

const WC_BOARD = 18410804557;
const ME_BOARD = 18406060017;
const INS_BOARD = 18410601299;
const PSO_BOARD = 18406352652;

/**
 * One entry per board the app can mark Stuck. DTC Intake has Stuck groups too,
 * but it is read-only here (§3) — no plan, so no button.
 *
 * ⚠️ Group ids are reused across boards (§5.18) — `group_mm1xyczx` is Stuck on
 * three of these, and `group_mm1xf2jb` is "1. Intake" on Profile Send Off and
 * "2. Medical Necessity" on Medical Evaluation — so every lookup is by board
 * first. `removeFromStuck.test.ts` pins these ids against the role modules'
 * own `GROUPS` and `STUCK_GROUP_IDS`.
 */
export const STUCK_PLANS: Readonly<Record<number, StuckPlan>> = {
  [WC_BOARD]: {
    boardId: WC_BOARD,
    boardName: "Welcome Call",
    stuckGroupId: "group_mm1xyczx",
    advancerColId: "color_mm1ws96t",
    stuckAdvancerIndex: 2,
    stuckAdvancerText: "Stuck / Don't Proceed",
    matchBy: "group",
    targets: [
      {
        key: "welcomeCall",
        label: "Welcome Call",
        groupId: "group_mm1wvq8p",
        advancer: { kind: "clearIfStuck" },
        advancerIndexes: [7],
        caveat:
          "The Stage Advancer is cleared rather than set back to “Welcome Call” — setting it re-runs the board's welcome-text automations.",
      },
      {
        key: "finalConfirm",
        label: "Final Profile Confirmation",
        groupId: "group_mm2x8jtj",
        // "Review Profile" — its only automations (7918322147/7918322163) move
        // the item to Final Profile Confirmation, where it is going anyway.
        advancer: { kind: "write", index: 0 },
        advancerIndexes: [0],
      },
    ],
  },
  [ME_BOARD]: {
    boardId: ME_BOARD,
    boardName: "Medical Evaluation",
    stuckGroupId: "group_mm1xyczx",
    advancerColId: "color_mm1wyr92",
    stuckAdvancerIndex: 15,
    stuckAdvancerText: "Stuck",
    matchBy: "advancer",
    // Every step is the one group "2. Medical Necessity"; the sub-stage tells
    // them apart (masheke/mondayMapping SUB_STAGE_INDEX).
    targets: [
      {
        key: "evaluate",
        label: "Evaluate MN",
        groupId: "group_mm1xf2jb",
        advancer: { kind: "write", index: 8 },
        advancerIndexes: [8],
        caveat: "Monday sets MN Attempts back to Attempt 1 and adds one to the Evaluation Counter, as on any arrival at Evaluate MN.",
      },
      {
        key: "sendRequest",
        label: "Send Request",
        groupId: "group_mm1xf2jb",
        advancer: { kind: "write", index: 9 },
        advancerIndexes: [9],
      },
      {
        key: "confirmReceipt",
        label: "Confirm Receipt",
        groupId: "group_mm1xf2jb",
        advancer: { kind: "write", index: 10 },
        advancerIndexes: [10],
      },
      {
        key: "chase",
        label: "Chase Clinicals",
        groupId: "group_mm1xf2jb",
        advancer: { kind: "write", index: 11 },
        advancerIndexes: [11],
        caveat: "Monday sets MN Attempts back to Attempt 1, as on any arrival at Chase Clinicals.",
      },
      {
        key: "doctorAppointment",
        label: "Doctor Appointment",
        groupId: "group_mm1xf2jb",
        advancer: { kind: "write", index: 0 },
        advancerIndexes: [0],
      },
    ],
  },
  [INS_BOARD]: {
    boardId: INS_BOARD,
    boardName: "Insurance",
    stuckGroupId: "group_mm5g7twt",
    advancerColId: "color_mm1ws96t",
    stuckAdvancerIndex: 2,
    stuckAdvancerText: "Stuck / Don't Proceed",
    matchBy: "advancer",
    targets: [
      {
        key: "benefits",
        label: "Benefits / SoS",
        groupId: "group_mm1xr3q3",
        advancer: { kind: "write", index: 3 },
        advancerIndexes: [3],
        caveat:
          "Monday's Benefits automations run again, as on any arrival — for some Medicaid patients they mark the auths Required and move the patient on to DVS.",
      },
      {
        key: "submitAuth",
        label: "Submit Auth.",
        groupId: "group_mm1x1416",
        advancer: { kind: "write", index: 4 },
        advancerIndexes: [4],
      },
      {
        key: "authOutstanding",
        label: "Auth. Outstanding",
        groupId: "group_mm2v6d1z",
        advancer: { kind: "write", index: 6 },
        advancerIndexes: [6],
      },
      {
        key: "dvs",
        label: "DVS",
        groupId: "group_mm5gp2r2",
        advancer: { kind: "write", index: 1 },
        advancerIndexes: [1],
        caveat: "Monday's DVS automations run again, which triggers the DVS check again.",
      },
      {
        key: "authDenied",
        label: "Auth Denied",
        groupId: "group_mm316hg2",
        advancer: { kind: "write", index: 0 },
        advancerIndexes: [0],
      },
    ],
  },
  [PSO_BOARD]: {
    boardId: PSO_BOARD,
    boardName: "Profile Send Off",
    stuckGroupId: "group_mm1xyczx",
    advancerColId: null,
    stuckAdvancerIndex: null,
    stuckAdvancerText: "",
    matchBy: "group",
    targets: [
      { key: "intake", label: "1. Intake", groupId: "group_mm1xf2jb", advancer: { kind: "none" }, advancerIndexes: [] },
      {
        key: "alreadyInSystem",
        label: "Already In System",
        groupId: "group_mm64b83h",
        advancer: { kind: "none" },
        advancerIndexes: [],
      },
      {
        key: "partialLeads",
        label: "New Form — Partial Leads",
        groupId: "group_mm5z87zt",
        advancer: { kind: "none" },
        advancerIndexes: [],
      },
      {
        key: "completedForms",
        label: "New Form — Completed",
        groupId: "group_mm5zgeak",
        advancer: { kind: "none" },
        advancerIndexes: [],
        caveat: "Moving a patient into this group sends Monday's webhook for it (automation 625896293), as a newly completed form does.",
      },
      {
        key: "cleanUp",
        label: "Profile Clean-Up",
        groupId: "group_mm6c3rhb",
        advancer: { kind: "none" },
        advancerIndexes: [],
      },
    ],
  },
};

export function stuckPlanFor(boardId: number): StuckPlan | null {
  return STUCK_PLANS[boardId] ?? null;
}

/**
 * Is this record Stuck in a way this button can undo?
 *
 * ⚠️ **The group OR the advancer**, not the group alone. The writer moves the
 * group first and the advancer second (see `removeFromStuckApi`), so a write
 * that fails between the two leaves an item in a working group still saying
 * "Stuck" — in no queue on Medical Evaluation or Insurance, where the queue is
 * the advancer. Reading the group alone would hide the button on exactly the
 * record that needs a second press. A COMPLETED record is never offered it.
 */
export function canRemoveFromStuck(item: {
  boardId: number;
  groupId: string;
  stageAdvancerText: string;
  isCompleted: boolean;
}): boolean {
  const plan = stuckPlanFor(item.boardId);
  if (!plan || item.isCompleted) return false;
  if (item.groupId === plan.stuckGroupId) return true;
  return !!plan.stuckAdvancerText && (item.stageAdvancerText || "").trim() === plan.stuckAdvancerText;
}

/** One row of Monday's `activity_logs`, as the API returns it (`data` is JSON text). */
export interface ActivityLogEntry {
  event: string;
  created_at: string;
  data: string;
}

/** Where the activity log says the patient was just before Stuck. */
export interface StuckOrigin {
  /** The group they were moved out of, when the log has the move. */
  fromGroupId: string | null;
  fromGroupTitle: string;
  /** The advancer label they had, when the log has that change. */
  fromAdvancerIndex: number | null;
  fromAdvancerText: string;
}

/** `created_at` is a 17-digit tick count — too big for a Number to order safely. */
function newestFirst(a: ActivityLogEntry, b: ActivityLogEntry): number {
  try {
    const x = BigInt(a.created_at);
    const y = BigInt(b.created_at);
    return x === y ? 0 : x > y ? -1 : 1;
  } catch {
    return b.created_at.localeCompare(a.created_at);
  }
}

function parse(data: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(data);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function labelOf(v: unknown): { index: number | null; text: string } {
  const label = (v as { label?: { index?: unknown; text?: unknown } } | null)?.label;
  const index = typeof label?.index === "number" ? label.index : null;
  return { index, text: typeof label?.text === "string" ? label.text : "" };
}

/**
 * Read the activity log for the patient's last way INTO Stuck.
 *
 * ⚠️ The NEWEST entry wins: a patient stuck, returned and stuck again goes back
 * to where they were the second time. Returns null when the log holds neither
 * a move into Stuck nor an advancer change to it.
 */
export function stuckOriginFromLog(plan: StuckPlan, entries: readonly ActivityLogEntry[]): StuckOrigin | null {
  const sorted = [...entries].sort(newestFirst);
  let move: { id: string; title: string } | null = null;
  let adv: { index: number | null; text: string } | null = null;

  for (const e of sorted) {
    if (move && (adv || !plan.advancerColId)) break;
    const d = parse(e.data);
    if (!d) continue;
    if (!move && e.event.startsWith("move_pulse")) {
      const dest = d.dest_group as { id?: unknown } | undefined;
      const src = d.source_group as { id?: unknown; title?: unknown } | undefined;
      if (dest?.id === plan.stuckGroupId && typeof src?.id === "string" && src.id !== plan.stuckGroupId) {
        move = { id: src.id, title: typeof src.title === "string" ? src.title : "" };
      }
      continue;
    }
    if (!adv && plan.advancerColId && e.event === "update_column_value" && d.column_id === plan.advancerColId) {
      if (labelOf(d.value).index === plan.stuckAdvancerIndex) adv = labelOf(d.previous_value);
    }
  }

  if (!move && !adv) return null;
  return {
    fromGroupId: move?.id ?? null,
    fromGroupTitle: move?.title ?? "",
    fromAdvancerIndex: adv?.index ?? null,
    fromAdvancerText: adv?.text ?? "",
  };
}

/**
 * The step the log points at, or null — in which case the manager picks.
 *
 * Asks the plan's own half first (`matchBy`), then the other: a Welcome Call
 * item dragged into Stuck by hand has the move but no advancer change, and an
 * Insurance item stuck by its advancer has both.
 */
export function targetFromOrigin(plan: StuckPlan, origin: StuckOrigin | null): StuckTarget | null {
  if (!origin) return null;
  const byGroup = () =>
    origin.fromGroupId ? plan.targets.find((t) => t.groupId === origin.fromGroupId) ?? null : null;
  const byAdvancer = () =>
    origin.fromAdvancerIndex !== null
      ? plan.targets.find((t) => t.advancerIndexes.includes(origin.fromAdvancerIndex as number)) ?? null
      : null;
  // ⚠️ On Medical Evaluation every step shares one group, so a group match
  // there would pick the FIRST step for everybody — the advancer is the only
  // answer, and its absence means "ask".
  if (plan.matchBy === "advancer") {
    const hit = byAdvancer();
    if (hit) return hit;
    const groupHit = byGroup();
    return groupHit && plan.targets.filter((t) => t.groupId === groupHit.groupId).length === 1 ? groupHit : null;
  }
  return byGroup() ?? byAdvancer();
}

/**
 * What the advancer write should be for this target, given what it says now.
 * Null means "leave it alone".
 */
export function advancerWrite(
  plan: StuckPlan,
  target: StuckTarget,
  currentText: string,
): { index: number } | { clear: true } | null {
  if (!plan.advancerColId) return null;
  const a = target.advancer;
  if (a.kind === "write") return { index: a.index };
  if (a.kind === "clearIfStuck") return (currentText || "").trim() === plan.stuckAdvancerText ? { clear: true } : null;
  return null;
}

/** Still stuck, by the read-back? Group first, then the advancer label. */
export function stillStuck(plan: StuckPlan, groupId: string, advancerText: string): boolean {
  if (groupId === plan.stuckGroupId) return true;
  return !!plan.stuckAdvancerText && (advancerText || "").trim() === plan.stuckAdvancerText;
}
