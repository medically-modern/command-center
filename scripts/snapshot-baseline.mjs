/**
 * snapshot-baseline.mjs
 *
 * Fetches patient counts from all Monday.com boards and writes
 * public/data/baseline.json. Runs at build time in deploy.yml (scheduled
 * weekday mornings) so the SPA has a start-of-day snapshot even before the
 * 9 AM Railway baseline-cron commit lands.
 *
 * COUNTING CONTRACT: counts here must mirror src/hooks/useRoleCounts.ts
 * exactly — the burndown views compare this baseline against that hook's
 * live counts, so any filter drift shows up as phantom "+in/-out" movement
 * all day. services/baseline-cron/index.mjs (the Railway 9 AM generator)
 * carries the same logic; change all three together.
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
 * Env: MONDAY_API_TOKEN (dummy ok — the gateway injects the real token),
 *      MONDAY_GATEWAY_URL (optional override)
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";

// This build step reaches Monday through the Railway monday-gateway, which
// injects the real MONDAY_API_TOKEN server-side (same path the SPA uses). CI
// therefore needs no real token: VITE_MONDAY_API_TOKEN can be a dummy
// placeholder and this snapshot still works. Override with MONDAY_GATEWAY_URL.
const GATEWAY = (process.env.MONDAY_GATEWAY_URL || "https://monday-gateway-production.up.railway.app").replace(/\/+$/, "");
const MONDAY_ENDPOINT = `${GATEWAY}/gql`;
// The gateway ignores this and injects its own token; any non-empty value is fine.
const TOKEN = process.env.MONDAY_API_TOKEN || "gateway-handles-auth";

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

const MESH_BOARD  = 18406060017;
const MESH_GROUP  = "group_mm1xf2jb";     // 2. Medical Necessity
const MESH_STAGE_COL  = "color_mm1wyr92"; // Stage Advancer
const MESH_NAD_COL    = "date_mm1wadgs";  // Next Action Date
const MESH_ESC_COL    = "color_mm1x7997"; // Escalation
const MESH_METHOD_COL = "color_mm1xw7y5"; // Clinicals Method (chase split)
// "Final Escalation Required" (Escalation index 2) = a rep's stuck PROPOSAL —
// leaves the rep queue for the manager's Final Decisions (excluded below).
const MESH_FINAL_ESC_INDEX = 2;

const WC_BOARD    = 18410804557;
const WC_GROUP    = "group_mm1wvq8p";
const FC_GROUP    = "group_mm2x8jtj";     // Final Profile Confirmation
const WC_ESC_COL      = "color_mm1x7997"; // Escalation
const WC_FOLLOWUP_COL = "color_mm38w2tk"; // Follow Up

const PROF_BOARD  = 18406352652;
const PROF_GROUP  = "group_mm1xf2jb";
// The DTC intake form's own groups on the same board. §5.8 counting contract:
// these must match useRoleCounts.ts PROFILE_FORM_GROUP_IDS exactly.
const PROF_FORM_GROUPS = ["group_mm5zgeak", "group_mm5z87zt"];
/** Profile Clean-Up — the second half of the Patient Intake split (§5.20).
 *  Mirrors useRoleCounts' PROFILE_CLEANUP_GROUP_ID and
 *  lib/profile/intakeSubStage.ts. */
const PROF_CLEANUP_GROUP = "group_mm6c3rhb";
/** The groups a booked intake call can be sitting in. The two DTC form groups
 *  PLUS Profile Clean-Up (§5.20) — an advance moves the item to a new group,
 *  and a booked call must not vanish from this queue because the rep advanced
 *  the patient before the call happened. That is possible: the unlock gate
 *  accepts "Send request now" without an intake call, so a patient can hold a
 *  Calendly booking and still be advanced. Dropping them here would leave a
 *  real appointment nobody is reminded about (§5.15). */
