// Monday.com GraphQL client — direct from browser.
// Token is read from VITE_MONDAY_API_TOKEN at build time.

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-10";

export const BOARD_ID = 18410804557;

export const GROUPS = {
  welcomeCall: "group_mm1wvq8p",
  completed: "group_mm1x5s5d",
  stuck: "group_mm1xyczx",
  escalation: "group_mm1x5c0",
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
  
  // Stage
  stageAdvancer: "color_mm1ws96t",
  escalation: "color_mm1x7997",
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

export async function fetchGroupItems(groupId: string = GROUPS.welcomeCall): Promise<MondayItem[]> {
  const query = `
    query ($boardId: ID!, $cols: [String!]) {
      boards(ids: [$boardId]) {
        items_page(limit: 100, query_params: { rules: [{ column_id: "group", compare_value: ${JSON.stringify([groupId])} }] }) {
          items {
            id
            name
            column_values(ids: $cols) { id text value }
          }
        }
      }
    }
  `;
  const data = await gql<{ boards: { items_page: { items: MondayItem[] } }[] }>(query, {
    boardId: BOARD_ID,
    cols: READ_COLUMN_IDS,
  });
  return data.boards?.[0]?.items_page?.items ?? [];
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

