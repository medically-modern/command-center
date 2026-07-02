/**
 * Pure section math for the Welcome Call sidebar. The sidebar component and
 * the page's auto-select both consume this, so "first visible patient" always
 * means the first row the rep can actually see.
 *
 * Split patients into active vs follow-up:
 * - "Done" is the text Monday returns for status index 1 (our follow-up marker)
 * - Manager view (escalated filter): the main list IS the escalated list;
 *   other sections hide.
 */
import type { RoleFilter } from "@/lib/accessStore";
import type { Patient } from "@/lib/welcomeCall/workflow";

export interface SidebarSections {
  /** Main list. Escalated filter: every escalated patient; otherwise !escalated && followUp !== "Done". */
  active: Patient[];
  /** Escalated ∧ not follow-up. Hidden unless viewFilter === "all". */
  escalated: Patient[];
  /** Follow-up ∧ not escalated. Hidden on the escalated filter. */
  followUp: Patient[];
  /** Escalated ∧ follow-up. Hidden unless viewFilter === "all". */
  both: Patient[];
}

/** The sidebar's sections for a view filter, each in input (board) order. */
export function sidebarSections(patients: Patient[], viewFilter: RoleFilter): SidebarSections {
  const escalatedOnly = viewFilter === "escalated";
  const includeEscalated = viewFilter !== "nonEscalated";
  const escalated = escalatedOnly || !includeEscalated
    ? []
    : patients.filter((p) => p.escalated && p.followUp !== "Done");
  const active = escalatedOnly
    ? patients.filter((p) => p.escalated)
    : patients.filter((p) => !p.escalated && p.followUp !== "Done");
  const followUp = escalatedOnly ? [] : patients.filter((p) => p.followUp === "Done" && !p.escalated);
  const both = escalatedOnly || !includeEscalated
    ? []
    : patients.filter((p) => p.escalated && p.followUp === "Done");
  return { active, escalated, followUp, both };
}

/** Every row the sidebar renders, flattened top-to-bottom in exact render
 *  order: Active → Escalated → Follow Up → Escalated + Follow Up. */
export function sidebarVisibleList(patients: Patient[], viewFilter: RoleFilter): Patient[] {
  const s = sidebarSections(patients, viewFilter);
  return [...s.active, ...s.escalated, ...s.followUp, ...s.both];
}
