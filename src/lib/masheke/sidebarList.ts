/**
 * Pure list math for the masheke PatientsSidebar (Evaluate / Send Request /
 * Confirm Receipt / Chase). The sidebar component renders exactly what these
 * functions return, and role pages use `sidebarVisibleList` to auto-select the
 * first patient the rep can actually see — so the two can never drift apart.
 */
import type { Patient } from "@/lib/masheke/workflow";
import type { RoleFilter } from "@/lib/accessStore";
import { etToday } from "@/lib/masheke/etDate";
import { isEscalatedIndex } from "@/lib/masheke/mondayMapping";

export interface SidebarSections {
  /** Non-escalated patients due now (Next Action Date blank or <= today). */
  nonEscNow: Patient[];
  /** Non-escalated patients scheduled for a future date. Hidden behind the
   *  (currently disabled) Scheduled folder — never part of the visible list. */
  pendingPatients: Patient[];
  /** Escalated patients (escalation index 0 "Manager Escalation Required") —
   *  always shown, no date split. Index 2 ("Final Escalation Required") is a
   *  stuck PROPOSAL: those leave the rep queue entirely (filtered upstream in
   *  useMondayPatients) and surface in Oversight's Final Decisions instead. */
  escalatedList: Patient[];
}

// Match by INDEX, not label text: the board's escalation labels were renamed
// (2026-07) and matching "Escalation Required" here silently dropped everyone.
const isEsc = (p: Patient) => isEscalatedIndex(p.escalationIndex);

/** Split the raw patient list into the sidebar's sections, preserving input
 *  order within each. `todayStr` is YYYY-MM-DD in ET (defaults to ET today;
 *  pass explicitly in tests). */
export function sidebarSections(
  patients: Patient[],
  todayStr: string = etToday(),
): SidebarSections {
  const escalatedList = patients.filter(isEsc);

  // Non-escalated active list keeps the Next-Action-Date scheduling split
  // (future-dated → scheduled folder). Escalated patients always show, no split.
  const nonEsc = patients.filter((p) => !isEsc(p));
  const pendingPatients = nonEsc.filter((p) => {
    const nad = p.nextActionDate?.slice(0, 10);
    return !!nad && nad > todayStr;
  });
  const nonEscNow = nonEsc.filter((p) => {
    const nad = p.nextActionDate?.slice(0, 10);
    return !nad || nad <= todayStr;
  });

  return { nonEscNow, pendingPatients, escalatedList };
}

/**
 * Doctor Appointments sidebar sections (2026-08-03).
 *
 * A PROCESSOR sees exactly one section: *Reach out today*. Nothing else — not
 * the snoozed patients, not the booked ones.
 *
 * A MANAGER additionally gets *Awaiting reply* (snoozed) and *Scheduled*
 * (a visit is booked and hasn't happened yet). Both are oversight, not work.
 *
 * Every patient lands in EXACTLY ONE section, and a **booked visit wins** — a
 * patient with an appointment on the calendar is in Scheduled, never in Reach
 * out today or Awaiting reply, whatever their Next Action Date says.
 *
 * Escalated patients drop out of the PROCESSOR's sidebar entirely — they're the
 * manager's. In the manager view they stay, and sort by Next Action Date like
 * anyone else: due today or earlier ⇒ Reach out today, future ⇒ Awaiting reply.
 * Index 2 (proposed stuck) is filtered upstream in useMondayPatients for the
 * rep; a manager reaches those through Oversight's Final Decisions.
 */
export interface ApptSidebarSections {
  /** Due now — no Next Action Date, or one at/before today. */
  dueNow: Patient[];
  /** Snoozed, in the "Awaiting reply" folder. Manager view only. */
  awaitingReply: Patient[];
  /** A visit is booked and hasn't happened yet. Manager view only, and these
   *  patients are in NO other section — a booked visit wins. */
  scheduled: Patient[];
}

