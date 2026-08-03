/**
 * baseline-cron — Railway cron service
 *
 * Runs daily at 9 AM ET (weekdays). Queries Monday.com for patient counts,
 * builds baseline.json, and commits it to the command-center-test repo
 * via the GitHub Contents API.
 *
 * COUNTING CONTRACT: counts here must mirror src/hooks/useRoleCounts.ts
 * exactly — the burndown views compare this baseline against that hook's
 * live counts, so any filter drift shows up as phantom "+in/-out" movement
 * all day. scripts/snapshot-baseline.mjs (the build-time generator) carries
 * the same logic; change all three together.
 *
 * Per-role "active" rules (same as useRoleCounts):
 *   benefits/submitAuth/authOutstanding — not escalated AND Follow Up !== "Follow Up"
 *   evaluate/sendRequest/confirmReceipt/chaseFax/chaseParachute —
 *     not escalated AND Next Action Date blank/today/past.
 *     Chase split by Clinicals Method: Parachute OR Email → chaseParachute,
 *     anything else (Fax/blank) → chaseFax (CLAUDE.md §5.9 — Email rides
 *     with Parachute). chaseBenefits kept as the combined legacy total.
 *   welcomeCall — not escalated AND Follow Up !== "Done"
 *   finalConfirm — not escalated
 *   profile / unverifiedReferrals — Follow Up !== "Done", split by referral:
 *     Referral Type "Patient" OR Referral Source "CareCentrix" →
 *     unverifiedReferrals, everything else → profile (Verified Referrals)
 *     (rule mirrors src/lib/profile/referralSplit.ts)
 *   dvs — Stage Advancer "DVS" board-wide; ONLY the date snooze excludes a
 *     patient. Escalated patients are INCLUDED (Josh 2026-07-29): the /dvs
 *     queue classifies purely off the DVS/Claims status columns.
 *   subscription — all items in the group
 *   systemMgmt — escalated patients across all boards
 *
 * ALSO (2026-07-21): after the baseline commit, recalcs the "Days Auth
 * Outstanding" number column (numeric_mm5f5ars) for every item in the
 * Insurance board's Auth Outstanding group — days since the EARLIEST
 * per-product Auth Submission Date. Idempotent (today − date, never an
 * increment), so a missed run self-heals on the next one; only writes when
 * the value changed, so "when column changes" automations fire once per
 * patient per day at most. Math mirrors
 * src/lib/samantha/authOutstandingDays.ts (counting contract — change both).
 *
 * Env vars:
 *   MONDAY_API_TOKEN  — Monday.com API token
 *   GITHUB_PAT        — GitHub personal access token with repo write
 *   GITHUB_REPO       — e.g. "medically-modern/command-center-test"
 *   DRY_RUN           — set to "1" to print the baseline instead of committing
 *                       (also prints the days-recalc instead of writing it)
 *   SKIP_DAYS_RECALC  — set to "1" to skip the Days Auth Outstanding recalc
 */

const MONDAY_TOKEN = process.env.MONDAY_API_TOKEN;
const GITHUB_PAT = process.env.GITHUB_PAT;
const GITHUB_REPO = process.env.GITHUB_REPO || "medically-modern/command-center-test";
const DRY_RUN = process.env.DRY_RUN === "1";

if (!MONDAY_TOKEN) { console.error("MONDAY_API_TOKEN not set"); process.exit(1); }
if (!GITHUB_PAT && !DRY_RUN) { console.error("GITHUB_PAT not set"); process.exit(1); }

const PAGE = 500;

/* ── Board / group / column constants (mirrors useRoleCounts.ts) ── */

const SAM_BOARD   = 18410601299;
const SAM_GROUPS  = {
  benefits:        "group_mm1xr3q3",
  submitAuth:      "group_mm1x1416",
  authOutstanding: "group_mm2v6d1z",
};
const SAM_ESC_COL      = "color_mm2vsh2f"; // Escalation
const SAM_STAGE_COL    = "color_mm1ws96t"; // Stage Advancer ("DVS" exclusion + countDvs)
const SAM_FOLLOWUP_COL = "color_mm34jz1x"; // Follow Up
const SAM_FOLLOWUP_DATE_COL = "date_mm34m2dz"; // Follow Up Date (daily bucket)

