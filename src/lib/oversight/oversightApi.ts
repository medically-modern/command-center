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
  /** Column IDs to display in drill-down table, with display labels.
   *  `pill: true` renders the value(s) as colored status pills. */
  drilldownCols: { colId: string; label: string; pill?: boolean }[];
  /** Optional column ID for a notes/long-text field shown via icon popover */
  notesColId?: string;
}

// ── Chart definitions (12 charts) ───────────────────────────────────────

/** Shared drill-down columns for the Chase Clinicals charts (Fax + Email&Parachute,
 *  plus their escalated variants). */
const CHASE_COLS: { colId: string; label: string; pill?: boolean }[] = [
  { colId: "date_mm1wf43j", label: "Intake Date" },
  { colId: "color_mm1wwm05", label: "Days in Stage" },
  { colId: "color_mm1w5wxr", label: "Referral Source" },
  { colId: "color_mm1xw7y5", label: "Clinicals Method" },
  { colId: "color_mm1x157j", label: "Primary Insurance" },
  { colId: "color_mm1w1978", label: "Request Type" },
  { colId: "color_mm1w1cm9", label: "Serving" },
  { colId: "numeric_mm4bhjc8", label: "Evaluation Count" },
  { colId: "date_mm2yg8x8", label: "Request Sent" },
  { colId: "__requesting__", label: "Requesting" },
  { colId: "color_mm1wz0vg", label: "MN Attempts" },
  { colId: "text_mm2yhpjt", label: "Attempt 1 Log" },
  { colId: "text_mm2yb3rv", label: "Attempt 2 Log" },
  { colId: "text_mm2ybk06", label: "Attempt 3 Log" },
  { colId: "date_mm1wadgs", label: "Next Action" },
];

/** Shared drill-down columns for the Evaluate chart + its escalated variant. */
const EVALUATE_COLS: { colId: string; label: string; pill?: boolean }[] = [
  { colId: "date_mm1wf43j", label: "Intake Date" },
  { colId: "color_mm1wwm05", label: "Days in Stage" },
  { colId: "color_mm1w5wxr", label: "Referral Source" },
  { colId: "color_mm1x157j", label: "Primary Insurance" },
  { colId: "color_mm1w1cm9", label: "Serving" },
  { colId: "numeric_mm4bhjc8", label: "Evaluation Count" },
  { colId: "color_mm1y8rv8", label: "MRs / Clinicals" },
  { colId: "color_mm44h0fx", label: "CGM Script Received" },
  { colId: "color_mm44chc8", label: "IP Script Received" },
];

/** Shared drill-down columns for the Send Request chart + its escalated variant. */
const SEND_REQUEST_COLS: { colId: string; label: string; pill?: boolean }[] = [
  { colId: "date_mm1wf43j", label: "Intake Date" },
  { colId: "color_mm1wwm05", label: "Days in Stage" },
  { colId: "color_mm1w5wxr", label: "Referral Source" },
  { colId: "color_mm1x157j", label: "Primary Insurance" },
  { colId: "color_mm1w1cm9", label: "Serving" },
  { colId: "numeric_mm4bhjc8", label: "Evaluation Count" },
  { colId: "color_mm1xw7y5", label: "Clinicals Method" },
  { colId: "__requesting__", label: "Requesting" },
];

/** Shared drill-down columns for the Confirm Receipt chart + its escalated variants. */
const CONFIRM_COLS: { colId: string; label: string; pill?: boolean }[] = [
  { colId: "date_mm1wf43j", label: "Intake Date" },
  { colId: "color_mm1wwm05", label: "Days in Stage" },
  { colId: "color_mm1w5wxr", label: "Referral Source" },
  { colId: "color_mm1x157j", label: "Primary Insurance" },
  { colId: "color_mm1w1cm9", label: "Serving" },
  { colId: "numeric_mm4bhjc8", label: "Evaluation Count" },
  { colId: "date_mm2yg8x8", label: "Request Sent" },
  { colId: "__requesting__", label: "Requesting" },
  { colId: "color_mm1wz0vg", label: "MN Attempts" },
  { colId: "text_mm2yd068", label: "Attempt 1 Log" },
  { colId: "text_mm2y9h4a", label: "Attempt 2 Log" },
  { colId: "text_mm2ymtsk", label: "Attempt 3 Log" },
];

