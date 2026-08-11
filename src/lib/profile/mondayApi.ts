// Monday.com GraphQL client — direct from browser.
// Token is read from VITE_MONDAY_API_TOKEN at build time.

import { MONDAY_API_URL, mondayIdentityHeaders } from "../shared/mondayEndpoint";
import { planPhoneWrite } from "../shared/phoneCell";
import { planEmailWrite } from "../shared/emailCell";
const MONDAY_API_VERSION = "2024-10";

export const BOARD_ID = 18406352652;

export const GROUPS = {
  // "Send back to Patient Intake" target — the upstream stage group (top of board).
  patientIntake: "group_mm4vhqff",
  intake: "group_mm1xf2jb",
  tests: "group_mm1wvq8p",
  // DTC intake form (dtc-mm-form). Same board, same columns — a separate group
  // per funnel state so partial fill-outs never sit in a rep's work queue
  // alongside finished ones. Both feed the Unverified Referrals role.
  newFormPartial: "group_mm5z87zt",
  newFormCompleted: "group_mm5zgeak",
  stuck: "group_mm1xyczx",
  completed: "group_mm1y57sz",
} as const;

export const COL = {
  // ── DTC intake form (written by dtc-mm-form-api) ──
  // "Provided *" columns hold what the PATIENT told us and are never
  // overwritten by Select Correct Provider — the verified doctor columns
  // (doctorName / doctorPhone) stay the rep's. See HANDOFF §6.0.
  formReasonForInquiry: "color_mm5zb8h6",
  formState: "text_mm5zc4vy",
  formDropOffStep: "color_mm5zv7q8",
  formSessionId: "text_mm5zmfgg",
  formPumpNeed: "color_mm5zsfmj",
  formCgmPreference: "color_mm5z5v3n",
  formPumpPreference: "color_mm5zxfh9",
  formProvidedDoctorName: "text_mm5z586h",
  formProvidedClinicPhone: "text_mm5zjh88",
  formInsuranceVia: "color_mm5zv5pa",
  formInsuranceOther: "text_mm5z8w99",
  formSecondaryProvided: "color_mm5zh2af",
  formSecondaryMemberId: "text_mm5ztdq9",
  formCardPhoto: "file_mm5zhy1",
  formProceedPreference: "color_mm5zp6rt",
  formCallSlot: "text_mm5za6zx",
  formBookingStatus: "color_mm5zrbn3",
  /** The REAL booked call, written by the dtc-mm-form Calendly webhook — the
   *  same column the Scheduled Calls day grid reads. `formCallSlot` above is
   *  only what the patient typed/picked on the form; this is what Calendly
   *  actually holds, so it is what the rep must see. */
  scheduledCallTime: "date_mm63na19",

  /** Mirrors the Medical Evaluation escalation model exactly:
   *  0 = "Manager Escalation Required" (→ Manager Intervention)
   *  1 = "Done" (resolved / back in the rep pipeline)
   *  2 = "Final Escalation Required" (Proposed Stuck → Final Decisions) */
  intakeEscalation: "color_mm5zww42",
  intakeEscalationNotes: "long_text_mm5z3sq9",

  // ── Rep-entered on the intake call (HANDOFF §9) ──
  // Deliberately NOT on the patient form — these are phone-call answers.
  selfAdvocacy: "color_mm5z31hs",
  currentOopCost: "text_mm5zj2q1",
  cgmDataAwareness: "color_mm5z4yqq",
  cgmDataFile: "file_mm5zhsxh",
  attemptCounter: "numeric_mm5ze82q",
  /** Rep-side equivalent of the patient choosing "Send request now" —
   *  satisfies condition 1 of the advance-unlock rule (§2, §7.2). */
  intakeCallComplete: "color_mm5z6eze",

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
  // Who is actually primary — MSP payer name when CMS's COB file says a
  // commercial plan is primary to Medicare, "Medicare" for plain A&B,
  // parsed payer name otherwise. Written by the backend since 2026-07-15;
  // wired into the UI 2026-07-20 for the §1b MSP soft block.
  stediPrimaryPayer: "dropdown_mm594743",
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
  // DATE-type mirror of the plan begin date, written by the SPA before
  // advancing. Monday's create-item automations human-format ISO-looking
  // TEXT tokens ("2022-01-01" → "01 January 2022") when copying to the next
  // board; date→date mappings copy verbatim, so downstream boards read the
  // yyyy-mm-dd value from their own Plan Begin Date date columns.
  planBeginDate: "date_mm4wh83f",
  stediErrorDescription: "text_mm1x9tje",
  stediSecondaryMedicaidId: "text_mm25bjz7",
  stediPlanName: "text_mm1xdcet",
  stediGender: "dropdown_mm30thnj",
  stediMedicaidId: "text_mm31e5se",
  stediHomePlan: "dropdown_mm457xy2",
  // Member address parsed by the Stedi eligibility check.
  stediAddress: "text_mm5fqm4s",
  // "SNF/Hospice/Hospital" — active Hospice election / Hospital-SNF stay
  // from the Medicare 271 (mirror of the Subscription Board column).
  // Dropdown labels: "Hospice", "Hospital/SNF"; empty = none active.
  stediFacilityFlags: "dropdown_mm5ex3d7",

  // Plan Name flows from Stedi → Insurance Plan dropdown on Submit
  insurancePlan: "dropdown_mm1y2x75",
  // Active/Not Active status — derived from stediEligibilityActive on submit
  activeNotActive: "color_mm1xycqc",

  // ── Insurance ──
  primaryInsurance: "color_mm1xg10n",
  generalInsurance: "color_mm24ap4j",
  // Working Member ID entered in Benefits Check — the column the Stedi service
  // READS. Written before Run Stedi so the check uses the rep-entered value.
  memberIdWorking: "text_mm4t8gbq",
  // Final Member ID that advances (written on submit; overrides working value
  // for the Fidelis-supplies-only → NY Medicaid case).
  memberId1: "text_mm1x2qk2",
  memberId2: "text_mm1xaccx",
  secondaryInsurance: "color_mm1zbrx0",

  // ── OOP estimate (computed + written by the SPA on Calculate) ──
  oopFirst: "text_mm4tvsk6",
  oopRecurring: "text_mm4ttaa6",

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
  prescriberRequirements: "text_mm3y53qn",

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

  // ── Debug ──
  joshDebug: "text_mm2nfwjs",
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
  COL.stediManagedMedicaid, COL.stediPrimaryPayer,
  COL.stediInNetwork, COL.stediPriorAuthRequired,
  COL.stediCoinsurance, COL.stediCopay,
  COL.stediIndividualDeductible, COL.stediIndividualDeductibleRemaining,
  COL.stediFamilyDeductible, COL.stediFamilyDeductibleRemaining,
  COL.stediIndividualOopMax, COL.stediIndividualOopMaxRemaining,
  COL.stediFamilyOopMax, COL.stediFamilyOopMaxRemaining,
  COL.stediPlanBeginDate, COL.stediErrorDescription,
  COL.stediSecondaryMedicaidId,
  COL.stediGender, COL.stediMedicaidId, COL.stediHomePlan, COL.stediFacilityFlags,
  COL.stediAddress,
  // Insurance
  COL.primaryInsurance, COL.generalInsurance, COL.memberIdWorking,
  COL.memberId1, COL.memberId2, COL.secondaryInsurance,
  // OOP estimate
  COL.oopFirst, COL.oopRecurring,
  // Working cost-sharing
  COL.workingCoinsurance, COL.workingDeductible, COL.workingDeductibleRemaining,
  COL.workingOopMax, COL.workingOopMaxRemaining,
  // Doctor
  COL.doctorStatus, COL.doctorName, COL.doctorPhone, COL.doctorNpi,
  COL.clinicalsMethod, COL.doctorEmail, COL.doctorFax, COL.clinicName,
  COL.clinicAddress, COL.prescriberRequirements,
  // Serving
  COL.referralType, COL.referralSource, COL.pumpType, COL.cgmType,
  COL.requestType, COL.cgmCrossSell, COL.serving,
  COL.insulinPumpCoveragePath, COL.cgmCoveragePath,
  // Notes + Follow Up
  COL.notes, COL.followUp, COL.followUpDate,
  // DTC intake form
  COL.formReasonForInquiry, COL.formState, COL.formDropOffStep, COL.formSessionId,
  COL.formPumpNeed, COL.formCgmPreference, COL.formPumpPreference,
  COL.formProvidedDoctorName, COL.formProvidedClinicPhone,
  COL.formInsuranceVia, COL.formInsuranceOther,
  COL.formSecondaryProvided, COL.formSecondaryMemberId, COL.formCardPhoto,
  // Both file columns are READ so the rep can see what the patient sent. They
  // were fetched but never mapped into Patient, so nothing could render them.
  COL.cgmDataFile,
  COL.formProceedPreference, COL.formCallSlot, COL.formBookingStatus,
  COL.scheduledCallTime,
  // Rep-entered on the intake call
  COL.selfAdvocacy, COL.currentOopCost, COL.cgmDataAwareness,
  COL.attemptCounter, COL.intakeCallComplete,
  COL.intakeEscalation, COL.intakeEscalationNotes,
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
    console.error("Monday API GraphQL error", JSON.stringify(json.errors, null, 2), { query: query.trim().slice(0, 120), variables });
    throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  }
  return json.data as T;
}

