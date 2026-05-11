// Monday.com GraphQL client for the Subscription Board.
// Board 18407459988 — "Subscription Board - Updated"

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-10";

export const BOARD_ID = 18407459988;

export const GROUPS = {
  subscriptions: "topics",
  notActive: "group_mkp19fyp",
} as const;

// ── Column IDs ───────────────────────────────────────────────────────

export const COL = {
  // Subscription status
  status: "color_mm2t7tdy",
  daysToOrder: "color_mkxmtv9c",
  orderingCycle: "color_mkyjawhq",
  nextOrder: "date_mkp0nvf1",
  subscription: "color_mm273mv8",
  orderType: "color_mm2w6kd",

  // Demographics
  dob: "text_mkvdefh1",
  gender: "color_mm1zgyy2",
  phone: "phone_mkp0q3cw",
  email: "email_mkp01rrw",
  address: "location_mkp0rs0v",

  // Insurance
  primaryInsurance: "color_mm254qxj",
  memberId1: "text_mkvp6zfg",
  secondaryInsurance: "color_mm25cr82",
  memberId2: "text_mm25cpx6",

  // Forecasting / Financials
  calculateFinancials: "color_mm2w74y8",
  sensorsRevenue: "numeric_mkxj6a3d",
  sensorsCost: "numeric_mkxjxmga",
  sensorsGP: "numeric_mkxjyw32",
  suppliesRevenue: "numeric_mm27rypj",
  suppliesCost: "numeric_mm27hem2",
  suppliesGP: "numeric_mm2785ag",
  totalRevenue: "numeric_mm2xsjm5",
  totalCost: "numeric_mm2xgvxx",
  shippingCost: "numeric_mm2xxmp4",
  totalGP: "numeric_mm2xvjc1",
  arr: "numeric_mm2xsqyd",
  arp: "numeric_mm2xdsvh",

  // Medical Necessity
  cgmCoverage: "color_mm2cmgqe",
  mr: "color_mktyr8xg",
  mnExpiry: "date_mkp09gra",
  diagnosis: "color_mkxrxv9w",
  mnDocs: "file_mkp0vm0a",

  // Prior Auth — Sensors
  sensorsAuthStatus: "color_mm25t997",
  sensorsAuthId: "text_mkwbkq9d",
  sensorsUnits: "numeric_mkwbzsg2",
  sensorsStartAuth: "date_mkwb4q5e",
  sensorsEndAuth: "date_mkwbvr6t",
  sensorsId2: "text_mm273kgs",

  // Prior Auth — Supplies
  suppliesAuthStatus: "color_mm27snkq",
  infusionSetAuthId: "text_mm28v64f",
  cartridgeAuthId: "text_mm255y04",
  suppliesUnits: "numeric_mm25mf8k",
  suppliesStartAuth: "date_mm25csyr",
  suppliesEndAuth: "date_mm255cs4",

  // Order Details
  sensorsType: "color_mkxmdscr",
  suppliesType: "color_mkxmnheg",
  infusionSet1: "color_mkxm50f9",
  infQty1: "numeric_mkw839ks",
  infusionSet2: "color_mkxmx5wk",
  infQty2: "numeric_mkwac234",

  // Doctor Info
  doctor: "text_mkxn3wza",
  npi: "text_mkxnkgzg",
  doctorAddress: "location_mkxnbt7y",
  doctorPhone: "phone_mkxnv7e5",
  doctorFax: "email_mkxn9af2",
  faxParachute: "color_mm25t5q",

  // Other
  orderCount: "numeric_mkxtmtsy",
  deadReason: "dropdown_mm27mdkh",
  pauseReason: "dropdown_mm2v3gfy",
  referral: "dropdown_mkwz8zp4",
  itemId: "pulse_id_mm2medsk",

  // Auth Escalation Management
  authEscalation: "color_mm2n237s",
  triggerDvs: "color_mm2narpj",
  firstDeniedDate: "date_mm2nzgeg",
  retryCount: "numeric_mm2nckkb",
  lastAttempted: "date_mm2nrrfs",
  retryNextDate: "date_mm2nffhc",
  denialReason: "long_text_mm2nf5b1",

  // Claims
  claimsStatus: "color_mm2n5rkg",
  a4232Claim: "text_mm2nfyyw",
  a4230Claim: "text_mm2nmrjt",
  claimsPaidDate: "date_mm2nr2vz",
  claimsPaidAmount: "text_mm2nxwze",
  claimsError: "text_mm2nj16f",
  claimsDenialReason: "text_mm2nvf5d",
  partialApprovalDate: "date_mm2na60z",

  // Stedi Eligibility
  stediRunCheck: "color_mm2nnjam",
  stediActive: "color_mm2nzm33",
  stediDatePlanBegin: "date_mm2n4b26",
  stediMemberId: "text_mm2phve4",
  stediPayerName: "dropdown_mm2nz3wd",
  stediPlanName: "dropdown_mm2n7ps1",
  stediDedRemaining: "numeric_mm2nkcfx",
  insuranceChange: "color_mm2p8v3m",
  priorAuthReq: "color_mm2pj23n",
  primaryClaimPaid: "color_mm33spks",
} as const;

