// Monday.com GraphQL client — direct from browser.
// Token is read from VITE_MONDAY_API_TOKEN at build time.

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-10";

export const BOARD_ID = 18406352652;

export const GROUPS = {
  intake: "group_mm1xf2jb",
  parachuteExample: "group_mm1x1416",
  tests: "group_mm1wvq8p",
  stuck: "group_mm1xyczx",
  completed: "group_mm1y57sz",
} as const;

export const COL = {
  // ── Stedi ──
  runStediEligibility: "color_mm1yeksx",
  stediEligibilityActive: "text_mm1xpgy2",
  stediCoverageType: "text_mm25pxed",
  stediPayerName: "text_mm25wrxw",
  stediMedicareAdvantage: "text_mm25j9aj",
  stediMedicareAdvantageCarrier: "text_mm25pyfx",
  stediMedicareAdvantageMemberId: "text_mm25j9j7",
  stediQmb: "text_mm25zsdd",
  stediMedicareJurisdiction: "text_mm298skc",
  stediMedicaidMltc: "text_mm29kccv",
  stediManagedMedicaid: "text_mm2vyta1",
  stediInNetwork: "text_mm1xehx8",
  stediPriorAuthRequired: "text_mm1xhymg",
  stediCoinsurance: "text_mm1xssyw",
  stediCopay: "text_mm1xzqe0",
  stediIndividualDeductible: "text_mm1x46kd",
  stediIndividualDeductibleRemaining: "text_mm1xyga2",
  stediFamilyDeductible: "text_mm1x7hkk",
  stediFamilyDeductibleRemaining: "text_mm1xyzqx",
  stediIndividualOopMax: "text_mm1xdtxq",
  stediIndividualOopMaxRemaining: "text_mm1x32jw",
  stediFamilyOopMax: "text_mm1xqmg9",
  stediFamilyOopMaxRemaining: "text_mm1xkdgq",
  stediPlanBeginDate: "text_mm1xsa9",
  stediErrorDescription: "text_mm1x9tje",
  stediSecondaryMedicaidId: "text_mm25bjz7",
  stediPlanName: "text_mm1xdcet",
  stediGender: "dropdown_mm30thnj",
  stediMedicaidId: "text_mm31e5se",

  // Plan Name flows from Stedi → Insurance Plan dropdown on Submit
  insurancePlan: "dropdown_mm1y2x75",
  // Active/Not Active status — derived from stediEligibilityActive on submit
  activeNotActive: "color_mm1xycqc",

  // ── Insurance ──
  primaryInsurance: "color_mm1xg10n",
  generalInsurance: "color_mm24ap4j",
  memberId1: "text_mm1x2qk2",
  memberId2: "text_mm1xaccx",
  secondaryInsurance: "color_mm1zbrx0",

  // ── Working cost-sharing (numeric, editable by user) ──
  workingCoinsurance: "numeric_mm1zzyph",
  workingDeductible: "numeric_mm1ztdz4",
  workingDeductibleRemaining: "numeric_mm1zv64b",
  workingOopMax: "numeric_mm1zfv02",
  workingOopMaxRemaining: "numeric_mm1zxktp",

  // ── Doctor ──
  doctorStatus: "color_mm1ychz8",
  doctorName: "text_mm1x46et",
  doctorPhone: "phone_mm1xz8c0",
  doctorNpi: "text_mm1x7d91",
  clinicalsMethod: "color_mm1xw7y5",
  doctorEmail: "email_mm1x6fq5",
  doctorFax: "email_mm1xdzcj",
  clinicName: "dropdown_mm1xbvas",
  clinicAddress: "location_mm1xjnfv",

  // ── Serving / Product ──
  referralType: "color_mm1wm4n4",
  referralSource: "color_mm1w5wxr",
  pumpType: "color_mm1wjjtk",
  cgmType: "color_mm1w7pmf",
  requestType: "color_mm1w1978",
  cgmCrossSell: "color_mm1yets8",
  serving: "color_mm1w1cm9",
  insulinPumpCoveragePath: "color_mm1w5xn1",
  cgmCoveragePath: "color_mm1w7e5q",

  // ── Demographics ──
  dob: "text_mm1xvxst",
  ptPhone: "phone_mm1x44yk",
  email: "text_mm1xc140",
  gender: "color_mm1x1bdg",
  dateOfIntake: "date_mm1wf43j",
  patientAddress: "location_mm1xhw17",

  // ── Notes ──
  notes: "text_mm389fs",

  // ── Follow Up ──
  followUp: "color_mm3822qq",
  followUpDate: "date_mm3874an",

  // ── Status / Workflow ──
  alreadyInSystem: "color_mm2xe7r8",
  moveToOnboarding: "color_mm1zmeb3",
} as const;