const RAW_CHART_DEFS: ChartDef[] = [
  // ── Board 18406352652 (Profile Send Off) ──
  {
    id: "profile-send-off",
    title: "Profile Send Off",
    boardId: 18406352652,
    notesColId: "text_mm389fs",
    drilldownCols: [
      { colId: "date_mm1wf43j", label: "Intake Date" },
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "color_mm1w5wxr", label: "Referral Source" },
      { colId: "color_mm1w1978", label: "Request" },
      { colId: "color_mm24ap4j", label: "General Insurance" },
      { colId: "color_mm1xg10n", label: "Primary Insurance" },
      { colId: "text_mm1x2qk2", label: "Member ID 1" },
      { colId: "color_mm1yeksx", label: "Run Stedi" },
    ],
  },

  // ── Board 18406060017 (Medical Necessity) ──
  {
    id: "evaluate",
    title: "Evaluate",
    boardId: 18406060017,
    notesColId: "long_text_mm27zjt2",
    drilldownCols: EVALUATE_COLS,
  },
  {
    id: "send-request",
    title: "Send Request",
    boardId: 18406060017,
    notesColId: "long_text_mm27zjt2",
    drilldownCols: SEND_REQUEST_COLS,
  },
  {
    id: "confirm-receipt",
    title: "Confirm Receipt",
    boardId: 18406060017,
    notesColId: "long_text_mm2ytsxp",
    drilldownCols: CONFIRM_COLS,
  },
  {
    id: "chase-fax",
    title: "Chase Clinicals — Fax",
    boardId: 18406060017,
    notesColId: "long_text_mm2ytsxp",
    drilldownCols: CHASE_COLS,
  },
  {
    id: "chase-email-parachute",
    title: "Chase Clinicals — Email & Parachute",
    boardId: 18406060017,
    notesColId: "long_text_mm2ytsxp",
    drilldownCols: CHASE_COLS,
  },

  // ── Escalations (attempt 4+ / MN Attempts = "Escalate") — second row of the
  //    Medical Evaluation stage. Same boards/columns as the parent charts. ──
  {
    id: "confirm-receipt-escalations",
    title: "Confirm Receipt (Escalated)",
    boardId: 18406060017,
    notesColId: "long_text_mm2ytsxp",
    drilldownCols: CONFIRM_COLS,
  },
  {
    id: "chase-fax-escalations",
    title: "Chase Clinicals — Fax (Escalated)",
    boardId: 18406060017,
    notesColId: "long_text_mm2ytsxp",
    drilldownCols: CHASE_COLS,
  },
  {
    id: "chase-email-parachute-escalations",
    title: "Chase Clinicals — Email & Parachute (Escalated)",
    boardId: 18406060017,
    notesColId: "long_text_mm2ytsxp",
    drilldownCols: CHASE_COLS,
  },

  // ── 3rd-Attempt Escalations (Escalation Required + Evaluation Counter = 3) —
  //    the third oversight column for the Medical Evaluation stage. A patient is
  //    escalated on their 3rd Evaluate pass when MN still isn't established (see
  //    EvaluatePanel). All five sub-stages get a chart since an escalated patient
  //    can sit at any of them. Same boards/columns as the parent charts. ──
  {
    id: "evaluate-escalated-3rd",
    title: "Evaluate (Escalated · 3rd)",
    boardId: 18406060017,
    notesColId: "long_text_mm27zjt2",
    drilldownCols: EVALUATE_COLS,
  },
  {
    id: "send-request-escalated-3rd",
    title: "Send Request (Escalated · 3rd)",
    boardId: 18406060017,
    notesColId: "long_text_mm27zjt2",
    drilldownCols: SEND_REQUEST_COLS,
  },
  {
    id: "confirm-receipt-escalated-3rd",
    title: "Confirm Receipt (Escalated · 3rd)",
    boardId: 18406060017,
    notesColId: "long_text_mm2ytsxp",
    drilldownCols: CONFIRM_COLS,
  },
  {
    id: "chase-fax-escalated-3rd",
    title: "Chase Clinicals — Fax (Escalated · 3rd)",
    boardId: 18406060017,
    notesColId: "long_text_mm2ytsxp",
    drilldownCols: CHASE_COLS,
  },
  {
    id: "chase-email-parachute-escalated-3rd",
    title: "Chase Clinicals — Email & Parachute (Escalated · 3rd)",
    boardId: 18406060017,
    notesColId: "long_text_mm2ytsxp",
    drilldownCols: CHASE_COLS,
  },

  // ── Board 18410601299 (Insurance / Auth) ──
  {
    id: "benefits",
    title: "Benefits",
    boardId: 18410601299,
    notesColId: "long_text_mm2ffsme",
    drilldownCols: [
      { colId: "date_mm1wf43j", label: "Intake Date" },
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "color_mm1w5wxr", label: "Referral Source" },
      { colId: "color_mm1x157j", label: "Primary Insurance" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "color_mm2vhwan", label: "Active/Network", pill: true },
      { colId: "color_mm2vt8xg", label: "DME Benefits", pill: true },
      { colId: "color_mm2vg3ew", label: "Auth", pill: true },
      { colId: "color_mm2vemyy", label: "SoS", pill: true },
      { colId: "dropdown_mm2vez5a", label: "Not Clear Products", pill: true },
    ],
  },
  {
    id: "submit-auth",
    title: "Submit Auth",
    boardId: 18410601299,
    notesColId: "long_text_mm2ffsme",
    drilldownCols: [
      { colId: "date_mm1wf43j", label: "Intake Date" },
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "color_mm1w5wxr", label: "Referral Source" },
      { colId: "color_mm1x157j", label: "Primary Insurance" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "color_mm1wgjd1", label: "CGM Auth Result" },
      { colId: "color_mm1x5c99", label: "Sensors Auth Result" },
      { colId: "color_mm1xnzmn", label: "IP Auth Result" },
      { colId: "color_mm1xr2j1", label: "Infusion Set Auth Result" },
      { colId: "color_mm1xybvt", label: "Cartridge Auth Result" },
    ],
  },
  {
    id: "auth-outstanding",
    title: "Auth Outstanding",
    boardId: 18410601299,
    notesColId: "long_text_mm2ffsme",
    drilldownCols: [
      { colId: "date_mm1wf43j", label: "Intake Date" },
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "color_mm1w5wxr", label: "Referral Source" },
      { colId: "color_mm1x157j", label: "Primary Insurance" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "color_mm1wgjd1", label: "CGM Auth Result" },
      { colId: "text_mm2wmc1z", label: "CGM Submitted" },
      { colId: "color_mm1x5c99", label: "Sensors Auth Result" },
      { colId: "text_mm2w85gd", label: "Sensors Submitted" },
      { colId: "color_mm1xnzmn", label: "IP Auth Result" },
      { colId: "text_mm2w72r6", label: "IP Submitted" },
      { colId: "color_mm1xr2j1", label: "Infusion Set Auth Result" },
      { colId: "text_mm2wvnpx", label: "Infusion Set Submitted" },
      { colId: "color_mm1xybvt", label: "Cartridge Auth Result" },
      { colId: "text_mm2wth7t", label: "Cartridge Submitted" },
    ],
  },
  {
    id: "auth-denial",
    title: "Auth Denial",
    boardId: 18410601299,
    notesColId: "long_text_mm3jrssp",
    drilldownCols: [
      { colId: "date_mm1wf43j", label: "Intake Date" },
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "color_mm1w5wxr", label: "Referral Source" },
      { colId: "color_mm1x157j", label: "Primary Insurance" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "color_mm1wgjd1", label: "CGM Auth Result" },
      { colId: "text_mm2wmc1z", label: "CGM Submitted" },
      { colId: "color_mm1x5c99", label: "Sensors Auth Result" },
      { colId: "text_mm2w85gd", label: "Sensors Submitted" },
      { colId: "color_mm1xnzmn", label: "IP Auth Result" },
      { colId: "text_mm2w72r6", label: "IP Submitted" },
      { colId: "color_mm1xr2j1", label: "Infusion Set Auth Result" },
      { colId: "text_mm2wvnpx", label: "Infusion Set Submitted" },
      { colId: "color_mm1xybvt", label: "Cartridge Auth Result" },
      { colId: "text_mm2wth7t", label: "Cartridge Submitted" },
    ],
  },

  // ── Board 18410804557 (Welcome Call / Order) ──
  {
    id: "welcome-call",
    title: "Welcome Call",
    boardId: 18410804557,
    notesColId: "long_text_mm2ffsme",
    drilldownCols: [
      { colId: "date_mm1wf43j", label: "Intake Date" },
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "color_mm1w5wxr", label: "Referral Source" },
      { colId: "color_mm1x157j", label: "Primary Insurance" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "text_mm322fg9", label: "Call Attempts" },
    ],
  },
  {
    id: "profile-review",
    title: "Profile Review",
    boardId: 18410804557,
    notesColId: "long_text_mm2ffsme",
    drilldownCols: [
      { colId: "date_mm1wf43j", label: "Intake Date" },
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "color_mm1w5wxr", label: "Referral Source" },
      { colId: "color_mm1x157j", label: "Primary Insurance" },
      { colId: "color_mm1w1cm9", label: "Serving" },
    ],
  },
];

