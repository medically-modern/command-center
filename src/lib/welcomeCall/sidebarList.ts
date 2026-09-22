/**
 * Pure section math for the Welcome Call sidebar. The sidebar component and
 * the page's auto-select both consume this, so "first visible patient" always
 * means the first row the rep can actually see.
 *
 * Split patients into active vs follow-up:
 * - Active vs Follow Up is decided by the DATE, not the status label — see
 *   isWelcomeCallSnoozed below for why, and for the counting contract it binds
 * - Manager view (escalated filter): the main list IS the escalated list;
 *   other sections hide.
 * - Final Decisions view (`?mv=final-decisions`, which Oversight sets alongside
 *   the escalated filter): the main list IS the proposed-stuck list — the
 *   patients that column's chart counts, and nobody else.
 *
 * Escalation is read off the board since 2026-09-14 (it was hardcoded false —
 * §10), so `escalated` (index 0) and `proposedStuck` (index 2) are real here.
 * A proposal leaves the rep's lists entirely, as it does on Medical Evaluation:
 * it is the manager's to decide, and a Send from the rep's screen would have
 * advanced a patient a manager was about to mark Stuck.
 */
import type { CrossSellScope, EscalationFilter } from "@/lib/accessStore";
import { etToday } from "@/lib/masheke/etDate";
import type { ManagerOrigin } from "@/lib/shared/managerOrigin";
import { isCrossSell, type Patient } from "@/lib/welcomeCall/workflow";

/**
 * Is this patient snoozed — i.e. parked until a day that has not arrived yet?
 *
 * ⚠️ PURE DATE BUCKET: snoozed iff Follow Up Date is in the FUTURE (ET). The
 * Follow Up STATUS column is deliberately ignored, and a BLANK date counts as
 * DUE. This is the same rule Auth Outstanding has used since the 2026-07-21
 * redesign (samantha/authOutstandingReview.isSnoozedAuthOutstanding) — read
 * that one's reasoning, it is identical: a stage whose whole job is "come back
 * to this patient on a day" should bucket on the day, not on a label.
 *
 * ⚠️ IT REPLACES `followUp !== "Done"`, and that was a ONE-WAY DOOR (Josh,
 * 2026-09-22: "press when attempted, and then move next action date ... when
 * patient arrives, should only show up tomorrow"). Every in-app path that sets
 * Follow Up writes BOTH columns — CallAttemptsCounter's +1 and FollowUpModal,
 * which refuses to save without a date — and then nothing on this board ever
 * read the date back. So logging an attempt set the status, the patient left
 * the sidebar AND the role bar, and the date they were promised back on passed
 * with nothing to wake them: hidden until a human cleared the column by hand.
 * The §5.10 Patient-Intake failure, one board over. Measured on the live
 * Welcome Call group the day this changed: 24 patients, the 5 snoozed ones all
 * dated tomorrow, so the switch moved NOBODY on the day — it only means those
 * 5 come back tomorrow instead of never.
 *
 * ⚠️ One consequence, accepted: a "Done" set BY HAND on the board with no date
 * no longer hides anyone. That is the dateless indefinite snooze §5.18 calls
 * Paused, and it is exactly the stranding above — a patient nothing will ever
 * bring back. Snoozing now means naming the day.
 *
 * ⚠️ THIS IS THE §5.8 COUNTING CONTRACT. The sidebar, `useRoleCounts` and BOTH
 * baseline generators must apply it identically or the bar and the list
 * disagree all day. The two TypeScript readers import this function; the two
 * baseline generators are plain Node and cannot, so they carry the same
 * comparison as a literal — `welcomeCallSnooze.test.ts` scans them and fails
 * the build when either drifts.
 */
export function isWelcomeCallSnoozed(
  p: Pick<Patient, "followUpDate">,
  todayYmd: string = etToday(),
): boolean {
  return !!p.followUpDate && p.followUpDate > todayYmd;
}

export interface SidebarSections {
  /** Main list. Escalated filter: every escalated patient (proposed-stuck only
   *  from Final Decisions); otherwise neither flag && followUp !== "Done". */
  active: Patient[];
  /** Escalated ∧ not follow-up. Hidden unless viewFilter === "all". */
  escalated: Patient[];
  /** Follow-up ∧ neither flag. Hidden on the escalated filter. */
  followUp: Patient[];
  /** Escalated ∧ follow-up. Hidden unless viewFilter === "all". */
  both: Patient[];
  /** Proposed Stuck (index 2), their own section on `all`; the rep's default
   *  view never lists them and the Final Decisions view lists ONLY them. */
  proposedStuck: Patient[];
}

