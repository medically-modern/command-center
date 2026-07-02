/**
 * Pure section math for the Final Profile Confirmation sidebar. The sidebar
 * component and the page's auto-select both consume this, so "first visible
 * patient" always means the first row the rep can actually see.
 *
 * escalated filter (manager view): the main list IS the escalated list; the
 * separate Escalated section hides. nonEscalated (default): main list is
 * non-escalated, Escalated section hides. all: both sections show.
 */
import type { RoleFilter } from "@/lib/accessStore";
import type { Patient } from "@/lib/finalConfirm/workflow";

export interface SidebarSections {
  /** Main list. Escalated filter: every escalated patient; otherwise !escalated. */
  main: Patient[];
  /** Escalated patients. Hidden unless viewFilter === "all". */
  escalated: Patient[];
}

/** The sidebar's sections for a view filter, each in input (board) order. */
export function sidebarSections(patients: Patient[], viewFilter: RoleFilter): SidebarSections {
  const escalatedOnly = viewFilter === "escalated";
  const includeEscalated = viewFilter !== "nonEscalated";
  const main = escalatedOnly
    ? patients.filter((p) => p.escalated)
    : patients.filter((p) => !p.escalated);
  const escalated = escalatedOnly || !includeEscalated
    ? []
    : patients.filter((p) => p.escalated);
  return { main, escalated };
}

/** Every row the sidebar renders, flattened top-to-bottom in exact render
 *  order: Active (main) → Escalated. */
export function sidebarVisibleList(patients: Patient[], viewFilter: RoleFilter): Patient[] {
  const s = sidebarSections(patients, viewFilter);
  return [...s.main, ...s.escalated];
}
