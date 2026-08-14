/**
 * Monday API layer for System Management — cross-board search & escalation.
 *
 * Queries all 5 boards in the pipeline to find patients by name/phone,
 * detect escalation status, and determine pipeline stage.
 */

import { MONDAY_API_URL, mondayIdentityHeaders } from "../shared/mondayEndpoint";
import { escalationLevelFrom, type EscalationLevel } from "./escalationDetail";
import {
  COMPLETED_STAGE_ROUTES,
  STAGE_COMPLETION_COLUMNS,
  completedAtFromLogs,
  type ActivityLogEntry,
  type CompletedStage,
} from "./stageCompletion";
const MONDAY_API_VERSION = "2024-10";

export type { CompletedStage };

function getToken(): string {
  return (import.meta.env.VITE_MONDAY_API_TOKEN as string | undefined) ?? "";
}

export function hasToken(): boolean {
  return !!getToken();
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("VITE_MONDAY_API_TOKEN is not set");
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
      ...mondayIdentityHeaders(),
      "API-Version": MONDAY_API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("Monday API HTTP error", { status: res.status, body });
    throw new Error(`Monday request failed (${res.status})`);
  }
  const json = await res.json();
  if (json.errors) {
    console.error("Monday API GraphQL error", json.errors);
    throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  }
  return json.data as T;
}

// ── Board definitions ────────────────────────────────────────

export interface BoardDef {
  boardId: number;
  boardName: string;
  /**
   * Where a row NAVIGATES, per group — **not** a list of what to search.
   *
   * Search reads every group on the board (see `fetchBoardItems`). This map
   * only answers "clicking this row goes where", and a group missing from it
   * simply isn't clickable. That asymmetry is deliberate: this list was the
   * fetch filter until 2026-08-12, and every group added to a board after it
   * was written — Insurance's DVS and Stuck, Profile Send Off's Already In
   * System and the two New Form groups, the Stuck group on three boards —
   * became invisible to search with no error. The same class of bug §5.10
   * documents. A list that has to be updated when a board changes will not be.
   */
  groupRoutes: { id: string; title: string; roleRoute: string; isCompleted?: boolean }[];
  /** Column ID for escalation status (null = board has no escalation) */
  escalationColId: string | null;
  /** Column ID for escalation notes long_text (null = board has no escalation notes) */
  escalationNotesColId: string | null;
  /** Column ID for phone */
  phoneColId: string;
  /** Column ID for Stage Advancer (used by masheke to sub-route) */
  stageAdvancerColId: string | null;
  /** Column ID for "Days Since Stage Started" status */
  daysSinceStageColId: string | null;
  /** Column ID for notes (long_text or text) */
  notesColId: string | null;
  /** Column ID for Next Action Date (date column, null = board has none) */
  nextActionDateColId: string | null;
}

/**
 * Maps Stage Advancer values on the Medical Evaluation board
 * to their corresponding role routes.
 */
export const MASHEKE_STAGE_ROUTES: Record<string, string> = {
  "Evaluate MN":    "/evaluate",
  "Send Request":   "/send-request",
  "Confirm Receipt": "/confirm-receipt",
  "Chase Clinicals": "/chase-fax", // chase split June 2026 — deep links keep working via ?patientId injection
};

/** Insurance board Stage Advancer → route */
export const INSURANCE_STAGE_ROUTES: Record<string, string> = {
  "Benefits / SoS":    "/benefits",
  "Submit Auth.":      "/submit-auth",
  "Auth. Outstanding": "/auth-outstanding",
  "Auth Denied":       "/auth-denied",
  // DVS is a STAGE first and a group second: stage-DVS items linger in
  // whichever group the last automation left them (§5.8), so keying off the
  // group alone sent them to /benefits — the one queue useRoleCounts
  // deliberately excludes them from.
  "DVS":               "/dvs",
};

/** Welcome Call board Stage Advancer → route */
export const WELCOME_CALL_STAGE_ROUTES: Record<string, string> = {
  "Welcome Call":    "/welcome-call",
  "Review Profile":  "/welcome-call",
};

/** All stage route maps keyed by board ID */
const STAGE_ROUTE_MAPS: Record<number, Record<string, string>> = {
  18406060017: MASHEKE_STAGE_ROUTES,
  18410601299: INSURANCE_STAGE_ROUTES,
  18410804557: WELCOME_CALL_STAGE_ROUTES,
};