// Days Auth Outstanding recalc (Auth Outstanding group only)
const SAM_DAYS_AUTH_OUT_COL = "numeric_mm5f5ars"; // Days Auth Outstanding (number)
const SAM_AUTH_SUB_DATE_COLS = [ // per-product Auth Submission Date (TEXT, ISO)
  "text_mm2wmc1z", // monitor
  "text_mm2w85gd", // sensors
  "text_mm2w72r6", // insulin pump
  "text_mm2wvnpx", // infusion set
  "text_mm2wth7t", // cartridge
];

const MESH_BOARD  = 18406060017;
const MESH_GROUP  = "group_mm1xf2jb";
const MESH_STAGE_COL  = "color_mm1wyr92"; // Stage Advancer
const MESH_NAD_COL    = "date_mm1wadgs";  // Next Action Date
const MESH_ESC_COL    = "color_mm1x7997"; // Escalation
const MESH_METHOD_COL = "color_mm1xw7y5"; // Clinicals Method (chase split)
// "Final Escalation Required" (Escalation index 2) = a rep's stuck PROPOSAL —
// leaves the rep queue for the manager's Final Decisions (excluded below).
const MESH_FINAL_ESC_INDEX = 2;

const WC_BOARD    = 18410804557;
const WC_GROUP    = "group_mm1wvq8p";
const FC_GROUP    = "group_mm2x8jtj";
const WC_ESC_COL      = "color_mm1x7997"; // Escalation
const WC_FOLLOWUP_COL = "color_mm38w2tk"; // Follow Up

const PROF_BOARD  = 18406352652;
const PROF_GROUP  = "group_mm1xf2jb";
const PROF_FOLLOWUP_COL = "color_mm3822qq"; // Follow Up
const PROF_REFERRAL_TYPE_COL = "color_mm1wm4n4";   // Referral Type (role split)
const PROF_REFERRAL_SOURCE_COL = "color_mm1w5wxr"; // Referral Source (role split)
const PROF_IN_SYSTEM_COL = "color_mm2xe7r8";       // Already In System (role split)

const SUB_BOARD   = 18407459988;
const SUB_GROUP   = "topics";

const ESC_REQUIRED = "Escalation Required";
// Insurance board escalation split into two labels (2026-07) — either counts as
// escalated. Masheke + Welcome Call still use the single ESC_REQUIRED above.
const SAM_ESCALATED = new Set(["Manager Escalation Required", "Final Escalation Required"]);
const isSamEscalated = (txt) => SAM_ESCALATED.has(txt);

// Masheke (18406060017) escalation labels were renamed on the board (2026-07):
// index 0 "Manager Escalation Required" (escalated to a manager) / index 2
// "Final Escalation Required" (a rep's stuck PROPOSAL — excluded separately
// below; it leaves the rep queue for the manager's Final Decisions). ONLY
// index 0 counts as escalated. Match by INDEX (not label text) so a future
// rename can't silently break the count. Mirrors src/lib/masheke
// ESCALATED_INDICES + useRoleCounts (§5.8 counting contract — keep in agreement).
const MESH_ESCALATED_INDICES = [0];
function statusIndex(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.index === "number" ? parsed.index : null;
  } catch {
    return null;
  }
}
function isMeshEscalated(item) {
  const idx = statusIndex(item.vals?.[MESH_ESC_COL]);
  return idx !== null && MESH_ESCALATED_INDICES.includes(idx);
}

const ESCALATION_BOARDS = [
  { boardId: 18406060017, colId: "color_mm1x7997", groups: ["group_mm1xf2jb"] },
  { boardId: 18410601299, colId: "color_mm2vsh2f", groups: ["group_mm1xr3q3", "group_mm1x1416", "group_mm2v6d1z", "group_mm316hg2"] },
  { boardId: 18410804557, colId: "color_mm1x7997", groups: ["group_mm1wvq8p", "group_mm2x8jtj"] },
];

