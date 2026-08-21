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

/**
 * The Attempt Counter as a number.
 *
 * Blank or unparseable is 0: a patient nobody has called and one whose counter
 * failed to read are the same thing to a rep deciding who to ring next, and
 * both belong at the top of the list rather than silently at the bottom.
 */
export function attemptCount(p: Patient): number {
  const n = Number((p.attemptCounter ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Automated follow-up texts sent to this patient by the intake form's own
 * drop-off sequence.
 *
 * ⚠️ EXACTLY TWO THINGS, and the column is why this is answerable at all
 * (Josh, 2026-08-21: "needs to track all of the follow up texts we send, ie
 * only the 30 mins later and 24 hours later ones, nothing else. easy to read
 * that? yes or no?"). Drop-off Attempt is claimed by the backend BEFORE each
 * of those two sends and is written by nothing else — not the resume link, not
 * the insurance upload link, not a rep's own text. So it is the count of
 * automated messages that actually went out, not of messages we intended.
 *
 * Clamped at 2 for the same reason the backend clamps it: the sequence caps
 * there, so a hand-typed 7 in the column is a typo, not a seventh text this
 * patient received — and a tally that reports one would send a rep into a call
 * believing we had hounded somebody.
 */
export function autoTextCount(p: Patient): number {
  const n = Number((p.dropOffAttempt ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.trunc(n), 2);
}

/**
 * "Call Attempts: 2 | Auto. Texts: 1" — Josh's own format, 2026-08-21.
 *
 * ONE builder, because it renders in two places that must agree: the sidebar
 * row and the patient header. They looked at the same column and still drifted
 * before, when only the sidebar had a count and it was labelled "2 tries".
 *
 * Both numbers are printed even at zero. A rep is reading this to decide how
 * hard to push on a call, and "we have not tried" is exactly as load-bearing
 * an answer as "we have tried twice" — an omitted count reads as no data
 * rather than as none.
 */
export function contactTally(p: Patient): string {
  return `Call Attempts: ${attemptCount(p)} | Auto. Texts: ${autoTextCount(p)}`;
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
  /**
   * Order each group by Attempt Counter, least-tried first.
   *
   * Patient Intake passes this, and it exists because that stage has no snooze
   * (see above): nothing ages a patient out, so the queue only grows and a
   * rep working it top-down would re-ring the same people while the bottom
   * never got touched. Least-tried-first is what stops anyone rotting there.
   *
   * ⚠️ Ascending on purpose, and the tie-break matters as much as the sort:
   * `Array.prototype.sort` is stable, so patients on the same count keep
   * Monday's own order — oldest submission first. Newest-first among the
   * untried would read as "speed to lead" and produce exactly the failure this
   * is for, with the oldest untried patient permanently last.
   *
   * The count is rendered on the row too. Sorting a list by a number the rep
   * can't see is its own kind of unexplained behaviour.
   */
  sortByAttempts?: boolean;
}

/** Split the raw patient list into the sidebar's sections. */
export function sidebarSections(
  patients: Patient[],
  { ignoreFollowUp = false, sortByAttempts = false }: SidebarOptions = {},
): SidebarSections {
  const active = ignoreFollowUp
    ? patients
    : patients.filter((p) => p.followUp !== "Done");
  const followUpPatients = ignoreFollowUp
    ? []
    : patients.filter((p) => p.followUp === "Done");

  // Sorted BEFORE grouping, so the order holds inside each referral-source
  // group rather than only across the flat list.
  const activePatients = sortByAttempts
    ? [...active].sort((a, b) => attemptCount(a) - attemptCount(b))
    : active;

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
