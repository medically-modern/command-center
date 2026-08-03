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
 * (booked a visit, so they've left this stage for Chase). Both are oversight,
 * not work.
 *
 * Every patient lands in EXACTLY ONE section — see the dedupe in the function.
 *
 * Escalated patients belong to the manager too, so they drop out of the rep's
 * sidebar entirely. Index 2 (proposed stuck) is filtered upstream in
 * useMondayPatients like everywhere else.
 */
export interface ApptSidebarSections {
  /** Due now — no Next Action Date, or one at/before today. */
  dueNow: Patient[];
  /** Snoozed, in the "Awaiting reply" folder. Manager view only. */
  awaitingReply: Patient[];
  /** Booked a visit and therefore LEFT this stage for Chase. Manager view only,
   *  and never anyone already listed above — see the dedupe below. */
  scheduled: Patient[];
}

export function apptSidebarSections(
  patients: Patient[],
  todayStr: string = etToday(),
  scheduledPatients: Patient[] = [],
): ApptSidebarSections {
  const active = patients.filter((p) => !isEsc(p));
  const dueNow = active.filter((p) => {
    const nad = p.nextActionDate?.slice(0, 10);
    return !nad || nad <= todayStr;
  });
  const awaitingReply = active.filter((p) => {
    const nad = p.nextActionDate?.slice(0, 10);
    return !!nad && nad > todayStr;
  });

  // A patient appears in EXACTLY ONE section. The dedupe is not belt-and-braces:
  // `useMondayPatients` injects a deep-linked `?patientId=` into the main list
  // even when it doesn't match this stage, so a booked chase patient opened from
  // Oversight lands in BOTH lists — which is how the same person showed up under
  // Awaiting reply and Scheduled at once.
  const listed = new Set([...dueNow, ...awaitingReply].map((p) => p.id));
  const scheduled = scheduledPatients
    .filter((p) => !isEsc(p) && !listed.has(p.id))
    // Soonest visit first — the one most likely to need attention.
    .sort((a, b) => (a.appointmentDate ?? "").localeCompare(b.appointmentDate ?? ""));

  return { dueNow, awaitingReply, scheduled };
}

/** Flattened Doctor Appointments list in render order — due now, then the
 *  awaiting-reply folder. Used for auto-select so the page can never select a
 *  patient the sidebar doesn't show. */
export function apptSidebarVisibleList(
  patients: Patient[],
  todayStr: string = etToday(),
  scheduledPatients: Patient[] = [],
  /** Manager view — the Awaiting-reply and Scheduled folders. A processor's
   *  sidebar is "Reach out today" and nothing else. */
  managerView = false,
): Patient[] {
  const { dueNow, awaitingReply, scheduled } = apptSidebarSections(
    patients,
    todayStr,
    managerView ? scheduledPatients : [],
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