/* ── Monday GraphQL helper ────────────────────────────────── */

async function gql(query, variables = {}) {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: MONDAY_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Monday API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

/* ── Item fetcher (cursor pagination, selected columns) ───── */

/** All items in a board group as { id, cols: { colId: text } }. */
async function fetchGroupItems(boardId, groupId, columnIds) {
  const compareValue = JSON.stringify([groupId]);
  const itemFields = columnIds.length
    ? "id column_values(ids: $cols) { id text value }"
    : "id";
  const query = `
    query ($bid: ID!${columnIds.length ? ", $cols: [String!]" : ""}) {
      boards(ids: [$bid]) {
        items_page(limit: ${PAGE}, query_params: {
          rules: [{ column_id: "group", compare_value: ${compareValue} }]
        }) { cursor items { ${itemFields} } }
      }
    }`;
  const toLight = (items) =>
    items.map((i) => ({
      id: String(i.id),
      cols: Object.fromEntries((i.column_values ?? []).map((c) => [c.id, c.text ?? ""])),
      vals: Object.fromEntries((i.column_values ?? []).map((c) => [c.id, c.value ?? ""])),
    }));

  const vars = columnIds.length ? { bid: boardId, cols: columnIds } : { bid: boardId };
  const data = await gql(query, vars);
  const page = data?.boards?.[0]?.items_page;
  const out = toLight(page?.items ?? []);
  let cursor = page?.cursor ?? null;

  while (cursor) {
    const nextQuery = `
      query ($cursor: String!${columnIds.length ? ", $cols: [String!]" : ""}) {
        next_items_page(limit: ${PAGE}, cursor: $cursor) { cursor items { ${itemFields} } }
      }`;
    const nextVars = columnIds.length ? { cursor, cols: columnIds } : { cursor };
    const next = await gql(nextQuery, nextVars);
    out.push(...toLight(next?.next_items_page?.items ?? []));
    cursor = next?.next_items_page?.cursor ?? null;
  }
  return out;
}

/* ── Role counters (each returns { count, ids }) ──────────── */

/** Samantha group: active = not escalated AND not snoozed.
 *  Daily bucket (2026-07-20), Benefits + Submit Auth: a Follow Up only
 *  hides the patient while its date is in the FUTURE — when the date
 *  arrives (<= today ET) the patient counts active again; dateless
 *  follow-ups stay snoozed.
 *  Auth Outstanding (redesign SS12, 2026-07-21): PURE date bucket — snoozed
 *  iff Follow Up Date is in the future; the STATUS column is ignored and a
 *  blank date counts as due. Mirrors useRoleCounts.ts samActive +
 *  sidebarList (isSnoozedFollowUp / isSnoozedAuthOutstanding) (SS5.8
 *  counting contract — change all of them together). */
async function countSamGroup(groupId, todayStr, dateOnlyBucket = false) {
  const fetched = await fetchGroupItems(SAM_BOARD, groupId, [SAM_ESC_COL, SAM_FOLLOWUP_COL, SAM_FOLLOWUP_DATE_COL, SAM_STAGE_COL]);
  // Stage = "DVS" items stay in their old group (no group-move automation
  // yet) but belong to countDvs — drop them so a routed patient never
  // counts in two roles (mirrors useRoleCounts samActive, SS5.8).
  const items = fetched.filter((i) => i.cols[SAM_STAGE_COL] !== "DVS");
  const snoozed = (i) => {
    const d = i.cols[SAM_FOLLOWUP_DATE_COL];
    if (dateOnlyBucket) return !!d && d > todayStr;
    if (i.cols[SAM_FOLLOWUP_COL] !== "Follow Up") return false;
    return !d || d > todayStr;
  };
  const active = items.filter((i) => !isSamEscalated(i.cols[SAM_ESC_COL]) && !snoozed(i));
  return { count: active.length, ids: active.map((i) => i.id) };
}

/** Masheke stages: split by Stage Advancer + Clinicals Method, filter esc + future NAD. */
async function countMashekeStages(todayStr) {
  const items = await fetchGroupItems(MESH_BOARD, MESH_GROUP, [
    MESH_STAGE_COL, MESH_NAD_COL, MESH_ESC_COL, MESH_METHOD_COL,
  ]);

  const counts = { evaluate: 0, sendRequest: 0, confirmReceipt: 0, chaseFax: 0, chaseParachute: 0, chaseBenefits: 0, doctorAppointments: 0 };
  const ids = { evaluate: [], sendRequest: [], confirmReceipt: [], chaseFax: [], chaseParachute: [], chaseBenefits: [], doctorAppointments: [] };

  for (const item of items) {
    // Proposed Stuck patients left the rep queues (manager Final Decision
    // pending). That's now Escalation index 2 ("Final Escalation Required"),
    // not a separate column — mirrors useRoleCounts + masheke useMondayPatients
    // (SS5.8 counting contract).
    if (statusIndex(item.vals?.[MESH_ESC_COL]) === MESH_FINAL_ESC_INDEX) continue;
    const stage = item.cols[MESH_STAGE_COL] ?? "";
    let roleId = null;
    if (stage === "Evaluate MN") roleId = "evaluate";
    else if (stage === "Send Request") roleId = "sendRequest";
    else if (stage === "Confirm Receipt") roleId = "confirmReceipt";
    else if (stage === "Chase Clinicals") {
      const cm = item.cols[MESH_METHOD_COL] ?? "";
      roleId = cm === "Parachute" || cm === "Email" ? "chaseParachute" : "chaseFax";
    }
    // Doctor Appointments (2026-08-03) — patient outreach when the provider
    // requires a new visit. Must mirror useRoleCounts + the other baseline
    // generator exactly (SS5.8 counting contract) or the Operations tab shows
    // phantom +in/-out chips all day.
    else if (stage === "Doctor Appointment") roleId = "doctorAppointments";
    if (!roleId) continue;

    if (isMeshEscalated(item)) continue; // escalated (index 0)
    const nad = (item.cols[MESH_NAD_COL] ?? "").slice(0, 10);
    if (nad && nad > todayStr) continue; // scheduled (future)

    counts[roleId]++;
    ids[roleId].push(item.id);
    if (roleId === "chaseFax" || roleId === "chaseParachute") {
      counts.chaseBenefits++;
      ids.chaseBenefits.push(item.id);
    }
  }
  return { counts, ids };
}

/** Welcome Call group: active = not escalated AND Follow Up !== "Done". */
async function countWelcomeCall() {
  const items = await fetchGroupItems(WC_BOARD, WC_GROUP, [WC_ESC_COL, WC_FOLLOWUP_COL]);
  const active = items.filter(
    (i) => i.cols[WC_ESC_COL] !== ESC_REQUIRED && i.cols[WC_FOLLOWUP_COL] !== "Done",
  );
  return { count: active.length, ids: active.map((i) => i.id) };
}

/** Final Confirm group: active = not escalated. */
async function countFinalConfirm() {
  const items = await fetchGroupItems(WC_BOARD, FC_GROUP, [WC_ESC_COL]);
  const active = items.filter((i) => i.cols[WC_ESC_COL] !== ESC_REQUIRED);
  return { count: active.length, ids: active.map((i) => i.id) };
}

/** Profile group: active = Follow Up !== "Done", split THREE ways —
 *  inSystemReferrals (Already In System = "Yes", checked first), then
 *  unverifiedReferrals (Referral Type "Patient" OR Referral Source
 *  "CareCentrix"), then profile (Verified Referrals). Mirrors
 *  src/lib/profile/referralSplit.ts — only the TYPE column routes "Patient";
 *  the SOURCE column has its own "Patient" label that must NOT match. */
async function countProfile() {
  const items = await fetchGroupItems(PROF_BOARD, PROF_GROUP, [
    PROF_FOLLOWUP_COL, PROF_REFERRAL_TYPE_COL, PROF_REFERRAL_SOURCE_COL, PROF_IN_SYSTEM_COL,
  ]);
  const active = items.filter((i) => i.cols[PROF_FOLLOWUP_COL] !== "Done");
  const isInSystem = (i) => (i.cols[PROF_IN_SYSTEM_COL] ?? "").trim().toLowerCase() === "yes";
  const isUnverified = (i) =>
    !isInSystem(i) &&
    ((i.cols[PROF_REFERRAL_TYPE_COL] ?? "").trim().toLowerCase() === "patient" ||
      (i.cols[PROF_REFERRAL_SOURCE_COL] ?? "").trim().toLowerCase() === "carecentrix");
  const inSystem = active.filter(isInSystem);
  const unverified = active.filter(isUnverified);
  const verified = active.filter((i) => !isInSystem(i) && !isUnverified(i));
  return {
    counts: {
      profile: verified.length,
      unverifiedReferrals: unverified.length,
      inSystemReferrals: inSystem.length,
    },
    ids: {
      profile: verified.map((i) => i.id),
      unverifiedReferrals: unverified.map((i) => i.id),
      inSystemReferrals: inSystem.map((i) => i.id),
    },
  };
}

/** Subscription group: all items. */
async function countSubscription() {
  const items = await fetchGroupItems(SUB_BOARD, SUB_GROUP, []);
  return { count: items.length, ids: items.map((i) => i.id) };
}

/** Escalated patients across all boards (systemMgmt count). */
async function countEscalations() {
  let total = 0;
  for (const { boardId, colId, groups } of ESCALATION_BOARDS) {
    for (const groupId of groups) {
      const items = await fetchGroupItems(boardId, groupId, [colId]);
      for (const item of items) {
        if (boardId === MESH_BOARD) {
          // Masheke labels renamed — match by index (0/2). See isMeshEscalated.
          if (isMeshEscalated(item)) total++;
        } else {
          // Insurance/Welcome Call: text match (+ isSamEscalated for the
          // Insurance Manager/Final split).
          const txt = item.cols[colId] ?? "";
          if (txt === "Escalation Required" || txt === "Escalate" || isSamEscalated(txt)) total++;
        }
      }
    }
  }
  return total;
}

/* ── Days Auth Outstanding recalc ─────────────────────────── */

/** Normalize an Auth Submission Date to YYYY-MM-DD (ISO passthrough or
 *  MM/DD/YYYY). Mirrors src/lib/samantha/authOutstandingDays.ts. */
function normalizeYmd(raw) {
  const s = (raw ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return "";
}

/** Whole days from `fromYmd` to `toYmd` (UTC math). Null on bad input. */
function daysBetweenYmd(fromYmd, toYmd) {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromYmd);
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toYmd);
  if (!a || !b) return null;
  const from = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const to = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.round((to - from) / 86_400_000);
}

