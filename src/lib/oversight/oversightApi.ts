// Oversight dashboard API — fetches patients across 5 Monday boards,
// buckets them by "days in stage", and returns chart-ready data.

// ── Monday API plumbing ─────────────────────────────────────────────────

import { MONDAY_API_URL, mondayIdentityHeaders } from "../shared/mondayEndpoint";
import { etToday } from "../masheke/etDate";
import { stampReturnedToQueue, stampReturnedToManager, stampApprovedStuck, stampEscalatedToFinal, appendStampedLine } from "../masheke/proposedStuck";
import { userInitials } from "../shared/auth";
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
  /** Raw column values (label text) keyed by column ID */
  cols: Record<string, string>;
  /** Selected index per status column ID — for index-based filter conditions
   *  (status labels can be renamed on the board; their index can't). */
  colIndex: Record<string, number>;
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
  /** Manager-views row alignment (2026-07): a column-2/3 chart names the
   *  column-1 chart id whose row it sits on. */
  rowOf?: string;
  /** Stacked two-series chart (ME "Manager Intervention" merge): patients
   *  come from two SOURCE charts fetched independently; series B (red)
   *  wins dedup when a patient matches both. */
  stacked?: {
    aId?: string;
    bId: string;
    aLabel: string;
    bLabel: string;
    aColor: string;
    bColor: string;
  };
  /** Which decision actions the drill-down offers. "proposed-stuck" /
   *  "insurance-final" = Final Decisions (Approve Stuck / Return to Queue);
   *  "submit-auth-manager" = the Manager Intervention Submit Auth chart's
   *  Escalate to Final Decisions button (required note). */
  decision?: "proposed-stuck" | "insurance-final" | "submit-auth-manager";
  /** Reason-bucketed chart (Katie 2026-07-29): the x-axis is one bar per
   *  REASON, not the day buckets. Each bucket names a CHART_FILTERS rule; a
   *  patient can match several buckets and is counted in each (the header
   *  count stays distinct patients). When the chart has NO CHART_FILTERS
   *  entry of its own, its population is the UNION of its buckets. */
  reasonBuckets?: ReasonBucket[];
  /** Final Decisions charts: the long-text column the rep's stamped
   *  "[Proposed Stuck · date] …" line is appended to, so the drill-down can
   *  extract it back into the synthetic `__proposedReason__` column. It is NOT
   *  always the chart's `notesColId` — Medical Evaluation stamps the MN notes
   *  (long_text_mm27zjt2) even on Chase charts whose notes column differs.
   *  Insurance stamps its Reference Notes (long_text_mm2ffsme), which happens
   *  to equal its notesColId. Keep it in agreement with the writer
   *  (masheke/ProposeStuckModal, samantha/ProposeStuckButton). */
  reasonColId?: string;
}

/** Series colors for the merged escalation charts — match the mockup's
 *  legend pills (amber = Attempt 4+, red = 3rd+ round). */
export const STACK_A_COLOR = "#f59e0b";
export const STACK_B_COLOR = "#dc2626";

/** One bar of a reason-bucketed chart. `filterId` names a CHART_FILTERS rule;
 *  `label` is both the bar label and the value shown in the drill-down's
 *  synthetic `__reasons__` column (and the ?bucket= URL param). */
export interface ReasonBucket {
  key: string;
  label: string;
  /** Short label under the bar (defaults to `label`). */
  short?: string;
  filterId: string;
  color: string;
}

/** Categorical bar colors for reason buckets — identity colors, assigned in
 *  fixed order per chart (NOT the sequential day-bucket ramp). The trio is
 *  CVD-validated against the card surface; every bar also carries its own
 *  text label, so color is never the only identity carrier. */
export const REASON_COLORS = {
  sky: "#0ea5e9",
  amber: "#f59e0b",
  violet: "#8b5cf6",
} as const;

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

/** Shared drill-down columns for the three Profile Send Off charts (Verified +
 *  Unverified Referrals + Already In System — split by Already In System then
 *  Referral Type/Source, see CHART_FILTERS). */
const PROFILE_COLS: { colId: string; label: string; pill?: boolean }[] = [
  { colId: "date_mm1wf43j", label: "Intake Date" },
  { colId: "color_mm1wwm05", label: "Days in Stage" },
  { colId: "color_mm1wm4n4", label: "Referral Type" },
  { colId: "color_mm1w5wxr", label: "Referral Source" },
  { colId: "color_mm2xe7r8", label: "Already In System" },
  { colId: "color_mm1w1978", label: "Request" },
  { colId: "color_mm24ap4j", label: "General Insurance" },
  { colId: "color_mm1xg10n", label: "Primary Insurance" },
  { colId: "text_mm1x2qk2", label: "Member ID 1" },
  { colId: "color_mm1yeksx", label: "Run Stedi" },
];

