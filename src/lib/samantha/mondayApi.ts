// Monday.com GraphQL client — direct from browser.
// Token is read from VITE_MONDAY_API_TOKEN at build time.

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-10";

export const BOARD_ID = 18410601299;

export const GROUPS = {
  benefits: "group_mm1xr3q3",
  submitAuth: "group_mm1x1416",
  authOutstanding: "group_mm2v6d1z",
  escalations: "group_mm2vg9gn",
  complete: "group_mm2vw3c0",
} as const;

// Read columns
export const COL = {
  serving: "color_mm1w1cm9",
  primaryInsurance: "color_mm1x157j",
  diagnosis: "color_mm1wf7rv",
  secondaryInsurance: "color_mm241kqp",
  doctorName: "text_mm1x46et",
  doctorPhone: "phone_mm1xz8c0",
  doctorNpi: "text_mm1x7d91",
  doctorEmail: "email_mm1x6fq5",
  doctorFax: "email_mm1xdzcj",
  clinicalsMethod: "color_mm1xw7y5",
  clinicName: "dropdown_mm1xbvas",
  dob: "text_mm1xvxst",
  memberId1: "text_mm1x2qk2",
  memberId2: "text_mm1xaccx",

  // Universal write columns
  activeNetwork: "color_mm2vhwan",
  dmeBenefits: "color_mm2vt8xg",
  sos: "color_mm2vemyy",
  auth: "color_mm2vg3ew",

  // Escalation + stage flow
  escalation: "color_mm2vsh2f",
  stageAdvancer: "color_mm1ws96t",
  notClearProducts: "dropdown_mm2vez5a",

  callReferenceNotes: "long_text_mm2ffsme",
  carecentrixIntakeId: "text_mm2wnhx",
  callFaxNumber: "text_mm2yd7st",

  // Per-product auth result columns
  authResult: {
    monitor: "color_mm1wgjd1",
    sensors: "color_mm1x5c99",
    insulin_pump: "color_mm1xnzmn",
    infusion_set: "color_mm1xr2j1",
    cartridge: "color_mm1xybvt",
  },
  // Per-product auth write columns (×5 products)
  authMethod: {
    monitor: "dropdown_mm2wmhx9",
    sensors: "dropdown_mm2whrk7",
    insulin_pump: "dropdown_mm2w2k6y",
    infusion_set: "dropdown_mm2way9m",
    cartridge: "dropdown_mm2wj9ws",
  },
  authId: {
    monitor: "text_mm1w1d5p",
    sensors: "text_mm1x8tdp",
    insulin_pump: "text_mm1xmj8x",
    infusion_set: "text_mm1xf6ht",
    cartridge: "text_mm1xs6s8",
  },
  authSubmissionDate: {
    monitor: "text_mm2wmc1z",
    sensors: "text_mm2w85gd",
    insulin_pump: "text_mm2w72r6",
    infusion_set: "text_mm2wvnpx",
    cartridge: "text_mm2wth7t",
  },
  authStart: {
    monitor: "date_mm1wj1bz",
    sensors: "date_mm1x929",
    insulin_pump: "date_mm1xxbkz",
    infusion_set: "date_mm1xrk1c",
    cartridge: "date_mm1xp0vm",
  },
  authEnd: {
    monitor: "date_mm1whebp",
    sensors: "date_mm1xvnqb",
    insulin_pump: "date_mm1x2q3",
    infusion_set: "date_mm1xj3wp",
    cartridge: "date_mm1xznf9",
  },
  authUnits: {
    monitor: "numeric_mm2wjew6",
    sensors: "numeric_mm2wd6a1",
    insulin_pump: "numeric_mm2wxcjj",
    infusion_set: "numeric_mm2w2jhm",
    cartridge: "numeric_mm2w1df3",
  },

  // Debug / error logging
  joshDebug: "text_mm2w1qn4",
} as const;

