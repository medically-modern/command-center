/**
 * Pure list math for the Profile PatientsSidebar. The sidebar component
 * renders exactly what these functions return, and ProfilePage uses
 * `sidebarVisibleList` to auto-select the first patient the rep can actually
 * see — so the two can never drift apart.
 */
import type { Patient } from "@/lib/profile/workflow";
import type { RoleFilter } from "@/lib/accessStore";

/** Stable ordering for referral source groups */
const SOURCE_ORDER = [
  "Tandem",
  "Beta Bionics",
  "CareCentrix",
  "Doctor",
  "Patient",
  "Solace Advocates",
];

export interface SidebarSections {
  /** Active (followUp !== "Done") patients grouped by referral source:
   *  known sources first in SOURCE_ORDER, then unknown/other alphabetically.
   *  Input order preserved within each group. */
  sourceGroups: { source: string; patients: Patient[] }[];
  /** followUp === "Done" patients — the dimmed Follow Up section below. */
  followUpPatients: Patient[];
}

export interface SidebarOptions {
  /**
   * Treat Follow Up as none of this queue's business: everyone is active and
   * `followUpPatients` comes back empty.
   *
   * Patient Intake (DTC) passes this. That stage has no snooze at all — a call
   * attempt bumps the attempt counter and nothing else (Josh, 2026-08-13) — so
   * the column is not part of its model, and a patient carrying a stale "Done"
   * from the old snooze must come back rather than sit in a section this page
   * doesn't render. Verified Referrals and Already In System still use the
   * column as a genuine follow-up flag and keep the split.
   */
  ignoreFollowUp?: boolean;
}

/** Split the raw patient list into the sidebar's sections. */
export function sidebarSections(
  patients: Patient[],
  { ignoreFollowUp = false }: SidebarOptions = {},
): SidebarSections {
  const activePatients = ignoreFollowUp
    ? patients
    : patients.filter((p) => p.followUp !== "Done");
  const followUpPatients = ignoreFollowUp
    ? []
    : patients.filter((p) => p.followUp === "Done");

  const groups: Record<string, Patient[]> = {};
  for (const p of activePatients) {
    const src = p.referralSource?.trim() || "Unknown";
    if (!groups[src]) groups[src] = [];
    groups[src].push(p);
  }
  // Sort groups: known sources first in SOURCE_ORDER, then unknown/other alphabetically
  const sourceGroups: { source: string; patients: Patient[] }[] = [];
  for (const src of SOURCE_ORDER) {
    if (groups[src]) {
      sourceGroups.push({ source: src, patients: groups[src] });
      delete groups[src];
    }
  }
  // Remaining groups (unknown or new sources) sorted alphabetically
  for (const src of Object.keys(groups).sort()) {
    sourceGroups.push({ source: src, patients: groups[src] });
  }
  return { sourceGroups, followUpPatients };
}

/** Every patient row the sidebar renders, flattened top-to-bottom in exact
 *  render order: each referral-source group (all open by default), then the
 *  Follow Up section. The Profile sidebar has no escalation split, so the
 *  view filter never changes the list — it's accepted only to match the
 *  shared role-page signature. */
export function sidebarVisibleList(
  patients: Patient[],
  _viewFilter: RoleFilter,
  options?: SidebarOptions,
): Patient[] {
  const { sourceGroups, followUpPatients } = sidebarSections(patients, options);
  return [...sourceGroups.flatMap((g) => g.patients), ...followUpPatients];
}