const PROF_SCHED_GROUPS = [...PROF_FORM_GROUPS, PROF_CLEANUP_GROUP];
// "Already In System" — its own group, alongside the status column. Must match
// useRoleCounts.ts PROFILE_IN_SYSTEM_GROUP_ID and oversightApi's
// PROFILE_IN_SYSTEM_GROUP (§5.8 counting contract).
const PROF_IN_SYSTEM_GROUP = "group_mm64b83h";
const PROF_INTAKE_ESC_COL = "color_mm5zww42";
const PROF_ESCALATED_LABELS = ["Manager Escalation Required", "Final Escalation Required"];
const PROF_FOLLOWUP_COL = "color_mm3822qq"; // Follow Up
const PROF_REFERRAL_TYPE_COL = "color_mm1wm4n4";   // Referral Type (role split)
const PROF_REFERRAL_SOURCE_COL = "color_mm1w5wxr"; // Referral Source (role split)
const PROF_IN_SYSTEM_COL = "color_mm2xe7r8";       // Already In System (role split)

const SUB_BOARD   = 18407459988;
const SUB_GROUP   = "topics";

/* ── Patient Questions (inbox over TWO boards) ─────────────
 * Mirrors lib/patientQuestions/mondayApi.ts `fetchPatientQuestions` +
 * lib/patientQuestions/handled.ts `isQuestionOpen`. A question is OPEN while
 * its message is newer than the board's "Question Handled At" stamp, so a
 * patient writing again after completion reopens it with no status column
 * involved. Counted here so the Operations tab has a 9 AM figure to burn down
 * against — without one the bar reads "not connected" all day.
 * SS5.8 counting contract: this block is duplicated in the OTHER baseline
 * generator and must match it and useRoleCounts exactly. */
const PQ_CLAIMS_BOARD = 18413019028;          // Secondary Claims
const PQ_SUB_MSG_COL = "long_text_mm3xnb6k";  // Patient Help Message
const PQ_SUB_TS_COL = "text_mm3kt9bs";        // order-response timestamp (fallback)
const PQ_SUB_HANDLED_COL = "date_mm57yzmb";
const PQ_CLAIMS_MSG_COL = "long_text_mm3yqgyt";
const PQ_CLAIMS_HANDLED_COL = "date_mm57skrd";


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

/* Boards with escalation columns — used for systemMgmt count */
const ESCALATION_BOARDS = [
  { boardId: 18406060017, colId: "color_mm1x7997", groups: ["group_mm1xf2jb"] },                    // Medical Evaluation
  { boardId: 18410601299, colId: "color_mm2vsh2f", groups: ["group_mm1xr3q3", "group_mm1x1416", "group_mm2v6d1z", "group_mm316hg2"] }, // Insurance
  { boardId: 18410804557, colId: "color_mm1x7997", groups: ["group_mm1wvq8p", "group_mm2x8jtj"] },  // Welcome Call
];

/* ── Monday GraphQL helper ────────────────────────────────── */

