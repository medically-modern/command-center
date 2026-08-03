// Monday.com GraphQL client for Final Profile Confirmation role.
// Same board as Welcome Call, different group.

import { MONDAY_API_URL, mondayIdentityHeaders } from "../shared/mondayEndpoint";
import { planEmailWrite } from "../shared/emailCell";
const MONDAY_API_VERSION = "2024-10";

export const BOARD_ID = 18410804557;

export const GROUPS = {
  finalProfileConfirmation: "group_mm2x8jtj",
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
  planName: "dropdown_mm2wrzrk",
  deductible: "text_mm1xkbqc",
  deductibleRemaining: "text_mm1xdzxw",
  coInsurance: "text_mm391jq8",
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
  clinicAddress: "location_mm1xjnfv",

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
  carecentrixIntakeId: "text_mm2wnhx",

  // Welcome Call / Order (editable)
  subscriptionType: "color_mm1xbqth",
  infusionSet1: "color_mm1x9paw",
  qtyInf1: "numeric_mm1xv7wr",
  infusionSet2: "color_mm1xekaz",
  qtyInf2: "numeric_mm1xkq3b",
  /** "Qty Cartridge" (added 2026-07) — cartridge quantity, defaults to 3 in the UI. */
  qtyCartridge: "numeric_mm515sqv",
  monitorQty: "numeric_mm1xyfhc",
  pumpQty: "numeric_mm1xa0z2",
  /** "Medicare Prior Pump Date" (text) — MM/YYYY, Original-Medicare-only field. */
  medicarePriorPumpDate: "text_mm58k9x9",
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
  // Carried-forward read-only notes from earlier stages (populated by a Monday
  // automation; the SPA only reads them). Columns created 2026-07.
  profileSendOffNotes: "long_text_mm5g1txs",
  mnWorkflowNotes: "long_text_mm5gx6j6",
  insuranceNotes: "text_mm5pegde",

  // Stage/Escalation
  stageAdvancer: "color_mm1ws96t",
  dateOfStageStart: "date_mm1w6jeq",
  escalation: "color_mm1x7997",
  escalationNotes: "long_text_mm3jgh1y",
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

  // Claim Paid Amounts (read-only)
  a4230Claim: "text_mm28a3xt",
  a4232Claim: "text_mm282cy5",

  // Debug
  joshDebug: "text_mm35b391",
} as const;

export const READ_COLUMN_IDS = [
  COL.dob, COL.phone, COL.email, COL.address, COL.gender,
  COL.primaryInsurance, COL.memberId1, COL.secondaryInsurance, COL.memberId2,
  COL.planName, COL.deductible, COL.deductibleRemaining, COL.coInsurance,
  COL.oopMax, COL.oopMaxRemaining,
  COL.doctorName, COL.doctorNpi, COL.doctorPhone, COL.doctorEmail,
  COL.doctorFax, COL.clinicName, COL.clinicalsMethod, COL.clinicAddress,
  COL.diagnosis, COL.cgmCoveragePath, COL.ipCoveragePath, COL.mrExpiryDate,
  COL.serving, COL.pumpType, COL.cgmType, COL.requestType,
  COL.referralType, COL.referralSource, COL.carecentrixIntakeId,
  COL.subscriptionType, COL.infusionSet1, COL.qtyInf1,
  COL.infusionSet2, COL.qtyInf2, COL.qtyCartridge, COL.monitorQty, COL.pumpQty,
  COL.medicarePriorPumpDate,
  COL.orderHandling,
  COL.cgmAuthResult, COL.sensorsAuthResult, COL.ipAuthResult,
  COL.infusionSetAuthResult, COL.cartridgeAuthResult,
  // Auth details (ID, start, end, units)
  COL.authDetail.monitor.id, COL.authDetail.monitor.start, COL.authDetail.monitor.end, COL.authDetail.monitor.units,
  COL.authDetail.sensors.id, COL.authDetail.sensors.start, COL.authDetail.sensors.end, COL.authDetail.sensors.units,
  COL.authDetail.insulin_pump.id, COL.authDetail.insulin_pump.start, COL.authDetail.insulin_pump.end, COL.authDetail.insulin_pump.units,
  COL.authDetail.infusion_set.id, COL.authDetail.infusion_set.start, COL.authDetail.infusion_set.end, COL.authDetail.infusion_set.units,
  COL.authDetail.cartridge.id, COL.authDetail.cartridge.start, COL.authDetail.cartridge.end, COL.authDetail.cartridge.units,
  COL.notes, COL.profileSendOffNotes, COL.mnWorkflowNotes, COL.insuranceNotes,
  COL.lastBillDate.monitor, COL.lastBillDate.sensors, COL.lastBillDate.insulin_pump,
  COL.lastBillDate.infusion_set, COL.lastBillDate.cartridge,
  COL.nextOrderDate.insulin_pump, COL.nextOrderDate.sensors, COL.nextOrderDate.supplies,
  COL.dateOfStageStart,
  // Claim Paid Amounts
  COL.a4230Claim, COL.a4232Claim,
  COL.escalationNotes,
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
  groupId: string = GROUPS.finalProfileConfirmation,
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
 * Write a status column by label string.
 * When `createIfMissing` is true, Monday will auto-create the label as
 * a new permanent status if it doesn't already exist on the column.
 * Only enable this for columns where new values are expected (e.g. Diagnosis).
 */
export async function writeStatusLabel(
  itemId: string,
  columnId: string,
  label: string,
  createIfMissing = false,
): Promise<void> {
  const query = createIfMissing
    ? `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value, create_labels_if_missing: true) { id }
      }`
    : `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
      }`;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify({ label }),
  });
}

