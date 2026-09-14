/**
 * Pure section math for the Final Profile Confirmation sidebar. The sidebar
 * component and the page's auto-select both consume this, so "first visible
 * patient" always means the first row the rep can actually see.
 *
 * escalated filter (manager view): the main list IS the escalated list; the
 * separate Escalated section hides. With `?mv=final-decisions` beside it the
 * main list is the PROPOSED STUCK list instead — that column's cohort.
 * nonEscalated (default): main list is neither flag, Escalated section hides.
 * all: every section shows.
 *
 * Escalation is read off the board since 2026-09-14 (§10 — it was hardcoded
 * false); `escalated` is index 0, `proposedStuck` index 2, and a proposal
 * leaves the rep's lists as it does on Medical Evaluation.
 */
import type { RoleFilter } from "@/lib/accessStore";
import type { ManagerOrigin } from "@/lib/shared/managerOrigin";
import type { Patient } from "@/lib/finalConfirm/workflow";

export interface SidebarSections {
  /** Main list. Escalated filter: every escalated patient (proposed-stuck only
   *  from Final Decisions); otherwise neither flag. */
  main: Patient[];
  /** Escalated (index 0). Hidden unless viewFilter === "all". */
  escalated: Patient[];
  /** Proposed Stuck (index 2). Hidden unless viewFilter === "all". */
  proposedStuck: Patient[];
}

export interface SidebarOptions {
  origin?: ManagerOrigin | null;
}

const isProposed = (p: Patient) => !!p.proposedStuck;
const isEsc = (p: Patient) => !!p.escalated && !p.proposedStuck;

/** The sidebar's sections for a view filter, each in input (board) order. */
export function sidebarSections(
  patients: Patient[],
  viewFilter: RoleFilter,
  opts: SidebarOptions = {},
): SidebarSections {
  const escalatedOnly = viewFilter === "escalated";
  const includeEscalated = viewFilter !== "nonEscalated";
  if (escalatedOnly && opts.origin === "final-decisions") {
    return { main: patients.filter(isProposed), escalated: [], proposedStuck: [] };
  }
  if (escalatedOnly) {
    return { main: patients.filter(isEsc), escalated: [], proposedStuck: [] };
  }
  return {
    main: patients.filter((p) => !isEsc(p) && !isProposed(p)),
    escalated: includeEscalated ? patients.filter(isEsc) : [],
    proposedStuck: includeEscalated ? patients.filter(isProposed) : [],
  };
}

/** Every row the sidebar renders, flattened top-to-bottom in exact render
 *  order: Active (main) → Escalated → Proposed Stuck. */
export function sidebarVisibleList(
  patients: Patient[],
  viewFilter: RoleFilter,
  opts: SidebarOptions = {},
): Patient[] {
  const s = sidebarSections(patients, viewFilter, opts);
  return [...s.main, ...s.escalated, ...s.proposedStuck];
}
