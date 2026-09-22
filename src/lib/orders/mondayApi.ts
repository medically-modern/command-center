/**
 * Monday.com GraphQL client for the order board — the `orders` role.
 * Board 18405457690 — "New Order Board (No sub-items)" on monday.
 *
 * ── What this board IS (read the whole chain before touching a write) ──
 * One item = ONE ORDER, not one patient — a patient has an item per order, so
 * the same name appears once per reorder. Items are created by the Welcome
 * Call board's four order-creation automations (§5.22b) and by the reorder
 * flow, then a create-item workflow (7917933994) stamps Order Date = today and
 * **Order Status = "Order"**. From there the board is driven by machines:
 *
 *   Order Status "Order"   → a human flips it to "Ordered" on the board (the
 *                            one manual step — 116 flips in the week of 9/8)
 *   "Ordered"              → webhook 595100182 hands the item to
 *                            cardinal-api-poller, which submits it to Cardinal
 *                            and writes API Status, CAH Order Number, PO
 *                            Number, the raw request/response, holds…
 *                          → workflow 7921060784 flips Order Status straight
 *                            on to "Process Claim", so "Ordered" is TRANSIENT
 *   "Process Claim"        → workflow 7920451241 moves the item to
 *                            Accepted / Partial unless API Status is already
 *                            SHIPPED/Delivered, in which case 7919401900 moves
 *                            it to Shipped/Delivered
 *   API Status → SHIPPED   → workflow 7920451305 moves Accepted / Partial →
 *                            Shipped/Delivered (⚠️ SHIPPED only, so an order
 *                            that goes Partially Shipped → Delivered stays in
 *                            Accepted / Partial: 11 live rows do)
 *   "On Hold"              → a snooze: workflow 7919939752 flips it back to
 *                            "Order" at 8:15 AM ET on the day Order Date arrives
 *   Returns / Cancelled    → moved by hand; no automation
 *
 * ⚠️ THE GROUP IS THEREFORE NOT A RELIABLE STAGE MARKER — API Status is the
 * freshest truth about a placed order (`workflow.ts` `orderStage` reads it
 * first). 609 pre-poller orders in Shipped/Delivered carry no API Status at
 * all, which is "delivered before we had a Cardinal record", not "in progress".
 *
 * This role is READ-ONLY for now (Josh, 2026-09-15): reps observe orders here
 * and still place them on the board. The one write this slice knows how to
 * make — the "Ordered" flip — sits dark behind `config.ORDERING_FROM_COMMAND_CENTER`.
 */

import {
  MONDAY_API_URL,
  hasMondayAuth,
  mondayAuthHeaders,
  mondayIdentityHeaders,
} from "../shared/mondayEndpoint";

const MONDAY_API_VERSION = "2024-10";

export const BOARD_ID = 18405457690;

export const GROUPS = {
  order: "group_mm18v6n3",
  returns: "group_mm60y5j7",
  acceptedPartial: "group_mm52gfr5",
  shippedDelivered: "group_mm20m7gz",
  cancelled: "group_mm77bjja",
} as const;

export const GROUP_TITLES: Record<string, string> = {
  [GROUPS.order]: "Order",
  [GROUPS.returns]: "Returns",
  [GROUPS.acceptedPartial]: "Accepted / Partial",
  [GROUPS.shippedDelivered]: "Shipped/Delivered",
  [GROUPS.cancelled]: "Cancelled",
};

/**
 * Order Status label ids (`status`), read back from `settings_str` 2026-09-15.
 * Index, never text, for the one write this slice can make: a write to a label
 * id the column does not have is dropped at HTTP 200 (§5.12/§5.20/§5.31c).
 */
export const ORDER_STATUS_INDEX = {
  order: 0,
  ordered: 1,
  stuck: 2,
  onHold: 3,
  processClaim: 4,
  paidCash: 6,
  returnInProgress: 7,
  returnComplete: 8,
} as const;

// ── Column IDs — the contract (§3). Titles beside each id are the board's own. ──