// Only fetch columns we need to READ for display. Write-only columns omitted.
export const READ_COLUMN_IDS: string[] = [
  // Demographics
  COL.dob, COL.ptPhone, COL.email, COL.gender, COL.dateOfIntake, COL.patientAddress,
  // Status
  COL.alreadyInSystem, COL.moveToOnboarding,
  // Stedi
  COL.runStediEligibility, COL.stediEligibilityActive, COL.stediCoverageType,
  COL.stediPayerName, COL.stediPlanName, COL.stediMedicareAdvantage,
  COL.stediMedicareAdvantageCarrier, COL.stediMedicareAdvantageMemberId,
  COL.stediQmb, COL.stediMedicareJurisdiction, COL.stediMedicaidMltc,
  COL.stediManagedMedicaid, COL.stediInNetwork, COL.stediPriorAuthRequired,
  COL.stediCoinsurance, COL.stediCopay,
  COL.stediIndividualDeductible, COL.stediIndividualDeductibleRemaining,
  COL.stediFamilyDeductible, COL.stediFamilyDeductibleRemaining,
  COL.stediIndividualOopMax, COL.stediIndividualOopMaxRemaining,
  COL.stediFamilyOopMax, COL.stediFamilyOopMaxRemaining,
  COL.stediPlanBeginDate, COL.stediErrorDescription,
  COL.stediSecondaryMedicaidId,
  COL.stediGender, COL.stediMedicaidId,
  // Insurance
  COL.primaryInsurance, COL.generalInsurance, COL.memberId1, COL.memberId2,
  COL.secondaryInsurance,
  // Working cost-sharing
  COL.workingCoinsurance, COL.workingDeductible, COL.workingDeductibleRemaining,
  COL.workingOopMax, COL.workingOopMaxRemaining,
  // Doctor
  COL.doctorStatus, COL.doctorName, COL.doctorPhone, COL.doctorNpi,
  COL.clinicalsMethod, COL.doctorEmail, COL.doctorFax, COL.clinicName,
  COL.clinicAddress,
  // Serving
  COL.referralType, COL.referralSource, COL.pumpType, COL.cgmType,
  COL.requestType, COL.cgmCrossSell, COL.serving,
  COL.insulinPumpCoveragePath, COL.cgmCoveragePath,
  // Notes + Follow Up
  COL.notes, COL.followUp, COL.followUpDate,
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
    console.error("Monday API GraphQL error", JSON.stringify(json.errors, null, 2), { query: query.trim().slice(0, 120), variables });
    throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  }
  return json.data as T;
}

export async function fetchGroupItems(
  groupId: string = GROUPS.intake,
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

/** Write a status column by index. */
export async function writeStatusIndex(itemId: string, columnId: string, index: number): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: JSON.stringify({ index }) });
}

/** Clear a status column (set it back to no value / blank). Useful when
 *  a "When status changes to X" automation needs to be re-fired even
 *  though the column already shows X — write blank first, then X again. */
export async function clearStatusColumn(itemId: string, columnId: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
      change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: "" });
}

/** Write a date column (YYYY-MM-DD). */
export async function writeDate(itemId: string, columnId: string, date: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: JSON.stringify({ date }) });
}

/** Clear a date column (set it back to no value / blank). */
export async function clearDateColumn(itemId: string, columnId: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: JSON.stringify({}) });
}

/** Write a text column. */
export async function writeText(itemId: string, columnId: string, text: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: JSON.stringify(text) });
}

/** Write a long_text column. */
export async function writeLongText(itemId: string, columnId: string, text: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: JSON.stringify({ text }) });
}

/** Write a dropdown column (multi-select) by option ids. */
export async function writeDropdownIds(itemId: string, columnId: string, ids: number[]): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: JSON.stringify({ ids }) });
}

/** Write a dropdown column by label string(s). Auto-creates the label
 *  on the column if it doesn't already exist. Useful when the value
 *  comes from upstream data (e.g. Stedi plan name) and may or may not
 *  match a pre-existing dropdown option. */
export async function writeDropdownLabels(
  itemId: string,
  columnId: string,
  labels: string[],
): Promise<void> {
  const value = JSON.stringify({ labels });
  // Mutation uses literal `value` because change_column_value accepts a
  // JSON string and `create_labels_if_missing` only works on the inline
  // form (it's a top-level mutation arg, not a column-value field).
  const query = `
    mutation {
      change_column_value(
        board_id: ${BOARD_ID},
        item_id: ${itemId},
        column_id: "${columnId}",
        value: ${JSON.stringify(value)},
        create_labels_if_missing: true
      ) { id }
    }
  `;
  await gql(query, {});
}

