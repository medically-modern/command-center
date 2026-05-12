/**
 * Monday API layer for System Management — cross-board search & escalation.
 *
 * Queries all 5 boards in the pipeline to find patients by name/phone,
 * detect escalation status, and determine pipeline stage.
 */

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-10";

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
  /** Active groups to query (skip Completed/Stuck/Escalation groups) */
  activeGroups: { id: string; title: string; roleRoute: string; isCompleted?: boolean }[];
  /** Column ID for escalation status (null = board has no escalation) */
  escalationColId: string | null;
  /** Column ID for phone */
  phoneColId: string;
  /** Column ID for Stage Advancer (used by masheke to sub-route) */
  stageAdvancerColId: string | null;
  /** Column ID for "Days Since Stage Started" status */
  daysSinceStageColId: string | null;
  /** Column ID for notes (long_text or text) */
  notesColId: string | null;
}

/**
 * Maps Stage Advancer values on the Medical Evaluation board
 * to their corresponding role routes.
 */
export const MASHEKE_STAGE_ROUTES: Record<string, string> = {
  "Evaluate MN":    "/evaluate",
  "Send Request":   "/send-request",
  "Confirm Receipt": "/confirm-receipt",
  "Chase Clinicals": "/chase-benefits",
};

/** Insurance board Stage Advancer → route */
export const INSURANCE_STAGE_ROUTES: Record<string, string> = {
  "Benefits / SoS":    "/benefits",
  "Submit Auth.":      "/submit-auth",
  "Auth. Outstanding": "/auth-outstanding",
  "Auth Denied":       "/auth-denied",
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


/**
 * Stage Advancer text → Monday group ID, per board.
 * Used during de-escalation to move the patient back to the correct group.
 */
const STAGE_GROUP_MAPS: Record<number, Record<string, string>> = {
  // Medical Evaluation board
  18406060017: {
    "Evaluate MN":     "group_mm1xf2jb",  // Medical Necessity
    "Send Request":    "group_mm1xf2jb",  // same group, sub-stage routing
    "Confirm Receipt": "group_mm1xf2jb",
    "Chase Clinicals": "group_mm1xf2jb",
  },
  // Insurance board
  18410601299: {
    "Benefits / SoS":    "group_mm1xr3q3",
    "Submit Auth.":      "group_mm1x1416",
    "Auth. Outstanding": "group_mm2v6d1z",
    "Auth Denied":       "group_mm316hg2",
  },
  // Welcome Call board
  18410804557: {
    "Welcome Call":    "group_mm1wvq8p",
    "Review Profile":  "group_mm1wvq8p",
  },
};

export const BOARDS: BoardDef[] = [
  {
    boardId: 18407459988,
    boardName: "Subscription Board",
    activeGroups: [
      { id: "topics", title: "Subscriptions", roleRoute: "/subscription" },
    ],
    escalationColId: null,
    phoneColId: "phone_mkp0q3cw",
    stageAdvancerColId: null,
    daysSinceStageColId: null,
    notesColId: null,
  },
  {
    boardId: 18406352652,
    boardName: "Profile Send Off",
    activeGroups: [
      { id: "group_mm1xf2jb", title: "Intake", roleRoute: "/profile" },
      { id: "group_mm1y57sz", title: "Completed", roleRoute: "", isCompleted: true },
    ],
    escalationColId: null,
    phoneColId: "phone_mm1x44yk",
    stageAdvancerColId: null,
    daysSinceStageColId: null,
    notesColId: "text_mm389fs",
  },
  {
    boardId: 18406060017,
    boardName: "Medical Evaluation",
    activeGroups: [
      { id: "group_mm1xf2jb", title: "Medical Necessity", roleRoute: "/evaluate" },
      { id: "group_mm33pdpm", title: "Escalations",       roleRoute: "" },
      { id: "group_mm1x5q4e", title: "Completed",         roleRoute: "", isCompleted: true },
    ],
    escalationColId: "color_mm1x7997",
    phoneColId: "phone_mm1x44yk",
    stageAdvancerColId: "color_mm1wyr92",
    daysSinceStageColId: "color_mm1wwm05",
    notesColId: "long_text_mm27zjt2",
  },
  {
    boardId: 18410601299,
    boardName: "Insurance",
    activeGroups: [
      { id: "group_mm1xr3q3", title: "Benefits",         roleRoute: "/benefits" },
      { id: "group_mm1x1416", title: "Submit Auth",       roleRoute: "/submit-auth" },
      { id: "group_mm2v6d1z", title: "Auth Outstanding",  roleRoute: "/auth-outstanding" },
      { id: "group_mm316hg2", title: "Auth Denied",       roleRoute: "" },
      { id: "group_mm2vg9gn", title: "Escalations",       roleRoute: "" },
      { id: "group_mm2vw3c0", title: "Completed",         roleRoute: "", isCompleted: true },
    ],
    escalationColId: "color_mm2vsh2f",
    phoneColId: "phone_mm1x44yk",
    stageAdvancerColId: "color_mm1ws96t",
    daysSinceStageColId: "color_mm1wwm05",
    notesColId: "long_text_mm2ffsme",
  },
  {
    boardId: 18410804557,
    boardName: "Welcome Call",
    activeGroups: [
      { id: "group_mm1wvq8p", title: "Welcome Call",               roleRoute: "/welcome-call" },
      { id: "group_mm2x8jtj", title: "Final Profile Confirmation", roleRoute: "/final-confirm" },
      { id: "group_mm1x5c0",  title: "Escalation",                 roleRoute: "" },
      { id: "group_mm1x5s5d", title: "Completed",                  roleRoute: "", isCompleted: true },
    ],
    escalationColId: "color_mm1x7997",
    phoneColId: "phone_mm1x44yk",
    stageAdvancerColId: "color_mm1ws96t",
    daysSinceStageColId: "color_mm1wwm05",
    notesColId: "long_text_mm2ffsme",
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
  /** Whether this patient's role has a dedicated page to navigate to */
  hasPage: boolean;
  /** Whether this patient is in a Completed group */
  isCompleted: boolean;
  /** "Days Since Stage Started" label, e.g. "0–2 Days", "30+ Days" */
  daysSinceStage: string;
  /** Most recent notes text */
  notes: string;
  /** Whether this patient is in an Escalation group */
  isInEscalationGroup: boolean;
  /** Raw Stage Advancer text from Monday (e.g. "Benefits / SoS") */
  stageAdvancerText: string;
}

// ── Fetch all patients across boards ─────────────────────────

interface RawItem {
  id: string;
  name: string;
  group: { id: string; title: string };
  column_values: { id: string; text: string | null; value: string | null }[];
}

async function fetchBoardItems(board: BoardDef): Promise<SystemPatient[]> {
  const groupIds = board.activeGroups.map((g) => g.id);
  const colIds = [board.phoneColId];
  if (board.escalationColId) colIds.push(board.escalationColId);
  if (board.stageAdvancerColId) colIds.push(board.stageAdvancerColId);
  if (board.daysSinceStageColId) colIds.push(board.daysSinceStageColId);
  if (board.notesColId) colIds.push(board.notesColId);

  const compareValue = JSON.stringify(groupIds);
  const query = `
    query ($bid: ID!, $cols: [String!]) {
      boards(ids: [$bid]) {
        items_page(limit: 500, query_params: { rules: [{ column_id: "group", compare_value: ${compareValue} }] }) {
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
    boards: { items_page: { items: RawItem[] } }[];
  }>(query, { bid: board.boardId, cols: colIds });

  const items = data.boards?.[0]?.items_page?.items ?? [];
  return items.map((item) => mapToSystemPatient(item, board));
}

function mapToSystemPatient(item: RawItem, board: BoardDef): SystemPatient {
  const colVal = (id: string) =>
    item.column_values.find((c) => c.id === id)?.text ?? "";

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
  const escalated =
    escalationText === "Escalation Required" ||
    escalationText === "Escalate";

  // Determine pipeline stage + route
  const groupDef = board.activeGroups.find((g) => g.id === item.group.id);
  let pipelineStage = groupDef?.title ?? item.group.title;
  let roleRoute = groupDef?.roleRoute ?? "/";
  const isCompleted = groupDef?.isCompleted ?? false;
  const isInEscalationGroup = !isCompleted && (groupDef?.roleRoute === "") && 
    (groupDef?.title?.toLowerCase().includes("escalat") ?? false);

  // Use Stage Advancer to determine sub-route and pipeline stage.
  // This is critical for escalation/completed groups where the group
  // itself doesn't tell us which stage the patient was in.
  let stageAdvancerText = "";
  if (board.stageAdvancerColId) {
    const stageText = colVal(board.stageAdvancerColId);
    stageAdvancerText = stageText;
    const routeMap = STAGE_ROUTE_MAPS[board.boardId] ?? {};
    if (stageText && routeMap[stageText]) {
      roleRoute = routeMap[stageText];
      // Show "Escalations (from Benefits)" style label for escalation groups
      if (groupDef && !groupDef.isCompleted && groupDef.roleRoute === "") {
        pipelineStage = `${groupDef.title} (from ${stageText})`;
      } else {
        pipelineStage = stageText;
      }
    }
  }

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
    hasPage: roleRoute !== "" && !isCompleted,
    isCompleted,
    daysSinceStage,
    notes,
    isInEscalationGroup,
    stageAdvancerText,
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


/**
 * Move an item to a different group on the same board.
 */
async function moveItemToGroup(itemId: string, groupId: string): Promise<void> {
  await gql(
    `mutation ($itemId: ID!, $groupId: String!) { move_item_to_group(item_id: $itemId, group_id: $groupId) { id } }`,
    { itemId, groupId },
  );
}

// ── Escalation write ─────────────────────────────────────────

/**
 * Remove escalation from a patient (set escalation column to blank/Done).
 */
export async function removeEscalation(
  patient: Pick<SystemPatient, "id" | "boardId" | "groupId" | "isInEscalationGroup"> & { stageAdvancerText?: string },
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

  // If patient is currently in an Escalation group, move them back to the
  // group they were in when escalated. The Stage Advancer column tells us
  // which bucket they came from.
  if (patient.isInEscalationGroup && patient.stageAdvancerText) {
    const groupMap = STAGE_GROUP_MAPS[patient.boardId];
    const targetGroup = groupMap?.[patient.stageAdvancerText];
    if (targetGroup) {
      await moveItemToGroup(patient.id, targetGroup);
    }
  }
}


// ── Completion map helper ────────────────────────────────────

/** Short labels for each board's completed stage */
const BOARD_COMPLETION_LABELS: Record<number, string> = {
  18406352652: "Profile",
  18406060017: "MN",
  18410601299: "Insurance",
  18410804557: "Welcome Call",
};

/**
 * Build a map of patient name → list of completed board labels.
 * Used to show completion badges on search results.
 */
export function buildCompletionMap(
  patients: SystemPatient[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const p of patients) {
    if (!p.isCompleted) continue;
    const label = BOARD_COMPLETION_LABELS[p.boardId] ?? p.boardName;
    const key = p.name.trim().toLowerCase();
    if (!map.has(key)) map.set(key, []);
    const arr = map.get(key)!;
    if (!arr.includes(label)) arr.push(label);
  }
  return map;
}