export const READ_COLUMN_IDS = [
  COL.serving,
  COL.primaryInsurance,
  COL.diagnosis,
  COL.secondaryInsurance,
  COL.dob,
  COL.memberId1,
  COL.memberId2,
  COL.callReferenceNotes,
  COL.doctorName,
  COL.doctorPhone,
  COL.doctorNpi,
  COL.doctorEmail,
  COL.doctorFax,
  COL.clinicalsMethod,
  COL.clinicName,
];

/** Extended read columns for auth groups — includes auth results + universal statuses */
export const AUTH_READ_COLUMN_IDS = [
  ...READ_COLUMN_IDS,
  COL.activeNetwork,
  COL.dmeBenefits,
  COL.sos,
  COL.auth,
  // Per-product auth result (status)
  COL.authResult.monitor,
  COL.authResult.sensors,
  COL.authResult.insulin_pump,
  COL.authResult.infusion_set,
  COL.authResult.cartridge,
  // Per-product submission fields (read back for Auth Outstanding display)
  COL.authMethod.monitor,
  COL.authMethod.sensors,
  COL.authMethod.insulin_pump,
  COL.authMethod.infusion_set,
  COL.authMethod.cartridge,
  COL.authId.monitor,
  COL.authId.sensors,
  COL.authId.insulin_pump,
  COL.authId.infusion_set,
  COL.authId.cartridge,
  COL.authSubmissionDate.monitor,
  COL.authSubmissionDate.sensors,
  COL.authSubmissionDate.insulin_pump,
  COL.authSubmissionDate.infusion_set,
  COL.authSubmissionDate.cartridge,
  COL.authStart.monitor,
  COL.authStart.sensors,
  COL.authStart.insulin_pump,
  COL.authStart.infusion_set,
  COL.authStart.cartridge,
  COL.authEnd.monitor,
  COL.authEnd.sensors,
  COL.authEnd.insulin_pump,
  COL.authEnd.infusion_set,
  COL.authEnd.cartridge,
  COL.authUnits.monitor,
  COL.authUnits.sensors,
  COL.authUnits.insulin_pump,
  COL.authUnits.infusion_set,
  COL.authUnits.cartridge,
  COL.carecentrixIntakeId,
];

const AUTH_GROUP_IDS = new Set([GROUPS.submitAuth, GROUPS.authOutstanding]);

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

export async function fetchGroupItems(groupId: string = GROUPS.benefits): Promise<MondayItem[]> {
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
  const cols = AUTH_GROUP_IDS.has(groupId) ? AUTH_READ_COLUMN_IDS : READ_COLUMN_IDS;
  const data = await gql<{ boards: { items_page: { items: MondayItem[] } }[] }>(query, {
    boardId: BOARD_ID,
    cols,
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
 * Write a date column. value should be YYYY-MM-DD or empty string to clear.
 */
export async function writeDate(itemId: string, columnId: string, date: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  const val = date ? { date } : {};
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify(val),
  });
}

/**
 * Write a numeric column.
 */
export async function writeNumber(itemId: string, columnId: string, num: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify(num || ""),
  });
}

export interface MondayAsset {
  id: string;
  name: string;
  url: string;
  public_url: string;
}

/**
 * Fetch file assets for a specific item (from the Final Clinicals file column).
 */
export async function fetchItemAssets(itemId: string): Promise<MondayAsset[]> {
  const query = `
    query ($boardId: ID!, $itemId: ID!) {
      boards(ids: [$boardId]) {
        items_page(limit: 1, query_params: { ids: [$itemId] }) {
          items {
            assets(assets_source: all) { id name url public_url }
          }
        }
      }
    }
  `;
  const data = await gql<{
    boards: { items_page: { items: { assets: MondayAsset[] }[] } }[];
  }>(query, {
    boardId: BOARD_ID,
    itemId,
  });
  return data.boards?.[0]?.items_page?.items?.[0]?.assets ?? [];
}
