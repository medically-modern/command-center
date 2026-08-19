/**
 * Profile Status — the one status every role shows for every patient.
 *
 * WHY IT EXISTS (Josh, 2026-08-19). Every stage in this app has its own idea of
 * "what is going on with this patient": masheke reads an escalation INDEX,
 * Insurance reads an escalation LABEL, Profile Send Off reads a flag column,
 * three boards call being asleep `Follow Up = "Done"` while Insurance calls it
 * `Follow Up = "Follow Up"` with a blank date, and being Stuck is not a column
 * at all — it is which GROUP the item sits in. A manager looking at a patient
 * on one role page could not tell, without knowing all of that, whether anybody
 * was working them. Profile Status collapses all of it into ONE vocabulary that
 * means the same thing on every page:
 *
 *   Stuck · Proposed Stuck · Escalated · Paused · Waiting · Active
 *
 * ── THIS FILE IS THE RULE. ──
 * Every page resolves its badge here. The per-board adapters at the bottom
 * translate that board's column vocabulary into `ProfileStatusInput`; they
 * decide NOTHING — every judgement lives in `profileStatus()` so the eleven
 * role pages cannot drift the way §5.9/§5.10 splits historically did.
 *
 * ── PRECEDENCE (first match wins) ──
 * The order is the order Josh defined the statuses in, and it matters: a
 * patient is routinely eligible for several at once (an escalated patient
 * snoozed to next Tuesday is Escalated, not Waiting — the manager flag is the
 * fact somebody needs to act on).
 *
 *   1. Stuck         — the item is in a board's Stuck group.
 *   2. Proposed Stuck— escalation index 2, "Final Escalation Required".
 *   3. Escalated     — escalation index 0, "Manager Escalation Required".
 *   4. Paused        — parked with no clock that will wake them up (below).
 *   5. Waiting       — a Next Action / Follow Up Date in the future.
 *   6. Active        — everything else.
 *
 * ── NO STATUS AT ALL (`null`) ──
 * Two populations get no badge rather than a wrong one:
 *
 *   - **Completed** items. Checked FIRST, above Stuck: the patient has moved to
 *     the next board and this item is history, so a live-looking badge on it
 *     would be a lie. (Search's completion badges deep-link into finished
 *     stages — CLAUDE.md §7 — so role pages really do render these.)
 *   - **Auth Denied**. Checked LAST, and it only suppresses *Active*: the stage
 *     is deliberately unbuilt (§7, "do NOT build UI for it"), so the app has no
 *     honest Active story for them — but ANY denial escalates, and an escalated
 *     denied patient is a manager's live work, so rungs 1–5 still report.
 *
 * That asymmetry is deliberate. Completed = "nothing here is actionable".
 * Auth Denied = "the patient is live, this stage just has no UI yet".
 */

/* ── The vocabulary ──────────────────────────────────────────── */

export type ProfileStatus =
  | "stuck"
  | "proposedStuck"
  | "escalated"
  | "paused"
  | "waiting"
  | "active";

/** Display text. The badge renders these verbatim. */
export const PROFILE_STATUS_LABEL: Record<ProfileStatus, string> = {
  stuck: "Stuck",
  proposedStuck: "Proposed Stuck",
  escalated: "Escalated",
  paused: "Paused",
  waiting: "Waiting",
  active: "Active",
};

/** Severity order, worst first — for sorting or picking a summary status. */
export const PROFILE_STATUS_ORDER: readonly ProfileStatus[] = [
  "stuck",
  "proposedStuck",
  "escalated",
  "paused",
  "waiting",
  "active",
];

/* ── Board facts the rule keys on ────────────────────────────── */

/**
 * Every Stuck group on every board.
 *
 * Being Stuck is NOT a column — no board has a "Stuck" label on its stage
 * advancer (§5.10 says so explicitly for Profile Send Off: "the group is the
 * only marker"), so membership is the whole signal.
 *
 * ⚠️ Group IDs are NOT globally unique — Monday reuses them across boards.
 * `group_mm1xyczx` is the Stuck group on Medical Evaluation, Welcome Call AND
 * Profile Send Off, which is why one id covers three boards here. It cuts the
 * other way too: `group_mkp19fyp` is "Bad Debt" on Secondary Claims and "Not
 * Active Patients" on Subscription. So a set of ids can only be trusted while
 * nothing outside it shares an id — `profileStatus.test.ts` asserts this set
 * against the live `BOARDS` registry in both directions, and will fail if a
 * board grows a Stuck group that isn't listed here. That check is the point:
 * a list that must be updated when a board changes will not be (§5.10).
 */