// ── Always-on priority columns ──────────────────────────────────────────
// Referral Source + Primary Insurance are the two fields that most affect how
// a patient should be prioritized, so every drill-down leads with them (after
// Days in Stage). Column IDs differ per board.
const BOARD_PRIORITY_COLS: Record<
  number,
  { referral?: string; insurance?: string; referralType?: string }
> = {
  18392794310: { referral: "color_mkywv02j" },                                                         // DtC (no insurance captured at intake)
  18406352652: { referral: "color_mm1w5wxr", insurance: "color_mm1xg10n", referralType: "color_mm1wm4n4" }, // Profile Send Off
  18406060017: { referral: "color_mm1w5wxr", insurance: "color_mm1x157j", referralType: "color_mm1wm4n4" }, // Medical Necessity
  18410601299: { referral: "color_mm1w5wxr", insurance: "color_mm1x157j", referralType: "color_mm1wm4n4" }, // Insurance / Auth
  18410804557: { referral: "color_mm1w5wxr", insurance: "color_mm1x157j", referralType: "color_mm1wm4n4" }, // Welcome Call
};

/** Resolve the fields used by the priority score for a patient, regardless of
 *  which board/columns the stage uses. Referral combines type + source so
 *  "Doctor"/"Manufacturer" (type) and "CareCentrix" (source) both match. */
