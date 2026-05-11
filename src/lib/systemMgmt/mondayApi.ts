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

export const BOARDS: BoardDef[] = [
  {
    boardId: 18407459988,
    boardName: "Subscription Board",
    activeGroups: [
      { id: "topics", title: "Subscriptions", roleRoute: "" },
    ],
    escalationColId: null, // "Auth Escalation Management" is NOT a pipeline escalation
    phoneColId: "phone_mkp0q3cw",
    stageAdvancerColId: null,
  },
  {
    boardId: 18406352652,
    boardName: "Profile Send Off",
    activeGroups: [
      { id: "group_mm1xf2jb", title: "Intake", roleRoute: "/profile" },
      { id: "group_mm1y57sz", title: "Completed", roleRoute: "", isCompleted: true },
    ],
    escalationColId: null, // No escalation column
    phoneColId: "phone_mm1x44yk",
    stageAdvancerColId: null,
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

  // Use Stage Advancer to determine sub-route and pipeline stage.
  // This is critical for escalation/completed groups where the group
  // itself doesn't tell us which stage the patient was in.
  if (board.stageAdvancerColId) {
    const stageText = colVal(board.stageAdvancerColId);
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
  };
}

/**
 * Fetch all active patients across all 5 boards.
 * Returns a flat array of SystemPatient objects.
 */
export async function fetchAllPatients(): Promise<SystemPatient[]> {
  if (!hasToken()) return [];
  const results = await Promise.all(BOARDS.map(fetchBoardItems));
  return results.flat();
}

// ── Escalation write ─────────────────────────────────────────

/**
 * Remove escalation from a patient (set escalation column to blank/Done).
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