export const BOARDS: BoardDef[] = [
  {
    // Top of the funnel. Read-only here (§3) — no group has a role page — but a
    // patient who hasn't reached Profile Send Off yet is still a patient
    // somebody will search for.
    boardId: 18392794310,
    boardName: "DTC Intake",
    groupRoutes: [
      { id: "group_mkywy9dj", title: "Send To Medical Necessity", roleRoute: "" },
      { id: "group_mkpehq9q", title: "Raw Intake Data",           roleRoute: "" },
      { id: "group_mm2mdqq2", title: "Partial Leads",             roleRoute: "" },
      { id: "group_mkzcvr7a", title: "Cold Lead Campaign",        roleRoute: "" },
      { id: "group_mm1cb9hs", title: "Cold Leads",                roleRoute: "" },
      { id: "group_mkyw7wy8", title: "Stuck Final Review",        roleRoute: "" },
      { id: "group_mkzcc2wg", title: "Can't Proceed / Stuck",     roleRoute: "" },
      { id: "group_mkzcb7bx", title: "Ordered",                   roleRoute: "", isCompleted: true },
    ],
    escalationColId: null,
    escalationNotesColId: null,
    phoneColId: "phone_mkwrkc73",
    stageAdvancerColId: "color_mkyw6287",
    daysSinceStageColId: "color_mkxn3nm5",
    notesColId: "long_text_mm1b4jf7",
    nextActionDateColId: null,
  },
  {
    // Second source for Patient Questions (§7); its patients were unfindable
    // from Search even though the app already reads the board.
    boardId: 18413019028,
    boardName: "Secondary Claims",
    groupRoutes: [
      { id: "group_mm3bydwh", title: "Confirm Secondary Payor",           roleRoute: "" },
      { id: "group_mkpehq9q", title: "Submit Claim",                      roleRoute: "" },
      { id: "group_mm3ba7x1", title: "Send Invoice",                      roleRoute: "" },
      { id: "group_mm2mhysd", title: "Denied",                            roleRoute: "" },
      { id: "group_mkwta260", title: "Patient Responsibility Outstanding", roleRoute: "" },
      { id: "group_mm332zns", title: "Insurance Outstanding",             roleRoute: "" },
      { id: "group_mm3qkck6", title: "Paid but need to EFT",              roleRoute: "" },
      { id: "group_mkxsng4r", title: "Paid And Closed",                   roleRoute: "", isCompleted: true },
      { id: "group_mkp19fyp", title: "Bad Debt",                          roleRoute: "" },
    ],
    escalationColId: null,
    escalationNotesColId: null,
    phoneColId: "phone_mm1znnww",
    stageAdvancerColId: null,
    daysSinceStageColId: "color_mm29awe7",
    notesColId: "long_text_mkzrx7ke",
    nextActionDateColId: "date_mkxpynj",
  },
  {
    boardId: 18407459988,
    boardName: "Subscription Board",
    groupRoutes: [
      { id: "topics",          title: "Subscriptions",       roleRoute: "/subscription" },
      { id: "group_mkp19fyp",  title: "Not Active Patients", roleRoute: "" },
    ],
    escalationColId: null,
    escalationNotesColId: null,
    phoneColId: "phone_mkp0q3cw",
    stageAdvancerColId: null,
    daysSinceStageColId: null,
    notesColId: null,
    nextActionDateColId: null,
  },
  {
    boardId: 18406352652,
    boardName: "Profile Send Off",
    groupRoutes: [
      { id: "group_mm1xf2jb", title: "Intake",                   roleRoute: "/profile" },
      // Already In System is its own group as of 2026-08-12 (§5.10) and routes
      // to its own role page.
      { id: "group_mm64b83h", title: "Already In System",       roleRoute: "/in-system-referrals" },
      { id: "group_mm5z87zt", title: "New Form — Partial Leads", roleRoute: "" },
      { id: "group_mm5zgeak", title: "New Form — Completed",     roleRoute: "" },
      { id: "group_mm4vhqff", title: "Patient Intake",           roleRoute: "" },
      { id: "group_mm1wvq8p", title: "Tests",                    roleRoute: "" },
      { id: "group_mm1xyczx", title: "Stuck",                    roleRoute: "" },
      { id: "group_mm1y57sz", title: "Completed",                roleRoute: "", isCompleted: true },
    ],
    escalationColId: null,
    escalationNotesColId: null,
    phoneColId: "phone_mm1x44yk",
    stageAdvancerColId: null,
    daysSinceStageColId: null,
    notesColId: "text_mm389fs",
    nextActionDateColId: null,
  },
  {
    boardId: 18406060017,
    boardName: "Medical Evaluation",
    groupRoutes: [
      { id: "group_mm1xf2jb", title: "Medical Necessity", roleRoute: "/evaluate" },
      { id: "group_mm1xyczx", title: "Stuck",             roleRoute: "" },
      { id: "group_mm33pdpm", title: "Escalations",       roleRoute: "" },
      { id: "group_mm1x5q4e", title: "Completed",         roleRoute: "", isCompleted: true },
    ],
    escalationColId: "color_mm1x7997",
    escalationNotesColId: "long_text_mm3j43qk",
    phoneColId: "phone_mm1x44yk",
    stageAdvancerColId: "color_mm1wyr92",
    daysSinceStageColId: "color_mm1wwm05",
    notesColId: "long_text_mm27zjt2",
    nextActionDateColId: "date_mm1wadgs",
  },
  {
    boardId: 18410601299,
    boardName: "Insurance",
    groupRoutes: [
      { id: "group_mm1xr3q3", title: "Benefits",         roleRoute: "/benefits" },
      { id: "group_mm1x1416", title: "Submit Auth",       roleRoute: "/submit-auth" },
      { id: "group_mm2v6d1z", title: "Auth Outstanding",  roleRoute: "/auth-outstanding" },
      { id: "group_mm5gp2r2", title: "DVS",               roleRoute: "/dvs" },
      { id: "group_mm316hg2", title: "Auth Denied",       roleRoute: "" },
      { id: "group_mm2vg9gn", title: "Escalations",       roleRoute: "" },
      { id: "group_mm5g7twt", title: "Stuck",             roleRoute: "" },
      { id: "group_mm2vw3c0", title: "Completed",         roleRoute: "", isCompleted: true },
    ],
    escalationColId: "color_mm2vsh2f",
    escalationNotesColId: "long_text_mm3jrssp",
    phoneColId: "phone_mm1x44yk",
    stageAdvancerColId: "color_mm1ws96t",
    daysSinceStageColId: "color_mm1wwm05",
    notesColId: "long_text_mm2ffsme",
    nextActionDateColId: null,
  },
  {
    boardId: 18410804557,
    boardName: "Welcome Call",
    groupRoutes: [
      { id: "group_mm1wvq8p", title: "Welcome Call",               roleRoute: "/welcome-call" },
      { id: "group_mm2x8jtj", title: "Final Profile Confirmation", roleRoute: "/final-confirm" },
      { id: "group_mm1xyczx", title: "Stuck",                      roleRoute: "" },
      { id: "group_mm1x5c0",  title: "Escalation",                 roleRoute: "" },
      { id: "group_mm1x5s5d", title: "Completed",                  roleRoute: "", isCompleted: true },
    ],
    escalationColId: "color_mm1x7997",
    escalationNotesColId: "long_text_mm3jgh1y",
    phoneColId: "phone_mm1x44yk",
    stageAdvancerColId: "color_mm1ws96t",
    daysSinceStageColId: "color_mm1wwm05",
    notesColId: "long_text_mm2ffsme",
    nextActionDateColId: null,
  },
];