export function scoringFields(p: OversightPatient): {
  referral: string;
  insurance: string;
  bucket: DayBucketLabel | "Unknown";
} {
  const pri = BOARD_PRIORITY_COLS[p.boardId] ?? {};
  // Score on the Referral TYPE status label (exact). Falls back to the referral
  // source for boards without a type column (DtC — excluded from VIP anyway).
  const refType = pri.referralType ? p.cols[pri.referralType] ?? "" : "";
  const refSrc = pri.referral ? p.cols[pri.referral] ?? "" : "";
  const insurance = pri.insurance ? p.cols[pri.insurance] ?? "" : "";
  return { referral: (refType || refSrc).trim(), insurance, bucket: p.dayBucket };
}

/** Status-column label options for the priority editor, pulled live from Monday
 *  (Referral Type + Primary Insurance on the Medical Necessity board). */
export async function fetchPriorityOptions(): Promise<{
  referralTypes: string[];
  insurances: string[];
}> {
  const refTypeCol = "color_mm1wm4n4";
  const insuranceCol = "color_mm1x157j";
  const query = `query { boards(ids: 18406060017) { columns(ids: ["${refTypeCol}","${insuranceCol}"]) { id settings_str } } }`;
  const data = await gql<{
    boards: { columns: { id: string; settings_str: string }[] }[];
  }>(query);
  const cols = data.boards?.[0]?.columns ?? [];
  const labelsOf = (id: string): string[] => {
    const c = cols.find((x) => x.id === id);
    if (!c) return [];
    try {
      const s = JSON.parse(c.settings_str) as { labels?: Record<string, string> };
      return Object.values(s.labels ?? {}).filter(Boolean);
    } catch {
      return [];
    }
  };
  return { referralTypes: labelsOf(refTypeCol), insurances: labelsOf(insuranceCol) };
}

