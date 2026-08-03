// Monday.com GraphQL client — direct from browser.
// Token is read from VITE_MONDAY_API_TOKEN at build time.

import { MONDAY_API_URL, mondayIdentityHeaders } from "../shared/mondayEndpoint";
import { planPhoneWrite } from "../shared/phoneCell";
import { planEmailWrite } from "../shared/emailCell";
const MONDAY_API_VERSION = "2024-10";

export const BOARD_ID = 18410601299;

export const GROUPS = {
  benefits: "group_mm1xr3q3",
  submitAuth: "group_mm1x1416",
  authOutstanding: "group_mm2v6d1z",
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
  patientPhone: "phone_mm1x44yk",
  patientAddress: "location_mm1xhw17",
  pumpBrand: "color_mm1wjjtk",
  claimsStatus: "color_mm284z0b",
  memberId1: "text_mm1x2qk2",
  memberId2: "text_mm1xaccx",
  referralSource: "color_mm1w5wxr",

  // Universal write columns. In-Network? and Active? were ONE column
  // ("Active/Network", color_mm2vhwan) until Brandon split them on the board
  // 2026-07-29: color_mm2vhwan was renamed/relabelled to In-Network?
  // (1=In-Network, 2=Out-of-Network) and Active? (color_mm5q9y3, 1=Active,
  // 2=Inactive) was added. The two checks are written and read independently
  // now — the manager dashboard routes Inactive and Out-of-Network to
  // different columns, so collapsing them loses the reason.
  inNetwork: "color_mm2vhwan",
  active: "color_mm5q9y3",
  dmeBenefits: "color_mm2vt8xg",
  sos: "color_mm2vemyy",
  auth: "color_mm2vg3ew",

  // Trigger DVS (Medicaid supplies automation)
  triggerDvs: "color_mm26pk1a",

  // Trigger Pump DVS (Medicaid insulin-pump automation — separate bot system)
  triggerPumpDvs: "color_mm578kbd",

  // Follow Up
  followUp: "color_mm34jz1x",
  followUpDate: "date_mm34m2dz",

  // Escalation + stage flow
  escalation: "color_mm2vsh2f",
  escalationNotes: "long_text_mm3jrssp",
  stageAdvancer: "color_mm1ws96t",
  notClearProducts: "dropdown_mm2vez5a",
  /** Products whose SoS check was deferred at intake. Populated when an
   *  agent picks SoS = Skip on the Benefits page; products are removed
   *  from this dropdown when the recheck on Auth Outstanding resolves
   *  the SoS to Clear. Same option-id schema as notClearProducts. */
  skipSosProducts: "dropdown_mm31163t",

  callReferenceNotes: "long_text_mm2ffsme",
  carecentrixIntakeId: "text_mm2wnhx",
  callFaxNumber: "text_mm2yd7st",

  // File columns
  finalClinicals: "file_mm25m8c1",

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

  // Per-product Last Bill Date columns (date — populated when SoS = Not Clear)
  // ⚠ Date PRESENCE here encodes "Not Clear" downstream (Final Confirm derives
  // its SoS display from it) — keep the Not-Clear-only write rule (decision D2).
  lastBillDate: {
    monitor: "date_mm33h1qv",
    sensors: "date_mm332rhq",
    insulin_pump: "date_mm33qnew",
    infusion_set: "date_mm33gj86",
    cartridge: "date_mm33cd87",
  },

  // Benefits redesign (D2/D6) — per-product SoS billing FACTS. Written for
  // every billed product (even derived-Clear) so the full history lands on
  // the board without disturbing the legacy lastBillDate contract above.
  // Same-named target columns exist on the Welcome Call board; Josh maps
  // them in the Stage Advancer → Complete create-item automation (7918324247).
  sosLastBill: {
    monitor: "date_mm59tx2g",
    sensors: "date_mm59ejs2",
    insulin_pump: "date_mm59j483",
    infusion_set: "date_mm59bzfv",
    cartridge: "date_mm598y8w",
  },
  // SoS billing units — NOT auth units (authUnits above is a different concept).
  sosUnits: {
    monitor: "numeric_mm5953dt",
    sensors: "numeric_mm596xga",
    insulin_pump: "numeric_mm59pspc",
    infusion_set: "numeric_mm598cp9",
    cartridge: "numeric_mm59xp3c",
  },
  // Rep's "No Billing History" answer per product (checkbox — all payers,
  // not just the Medicare A&B rollups). Written checked/cleared on EVERY
  // Benefits send so the board always matches the current answer.
  sosNeverBilled: {
    monitor: "boolean_mm5a6haz",
    sensors: "boolean_mm5aqgra",
    insulin_pump: "boolean_mm5a1dse",
    infusion_set: "boolean_mm5a565",
    cartridge: "boolean_mm5a10fz",
  },

  // Benefits redesign (D1) — "Medicare Prior Pump Date". Benefits writes the
  // literal "TBD" when Medicare A&B + IS AND Cartridges are never-billed;
  // the Welcome Call rep later replaces it with the real date (via the
  // automation copy to WC text_mm58k9x9). Text literal only — never route a
  // parseable date string through a text hop (CLAUDE.md §9).
  medicarePriorPumpDate: "text_mm59qh8r",

  // Benefits redesign (D8) — two dedicated append-only call-log columns,
  // separate from Call Reference Notes. Compose read+append ONCE per send.
  benefitsCallLog: "long_text_mm59y5xt",
  sosAuthCallLog: "long_text_mm59rz2c",

  // Stedi output columns displayed read-only in the Benefits header (D5/S5).
  // Coverage Type / Medicaid ID do NOT exist on this board yet.
  stediQmb: "text_mm2wabwr",
  stediCoinsurance: "text_mm39k0hz",
  stediPlanBegin: "text_mm3ggbwa",
  planName: "dropdown_mm2w11t4",
  // Stedi Home Plan (added 2026-07-20) — the member's HOME plan from the
  // 271; when it differs from the BCBS-family host plan we bill, the home
  // plan handles auths (Submit Auth redesign §8).
  homePlan: "dropdown_mm5ex8wx",
  deductibleRemaining: "text_mm1xdzxw",
  oopMaxRemaining: "text_mm1xx5f",

  // Calculated Next Order Date columns (date — computed from last bill + lookback)
  nextOrderDate: {
    insulin_pump: "date_mm35aknj",   // IP Next Order Date = last bill + 4 years
    sensors: "date_mm35f5j1",         // Sensors Next Order Date = last bill + 90 days
    supplies: "date_mm35da3j",        // Supplies Next Order Date = max(infusion, cartridge) + 90d (or 60d if Medicaid)
  },

  // Never Billed attestation columns (Medicare A&B special case)
  neverBilledIsCar: "color_mm3zjyya",  // "Never billed IS/Car"
  neverBilledCgm: "color_mm3zg2pn",    // "Never billed CGM"

  // Days Since Stage Started (status — used for Auth Outstanding sorting)
  daysSinceStage: "color_mm1wwm05",

  // Days Auth Outstanding (number — days since the EARLIEST Auth Submission
  // Date across the patient's products). Maintained by the baseline-cron
  // Railway service (daily idempotent recalc, see services/baseline-cron);
  // the SPA only reads it. Real column (not a frontend derivation) so it can
  // drive board filters and future automations (e.g. auto-escalate at N days).
  daysAuthOutstanding: "numeric_mm5f5ars",

  // DVS bot output (written by automate-dvs; read-only in the SPA — the
  // /dvs monitor renders these; found on the live board 2026-07-21)
  retryCount: "numeric_mm27nexq",
  retryNextDate: "date_mm27krnc",
  a4230Claim: "text_mm28a3xt",
  a4232Claim: "text_mm282cy5",
  dvsDenialReason: "long_text_mm27hjey",
  claimsPaidAmount: "text_mm288d3h",
  claimsPaidDate: "date_mm284h2f",
  claimsDenialReason: "text_mm28xy29",
  claimsError: "text_mm28sr8y",

  // Insulin-pump claims — the board split claims into two families ("S …" for
  // supplies, "IP …" for the pump) and this half went unread until 2026-08-02.
  // Same label vocabulary as the S columns. NB `claimsStatus` above is still
  // what DvsPage's `pumpClaimPaid` consults; that stays correct only while the
  // bot leaves this column empty (no item carries a value today) — when it
  // starts writing here, that check has to move.
  ipClaimsStatus: "color_mm5g8085",
  ipClaimsPaidAmount: "text_mm5gdf21",
  ipClaimsPaidDate: "date_mm5gkz8g",
  ipClaimsDenialReason: "text_mm5g31v4",
  ipClaimsError: "text_mm5gm4vb",

  // Debug / error logging
  joshDebug: "text_mm2w1qn4",

  // Profile Send Off Notes (mirrored from Profile Send Off Board)
  profileSendOffNotes: "text_mm3xfw5a",
  // MN Workflow Notes
  mnWorkflowNotes: "text_mm3xbvss",
} as const;