export const COL = {
  // Order lifecycle
  orderStatus: "status",                 // Order Status
  apiStatus: "color_mm3zm9hm",           // API Status (written by cardinal-api-poller)
  orderDate: "date_mm1ssf5g",            // Order Date (also the On Hold return date)
  orderType: "color_mm1s96z2",           // Order Type — First Order / Reorder
  subscriptionType: "color_mm18h05q",    // Subscription Type — Sensors / Sensors & Supplies / Supplies
  shipMethod: "color_mm3zsyhm",          // Ship Method
  ddpOrder: "color_mm5pn3k1",            // DDP Order
  pos: "color_mm3rfpkt",                 // POS — Office / Home
  preCheck: "color_mm5bh2az",            // Pre-Check (advisory, auto-written)
  preCheckDetail: "long_text_mm5byhdp",  // Pre-Check Detail
  notes: "long_text_mm60y0ap",           // Notes
  orderFrequency: "color_mm1s8tz0",      // Order Frequency
  referralStatus: "color_mm1seak5",      // Referral (Working on it / Done / Stuck)
  referralFlag: "color_mm5233h3",        // Referral? (Yes)

  // Availability (auto-written by the daily Cardinal availability check)
  backordered: "dropdown_mm4wdmdd",      // Backordered — products out of stock at Cardinal
  inactiveProducts: "dropdown_mm4waxqn", // Inactive — products not for sale at Cardinal
  backorderedQty: "numeric_mm3zyqz4",    // Backordered Qty
  substituteInfusionSet: "color_mm727jnp", // Substitute Infusion Set (rep's pick → emails Cardinal)
  substitutionStatus: "color_mm727p5m",  // Substitution Status (written by email-service)
  substitutionCahNumber: "text_mm5xc3zg", // Substitution CAH Number

  // Products & quantities
  cgmType: "color_mm1sjy4y",             // CGM Type
  qtySensors: "numeric_mm1s49bj",        // Qty: CGM Sensors
  qtyMonitor: "numeric_mm1s431c",        // Qty: CGM Monitor
  pumpType: "color_mm1s45wm",            // Insulin Pump Type
  qtyPump: "numeric_mm1smjyx",           // Qty: Pump
  infusionSet1: "color_mm1saxyg",        // Infusion Set Type 1
  qtyInfusionSet1: "numeric_mm1shc1v",   // Qty: Infusion Set 1
  infusionSet2: "color_mm1sp64",         // Infusion Set Type 2
  qtyInfusionSet2: "numeric_mm1svn8d",   // Qty: Infusion Set 2
  cartridgeType: "color_mm1szdck",       // Cartridge Type
  qtyCartridge: "numeric_mm1s9qxd",      // Qty: Cartridge

  // Auth IDs per product
  monitorAuthId: "text_mm1snsw3",
  sensorsAuthId: "text_mm28c4xs",
  pumpAuthId: "text_mm28nex8",
  infusionSetAuthId: "text_mm281vjp",
  cartridgesAuthId: "text_mm28kdfj",

  // Patient
  dob: "text_mm187t6a",
  gender: "color_mm1svmyk",
  phone: "phone_mm18rr9v",               // Primary Phone
  email: "email_mm3z2ajd",               // Customer Email
  address: "location_mm187v29",          // Patient Address
  customerId: "pulse_id_mm18spqf",       // Customer ID (= item id)
  snfHospice: "dropdown_mm46vx11",       // SNF/Hospice/Hospital

  // Coverage
  primaryInsurance: "color_mm18jhq5",
  memberId: "text_mm18s3fe",
  secondaryInsurance: "color_mm18h6yn",
  secondaryId: "text_mm18c6z4",
  otherPayerId: "text_mm3zyqdj",
  diagnosisCode: "dropdown_mm7dds6y",
  cgmCoverage: "color_mm18ds28",
  medicarePriorPumpDate: "text_mm584phh",

  // Doctor
  doctorName: "text_mm18w2y4",
  doctorNpi: "text_mm18x1kj",
  doctorAddress: "location_mm18qfed",
  doctorPhone: "phone_mm18t5ct",
  doctorFax: "phone_mm3zs5dg",           // ⚠️ a PHONE column here, unlike the email-typed Doctor Fax elsewhere

  // Cardinal — order identity + narrative (all machine-written)
  cahOrderNumber: "text_mm3z47x2",       // CAH Order Number
  poNumber: "text_mm3zf5ev",             // PO Number (MM-<item>-<yyyymmdd>)
  lastCardinalSync: "text_mm481jys",     // Last Cardinal Sync (ET stamp)
  apiMessage: "text_mm3zcde7",           // API Message (Cardinal's sentence)
  holdReason: "text_mm486hh7",           // Hold Reason
  uspsCheck: "text_mm4ds1hw",            // USPS Check (informational)
  lineItemDetail: "long_text_mm489t0z",  // Line Item Detail
  orderDiscrepancy: "text_mm4czd9g",

  // Shipping & delivery (written by the Cardinal order-status poll)
  warehouse: "text_mm3zaepp",
  carrier: "text_mm3za3mt",
  carrierDescription: "text_mm4cyzd3",
  estimatedShipDate: "date_mm3zyb66",
  shipDate: "date_mm3zvmqq",
  tracking1: "text_mm3z39yt",
  tracking2: "text_mm4cd2zq",
  tracking3: "text_mm4cxcsc",
  tracking4: "text_mm5rwpdb",
  tracking5: "text_mm5r8yv8",
  packageWeight: "text_mm4cym7",
  serialNumbers: "long_text_mm4c86p0",
  deliveryDate: "date_mm3z9258",
  signedBy: "text_mm3zpppq",
  confirmedDeliveryAddress: "text_mm4cm2d6",
  shipTextLog: "text_mm5jedj2",          // shipping texts sent to the patient
  deliveryCheckinText: "text_mm72pa1b",  // first-order delivery check-in text

  // Billing
  invoiceNumber: "text_mm3z3vc1",
  invoiceDate: "date_mm4czm9y",
  invoiceDueDate: "date_mm3zhxq0",
  invoiceAmount: "numeric_mm3zh1wx",
  invoiceSubtotal: "numeric_mm4cx7e",
  salesTax: "numeric_mm4cew2k",
  shippingHandling: "numeric_mm4c3afm",
  freightFee: "numeric_mm4c9wez",
  paymentTerms: "text_mm4cp772",
  superbillBatch: "text_mm5b2pf7",

  // Documents (file columns)
  podSignature: "file_mm4cwya2",
  podPdf: "file_mm4cfc8m",
  fedexPod: "file_mm5qnz3t",
  invoicePdf: "file_mm4cgvg6",
  superbillPdf: "file_mm4cxbwj",
  packingSlipPdf: "file_mm4c9t9",
  deliveryRecordPdf: "file_mm513zfe",
} as const;