export const STUCK_GROUP_IDS: readonly string[] = [
  "group_mm1xyczx", // Medical Evaluation · Welcome Call · Profile Send Off — "Stuck"
  "group_mm5g7twt", // Insurance — "Stuck"
  "group_mkyw7wy8", // DTC Intake — "Stuck Final Review"
  "group_mkzcc2wg", // DTC Intake — "Can't Proceed / Stuck"
];

/**
 * Every Completed group on every board — the `isCompleted: true` rows of
 * `BOARDS`. Mirrored here so this module stays free of systemMgmt imports;
 * the test pins the two together.
 */
export const COMPLETED_GROUP_IDS: readonly string[] = [
  "group_mkzcb7bx", // DTC Intake — "Ordered"
  "group_mkxsng4r", // Secondary Claims — "Paid And Closed"
  "group_mm1y57sz", // Profile Send Off — "Completed"
  "group_mm1x5q4e", // Medical Evaluation — "Completed"
  "group_mm2vw3c0", // Insurance — "Completed"
  "group_mm1x5s5d", // Welcome Call — "Completed"
];

/**
 * Escalation status indices, shared by every board that has the column
 * (Medical Evaluation + Welcome Call `color_mm1x7997`, Insurance
 * `color_mm2vsh2f`). Index, not label: the labels were renamed in 2026-07 and
 * matching on text silently dropped everyone (masheke/mondayMapping).
 */
export const ESCALATION_INDEX = { manager: 0, done: 1, final: 2 } as const;

/** Label fallback, for the boards whose mapping only carries text. */
const MANAGER_LABELS = ["manager escalation required", "escalation required", "escalate"];
const FINAL_LABELS = ["final escalation required"];

/** Sub-Stage label that IS the Doctor Appointments outreach queue (§5.12). */
export const DOCTOR_APPOINTMENT_SUB_STAGE = "Doctor Appointment";

/** Stage Advancer text for the unbuilt Auth Denied stage (§7). */
export const AUTH_DENIED_STAGE = "Auth Denied";

/* ── Input ───────────────────────────────────────────────────── */

/**
 * How a board's Follow Up STATUS column encodes "asleep with no date".
 *
 * - `"done"`        — Profile Send Off · Welcome Call · Final Confirm. The
 *                     column's index 1 is labelled "Done" and is used as the
 *                     follow-up marker (welcomeCall/sidebarList).
 * - `"followUp"`    — Insurance. `Follow Up` + a blank date is an INDEFINITE
 *                     snooze ("a dateless Follow Up stays snoozed until
 *                     cleared" — samantha/sidebarList `isSnoozedFollowUp`).
 *                     With a date it is an ordinary snooze, so the date rule
 *                     below handles it and this contributes nothing.
 * - `"none"`        — Patient Intake, which deliberately has no snooze at all
 *                     (§5.10), and any board whose column nothing reads.
 */
export type FollowUpRule = "done" | "followUp" | "none";

export interface ProfileStatusInput {
  /** Board group the item sits in — the ONLY marker for Stuck and Completed. */
  groupId?: string | null;
  /**
   * Force the completed carve-out without a group id. Role pages opened from a
   * Search completion badge pass `?completedStage=<boardId>` and render an item
   * that already left the stage (§7) — `useCompletedStageReview` is that flag.
   */
  completed?: boolean;
  /** Stage Advancer text. Only `Auth Denied` changes the outcome. */
  stage?: string | null;
  /** Escalation status INDEX — 0 manager, 1 done, 2 final. Preferred. */
  escalationIndex?: number | null;
  /** Escalation label, for boards whose mapping only carries text. */
  escalationLabel?: string | null;
  /** Sub-Stage text (Medical Evaluation board). */
  subStage?: string | null;
  /** Doctor Appointment date (`date_mm5w2vsf`), YYYY-MM-DD. */
  appointmentDate?: string | null;
  /** Already In System flag (`color_mm2xe7r8`) — "Yes" ⇒ Paused. */
  alreadyInSystem?: string | null;
  /** Next Action Date, or the board's Follow Up Date. YYYY-MM-DD. */
  nextActionDate?: string | null;
  /** Follow Up STATUS column text. */
  followUp?: string | null;
  /** Which vocabulary `followUp` uses. Defaults to `"none"`. */
  followUpRule?: FollowUpRule;
}

