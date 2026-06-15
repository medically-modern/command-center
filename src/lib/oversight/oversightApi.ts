// Oversight dashboard API — fetches patients across 5 Monday boards,
// buckets them by "days in stage", and returns chart-ready data.

// ── Monday API plumbing ─────────────────────────────────────────────────

import { MONDAY_API_URL, mondayIdentityHeaders } from "../shared/mondayEndpoint";
const MONDAY_API_VERSION = "2024-10";

function getToken(): string {
  return (import.meta.env.VITE_MONDAY_API_TOKEN as string | undefined) ?? "";
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
    console.error("[oversightApi] Monday HTTP error", { status: res.status, body });
    throw new Error(`Monday request failed (${res.status})`);
  }
  const json = await res.json();
  if (json.errors) {
    console.error("[oversightApi] Monday GraphQL error", json.errors);
    throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  }
  return json.data as T;
}

// ── Day-bucket constants ────────────────────────────────────────────────

export const DAY_BUCKET_LABELS = [
  "0–2 Days",
  "3–5 Days",
  "6–8 Days",
  "9–12 Days",
  "13-15 Days",
  "16-20 Days",
  "21-29 Days",
  "30+ Days",
] as const;

export type DayBucketLabel = (typeof DAY_BUCKET_LABELS)[number];

export const DAY_BUCKET_COLORS: Record<DayBucketLabel, string> = {
  "0–2 Days": "#22c55e",
  "3–5 Days": "#84cc16",
  "6–8 Days": "#eab308",
  "9–12 Days": "#f97316",
  "13-15 Days": "#ef4444",
  "16-20 Days": "#dc2626",
  "21-29 Days": "#b91c1c",
  "30+ Days": "#7f1d1d",
};

// ── Data types ──────────────────────────────────────────────────────────

export interface OversightPatient {
  id: string;
  name: string;
  boardId: number;
  groupId: string;
  dayBucket: DayBucketLabel | "Unknown";
  /** Raw column values keyed by column ID */
  cols: Record<string, string>;
}

export interface ChartDef {
  id: string;
  title: string;
  boardId: number;
  /** Column IDs to display in drill-down table, with display labels */
  drilldownCols: { colId: string; label: string }[];
  /** Optional column ID for a notes/long-text field shown via icon popover */
  notesColId?: string;
}

// ── Chart definitions (12 charts) ───────────────────────────────────────

