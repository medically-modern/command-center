/**
 * Where a System Management → Search row OPENS — the full URL, or null when
 * nothing in the Command Center can show it.
 *
 * Search is a MANAGER's tool (Josh, 2026-09-03), so a row opens the same screen
 * Pipeline Oversight opens for that patient, not the rep's plain page:
 *
 * | row                                  | opens                                                    |
 * |--------------------------------------|----------------------------------------------------------|
 * | finished record (Completed group)    | the board's review page, `?completedStage=` (read-only)  |
 * | stuck — Stuck group / Stuck advancer | its stage page (or the board's canonical page when the   |
 * |   / Proposed Stuck (escalation Final)| Stuck group has none) as **Final Decisions**: `?mv=final-decisions&manager=1`, the view with Approve Stuck / Return to Queue — Gregory White's screen |
 * | escalated (Manager Intervention)     | its stage page as **Manager Intervention**: `?mv=manager-intervention&manager=1&escalated=1` |
 * | ordinary live work                   | its stage page, plain                                    |
 * | anything else                        | null → Search renders a "check Monday" note              |
 *
 * ⚠️ These params are OversightTab's `handlePatientClick` contract, read by
 * every stage page through `lib/shared/managerOrigin` and `?manager=1`. Adding a
 * param here that Oversight does not send (or vice versa) makes the two entry
 * points open different screens for the same patient; keep them aligned.
 *
 * ⚠️ A patient parked in a Stuck GROUP has `roleRoute ""` (no queue lists that
 * group), so the fallback is the board's canonical page from
 * `COMPLETED_STAGE_ROUTES` — Evaluate / Benefits / Welcome Call / Profile. The
 * stage pages inject a deep-linked `?patientId=` whatever group it sits in, so
 * the profile renders, and the Final Decisions action bar is the way back to
 * the pipeline. Stuck patients on the other three boards (DTC Intake, Secondary
 * Claims, Subscription) have no canonical page and stay a note.
 */
import { MANAGER_ORIGIN_PARAM } from "@/lib/shared/managerOrigin";
import type { SystemPatient } from "./mondayApi";
import { searchBucket } from "./searchBuckets";
import {
  COMPLETED_STAGE_ROUTES,
  completedStageForPatient,
  completedStageUrl,
} from "./stageCompletion";

export type OpenableRow = Pick<
  SystemPatient,
  | "id" | "boardId" | "boardName" | "groupId" | "isCompleted" | "hasPage"
  | "roleRoute" | "stageAdvancerText" | "escalated" | "escalationLevel"
>;

export function searchOpenUrl(p: OpenableRow): string | null {
  const completed = completedStageForPatient(p);
  if (completed) return completedStageUrl(completed);

  const params = new URLSearchParams({ patientId: p.id, from: "system-mgmt" });
  const bucket = searchBucket(p);

  if (bucket === "stuck") {
    const route = (p.hasPage && p.roleRoute) || COMPLETED_STAGE_ROUTES[p.boardId] || "";
    if (!route) return null;
    params.set(MANAGER_ORIGIN_PARAM, "final-decisions");
    params.set("manager", "1");
    if (p.escalated) params.set("escalated", "1");
    return `${route}?${params.toString()}`;
  }

  if (!p.hasPage || !p.roleRoute) return null;

  if (p.escalated) {
    // Index 0 (Manager Intervention) — and Welcome Call's single un-split
    // label, which has no rung but is a manager's patient all the same.
    params.set(MANAGER_ORIGIN_PARAM, "manager-intervention");
    params.set("manager", "1");
    params.set("escalated", "1");
  }
  return `${p.roleRoute}?${params.toString()}`;
}

/**
 * Can a rep OPEN this row? Everything that cannot — every DTC Intake and
 * Secondary Claims row, Subscription "Not Active", Profile Send Off "Patient
 * Intake" — used to render as a full profile row that dead-ended on a toast:
 * "shouldn't show a profile unless we have a UI for it" (Josh, 2026-09-03).
 * Search renders those as a NOTE instead — in the system, here is the board
 * and group, check Monday — rather than dropping them, because "not found"
 * would be a lie about a patient we can see.
 */
export function rowIsWorkable(p: OpenableRow): boolean {
  return searchOpenUrl(p) !== null;
}

/** Workable profiles first, then the "check Monday" notes, each in rank order. */
export function workableFirst<T extends OpenableRow>(rows: readonly T[]): T[] {
  const yes: T[] = [];
  const no: T[] = [];
  for (const r of rows) (rowIsWorkable(r) ? yes : no).push(r);
  return [...yes, ...no];
}