// ── Unified patient type ─────────────────────────────────────

export interface SystemPatient {
  id: string;
  name: string;
  phone: string;
  boardId: number;
  boardName: string;
  groupId: string;
  groupTitle: string;
  /** The route to navigate to for this patient's current stage */
  roleRoute: string;
  /** Human-readable pipeline stage label */
  pipelineStage: string;
  /** Whether the patient has an active escalation */
  escalated: boolean;
  /** Raw escalation text (e.g. "Escalation Required") */
  escalationText: string;
  /**
   * Which rung of the ladder — Manager Intervention vs Final Decisions — or
   * `flat` on a board that never split the column. Null iff `escalated` is
   * false; `escalationDetail.test.ts` pins the two against each other.
   */
  escalationLevel: EscalationLevel | null;
  /**
   * Raw escalation notes text (from the retired per-board long_text column).
   *
   * ⚠️ Kept only so the handful of patients carrying a legacy `[ESCALATION
   * FORM]` block can still be read. It is NOT where an escalation's reason
   * lives today — see `escalationDetail.ts`.
   */
  escalationNotes: string;
  /** Whether this patient's role has a dedicated page to navigate to */
  hasPage: boolean;
  /** Whether this patient is in a Completed group */
  isCompleted: boolean;
  /** "Days Since Stage Started" label, e.g. "0–2 Days", "30+ Days" */
  daysSinceStage: string;
  /** Most recent notes text */
  notes: string;
  /** Raw Stage Advancer text from Monday (e.g. "Benefits / SoS") */
  stageAdvancerText: string;
  /** Next Action Date (ISO date string, empty if not set) */
  nextActionDate: string;
}