async function writeNumberColumn(itemId, columnId, value) {
  await gql(
    `mutation ($bid: ID!, $iid: ID!, $cid: String!, $val: String!) {
       change_simple_column_value(board_id: $bid, item_id: $iid, column_id: $cid, value: $val) { id }
     }`,
    { bid: SAM_BOARD, iid: itemId, cid: columnId, val: value },
  );
}

/** Recompute "Days Auth Outstanding" for every item in the Auth Outstanding
 *  group: today (ET) minus the EARLIEST per-product Auth Submission Date.
 *  Idempotent — never increments, so missed runs self-heal. Writes only when
 *  the stored value differs (keeps "when column changes" automations to one
 *  fire per patient per day); clears a stale value when no dates exist. */
async function recalcDaysAuthOutstanding(todayStr) {
  const items = await fetchGroupItems(SAM_BOARD, SAM_GROUPS.authOutstanding, [
    ...SAM_AUTH_SUB_DATE_COLS,
    SAM_DAYS_AUTH_OUT_COL,
  ]);

  let written = 0, cleared = 0, unchanged = 0, noDates = 0, failed = 0;
  for (const item of items) {
    const earliest = SAM_AUTH_SUB_DATE_COLS
      .map((c) => normalizeYmd(item.cols[c]))
      .filter(Boolean)
      .sort()[0] ?? "";
    const current = (item.cols[SAM_DAYS_AUTH_OUT_COL] ?? "").trim();

    let next = ""; // blank = no submission dates recorded
    if (earliest) {
      const d = daysBetweenYmd(earliest, todayStr);
      if (d !== null) next = String(Math.max(0, d));
    }
    if (!next) noDates++;

    if (current === next || (current === "" && next === "")) { unchanged++; continue; }
    if (DRY_RUN) {
      console.log(`DRY_RUN: item ${item.id} Days Auth Outstanding "${current}" → "${next}"`);
      continue;
    }
    try {
      await writeNumberColumn(item.id, SAM_DAYS_AUTH_OUT_COL, next);
      next === "" ? cleared++ : written++;
    } catch (err) {
      failed++;
      console.error(`Days recalc failed for item ${item.id}:`, err.message ?? err);
    }
  }
  console.log(
    `Days Auth Outstanding recalc: ${items.length} items — ${written} written, ${unchanged} unchanged, ${cleared} cleared, ${noDates} without submission dates, ${failed} failed`,
  );
  if (failed > 0) throw new Error(`${failed} Days Auth Outstanding write(s) failed`);
}