const PAGE = 200;

export async function fetchGroupItems(
  groupId: string = GROUPS.intake,
  onMore?: (items: MondayItem[]) => void,
): Promise<MondayItem[]> {
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

/** Move an item to a different group on the same board. */
export async function moveItemToGroup(itemId: string, groupId: string): Promise<void> {
  const query = `
    mutation ($itemId: ID!, $groupId: String!) {
      move_item_to_group(item_id: $itemId, group_id: $groupId) { id }
    }
  `;
  await gql(query, { itemId, groupId });
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

/**
 * Clear a FILE column — removes every asset on it.
 *
 * `{"clearAll": true}` is the only shape Monday accepts here; a blank string
 * or `null` is rejected the way any other wrong-shaped value is. Backs the ✕
 * on a file row (HANDOFF §8.3).
 */
export async function clearFileColumn(itemId: string, columnId: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: JSON.stringify({ clearAll: true }) });
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
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: JSON.stringify(val) });
}

/** Write an email column. */
/**
 * See shared/emailCell.ts — never hand Monday a value that isn't an address.
 *
 * The label is deliberately pinned to the address rather than taken as an
 * argument (the old `text?` param had no callers): a label that differs from
 * the address is exactly what makes Monday render the composite that broke the
 * Benefits send. Profile Send-Off is upstream of every board that copies these
 * columns, so it is the last place that should be able to create one.
 */
export async function writeEmail(itemId: string, columnId: string, email: string): Promise<void> {
  const plan = planEmailWrite(email);
  if (plan.action === "skip") return;
  const clean = plan.action === "write" ? plan.email : "";
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, { boardId: BOARD_ID, itemId, columnId, value: JSON.stringify({ email: clean, text: clean }) });
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