// ── Fetch all patients across boards ─────────────────────────

interface RawItem {
  id: string;
  name: string;
  group: { id: string; title: string };
  column_values: { id: string; text: string | null; value: string | null }[];
}

/**
 * Every item on the board — ALL groups, deliberately.
 *
 * This used to filter to a hardcoded group list, which is how Insurance's DVS
 * group, three Stuck groups and Profile Send Off's four newer groups became
 * unsearchable the day the board changed. Search is the one place in the app
 * that should never have a queue rule: if a patient is on a board the Command
 * Center works, somebody must be able to find them.
 */
async function fetchBoardItems(board: BoardDef): Promise<SystemPatient[]> {
  const PAGE = 500;
  const colIds = [board.phoneColId];
  if (board.escalationColId) colIds.push(board.escalationColId);
  if (board.escalationNotesColId) colIds.push(board.escalationNotesColId);
  if (board.stageAdvancerColId) colIds.push(board.stageAdvancerColId);
  if (board.daysSinceStageColId) colIds.push(board.daysSinceStageColId);
  if (board.notesColId) colIds.push(board.notesColId);
  if (board.nextActionDateColId) colIds.push(board.nextActionDateColId);

  const query = `
    query ($bid: ID!, $cols: [String!]) {
      boards(ids: [$bid]) {
        items_page(limit: ${PAGE}) {
          cursor
          items {
            id
            name
            group { id title }
            column_values(ids: $cols) { id text value }
          }
        }
      }
    }
  `;

  const data = await gql<{
    boards: { items_page: { cursor: string | null; items: RawItem[] } }[];
  }>(query, { bid: board.boardId, cols: colIds });

  const firstPage = data.boards?.[0]?.items_page?.items ?? [];
  let cursor = data.boards?.[0]?.items_page?.cursor ?? null;
  const allItems: RawItem[] = [...firstPage];

  while (cursor) {
    try {
      const nextQuery = `
        query ($cursor: String!, $cols: [String!]) {
          next_items_page(limit: ${PAGE}, cursor: $cursor) {
            cursor
            items { id name group { id title } column_values(ids: $cols) { id text value } }
          }
        }
      `;
      const next = await gql<{ next_items_page: { cursor: string | null; items: RawItem[] } }>(nextQuery, { cursor, cols: colIds });
      const items = next.next_items_page?.items ?? [];
      cursor = next.next_items_page?.cursor ?? null;
      if (items.length > 0) allItems.push(...items);
    } catch (e) {
      console.error("[fetchBoardItems] pagination error", e);
      break;
    }
  }

  return allItems.map((item) => mapToSystemPatient(item, board));
}

export interface RowRouting {
  /** Human-readable stage for the row. */
  pipelineStage: string;
  /** Role page this row opens, or "" for none. */
  roleRoute: string;
  isCompleted: boolean;
  /** Whether the row has a live page to open (completed rows open their record
   *  through `completedStageForPatient` instead — see stageCompletion.ts). */
  hasPage: boolean;
}

/**
 * Where one search row points. Pure, because it is the part with real rules and
 * a wrong answer here is silent — the row just goes somewhere unhelpful.
 *
 * Group gives the baseline; the **Stage Advancer wins** when it names a stage
 * with its own page, because a board's automations leave items in whichever
 * group they were last moved to. That's what routes a stage-DVS patient sitting
 * in the Benefits group to /dvs, matching the rule useRoleCounts already uses.
 *
 * ⚠️ An unknown group routes NOWHERE, not to "/". Now that search reads every
 * group, unknown ones are routine (a board grows a group, or one is renamed),
 * and the old "/" default would have quietly sent a rep to the app's home page
 * as if the click had worked.
 */