/** The file columns a detail read resolves into viewable assets, with the
 *  label each renders under. */
export const FILE_COLUMNS: { id: string; label: string }[] = [
  { id: COL.podSignature, label: "POD signature" },
  { id: COL.podPdf, label: "POD PDF" },
  { id: COL.fedexPod, label: "FedEx proof of delivery" },
  { id: COL.deliveryRecordPdf, label: "Delivery record" },
  { id: COL.packingSlipPdf, label: "Packing slip" },
  { id: COL.invoicePdf, label: "Invoice" },
  { id: COL.superbillPdf, label: "Superbill" },
];

/**
 * The slim column set the ORDER LIST is read with — every row the sidebar,
 * the overview and the SKU tracker's "open orders" count render from, and
 * nothing more (§5.25's two-tier shape). The board holds ~1,480 orders and
 * grows by ~100 a month; at ~30 columns a 60-second poll is ~45k column
 * values, against the 194k-per-15s that took every role down in August.
 *
 * ⚠️ A field read by a sidebar row but missing here does not error — it reads
 * "" on every row, for ever. `listColumns.test.ts` scans the row sources.
 */
export const LIST_COLUMN_IDS: string[] = [
  COL.orderStatus, COL.apiStatus, COL.orderDate, COL.orderType, COL.subscriptionType,
  COL.shipMethod, COL.preCheck,
  COL.phone,
  COL.cahOrderNumber, COL.poNumber,
  // apiMessage rides with holdReason so a LIST row and the OPEN order reach
  // the same Cardinal verdict (`cardinalStatus` reads all three) — the sidebar
  // must never call an order fine that the detail pane calls held.
  COL.holdReason, COL.apiMessage, COL.backordered, COL.inactiveProducts, COL.substitutionStatus,
  COL.estimatedShipDate, COL.shipDate, COL.deliveryDate, COL.carrier,
  // All five tracking columns: a rep pasting a second package's number into
  // the search must still find the order.
  COL.tracking1, COL.tracking2, COL.tracking3, COL.tracking4, COL.tracking5,
  COL.cgmType, COL.qtySensors, COL.qtyMonitor,
  COL.pumpType, COL.qtyPump,
  COL.infusionSet1, COL.qtyInfusionSet1, COL.infusionSet2, COL.qtyInfusionSet2,
  COL.cartridgeType, COL.qtyCartridge,
];