/** Board-wide light fetch by Stage Advancer INDEX — the DVS stage has no
 *  dedicated group. Mirrors useRoleCounts.fetchBoardStageItemsLight
 *  (SS5.8 counting contract — change together). */
async function fetchStageItems(boardId, stageColId, stageIndex, columnIds) {
  const query = `
    query ($bid: ID!, $cols: [String!]) {
      boards(ids: [$bid]) {
        items_page(limit: ${PAGE}, query_params: {
          rules: [{ column_id: ${JSON.stringify(stageColId)}, compare_value: [${stageIndex}] }]
        }) { cursor items { id column_values(ids: $cols) { id text } } }
      }
    }`;
  const toLight = (items) =>
    items.map((i) => ({
      id: String(i.id),
      cols: Object.fromEntries((i.column_values ?? []).map((c) => [c.id, c.text ?? ""])),
    }));
  const data = await gql(query, { bid: boardId, cols: columnIds });
  const page = data?.boards?.[0]?.items_page;
  const out = toLight(page?.items ?? []);
  let cursor = page?.cursor ?? null;
  while (cursor) {
    const nextQuery = `
      query ($cursor: String!, $cols: [String!]) {
        next_items_page(limit: ${PAGE}, cursor: $cursor) { cursor items { id column_values(ids: $cols) { id text } } }
      }`;
    const next = await gql(nextQuery, { cursor, cols: columnIds });
    out.push(...toLight(next?.next_items_page?.items ?? []));
    cursor = next?.next_items_page?.cursor ?? null;
  }
  return out;
}