export function rowRouting(
  board: BoardDef,
  group: { id: string; title: string },
  stageAdvancerText: string,
): RowRouting {
  const def = board.groupRoutes.find((g) => g.id === group.id);
  const isCompleted = def?.isCompleted ?? false;
  let pipelineStage = def?.title ?? group.title;
  let roleRoute = def?.roleRoute ?? "";

  const routeMap = STAGE_ROUTE_MAPS[board.boardId] ?? {};
  // Not for completed rows: their advancer reads "Completed"/"Complete", and a
  // finished record must never be described by a live stage.
  if (!isCompleted && stageAdvancerText && routeMap[stageAdvancerText]) {
    roleRoute = routeMap[stageAdvancerText];
    pipelineStage = stageAdvancerText;
  }

  return { pipelineStage, roleRoute, isCompleted, hasPage: roleRoute !== "" && !isCompleted };
}

function mapToSystemPatient(item: RawItem, board: BoardDef): SystemPatient {
  const colVal = (id: string) =>
    item.column_values.find((c) => c.id === id)?.text ?? "";
  /** Selected index of a status column from its raw `value` JSON, or null. */
  const colIndex = (id: string): number | null => {
    const raw = item.column_values.find((c) => c.id === id)?.value;
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { index?: number } | null;
      return typeof parsed?.index === "number" ? parsed.index : null;
    } catch {
      return null;
    }
  };

  const phone = colVal(board.phoneColId);
  const daysSinceStage = board.daysSinceStageColId
    ? colVal(board.daysSinceStageColId)
    : "";
  const notesRaw = board.notesColId
    ? colVal(board.notesColId)
    : "";
  // Strip HTML tags from long_text columns
  const notes = notesRaw.replace(/<[^>]*>/g, "").trim();
  const escalationText = board.escalationColId
    ? colVal(board.escalationColId)
    : "";
  const escalationNotes = board.escalationNotesColId
    ? colVal(board.escalationNotesColId)
    : "";
  // Escalation labels were split (2026-07) on BOTH the Masheke (18406060017)
  // and Insurance (18410601299) boards: index 0 "Manager Escalation Required" /
  // index 2 "Final Escalation Required" (index 1 = Done). Detect by the new
  // labels AND by index on those boards, so a future label rename can't break
  // detection; other boards keep their unchanged text labels.
  const escIndex = board.escalationColId ? colIndex(board.escalationColId) : null;
  const escalated =
    escalationText === "Escalation Required" ||
    escalationText === "Escalate" ||
    escalationText === "Manager Escalation Required" ||
    escalationText === "Final Escalation Required" ||
    ((board.boardId === 18406060017 || board.boardId === 18410601299) &&
      (escIndex === 0 || escIndex === 2));
  // Same inputs as the flag above, so the two can never disagree about who is
  // escalated — a level on a non-escalated row would colour a row nobody
  // escalated, and a null level on an escalated one renders a blank badge.
  const escalationLevel = escalated
    ? escalationLevelFrom(board.boardId, escalationText, escIndex)
    : null;

  const nextActionDate = board.nextActionDateColId
    ? colVal(board.nextActionDateColId)
    : "";
  const stageAdvancerText = board.stageAdvancerColId
    ? colVal(board.stageAdvancerColId)
    : "";
  const { pipelineStage, roleRoute, isCompleted, hasPage } = rowRouting(
    board,
    item.group,
    stageAdvancerText,
  );

  return {
    id: item.id,
    name: item.name,
    phone,
    boardId: board.boardId,
    boardName: board.boardName,
    groupId: item.group.id,
    groupTitle: item.group.title,
    roleRoute,
    pipelineStage,
    escalated,
    escalationText,
    escalationLevel,
    escalationNotes,
    hasPage,
    isCompleted,
    daysSinceStage,
    notes,
    stageAdvancerText,
    nextActionDate,
  };
}

// ── Auth Denied origin lookup via activity log ──────────────

