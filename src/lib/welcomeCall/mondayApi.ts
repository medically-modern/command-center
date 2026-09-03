// Monday.com GraphQL client — direct from browser.
// Token is read from VITE_MONDAY_API_TOKEN at build time.

import { MONDAY_API_URL, mondayIdentityHeaders } from "../shared/mondayEndpoint";
import { POS_COLUMN_ID } from "../shared/pos";
import { planPhoneWrite } from "../shared/phoneCell";
const MONDAY_API_VERSION = "2024-10";

export const BOARD_ID = 18410804557;

export const GROUPS = {
  welcomeCall: "group_mm1wvq8p",
  completed: "group_mm1x5s5d",
  stuck: "group_mm1xyczx",
} as const;

// Read columns — everything we need to display
export const COL = {
  // Debug breadcrumb for verifiedWrite's `writeDebug` — a COLUMN id, so it
  // belongs here. It sat in GROUPS until 2026-08-20, which made
  // `COL.joshDebug` undefined: every writeDebug call sent a mutation with a
  // missing `$columnId: String!` and failed, silently, because verifiedWrite
  // swallows debug failures ("best-effort"). The send's own error text tells
  // the rep to "Check the Josh Debug column" — which nothing had ever
  // written to. Caught by `tsc -b`, never by CI's `tsc --noEmit` (see the
  // Typecheck step in deploy.yml: the root tsconfig is solution-style, so
  // that command checks zero files).
  joshDebug: "text_mm35b391",
  // Demographics (read-only)
  dob: "text_mm1xvxst",
  phone: "phone_mm1x44yk",
  email: "text_mm1xc140",
  address: "location_mm1xhw17",
  gender: "color_mm1x1bdg",
  
  // Insurance (read-only)
  primaryInsurance: "color_mm1x157j",
  memberId1: "text_mm1x2qk2",
  secondaryInsurance: "color_mm241kqp",
  memberId2: "text_mm1xaccx",

  /** "POS" (Office = 0 | Home = 1). Write-only here: the rep has no control
   *  over it, the app dictates it from Primary Insurance + address at submit.
   *  The literal ID lives in lib/shared/pos.ts next to the rule that fills it. */
  pos: POS_COLUMN_ID,

  // Referral/Product info (read-only)
  serving: "color_mm1w1cm9",
  pumpType: "color_mm1wjjtk",
  cgmType: "color_mm1w7pmf",
  requestType: "color_mm1w1978",
  doctorName: "text_mm1x46et",
  doctorNpi: "text_mm1x7d91",
  referralSource: "color_mm1w5wxr",
  referralReceivedDate: "date_mm1x4e1r",
  diagnosis: "color_mm1wf7rv",
  notes: "long_text_mm2ffsme",
  // Carried-forward read-only notes from earlier stages (populated by a Monday
  // automation; the SPA only reads them). Columns created 2026-07.
  profileSendOffNotes: "long_text_mm5g1txs",
  mnWorkflowNotes: "long_text_mm5gx6j6",
  insuranceNotes: "text_mm5pegde",

  // Welcome Call editable fields
  monitorQty: "numeric_mm1xyfhc",
  pumpQty: "numeric_mm1xa0z2",
  qtyInf1: "numeric_mm1xv7wr",
  infusionSet1: "color_mm1x9paw",
  qtyInf2: "numeric_mm1xkq3b",
  infusionSet2: "color_mm1xekaz",
  /** "Qty Cartridge" (added 2026-07) — cartridge quantity, defaults to 3 in the UI. */
  qtyCartridge: "numeric_mm515sqv",
  /** "Medicare Prior Pump Date" (text) — MM/YYYY, Original-Medicare-only field. */
  medicarePriorPumpDate: "text_mm58k9x9",
  /** "Monitor Purchase Date" (text) — MM/YYYY, Original-Medicare-only, the CGM
   *  twin of the pump date above. Auto-derived; see shared/monitorPurchaseDate.ts. */
  monitorPurchaseDate: "text_mm6693sn",
  subscriptionType: "color_mm1xbqth",
  welcomeCallText: "color_mm1xtqvv",
  orderHandling: "color_mm2776fg",
  advanceDecision: "color_mm301cpp",
  
  // Call attempts
  callAttempts: "text_mm322fg9",

  // Auth Results (read-only)
  cgmAuthResult: "color_mm1wgjd1",
  sensorsAuthResult: "color_mm1x5c99",
  ipAuthResult: "color_mm1xnzmn",
  infusionSetAuthResult: "color_mm1xr2j1",
  cartridgeAuthResult: "color_mm1xybvt",

  /* Auth validity windows (read-only, added for MM-1080).
   * These columns have always existed on the board and were simply never read.
   * A status alone can't answer the question the rep is actually being asked on
   * the call — "am I covered?" — and it goes stale silently: an auth that was
   * invalid, went to the retry queue and came back approved shows "Auth Valid"
   * with nothing saying through when, and no note is written when the bot
   * flips it. Showing the window is what resolves that.
   * ⚠️ The "CGM" auth result is the MONITOR line on this board — its dates are
   * the Monitor Auth Start/End pair, not a separate CGM one. */
  cgmAuthStart: "date_mm1wj1bz",
  cgmAuthEnd: "date_mm1whebp",
  sensorsAuthStart: "date_mm1x929",
  sensorsAuthEnd: "date_mm1xvnqb",
  ipAuthStart: "date_mm1xxbkz",
  ipAuthEnd: "date_mm1x2q3",
  infusionSetAuthStart: "date_mm1xrk1c",
  infusionSetAuthEnd: "date_mm1xj3wp",
  cartridgeAuthStart: "date_mm1xp0vm",
  cartridgeAuthEnd: "date_mm1xznf9",

  // Benefits (read-only)
  deductible: "text_mm1xkbqc",
  deductibleRemaining: "text_mm1xdzxw",
  oopMax: "text_mm1xdtj7",
  oopMaxRemaining: "text_mm1xx5f",
  stediCoinsurance: "text_mm391jq8",
  stediQmb: "text_mm2wms12",

  // Last bill dates (read-only)
  cgmLastBillDate: "date_mm33vqa0",
  sensorsLastBillDate: "date_mm33jsyt",
  ipLastBillDate: "date_mm33kmz4",
  infusionSetLastBillDate: "date_mm33mw14",
  cartridgeLastBillDate: "date_mm33rd8n",
  // Next order dates (read-only)
  ipNextOrderDate: "date_mm356crn",
  sensorsNextOrderDate: "date_mm35bdf8",
  suppliesNextOrderDate: "date_mm351tva",

  // Follow Up
  followUp: "color_mm38w2tk",
  followUpDate: "date_mm38a7k7",

  // Never Billed (Medicare A&B — mirrored from Samantha board)
  neverBilledIsCar: "color_mm3zn2qy",
  neverBilledCgm: "color_mm3z8rw0",

  // Per-product monitor SoS facts, copied from the Insurance board by the
  // create-item automation 7918324247. These drive Monitor Purchase Date.
  // ⚠ Read the per-product columns, NOT the `neverBilledCgm` rollup above: the
  // rollup covers sensors AND monitor together, and is only ever written when
  // truthy, so it can never be un-set (CLAUDE.md §10 / audit B5) — a patient
  // whose SoS later came back billed would keep a stale placeholder forever.
  // These two are rewritten on every Benefits send, so they self-correct.
  sosNeverBilledMonitor: "boolean_mm5ad9rm",
  sosLastBillMonitor: "date_mm599gk8",

  // Stage
  stageAdvancer: "color_mm1ws96t",
  escalation: "color_mm1x7997",
  escalationNotes: "long_text_mm3jgh1y",
} as const;

