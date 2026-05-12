// Monday.com GraphQL client for Final Profile Confirmation role.
// Same board as Welcome Call, different group.

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-10";

export const BOARD_ID = 18410804557;

export const GROUPS = {
  finalProfileConfirmation: "group_mm2x8jtj",
  escalation: "group_mm1x5c0",
} as const;

// Column IDs for the fields this role reads + edits
export const COL = {
  // Demographics (editable)
  dob: "text_mm1xvxst",
  phone: "phone_mm1x44yk",
  email: "text_mm1xc140",
  address: "location_mm1xhw17",
  gender: "color_mm1x1bdg",

  // Insurance (editable)
  primaryInsurance: "color_mm1x157j",
  memberId1: "text_mm1x2qk2",
  secondaryInsurance: "color_mm241kqp",
  memberId2: "text_mm1xaccx",
  deductible: "text_mm1xkbqc",
  deductibleRemaining: "text_mm1xdzxw",
  oopMax: "text_mm1xdtj7",
  oopMaxRemaining: "text_mm1xx5f",

  // Doctor (read-only display)
  doctorName: "text_mm1x46et",
  doctorNpi: "text_mm1x7d91",
  doctorPhone: "phone_mm1xz8c0",
  doctorEmail: "email_mm1x6fq5",
  doctorFax: "email_mm1xdzcj",
  clinicName: "dropdown_mm1xbvas",
  clinicalsMethod: "color_mm1xw7y5",

  // Medical Necessity (read-only display)
  diagnosis: "color_mm1wf7rv",
  cgmCoveragePath: "color_mm2wsam4",
  ipCoveragePath: "color_mm2xtn41",
  mrExpiryDate: "date_mm1ymthz",

  // Product / Referral (read-only display)
  serving: "color_mm1w1cm9",
  pumpType: "color_mm1wjjtk",
  cgmType: "color_mm1w7pmf",
  requestType: "color_mm1w1978",
  referralType: "color_mm1wm4n4",
  referralSource: "color_mm1w5wxr",

  // Welcome Call / Order (editable)
  subscriptionType: "color_mm1xbqth",
  infusionSet1: "color_mm1x9paw",
  qtyInf1: "numeric_mm1xv7wr",
  infusionSet2: "color_mm1xekaz",
  qtyInf2: "numeric_mm1xkq3b",
  monitorQty: "numeric_mm1xyfhc",
  pumpQty: "numeric_mm1xa0z2",
  orderHandling: "color_mm2776fg",

  // Auth Results
  cgmAuthResult: "color_mm1wgjd1",
  sensorsAuthResult: "color_mm1x5c99",
  ipAuthResult: "color_mm1xnzmn",
  infusionSetAuthResult: "color_mm1xr2j1",
  cartridgeAuthResult: "color_mm1xybvt",

  // Auth Details (read-only — ID, Start, End, Units per product)
  authDetail: {
    monitor:      { id: "text_mm1w1d5p",    start: "date_mm1wj1bz",  end: "date_mm1whebp",  units: "numeric_mm2w5jdp" },
    sensors:      { id: "text_mm1x8tdp",    start: "date_mm1x929",   end: "date_mm1xvnqb",  units: "numeric_mm2wgfrb" },
    insulin_pump: { id: "text_mm1xmj8x",    start: "date_mm1xxbkz",  end: "date_mm1x2q3",   units: "numeric_mm2wayp9" },
    infusion_set: { id: "text_mm1xf6ht",    start: "date_mm1xrk1c",  end: "date_mm1xj3wp",  units: "numeric_mm2wh4ph" },
    cartridge:    { id: "text_mm1xs6s8",    start: "date_mm1xp0vm",  end: "date_mm1xznf9",  units: "numeric_mm2wcgkc" },
  },

  // Notes (editable — append)
  notes: "long_text_mm2ffsme",

  // Stage/Escalation
  stageAdvancer: "color_mm1ws96t",
  dateOfStageStart: "date_mm1w6jeq",
  escalation: "color_mm1x7997",
  escalationReason: "dropdown_mm2fhcd6",

  // Split flag — set on the duplicate after duplicate_item so Monday's
  // "new item created" automation can gate itself with `Split is not Split`.
  split: "color_mm381bgy",

  // Per-product Last Bill Date columns (date — populated when SoS = Not Clear)
  lastBillDate: {
    monitor: "date_mm33vqa0",
    sensors: "date_mm33jsyt",
    insulin_pump: "date_mm33kmz4",
    infusion_set: "date_mm33mw14",
    cartridge: "date_mm33rd8n",
  },

  // Calculated Next Order Date columns (read-only display)
  nextOrderDate: {
    insulin_pump: "date_mm356crn",
    sensors: "date_mm35bdf8",
    supplies: "date_mm351tva",
  },

  // Debug
  joshDebug: "text_mm35b391",
} as const;

