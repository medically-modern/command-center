/**
 * Operations burndown — which stage each role bar sits under.
 *
 * The tab used to render 23 bars in registry order, which put Doctor
 * Appointments between Chase and Benefits and left the reader to remember
 * which board each bar lived on. These are the stages of CLAUDE.md §6's
 * patient flow, in the order a patient moves through them; the roles that
 * aren't a pipeline stage of their own — the message/lookup surfaces, the
 * count-only bars, the two side queues — are collected under "Other".
 *
 * ⚠️ THIS LIST DOES NOT DECIDE MEMBERSHIP, and that is the whole design.
 * `groupRoleRows` places every row it is given; a role missing from the table
 * falls through to the fallback group rather than disappearing. A
 * hand-maintained list that has to be updated when the registry grows will not
 * be — CLAUDE.md §5.10 and §5.20 record several separate cases of exactly that
 * shape (Search's group list, the in-system group, the Clean-Up group), each
 * one making real patients invisible with no error anywhere. A role silently
 * absent from the burndown is work nobody can see, so the failure mode here is
 * "shows up in the wrong section", never "shows up nowhere".
 *
 * `operationsGroups.test.ts` asserts the partition against the live registry
 * in both directions: no dead ids here, no unplaced roles there.
 */

/** The group any role not named below falls into. */
export const FALLBACK_GROUP = "Other";

export interface RoleGroup {
  title: string;
  roleIds: string[];
}

export const ROLE_GROUPS: RoleGroup[] = [
  {
    title: "Intake",
    roleIds: ["profile", "unverifiedReferrals", "scheduledCalls", "intakeCleanup"],
  },
  {
    title: "Medical Evaluation",
    roleIds: ["evaluate", "sendRequest", "confirmReceipt", "chaseFax", "chaseParachute"],
  },
  {
    title: "Insurance",
    roleIds: ["benefits", "submitAuth", "authOutstanding", "dvs", "authDenied"],
  },
  {
    title: "Welcome Call",
    roleIds: ["welcomeCall", "finalConfirm"],
  },
  {
    // Also the catch-all — see the warning above.
    title: FALLBACK_GROUP,
    roleIds: [
      "inSystemReferrals", "doctorAppointments", "patientQuestions",
      "fax", "subscription", "updateClinicals", "assignedPatients",
    ],
  },
];

/**
 * Sort per-role rows into their stage sections.
 *
 * Rows keep the order given by ROLE_GROUPS, not the order they arrive in, so
 * the table above is the single place that decides how the tab reads. Each row
 * is stamped with a flat `i` across ALL groups so a stagger animation cascades
 * down the whole page rather than restarting under every heading.
 *
 * Empty groups are dropped, so a build where a whole stage is missing shows
 * nothing rather than a bare heading.
 */
export function groupRoleRows<T extends { role: { id: string } }>(
  rows: T[],
): { title: string; bars: (T & { i: number })[] }[] {
  const byId = new Map(rows.map((r) => [r.role.id, r]));
  const placed = new Set(ROLE_GROUPS.flatMap((g) => g.roleIds));
  const orphans = rows.filter((r) => !placed.has(r.role.id));

  let i = 0;
  return ROLE_GROUPS.map((g) => {
    const listed = g.roleIds
      .map((id) => byId.get(id))
      .filter((r): r is T => !!r);
    const bars = [...listed, ...(g.title === FALLBACK_GROUP ? orphans : [])]
      .map((r) => ({ ...r, i: i++ }));
    return { title: g.title, bars };
  }).filter((g) => g.bars.length > 0);
}