export const READ_COLUMN_IDS = [
  COL.dob, COL.phone, COL.email, COL.address, COL.gender,
  COL.primaryInsurance, COL.memberId1, COL.secondaryInsurance, COL.memberId2,
  COL.serving, COL.pumpType, COL.cgmType, COL.requestType, COL.doctorName, COL.doctorNpi,
  COL.referralSource, COL.referralReceivedDate,
  COL.diagnosis, COL.notes, COL.profileSendOffNotes, COL.mnWorkflowNotes, COL.insuranceNotes,
  COL.monitorQty, COL.pumpQty, COL.qtyInf1, COL.infusionSet1,
  COL.qtyInf2, COL.infusionSet2, COL.qtyCartridge, COL.medicarePriorPumpDate, COL.monitorPurchaseDate,
  COL.subscriptionType, COL.welcomeCallText,
  COL.orderHandling, COL.advanceDecision,
  COL.callAttempts,
  COL.cgmAuthResult, COL.sensorsAuthResult, COL.ipAuthResult,
  COL.infusionSetAuthResult, COL.cartridgeAuthResult,
  COL.cgmAuthStart, COL.cgmAuthEnd,
  COL.sensorsAuthStart, COL.sensorsAuthEnd,
  COL.ipAuthStart, COL.ipAuthEnd,
  COL.infusionSetAuthStart, COL.infusionSetAuthEnd,
  COL.cartridgeAuthStart, COL.cartridgeAuthEnd,
  // POS is WRITTEN by this stage (mondayWrite computes it from Primary
  // Insurance + address). Reading it back lets the card show the rep what the
  // rule decided — it was write-only, so the value was invisible in the app.
  COL.pos,
  COL.deductible, COL.deductibleRemaining, COL.oopMax, COL.oopMaxRemaining, COL.stediCoinsurance, COL.stediQmb,
  COL.cgmLastBillDate, COL.sensorsLastBillDate, COL.ipLastBillDate,
  COL.infusionSetLastBillDate, COL.cartridgeLastBillDate,
  COL.ipNextOrderDate, COL.sensorsNextOrderDate, COL.suppliesNextOrderDate,
  COL.followUp, COL.followUpDate,
  // Escalation STATUS (read-only). ⚠️ Deliberately NOT wired into `escalated`:
  // this stage's escalation is write-only and needs a rewrite, not a piecemeal
  // patch (CLAUDE.md §10). It is read purely so Profile Status can report the
  // rung — without it, an escalated patient's badge would inherit the
  // hardcoded `escalated: false` and silently read Active.
  COL.escalation,
  COL.escalationNotes,
  COL.neverBilledIsCar, COL.neverBilledCgm,
  COL.sosNeverBilledMonitor, COL.sosLastBillMonitor,
];