/** Status label → hex color maps for the pill columns (Benefits board), pulled
 *  from Monday so pills match the board's colors. Keyed by colId, then by the
 *  lower-cased label. */
export async function fetchPillColors(): Promise<Record<string, Record<string, string>>> {
  const cols = ["color_mm2vhwan", "color_mm2vt8xg", "color_mm2vg3ew", "color_mm2vemyy"];
  const query = `query { boards(ids: 18410601299) { columns(ids: ${JSON.stringify(cols)}) { id settings_str } } }`;
  const data = await gql<{ boards: { columns: { id: string; settings_str: string }[] }[] }>(query);
  const out: Record<string, Record<string, string>> = {};
  for (const c of data.boards?.[0]?.columns ?? []) {
    try {
      const s = JSON.parse(c.settings_str) as {
        labels?: Record<string, string>;
        labels_colors?: Record<string, { color?: string }>;
      };
      const map: Record<string, string> = {};
      for (const [idx, name] of Object.entries(s.labels ?? {})) {
        const hex = s.labels_colors?.[idx]?.color;
        if (name && hex) map[name.toLowerCase()] = hex;
      }
      out[c.id] = map;
    } catch {
      out[c.id] = {};
    }
  }
  return out;
}

/** Guarantee Referral Source + Primary Insurance appear in every drill-down.
 *  Column ORDER is left exactly as authored per chart — these are only appended
 *  when a chart hasn't already listed them. The "Days in Stage" column is kept
 *  in place (rendered as the day-bucket pill by the table). */
function withPriorityCols(chart: ChartDef): ChartDef {
  const pri = BOARD_PRIORITY_COLS[chart.boardId] ?? {};
  const cols = [...chart.drilldownCols];
  const has = (id?: string) => !!id && cols.some((c) => c.colId === id);
  if (pri.referral && !has(pri.referral)) cols.push({ colId: pri.referral, label: "Referral Source" });
  if (pri.insurance && !has(pri.insurance)) cols.push({ colId: pri.insurance, label: "Primary Insurance" });
  return { ...chart, drilldownCols: cols };
}

export const CHART_DEFS: ChartDef[] = RAW_CHART_DEFS.map(withPriorityCols);

// ── Section grouping (main view) ────────────────────────────────────────
export interface OversightSection {
  id: string;
  title: string;
  /** Chart IDs in display order. Unknown IDs are skipped gracefully. */
  chartIds: string[];
  /** Optional second row, rendered under a sub-heading (e.g. Escalations). */
  secondaryTitle?: string;
  secondaryChartIds?: string[];
  /** Optional third column (e.g. 3rd-Attempt Escalations), rendered to the right
   *  of the secondary column behind another divider. */
  tertiaryTitle?: string;
  tertiaryChartIds?: string[];
}