/** Insurance board constants for Auth Denied origin detection */
const INSURANCE_BOARD_ID = 18410601299;
const AUTH_DENIED_GROUP_ID = "group_mm316hg2";
const INSURANCE_STAGE_COL = "color_mm1ws96t";

interface ActivityLog {
  data: string;
}

/**
 * For patients in the Auth Denied group whose Stage Advancer reads "Auth Denied",
 * fetch the activity log to find the *previous* Stage Advancer value — i.e. which
 * stage they were actually in before being moved to Auth Denied.
 *
 * Only queries the Insurance board and only for Auth Denied items, so it adds at
 * most one extra API call.
 */
async function patchAuthDeniedOrigins(patients: SystemPatient[]): Promise<void> {
  const authDeniedPatients = patients.filter(
    (p) =>
      p.boardId === INSURANCE_BOARD_ID &&
      p.groupId === AUTH_DENIED_GROUP_ID &&
      p.pipelineStage.includes("from Auth Denied"),
  );
  if (authDeniedPatients.length === 0) return;

  // Fetch activity logs for the stage advancer column on these items in one call
  const itemIds = authDeniedPatients.map((p) => p.id);
  const data = await gql<{
    boards: { activity_logs: ActivityLog[] }[];
  }>(
    `query ($bid: ID!) {
      boards(ids: [$bid]) {
        activity_logs(limit: 500, column_ids: ["${INSURANCE_STAGE_COL}"], item_ids: [${itemIds.join(",")}]) {
          data
        }
      }
    }`,
    { bid: INSURANCE_BOARD_ID },
  );

  const logs = data.boards?.[0]?.activity_logs ?? [];

  // For each Auth Denied patient, walk the logs to find the stage value
  // immediately *before* it was set to "Auth Denied".
  for (const patient of authDeniedPatients) {
    let previousStage: string | null = null;
    for (const log of logs) {
      try {
        const d = JSON.parse(log.data);
        const itemId = String(d.pulse_id ?? d.item_id ?? "");
        if (itemId !== patient.id) continue;
        const currLabel = d.value?.label?.text ?? "";
        const prevLabel = d.previous_value?.label?.text ?? "";
        // Find the log entry where stage changed TO "Auth Denied"
        if (currLabel === "Auth Denied" && prevLabel && prevLabel !== "Auth Denied") {
          previousStage = prevLabel;
          break;
        }
      } catch {
        // skip malformed log entries
      }
    }

    if (previousStage) {
      patient.pipelineStage = `Auth Denied (from ${previousStage})`;
      // Also update the route to point to the origin stage's page
      const routeMap = STAGE_ROUTE_MAPS[INSURANCE_BOARD_ID] ?? {};
      if (routeMap[previousStage]) {
        patient.roleRoute = routeMap[previousStage];
        patient.hasPage = true;
      }
    }
  }
}

/**
 * Fetch all active patients across all 5 boards.
 * Returns a flat array of SystemPatient objects.
 */
export async function fetchAllPatients(): Promise<SystemPatient[]> {
  if (!hasToken()) return [];
  const results = await Promise.all(BOARDS.map(fetchBoardItems));
  const patients = results.flat();
  // Patch Auth Denied patients with their real origin stage from activity logs
  await patchAuthDeniedOrigins(patients);
  return patients;
}


// ── Escalation write ─────────────────────────────────────────

/**
 * Remove escalation from a patient (set escalation column to "Done").
 * Patients stay in their current group — no group moves needed.
 */
export async function removeEscalation(
  patient: Pick<SystemPatient, "id" | "boardId">,
): Promise<void> {
  const board = BOARDS.find((b) => b.boardId === patient.boardId);
  if (!board?.escalationColId) {
    throw new Error("This board has no escalation column");
  }

  // Set the escalation status to index 1 ("Done") to clear it
  const value = JSON.stringify({ index: 1 });
  await gql(
    `mutation { change_column_value(item_id: ${patient.id}, board_id: ${patient.boardId}, column_id: "${board.escalationColId}", value: ${JSON.stringify(value)}) { id } }`,
  );

  // Also set next action date to today so the patient appears in active view
  if (board.nextActionDateColId) {
    const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
    const dateValue = JSON.stringify({ date: today });
    await gql(
      `mutation { change_column_value(item_id: ${patient.id}, board_id: ${patient.boardId}, column_id: "${board.nextActionDateColId}", value: ${JSON.stringify(dateValue)}) { id } }`,
    );
  }
}