/** Columns we fetch on every read. Curated to keep payloads lean. */
export const READ_COLUMN_IDS = [
  // Subscription meta
  COL.status, COL.daysToOrder, COL.orderingCycle, COL.nextOrder,
  COL.subscription, COL.orderType,
  // Demographics
  COL.dob, COL.gender, COL.phone, COL.email, COL.address,
  // Insurance
  COL.primaryInsurance, COL.memberId1, COL.secondaryInsurance, COL.memberId2,
  // Financials
  COL.sensorsRevenue, COL.sensorsCost, COL.sensorsGP,
  COL.suppliesRevenue, COL.suppliesCost, COL.suppliesGP,
  COL.totalRevenue, COL.totalCost, COL.shippingCost, COL.totalGP, COL.arr, COL.arp,
  // Medical Necessity
  COL.cgmCoverage, COL.mr, COL.mnExpiry, COL.diagnosis,
  // Prior Auth — Sensors
  COL.sensorsAuthStatus, COL.sensorsAuthId, COL.sensorsUnits,
  COL.sensorsStartAuth, COL.sensorsEndAuth, COL.sensorsId2,
  // Prior Auth — Supplies
  COL.suppliesAuthStatus, COL.infusionSetAuthId, COL.cartridgeAuthId,
  COL.suppliesUnits, COL.suppliesStartAuth, COL.suppliesEndAuth,
  // Order Details
  COL.sensorsType, COL.suppliesType, COL.infusionSet1, COL.infQty1,
  COL.infusionSet2, COL.infQty2,
  // Doctor
  COL.doctor, COL.npi, COL.doctorAddress, COL.doctorPhone, COL.doctorFax,
  COL.faxParachute,
  // Other
  COL.orderCount, COL.deadReason, COL.pauseReason, COL.referral,
  // Stedi
  COL.stediActive, COL.stediDedRemaining, COL.insuranceChange, COL.priorAuthReq,
  COL.primaryClaimPaid,
  // Claims
  COL.claimsStatus,
  // Denial
  COL.denialReason,
];

// ── Types ────────────────────────────────────────────────────────────

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

// ── Internal helpers ─────────────────────────────────────────────────

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

// ── Public queries ───────────────────────────────────────────────────

export async function fetchGroupItems(groupId: string = GROUPS.subscriptions): Promise<MondayItem[]> {
  const query = `
    query ($boardId: ID!, $cols: [String!]) {
      boards(ids: [$boardId]) {
        items_page(limit: 200, query_params: { rules: [{ column_id: "group", compare_value: ${JSON.stringify([groupId])} }] }) {
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

/** Fetch a single item by ID regardless of group. */
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
  const data = await gql<{ items: MondayItem[] }>(query, {
    itemId: [itemId],
    cols: READ_COLUMN_IDS,
  });
  return data.items?.[0] ?? null;
}

// ── Public mutations ─────────────────────────────────────────────────

export async function writeStatusIndex(itemId: string, columnId: string, index: number): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: JSON.stringify({ index }) });
}

export async function writeText(itemId: string, columnId: string, text: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: JSON.stringify(text) });
}

export async function writeLongText(itemId: string, columnId: string, text: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: JSON.stringify({ text }) });
}

export async function writeNumber(itemId: string, columnId: string, num: number): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: JSON.stringify(String(num)) });
}

export async function writeDate(itemId: string, columnId: string, date: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: JSON.stringify({ date }) });
}

export async function writeLocation(itemId: string, columnId: string, address: string, lat = 0, lng = 0): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: JSON.stringify({ address, lat, lng }) });
}

export async function writeDropdownIds(itemId: string, columnId: string, ids: number[]): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: JSON.stringify({ ids }) });
}

export async function clearStatusColumn(itemId: string, columnId: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: JSON.stringify({}) });
}
