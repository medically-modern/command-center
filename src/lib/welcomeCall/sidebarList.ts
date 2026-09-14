/**
 * Pure section math for the Welcome Call sidebar. The sidebar component and
 * the page's auto-select both consume this, so "first visible patient" always
 * means the first row the rep can actually see.
 *
 * Split patients into active vs follow-up:
 * - "Done" is the text Monday returns for status index 1 (our follow-up marker)
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
import type { RoleFilter } from "@/lib/accessStore";
import type { ManagerOrigin } from "@/lib/shared/managerOrigin";
import type { Patient } from "@/lib/welcomeCall/workflow";

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
  viewFilter: RoleFilter,
  opts: SidebarOptions = {},
): SidebarSections {
  const escalatedOnly = viewFilter === "escalated";
  const includeEscalated = viewFilter !== "nonEscalated";
  if (escalatedOnly && opts.origin === "final-decisions") {
    return { ...empty(), active: patients.filter(isProposed) };
  }
  if (escalatedOnly) {
    return { ...empty(), active: patients.filter(isEsc) };
  }
  return {
    active: patients.filter((p) => isPlain(p) && p.followUp !== "Done"),
    escalated: includeEscalated ? patients.filter((p) => isEsc(p) && p.followUp !== "Done") : [],
    followUp: patients.filter((p) => isPlain(p) && p.followUp === "Done"),
    both: includeEscalated ? patients.filter((p) => isEsc(p) && p.followUp === "Done") : [],
    proposedStuck: includeEscalated ? patients.filter(isProposed) : [],
  };
}

/** Every row the sidebar renders, flattened top-to-bottom in exact render
 *  order: Active → Escalated → Follow Up → Escalated + Follow Up → Proposed Stuck. */
export function sidebarVisibleList(
  patients: Patient[],
  viewFilter: RoleFilter,
  opts: SidebarOptions = {},
): Patient[] {
  const s = sidebarSections(patients, viewFilter, opts);
  return [...s.active, ...s.escalated, ...s.followUp, ...s.both, ...s.proposedStuck];
}