// ── Stage advancer write ────────────────────────────────────

/**
 * Write a new Stage Advancer value for a patient on a given board.
 * Uses label-based write so we don't need to know the index.
 */
export async function writeStageAdvancer(
  patient: Pick<SystemPatient, "id" | "boardId">,
  newStageLabel: string,
): Promise<void> {
  const board = BOARDS.find((b) => b.boardId === patient.boardId);
  if (!board?.stageAdvancerColId) {
    throw new Error("This board has no Stage Advancer column");
  }
  const value = JSON.stringify({ label: newStageLabel });
  await gql(
    `mutation { change_column_value(item_id: ${patient.id}, board_id: ${patient.boardId}, column_id: "${board.stageAdvancerColId}", value: ${JSON.stringify(value)}) { id } }`,
  );
}

/** Valid stage labels per board for the Stage Manager */
export const STAGE_OPTIONS: Record<number, string[]> = {
  18406060017: ["Evaluate MN", "Send Request", "Confirm Receipt", "Chase Clinicals"],
  18410601299: ["Benefits / SoS", "Submit Auth.", "Auth. Outstanding", "Auth Denied"],
};

/** "Stuck" label per board (differs between boards) */
export const STUCK_LABELS: Record<number, string> = {
  18406060017: "Stuck",
  18410601299: "Stuck / Don't Proceed",
  18410804557: "Stuck / Don't Proceed",
};

// ── Completion map helper ────────────────────────────────────

/** Short labels for each board's completed stage */
const BOARD_COMPLETION_LABELS: Record<number, string> = {
  18406352652: "Profile",
  18406060017: "MN",
  18410601299: "Insurance",
  18410804557: "Welcome Call",
};

/**
 * Build a map of patient name → the boards they've already finished.
 *
 * Keyed by NAME because a patient is a different Monday item on every board
 * (§6) — the completed Medical Evaluation item and the live Insurance item
 * share nothing but the name. Each entry carries that completed item's own id
 * and board so a badge can open the record it stands for.
 */
export function buildCompletionMap(
  patients: SystemPatient[],
): Map<string, CompletedStage[]> {
  const map = new Map<string, CompletedStage[]>();
  for (const p of patients) {
    if (!p.isCompleted) continue;
    const label = BOARD_COMPLETION_LABELS[p.boardId] ?? p.boardName;
    const key = p.name.trim().toLowerCase();
    if (!map.has(key)) map.set(key, []);
    const arr = map.get(key)!;
    // One badge per board: a patient who ran a board twice leaves two completed
    // items, and the badge stands for the stage, not the attempt.
    if (arr.some((s) => s.label === label)) continue;
    arr.push({
      label,
      itemId: p.id,
      boardId: p.boardId,
      boardName: p.boardName,
      route: COMPLETED_STAGE_ROUTES[p.boardId] ?? "",
    });
  }
  return map;
}

// ── "When was this stage completed?" ─────────────────────────

/**
 * Read the completion instant for one finished item out of Monday's activity
 * log. Returns null when the log has aged out — no board carries a "completed
 * on" column, so this lookup is the only source and the caller must be able to
 * render "date unavailable".
 *
 * One request per lookup, made on demand when a completed record is opened.
 */
export async function fetchStageCompletedAt(
  boardId: number,
  itemId: string,
): Promise<string | null> {
  if (!hasToken()) return null;
  const board = BOARDS.find((b) => b.boardId === boardId);
  if (!board) return null;

  const data = await gql<{ boards: { activity_logs: ActivityLogEntry[] }[] }>(
    `query ($bid: ID!, $iid: ID!) {
      boards(ids: [$bid]) {
        activity_logs(limit: 200, item_ids: [$iid]) { event created_at data }
      }
    }`,
    { bid: boardId, iid: itemId },
  );

  const logs = data.boards?.[0]?.activity_logs ?? [];
  return completedAtFromLogs(logs, {
    completedGroupIds: board.groupRoutes.filter((g) => g.isCompleted).map((g) => g.id),
    column: STAGE_COMPLETION_COLUMNS[boardId] ?? null,
  });
}
