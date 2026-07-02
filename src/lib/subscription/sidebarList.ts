/**
 * Pure list math for the Subscription PatientsSidebar. The sidebar component
 * renders exactly what these functions return, and SubscriptionPage uses
 * `sidebarVisibleList` to auto-select the first patient the rep can actually
 * see — so the two can never drift apart.
 */
import type { Patient } from "@/lib/subscription/workflow";
import type { RoleFilter } from "@/lib/accessStore";

export interface SidebarSections {
  /** Non-escalated patients with status "Active". */
  active: Patient[];
  /** Non-escalated patients with status "Paused". */
  paused: Patient[];
  /** Non-escalated patients with status "Dead". */
  dead: Patient[];
  /** Non-escalated patients with any other status (incl. blank). */
  other: Patient[];
  /** Escalated patients — the dimmed section at the bottom, any status. */
  escalatedPatients: Patient[];
}

/** Split the raw patient list into the sidebar's status groups + escalated
 *  section, preserving input order within each. */
export function sidebarSections(patients: Patient[]): SidebarSections {
  const escalatedPatients = patients.filter((p) => p.escalated);
  const nonEscalated = patients.filter((p) => !p.escalated);
  const active = nonEscalated.filter((p) => p.status === "Active");
  const paused = nonEscalated.filter((p) => p.status === "Paused");
  const dead = nonEscalated.filter((p) => p.status === "Dead");
  const other = nonEscalated.filter((p) => p.status !== "Active" && p.status !== "Paused" && p.status !== "Dead");
  return { active, paused, dead, other, escalatedPatients };
}

/** Every patient row the sidebar renders, flattened top-to-bottom in exact
 *  render order: Active → Paused → Dead → Other, then the dimmed Escalated
 *  section. The Subscription sidebar always shows every group (no escalation
 *  view split), so the view filter never changes the list — it's accepted
 *  only to match the shared role-page signature. */
export function sidebarVisibleList(patients: Patient[], _viewFilter: RoleFilter): Patient[] {
  const { active, paused, dead, other, escalatedPatients } = sidebarSections(patients);
  return [...active, ...paused, ...dead, ...other, ...escalatedPatients];
}