/** Everything an open order renders — every mapped column except the two
 *  divider columns and the subitems column, which carry nothing. */
export const DETAIL_COLUMN_IDS: string[] = Object.values(COL);

// ── Types ────────────────────────────────────────────────────────────

export interface MondayColumnValue {
  id: string;
  text: string | null;
  value: string | null;
}

export interface MondayAsset {
  id: string;
  name: string;
  url: string;
  public_url: string | null;
}

export interface MondayItem {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
  group?: { id: string; title?: string };
  column_values: MondayColumnValue[];
  /** Only the DETAIL read asks for these. */
  assets?: MondayAsset[];
}

// ── Internal helpers ─────────────────────────────────────────────────

/**
 * Whether the app has a path to Monday at all. ⚠️ `hasMondayAuth()`, never a
 * bundled-token check: in production the SPA runs through the gateway and the
 * token is meant to go away (§5.1), so a `!!getToken()` gate is false in
 * exactly the deployment that matters — and it fails silently, as an empty
 * queue (§5.28).
 */
export function hasToken(): boolean {
  return hasMondayAuth();
}

async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  if (!hasMondayAuth()) throw new Error("Monday auth unavailable — no gateway URL and no API token");
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "API-Version": MONDAY_API_VERSION,
      // BOTH header sets (the `boardLabels.ts` lesson): identity alone means no
      // Authorization in direct mode, and every request 401s silently.
      ...mondayAuthHeaders(),
      ...mondayIdentityHeaders(),
    },
    body: JSON.stringify({ query, variables }),
    signal,
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("Monday API HTTP error", { status: res.status, body });
    throw new Error(`Monday request failed (${res.status})`);
  }
  const json = await res.json();
  // A 200 carrying errors[] is this app's most common silent failure (§5.2).
  if (json.errors) {
    console.error("Monday API GraphQL error", json.errors);
    throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  }
  return json.data as T;
}

// ── Public queries ───────────────────────────────────────────────────

const PAGE = 500;

export interface PageReport {
  /** Rows that arrived in this page — a count, never a position (§5.30). */
  added: number;
}

/**
 * EVERY order on the board, every group, with the slim column set. Paged at
 * Monday's 500 cap — three sequential round trips today — and reported page by
 * page so the sidebar can say how far along it is.
 *
 * ⚠️ A pagination failure THROWS rather than returning the pages it got.
 * Every other `fetchGroupItems` in this app swallows it (`catch { break }`),
 * which is why the pending-advance marker can never be spent on absence (§9):
 * a truncated list looks identical to a smaller board. Here a partial list
 * would also render the overview's counts and the SKU tracker's "open orders"
 * numbers as facts. The hook keeps the PREVIOUS list on a failed poll.
 */