/* ── Helpers ─────────────────────────────────────────────────── */

/** YYYY-MM-DD for "today" in Eastern Time. Monday's dates are naive ET (§9). */
export function etTodayYmd(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Normalise a Monday date cell to YYYY-MM-DD, or "" when absent. */
const ymd = (v?: string | null): string => (v ?? "").trim().slice(0, 10);

/**
 * Which escalation rung — index first, label as the safety net.
 *
 * Index first because labels get renamed: the 2026-07 rename silently dropped
 * every escalation from anything matching on text (masheke/mondayMapping).
 *
 * ⚠️ But an index we do NOT recognise falls through to the label rather than
 * reading as "not escalated". Monday assigns a status index when the label is
 * created and picks the lowest free slot, NOT display order — §5.12's Sub-Stage
 * `Doctor Appointment` landed on 0 while that column's other labels start at 8.
 * So a board whose escalation labels were created in a different order would
 * quietly mark escalated patients Active, and an escalation that reads Active is
 * the one failure mode this badge exists to prevent. Index 1 ("Done") is the one
 * index that stops the search: it is a positive statement that the patient is
 * NOT escalated, and must beat a stale label.
 */
function escalationRung(input: ProfileStatusInput): "manager" | "final" | null {
  const idx = input.escalationIndex;
  if (idx === ESCALATION_INDEX.final) return "final";
  if (idx === ESCALATION_INDEX.manager) return "manager";
  if (idx === ESCALATION_INDEX.done) return null;

  const label = (input.escalationLabel ?? "").trim().toLowerCase();
  if (!label) return null;
  if (FINAL_LABELS.includes(label)) return "final";
  if (MANAGER_LABELS.includes(label)) return "manager";
  return null;
}

/**
 * Parked with nothing that will wake them up.
 *
 * Four ways in, and they share one property: no date will return the patient to
 * a queue on its own.
 *
 * 1. **Already In System** — the patient is already being served, so the whole
 *    queue is a holding pen (§5.10).
 * 2. **Doctor Appointments outreach** — Sub-Stage "Doctor Appointment", i.e.
 *    the provider wants a visit and we have no date yet (§5.12).
 * 3. **A booked visit that hasn't happened** — Appointment Date today or later.
 *    There is nothing to do until the patient is seen; §5.12's sidebar already
 *    treats this as outranking the date sections ("a booked visit WINS"), and
 *    Profile Status agrees. A visit in the PAST is not parked: the chase is
 *    live again, and `snoozeUntilAfterAppointment` floors those patients at
 *    today precisely so they are due now (Josh, 2026-08-19).
 * 4. **A dateless sleep** — the three follow-up snoozes that carry no date.
 *    Josh's call (2026-08-19): they read Paused rather than Waiting because
 *    Waiting promises a date that will bring the patient back, and here there
 *    isn't one. Welcome Call's is being rewritten away; Insurance's blank-date
 *    `Follow Up` and Profile Send Off's `Done` are not.
 */
function isPaused(input: ProfileStatusInput, todayYmd: string): boolean {
  if ((input.alreadyInSystem ?? "").trim().toLowerCase() === "yes") return true;
  if ((input.subStage ?? "").trim() === DOCTOR_APPOINTMENT_SUB_STAGE) return true;

  const appt = ymd(input.appointmentDate);
  if (appt && appt >= todayYmd) return true;

  const followUp = (input.followUp ?? "").trim();
  switch (input.followUpRule ?? "none") {
    case "done":
      // Index 1's label is "Done" on these boards and is the follow-up marker.
      return followUp === "Done";
    case "followUp":
      // Only the DATELESS case: with a date this is an ordinary snooze and the
      // Waiting rule below owns it.
      return followUp === "Follow Up" && !ymd(input.nextActionDate);
    default:
      return false;
  }
}

/* ── The rule ────────────────────────────────────────────────── */

/**
 * Resolve a patient's Profile Status, or `null` when the app has no honest
 * status to show (see the header: completed items, and un-escalated Auth
 * Denied patients).
 *
 * `todayYmd` defaults to ET today; pass it explicitly in tests.
 */
export function profileStatus(
  input: ProfileStatusInput,
  todayYmd: string = etTodayYmd(),
): ProfileStatus | null {
  const groupId = (input.groupId ?? "").trim();

  // 0. Finished work wears no live status — checked before everything, so a
  //    stale escalation label left on a completed item can't resurrect it.
  if (input.completed || (groupId && COMPLETED_GROUP_IDS.includes(groupId))) return null;

  // 1. Stuck is a GROUP, not a column.
  if (groupId && STUCK_GROUP_IDS.includes(groupId)) return "stuck";

  // 2/3. The escalation ladder. Final is a stuck PROPOSAL awaiting a manager's
  //      decision in Oversight's Final Decisions (§7) — it is NOT yet Stuck.
  const rung = escalationRung(input);
  if (rung === "final") return "proposedStuck";
  if (rung === "manager") return "escalated";

  // 4. Parked, with no clock running.
  if (isPaused(input, todayYmd)) return "paused";

  // 5. Snoozed on a date that will bring them back.
  const nad = ymd(input.nextActionDate);
  if (nad && nad > todayYmd) return "waiting";

  // 6. Active — but not for a stage the app can't actually work. Everything
  //    above still reported, because a denial that escalated IS live work.
  if ((input.stage ?? "").trim() === AUTH_DENIED_STAGE) return null;
  return "active";
}

/* ── Per-board adapters ──────────────────────────────────────────
 *
 * Each translates one board's column vocabulary into the input above. They are
 * structurally typed on purpose — every role's own `Patient` satisfies its
 * board's adapter without this module importing eleven page-level types.
 *
 * These make NO decisions. If you find yourself adding an `if` here, it belongs
 * in `profileStatus()` above.
 */

/**
 * Medical Evaluation board (`18406060017`) — Evaluate · Send Request · Confirm
 * Receipt · both Chase roles · Doctor Appointments.
 *
 * The one board carrying every input the rule can use: an escalation index, a
 * Sub-Stage, an Appointment Date and a real Next Action Date. Its Follow Up
 * column is not read by any queue, hence `"none"`.
 */
export function mashekeProfileStatus(
  p: {
    groupId?: string | null;
    subStage?: string | null;
    escalationIndex?: number | null;
    escalation?: string | null;
    appointmentDate?: string | null;
    nextActionDate?: string | null;
  },
  opts: { completed?: boolean; todayYmd?: string } = {},
): ProfileStatus | null {
  return profileStatus(
    {
      groupId: p.groupId,
      completed: opts.completed,
      subStage: p.subStage,
      escalationIndex: p.escalationIndex,
      escalationLabel: p.escalation,
      appointmentDate: p.appointmentDate,
      nextActionDate: p.nextActionDate,
      followUpRule: "none",
    },
    opts.todayYmd,
  );
}

/**
 * Insurance board (`18410601299`) — Benefits · Submit Auth · Auth Outstanding ·
 * DVS · Auth Denied.
 *
 * `escalated` merges indices 0 and 2, so the LABEL is what separates the two
 * rungs (samantha/workflow: "right for counting but NOT for the manager
 * sidebars"). The stage advancer is passed so an un-escalated Auth Denied
 * patient reports no status rather than Active.
 */
export function insuranceProfileStatus(
  p: {
    groupId?: string | null;
    stageAdvancerText?: string | null;
    escalationLabel?: string | null;
    followUp?: string | null;
    followUpDate?: string | null;
  },
  opts: { completed?: boolean; todayYmd?: string } = {},
): ProfileStatus | null {
  return profileStatus(
    {
      groupId: p.groupId,
      completed: opts.completed,
      stage: p.stageAdvancerText,
      escalationLabel: p.escalationLabel,
      nextActionDate: p.followUpDate,
      followUp: p.followUp,
      followUpRule: "followUp",
    },
    opts.todayYmd,
  );
}

/**
 * Profile Send Off board (`18406352652`) — Verified Referrals · Patient Intake
 * (DTC & CareCentrix) · Already In System · Scheduled Calls.
 *
 * ⚠️ Patient Intake passes `followUpRule: "none"` via `ignoreFollowUp`, for the
 * same reason its sidebar does (§5.10): that queue's Follow Up pair is a
 * one-way door nothing reads, so treating it as a snooze would report Paused
 * for a patient sitting in everybody's queue. The other two roles on this board
 * use the column as a genuine follow-up flag and keep it.
 */
export function intakeProfileStatus(
  p: {
    groupId?: string | null;
    alreadyInSystem?: string | null;
    intakeEscalation?: string | null;
    followUp?: string | null;
    followUpDate?: string | null;
  },
  opts: { completed?: boolean; ignoreFollowUp?: boolean; todayYmd?: string } = {},
): ProfileStatus | null {
  return profileStatus(
    {
      groupId: p.groupId,
      completed: opts.completed,
      escalationLabel: p.intakeEscalation,
      alreadyInSystem: p.alreadyInSystem,
      nextActionDate: p.followUpDate,
      followUp: p.followUp,
      followUpRule: opts.ignoreFollowUp ? "none" : "done",
    },
    opts.todayYmd,
  );
}

/**
 * Welcome Call board (`18410804557`) — Welcome Call · Final Profile Confirmation.
 *
 * ⚠️ These two stages hardcode `escalated: false` and never read
 * `color_mm1x7997` (§10 — the escalation there is write-only and the pair needs
 * a rewrite). Pass `escalationIndex` explicitly from the raw column so the badge
 * is honest; reading the column is purely additive and does not touch the
 * broken write path.
 */
export function welcomeCallProfileStatus(
  p: {
    groupId?: string | null;
    escalationIndex?: number | null;
    /** Raw label — the safety net if this board's indices aren't what we think. */
    escalation?: string | null;
    followUp?: string | null;
    followUpDate?: string | null;
  },
  opts: { completed?: boolean; todayYmd?: string } = {},
): ProfileStatus | null {
  return profileStatus(
    {
      groupId: p.groupId,
      completed: opts.completed,
      escalationIndex: p.escalationIndex,
      escalationLabel: p.escalation,
      nextActionDate: p.followUpDate,
      followUp: p.followUp,
      followUpRule: "done",
    },
    opts.todayYmd,
  );
}

/**
 * Subscription board (`18407459988`).
 *
 * Josh's list puts subscriptions squarely in Active, and the board has neither
 * a Stuck group nor a Next Action Date — so in practice this resolves to Active
 * or, for the 36 items carrying it, Escalated. ⚠️ `color_mm2n237s` has a single
 * `Escalate` label and NO `Done` (§10), so index 0 is the only escalated value
 * and the flag cannot be cleared from the board by index.
 */
export function subscriptionProfileStatus(
  p: { groupId?: string | null; escalationIndex?: number | null; escalation?: string | null },
  opts: { completed?: boolean; todayYmd?: string } = {},
): ProfileStatus | null {
  return profileStatus(
    {
      groupId: p.groupId,
      completed: opts.completed,
      escalationIndex: p.escalationIndex,
      escalationLabel: p.escalation,
      followUpRule: "none",
    },
    opts.todayYmd,
  );
}

/**
 * System Management — Search and the Escalations tab, the one cross-board
 * patient view.
 *
 * Its `SystemPatient` is a projection over all seven boards, so it carries the
 * inputs that generalise (group, escalation rung, stage advancer, next action
 * date) and not the board-specific ones (Sub-Stage, Appointment Date, Already
 * In System, Follow Up). ⚠️ That means a row can read **Active** for a patient
 * the role page itself calls **Paused** — a Doctor Appointments patient is the
 * live example. It is a narrower read, never a contradictory one: every rung it
 * CAN see, it reports identically. Widening it means adding those columns to
 * `BOARDS`' per-board read set, not special-casing here.
 *
 * `escalationLevel` is already derived from label-then-index across all seven
 * boards (`systemMgmt/escalationDetail.ts`), so it is preferred over the raw
 * text. `flat` is the Welcome Call board, whose column never split — one
 * "Escalation Required" label, which is a manager escalation.
 */
export function systemProfileStatus(
  p: {
    groupId?: string | null;
    isCompleted?: boolean;
    escalationLevel?: "manager" | "final" | "flat" | null;
    escalationText?: string | null;
    stageAdvancerText?: string | null;
    nextActionDate?: string | null;
  },
  todayYmd?: string,
): ProfileStatus | null {
  const level = p.escalationLevel;
  return profileStatus(
    {
      groupId: p.groupId,
      completed: p.isCompleted,
      stage: p.stageAdvancerText,
      escalationIndex:
        level === "final"
          ? ESCALATION_INDEX.final
          : level === "manager" || level === "flat"
            ? ESCALATION_INDEX.manager
            : null,
      // Only consulted when the level is null, i.e. the row isn't escalated.
      escalationLabel: level ? null : p.escalationText,
      nextActionDate: p.nextActionDate,
      followUpRule: "none",
    },
    todayYmd,
  );
}