export interface MondayColumnValue {
  id: string;
  text: string | null;
  value: string | null;
}

export interface MondayItem {
  id: string;
  name: string;
  /** Board group the item sits in. Fetched so Profile Status can report Stuck —
   *  being Stuck is a GROUP, not a column (lib/shared/profileStatus.ts). */
  group?: { id: string };
  column_values: MondayColumnValue[];
}

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
      ...mondayIdentityHeaders(),
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

export async function fetchGroupItems(
  groupId: string = GROUPS.welcomeCall,
  onMore?: (items: MondayItem[]) => void,
): Promise<MondayItem[]> {
  const PAGE = 200;
  const query = `
    query ($boardId: ID!, $cols: [String!]) {
      boards(ids: [$boardId]) {
        items_page(limit: ${PAGE}, query_params: { rules: [{ column_id: "group", compare_value: ${JSON.stringify([groupId])} }] }) {
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
  `;
  const data = await gql<{ boards: { items_page: { cursor: string | null; items: MondayItem[] } }[] }>(query, {
    boardId: BOARD_ID,
    cols: READ_COLUMN_IDS,
  });
  const firstPage = data.boards?.[0]?.items_page?.items ?? [];
  let cursor = data.boards?.[0]?.items_page?.cursor ?? null;

  const allItems: MondayItem[] = [...firstPage];

  while (cursor) {
    try {
      const nextQuery = `
        query ($cursor: String!, $cols: [String!]) {
          next_items_page(limit: ${PAGE}, cursor: $cursor) {
            cursor
            items { id name group { id } column_values(ids: $cols) { id text value } }
          }
        }
      `;
      const next = await gql<{ next_items_page: { cursor: string | null; items: MondayItem[] } }>(nextQuery, { cursor, cols: READ_COLUMN_IDS });
      const items = next.next_items_page?.items ?? [];
      cursor = next.next_items_page?.cursor ?? null;
      if (items.length > 0) {
        allItems.push(...items);
        if (onMore) onMore(items);
      }
    } catch (e) { console.error("[fetchGroupItems] pagination error", e); break; }
  }

  return allItems;
}