/**
 * Fetch every label string currently defined on a status column.
 * Used to populate comboboxes with live data from Monday.
 */
export async function fetchStatusLabels(columnId: string): Promise<string[]> {
  const query = `
    query ($boardId: [ID!]!) {
      boards(ids: $boardId) {
        columns(ids: ["${columnId}"]) {
          settings_str
        }
      }
    }
  `;
  const data = await gql<{
    boards: { columns: { settings_str: string }[] }[];
  }>(query, { boardId: BOARD_ID });
  const raw = data.boards?.[0]?.columns?.[0]?.settings_str ?? "{}";
  const settings = JSON.parse(raw);
  const labels: Record<string, { label?: string }> = settings.labels ?? {};
  return Object.values(labels)
    .map((v) => (typeof v === "string" ? v : v.label ?? ""))
    .filter(Boolean);
}

/**
 * Fetch every {index, label} pair currently defined on a status column.
 * Returns the full mapping so the UI can resolve indexes without a hardcoded list.
 */
export async function fetchStatusOptions(
  columnId: string,
): Promise<{ index: number; label: string }[]> {
  const query = `
    query ($boardId: [ID!]!) {
      boards(ids: $boardId) {
        columns(ids: ["${columnId}"]) {
          settings_str
        }
      }
    }
  `;
  const data = await gql<{
    boards: { columns: { settings_str: string }[] }[];
  }>(query, { boardId: BOARD_ID });
  const raw = data.boards?.[0]?.columns?.[0]?.settings_str ?? "{}";
  const settings = JSON.parse(raw);
  const labels: Record<string, string | { label?: string }> =
    settings.labels ?? {};
  return Object.entries(labels)
    .map(([key, v]) => ({
      index: Number(key),
      label: typeof v === "string" ? v : v.label ?? "",
    }))
    .filter((o) => o.label && !Number.isNaN(o.index));
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
 * Write a phone column.
 * Monday phone columns expect: {"phone": "12125551234", "countryShortName": "US"}
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
 * Write an email column.
 * Monday email columns expect: {"text": "a@b.com", "email": "a@b.com"}
 */
/** See shared/emailCell.ts — never hand Monday a value that isn't an address. */
export async function writeEmail(itemId: string, columnId: string, email: string): Promise<void> {
  const plan = planEmailWrite(email);
  if (plan.action === "skip") return;
  const clean = plan.action === "write" ? plan.email : "";
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify({ text: clean, email: clean }),
  });
}

/**
 * Write a dropdown column by option IDs.
 * Monday dropdown columns expect: {"ids": [10]}
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
        items_page(limit: 1, query_params: { ids: [$itemId] }) {
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