export const CHART_DEFS: ChartDef[] = [
  // ── Board 18392794310 (DtC) ──
  {
    id: "dtc-partial-leads",
    title: "DtC Partial Leads",
    boardId: 18392794310,
    notesColId: "long_text_mkzmxx3t",
    drilldownCols: [
      { colId: "date_mm1ftf0f", label: "Intake Date" },
      { colId: "text_mm2me552", label: "Last Seen" },
      { colId: "color_mm2mjnhp", label: "Drop-off Page" },
      { colId: "multi_selectemye8jl3", label: "Issue Facing" },
      { colId: "dropdown_mm0adspd", label: "Uses Insulin?" },
      { colId: "color_mm2kfyeg", label: "CGM Monitoring" },
      { colId: "color_mm2kaes", label: "Pump Scenario" },
    ],
  },
  {
    id: "dtc-raw-intake",
    title: "DtC Raw Intake Data",
    boardId: 18392794310,
    notesColId: "long_text_mkzmxx3t",
    drilldownCols: [
      { colId: "date_mm1ftf0f", label: "Intake Date" },
      { colId: "color_mkywv02j", label: "Referral Source" },
      { colId: "color_mky1a991", label: "Request" },
      { colId: "color_mkzbynsv", label: "Intake Call" },
      { colId: "rc_last_call_qjfe", label: "Last Call" },
      { colId: "ring_central_xyyv", label: "Total Calls" },
    ],
  },

  // ── Board 18406352652 (Profile Send Off) ──
  {
    id: "profile-send-off",
    title: "Profile Send Off",
    boardId: 18406352652,
    notesColId: "text_mm389fs",
    drilldownCols: [
      { colId: "date_mm1wf43j", label: "Intake Date" },
      { colId: "color_mm1w5wxr", label: "Referral Source" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "color_mm1xg10n", label: "Primary Insurance" },
      { colId: "color_mm1yeksx", label: "Run Stedi" },
      { colId: "text_mm1xhymg", label: "Prior Auth Req?" },
      { colId: "color_mm1zmeb3", label: "Move to Onboarding" },
    ],
  },

  // ── Board 18406060017 (Medical Necessity) ──
  {
    id: "evaluate",
    title: "Evaluate",
    boardId: 18406060017,
    notesColId: "long_text_mm27zjt2",
    drilldownCols: [
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "color_mm1wf7rv", label: "Diagnosis" },
      { colId: "color_mm1y8rv8", label: "MRs / Clinicals" },
      { colId: "date_mm1wb9br", label: "Last Visit" },
      { colId: "date_mm1ymthz", label: "MR Expiry" },
      { colId: "color_mm1w7e5q", label: "CGM Path" },
      { colId: "color_mm1w5xn1", label: "IP Path" },
      { colId: "color_mm1y6qrf", label: "Medical Necessity" },
    ],
  },
  {
    id: "send-request",
    title: "Send Request",
    boardId: 18406060017,
    notesColId: "long_text_mm27zjt2",
    drilldownCols: [
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "color_mm1y6qrf", label: "Medical Necessity" },
      { colId: "color_mm1xw7y5", label: "Clinicals Method" },
      { colId: "text_mm1x46et", label: "Doctor Name" },
      { colId: "email_mm1xdzcj", label: "Doctor Fax" },
      { colId: "color_mm2y7t2x", label: "Send Request" },
    ],
  },
  {
    id: "confirm-receipt",
    title: "Confirm Receipt",
    boardId: 18406060017,
    notesColId: "long_text_mm2ytsxp",
    drilldownCols: [
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "date_mm2yg8x8", label: "Request Sent" },
      { colId: "color_mm1xw7y5", label: "Clinicals Method" },
      { colId: "text_mm1wj9at", label: "Confirmed By" },
      { colId: "date_mm1wxpdk", label: "Confirmed Date" },
      { colId: "date_mm1wadgs", label: "Next Action" },
    ],
  },
  {
    id: "chase-clinicals",
    title: "Chase Clinicals",
    boardId: 18406060017,
    notesColId: "long_text_mm2ytsxp",
    drilldownCols: [
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "date_mm1wxpdk", label: "Receipt Confirmed" },
      { colId: "color_mm1wz0vg", label: "MN Attempts" },
      { colId: "text_mm1wabj9", label: "Chase Recipient" },
      { colId: "date_mm1ymthz", label: "MR Expiry" },
      { colId: "date_mm1wadgs", label: "Next Action" },
    ],
  },

  // ── Board 18410601299 (Insurance / Auth) ──
  {
    id: "benefits",
    title: "Benefits",
    boardId: 18410601299,
    notesColId: "long_text_mm2ffsme",
    drilldownCols: [
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "color_mm1x157j", label: "Primary Insurance" },
      { colId: "color_mm2vhwan", label: "Active/Network" },
      { colId: "color_mm2vt8xg", label: "DME Benefits" },
      { colId: "color_mm2vemyy", label: "SoS" },
      { colId: "color_mm2vg3ew", label: "Auth" },
    ],
  },
  {
    id: "submit-auth",
    title: "Submit Auth",
    boardId: 18410601299,
    notesColId: "long_text_mm2ffsme",
    drilldownCols: [
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "color_mm1x157j", label: "Primary Insurance" },
      { colId: "color_mm1wgjd1", label: "CGM Auth Result" },
      { colId: "color_mm1xnzmn", label: "IP Auth Result" },
      { colId: "text_mm2wmc1z", label: "CGM Auth Submit Date" },
      { colId: "text_mm2w72r6", label: "IP Auth Submit Date" },
    ],
  },
  {
    id: "auth-outstanding",
    title: "Auth Outstanding",
    boardId: 18410601299,
    notesColId: "long_text_mm2ffsme",
    drilldownCols: [
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "color_mm1wgjd1", label: "CGM Auth Result" },
      { colId: "color_mm1xnzmn", label: "IP Auth Result" },
      { colId: "text_mm1w1d5p", label: "Monitor Auth ID" },
      { colId: "text_mm1xmj8x", label: "IP Auth ID" },
    ],
  },
  {
    id: "auth-denial",
    title: "Auth Denial",
    boardId: 18410601299,
    notesColId: "long_text_mm3jrssp",
    drilldownCols: [
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "date_mm27ha6a", label: "First Denied" },
      { colId: "long_text_mm27hjey", label: "Denial Reason" },
      { colId: "numeric_mm27nexq", label: "Retry Count" },
      { colId: "date_mm27krnc", label: "Retry Next Date" },
      { colId: "color_mm2vsh2f", label: "Escalation" },
    ],
  },

  // ── Board 18410804557 (Welcome Call / Order) ──
  {
    id: "welcome-call",
    title: "Welcome Call",
    boardId: 18410804557,
    notesColId: "long_text_mm2ffsme",
    drilldownCols: [
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "color_mm1xnzmn", label: "IP Auth Result" },
      { colId: "color_mm1wgjd1", label: "CGM Auth Result" },
      { colId: "color_mm1xbqth", label: "Subscription Type" },
      { colId: "color_mm1xtqvv", label: "Welcome Call Text" },
      { colId: "color_mm2776fg", label: "Order Handling" },
      { colId: "color_mm301cpp", label: "Advance?" },
      { colId: "phone_mm1x44yk", label: "Pt. Phone" },
    ],
  },
];