/**
 * Write a status column by index. value is a JSON string like '{"index": 1}'.
 */
export async function writeStatusIndex(itemId: string, columnId: string, index: number): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify({ index }),
  });
}

/**
 * Write a long_text column.
 */
export async function writeLongText(itemId: string, columnId: string, text: string): Promise<void> {
  // A BARE string through change_multiple_column_values — accepted for BOTH a
  // long_text and a plain text column (sandbox-verified 2026-09-03), so this
  // keeps working across the long_text → text conversion of the notes columns
  // (CLAUDE.md §10) whichever side of it a given column is on. change_column_value
  // is stricter in both directions: it rejects a bare string for long_text AND a
  // {text} object for text, so it would break on flip day. Same mutation the
  // gateway /send path uses, so the two paths cannot drift.
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $vals: JSON!) {
      change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $vals) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, vals: JSON.stringify({ [columnId]: text }) });
}

/**
 * Write a dropdown column (multi-select) by option ids.
 */
export async function writeDropdownIds(itemId: string, columnId: string, ids: number[]): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify({ ids }),
  });
}

/**
 * Write a number column.
 */
export async function writeNumber(itemId: string, columnId: string, num: number): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify(String(num)),
  });
}

/**
 * Write a text column.
 */
export async function writeText(itemId: string, columnId: string, text: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify(text),
  });
}

/**
 * Write a location column.
 */
export async function writeLocation(itemId: string, columnId: string, address: string, lat: number = 0, lng: number = 0): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify({ address, lat, lng }),
  });
}

/**
 * Write a date column (YYYY-MM-DD).
 */
export async function writeDate(itemId: string, columnId: string, date: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify({ date }),
  });
}

/**
 * Write a phone column.
 */
/** See shared/phoneCell.ts — Monday's API needs bare digits; reps type formatting. */
export async function writePhone(itemId: string, columnId: string, phone: string, countryShortName = "US"): Promise<void> {
  const plan = planPhoneWrite(phone);
  if (plan.action === "skip") return;
  const val = plan.action === "write" ? { phone: plan.phone, countryShortName } : {};
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify(val),
  });
}

/**
 * Clear a status column (set to empty / no label).
 */
export async function clearStatusColumn(itemId: string, columnId: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify({}),
  });
}

/**
 * Clear a date column.
 */
export async function clearDateColumn(itemId: string, columnId: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify({}),
  });
}

// ── Files / Assets ───────────────────────────────────────────────────

export interface MondayAsset {
  id: string;
  name: string;
  url: string;
  public_url: string;
}

/** Fetch every file asset attached to a welcome-call board item. */
export async function fetchItemAssets(itemId: string): Promise<MondayAsset[]> {
  const query = `
    query ($itemId: [ID!]!) {
      items(ids: $itemId) {
        assets(assets_source: all) { id name url public_url }
      }
    }
  `;
  const data = await gql<{
    items: { assets: MondayAsset[] }[];
  }>(query, { itemId: [itemId] });
  return data.items?.[0]?.assets ?? [];
}


/** Fetch a single item by ID regardless of group (for cross-group deep-links). */
export async function fetchItemById(itemId: string): Promise<MondayItem | null> {
  const query = `
    query ($itemId: [ID!]!, $cols: [String!]) {
      items(ids: $itemId) {
        id
        name
        group { id }
        column_values(ids: $cols) { id text value }
      }
    }
  `;
  const data = await gql<{
    items: MondayItem[];
  }>(query, { itemId: [itemId], cols: READ_COLUMN_IDS });
  return data.items?.[0] ?? null;
}


/** Read arbitrary column text values for a single item (used by write verification). */
export async function readColumnTexts(
  itemId: string,
  columnIds: string[],
): Promise<{ id: string; text: string | null }[]> {
  const query = `
    query ($ids: [ID!]!, $cols: [String!]) {
      items(ids: $ids) { column_values(ids: $cols) { id text } }
    }
  `;
  const data = await gql<{ items: { column_values: { id: string; text: string | null }[] }[] }>(
    query,
    { ids: [itemId], cols: columnIds },
  );
  return data.items?.[0]?.column_values ?? [];
}