export async function fetchOrders(
  onPage?: (report: PageReport) => void,
  signal?: AbortSignal,
): Promise<MondayItem[]> {
  const first = await gql<{ boards: { items_page: { cursor: string | null; items: MondayItem[] } }[] }>(
    `query ($boardId: ID!, $cols: [String!]) {
      boards(ids: [$boardId]) {
        items_page(limit: ${PAGE}) {
          cursor
          items { id name created_at group { id } column_values(ids: $cols) { id text value } }
        }
      }
    }`,
    { boardId: String(BOARD_ID), cols: LIST_COLUMN_IDS },
    signal,
  );
  const page = first.boards?.[0]?.items_page;
  const all: MondayItem[] = [...(page?.items ?? [])];
  onPage?.({ added: all.length });
  let cursor = page?.cursor ?? null;

  while (cursor) {
    const next = await gql<{ next_items_page: { cursor: string | null; items: MondayItem[] } }>(
      `query ($cursor: String!, $cols: [String!]) {
        next_items_page(limit: ${PAGE}, cursor: $cursor) {
          cursor
          items { id name created_at group { id } column_values(ids: $cols) { id text value } }
        }
      }`,
      { cursor, cols: LIST_COLUMN_IDS },
      signal,
    );
    const items = next.next_items_page?.items ?? [];
    all.push(...items);
    onPage?.({ added: items.length });
    cursor = next.next_items_page?.cursor ?? null;
  }
  return all;
}

/**
 * One order at full width, plus its assets so the file columns can be opened
 * in the viewer. `null` when Monday no longer has the item (deleted — the
 * board's human user deleted 14 in the week of 9/8).
 */
export async function fetchOrderById(itemId: string, signal?: AbortSignal): Promise<MondayItem | null> {
  const data = await gql<{ items: MondayItem[] }>(
    `query ($ids: [ID!]!, $cols: [String!]) {
      items(ids: $ids) {
        id
        name
        created_at
        updated_at
        group { id title }
        column_values(ids: $cols) { id text value }
        assets(assets_source: all) { id name url public_url }
      }
    }`,
    { ids: [itemId], cols: DETAIL_COLUMN_IDS },
    signal,
  );
  return data.items?.[0] ?? null;
}

/** Read one column's display text — the pre-write check `mondayWrite` makes. */
export async function readColumnText(itemId: string, columnId: string): Promise<string> {
  const data = await gql<{ items: { column_values: { id: string; text: string | null }[] }[] }>(
    `query ($ids: [ID!]!, $cols: [String!]) {
      items(ids: $ids) { column_values(ids: $cols) { id text } }
    }`,
    { ids: [itemId], cols: [columnId] },
  );
  return data.items?.[0]?.column_values?.[0]?.text ?? "";
}

/** Status write by LABEL ID. Only `mondayWrite.markOrdered` calls it, and that
 *  is dark until the ordering switch is flipped (`config.ts`). */
/**
 * Clear a status column. ⚠️ `{}`, never `{"index": null}` (Monday reads that as
 * an unreadable value) and never `""` — the §5.31c rule.
 */
export async function clearStatus(itemId: string, columnId: string): Promise<void> {
  await gql(
    `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }`,
    { boardId: String(BOARD_ID), itemId, columnId, value: JSON.stringify({}) },
  );
}

/**
 * The three fields the substitution watcher reads — the pick, the service's
 * verdict and the Notes receipt. One item, three columns, so a 3-second poll
 * after a send costs about as little as a Monday read can.
 */
export async function readSubstitutionState(
  itemId: string,
  signal?: AbortSignal,
): Promise<{ substitute: string; status: string; notes: string }> {
  const data = await gql<{ items: { column_values: { id: string; text: string | null }[] }[] }>(
    `query ($itemId: [ID!], $cols: [String!]) {
      items(ids: $itemId) { column_values(ids: $cols) { id text } }
    }`,
    { itemId: [itemId], cols: [COL.substituteInfusionSet, COL.substitutionStatus, COL.notes] },
    signal,
  );
  const byId = new Map((data.items?.[0]?.column_values ?? []).map((c) => [c.id, c.text ?? ""]));
  return {
    substitute: byId.get(COL.substituteInfusionSet) ?? "",
    status: byId.get(COL.substitutionStatus) ?? "",
    notes: byId.get(COL.notes) ?? "",
  };
}

export async function writeStatusIndex(itemId: string, columnId: string, index: number): Promise<void> {
  await gql(
    `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }`,
    { boardId: String(BOARD_ID), itemId, columnId, value: JSON.stringify({ index }) },
  );
}