const RAW_CHART_DEFS: ChartDef[] = [
  // ── Board 18406352652 (Profile Send Off) — split into Verified/Unverified/
  //    Already-In-System Referrals (July 2026). "profile-send-off" keeps its id
  //    (old drill-down URLs stay valid) but now shows VERIFIED referrals only. ──
  {
    id: "profile-send-off",
    title: "Profile Send Off — Verified Referrals",
    boardId: 18406352652,
    notesColId: "text_mm389fs",
    drilldownCols: PROFILE_COLS,
  },
  {
    id: "profile-send-off-unverified",
    title: "Profile Send Off — Unverified Referrals",
    boardId: 18406352652,
    notesColId: "text_mm389fs",
    drilldownCols: PROFILE_COLS,
  },
  {
    id: "profile-send-off-in-system",
    title: "Profile Send Off — Already In System",
    boardId: 18406352652,
    notesColId: "text_mm389fs",
    drilldownCols: PROFILE_COLS,
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
      { colId: "color_mm2vhwan", label: "In-Network?", pill: true },
      { colId: "color_mm5q9y3", label: "Active?", pill: true },
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


  // ── Manager views (2026-07): merged escalation charts — Manager as
  //    Processor column. Data comes from the -escalations (Attempt 4+) and
  //    -escalated-3rd (3rd+ round) SOURCE charts; a patient matching both
  //    counts once, in the red 3rd+ series. Evaluate / Send Request have no
  //    Attempt-4+ pool, so their charts are red-only. ──
  {
    id: "evaluate-escalated-merged",
    title: "Evaluate (Escalated)",
    boardId: 18406060017,
    notesColId: "long_text_mm27zjt2",
    rowOf: "evaluate",
    stacked: { bId: "evaluate-escalated-3rd", aLabel: "Attempt 4+", bLabel: "3rd+ round", aColor: STACK_A_COLOR, bColor: STACK_B_COLOR },
    drilldownCols: [{ colId: "__series__", label: "Escalation Type", pill: true }, ...EVALUATE_COLS],
  },
  {
    id: "send-request-escalated-merged",
    title: "Send Request (Escalated)",
    boardId: 18406060017,
    notesColId: "long_text_mm27zjt2",
    rowOf: "send-request",
    stacked: { bId: "send-request-escalated-3rd", aLabel: "Attempt 4+", bLabel: "3rd+ round", aColor: STACK_A_COLOR, bColor: STACK_B_COLOR },
    drilldownCols: [{ colId: "__series__", label: "Escalation Type", pill: true }, ...SEND_REQUEST_COLS],
  },
  {
    id: "confirm-receipt-escalated-merged",
    title: "Confirm Receipt (Escalated)",
    boardId: 18406060017,
    notesColId: "long_text_mm2ytsxp",
    rowOf: "confirm-receipt",
    stacked: { aId: "confirm-receipt-escalations", bId: "confirm-receipt-escalated-3rd", aLabel: "Attempt 4+", bLabel: "3rd+ round", aColor: STACK_A_COLOR, bColor: STACK_B_COLOR },
    drilldownCols: [{ colId: "__series__", label: "Escalation Type", pill: true }, ...CONFIRM_COLS],
  },
  {
    id: "chase-fax-escalated-merged",
    title: "Chase Clinicals — Fax (Escalated)",
    boardId: 18406060017,
    notesColId: "long_text_mm2ytsxp",
    rowOf: "chase-fax",
    stacked: { aId: "chase-fax-escalations", bId: "chase-fax-escalated-3rd", aLabel: "Attempt 4+", bLabel: "3rd+ round", aColor: STACK_A_COLOR, bColor: STACK_B_COLOR },
    drilldownCols: [{ colId: "__series__", label: "Escalation Type", pill: true }, ...CHASE_COLS],
  },
  {
    id: "chase-email-parachute-escalated-merged",
    title: "Chase Clinicals — Email & Parachute (Escalated)",
    boardId: 18406060017,
    notesColId: "long_text_mm2ytsxp",
    rowOf: "chase-email-parachute",
    stacked: { aId: "chase-email-parachute-escalations", bId: "chase-email-parachute-escalated-3rd", aLabel: "Attempt 4+", bLabel: "3rd+ round", aColor: STACK_A_COLOR, bColor: STACK_B_COLOR },
    drilldownCols: [{ colId: "__series__", label: "Escalation Type", pill: true }, ...CHASE_COLS],
  },

  // ── Manager views: Proposed Stuck — Final Decisions column, one chart per
  //    stage (HANDOFF-Josh-Manager-Views §3). Drill-down shows the rep's
  //    reason and offers Approve Stuck / Return to Queue. ──
  {
    id: "evaluate-proposed-stuck",
    title: "Evaluate (Proposed Stuck)",
    boardId: 18406060017,
    notesColId: "long_text_mm27zjt2",
    rowOf: "evaluate",
    decision: "proposed-stuck",
    reasonColId: "long_text_mm27zjt2",
    drilldownCols: [
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "__proposedReason__", label: "Proposed Reason" },
      { colId: "color_mm1w5wxr", label: "Referral Source" },
      { colId: "color_mm1x157j", label: "Primary Insurance" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "color_mm1wz0vg", label: "MN Attempts" },
      { colId: "numeric_mm4bhjc8", label: "Evaluation Count" },
    ],
  },
  {
    id: "send-request-proposed-stuck",
    title: "Send Request (Proposed Stuck)",
    boardId: 18406060017,
    notesColId: "long_text_mm27zjt2",
    rowOf: "send-request",
    decision: "proposed-stuck",
    reasonColId: "long_text_mm27zjt2",
    drilldownCols: [
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "__proposedReason__", label: "Proposed Reason" },
      { colId: "color_mm1w5wxr", label: "Referral Source" },
      { colId: "color_mm1x157j", label: "Primary Insurance" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "color_mm1wz0vg", label: "MN Attempts" },
      { colId: "numeric_mm4bhjc8", label: "Evaluation Count" },
    ],
  },
  {
    id: "confirm-receipt-proposed-stuck",
    title: "Confirm Receipt (Proposed Stuck)",
    boardId: 18406060017,
    notesColId: "long_text_mm2ytsxp",
    rowOf: "confirm-receipt",
    decision: "proposed-stuck",
    reasonColId: "long_text_mm27zjt2",
    drilldownCols: [
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "__proposedReason__", label: "Proposed Reason" },
      { colId: "color_mm1w5wxr", label: "Referral Source" },
      { colId: "color_mm1x157j", label: "Primary Insurance" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "color_mm1wz0vg", label: "MN Attempts" },
      { colId: "numeric_mm4bhjc8", label: "Evaluation Count" },
    ],
  },
  {
    id: "chase-fax-proposed-stuck",
    title: "Chase Clinicals — Fax (Proposed Stuck)",
    boardId: 18406060017,
    notesColId: "long_text_mm2ytsxp",
    rowOf: "chase-fax",
    decision: "proposed-stuck",
    reasonColId: "long_text_mm27zjt2",
    drilldownCols: [
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "__proposedReason__", label: "Proposed Reason" },
      { colId: "color_mm1w5wxr", label: "Referral Source" },
      { colId: "color_mm1x157j", label: "Primary Insurance" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "color_mm1wz0vg", label: "MN Attempts" },
      { colId: "numeric_mm4bhjc8", label: "Evaluation Count" },
    ],
  },
  {
    id: "chase-email-parachute-proposed-stuck",
    title: "Chase Clinicals — Email & Parachute (Proposed Stuck)",
    boardId: 18406060017,
    notesColId: "long_text_mm2ytsxp",
    rowOf: "chase-email-parachute",
    decision: "proposed-stuck",
    reasonColId: "long_text_mm27zjt2",
    drilldownCols: [
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "__proposedReason__", label: "Proposed Reason" },
      { colId: "color_mm1w5wxr", label: "Referral Source" },
      { colId: "color_mm1x157j", label: "Primary Insurance" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "color_mm1wz0vg", label: "MN Attempts" },
      { colId: "numeric_mm4bhjc8", label: "Evaluation Count" },
    ],
  },

  // ── Manager views: Insurance — Final Decisions "Benefits" (universal
  //    check failed: Out-of-Network / Medicare not Primary / Not Active /
  //    Not Covered — the failed-check submit, display only for now) and
  //    Manager Intervention "DVS — Retry Queue" (filters on stage DVS + a
  //    "Retry Queued" status on Supplies/Pump DVS; the x-axis is days IN
  //    STAGE, not days in queue — the bot doesn't write a queue-entered date
  //    yet, DVS handoff §10). ──
  // Final Decisions (Manager Views §3): one chart per Insurance sub-stage, for
  // patients flagged "Final Escalation Required" (auto on a failed universal
  // check, or manual via the Propose Stuck button). decision "insurance-final"
  // gives the drill-down Approve Stuck (→ "Stuck / Don't Proceed" stage) /
  // Return to Queue (clear escalation) actions.
  {
    id: "benefits-final-escalation",
    title: "Benefits",
    boardId: 18410601299,
    notesColId: "long_text_mm2ffsme",
    rowOf: "benefits",
    decision: "insurance-final",
    reasonColId: "long_text_mm2ffsme",
    // Reason-bucketed x-axis (Katie 2026-07-29): HOW the patient got here —
    // a rep's Propose Stuck (filtered off the "[Proposed Stuck" note stamp)
    // vs an automatic failed universal check (filtered off the board columns
    // the send writes: In-Network? OON / Medicare not Primary, DME
    // Partial/No). The population stays "Final Escalation Required" — the
    // buckets categorize within it, and a legacy patient matching neither
    // still counts in the header total.
    reasonBuckets: [
      { key: "proposed", label: "Propose Stuck", short: "Proposed", filterId: "benefits-final-proposed", color: REASON_COLORS.sky },
      { key: "universal", label: "Universal Check", short: "Universal", filterId: "benefits-final-universal", color: REASON_COLORS.amber },
    ],
    drilldownCols: [
      { colId: "__reasons__", label: "Reason", pill: true },
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "color_mm1x157j", label: "Primary Insurance" },
      { colId: "color_mm2vhwan", label: "In-Network?", pill: true },
      { colId: "color_mm5q9y3", label: "Active?", pill: true },
      { colId: "color_mm2vt8xg", label: "DME Benefits", pill: true },
      { colId: "color_mm2vsh2f", label: "Escalation", pill: true },
      { colId: "__proposedReason__", label: "Proposed Reason" },
    ],
  },
  {
    id: "submit-auth-final-escalation",
    title: "Submit Auth",
    boardId: 18410601299,
    notesColId: "long_text_mm2ffsme",
    rowOf: "submit-auth",
    decision: "insurance-final",
    reasonColId: "long_text_mm2ffsme",
    // REASON-BUCKETED, mirroring the Manager Intervention chart above it
    // (Josh, 2026-08-02) — same three reasons, one rung further up. Like that
    // chart this has NO CHART_FILTERS entry of its own: the population is the
    // union of the bars, which is what lets the DVS bars (stage "DVS") sit in
    // the Submit Auth row alongside a proposed-stuck bar (stage "Submit Auth.").
    reasonBuckets: [
      { key: "dvs-retry", label: "DVS Retry", short: "DVS Retry", filterId: "dvs-retry-queue-final", color: REASON_COLORS.sky },
      { key: "dvs-manual", label: "DVS Manual Review", short: "DVS Manual", filterId: "dvs-manual-review-final", color: REASON_COLORS.amber },
      { key: "proposed", label: "Propose Stuck", short: "Proposed", filterId: "submit-auth-proposed-final", color: REASON_COLORS.violet },
    ],
    drilldownCols: [
      { colId: "date_mm1wf43j", label: "Intake Date" },
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "color_mm1x157j", label: "Primary Insurance" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "color_mm2vsh2f", label: "Escalation", pill: true },
      { colId: "__proposedReason__", label: "Proposed Reason" },
    ],
  },
  {
    id: "auth-outstanding-final-escalation",
    title: "Auth Outstanding",
    boardId: 18410601299,
    notesColId: "long_text_mm2ffsme",
    rowOf: "auth-outstanding",
    decision: "insurance-final",
    reasonColId: "long_text_mm2ffsme",
    // Reason bars rather than days (Josh, 2026-08-02) — "days in stage" said
    // nothing a manager could act on.
    //
    // AUTH OUTSTANDING HAS EXACTLY ONE MANAGER RUNG (Josh, 2026-08-03): an
    // escalation at this stage should only ever land in Final Decisions. A
    // Manager Intervention chart was built for it earlier the same night and
    // then removed on that instruction; every write that escalates here now
    // aims at Final instead (`authOutstandingOutcome`, `manualEscalationLevel`,
    // `proposeStuckLevel`). The Pump SoS bar moved up from that deleted chart,
    // because the rung changed — the reason a manager needs to SEE did not.
    //
    // Consequently the bars do NOT split on escalation level, unlike their
    // Submit Auth twins: that pair splits so a promoted patient leaves the
    // lower chart, and with one rung there is nothing to leave. Matching the
    // population rule instead means a stray Manager label — carried in from an
    // earlier stage, or written by one of the four DVS/claims board
    // automations — still gets bucketed by REASON rather than dropping into
    // "+N in no bar".
    reasonBuckets: [
      { key: "pump-sos", label: "Pump SoS", short: "Pump SoS", filterId: "auth-outstanding-pump-sos-final", color: REASON_COLORS.amber },
      { key: "proposed", label: "Propose Stuck", short: "Proposed", filterId: "auth-outstanding-proposed-final", color: REASON_COLORS.violet },
    ],
    drilldownCols: [
      { colId: "__reasons__", label: "Reason", pill: true },
      { colId: "__proposedReason__", label: "Proposed Reason" },
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "color_mm1x157j", label: "Primary Insurance" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "dropdown_mm2vez5a", label: "Not Clear Products", pill: true },
      { colId: "color_mm2vsh2f", label: "Escalation", pill: true },
    ],
  },
  // Manager view: Insurance — Benefits row, REASON-BUCKETED (Katie
  // 2026-07-29): one bar per reason a manager needs eyes on a Benefits
  // patient, not day buckets. Population = the bars unioned with the chart's
  // own safety-net rule; the count is distinct patients (a patient can match
  // several bars).
  {
    id: "benefits-manager-escalation",
    title: "Benefits",
    boardId: 18410601299,
    notesColId: "long_text_mm2ffsme",
    rowOf: "benefits",
    reasonBuckets: [
      { key: "inactive", label: "Inactive insurance", short: "Inactive", filterId: "benefits-manager-inactive", color: REASON_COLORS.sky },
      { key: "pump-sos", label: "Pump SoS", short: "Pump SoS", filterId: "benefits-manager-pump-sos", color: REASON_COLORS.amber },
      { key: "overdue", label: "Check outstanding >5d", short: ">5 days", filterId: "benefits-manager-overdue", color: REASON_COLORS.violet },
    ],
    drilldownCols: [
      { colId: "__reasons__", label: "Reason", pill: true },
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "color_mm1x157j", label: "Primary Insurance" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "color_mm5q9y3", label: "Active?", pill: true },
      { colId: "color_mm2vemyy", label: "SoS", pill: true },
      { colId: "dropdown_mm2vez5a", label: "Not Clear Products", pill: true },
      { colId: "color_mm2vsh2f", label: "Escalation", pill: true },
    ],
  },
  // Manager view: Insurance — Submit Auth row, MERGED (Brandon 2026-07-29):
  // the old "DVS — Retry Queue" and "DVS — Manual Review" charts fold into
  // one "Submit Auth" chart so the manager sees the total outstanding-auth
  // workload at a glance, plus the Submit Auth stuck PROPOSALS (which now
  // land here first — the two-step review). The drill-down offers Escalate
  // to Final Decisions on the proposed rows.
  {
    id: "submit-auth-manager",
    title: "Submit Auth",
    boardId: 18410601299,
    notesColId: "long_text_mm2ffsme",
    rowOf: "submit-auth",
    decision: "submit-auth-manager",
    reasonColId: "long_text_mm2ffsme",
    reasonBuckets: [
      { key: "dvs-retry", label: "DVS Retry", short: "DVS Retry", filterId: "dvs-retry-queue", color: REASON_COLORS.sky },
      { key: "dvs-manual", label: "DVS Manual Review", short: "DVS Manual", filterId: "dvs-manual-review", color: REASON_COLORS.amber },
      { key: "proposed", label: "Propose Stuck", short: "Proposed", filterId: "submit-auth-proposed-manager", color: REASON_COLORS.violet },
    ],
    drilldownCols: [
      { colId: "__reasons__", label: "Reason", pill: true },
      // The rep's stamped reason sits right after the bar tag — on a
      // Propose Stuck row it's what the manager decides from (blank on the
      // DVS rows, which have no proposal).
      { colId: "__proposedReason__", label: "Proposed Reason" },
      { colId: "color_mm1wwm05", label: "Days in Stage" },
      { colId: "color_mm1x157j", label: "Primary Insurance" },
      { colId: "color_mm1w1cm9", label: "Serving" },
      { colId: "numeric_mm27nexq", label: "Retry Count" },
      { colId: "color_mm26pk1a", label: "Supplies DVS", pill: true },
      { colId: "color_mm578kbd", label: "Pump DVS", pill: true },
      { colId: "color_mm284z0b", label: "Claims", pill: true },
      { colId: "color_mm2vsh2f", label: "Escalation", pill: true },
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
  const cols = ["color_mm2vhwan", "color_mm5q9y3", "color_mm2vt8xg", "color_mm2vg3ew", "color_mm2vemyy"];
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

/**
 * Mirror the column-1 stage's drill-down columns into its manager-view
 * counterparts (Manager Intervention + Final Decisions), so a manager reads the
 * SAME fields whichever column they drilled from — a Final-Decisions Benefits
 * row shows Active/Network, DME Benefits, Auth, SoS … exactly like the
 * Processor Overview Benefits row.
 *
 * A manager chart names its row via `rowOf`, which is what makes this
 * automatic. Its OWN columns are kept first and win on conflict (that's where
 * the decision-specific ones live — Proposed Reason, Escalation, the stacked
 * chart's Escalation Type) and the base stage's columns are appended after,
 * skipping any already present. Column sets are therefore static: they come
 * from the chart definitions, never from which patients happen to be loaded.
 */
function withMirroredRowCols(chart: ChartDef, byId: Map<string, ChartDef>): ChartDef {
  if (!chart.rowOf) return chart;
  const base = byId.get(chart.rowOf);
  if (!base || base.id === chart.id) return chart;
  const cols = [...chart.drilldownCols];
  const seen = new Set(cols.map((c) => c.colId));
  for (const c of base.drilldownCols) {
    if (seen.has(c.colId)) continue;
    seen.add(c.colId);
    cols.push(c);
  }
  return { ...chart, drilldownCols: cols };
}

const PRIORITISED_CHART_DEFS = RAW_CHART_DEFS.map(withPriorityCols);
const CHART_DEFS_BY_ID = new Map(PRIORITISED_CHART_DEFS.map((c) => [c.id, c]));

export const CHART_DEFS: ChartDef[] = PRIORITISED_CHART_DEFS.map((c) =>
  withMirroredRowCols(c, CHART_DEFS_BY_ID),
);

// ── Section grouping (main view) ────────────────────────────────────────
export interface OversightSection {
  id: string;
  title: string;
  /** Chart IDs in display order. Unknown IDs are skipped gracefully. */
  chartIds: string[];
  /** Column-1 header (defaults to "Active"). Manager views: "Processor Overview". */
  primaryTitle?: string;
  /** Optional second column (amber header). Manager views: "Manager Intervention". */
  secondaryTitle?: string;
  secondaryChartIds?: string[];
  /** Optional third column (rose header). Manager views: "Final Decisions". */
  tertiaryTitle?: string;
  tertiaryChartIds?: string[];
}

export const OVERSIGHT_SECTIONS: OversightSection[] = [
  { id: "intake", title: "Intake", chartIds: ["profile-send-off", "profile-send-off-unverified", "profile-send-off-in-system"] },
  // Manager views (Brandon 2026-07-20): both stages share the 3-column
  // scheme — Processor Overview / Manager Intervention / Final Decisions —
  // with rows horizontally aligned via each chart's rowOf.
  {
    id: "medical-evaluation",
    title: "Medical Evaluation",
    chartIds: ["evaluate", "send-request", "confirm-receipt", "chase-fax", "chase-email-parachute"],
    primaryTitle: "Processor Overview",
    secondaryTitle: "Manager Intervention",
    secondaryChartIds: [
      "evaluate-escalated-merged",
      "send-request-escalated-merged",
      "confirm-receipt-escalated-merged",
      "chase-fax-escalated-merged",
      "chase-email-parachute-escalated-merged",
    ],
    tertiaryTitle: "Final Decisions",
    tertiaryChartIds: [
      "evaluate-proposed-stuck",
      "send-request-proposed-stuck",
      "confirm-receipt-proposed-stuck",
      "chase-fax-proposed-stuck",
      "chase-email-parachute-proposed-stuck",
    ],
  },
  {
    id: "insurance",
    title: "Insurance",
    chartIds: ["benefits", "submit-auth", "auth-outstanding", "auth-denial"],
    primaryTitle: "Processor Overview",
    secondaryTitle: "Manager Intervention",
    // 2026-07-29: the two DVS charts merged into the reason-bucketed
    // "Submit Auth" chart (DVS Retry · DVS Manual Review · Propose Stuck).
    // Two rows deliberately have NO Manager Intervention chart (Josh,
    // 2026-08-03) — both recorded in insuranceCoverage.test.ts so they stay
    // decisions rather than drifting into oversights:
    //   • Auth Outstanding — one rung only; escalations there land in Final
    //     Decisions. (A Manager chart was built earlier the same night and
    //     removed on Josh's instruction; the writes were re-aimed at Final so
    //     the row is covered, not blind.)
    //   • Auth Denied — the stage is under construction; no UI for it, and it
    //     has no Final Decisions chart either.
    secondaryChartIds: ["benefits-manager-escalation", "submit-auth-manager"],
    tertiaryTitle: "Final Decisions",
    tertiaryChartIds: [
      "benefits-final-escalation",
      "submit-auth-final-escalation",
      "auth-outstanding-final-escalation",
    ],
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
  // group_mm5gp2r2 = DVS: added 2026-07 when DVS got its own group (a
  // group-move automation). Without it the DVS-stage items are never fetched,
  // so the DVS charts (Retry Queue, Manual Review) show nothing.
  18410601299: ["group_mm1xr3q3", "group_mm1x1416", "group_mm2v6d1z", "group_mm5gp2r2", "group_mm316hg2"],
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
    // The stamped-reason source is often NOT a drilldown column (the
    // drill-down shows the derived __proposedReason__ instead), so fetch it
    // explicitly or the "Proposed Reason" cell reads permanently blank.
    if (chart.reasonColId) set.add(chart.reasonColId);
    // Every column a chart's filter rules condition on — the population rule
    // AND its reason-bucket rules. A filter column missing from the fetch
    // silently matches nothing, so collect them from the rules themselves
    // instead of trusting each one to also be a drilldown column.
    const rules = [
      CHART_FILTERS[chart.id],
      ...(chart.reasonBuckets ?? []).map((b) => CHART_FILTERS[b.filterId]),
    ];
    for (const rule of rules) {
      if (!rule) continue;
      for (const c of [...(rule.andCols ?? []), ...(rule.anyCols ?? [])]) set.add(c.colId);
    }
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
    // Escalation status backs the 3rd-attempt (index 0) filters AND the
    // Final-Decisions "Proposed Stuck" charts (index 2). The MN notes
    // (long_text_mm27zjt2, a notesColId) carry the stamped reason.
    set.add("color_mm1x7997");
  }

  // Insurance board — the Benefits check-failed filter needs the Escalation
  // status; the DVS retry-queue filter needs the Retry Count.
  if (boardId === 18410601299) {
    set.add("color_mm2vsh2f");    // Escalation status
    set.add("numeric_mm27nexq");  // Retry Count
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
  value: string | null;
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

  // ALL of the board's groups in ONE query. This used to be a `for` loop
  // issuing one round trip per group, which made the Insurance board (5 groups)
  // five sequential Monday calls — the dominant cost of the oversight load,
  // since boards are already fetched in parallel and Insurance is the slowest.
  // Monday's `groups(ids: [...])` returns a page per group, so the whole board
  // costs one round trip unless a group actually overflows PAGE_SIZE.
  const firstQuery = `
    query ($boardId: ID!, $groupIds: [String!], $cols: [String!]) {
      boards(ids: [$boardId]) {
        groups(ids: $groupIds) {
          id
          items_page(limit: ${PAGE_SIZE}) {
            cursor
            items {
              id
              name
              group { id }
              column_values(ids: $cols) { id text value }
            }
          }
        }
      }
    }
  `;

  const data = await gql<{
    boards: {
      groups: {
        id: string;
        items_page: { cursor: string | null; items: RawItem[] };
      }[];
    }[];
  }>(firstQuery, { boardId: String(boardId), groupIds, cols: columnIds });

  const groups = data.boards?.[0]?.groups ?? [];
  // Groups whose first page filled up still need their cursor followed. Rare
  // (PAGE_SIZE is 500), and the follow-ups run in parallel across groups.
  const overflowing: { groupId: string; cursor: string }[] = [];
  for (const g of groups) {
    allItems.push(...(g.items_page?.items ?? []));
    if (g.items_page?.cursor) overflowing.push({ groupId: g.id, cursor: g.items_page.cursor });
  }

  const overflowPages = await Promise.all(
    overflowing.map(async ({ groupId, cursor: startCursor }) => {
      const items: RawItem[] = [];
      let cursor: string | null = startCursor;
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
                  column_values(ids: $cols) { id text value }
                }
              }
            }
          `;
          const next: { next_items_page: { cursor: string | null; items: RawItem[] } } = await gql(
            nextQuery,
            { cursor, cols: columnIds },
          );

          items.push(...(next.next_items_page?.items ?? []));
          cursor = next.next_items_page?.cursor ?? null;
        } catch (e) {
          console.error(`[oversightApi] pagination error board=${boardId} group=${groupId}`, e);
          break;
        }
      }
      return items;
    }),
  );

  for (const page of overflowPages) allItems.push(...page);

  return allItems;
}

// ── Item → OversightPatient mapper ──────────────────────────────────────

function mapItem(raw: RawItem, boardId: number): OversightPatient {
  // Build cols record (label text) + colIndex record (status index from `value`)
  const cols: Record<string, string> = {};
  const colIndex: Record<string, number> = {};
  cols["name"] = raw.name;
  for (const cv of raw.column_values) {
    cols[cv.id] = cv.text ?? "";
    if (cv.value) {
      try {
        const parsed = JSON.parse(cv.value) as { index?: number } | null;
        if (typeof parsed?.index === "number") colIndex[cv.id] = parsed.index;
      } catch {
        /* non-status column or unparseable value — skip */
      }
    }
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
    colIndex,
  };
}

// ── Chart filtering rules ───────────────────────────────────────────────

/** One column condition: the column's text must be (one of) `value` — or NOT
 *  one of it when `not` is true. Alternatively `gte` does a numeric
 *  "column value >= N" test (used for Evaluation Counter >= 3). */
interface ColCondition {
  colId: string;
  value?: string | string[];
  /** Match by status INDEX instead of label text (rename-proof — use for status
   *  columns whose labels may change on the board, e.g. Escalation). One index
   *  or a set. Use this OR `value`, not both. */
  index?: number | number[];
  /** SUBSTRING match: passes when the cell text contains ANY of these strings.
   *  Used for dropdown cells (comma-joined labels, e.g. Not Clear Products
   *  contains "Insulin Pump") and for note-stamp tags (Reference Notes contain
   *  "[Proposed Stuck"). Exclusive with `value`/`index`/`gte`. */
  containsAny?: string[];
  not?: boolean;
  gte?: number;
}

interface ChartFilter {
  type: "group";
  groupId: string;
  /** Optional extra AND conditions on top of the group — used for the Profile
   *  Send Off Verified/Unverified Referrals split. */
  andCols?: ColCondition[];
  /** Optional OR conditions: at least ONE must match (ANDed with andCols).
   *  Used for "Unverified = Referral Type Patient OR Source CareCentrix". */
  anyCols?: ColCondition[];
}

interface ChartFilterStageAdvancer {
  type: "stageAdvancer";
  boardId: number;
  value: string;
  /** Optional extra AND conditions on top of the stage. Used for escalations
   *  (MN Attempts = "Escalate"), the Chase method split (Fax = NOT
   *  Email/Parachute, so blank counts as fax; Email & Parachute = either),
   *  and the 3rd+ Attempt escalation counter threshold. */
  andCols?: ColCondition[];
  anyCols?: ColCondition[];
}

type FilterRule = ChartFilter | ChartFilterStageAdvancer;

const CHART_FILTERS: Record<string, FilterRule> = {
  // Profile Send Off split (rule mirrors lib/profile/referralSplit.ts):
  // Already In System "Yes" wins FIRST (so it's ANDed out of the other two);
  // then Unverified = Referral Type "Patient" OR Referral Source "CareCentrix";
  // Verified = neither. Only the TYPE column routes "Patient" — the SOURCE
  // column has its own "Patient" label that must NOT match.
  "profile-send-off":            { type: "group", groupId: "group_mm1xf2jb", andCols: [{ colId: "color_mm2xe7r8", value: "Yes", not: true }, { colId: "color_mm1wm4n4", value: "Patient", not: true }, { colId: "color_mm1w5wxr", value: "CareCentrix", not: true }] },
  "profile-send-off-unverified": { type: "group", groupId: "group_mm1xf2jb", andCols: [{ colId: "color_mm2xe7r8", value: "Yes", not: true }], anyCols: [{ colId: "color_mm1wm4n4", value: "Patient" }, { colId: "color_mm1w5wxr", value: "CareCentrix" }] },
  "profile-send-off-in-system":  { type: "group", groupId: "group_mm1xf2jb", andCols: [{ colId: "color_mm2xe7r8", value: "Yes" }] },
  "evaluate":           { type: "stageAdvancer", boardId: 18406060017, value: "Evaluate MN", andCols: [{ colId: "color_mm1x7997", index: [2], not: true }] },
  "send-request":       { type: "stageAdvancer", boardId: 18406060017, value: "Send Request", andCols: [{ colId: "color_mm1x7997", index: [2], not: true }] },
  "confirm-receipt":    { type: "stageAdvancer", boardId: 18406060017, value: "Confirm Receipt", andCols: [{ colId: "color_mm1x7997", index: [2], not: true }] },
  // Chase Clinicals split by method: Fax (= NOT Email/Parachute, so a blank
  // method still shows under Fax) vs Email & Parachute (either). Method col = color_mm1xw7y5.
  "chase-fax":             { type: "stageAdvancer", boardId: 18406060017, value: "Chase Clinicals", andCols: [{ colId: "color_mm1x7997", index: [2], not: true }, { colId: "color_mm1xw7y5", value: ["Email", "Parachute"], not: true }] },
  "chase-email-parachute": { type: "stageAdvancer", boardId: 18406060017, value: "Chase Clinicals", andCols: [{ colId: "color_mm1x7997", index: [2], not: true }, { colId: "color_mm1xw7y5", value: ["Email", "Parachute"] }] },
  // Escalations = same stage AND MN Attempts column = "Escalate" (attempt 4+).
  "confirm-receipt-escalations":       { type: "stageAdvancer", boardId: 18406060017, value: "Confirm Receipt", andCols: [{ colId: "color_mm1x7997", index: [2], not: true }, { colId: "color_mm1wz0vg", value: "Escalate" }] },
  "chase-fax-escalations":             { type: "stageAdvancer", boardId: 18406060017, value: "Chase Clinicals", andCols: [{ colId: "color_mm1x7997", index: [2], not: true }, { colId: "color_mm1xw7y5", value: ["Email", "Parachute"], not: true }, { colId: "color_mm1wz0vg", value: "Escalate" }] },
  "chase-email-parachute-escalations": { type: "stageAdvancer", boardId: 18406060017, value: "Chase Clinicals", andCols: [{ colId: "color_mm1x7997", index: [2], not: true }, { colId: "color_mm1xw7y5", value: ["Email", "Parachute"] }, { colId: "color_mm1wz0vg", value: "Escalate" }] },
  // 3rd+ Attempt escalations = same stage AND Escalation = Manager Escalation
  // Required (color_mm1x7997 index 0) AND Evaluation Counter ≥ 3. The Evaluate
  // SOP escalates at counter ≥ 3 and the patient stays in Evaluate MN, so the
  // counter can keep climbing — the filter uses ≥ 3 (not == 3) to match the
  // trigger and never drop an escalated patient. Index [0] (Manager) inherently
  // excludes a stuck PROPOSAL (index 2), which lives in Final Decisions instead.
  "evaluate-escalated-3rd":                { type: "stageAdvancer", boardId: 18406060017, value: "Evaluate MN",     andCols: [{ colId: "color_mm1x7997", index: [0] }, { colId: "numeric_mm4bhjc8", gte: 3 }] },
  "send-request-escalated-3rd":            { type: "stageAdvancer", boardId: 18406060017, value: "Send Request",    andCols: [{ colId: "color_mm1x7997", index: [0] }, { colId: "numeric_mm4bhjc8", gte: 3 }] },
  "confirm-receipt-escalated-3rd":         { type: "stageAdvancer", boardId: 18406060017, value: "Confirm Receipt", andCols: [{ colId: "color_mm1x7997", index: [0] }, { colId: "numeric_mm4bhjc8", gte: 3 }] },
  "chase-fax-escalated-3rd":               { type: "stageAdvancer", boardId: 18406060017, value: "Chase Clinicals", andCols: [{ colId: "color_mm1xw7y5", value: ["Email", "Parachute"], not: true }, { colId: "color_mm1x7997", index: [0] }, { colId: "numeric_mm4bhjc8", gte: 3 }] },
  "chase-email-parachute-escalated-3rd":   { type: "stageAdvancer", boardId: 18406060017, value: "Chase Clinicals", andCols: [{ colId: "color_mm1xw7y5", value: ["Email", "Parachute"] }, { colId: "color_mm1x7997", index: [0] }, { colId: "numeric_mm4bhjc8", gte: 3 }] },
  // ── Insurance Processor Overview (column 1) ──
  // NON-ESCALATED ONLY (Josh 2026-07-30): this column is the processors' own
  // working queue, so a patient flagged for a manager — either level — belongs
  // to columns 2/3 and drops out of here. Matches the counting contract, where
  // a role's active count is likewise "not escalated" (useRoleCounts samActive
  // + both baseline generators, CLAUDE.md §5.8). Escalation color_mm2vsh2f:
  // index 0 = Manager Escalation Required, 2 = Final Escalation Required
  // (matched by INDEX so a board rename can't silently reopen the queue).
  "benefits":           { type: "stageAdvancer", boardId: 18410601299, value: "Benefits / SoS",    andCols: [{ colId: "color_mm2vsh2f", index: [0, 2], not: true }] },
  "submit-auth":        { type: "stageAdvancer", boardId: 18410601299, value: "Submit Auth.",      andCols: [{ colId: "color_mm2vsh2f", index: [0, 2], not: true }] },
  "auth-outstanding":   { type: "stageAdvancer", boardId: 18410601299, value: "Auth. Outstanding", andCols: [{ colId: "color_mm2vsh2f", index: [0, 2], not: true }] },
  "auth-denial":        { type: "group", groupId: "group_mm316hg2", andCols: [{ colId: "color_mm2vsh2f", index: [0, 2], not: true }] },
  "welcome-call":       { type: "group", groupId: "group_mm1wvq8p" },
  "profile-review":     { type: "group", groupId: "group_mm2x8jtj" },

  // ── Manager views (2026-07) ──
  // Proposed Stuck (Final Decisions): stage + Escalation = "Final Escalation
  // Required" (color_mm1x7997 index 2). The rep's reason is appended to the MN
  // notes (stamped), not a column. The chase charts keep the §5.9 method split.
  "evaluate-proposed-stuck":        { type: "stageAdvancer", boardId: 18406060017, value: "Evaluate MN",     andCols: [{ colId: "color_mm1x7997", index: [2] }] },
  "send-request-proposed-stuck":    { type: "stageAdvancer", boardId: 18406060017, value: "Send Request",    andCols: [{ colId: "color_mm1x7997", index: [2] }] },
  "confirm-receipt-proposed-stuck": { type: "stageAdvancer", boardId: 18406060017, value: "Confirm Receipt", andCols: [{ colId: "color_mm1x7997", index: [2] }] },
  "chase-fax-proposed-stuck":       { type: "stageAdvancer", boardId: 18406060017, value: "Chase Clinicals", andCols: [{ colId: "color_mm1xw7y5", value: ["Email", "Parachute"], not: true }, { colId: "color_mm1x7997", index: [2] }] },
  "chase-email-parachute-proposed-stuck": { type: "stageAdvancer", boardId: 18406060017, value: "Chase Clinicals", andCols: [{ colId: "color_mm1xw7y5", value: ["Email", "Parachute"] }, { colId: "color_mm1x7997", index: [2] }] },
  // Benefits check-failed (Final Decisions): still at Benefits, Escalation
  // Required, and at least one universal check failed on the board.
  // Final Decisions: any Benefits item flagged Final Escalation Required —
  // either auto (failed universal check) or manual (Propose Stuck button). The
  // status label now uniquely encodes it, so the old Stuck/Partial-No board
  // heuristic is dropped (a Propose-Stuck item need not have those set).
  "benefits-final-escalation": { type: "stageAdvancer", boardId: 18410601299, value: "Benefits / SoS", andCols: [{ colId: "color_mm2vsh2f", value: "Final Escalation Required" }] },
  // Safety net (2026-08-03), NOT a narrowing: `patientMatchesChart` unions the
  // chart rule with its bars, so this ADDS the Submit Auth patients whose Final
  // escalation carries no stamp. The DVS bars (stage "DVS", not "Submit Auth.")
  // are unaffected — they come in through the union, which is why this chart
  // could not have a stage rule before. Escalation matched by INDEX (0 =
  // Manager, 2 = Final) so a board rename can't silently empty the chart.
  "submit-auth-final-escalation": { type: "stageAdvancer", boardId: 18410601299, value: "Submit Auth.", andCols: [{ colId: "color_mm2vsh2f", index: [2] }] },
  // Auth Outstanding's ONE manager rung (Josh, 2026-08-03), so this matches ANY
  // escalation at the stage — index 0 (Manager) as well as 2 (Final) — rather
  // than Final alone. Nothing in the SPA writes Manager here any more, but a
  // label can still arrive on a patient: carried in from an earlier stage, or
  // written by one of the four DVS/claims board automations, which trigger on
  // their rose columns regardless of stage. With no Manager chart to catch
  // those, matching Final only would make them invisible in the whole app —
  // exactly the failure insuranceCoverage.test.ts exists to prevent.
  "auth-outstanding-final-escalation": { type: "stageAdvancer", boardId: 18410601299, value: "Auth. Outstanding", andCols: [{ colId: "color_mm2vsh2f", index: [0, 2] }] },
  // ⚠️ Auth Denied has NO manager charts, deliberately (Josh, 2026-08-03): the
  // stage is under construction, so don't build UI for it. It is the one known
  // exception to "every escalated patient lands in some manager chart" — every
  // denial escalates, which drops the patient out of the Processor Overview
  // "auth-denial" chart and out of the rep's counts, and there is no page for
  // the count-only `authDenied` role. Expect them to be worked on the board
  // until the stage is built. insuranceCoverage.test.ts records the carve-out
  // so the invariant still holds everywhere else.
  // The two bars subdivide it. Both take the SAME escalation condition as the
  // chart (any rung, not Final alone) so a stray Manager label is bucketed by
  // reason instead of landing in "+N in no bar" — see the chart def.
  //
  // Pump SoS: the send writes the same Not Clear Products dropdown here as at
  // Benefits (the recheck feeds `effectiveSos`), so the bar reads the same
  // column as its Benefits twin. This bar moved up from the deleted
  // `auth-outstanding-manager` chart when the rung became Final.
  "auth-outstanding-pump-sos-final": { type: "stageAdvancer", boardId: 18410601299, value: "Auth. Outstanding", andCols: [{ colId: "color_mm2vsh2f", index: [0, 2] }, { colId: "dropdown_mm2vez5a", containsAny: ["Insulin Pump"] }] },
  "auth-outstanding-proposed-final": { type: "stageAdvancer", boardId: 18410601299, value: "Auth. Outstanding", andCols: [{ colId: "color_mm2vsh2f", index: [0, 2] }, { colId: "long_text_mm2ffsme", containsAny: ["[Proposed Stuck"] }] },
  "submit-auth-proposed-final": { type: "stageAdvancer", boardId: 18410601299, value: "Submit Auth.", andCols: [{ colId: "color_mm2vsh2f", value: "Final Escalation Required" }, { colId: "long_text_mm2ffsme", containsAny: ["[Proposed Stuck"] }] },
  // ── Manager Intervention: Benefits reason buckets (Katie 2026-07-29). ──
  // The chart id's own rule below is a SAFETY NET unioned with these three
  // bucket rules, not a filter over them (see `patientMatchesChart`): the bars
  // are board facts and match escalated and non-escalated patients alike, so
  // requiring the label here would have thrown the fact-only rows out. What it
  // catches is the reverse — a Manager label with none of the three facts on
  // the board, which is invisible to the rep (escalated) and to every bar.
  "benefits-manager-escalation": { type: "stageAdvancer", boardId: 18410601299, value: "Benefits / SoS", andCols: [{ colId: "color_mm2vsh2f", index: [0] }] },
  //
  // Inactive insurance: Active? = Inactive (index 2 — the column split).
  "benefits-manager-inactive": { type: "stageAdvancer", boardId: 18410601299, value: "Benefits / SoS", andCols: [{ colId: "color_mm5q9y3", index: [2] }] },
  // Pump SoS: same-or-similar Not Clear on the insulin pump specifically —
  // the Not Clear Products dropdown (comma-joined labels) contains it. Other
  // products being Not Clear deliberately do NOT put a patient here.
  "benefits-manager-pump-sos": { type: "stageAdvancer", boardId: 18410601299, value: "Benefits / SoS", andCols: [{ colId: "dropdown_mm2vez5a", containsAny: ["Insulin Pump"] }] },
  // Check outstanding >5 days (Josh 2026-07-29): Escalation = Manager
  // Escalation Required AND Days in Stage at "6–8 Days" or beyond. Board
  // automation 7921298383 (active, verified) flips the escalation when the
  // days column CHANGES TO 6–8 Days at the Benefits stage, so the label is
  // how a patient arrives — and a manager clearing the escalation (Return to
  // Queue) removes them from the bar even though the days keep climbing.
  // Days matched by INDEX (settings keys 2,3,4,6,7,8 — note 5 is unused on
  // the board) so the en-dash/hyphen mix in the labels can't bite.
  "benefits-manager-overdue": { type: "stageAdvancer", boardId: 18410601299, value: "Benefits / SoS", andCols: [{ colId: "color_mm2vsh2f", value: "Manager Escalation Required" }, { colId: "color_mm1wwm05", index: [2, 3, 4, 6, 7, 8] }] },
  // ── Final Decisions: Benefits reason buckets — HOW the patient arrived. ──
  // Both are subsets of benefits-final-escalation (the population rule).
  // Propose Stuck: the rep's stamped reason line is the marker (the stamp is
  // the contract with samantha/ProposeStuckButton). A patient proposed once,
  // returned, then auto-escalated later can match BOTH bars — the stamp is an
  // audit trail and deliberately never removed.
  "benefits-final-proposed": { type: "stageAdvancer", boardId: 18410601299, value: "Benefits / SoS", andCols: [{ colId: "color_mm2vsh2f", value: "Final Escalation Required" }, { colId: "long_text_mm2ffsme", containsAny: ["[Proposed Stuck"] }] },
  // Universal Check: the failed check is on the board — In-Network? =
  // Out-of-Network / Medicare not Primary, or DME Benefits = Partial / No.
  // (Inactive is NOT here — it escalates to Manager Intervention instead.)
  "benefits-final-universal": {
    type: "stageAdvancer", boardId: 18410601299, value: "Benefits / SoS",
    andCols: [{ colId: "color_mm2vsh2f", value: "Final Escalation Required" }],
    anyCols: [
      { colId: "color_mm2vhwan", value: ["Out-of-Network", "Medicare not Primary"] },
      { colId: "color_mm2vt8xg", value: "Partial / No" },
    ],
  },
  // ── Manager Intervention: Submit Auth proposed-stuck bucket (2026-07-29,
  // two-step review). Escalation = Manager + the rep's stamp — the stamp
  // requirement keeps a manually-toggled Submit Auth escalation (the send's
  // escalate toggle also writes Manager) out of the Propose Stuck bar. ──
  "submit-auth-proposed-manager": { type: "stageAdvancer", boardId: 18410601299, value: "Submit Auth.", andCols: [{ colId: "color_mm2vsh2f", value: "Manager Escalation Required" }, { colId: "long_text_mm2ffsme", containsAny: ["[Proposed Stuck"] }] },
  // Safety net for the chart itself (2026-08-03), unioned with the three bars
  // above — the DVS bars are stage "DVS" and keep coming in through the union.
  // The gap it closes is the one the Propose Stuck bar's stamp requirement
  // opens: the send's manual escalate toggle also writes Manager but stamps
  // nothing (mondayWrite `manualEscalate`), so that patient matched no bar and
  // was already out of the rep's queue for being escalated.
  "submit-auth-manager": { type: "stageAdvancer", boardId: 18410601299, value: "Submit Auth.", andCols: [{ colId: "color_mm2vsh2f", index: [0] }] },
  // DVS retry queue: stage DVS with a "Retry Queued" status on Trigger
  // Supplies DVS or Trigger Pump DVS — and nothing else. (The old Retry
  // Count ≥ 1 condition is gone: a non-zero count lingers after an item
  // leaves the queue.) NB only Supplies DVS currently has a "Retry Queued"
  // label, so the Pump condition is a no-op today but wired for when it does.
  // Both DVS bars are split by escalation LEVEL as of 2026-08-02: manual review
  // now auto-raises Manager Escalation Required (board automation 7918444697),
  // and a manager can promote to Final — so the Manager Intervention bars must
  // EXCLUDE Final or a promoted patient stays in Janelle's chart forever. This
  // reverses the 2026-07-29 "status-only" rule, which was correct only while
  // nothing ever wrote an escalation onto a DVS patient.
  "dvs-retry-queue": { type: "stageAdvancer", boardId: 18410601299, value: "DVS", andCols: [{ colId: "color_mm2vsh2f", value: "Final Escalation Required", not: true }], anyCols: [{ colId: "color_mm26pk1a", value: "Retry Queued" }, { colId: "color_mm578kbd", value: "Retry Queued" }] },
  "dvs-retry-queue-final": { type: "stageAdvancer", boardId: 18410601299, value: "DVS", andCols: [{ colId: "color_mm2vsh2f", value: "Final Escalation Required" }], anyCols: [{ colId: "color_mm26pk1a", value: "Retry Queued" }, { colId: "color_mm578kbd", value: "Retry Queued" }] },
  "dvs-manual-review-final": {
    type: "stageAdvancer", boardId: 18410601299, value: "DVS",
    andCols: [{ colId: "color_mm2vsh2f", value: "Final Escalation Required" }],
    anyCols: [
      { colId: "color_mm26pk1a", value: ["MLTC", "Failed", "Manual Review"] },
      { colId: "color_mm578kbd", value: ["MLTC", "Failed", "Manual Review", "Denied"] },
      { colId: "color_mm284z0b", value: ["Claims Error", "Claims Denied", "Payment Incorrect"] },
      { colId: "color_mm5g8085", value: ["Claims Error", "Claims Denied", "Payment Incorrect"] },
    ],
  },
  // DVS manual review — STATUS-ONLY as of 2026-07-29 (Josh): no automation
  // flips DVS patients to a manager escalation, so the Escalation column is
  // NOT a condition (a label carried in from an earlier stage must not put a
  // patient in this bar, and it made the bar count rows the /dvs rail
  // couldn't list). Stage DVS with a rose Supplies/Pump DVS status (MLTC /
  // Failed / Manual Review, plus Denied on Pump) OR a claims failure (Claims
  // Error / Claims Denied / Payment Incorrect). Mirrors DvsPage
  // isManualReview — keep the two in agreement. Label strings mirror the
  // live board columns.
  "dvs-manual-review": {
    type: "stageAdvancer", boardId: 18410601299, value: "DVS",
    andCols: [{ colId: "color_mm2vsh2f", value: "Final Escalation Required", not: true }],
    anyCols: [
      { colId: "color_mm26pk1a", value: ["MLTC", "Failed", "Manual Review"] },
      { colId: "color_mm578kbd", value: ["MLTC", "Failed", "Manual Review", "Denied"] },
      { colId: "color_mm284z0b", value: ["Claims Error", "Claims Denied", "Payment Incorrect"] },
      { colId: "color_mm5g8085", value: ["Claims Error", "Claims Denied", "Payment Incorrect"] },
    ],
  },
};

/** Evaluate a single column condition against a patient. */
function colConditionPasses(patient: OversightPatient, c: ColCondition): boolean {
  const cell = (patient.cols[c.colId] ?? "").trim();
  if (c.gte !== undefined) {
    // Numeric threshold (e.g. Evaluation Counter ≥ 3). Non-numeric → fails.
    const n = Number(cell);
    const pass = Number.isFinite(n) && cell !== "" && n >= c.gte;
    return c.not ? !pass : pass;
  }
  if (c.index !== undefined) {
    // Match by status index (rename-proof). Unset column → no index → no match.
    const idx = patient.colIndex[c.colId];
    const hit =
      idx !== undefined &&
      (Array.isArray(c.index) ? c.index.includes(idx) : idx === c.index);
    return c.not ? !hit : hit;
  }
  if (c.containsAny !== undefined) {
    const hit = c.containsAny.some((s) => cell.includes(s));
    return c.not ? !hit : hit;
  }
  const inSet = Array.isArray(c.value) ? c.value.includes(cell) : cell === c.value;
  return c.not ? !inSet : inSet;
}

function matchesFilter(patient: OversightPatient, rule: FilterRule): boolean {
  if (rule.type === "group") {
    if (patient.groupId !== rule.groupId) return false;
  } else {
    // Stage advancer filter
    const saCol = STAGE_ADVANCER_COL[rule.boardId];
    if (!saCol) return false;
    const val = (patient.cols[saCol] ?? "").trim();
    if (val !== rule.value) return false;
  }
  // Optional extra AND conditions (escalations, Chase method split, counter
  // ≥ N, the Profile Verified split) — every one must pass.
  for (const c of rule.andCols ?? []) {
    if (!colConditionPasses(patient, c)) return false;
  }
  // Optional OR conditions (the Profile Unverified split) — at least one
  // must pass when any are given.
  if (rule.anyCols?.length && !rule.anyCols.some((c) => colConditionPasses(patient, c))) {
    return false;
  }
  return true;
}

/**
 * Which of a reason-bucketed chart's bars a patient belongs in — bar counts,
 * drill-down bar filtering, and the synthetic `__reasons__` column all key
 * off this one evaluation, so they can never disagree. Returns bucket LABELS
 * in the chart's authored order; empty for a patient matching no bar (they
 * still count in a categorize-mode chart's total, like an unknown day bucket).
 */
export function reasonBucketsFor(chart: ChartDef, patient: OversightPatient): string[] {
  if (!chart.reasonBuckets?.length) return [];
  const out: string[] = [];
  for (const b of chart.reasonBuckets) {
    const rule = CHART_FILTERS[b.filterId];
    if (rule && matchesFilter(patient, rule)) out.push(b.label);
  }
  return out;
}

/**
 * Does a patient belong to a chart at all? Population = the chart's own
 * CHART_FILTERS rule UNION its reason buckets — a patient matching either is
 * in. Exported so tests exercise the exact evaluation the fetch uses.
 *
 * The union (2026-08-03) replaced "the rule wins, buckets subdivide within
 * it". For every chart that had both, the bars were already strict subsets of
 * the rule, so nothing moved. What it buys is a SAFETY NET: a bucket-only
 * chart can now be given a population rule that only ever ADDS the patients
 * its bars miss, without narrowing the bars themselves. Reason bars are built
 * on board FACTS (inactive, a DVS status, a stamped note) while an escalation
 * is a LABEL, so the two can always drift apart — and a chart whose population
 * was the bare union of its bars dropped the patient entirely when they did.
 * See `insuranceCoverage.test.ts` for the invariant this protects.
 */
export function patientMatchesChart(chart: ChartDef, patient: OversightPatient): boolean {
  if (patient.boardId !== chart.boardId) return false;
  const rule = CHART_FILTERS[chart.id];
  if (rule && matchesFilter(patient, rule)) return true;
  if (chart.reasonBuckets?.length) return reasonBucketsFor(chart, patient).length > 0;
  return false;
}

// ── Final Decisions mutations (Manager Views §3) ────────────────────────
// The manager acts from the Oversight drill-down.
//
// APPROVE STUCK writes the MAIN Stage Advancer → "Stuck" (index 15): the live
// automation list (checked 2026-07-21) has NO recipe on Advancer 2C, so the old
// StuckModal's 2C write was a silent no-op — the main stage is what the stage
// pages and the board's Stuck semantics actually key on. The stuck-write lands
// FIRST; only then is the Escalation cleared, so a failed write leaves the
// patient safely in the Final Decisions queue instead of silently returning
// them to the rep.
//
// RETURN TO QUEUE (2026-07 rework) appends the manager's OPTIONAL note to the MN
// workflow notes (stamped), re-dates the Next Action Date to today, and clears
// the Escalation (→ Done) so the patient reappears in the rep's due-now queue.
//
// A "Proposed Stuck" is now the Escalation column at index 2 ("Final Escalation
// Required") — no separate proposal column; the rep's reason lives in the MN
// notes (stamped). Clearing Escalation → Done (index 1) resolves the proposal in
// both actions.

const MASHEKE_BOARD_ID = 18406060017;
const MASHEKE_STAGE_COL = "color_mm1wyr92";
const MASHEKE_STAGE_STUCK_INDEX = 15;
const MASHEKE_ESC_COL = "color_mm1x7997";       // Escalation (index 2 = proposed stuck)
const MASHEKE_ESC_DONE_INDEX = 1;               // "Done" — clears an escalation/proposal
const MASHEKE_NAD_COL = "date_mm1wadgs";        // Next Action Date
const MASHEKE_NOTES_COL = "long_text_mm27zjt2"; // MN workflow notes (carry the stamped reason)

async function writeStatusIndexOnBoard(boardId: number, itemId: string, columnId: string, index: number | null): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: String(boardId),
    itemId,
    columnId,
    value: index === null ? "{}" : JSON.stringify({ index }),
  });
}

/** Write a long-text column on an arbitrary board. */
async function writeLongTextOnBoard(boardId: number, itemId: string, columnId: string, text: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: String(boardId), itemId, columnId, value: JSON.stringify({ text }) });
}

/** Write a date column (YYYY-MM-DD) on an arbitrary board. */
async function writeDateOnBoard(boardId: number, itemId: string, columnId: string, dateStr: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: String(boardId), itemId, columnId, value: JSON.stringify({ date: dateStr }) });
}

/** Read a single column's text for an item. */
async function readItemColumnText(itemId: string, columnId: string): Promise<string> {
  const query = `
    query ($ids: [ID!]!, $cols: [String!]) {
      items(ids: $ids) { column_values(ids: $cols) { id text } }
    }
  `;
  const data = await gql<{ items: { column_values: { id: string; text: string | null }[] }[] }>(
    query, { ids: [itemId], cols: [columnId] },
  );
  return data.items?.[0]?.column_values?.[0]?.text ?? "";
}

/**
 * Approve a stuck proposal: the patient moves to the Stuck stage and the
 * escalation clears. The manager may append an OPTIONAL stamped note first —
 * it records why the patient was let go, and it has to land BEFORE the stage
 * flip, since that flip is what takes them out of the pipeline.
 */
export async function approveProposedStuck(itemId: string, appendNote?: string): Promise<void> {
  const note = appendNote?.trim();
  if (note) {
    const existing = await readItemColumnText(itemId, MASHEKE_NOTES_COL);
    const stamped = stampApprovedStuck(note, etToday(), userInitials());
    await writeLongTextOnBoard(MASHEKE_BOARD_ID, itemId, MASHEKE_NOTES_COL, appendStampedLine(existing, stamped));
  }
  await writeStatusIndexOnBoard(MASHEKE_BOARD_ID, itemId, MASHEKE_STAGE_COL, MASHEKE_STAGE_STUCK_INDEX);
  await writeStatusIndexOnBoard(MASHEKE_BOARD_ID, itemId, MASHEKE_ESC_COL, MASHEKE_ESC_DONE_INDEX);
}

/**
 * Return a proposed-stuck patient to the rep's queue. The manager may append an
 * OPTIONAL note (stamped) to the MN workflow notes; then the Next Action Date is
 * set to today and the Escalation is cleared (→ Done, which also clears the
 * index-2 stuck proposal) so the patient reappears in the due-now queue.
 */
export async function returnProposedToQueue(itemId: string, appendNote?: string): Promise<void> {
  const note = appendNote?.trim();
  if (note) {
    // Read the notes fresh so a concurrent edit isn't clobbered, then append.
    const existing = await readItemColumnText(itemId, MASHEKE_NOTES_COL);
    const stamped = stampReturnedToQueue(note, etToday(), userInitials());
    await writeLongTextOnBoard(MASHEKE_BOARD_ID, itemId, MASHEKE_NOTES_COL, appendStampedLine(existing, stamped));
  }
  await writeDateOnBoard(MASHEKE_BOARD_ID, itemId, MASHEKE_NAD_COL, etToday());
  await writeStatusIndexOnBoard(MASHEKE_BOARD_ID, itemId, MASHEKE_ESC_COL, MASHEKE_ESC_DONE_INDEX);
}

// Insurance Final Decisions (2026-07): the Final-Escalation equivalent of the
// Masheke propose→approve flow. Approve moves the patient to the Insurance
// "Stuck / Don't Proceed" stage and clears the escalation; Return just clears
// the escalation, dropping the patient back into its stage queue.
const INSURANCE_BOARD_ID = 18410601299;
const INSURANCE_STAGE_COL = "color_mm1ws96t";
const INSURANCE_STAGE_STUCK_INDEX = 2; // "Stuck / Don't Proceed"
const INSURANCE_ESC_COL = "color_mm2vsh2f";
/** Reference Notes — where the rep's stamped "[Proposed Stuck …]" reason and
 *  the manager's "[Returned to queue …]" note both live on the Insurance board
 *  (samantha COL.callReferenceNotes). This is the shared notes field the reps
 *  already read and write on every Insurance panel, so a proposal and its
 *  decision sit in the same history the rep works from. */
const INSURANCE_NOTES_COL = "long_text_mm2ffsme";
/** Follow Up Date (samantha COL.followUpDate) — Auth Outstanding buckets purely
 *  on this, so a Return to Queue must re-date or the patient stays snoozed. */
const INSURANCE_FOLLOWUP_DATE_COL = "date_mm34m2dz";

/** Insurance twin of approveProposedStuck — same optional stamped note, same
 *  notes-before-stage ordering, on the Insurance Reference Notes. */
export async function approveInsuranceStuck(itemId: string, appendNote?: string): Promise<void> {
  const note = appendNote?.trim();
  if (note) {
    const existing = await readItemColumnText(itemId, INSURANCE_NOTES_COL);
    const stamped = stampApprovedStuck(note, etToday(), userInitials());
    await writeLongTextOnBoard(INSURANCE_BOARD_ID, itemId, INSURANCE_NOTES_COL, appendStampedLine(existing, stamped));
  }
  await writeStatusIndexOnBoard(INSURANCE_BOARD_ID, itemId, INSURANCE_STAGE_COL, INSURANCE_STAGE_STUCK_INDEX);
  await writeStatusIndexOnBoard(INSURANCE_BOARD_ID, itemId, INSURANCE_ESC_COL, null);
}

/**
 * Return a final-escalated Insurance patient to the rep's queue. The manager may
 * append an OPTIONAL note (stamped) to the Reference Notes; the Follow Up Date is
 * set to today; then the Escalation is cleared so the patient re-enters its
 * stage queue — the Masheke twin's behaviour, on the Insurance columns.
 *
 * The re-date is what actually makes the return land in Auth Outstanding, which
 * is a PURE Follow Up Date bucket (future date = snoozed, blank/past = due):
 * clearing the escalation alone would drop a patient back into the group still
 * snoozed behind whatever date the rep left. Benefits / Submit Auth snooze on
 * the Follow Up STATUS instead, so for those the date write is harmless and
 * keeps "returned" meaning "due now" across all three stages.
 */
export async function returnInsuranceToQueue(itemId: string, appendNote?: string): Promise<void> {
  const note = appendNote?.trim();
  if (note) {
    // Read the notes fresh so a concurrent edit isn't clobbered, then append.
    const existing = await readItemColumnText(itemId, INSURANCE_NOTES_COL);
    const stamped = stampReturnedToQueue(note, etToday(), userInitials());
    await writeLongTextOnBoard(INSURANCE_BOARD_ID, itemId, INSURANCE_NOTES_COL, appendStampedLine(existing, stamped));
  }
  await writeDateOnBoard(INSURANCE_BOARD_ID, itemId, INSURANCE_FOLLOWUP_DATE_COL, etToday());
  await writeStatusIndexOnBoard(INSURANCE_BOARD_ID, itemId, INSURANCE_ESC_COL, null);
}

const INSURANCE_ESC_FINAL_INDEX = 2; // "Final Escalation Required"
const INSURANCE_ESC_MANAGER_INDEX = 0; // "Manager Escalation Required"

/**
 * Hand a patient DOWN one rung — Final Decisions → Manager Intervention
 * (Josh, 2026-08-02). Added for the DVS manual-review loop: the final reviewer
 * fixes the underlying problem on the board (a bad Medicaid ID, a plan that
 * needs a manual claim) and gives the patient back to the manager who watches
 * the DVS queue, rather than clearing the escalation — which would drop them
 * to a rep who has no DVS actions — or approving them Stuck.
 *
 * Note-then-flag ordering, same as every other escalation write here: the
 * status flip is what moves the patient between oversight columns, so the
 * reason must already be in the notes when they arrive. The note is OPTIONAL
 * (the fix itself is usually self-evident on the board) and the flip is
 * idempotent, so a retry after a half-failed write is safe.
 */
export async function returnInsuranceToManager(itemId: string, appendNote?: string): Promise<void> {
  const note = appendNote?.trim();
  if (note) {
    const existing = await readItemColumnText(itemId, INSURANCE_NOTES_COL);
    const stamped = stampReturnedToManager(note, etToday(), userInitials());
    if (!existing.includes(stamped)) {
      await writeLongTextOnBoard(INSURANCE_BOARD_ID, itemId, INSURANCE_NOTES_COL, appendStampedLine(existing, stamped));
    }
  }
  await writeStatusIndexOnBoard(INSURANCE_BOARD_ID, itemId, INSURANCE_ESC_COL, INSURANCE_ESC_MANAGER_INDEX);
}

/**
 * Escalate a Submit Auth stuck proposal from Manager Intervention to Final
 * Decisions (the second step of the 2026-07-29 two-step review). The
 * manager's note is REQUIRED — "why does this need a final decision" is what
 * the Final Decisions reviewer works from — and lands in the Reference Notes
 * (stamped "[Escalated to Final · date · initials] …") BEFORE the status
 * flip, same reason-then-flag ordering as ProposeStuckButton: nobody should
 * ever see a Final-Decisions row whose justification hasn't landed yet.
 * The rep's original "[Proposed Stuck …]" stamp stays in the notes as the
 * Proposed Reason. The Stage Advancer is not touched.
 */
export async function escalateSubmitAuthToFinal(itemId: string, note: string): Promise<void> {
  const trimmed = note.trim();
  if (!trimmed) throw new Error("A note is required to escalate to Final Decisions");
  const existing = await readItemColumnText(itemId, INSURANCE_NOTES_COL);
  const stamped = stampEscalatedToFinal(trimmed, etToday(), userInitials());
  // Idempotent on retry: if the notes write landed but the status flip
  // failed, the manager's retry re-reads notes that already carry this exact
  // stamped line — skip the append instead of duplicating it.
  if (!existing.includes(stamped)) {
    await writeLongTextOnBoard(INSURANCE_BOARD_ID, itemId, INSURANCE_NOTES_COL, appendStampedLine(existing, stamped));
  }
  await writeStatusIndexOnBoard(INSURANCE_BOARD_ID, itemId, INSURANCE_ESC_COL, INSURANCE_ESC_FINAL_INDEX);
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
    result.set(
      chart.id,
      allPatients.filter((p) => patientMatchesChart(chart, p)),
    );
  }

  return result;
}