export const READ_COLUMN_IDS = [
  COL.serving,
  COL.primaryInsurance,
  COL.diagnosis,
  COL.secondaryInsurance,
  COL.dob,
  COL.patientPhone,
  COL.patientAddress,
  COL.pumpBrand,
  COL.memberId1,
  COL.memberId2,
  COL.referralSource,
  COL.callReferenceNotes,
  COL.doctorName,
  COL.doctorPhone,
  COL.doctorNpi,
  COL.doctorEmail,
  COL.doctorFax,
  COL.clinicalsMethod,
  COL.clinicName,
  // Stage Advancer — needed to determine which view an escalated patient belongs to.
  COL.stageAdvancer,
  // Escalation column hydrates the Escalate-button toggle on all 3 pages.
  COL.escalation,
  COL.escalationNotes,
  // Per-product SoS state (read on every page so the agent sees what was
  // recorded on Benefits — Not Clear products and Skip-deferred products).
  COL.notClearProducts,
  COL.skipSosProducts,
  // Per-product Last Bill Date (populated when SoS = Not Clear on Benefits)
  COL.lastBillDate.monitor,
  COL.lastBillDate.sensors,
  COL.lastBillDate.insulin_pump,
  COL.lastBillDate.infusion_set,
  COL.lastBillDate.cartridge,
  // Follow Up
    COL.profileSendOffNotes,
    COL.mnWorkflowNotes,
  COL.followUp,
  COL.followUpDate,
  // Never Billed (Medicare A&B)
  COL.neverBilledIsCar,
  COL.neverBilledCgm,
  // Benefits redesign — SoS facts round-trip (dates + units per product)
  COL.sosLastBill.monitor,
  COL.sosLastBill.sensors,
  COL.sosLastBill.insulin_pump,
  COL.sosLastBill.infusion_set,
  COL.sosLastBill.cartridge,
  COL.sosUnits.monitor,
  COL.sosUnits.sensors,
  COL.sosUnits.insulin_pump,
  COL.sosUnits.infusion_set,
  COL.sosUnits.cartridge,
  COL.sosNeverBilled.monitor,
  COL.sosNeverBilled.sensors,
  COL.sosNeverBilled.insulin_pump,
  COL.sosNeverBilled.infusion_set,
  COL.sosNeverBilled.cartridge,
  COL.medicarePriorPumpDate,
  // Stedi header display (read-only)
  COL.stediQmb,
  COL.stediCoinsurance,
  COL.stediPlanBegin,
  COL.planName,
  COL.homePlan,
  COL.deductibleRemaining,
  COL.oopMaxRemaining,
  // The three universal checks. These live in the BASE list, not the auth-only
  // one below, because the Benefits group is NOT in AUTH_GROUP_IDS — and
  // Benefits is the page that WRITES them. Kept here they were written on send
  // and then fetched by nobody, so every answer hydrated blank on reload and
  // reps re-entered all three on every patient load (found in live testing
  // 2026-07-30). The rest of this list already follows that rule: the rep's
  // other Benefits inputs (sosLastBill / sosUnits / sosNeverBilled /
  // notClearProducts) are all here for the same reason.
  COL.inNetwork,
  COL.active,
  COL.dmeBenefits,
  // Per-product Auth Result — same rule, same bug as the three checks above
  // (found 2026-08-02): Benefits WRITES these on send and, being read only by
  // the auth groups, fetched them back from nobody — so every "Auth Required /
  // Not Required" answer hydrated blank on reload and a manager reopening the
  // patient saw an empty step 2 while Monday held the real answers.
  COL.authResult.monitor,
  COL.authResult.sensors,
  COL.authResult.insulin_pump,
  COL.authResult.infusion_set,
  COL.authResult.cartridge,
];

