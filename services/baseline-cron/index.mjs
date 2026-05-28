/**
 * baseline-cron — Railway cron service
 *
 * Runs daily at 9 AM ET (weekdays). Queries Monday.com for patient counts,
 * builds baseline.json, and commits it to the command-center-test repo
 * via the GitHub Contents API.
 *
 * Env vars:
 *   MONDAY_API_TOKEN  — Monday.com API token
 *   GITHUB_PAT        — GitHub personal access token with repo write
 *   GITHUB_REPO       — e.g. "medically-modern/command-center-test"
 */

const MONDAY_TOKEN = process.env.MONDAY_API_TOKEN;
const GITHUB_PAT = process.env.GITHUB_PAT;
const GITHUB_REPO = process.env.GITHUB_REPO || "medically-modern/command-center-test";

if (!MONDAY_TOKEN) { console.error("MONDAY_API_TOKEN not set"); process.exit(1); }
if (!GITHUB_PAT) { console.error("GITHUB_PAT not set"); process.exit(1); }

const PAGE = 500;

/* ── Board / group constants (mirrors useRoleCounts.ts) ──── */

const SAM_BOARD   = 18410601299;
const SAM_GROUPS  = {
  benefits:        "group_mm1xr3q3",
  submitAuth:      "group_mm1x1416",
  authOutstanding: "group_mm2v6d1z",
};

const MESH_BOARD  = 18406060017;
const MESH_GROUP  = "group_mm1xf2jb";
const STAGE_COL   = "color_mm1wyr92";
const STAGE_MAP   = {
  "Evaluate MN":     "evaluate",
  "Send Request":    "sendRequest",
  "Confirm Receipt": "confirmReceipt",
  "Chase Clinicals": "chaseBenefits",
};

const WC_BOARD    = 18410804557;
const WC_GROUP    = "group_mm1wvq8p";
const FC_GROUP    = "group_mm2x8jtj";

const PROF_BOARD  = 18406352652;
const PROF_GROUP  = "group_mm1xf2jb";

const SUB_BOARD   = 18407459988;
const SUB_GROUP   = "topics";

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

/* ── Count fetchers (with cursor pagination) ─────────────── */

async function countGroup(boardId, groupId) {
  const compareValue = JSON.stringify([groupId]);
  const query = `
    query ($bid: ID!) {
      boards(ids: [$bid]) {
        items_page(limit: ${PAGE}, query_params: {
          rules: [{ column_id: "group", compare_value: ${compareValue} }]
        }) { cursor items { id } }
      }
    }`;
  const data = await gql(query, { bid: boardId });
  const page = data?.boards?.[0]?.items_page;
  const ids = (page?.items ?? []).map(i => String(i.id));
  let cursor = page?.cursor ?? null;

  while (cursor) {
    const next = await gql(
      `query ($cursor: String!) { next_items_page(limit: ${PAGE}, cursor: $cursor) { cursor items { id } } }`,
      { cursor },
    );
    ids.push(...(next?.next_items_page?.items ?? []).map(i => String(i.id)));
    cursor = next?.next_items_page?.cursor ?? null;
  }
  return { count: ids.length, ids };
}

async function countMashekeStages() {
  const compareValue = JSON.stringify([MESH_GROUP]);
  const query = `
    query ($bid: ID!, $cols: [String!]) {
      boards(ids: [$bid]) {
        items_page(limit: ${PAGE}, query_params: {
          rules: [{ column_id: "group", compare_value: ${compareValue} }]
        }) { cursor items { id column_values(ids: $cols) { id text } } }
      }
    }`;
  const data = await gql(query, { bid: MESH_BOARD, cols: [STAGE_COL] });
  const page = data?.boards?.[0]?.items_page;
  const allItems = [...(page?.items ?? [])];
  let cursor = page?.cursor ?? null;

  while (cursor) {
    const next = await gql(
      `query ($cursor: String!, $cols: [String!]) { next_items_page(limit: ${PAGE}, cursor: $cursor) { cursor items { id column_values(ids: $cols) { id text } } } }`,
      { cursor, cols: [STAGE_COL] },
    );
    allItems.push(...(next?.next_items_page?.items ?? []));
    cursor = next?.next_items_page?.cursor ?? null;
  }

  const counts = { evaluate: 0, sendRequest: 0, confirmReceipt: 0, chaseBenefits: 0 };
  const ids = { evaluate: [], sendRequest: [], confirmReceipt: [], chaseBenefits: [] };
  for (const item of allItems) {
    const stageText = item.column_values?.find(c => c.id === STAGE_COL)?.text ?? "";
    const roleId = STAGE_MAP[stageText];
    if (roleId && roleId in counts) { counts[roleId]++; ids[roleId].push(String(item.id)); }
  }
  return { counts, ids };
}

async function countEscalations() {
  let total = 0;
  for (const { boardId, colId, groups } of ESCALATION_BOARDS) {
    const compareValue = JSON.stringify(groups);
    const query = `
      query ($bid: ID!, $cols: [String!]) {
        boards(ids: [$bid]) {
          items_page(limit: ${PAGE}, query_params: {
            rules: [{ column_id: "group", compare_value: ${compareValue} }]
          }) { cursor items { id column_values(ids: $cols) { id text } } }
        }
      }`;
    const data = await gql(query, { bid: boardId, cols: [colId] });
    const page = data?.boards?.[0]?.items_page;
    const allItems = [...(page?.items ?? [])];
    let cursor = page?.cursor ?? null;

    while (cursor) {
      const next = await gql(
        `query ($cursor: String!, $cols: [String!]) { next_items_page(limit: ${PAGE}, cursor: $cursor) { cursor items { id column_values(ids: $cols) { id text } } } }`,
        { cursor, cols: [colId] },
      );
      allItems.push(...(next?.next_items_page?.items ?? []));
      cursor = next?.next_items_page?.cursor ?? null;
    }

    for (const item of allItems) {
      const txt = item.column_values?.find(c => c.id === colId)?.text ?? "";
      if (txt === "Escalation Required" || txt === "Escalate") total++;
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

  const [
    benefitsResult, submitAuthResult, authOutstandingResult,
    mashekeResult,
    welcomeCallResult, finalConfirmResult,
    profileResult, subscriptionResult,
    systemMgmtCount,
  ] = await Promise.all([
    countGroup(SAM_BOARD, SAM_GROUPS.benefits),
    countGroup(SAM_BOARD, SAM_GROUPS.submitAuth),
    countGroup(SAM_BOARD, SAM_GROUPS.authOutstanding),
    countMashekeStages(),
    countGroup(WC_BOARD, WC_GROUP),
    countGroup(WC_BOARD, FC_GROUP),
    countGroup(PROF_BOARD, PROF_GROUP),
    countGroup(SUB_BOARD, SUB_GROUP),
    countEscalations(),
  ]);

  const counts = {
    benefits: benefitsResult.count,
    submitAuth: submitAuthResult.count,
    authOutstanding: authOutstandingResult.count,
    ...mashekeResult.counts,
    welcomeCall: welcomeCallResult.count,
    finalConfirm: finalConfirmResult.count,
    profile: profileResult.count,
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
    profile: profileResult.ids,
    subscription: subscriptionResult.ids,
  };

  const now = new Date();
  const easternDate = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

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

  await commitBaseline(baseline);
  console.log("=== Baseline Cron Done ===");
}

main().catch(err => {
  console.error("Baseline cron failed:", err);
  process.exit(1);
});