// ── Day-bucket derivation helpers ───────────────────────────────────────

function daysToBucket(days: number): DayBucketLabel {
  if (days <= 2) return "0–2 Days";
  if (days <= 5) return "3–5 Days";
  if (days <= 8) return "6–8 Days";
  if (days <= 12) return "9–12 Days";
  if (days <= 15) return "13-15 Days";
  if (days <= 20) return "16-20 Days";
  if (days <= 29) return "21-29 Days";
  return "30+ Days";
}

function parseDayLabel(text: string): DayBucketLabel | "Unknown" {
  // Handle "Day X" format from DTC board
  const match = text.match(/Day\s+(\d+)/i);
  if (match) return daysToBucket(parseInt(match[1], 10));
  // Handle standard "X–Y Days" format already matching a bucket label
  if ((DAY_BUCKET_LABELS as readonly string[]).includes(text)) return text as DayBucketLabel;
  return "Unknown";
}

function dateToBucket(dateStr: string): DayBucketLabel | "Unknown" {
  if (!dateStr) return "Unknown";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "Unknown";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  const days = Math.floor((today.getTime() - d.getTime()) / 86400000);
  if (days < 0) return "0–2 Days";
  return daysToBucket(days);
}

// ── Board / group configuration ─────────────────────────────────────────

/** Which groups to fetch per board */
const BOARD_GROUPS: Record<number, string[]> = {
  18392794310: ["group_mm2mdqq2", "group_mkpehq9q"],
  18406352652: ["group_mm1xf2jb"],
  18406060017: ["group_mm1xf2jb"],
  18410601299: ["group_mm1xr3q3", "group_mm1x1416", "group_mm2v6d1z", "group_mm316hg2"],
  18410804557: ["group_mm1wvq8p"],
};

/** Stage Advancer column IDs per board (used for sub-filtering within a board) */
const STAGE_ADVANCER_COL: Record<number, string> = {
  18406060017: "color_mm1wyr92",   // sub-stage (Evaluate MN, Send Request, etc.)
  18410601299: "color_mm1ws96t",   // master stage
  18410804557: "color_mm1ws96t",   // master stage
};

/** Day-bucket source column for each board (used when it's NOT a date computation) */
const DAYS_COL: Record<number, string> = {
  18392794310: "color_mkxn3nm5",   // "Day X" on Raw Intake group
  18406060017: "color_mm1wwm05",   // standard bucket label
  18410601299: "color_mm1wwm05",
  18410804557: "color_mm1wwm05",
};

// ── Column-ID collection helper ─────────────────────────────────────────

