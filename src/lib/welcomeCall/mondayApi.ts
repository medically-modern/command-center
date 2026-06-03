// Monday.com GraphQL client — direct from browser.
// Token is read from VITE_MONDAY_API_TOKEN at build time.

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-10";

export const BOARD_ID = 18410804557;

export const GROUPS = {
  welcomeCall: "group_mm1wvq8p",
  completed: "group_mm1x5s5d",
  stuck: "group_mm1xyczx",
  // Debug
  joshDebug: "text_mm35b391",
} as const;

// Read columns — everything we need to display
export const COL = {
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
  
  // Referral/Product info (read-only)
  serving: "color_mm1w1cm9",
  pumpType: "color_mm1wjjtk",
  cgmType: "color_mm1w7pmf",
  requestType: "color_mm1w1978",
  doctorName: "text_mm1x46et",
  referralSource: "color_mm1w5wxr",
  referralReceivedDate: "date_mm1x4e1r",
  diagnosis: "color_mm1wf7rv",
  notes: "long_text_mm2ffsme",
  
  // Welcome Call editable fields
  monitorQty: "numeric_mm1xyfhc",
  pumpQty: "numeric_mm1xa0z2",
  qtyInf1: "numeric_mm1xv7wr",
  infusionSet1: "color_mm1x9paw",
  qtyInf2: "numeric_mm1xkq3b",
  infusionSet2: "color_mm1xekaz",
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

  // Stage
  stageAdvancer: "color_mm1ws96t",
  escalation: "color_mm1x7997",
  escalationNotes: "long_text_mm3jgh1y",
} as const;

export const READ_COLUMN_IDS = [
  COL.dob, COL.phone, COL.email, COL.address, COL.gender,
  COL.primaryInsurance, COL.memberId1, COL.secondaryInsurance, COL.memberId2,
  COL.serving, COL.pumpType, COL.cgmType, COL.requestType, COL.doctorName,
  COL.referralSource, COL.referralReceivedDate,
  COL.diagnosis, COL.notes,
  COL.monitorQty, COL.pumpQty, COL.qtyInf1, COL.infusionSet1,
  COL.qtyInf2, COL.infusionSet2, COL.subscriptionType, COL.welcomeCallText,
  COL.orderHandling, COL.advanceDecision,
  COL.callAttempts,
  COL.cgmAuthResult, COL.sensorsAuthResult, COL.ipAuthResult,
  COL.infusionSetAuthResult, COL.cartridgeAuthResult,
  COL.deductible, COL.deductibleRemaining, COL.oopMax, COL.oopMaxRemaining, COL.stediCoinsurance, COL.stediQmb,
  COL.cgmLastBillDate, COL.sensorsLastBillDate, COL.ipLastBillDate,
  COL.infusionSetLastBillDate, COL.cartridgeLastBillDate,
  COL.ipNextOrderDate, COL.sensorsNextOrderDate, COL.suppliesNextOrderDate,
  COL.followUp, COL.followUpDate,
  COL.escalationNotes,
  COL.neverBilledIsCar, COL.neverBilledCgm,
];

export interface MondayColumnValue {
  id: string;
  text: string | null;
  value: string | null;
}

export interface MondayItem {
  id: string;
  name: string;
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
            items { id name column_values(ids: $cols) { id text value } }
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
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify({ text }),
  });
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
export async function writePhone(itemId: string, columnId: string, phone: string, countryShortName = "US"): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify({ phone, countryShortName }),
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