/** DVS role: Stage Advancer = "DVS" (index 1, verified 2026-07-21) board-wide,
 *  not escalated, not date-snoozed (future Follow Up Date hides the patient —
 *  same date-only rule as Auth Outstanding; blank date = due). Mirrors
 *  useRoleCounts + DvsPage (SS5.8 counting contract). */
async function countDvs(todayStr) {
  const items = await fetchStageItems(SAM_BOARD, SAM_STAGE_COL, 1, [SAM_ESC_COL, SAM_FOLLOWUP_DATE_COL]);
  const snoozed = (i) => {
    const d = i.cols[SAM_FOLLOWUP_DATE_COL];
    return !!d && d > todayStr;
  };
  // Escalated DVS patients are INCLUDED (Josh 2026-07-29): the /dvs queue
  // keys purely off the DVS/Claims statuses, so only the date snooze hides
  // a patient. Mirrors useDvsPatients + useRoleCounts (SS5.8 contract).
  const active = items.filter((i) => !snoozed(i));
  return { count: active.length, ids: active.map((i) => i.id) };
}

/* ── GitHub commit helper ─────────────────────────────────── */

async function commitBaseline(baseline) {
  const filePath = "public/data/baseline.json";
  const content = Buffer.from(JSON.stringify(baseline, null, 2) + "\n").toString("base64");
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
  const headers = {
    Authorization: `Bearer ${GITHUB_PAT}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  // Get current file SHA (needed for update)
  let sha = null;
  const existing = await fetch(url, { headers });
  if (existing.ok) {
    const json = await existing.json();
    sha = json.sha;

    // Check if today's baseline already exists
    try {
      const existingContent = Buffer.from(json.content, "base64").toString("utf8");
      const existingData = JSON.parse(existingContent);
      if (existingData.dateKey === baseline.dateKey) {
        console.log(`Baseline for ${baseline.dateKey} already exists — skipping`);
        return false;
      }
    } catch { /* corrupted, overwrite */ }
  }

  const body = {
    message: `chore: daily baseline snapshot ${baseline.dateKey}`,
    content,
    ...(sha ? { sha } : {}),
  };

  const res = await fetch(url, { method: "PUT", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  console.log(`Committed baseline for ${baseline.dateKey}`);
  return true;
}

/* ── Main ─────────────────────────────────────────────────── */

async function main() {
  console.log("=== Baseline Cron Start ===");
  console.log(`Time: ${new Date().toISOString()}`);

  const now = new Date();
  const easternDate = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  const [
    benefitsResult, submitAuthResult, authOutstandingResult,
    mashekeResult,
    dvsResult,
    welcomeCallResult, finalConfirmResult,
    profileResult, subscriptionResult,
    systemMgmtCount,
  ] = await Promise.all([
    countSamGroup(SAM_GROUPS.benefits, easternDate),
    countSamGroup(SAM_GROUPS.submitAuth, easternDate),
    countSamGroup(SAM_GROUPS.authOutstanding, easternDate, true),
    countMashekeStages(easternDate),
    countDvs(easternDate),
    countWelcomeCall(),
    countFinalConfirm(),
    countProfile(),
    countSubscription(),
    countEscalations(),
  ]);

  const counts = {
    benefits: benefitsResult.count,
    submitAuth: submitAuthResult.count,
    authOutstanding: authOutstandingResult.count,
    ...mashekeResult.counts,
    dvs: dvsResult.count,
    welcomeCall: welcomeCallResult.count,
    finalConfirm: finalConfirmResult.count,
    ...profileResult.counts,
    subscription: subscriptionResult.count,
    systemMgmt: systemMgmtCount,
  };

  const patientIds = {
    benefits: benefitsResult.ids,
    submitAuth: submitAuthResult.ids,
    authOutstanding: authOutstandingResult.ids,
    ...mashekeResult.ids,
    dvs: dvsResult.ids,
    welcomeCall: welcomeCallResult.ids,
    finalConfirm: finalConfirmResult.ids,
    ...profileResult.ids,
    subscription: subscriptionResult.ids,
  };

  const baseline = {
    dateKey: easternDate,
    counts,
    patientIds,
    takenAt: now.toISOString(),
    source: "github-actions", // keep same source tag so the SPA doesn't need changes
  };

  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  console.log(`Date: ${easternDate} | Total patients: ${total}`);
  console.log(JSON.stringify(counts, null, 2));

  if (DRY_RUN) {
    console.log("DRY_RUN=1 — skipping GitHub commit");
  } else {
    await commitBaseline(baseline);
  }

  // Days Auth Outstanding — runs AFTER the baseline commit so a recalc
  // failure never costs the day's baseline. Shared Monday boards ⇒ this one
  // run covers both the test and prod SPAs.
  if (process.env.SKIP_DAYS_RECALC === "1") {
    console.log("SKIP_DAYS_RECALC=1 — skipping Days Auth Outstanding recalc");
  } else {
    try {
      await recalcDaysAuthOutstanding(easternDate);
    } catch (err) {
      console.error("Days Auth Outstanding recalc failed:", err);
      process.exitCode = 1; // surface in Railway without re-running the baseline
    }
  }
  console.log("=== Baseline Cron Done ===");
}

main().catch(err => {
  console.error("Baseline cron failed:", err);
  process.exit(1);
});