export const OVERSIGHT_SECTIONS: OversightSection[] = [
  { id: "intake", title: "Intake", chartIds: ["profile-send-off"] },
  {
    id: "medical-evaluation",
    title: "Medical Evaluation",
    chartIds: ["evaluate", "send-request", "confirm-receipt", "chase-fax", "chase-email-parachute"],
    secondaryTitle: "Escalations · Attempt 4+",
    secondaryChartIds: ["confirm-receipt-escalations", "chase-fax-escalations", "chase-email-parachute-escalations"],
    tertiaryTitle: "Escalations · 3rd+ Attempt",
    tertiaryChartIds: [
      "evaluate-escalated-3rd",
      "send-request-escalated-3rd",
      "confirm-receipt-escalated-3rd",
      "chase-fax-escalated-3rd",
      "chase-email-parachute-escalated-3rd",
    ],
  },
  {
    id: "insurance",
    title: "Insurance",
    chartIds: ["benefits", "submit-auth", "auth-outstanding", "auth-denial"],
  },
  // "profile-review" chart not defined yet — needs a board/group; skipped until added.
  { id: "welcome-call", title: "Welcome Call", chartIds: ["welcome-call", "profile-review"] },
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
  18406352652: ["group_mm1xf2jb"],
  18406060017: ["group_mm1xf2jb"],
  18410601299: ["group_mm1xr3q3", "group_mm1x1416", "group_mm2v6d1z", "group_mm316hg2"],
  18410804557: ["group_mm1wvq8p", "group_mm2x8jtj"],
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

  // Always include the priority-scoring columns (referral source/type + insurance)
  const pri = BOARD_PRIORITY_COLS[boardId];
  if (pri) {
    if (pri.referral) set.add(pri.referral);
    if (pri.insurance) set.add(pri.insurance);
    if (pri.referralType) set.add(pri.referralType);
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

  // Medical Necessity board — the consolidated ask list feeds the "Requesting"
  // pill summary (not shown as its own table column), and the Escalation status
  // column backs the 3rd-Attempt escalation filters (not a drilldown column).
  if (boardId === 18406060017) {
    set.add("dropdown_mm2yd3a2"); // MN Request Consolidated
    set.add("color_mm1x7997");    // Escalation status (3rd-attempt filter)
  }

  // Drop synthetic columns (e.g. "__requesting__") — they aren't real Monday ids.
  for (const id of Array.from(set)) {
    if (id.startsWith("__")) set.delete(id);
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
  /** Optional extra AND conditions on top of the stage. The column's text must
   *  be (one of) `value` — or NOT one of it when `not` is true. Alternatively
   *  `gte` does a numeric "column value >= N" test (used for Evaluation Counter
   *  >= 3). Used for escalations (MN Attempts = "Escalate"), the Chase method
   *  split (Fax = NOT Email/Parachute, so blank counts as fax; Email & Parachute
   *  = either), and the 3rd+ Attempt escalation counter threshold. */
  andCols?: { colId: string; value?: string | string[]; not?: boolean; gte?: number }[];
}

type FilterRule = ChartFilter | ChartFilterStageAdvancer;

const CHART_FILTERS: Record<string, FilterRule> = {
  "profile-send-off":   { type: "group", groupId: "group_mm1xf2jb" },
  "evaluate":           { type: "stageAdvancer", boardId: 18406060017, value: "Evaluate MN" },
  "send-request":       { type: "stageAdvancer", boardId: 18406060017, value: "Send Request" },
  "confirm-receipt":    { type: "stageAdvancer", boardId: 18406060017, value: "Confirm Receipt" },
  // Chase Clinicals split by method: Fax (= NOT Email/Parachute, so a blank
  // method still shows under Fax) vs Email & Parachute (either). Method col = color_mm1xw7y5.
  "chase-fax":             { type: "stageAdvancer", boardId: 18406060017, value: "Chase Clinicals", andCols: [{ colId: "color_mm1xw7y5", value: ["Email", "Parachute"], not: true }] },
  "chase-email-parachute": { type: "stageAdvancer", boardId: 18406060017, value: "Chase Clinicals", andCols: [{ colId: "color_mm1xw7y5", value: ["Email", "Parachute"] }] },
  // Escalations = same stage AND MN Attempts column = "Escalate" (attempt 4+).
  "confirm-receipt-escalations":       { type: "stageAdvancer", boardId: 18406060017, value: "Confirm Receipt", andCols: [{ colId: "color_mm1wz0vg", value: "Escalate" }] },
  "chase-fax-escalations":             { type: "stageAdvancer", boardId: 18406060017, value: "Chase Clinicals", andCols: [{ colId: "color_mm1xw7y5", value: ["Email", "Parachute"], not: true }, { colId: "color_mm1wz0vg", value: "Escalate" }] },
  "chase-email-parachute-escalations": { type: "stageAdvancer", boardId: 18406060017, value: "Chase Clinicals", andCols: [{ colId: "color_mm1xw7y5", value: ["Email", "Parachute"] }, { colId: "color_mm1wz0vg", value: "Escalate" }] },
  // 3rd+ Attempt escalations = same stage AND Escalation column = "Escalation
  // Required" AND Evaluation Counter ≥ 3. The Evaluate SOP escalates at counter
  // ≥ 3 and the patient stays in Evaluate MN, so the counter can keep climbing —
  // the filter uses ≥ 3 (not == 3) to match the trigger and never drop an
  // escalated patient. color_mm1x7997 = Escalation status; flag set by the
  // Evaluate SOP (and by confirm/chase).
  "evaluate-escalated-3rd":                { type: "stageAdvancer", boardId: 18406060017, value: "Evaluate MN",     andCols: [{ colId: "color_mm1x7997", value: "Escalation Required" }, { colId: "numeric_mm4bhjc8", gte: 3 }] },
  "send-request-escalated-3rd":            { type: "stageAdvancer", boardId: 18406060017, value: "Send Request",    andCols: [{ colId: "color_mm1x7997", value: "Escalation Required" }, { colId: "numeric_mm4bhjc8", gte: 3 }] },
  "confirm-receipt-escalated-3rd":         { type: "stageAdvancer", boardId: 18406060017, value: "Confirm Receipt", andCols: [{ colId: "color_mm1x7997", value: "Escalation Required" }, { colId: "numeric_mm4bhjc8", gte: 3 }] },
  "chase-fax-escalated-3rd":               { type: "stageAdvancer", boardId: 18406060017, value: "Chase Clinicals", andCols: [{ colId: "color_mm1xw7y5", value: ["Email", "Parachute"], not: true }, { colId: "color_mm1x7997", value: "Escalation Required" }, { colId: "numeric_mm4bhjc8", gte: 3 }] },
  "chase-email-parachute-escalated-3rd":   { type: "stageAdvancer", boardId: 18406060017, value: "Chase Clinicals", andCols: [{ colId: "color_mm1xw7y5", value: ["Email", "Parachute"] }, { colId: "color_mm1x7997", value: "Escalation Required" }, { colId: "numeric_mm4bhjc8", gte: 3 }] },
  "benefits":           { type: "stageAdvancer", boardId: 18410601299, value: "Benefits / SoS" },
  "submit-auth":        { type: "stageAdvancer", boardId: 18410601299, value: "Submit Auth." },
  "auth-outstanding":   { type: "stageAdvancer", boardId: 18410601299, value: "Auth. Outstanding" },
  "auth-denial":        { type: "group", groupId: "group_mm316hg2" },
  "welcome-call":       { type: "group", groupId: "group_mm1wvq8p" },
  "profile-review":     { type: "group", groupId: "group_mm2x8jtj" },
};

function matchesFilter(patient: OversightPatient, rule: FilterRule): boolean {
  if (rule.type === "group") {
    return patient.groupId === rule.groupId;
  }
  // Stage advancer filter
  const saCol = STAGE_ADVANCER_COL[rule.boardId];
  if (!saCol) return false;
  const val = (patient.cols[saCol] ?? "").trim();
  if (val !== rule.value) return false;
  // Optional extra AND conditions (escalations, Chase method split, counter ≥ N).
  for (const c of rule.andCols ?? []) {
    const cell = (patient.cols[c.colId] ?? "").trim();
    if (c.gte !== undefined) {
      // Numeric threshold (e.g. Evaluation Counter ≥ 3). Non-numeric → fails.
      const n = Number(cell);
      const pass = Number.isFinite(n) && cell !== "" && n >= c.gte;
      if (c.not ? pass : !pass) return false;
      continue;
    }
    const inSet = Array.isArray(c.value) ? c.value.includes(cell) : cell === c.value;
    if (c.not ? inSet : !inSet) return false;
  }
  return true;
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
