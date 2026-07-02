/**
 * Pure list math for the masheke PatientsSidebar (Evaluate / Send Request /
 * Confirm Receipt / Chase). The sidebar component renders exactly what these
 * functions return, and role pages use `sidebarVisibleList` to auto-select the
 * first patient the rep can actually see — so the two can never drift apart.
 */
import type { Patient } from "@/lib/masheke/workflow";
import type { RoleFilter } from "@/lib/accessStore";
import { etToday } from "@/lib/masheke/etDate";

export interface SidebarSections {
  /** Non-escalated patients due now (Next Action Date blank or <= today). */
  nonEscNow: Patient[];
  /** Non-escalated patients scheduled for a future date. Hidden behind the
   *  (currently disabled) Scheduled folder — never part of the visible list. */
  pendingPatients: Patient[];
  /** Escalated patients ("Escalation Required") — always shown, no date split. */
  escalatedList: Patient[];
}

const isEsc = (p: Patient) => p.escalation === "Escalation Required";

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