/** Collect every unique column ID needed across all charts for a board. */
function columnsForBoard(boardId: number): string[] {
  const set = new Set<string>();

  for (const chart of CHART_DEFS) {
    if (chart.boardId !== boardId) continue;
    for (const dc of chart.drilldownCols) set.add(dc.colId);
    if (chart.notesColId) set.add(chart.notesColId);
  }

  // Always include the stage-advancer column if present
  const saCol = STAGE_ADVANCER_COL[boardId];
  if (saCol) set.add(saCol);

  // Always include the days column if present
  const dCol = DAYS_COL[boardId];
  if (dCol) set.add(dCol);

  // Board 18392794310 needs special date columns for day-bucket derivation
  if (boardId === 18392794310) {
    set.add("text_mm2me552");   // Last Seen (Partial Leads)
    set.add("color_mkxn3nm5");  // Days In Stage label (Raw Intake)
  }

  // Board 18406352652 needs the intake date for day-bucket derivation
  if (boardId === 18406352652) {
    set.add("date_mm1wf43j");
  }

  return Array.from(set);
}

// ── Raw Monday types ────────────────────────────────────────────────────

interface RawColumnValue {
  id: string;
  text: string | null;
}

interface RawItem {
  id: string;
  name: string;
  group: { id: string };
  column_values: RawColumnValue[];
}

// ── Board fetcher (paginated, multi-group) ──────────────────────────────

const PAGE_SIZE = 500;

async function fetchBoard(
  boardId: number,
  groupIds: string[],
  columnIds: string[],
): Promise<RawItem[]> {
  const allItems: RawItem[] = [];

  for (const groupId of groupIds) {
    // First page
    const firstQuery = `
      query ($boardId: ID!, $cols: [String!]) {
        boards(ids: [$boardId]) {
          groups(ids: ["${groupId}"]) {
            items_page(limit: ${PAGE_SIZE}) {
              cursor
              items {
                id
                name
                group { id }
                column_values(ids: $cols) { id text }
              }
            }
          }
        }
      }
    `;

    const data = await gql<{
      boards: {
        groups: {
          items_page: { cursor: string | null; items: RawItem[] };
        }[];
      }[];
    }>(firstQuery, { boardId: String(boardId), cols: columnIds });

    const page = data.boards?.[0]?.groups?.[0]?.items_page;
    const firstItems = page?.items ?? [];
    let cursor = page?.cursor ?? null;
    allItems.push(...firstItems);

    // Subsequent pages
    while (cursor) {
      try {
        const nextQuery = `
          query ($cursor: String!, $cols: [String!]) {
            next_items_page(limit: ${PAGE_SIZE}, cursor: $cursor) {
              cursor
              items {
                id
                name
                group { id }
                column_values(ids: $cols) { id text }
              }
            }
          }
        `;
        const next = await gql<{
          next_items_page: { cursor: string | null; items: RawItem[] };
        }>(nextQuery, { cursor, cols: columnIds });

        const items = next.next_items_page?.items ?? [];
        cursor = next.next_items_page?.cursor ?? null;
        if (items.length > 0) {
          allItems.push(...items);
        }
      } catch (e) {
        console.error(`[oversightApi] pagination error board=${boardId} group=${groupId}`, e);
        break;
      }
    }
  }

  return allItems;
}

// ── Item → OversightPatient mapper ──────────────────────────────────────

function mapItem(raw: RawItem, boardId: number): OversightPatient {
  // Build cols record
  const cols: Record<string, string> = {};
  cols["name"] = raw.name;
  for (const cv of raw.column_values) {
    cols[cv.id] = cv.text ?? "";
  }

  // Derive day bucket based on board + group
  let dayBucket: DayBucketLabel | "Unknown" = "Unknown";
  const groupId = raw.group.id;

  if (boardId === 18392794310 && groupId === "group_mm2mdqq2") {
    // Partial Leads — derive from Last Seen timestamp
    dayBucket = dateToBucket(cols["text_mm2me552"] ?? "");
  } else if (boardId === 18392794310 && groupId === "group_mkpehq9q") {
    // Raw Intake — derive from "Day X" label
    dayBucket = parseDayLabel(cols["color_mkxn3nm5"] ?? "");
  } else if (boardId === 18406352652) {
    // Profile Send Off — derive from Date of Intake
    dayBucket = dateToBucket(cols["date_mm1wf43j"] ?? "");
  } else {
    // All other boards — color_mm1wwm05 is already a bucket label
    const raw_text = cols["color_mm1wwm05"] ?? "";
    if ((DAY_BUCKET_LABELS as readonly string[]).includes(raw_text)) {
      dayBucket = raw_text as DayBucketLabel;
    } else if (raw_text) {
      dayBucket = parseDayLabel(raw_text);
    }
  }

  return {
    id: raw.id,
    name: raw.name,
    boardId,
    groupId,
    dayBucket,
    cols,
  };
}