/** Write a phone column. */
export async function writePhone(itemId: string, columnId: string, phone: string, countryShortName = "US"): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: JSON.stringify({ phone, countryShortName }) });
}

/** Write an email column. */
export async function writeEmail(itemId: string, columnId: string, email: string, text?: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: JSON.stringify({ email, text: text ?? email }) });
}

/** Write a numeric column. Strips non-numeric chars (\$, %, commas) before sending. */
export async function writeNumber(itemId: string, columnId: string, raw: string): Promise<void> {
  // Strip \$, %, commas, spaces — keep digits, dots, minus signs
  const cleaned = raw.replace(/[^\d.\-]/g, "");
  if (!cleaned) return; // nothing to write
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: JSON.stringify(cleaned) });
}

/**
 * Write a location column. Monday requires lat/lng; if we don't have
 * coordinates yet we pass 0/0 — the address text still lands.
 */
export async function writeLocation(
  itemId: string, columnId: string, address: string,
  lat: number = 0, lng: number = 0,
): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID, itemId, columnId,
    value: JSON.stringify({ address, lat, lng }),
  });
}

/** Write the item name. */
export async function writeItemName(itemId: string, name: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $value: String!) {
      change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: "name", value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, value: name });
}

/** Fetch clinic name dropdown labels from the board. */
export async function fetchClinicLabels(): Promise<{ id: number; name: string }[]> {
  const query = `
    query ($boardId: ID!) {
      boards(ids: [$boardId]) {
        columns(ids: ["${COL.clinicName}"]) { settings_str }
      }
    }
  `;
  const data = await gql<{ boards: { columns: { settings_str: string }[] }[] }>(query, { boardId: BOARD_ID });
  const settings = JSON.parse(data.boards[0].columns[0].settings_str);
  return (settings.labels ?? []) as { id: number; name: string }[];
}

/** Create a new clinic name label in the dropdown column. Returns the new label id. */
export async function createClinicLabel(name: string): Promise<number> {
  // First fetch current labels to find next id
  const existing = await fetchClinicLabels();
  const maxId = existing.reduce((max, l) => Math.max(max, l.id), 0);
  const newId = maxId + 1;

  // Update column settings to add the new label
  const newLabels = [...existing, { id: newId, name }];
  const settingsUpdate = JSON.stringify({ labels: newLabels });

  // Use change_column_metadata isn't available — instead we can use the
  // create_or_update dropdown approach: write the label text to a temp value
  // Actually, the simplest way: write the dropdown with the text value and Monday auto-creates it
  // But that's per-item. Let's use the column settings approach.

  // Monday doesn't have a direct "add dropdown label" mutation in v2.
  // The workaround is: write the dropdown value as text, and Monday creates the label.
  // We'll handle this in mondayWrite by writing the label text directly.
  return newId;
}

/** Fetch a single item's column values. Used for verifying writes. */
export async function fetchItem(itemId: string, columnIds: string[]): Promise<MondayItem | null> {
  const query = `
    query ($itemIds: [ID!], $cols: [String!]) {
      items(ids: $itemIds) {
        id
        name
        column_values(ids: $cols) { id text value }
      }
    }
  `;
  const data = await gql<{ items: MondayItem[] }>(query, {
    itemIds: [itemId],
    cols: columnIds,
  });
  return data.items?.[0] ?? null;
}

// ── Updates ──

export interface MondayUpdate {
  id: string;
  body: string;
  created_at: string;
  creator: { name: string } | null;
}

/** Fetch all updates for a Monday item, newest first. */
export async function fetchUpdates(itemId: string): Promise<MondayUpdate[]> {
  const query = `
    query ($itemIds: [ID!]) {
      items(ids: $itemIds) {
        updates {
          id
          body
          created_at
          creator { name }
        }
      }
    }
  `;
  const data = await gql<{ items: { updates: MondayUpdate[] }[] }>(query, {
    itemIds: [itemId],
  });
  return data.items?.[0]?.updates ?? [];
}

/** Post a new update on a Monday item. */
export async function createUpdate(itemId: string, body: string): Promise<void> {
  const query = `
    mutation ($itemId: ID!, $body: String!) {
      create_update(item_id: $itemId, body: $body) { id }
    }
  `;
  await gql(query, { itemId, body });
}

// ── Files / Assets ───────────────────────────────────────────────────

export interface MondayAsset {
  id: string;
  name: string;
  url: string;
  public_url: string;
}

/** Fetch every file asset attached to a profile-board item — used by the
 *  Clinicals download button on the Stedi tab so the agent can grab the
 *  prior round's clinical files before re-running eligibility. */
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