/** Extended read columns for auth groups — adds the per-product SUBMISSION
 *  fields and the derived SoS/Auth summary columns. The three universal checks
 *  and the five per-product Auth Result columns are in the base list above
 *  (Benefits writes them, so Benefits must read them back) — do NOT repeat them
 *  here; `universalRoundTrip.test.ts` fails the build on a duplicate. */
export const AUTH_READ_COLUMN_IDS = [
  ...READ_COLUMN_IDS,
  COL.sos,
  COL.auth,
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
  // Shared Call/Fax Number — read back so the number survives a reload
  // (it hydrates into every Call/Fax-method code; see mondayMapping).
  COL.callFaxNumber,
  COL.daysSinceStage,
  COL.daysAuthOutstanding,
  COL.retryCount,
  COL.retryNextDate,
  COL.a4230Claim,
  COL.a4232Claim,
  COL.dvsDenialReason,
  COL.claimsPaidAmount,
  COL.claimsPaidDate,
  COL.claimsDenialReason,
  COL.claimsError,
  COL.ipClaimsStatus,
  COL.ipClaimsPaidAmount,
  COL.ipClaimsPaidDate,
  COL.ipClaimsDenialReason,
  COL.ipClaimsError,
  COL.triggerDvs,
  COL.triggerPumpDvs,
  COL.claimsStatus,
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
  groupId: string = GROUPS.benefits,
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
  const cols = AUTH_GROUP_IDS.has(groupId) ? AUTH_READ_COLUMN_IDS : READ_COLUMN_IDS;
  const data = await gql<{ boards: { items_page: { cursor: string | null; items: MondayItem[] } }[] }>(query, {
    boardId: BOARD_ID,
    cols,
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
      // Same column set as page 1 — this used to hardcode READ_COLUMN_IDS,
      // so auth-group patients past item 200 lost their auth/DVS columns.
      const next = await gql<{ next_items_page: { cursor: string | null; items: MondayItem[] } }>(nextQuery, { cursor, cols });
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
 * Fetch every item whose Stage Advancer sits at a given status INDEX,
 * board-wide (no group rule) — the DVS stage has no dedicated group yet, so
 * stage = "DVS" items stay wherever their group automation left them.
 * Used by the DVS monitor page (stage index 1 = "DVS").
 */
export async function fetchStageItems(stageIndex: number): Promise<MondayItem[]> {
  const PAGE = 200;
  const query = `
    query ($boardId: ID!, $cols: [String!]) {
      boards(ids: [$boardId]) {
        items_page(limit: ${PAGE}, query_params: { rules: [{ column_id: ${JSON.stringify(COL.stageAdvancer)}, compare_value: [${stageIndex}] }] }) {
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
    cols: AUTH_READ_COLUMN_IDS,
  });
  const allItems: MondayItem[] = [...(data.boards?.[0]?.items_page?.items ?? [])];
  let cursor = data.boards?.[0]?.items_page?.cursor ?? null;
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
      const next = await gql<{ next_items_page: { cursor: string | null; items: MondayItem[] } }>(nextQuery, { cursor, cols: AUTH_READ_COLUMN_IDS });
      const items = next.next_items_page?.items ?? [];
      cursor = next.next_items_page?.cursor ?? null;
      if (items.length > 0) allItems.push(...items);
    } catch (e) { console.error("[fetchStageItems] pagination error", e); break; }
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
 * Write a dropdown column (multi-select) by an array of labels.
 *
 * Pass `createLabelsIfMissing = true` ONLY for open-vocabulary dropdowns
 * (e.g. Clinic Name) where the source value may not already exist on this
 * board — otherwise the write fails when the label doesn't exist. Leave it
 * false (default) for fixed-vocab dropdowns so we never create duplicate labels.
 */
export async function writeDropdownLabels(
  itemId: string,
  columnId: string,
  labels: string[],
  createLabelsIfMissing = false,
): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value, create_labels_if_missing: ${createLabelsIfMissing}) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify({ labels }),
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
 * Write a checkbox column. checked=true → ✓; checked=false → cleared.
 */
export async function writeCheckbox(itemId: string, columnId: string, checked: boolean): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify(checked ? { checked: "true" } : {}),
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
  }>(query, {
    boardId: BOARD_ID,
    itemId,
  });
  return data.boards?.[0]?.items_page?.items?.[0]?.assets ?? [];
}

/**
 * Upload a file (PDF, image, etc.) into a Monday file column. Routed
 * through the Cloudflare Worker proxy because Monday's /v2/file endpoint
 * doesn't return CORS headers — direct browser POST would be blocked.
 */
export async function uploadFileToColumn(
  itemId: string,
  columnId: string,
  bytes: Uint8Array,
  filename: string,
  mimeType = "application/pdf",
): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("VITE_MONDAY_API_TOKEN is not set");

  const query = `mutation ($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "${columnId}", file: $file) { id } }`;

  const fd = new FormData();
  fd.append("query", query);
  fd.append(
    "variables[file]",
    new Blob([bytes as BlobPart], { type: mimeType }),
    filename,
  );

  const proxyUrl =
    (import.meta.env.VITE_MONDAY_FILE_PROXY_URL as string | undefined) ||
    "https://monday-file-proxy.medically-modern.workers.dev";

  let res: Response;
  try {
    res = await fetch(proxyUrl, {
      method: "POST",
      headers: { Authorization: token },
      body: fd,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[uploadFileToColumn] network error", { itemId, columnId, msg });
    throw new Error(
      `Upload network error (item ${itemId}, column ${columnId}): ${msg}`,
    );
  }
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`File upload failed (${res.status}): ${txt}`);
  }
  let json: { errors?: unknown };
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  if (json.errors) {
    throw new Error(`Monday file upload error: ${JSON.stringify(json.errors)}`);
  }
}

/**
 * Rename an item (the item's "name" field, not a column).
 */
export async function writeItemName(itemId: string, name: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: "name", value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    value: JSON.stringify(name),
  });
}

/**
 * Write a phone column. Monday expects { phone, countryShortName }.
 */
export async function writePhone(itemId: string, columnId: string, phone: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  const plan = planPhoneWrite(phone);
  if (plan.action === "skip") return;
  const val = plan.action === "write" ? { phone: plan.phone, countryShortName: "US" } : {};
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify(val),
  });
}

/**
 * Write an email column. Monday expects { email, text }.
 *
 * Routed through planEmailWrite so a label that has drifted from the address
 * can't reach Monday as an address and fail the whole verified send — see
 * shared/emailCell.ts for the 2026-08-03 Benefits incident.
 */
export async function writeEmail(itemId: string, columnId: string, email: string): Promise<void> {
  const plan = planEmailWrite(email);
  if (plan.action === "skip") return;
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  const val = plan.action === "write" ? { email: plan.email, text: plan.email } : {};
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify(val),
  });
}

/**
 * Write a simple column value by its display label (works for status
 * columns where you know the label text but not the index).
 */
/** Clear a status (or date) column back to its empty/default state. */
export async function clearStatusColumn(itemId: string, columnId: string): Promise<void> {
  const value = JSON.stringify("");
  await gql(
    `mutation { change_simple_column_value(item_id: ${itemId}, board_id: ${BOARD_ID}, column_id: "${columnId}", value: ${value}) { id } }`,
  );
}

export async function writeSimpleValue(itemId: string, columnId: string, label: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
      change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: label,
  });
}

/**
 * Write a location column. Monday expects { address, lat, lng }.
 * We pass 0/0 for coords when we don't have geocode data — the
 * address text still lands.
 */
export async function writeLocation(
  itemId: string,
  columnId: string,
  address: string,
  lat: number = 0,
  lng: number = 0,
): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  if (!address) return; // no-op: writing {} to a location column creates a phantom
  const val = { address, lat, lng };
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify(val),
  });
}

/** Fetch a single item by ID regardless of group (for cross-group deep-links). */
export async function fetchItemById(itemId: string, useAuthColumns?: boolean): Promise<MondayItem | null> {
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
  }>(query, { itemId: [itemId], cols: useAuthColumns ? AUTH_READ_COLUMN_IDS : READ_COLUMN_IDS });
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