// ── Chart filtering rules ───────────────────────────────────────────────

interface ChartFilter {
  type: "group";
  groupId: string;
}

interface ChartFilterStageAdvancer {
  type: "stageAdvancer";
  boardId: number;
  value: string;
}

type FilterRule = ChartFilter | ChartFilterStageAdvancer;

const CHART_FILTERS: Record<string, FilterRule> = {
  "dtc-partial-leads":  { type: "group", groupId: "group_mm2mdqq2" },
  "dtc-raw-intake":     { type: "group", groupId: "group_mkpehq9q" },
  "profile-send-off":   { type: "group", groupId: "group_mm1xf2jb" },
  "evaluate":           { type: "stageAdvancer", boardId: 18406060017, value: "Evaluate MN" },
  "send-request":       { type: "stageAdvancer", boardId: 18406060017, value: "Send Request" },
  "confirm-receipt":    { type: "stageAdvancer", boardId: 18406060017, value: "Confirm Receipt" },
  "chase-clinicals":    { type: "stageAdvancer", boardId: 18406060017, value: "Chase Clinicals" },
  "benefits":           { type: "stageAdvancer", boardId: 18410601299, value: "Benefits / SoS" },
  "submit-auth":        { type: "stageAdvancer", boardId: 18410601299, value: "Submit Auth." },
  "auth-outstanding":   { type: "stageAdvancer", boardId: 18410601299, value: "Auth. Outstanding" },
  "auth-denial":        { type: "group", groupId: "group_mm316hg2" },
  "welcome-call":       { type: "stageAdvancer", boardId: 18410804557, value: "Welcome Call" },
};

function matchesFilter(patient: OversightPatient, rule: FilterRule): boolean {
  if (rule.type === "group") {
    return patient.groupId === rule.groupId;
  }
  // Stage advancer filter
  const saCol = STAGE_ADVANCER_COL[rule.boardId];
  if (!saCol) return false;
  const val = (patient.cols[saCol] ?? "").trim();
  return val === rule.value;
}

// ── Public fetch function ───────────────────────────────────────────────

/**
 * Fetch oversight data across all 5 boards in parallel.
 * Returns a Map keyed by chart ID, each value an array of OversightPatients.
 */
export async function fetchOversightData(): Promise<Map<string, OversightPatient[]>> {
  const boardIds = Object.keys(BOARD_GROUPS).map(Number);

  // Fetch all boards in parallel
  const boardResults = await Promise.all(
    boardIds.map((boardId) => {
      const groups = BOARD_GROUPS[boardId];
      const cols = columnsForBoard(boardId);
      return fetchBoard(boardId, groups, cols).then((items) => ({ boardId, items }));
    }),
  );

  // Map raw items to OversightPatient per board
  const allPatients: OversightPatient[] = [];
  for (const { boardId, items } of boardResults) {
    for (const raw of items) {
      allPatients.push(mapItem(raw, boardId));
    }
  }

  // Split patients into chart buckets
  const result = new Map<string, OversightPatient[]>();

  for (const chart of CHART_DEFS) {
    const rule = CHART_FILTERS[chart.id];
    if (!rule) {
      result.set(chart.id, []);
      continue;
    }

    const patients = allPatients.filter(
      (p) => p.boardId === chart.boardId && matchesFilter(p, rule),
    );
    result.set(chart.id, patients);
  }

  return result;
}
