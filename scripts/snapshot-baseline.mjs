/**
 * snapshot-baseline.mjs
 *
 * Fetches patient counts from all Monday.com boards and writes
 * public/data/baseline.json.  Designed to run in GitHub Actions
 * early morning ET every weekday so the SPA has an authoritative
 * start-of-day snapshot that doesn't depend on a browser being open.
 *
 * Uses cursor-based pagination so boards with 500+ items are counted
 * accurately.
 *
 * Env: MONDAY_API_TOKEN
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";

const TOKEN = process.env.MONDAY_API_TOKEN;
if (!TOKEN) {
  console.error("MONDAY_API_TOKEN is not set — aborting");
  process.exit(1);
}

const PAGE = 500;

/* ── Board / group constants (mirrors useRoleCounts.ts) ──── */

const SAM_BOARD   = 18410601299;
const SAM_GROUPS  = {
  benefits:       "group_mm1xr3q3",
  submitAuth:     "group_mm1x1416",
  authOutstanding:"group_mm2v6d1z",
};

const MESH_BOARD  = 18406060017;
const MESH_GROUP  = "group_mm1xf2jb";   // 2. Medical Necessity
const STAGE_COL   = "color_mm1wyr92";    // Stage Advancer
const STAGE_MAP   = {
  "Evaluate MN":    "evaluate",
  "Send Request":   "sendRequest",
  "Confirm Receipt":"confirmReceipt",
  "Chase Clinicals":"chaseBenefits",
};

const WC_BOARD    = 18410804557;
const WC_GROUP    = "group_mm1wvq8p";
const FC_GROUP    = "group_mm2x8jtj";    // Final Profile Confirmation

const PROF_BOARD  = 18406352652;
const PROF_GROUP  = "group_mm1xf2jb";

const SUB_BOARD   = 18407459988;
const SUB_GROUP   = "topics";

/* ── Monday GraphQL helper ────────────────────────────────── */

async function gql(query, variables = {}) {
  const res = await fetch("https://api.monday.com/v2", {
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

/* ── Count fetchers (with cursor pagination) ─────────────── */

/** Returns { count, ids } for a board group */
async function countGroup(boardId, groupId) {
  const compareValue = JSON.stringify([groupId]);

  // First page
  const query = `
    query ($bid: ID!) {
      boards(ids: [$bid]) {
        items_page(limit: ${PAGE}, query_params: {
          rules: [{ column_id: "group", compare_value: ${compareValue} }]
        }) {
          cursor
          items { id }
        }
      }
    }`;
  const data = await gql(query, { bid: boardId });
  const page = data?.boards?.[0]?.items_page;
  const ids = (page?.items ?? []).map(i => String(i.id));
  let cursor = page?.cursor ?? null;

  // Follow cursor pages
  while (cursor) {
    const nextQuery = `
      query ($cursor: String!) {
        next_items_page(limit: ${PAGE}, cursor: $cursor) {
          cursor
          items { id }
        }
      }`;
    const next = await gql(nextQuery, { cursor });
    const nextItems = next?.next_items_page?.items ?? [];
    ids.push(...nextItems.map(i => String(i.id)));
    cursor = next?.next_items_page?.cursor ?? null;
  }

  return { count: ids.length, ids };
}

async function countMashekeStages() {
  const compareValue = JSON.stringify([MESH_GROUP]);

  // First page — use board-level items_page with group filter (same pattern as countGroup)
  const query = `
    query ($bid: ID!, $cols: [String!]) {
      boards(ids: [$bid]) {
        items_page(limit: ${PAGE}, query_params: {
          rules: [{ column_id: "group", compare_value: ${compareValue} }]
        }) {
          cursor
          items {
            id
            column_values(ids: $cols) { id text }
          }
        }
      }
    }`;
  const data = await gql(query, { bid: MESH_BOARD, cols: [STAGE_COL] });
  const page = data?.boards?.[0]?.items_page;
  const allItems = [...(page?.items ?? [])];
  let cursor = page?.cursor ?? null;

  while (cursor) {
    const nextQuery = `
      query ($cursor: String!, $cols: [String!]) {
        next_items_page(limit: ${PAGE}, cursor: $cursor) {
          cursor
          items {
            id
            column_values(ids: $cols) { id text }
          }
        }
      }`;
    const next = await gql(nextQuery, { cursor, cols: [STAGE_COL] });
    const nextItems = next?.next_items_page?.items ?? [];
    allItems.push(...nextItems);
    cursor = next?.next_items_page?.cursor ?? null;
  }

  const counts = { evaluate: 0, sendRequest: 0, confirmReceipt: 0, chaseBenefits: 0 };
  const ids = { evaluate: [], sendRequest: [], confirmReceipt: [], chaseBenefits: [] };
  for (const item of allItems) {
    const stageText = item.column_values?.find((c) => c.id === STAGE_COL)?.text ?? "";
    const roleId = STAGE_MAP[stageText];
    if (roleId && roleId in counts) {
      counts[roleId]++;
      ids[roleId].push(String(item.id));
    }
  }
  return { counts, ids };
}

/* ── Main ─────────────────────────────────────────────────── */

async function main() {
  console.log("Fetching patient counts from Monday.com…");

  const [
    benefitsResult, submitAuthResult, authOutstandingResult,
    mashekeResult,
    welcomeCallResult, finalConfirmResult,
    profileResult,
    subscriptionResult,
  ] = await Promise.all([
    countGroup(SAM_BOARD, SAM_GROUPS.benefits),
    countGroup(SAM_BOARD, SAM_GROUPS.submitAuth),
    countGroup(SAM_BOARD, SAM_GROUPS.authOutstanding),
    countMashekeStages(),
    countGroup(WC_BOARD, WC_GROUP),
    countGroup(WC_BOARD, FC_GROUP),
    countGroup(PROF_BOARD, PROF_GROUP),
    countGroup(SUB_BOARD, SUB_GROUP),
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

  // Eastern date/time
  const now = new Date();
  const easternDate = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const easternTime = now.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

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