export const READ_COLUMN_IDS = [
  COL.dob, COL.phone, COL.email, COL.address, COL.gender,
  COL.primaryInsurance, COL.memberId1, COL.secondaryInsurance, COL.memberId2,
  COL.deductible, COL.deductibleRemaining, COL.oopMax, COL.oopMaxRemaining,
  COL.doctorName, COL.doctorNpi, COL.doctorPhone, COL.doctorEmail,
  COL.doctorFax, COL.clinicName, COL.clinicalsMethod,
  COL.diagnosis, COL.cgmCoveragePath, COL.ipCoveragePath, COL.mrExpiryDate,
  COL.serving, COL.pumpType, COL.cgmType, COL.requestType,
  COL.referralType, COL.referralSource,
  COL.subscriptionType, COL.infusionSet1, COL.qtyInf1,
  COL.infusionSet2, COL.qtyInf2, COL.monitorQty, COL.pumpQty,
  COL.orderHandling,
  COL.cgmAuthResult, COL.sensorsAuthResult, COL.ipAuthResult,
  COL.infusionSetAuthResult, COL.cartridgeAuthResult,
  // Auth details (ID, start, end, units)
  COL.authDetail.monitor.id, COL.authDetail.monitor.start, COL.authDetail.monitor.end, COL.authDetail.monitor.units,
  COL.authDetail.sensors.id, COL.authDetail.sensors.start, COL.authDetail.sensors.end, COL.authDetail.sensors.units,
  COL.authDetail.insulin_pump.id, COL.authDetail.insulin_pump.start, COL.authDetail.insulin_pump.end, COL.authDetail.insulin_pump.units,
  COL.authDetail.infusion_set.id, COL.authDetail.infusion_set.start, COL.authDetail.infusion_set.end, COL.authDetail.infusion_set.units,
  COL.authDetail.cartridge.id, COL.authDetail.cartridge.start, COL.authDetail.cartridge.end, COL.authDetail.cartridge.units,
  COL.notes,
  COL.lastBillDate.monitor, COL.lastBillDate.sensors, COL.lastBillDate.insulin_pump,
  COL.lastBillDate.infusion_set, COL.lastBillDate.cartridge,
  COL.nextOrderDate.insulin_pump, COL.nextOrderDate.sensors, COL.nextOrderDate.supplies,
  COL.dateOfStageStart,
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
  groupId: string = GROUPS.finalProfileConfirmation,
  onMore?: (items: MondayItem[]) => void,
): Promise<MondayItem[]> {
  const PAGE = 200;
  const query = `
    query ($boardId: ID!, $cols: [String!]) {
      boards(ids: [$boardId]) {
        items_page(limit: ${PAGE}, query_params: { rules: [{ column_id: "group", compare_value: ${JSON.stringify([groupId])} }] }) {
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

  if (cursor && onMore) {
    (async () => {
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
          if (items.length > 0) onMore(items);
        } catch (e) { console.error("[fetchGroupItems] pagination error", e); break; }
      }
    })();
  }

  return firstPage;
}

/**
 * Write a status column by index.
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
 * Write a number column. Pass `""` (empty string) to clear the cell on Monday
 * (which is distinct from writing 0 — automations gated on "is empty" only
 * fire for cleared cells, not for cells holding 0).
 */
export async function writeNumber(itemId: string, columnId: string, num: number | ""): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: num === "" ? JSON.stringify("") : JSON.stringify(String(num)),
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
 * Write a date column (YYYY-MM-DD string, or "" to clear).
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
    value: date ? JSON.stringify({ date }) : JSON.stringify({}),
  });
}

/**
 * Rename an item. Monday's "name" column requires `change_simple_column_value`
 * with a plain string — `change_column_value` with JSON-stringified values
 * silently no-ops on the name column.
 */
export async function renameItem(itemId: string, name: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $value: String!) {
      change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: "name", value: $value) { id name }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    value: name,
  });
}

/**
 * Duplicate an item on the same board. Returns the new item's id.
 * Used by the Split Order feature to clone a patient into a second
 * profile that the user can edit independently before submitting.
 *
 * Monday's duplicate_item appends "(copy)" to the new item's name; if
 * `keepOriginalName` is provided, we rename it back immediately so the
 * sidebar shows two identical names.
 */
export async function duplicateItem(itemId: string, keepOriginalName?: string): Promise<string> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!) {
      duplicate_item(board_id: $boardId, item_id: $itemId, with_updates: false) { id name }
    }
  `;
  const data = await gql<{ duplicate_item: { id: string; name: string } }>(query, {
    boardId: BOARD_ID,
    itemId,
  });
  const newId = data.duplicate_item.id;
  if (keepOriginalName && data.duplicate_item.name !== keepOriginalName) {
    await renameItem(newId, keepOriginalName);
  }
  return newId;
}

// ── Files / Assets ───────────────────────────────────────────────────

export interface MondayAsset {
  id: string;
  name: string;
  url: string;
  public_url: string;
}

/** Fetch every file asset attached to a board item. */
export async function fetchItemAssets(itemId: string): Promise<MondayAsset[]> {
  const query = `
    query ($boardId: ID!, $itemId: ID!) {
      boards(ids: [$boardId]) {
        items_page(limit: ${PAGE}, query_params: { ids: [$itemId] }) {
          cursor
          items {
            assets(assets_source: all) { id name url public_url }
          }
        }
      }
    }
  `;
  const data = await gql<{
    boards: { items_page: { items: { assets: MondayAsset[] }[] } }[];
  }>(query, { boardId: BOARD_ID, itemId });
  return data.boards?.[0]?.items_page?.items?.[0]?.assets ?? [];
}

/**
 * Move item to the Escalation group.
 */
export async function moveToEscalation(itemId: string): Promise<void> {
  const query = `
    mutation ($itemId: ID!, $groupId: String!) {
      move_item_to_group(item_id: $itemId, group_id: $groupId) { id }
    }
  `;
  await gql(query, {
    itemId,
    groupId: GROUPS.escalation,
  });
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