async function gql(query, variables = {}) {
  const res = await fetch(MONDAY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: TOKEN,
    },
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

    // Escalated (index 0) patients are dropped from the baseline for EVERY
    // masheke role, Doctor Appointments included. That is not an omission:
    // OperationsTab compares this snapshot against useRoleCounts' `counts`
    // store, which applies the identical `continue` — the hook's separate
    // `escalatedCounts` store is never read there. Counting escalated patients
    // here would put them on one side of the comparison only and manufacture a
    // permanent phantom "-out" for each one (§5.8 counting contract).
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
// --- Scheduled Calls ------------------------------------------------------
// Booked intake calls still AHEAD of you today. The only role counted by the
// CLOCK rather than a follow-up rule, so it falls by one as each start time
// passes. Mirrors src/lib/scheduledCalls/workflow.js `remainingToday` and the
// useRoleCounts branch — change all three together (CLAUDE.md §5.8).
//
// At the 9 AM run nothing has passed yet, so the baseline captures the day's
// full total and the live count burns down from it. That is the intended
// shape, not an accident of when the cron happens to fire.
const SCHED_CALL_TIME_COL = "date_mm63na19";
const SCHED_BOOKING_STATUS_COL = "color_mm5zrbn3";

function etNowMinutes(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const h = get("hour");
  return (h === 24 ? 0 : h) * 60 + get("minute");
}

async function countScheduledCalls() {
  const items = [];
  for (const gid of PROF_SCHED_GROUPS) {
    try {
      items.push(...await fetchGroupItems(PROF_BOARD, gid, [SCHED_CALL_TIME_COL, SCHED_BOOKING_STATUS_COL]));
    } catch (e) {
      console.error(`[countScheduledCalls] form group ${gid} failed:`, e.message);
    }
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const nowMin = etNowMinutes();

  const due = items.filter((i) => {
    const raw = (i.cols[SCHED_CALL_TIME_COL] ?? "").trim();
    if (!raw) return false;
    // A canceled booking keeps its row. Counting it puts a call in the
    // burndown that nobody is going to make.
    if ((i.cols[SCHED_BOOKING_STATUS_COL] ?? "").trim().toLowerCase() === "canceled") return false;
    const [date, time = ""] = raw.split(/\s+/);
    if (date !== today) return false;
    const m = /^(\d{1,2}):(\d{2})/.exec(time);
    // Booked today with no time on file cannot be sequenced, so it can never
    // be "passed" — it stays work.
    if (!m) return true;
    return Number(m[1]) * 60 + Number(m[2]) >= nowMin;
  });

  return { counts: { scheduledCalls: due.length } };
}

async function countProfile() {
  const items = await fetchGroupItems(PROF_BOARD, PROF_GROUP, [
    PROF_FOLLOWUP_COL, PROF_REFERRAL_TYPE_COL, PROF_REFERRAL_SOURCE_COL, PROF_IN_SYSTEM_COL,
    PROF_INTAKE_ESC_COL,
  ]);
  const active = items.filter((i) => i.cols[PROF_FOLLOWUP_COL] !== "Done");
  const isInSystem = (i) => (i.cols[PROF_IN_SYSTEM_COL] ?? "").trim().toLowerCase() === "yes";
  const isUnverified = (i) =>
    !isInSystem(i) &&
    ((i.cols[PROF_REFERRAL_TYPE_COL] ?? "").trim().toLowerCase() === "patient" ||
      (i.cols[PROF_REFERRAL_SOURCE_COL] ?? "").trim().toLowerCase() === "carecentrix");
  // Escalated patients leave the rep queue AND the role count — they are the
  // manager's, and Oversight's Manager Intervention / Final Decisions charts
  // are where they show up. Mirrors useRoleCounts.
  const isIntakeEscalated = (i) =>
    PROF_ESCALATED_LABELS.includes((i.cols[PROF_INTAKE_ESC_COL] ?? "").trim());
  // Already In System is a GROUP as well as a status (Brandon, 2026-08-12).
  // Items moved there were counted by nothing — this generator, useRoleCounts
  // and Oversight all read 1. Intake only. Group membership IS the marker: an
  // item can land there with the status column still blank.
  let inSystemGroupItems = [];
  try {
    inSystemGroupItems = await fetchGroupItems(PROF_BOARD, PROF_IN_SYSTEM_GROUP, [PROF_FOLLOWUP_COL]);
  } catch (e) {
    console.error(`[countProfile] in-system group failed:`, e.message);
  }
  const inSystem = [
    ...active.filter(isInSystem),
    ...inSystemGroupItems.filter((i) => i.cols[PROF_FOLLOWUP_COL] !== "Done"),
  ];
  // 1. Intake is ALL Verified Referrals now (Josh, 2026-08-10) — Patient
  // Intake is the DTC form's two groups and nothing else. Mirrors
  // useRoleCounts and oversightApi's CHART_FILTERS; change all three together.
  void isUnverified;
  const verified = active.filter((i) => !isInSystem(i));

  // The DTC form's own two groups. Every item there came from the form, so no
  // referral split applies — they are Patient Intake by definition. Missing
  // these was why the Operations tab showed phantom "+N in" chips for this
  // role all day: the live hook counted them and the baseline did not.
  //
  // ⚠️ Follow Up is NOT a filter here (Josh, 2026-08-13). Patient Intake has no
  // snooze — a call attempt bumps the Attempt Counter and the patient stays in
  // the queue — so consulting that column removed anyone a rep had failed to
  // reach, permanently, with nothing to bring them back. Escalation still
  // counts them out; Oversight's intake manager charts hold those.
  const formItems = [];
  for (const gid of PROF_FORM_GROUPS) {
    try {
      formItems.push(...await fetchGroupItems(PROF_BOARD, gid, [PROF_INTAKE_ESC_COL]));
    } catch (e) {
      console.error(`[countProfile] form group ${gid} failed:`, e.message);
    }
  }
  const formActive = formItems.filter((i) => !isIntakeEscalated(i));

  // Profile Clean-Up (§5.20) — same stage one sub-stage on, so the same rule:
  // escalated patients are the manager's, and Follow Up is ignored because
  // this stage has no snooze. Mirrors useRoleCounts' `cleanUpActive`.
  let cleanUpItems = [];
  try {
    cleanUpItems = await fetchGroupItems(PROF_BOARD, PROF_CLEANUP_GROUP, [PROF_INTAKE_ESC_COL]);
  } catch (e) {
    console.error(`[countProfile] clean-up group failed:`, e.message);
  }
  const cleanUpActive = cleanUpItems.filter((i) => !isIntakeEscalated(i));

  return {
    counts: {
      profile: verified.length,
      unverifiedReferrals: formActive.length,
      inSystemReferrals: inSystem.length,
      intakeCleanup: cleanUpActive.length,
    },
    ids: {
      profile: verified.map((i) => i.id),
      unverifiedReferrals: formActive.map((i) => i.id),
      inSystemReferrals: inSystem.map((i) => i.id),
      intakeCleanup: cleanUpActive.map((i) => i.id),
    },
  };
}

/** Subscription group: all items. */
async function countSubscription() {
  const items = await fetchGroupItems(SUB_BOARD, SUB_GROUP, []);
  return { count: items.length, ids: items.map((i) => i.id) };
}

/* ── Patient Questions ─────────────────────────────────────
 * Ported from lib/patientQuestions/*.ts — see the constants block above for
 * the SS5.8 keep-in-agreement rule. */

/** long_text column -> { text, updatedAt } (updatedAt is Monday's changed_at). */
function pqLongTextParts(item, id) {
  const text = item.cols?.[id] ?? "";
  const raw = item.vals?.[id];
  if (!raw) return { text, updatedAt: "" };
  try {
    const p = JSON.parse(raw);
    return { text: p.text ?? text, updatedAt: p.changed_at ?? p.updated_at ?? "" };
  } catch {
    return { text, updatedAt: "" };
  }
}

/** Monday date-column value JSON ({"date","time"}, time is UTC) -> ISO. */
function pqDateValueToIso(value) {
  if (!value) return "";
  try {
    const p = JSON.parse(value);
    if (!p?.date) return "";
    return `${p.date}T${p.time || "00:00:00"}Z`;
  } catch {
    return "";
  }
}

/** Newest parseable timestamp among the candidates ("" if none). */
function pqNewestTimestamp(...candidates) {
  let best = "";
  let bestMs = -Infinity;
  for (const c of candidates) {
    const ms = Date.parse(c);
    if (!isNaN(ms) && ms > bestMs) { bestMs = ms; best = c; }
  }
  return best;
}

/** Open iff the message is newer than the handled stamp. Never hide a question
 *  over an unreadable mark; with no reliable message time, trust the mark. */
function pqIsOpen(messageUpdatedAt, handledAt) {
  if (!handledAt) return true;
  const handled = Date.parse(handledAt);
  if (isNaN(handled)) return true;
  const message = Date.parse(messageUpdatedAt);
  if (isNaN(message)) return false;
  return message > handled;
}

/** Every item on a board (no group filter), cursor-paginated. */
async function fetchAllBoardItems(boardId, columnIds) {
  const query = `
    query ($bid: ID!, $cols: [String!]) {
      boards(ids: [$bid]) {
        items_page(limit: ${PAGE}) {
          cursor items { id column_values(ids: $cols) { id text value } }
        }
      }
    }`;
  const toLight = (items) =>
    items.map((i) => ({
      id: String(i.id),
      cols: Object.fromEntries((i.column_values ?? []).map((c) => [c.id, c.text ?? ""])),
      vals: Object.fromEntries((i.column_values ?? []).map((c) => [c.id, c.value ?? ""])),
    }));

  const data = await gql(query, { bid: boardId, cols: columnIds });
  const page = data?.boards?.[0]?.items_page;
  const out = toLight(page?.items ?? []);
  let cursor = page?.cursor ?? null;

  while (cursor) {
    const next = await gql(
      `query ($cursor: String!, $cols: [String!]) {
        next_items_page(limit: ${PAGE}, cursor: $cursor) {
          cursor items { id column_values(ids: $cols) { id text value } }
        }
      }`,
      { cursor, cols: columnIds },
    );
    out.push(...toLight(next?.next_items_page?.items ?? []));
    cursor = next?.next_items_page?.cursor ?? null;
  }
  return out;
}

/**
 * Open patient questions across the Subscription + Secondary Claims boards.
 *
 * No patientIds: the SPA hook doesn't publish them either (it merges an empty
 * id map), so the Operations tab estimates movement from the net delta for
 * this role. Publishing ids on ONE side of that comparison would manufacture
 * phantom +in/-out chips, which is the SS5.8 drift this contract exists to stop.
 *
 * Each board is caught independently — one unreachable board must not zero the
 * whole count, mirroring the SPA's per-board `.catch(() => [])`.
 */
async function countPatientQuestions() {
  const [subItems, claimsItems] = await Promise.all([
    fetchAllBoardItems(SUB_BOARD, [PQ_SUB_MSG_COL, PQ_SUB_TS_COL, PQ_SUB_HANDLED_COL]).catch(() => []),
    fetchAllBoardItems(PQ_CLAIMS_BOARD, [PQ_CLAIMS_MSG_COL, PQ_CLAIMS_HANDLED_COL]).catch(() => []),
  ]);

  let count = 0;

  for (const item of subItems) {
    const msg = pqLongTextParts(item, PQ_SUB_MSG_COL);
    if (!msg.text.trim()) continue;
    const handledAt = pqDateValueToIso(item.vals?.[PQ_SUB_HANDLED_COL]);
    const messageAt = pqNewestTimestamp(item.cols?.[PQ_SUB_TS_COL] ?? "", msg.updatedAt);
    if (!pqIsOpen(messageAt, handledAt)) continue;
    count++;
  }

  for (const item of claimsItems) {
    const msg = pqLongTextParts(item, PQ_CLAIMS_MSG_COL);
    if (!msg.text.trim()) continue;
    const handledAt = pqDateValueToIso(item.vals?.[PQ_CLAIMS_HANDLED_COL]);
    if (!pqIsOpen(msg.updatedAt, handledAt)) continue;
    count++;
  }

  return count;
}


/**
 * Count escalated patients across all boards that have an escalation column.
 * Mirrors the systemMgmt count.
 */
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

/* ── Main ─────────────────────────────────────────────────── */

async function main() {
  console.log("Fetching patient counts from Monday.com…");

  // Eastern date/time
  const now = new Date();
  const easternDate = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const easternTime = now.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const [
    benefitsResult, submitAuthResult, authOutstandingResult,
    mashekeResult,
    dvsResult,
    welcomeCallResult, finalConfirmResult,
    profileResult,
    scheduledCallsResult,
    subscriptionResult,
    systemMgmtCount,
    patientQuestionsCount,
  ] = await Promise.all([
    countSamGroup(SAM_GROUPS.benefits, easternDate),
    countSamGroup(SAM_GROUPS.submitAuth, easternDate),
    countSamGroup(SAM_GROUPS.authOutstanding, easternDate, true),
    countMashekeStages(easternDate),
    countDvs(easternDate),
    countWelcomeCall(),
    countFinalConfirm(),
    countProfile(),
    countScheduledCalls(),
    countSubscription(),
    countEscalations(),
    countPatientQuestions(),
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
    ...scheduledCallsResult.counts,
    subscription: subscriptionResult.count,
    // Update Clinicals reads the SAME Subscription group as `subscription`
    // (useRoleCounts derives both from one fetch) — not a copy-paste slip.
    updateClinicals: subscriptionResult.count,
    patientQuestions: patientQuestionsCount,
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
    updateClinicals: [...subscriptionResult.ids],
  };

  const baseline = {
    dateKey: easternDate,
    counts,
    patientIds,
    takenAt: now.toISOString(),
    source: "github-actions",
  };

  // Check if we already have today's snapshot
  const outPath = "public/data/baseline.json";
  if (existsSync(outPath)) {
    try {
      const existing = JSON.parse(readFileSync(outPath, "utf8"));
      if (existing.dateKey === easternDate) {
        console.log(`Baseline for ${easternDate} already exists — skipping`);
        return;
      }
    } catch { /* corrupted file, overwrite */ }
  }

  mkdirSync("public/data", { recursive: true });
  writeFileSync(outPath, JSON.stringify(baseline, null, 2) + "\n");

  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  console.log(`Baseline written for ${easternDate} at ${easternTime} ET`);
  console.log(`Total patients: ${total}`);
  console.log(JSON.stringify(counts, null, 2));
}

main().catch((err) => {
  console.error("Snapshot failed:", err);
  process.exit(1);
});
