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
 *   subscription — all items in the group
 *   systemMgmt — escalated patients across all boards
 *
 * Env vars:
 *   MONDAY_API_TOKEN  — Monday.com API token
 *   GITHUB_PAT        — GitHub personal access token with repo write
 *   GITHUB_REPO       — e.g. "medically-modern/command-center-test"
 *   DRY_RUN           — set to "1" to print the baseline instead of committing
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
const SAM_FOLLOWUP_COL = "color_mm34jz1x"; // Follow Up

const MESH_BOARD  = 18406060017;
const MESH_GROUP  = "group_mm1xf2jb";
const MESH_STAGE_COL  = "color_mm1wyr92"; // Stage Advancer
const MESH_NAD_COL    = "date_mm1wadgs";  // Next Action Date
const MESH_ESC_COL    = "color_mm1x7997"; // Escalation
const MESH_METHOD_COL = "color_mm1xw7y5"; // Clinicals Method (chase split)

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

const SUB_BOARD   = 18407459988;
const SUB_GROUP   = "topics";

const ESC_REQUIRED = "Escalation Required";

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

/** Samantha group: active = not escalated AND Follow Up !== "Follow Up". */
async function countSamGroup(groupId) {
  const items = await fetchGroupItems(SAM_BOARD, groupId, [SAM_ESC_COL, SAM_FOLLOWUP_COL]);
  const active = items.filter(
    (i) => i.cols[SAM_ESC_COL] !== ESC_REQUIRED && i.cols[SAM_FOLLOWUP_COL] !== "Follow Up",
  );
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

/** Escalated patients across all boards (systemMgmt count). */
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
    welcomeCallResult, finalConfirmResult,
    profileResult, subscriptionResult,
    systemMgmtCount,
  ] = await Promise.all([
    countSamGroup(SAM_GROUPS.benefits),
    countSamGroup(SAM_GROUPS.submitAuth),
    countSamGroup(SAM_GROUPS.authOutstanding),
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
  console.log("=== Baseline Cron Done ===");
}

main().catch(err => {
  console.error("Baseline cron failed:", err);
  process.exit(1);
});