export interface SidebarOptions {
  /** Which Oversight column the manager clicked in from (lib/shared/managerOrigin). */
  origin?: ManagerOrigin | null;
}

const isProposed = (p: Patient) => !!p.proposedStuck;
/** Index 0 alone — a patient can hold one index, but be explicit about it. */
const isEsc = (p: Patient) => !!p.escalated && !p.proposedStuck;
const isPlain = (p: Patient) => !isEsc(p) && !isProposed(p);
const empty = (): SidebarSections => ({ active: [], escalated: [], followUp: [], both: [], proposedStuck: [] });

/** The sidebar's sections for a view filter, each in input (board) order. */
export function sidebarSections(
  patients: Patient[],
  viewFilter: EscalationFilter,
  opts: SidebarOptions = {},
  todayYmd: string = etToday(),
): SidebarSections {
  const escalatedOnly = viewFilter === "escalated";
  const includeEscalated = viewFilter !== "nonEscalated";
  // The one snooze rule (see isWelcomeCallSnoozed) — `active` and `followUp`
  // are its two sides, so they partition the list by construction and a
  // patient can never be in both or neither.
  const snoozed = (p: Patient) => isWelcomeCallSnoozed(p, todayYmd);
  if (escalatedOnly && opts.origin === "final-decisions") {
    return { ...empty(), active: patients.filter(isProposed) };
  }
  if (escalatedOnly) {
    return { ...empty(), active: patients.filter(isEsc) };
  }
  return {
    active: patients.filter((p) => isPlain(p) && !snoozed(p)),
    escalated: includeEscalated ? patients.filter((p) => isEsc(p) && !snoozed(p)) : [],
    followUp: patients.filter((p) => isPlain(p) && snoozed(p)),
    both: includeEscalated ? patients.filter((p) => isEsc(p) && snoozed(p)) : [],
    proposedStuck: includeEscalated ? patients.filter(isProposed) : [],
  };
}

/** Every row the sidebar renders, flattened top-to-bottom in exact render
 *  order: Active → Escalated → Follow Up → Escalated + Follow Up → Proposed Stuck. */
export function sidebarVisibleList(
  patients: Patient[],
  viewFilter: EscalationFilter,
  opts: SidebarOptions = {},
  todayYmd: string = etToday(),
): Patient[] {
  const s = sidebarSections(patients, viewFilter, opts, todayYmd);
  return [...s.active, ...s.escalated, ...s.followUp, ...s.both, ...s.proposedStuck];
}

/**
 * Narrow a Welcome Call list to one side of the cross-sell split, or hand it
 * back untouched when no scope is set (every role and every other filter).
 *
 * ⚠️ ONE rule — `welcomeCall/workflow.isCrossSell` — never a second copy of
 * "serving includes CGM and request type does not". The chip on the patient
 * header, the Care Coordinator card flag, the burndown count and this filter
 * all read that one function, so a rep's bucket can never disagree with the
 * badge on the patient they open. Same argument as `shared/infusionCap`
 * (§5.32g): the two ends of a split must not each own a copy of the rule.
 *
 * ⚠️ Reads the BOARD value, never `servingEdited`. The header chip correctly
 * reads the overlay — it describes the patient on screen — but a queue that
 * did would yank a patient out of the rep's sidebar mid-call the moment they
 * touched Serving, and would disagree with the burndown count, which reads the
 * board (§5.8's sidebar-vs-burndown drift).
 *
 * ⚠️ A BLANK Request Type is NOT a cross-sell, so those patients land in
 * `nonCrossSell`. Deliberate and load-bearing: the flag claims the patient did
 * not originally ask for CGM, and a blank column is the absence of that record
 * rather than evidence for it (§5.31f — 7 live patients were being flagged to
 * sell a CGM they had already asked for). On the live board that is mostly the
 * 8/25 SNJ reactivation rows, and they are correctly somebody else's.
 */
export function applyCrossSellScope(
  patients: Patient[],
  scope: CrossSellScope | null,
): Patient[] {
  if (!scope) return patients;
  const want = scope === "crossSell";
  return patients.filter(
    (p) => isCrossSell({ serving: p.serving, requestType: p.requestType }) === want,
  );
}
