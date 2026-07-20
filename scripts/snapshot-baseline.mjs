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
const SAM_FOLLOWUP_COL = "color_mm34jz1x"; // Follow Up
const SAM_FOLLOWUP_DATE_COL = "date_mm34m2dz"; // Follow Up Date (daily bucket)

const MESH_BOARD  = 18406060017;
const MESH_GROUP  = "group_mm1xf2jb";     // 2. Medical Necessity
const MESH_STAGE_COL  = "color_mm1wyr92"; // Stage Advancer
const MESH_NAD_COL    = "date_mm1wadgs";  // Next Action Date
const MESH_ESC_COL    = "color_mm1x7997"; // Escalation
const MESH_METHOD_COL = "color_mm1xw7y5"; // Clinicals Method (chase split)

const WC_BOARD    = 18410804557;
const WC_GROUP    = "group_mm1wvq8p";
const FC_GROUP    = "group_mm2x8jtj";     // Final Profile Confirmation
const WC_ESC_COL      = "color_mm1x7997"; // Escalation
const WC_FOLLOWUP_COL = "color_mm38w2tk"; // Follow Up

const PROF_BOARD  = 18406352652;
const PROF_GROUP  = "group_mm1xf2jb";
const PROF_FOLLOWUP_COL = "color_mm3822qq"; // Follow Up
const PROF_REFERRAL_TYPE_COL = "color_mm1wm4n4";   // Referral Type (role split)
const PROF_REFERRAL_SOURCE_COL = "color_mm1w5wxr"; // Referral Source (role split)

const SUB_BOARD   = 18407459988;
const SUB_GROUP   = "topics";

const ESC_REQUIRED = "Escalation Required";

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
    ? "id column_values(ids: $cols) { id text }"
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
 *  Daily bucket (2026-07-20): a Follow Up only hides the patient while its
 *  date is in the FUTURE — when the date arrives (<= today ET) the patient
 *  counts active again; dateless follow-ups stay snoozed. Mirrors
 *  useRoleCounts.ts samActive + sidebarList.isSnoozedFollowUp (SS5.8
 *  counting contract — change all of them together). */
async function countSamGroup(groupId, todayStr) {
  const items = await fetchGroupItems(SAM_BOARD, groupId, [SAM_ESC_COL, SAM_FOLLOWUP_COL, SAM_FOLLOWUP_DATE_COL]);
  const snoozed = (i) => {
    if (i.cols[SAM_FOLLOWUP_COL] !== "Follow Up") return false;
    const d = i.cols[SAM_FOLLOWUP_DATE_COL];
    return !d || d > todayStr;
  };
  const active = items.filter((i) => i.cols[SAM_ESC_COL] !== ESC_REQUIRED && !snoozed(i));
  return { count: active.length, ids: active.map((i) => i.id) };
}

/** Masheke stages: split by Stage Advancer + Clinicals Method, filter esc + future NAD. */
async function countMashekeStages(todayStr) {
  const items = await fetchGroupItems(MESH_BOARD, MESH_GROUP, [
    MESH_STAGE_COL, MESH_NAD_COL, MESH_ESC_COL, MESH_METHOD_COL,
  ]);

  const counts = { evaluate: 0, sendRequest: 0, confirmReceipt: 0, chaseFax: 0, chaseParachute: 0, chaseBenefits: 0 };
  const ids = { evaluate: [], sendRequest: [], confirmReceipt: [], chaseFax: [], chaseParachute: [], chaseBenefits: [] };

  for (const item of items) {
    const stage = item.cols[MESH_STAGE_COL] ?? "";
    let roleId = null;
    if (stage === "Evaluate MN") roleId = "evaluate";
    else if (stage === "Send Request") roleId = "sendRequest";
    else if (stage === "Confirm Receipt") roleId = "confirmReceipt";
    else if (stage === "Chase Clinicals") {
      const cm = item.cols[MESH_METHOD_COL] ?? "";
      roleId = cm === "Parachute" || cm === "Email" ? "chaseParachute" : "chaseFax";
    }
    if (!roleId) continue;

    if (item.cols[MESH_ESC_COL] === ESC_REQUIRED) continue; // escalated
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

/** Profile group: active = Follow Up !== "Done", split into
 *  profile (Verified Referrals) vs unverifiedReferrals by Referral Type
 *  "Patient" OR Referral Source "CareCentrix" (mirrors
 *  src/lib/profile/referralSplit.ts — only the TYPE column routes "Patient";
 *  the SOURCE column has its own "Patient" label that must NOT match). */
async function countProfile() {
  const items = await fetchGroupItems(PROF_BOARD, PROF_GROUP, [
    PROF_FOLLOWUP_COL, PROF_REFERRAL_TYPE_COL, PROF_REFERRAL_SOURCE_COL,
  ]);
  const active = items.filter((i) => i.cols[PROF_FOLLOWUP_COL] !== "Done");
  const isUnverified = (i) =>
    (i.cols[PROF_REFERRAL_TYPE_COL] ?? "").trim().toLowerCase() === "patient" ||
    (i.cols[PROF_REFERRAL_SOURCE_COL] ?? "").trim().toLowerCase() === "carecentrix";
  const unverified = active.filter(isUnverified);
  const verified = active.filter((i) => !isUnverified(i));
  return {
    counts: { profile: verified.length, unverifiedReferrals: unverified.length },
    ids: { profile: verified.map((i) => i.id), unverifiedReferrals: unverified.map((i) => i.id) },
  };
}

/** Subscription group: all items. */
async function countSubscription() {
  const items = await fetchGroupItems(SUB_BOARD, SUB_GROUP, []);
  return { count: items.length, ids: items.map((i) => i.id) };
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
        const txt = item.cols[colId] ?? "";
        if (txt === "Escalation Required" || txt === "Escalate") total++;
      }
    }
  }
  return total;
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
    welcomeCallResult, finalConfirmResult,
    profileResult,
    subscriptionResult,
    systemMgmtCount,
  ] = await Promise.all([
    countSamGroup(SAM_GROUPS.benefits, easternDate),
    countSamGroup(SAM_GROUPS.submitAuth, easternDate),
    countSamGroup(SAM_GROUPS.authOutstanding, easternDate),
    countMashekeStages(easternDate),
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