export function apptSidebarSections(
  patients: Patient[],
  todayStr: string = etToday(),
  scheduledPatients: Patient[] = [],
  /**
   * Keep escalated patients in the sections. TRUE for the manager view — they
   * ARE the manager's list, so dropping them left Manager Intervention showing
   * "Nobody due right now" while the chart counted the patient.
   *
   * The bug only bit index 0: `isEscalatedIndex` is index-0-only, so index 2
   * (Final Decisions) patients were never filtered — which is why Final looked
   * correct and Manager Intervention looked empty.
   */
  includeEscalated = false,
): ApptSidebarSections {
  /** A visit is booked and hasn't happened yet. */
  const isBooked = (p: Patient) => {
    const d = p.appointmentDate?.slice(0, 10);
    return !!d && d >= todayStr;
  };

  const active = includeEscalated ? patients : patients.filter((p) => !isEsc(p));

  // ── A BOOKED VISIT OUTRANKS THE DATE SECTIONS (Josh, 2026-08-03). ──
  // There is nothing to do for these patients until the visit happens, so they
  // belong in Scheduled even when their Next Action Date says today or their
  // follow-up is a week out. Sorting them by the date sections instead is how
  // the same person ended up under Awaiting reply AND Scheduled: `patients`
  // carries them (useMondayPatients injects a deep-linked `?patientId=` even
  // when it doesn't match this stage) and so does `scheduledPatients`.
  const scheduled: Patient[] = [];
  const seen = new Set<string>();
  for (const p of [...active, ...scheduledPatients]) {
    if ((!includeEscalated && isEsc(p)) || !isBooked(p) || seen.has(p.id)) continue;
    seen.add(p.id);
    scheduled.push(p);
  }
  // Soonest visit first — the one most likely to need attention.
  scheduled.sort((a, b) => (a.appointmentDate ?? "").localeCompare(b.appointmentDate ?? ""));

  // Everything else splits on the Next Action Date, as before.
  const working = active.filter((p) => !isBooked(p));
  const dueNow = working.filter((p) => {
    const nad = p.nextActionDate?.slice(0, 10);
    return !nad || nad <= todayStr;
  });
  const awaitingReply = working.filter((p) => {
    const nad = p.nextActionDate?.slice(0, 10);
    return !!nad && nad > todayStr;
  });

  return { dueNow, awaitingReply, scheduled };
}

/** Flattened Doctor Appointments list in render order — due now, then the
 *  awaiting-reply folder. Used for auto-select so the page can never select a
 *  patient the sidebar doesn't show. */
export function apptSidebarVisibleList(
  patients: Patient[],
  todayStr: string = etToday(),
  scheduledPatients: Patient[] = [],
  /** Manager view — the Awaiting-reply and Scheduled folders, and escalated
   *  patients included. A processor's sidebar is "Reach out today" and nothing
   *  else, with escalated patients dropped. */
  managerView = false,
): Patient[] {
  const { dueNow, awaitingReply, scheduled } = apptSidebarSections(
    patients,
    todayStr,
    managerView ? scheduledPatients : [],
    managerView,
  );
  return managerView ? [...dueNow, ...awaitingReply, ...scheduled] : [...dueNow];
}

/** Every patient row the sidebar renders for a view filter, flattened
 *  top-to-bottom in exact render order:
 *  - "nonEscalated" (default): the non-escalated due-now list only.
 *  - "escalated": the escalated list only.
 *  - "all": the non-escalated due-now list, then the escalated section below.
 *  Future-dated (scheduled) patients never appear — the Scheduled folder is
 *  disabled (hideScheduledFolder) and default-closed. */
export function sidebarVisibleList(
  patients: Patient[],
  viewFilter: RoleFilter,
  todayStr: string = etToday(),
): Patient[] {
  const { nonEscNow, escalatedList } = sidebarSections(patients, todayStr);
  if (viewFilter === "escalated") return escalatedList;
  if (viewFilter === "all") return [...nonEscNow, ...escalatedList];
  return nonEscNow;
}
