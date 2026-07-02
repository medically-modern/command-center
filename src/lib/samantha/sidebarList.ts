/**
 * Pure list math for the samantha PatientsSidebar (Benefits / Submit Auth /
 * Auth Outstanding). The sidebar component renders exactly what these
 * functions return, and role pages use `sidebarVisibleList` to auto-select the
 * first patient the rep can actually see — so the two can never drift apart.
 */
import type { Patient } from "@/lib/samantha/workflow";
import type { RoleFilter } from "@/lib/accessStore";
import type { SidebarGroup } from "@/hooks/samantha/useMondayPatients";

export interface SidebarSections {
  /** Main list before the Auth Outstanding re-sort — drives the
   *  group-by-insurance view, the header count, and the empty-state check. */
  activePatients: Patient[];
  /** Main list as rendered flat: Auth Outstanding re-sorts by
   *  daysSinceStageIndex descending (longest in system first); other groups
   *  keep Monday order. */
  sortedPatients: Patient[];
  /** Follow Up section (non-escalated, Follow Up active) — hidden in the
   *  escalated view. */
  followUpPatients: Patient[];
  /** Escalated section (escalated, no Follow Up) — only in the "all" view. */
  escalatedPatients: Patient[];
  /** Escalated + Follow Up section (both statuses) — only in the "all" view. */
  bothPatients: Patient[];
}

/**
 * Split patients into active vs follow-up vs escalated vs both, preserving
 * input order within each (the Auth Outstanding sort is stable on ties).
 * Manager view: the main list IS the escalated list — the separate
 * escalated/follow-up sections are hidden.
 * escalated-only → just escalated; non-escalated → hide the escalated/both
 * sections; all → show everything.
 */
export function sidebarSections(
  patients: Patient[],
  viewFilter: RoleFilter,
  activeGroup: SidebarGroup,
): SidebarSections {
  const escalatedOnly = viewFilter === "escalated";
  const includeEscalated = viewFilter !== "nonEscalated";

  const escalatedPatients = escalatedOnly || !includeEscalated
    ? []
    : patients.filter((p) => p.escalated && p.followUp !== "Follow Up");
  const activePatients = escalatedOnly
    ? patients.filter((p) => p.escalated)
    : patients.filter((p) => !p.escalated && p.followUp !== "Follow Up");
  const followUpPatients = escalatedOnly
    ? []
    : patients.filter((p) => p.followUp === "Follow Up" && !p.escalated);
  const bothPatients = escalatedOnly || !includeEscalated
    ? []
    : patients.filter((p) => p.escalated && p.followUp === "Follow Up");

  // For Auth Outstanding, sort the main list by daysSinceStageIndex descending
  // (longest in system first). Other groups keep Monday order.
  const sortedPatients = activeGroup !== "authOutstanding"
    ? activePatients
    : [...activePatients].sort((a, b) => (b.daysSinceStageIndex ?? -1) - (a.daysSinceStageIndex ?? -1));

  return { activePatients, sortedPatients, followUpPatients, escalatedPatients, bothPatients };
}

/** Every patient row the sidebar renders for a view filter, flattened
 *  top-to-bottom in exact render order: the main (flat) list, then the
 *  Follow Up section, then Escalated, then Escalated + Follow Up.
 *  - "nonEscalated" (default): active patients, then follow-ups below.
 *  - "escalated": ONLY escalated patients (Follow Up or not) as the main list.
 *  - "all": active, follow-ups, escalated, then escalated + follow-up. */
export function sidebarVisibleList(
  patients: Patient[],
  viewFilter: RoleFilter,
  activeGroup: SidebarGroup,
): Patient[] {
  const { sortedPatients, followUpPatients, escalatedPatients, bothPatients } =
    sidebarSections(patients, viewFilter, activeGroup);
  return [...sortedPatients, ...followUpPatients, ...escalatedPatients, ...bothPatients];
}
