/**
 * Monday.com API for Patient Questions — read-only.
 *
 * Fetches from two boards:
 *   1. Subscription Board (18407459988) — "Patient Help Message" column
 *   2. Secondary Claims Board (18413019028) — "Patient Message" column
 *
 * Only returns items where the message column is populated.
 */

import type { PatientQuestion } from "./types";

import { MONDAY_API_URL } from "../shared/mondayEndpoint";
const MONDAY_API_VERSION = "2024-10";

// ── Board IDs ───────────────────────────────────────────────────────

const SUB_BOARD_ID = 18407459988;
const CLAIMS_BOARD_ID = 18413019028;

// ── Subscription board columns ──────────────────────────────────────

const SUB_COL = {
  patientHelpMessage: "long_text_mm3xnb6k",
  responseTimestamp: "text_mm3kt9bs",
  status: "color_mm2t7tdy",
  daysToOrder: "color_mkxmtv9c",
  orderingCycle: "color_mkyjawhq",
  nextOrder: "date_mkp0nvf1",
  subscription: "color_mm273mv8",
  orderType: "color_mm2w6kd",
  dob: "text_mkvdefh1",
  gender: "color_mm1zgyy2",
  phone: "phone_mkp0q3cw",
  email: "email_mkp01rrw",
  address: "location_mkp0rs0v",
  primaryInsurance: "color_mm254qxj",
  memberId1: "text_mkvp6zfg",
  secondaryInsurance: "color_mm25cr82",
  memberId2: "text_mm25cpx6",
  sensorsType: "color_mkxmdscr",
  suppliesType: "color_mkxmnheg",
  infusionSet1: "color_mkxm50f9",
  infQty1: "numeric_mkw839ks",
  infusionSet2: "color_mkxmx5wk",
  infQty2: "numeric_mkwac234",
  doctor: "text_mkxn3wza",
  npi: "text_mkxnkgzg",
  doctorAddress: "location_mkxnbt7y",
  doctorPhone: "phone_mkxnv7e5",
  doctorFax: "email_mkxn9af2",
  cgmCoverage: "color_mm2cmgqe",
  mr: "color_mktyr8xg",
  mnExpiry: "date_mkp09gra",
  diagnosis: "color_mkxrxv9w",
  sensorsAuthStatus: "color_mm25t997",
  suppliesAuthStatus: "color_mm27snkq",
  sensorsAuthId: "text_mkwbkq9d",
  sensorsUnits: "numeric_mkwbzsg2",
  sensorsStartAuth: "date_mkwb4q5e",
  sensorsEndAuth: "date_mkwbvr6t",
  suppliesUnits: "numeric_mm25mf8k",
  suppliesStartAuth: "date_mm25csyr",
  suppliesEndAuth: "date_mm255cs4",
  orderCount: "numeric_mkxtmtsy",
  claimsStatus: "color_mm2n5rkg",
  denialReason: "long_text_mm2nf5b1",
  totalRevenue: "numeric_mm2xsjm5",
  totalCost: "numeric_mm2xgvxx",
  totalGP: "numeric_mm2xvjc1",
  arr: "numeric_mm2xsqyd",
  stediActive: "color_mm2nzm33",
  stediDedRemaining: "text_mm3g32ja",
  insuranceChange: "color_mm2p8v3m",
  priorAuthReq: "color_mm2pj23n",
  primaryClaimPaid: "color_mm33spks",
  patientOrderResponse: "color_mm3kjykc",
  patientInsuranceResponse: "color_mm3k4z79",
} as const;

// ── Secondary Claims board columns ──────────────────────────────────

const CLAIMS_COL = {
  patientMessage: "long_text_mm3yqgyt",
  dob: "text_mkp3y5ax",
  gender: "color_mm1zy5f2",
  phone: "phone_mm1znnww",
  address: "location_mkxxpesw",
  secondaryPayer: "color_mkxq1a2p",
  secondaryMemberId: "text_mm3a7ega",
  primaryPayor: "color_mm3a93ek",
  primaryMemberId: "text_mktat89m",
  dos: "date_mkwr7spz",
  claimSentDate: "date_mm14rk8d",
  daysOutstanding: "color_mm29awe7",
  actionContext: "text_mm29v2ph",
  denialAction: "color_mm2998p",
  secondaryStatus: "color_mm3a5yak",
  claimType: "color_mm2nvk1p",
  estPay: "numeric_mm2xdtk6",
  secondaryPaid: "numeric_mm3a2etk",
  secondaryPaidDate: "date_mm3apmee",
  claimId: "text_mm1zpzrs",
  notesActivity: "long_text_mkzrx7ke",
  primaryPaidAmount: "numeric_mm3as81b",
  primaryPRAmount: "numeric_mm3ak2za",
  doctor: "text_mkxrh4a4",
  npi: "text_mkxr2r9b",
  doctorAddress: "location_mkxr251b",
  drPhone: "phone_mm1zy789",
  cgmCoverage: "color_mm1ze7b4",
  diagnosis: "color_mky2gpz5",
  authorization: "text_mkwrb2t9",
} as const;

const SUB_READ_COLS = Object.values(SUB_COL);
const CLAIMS_READ_COLS = Object.values(CLAIMS_COL);

// ── Helpers ─────────────────────────────────────────────────────────

function getToken(): string {
  return (import.meta.env.VITE_MONDAY_API_TOKEN as string | undefined) ?? "";
}

export function hasToken(): boolean {
  return !!getToken();
}

interface MondayColumnValue { id: string; text: string | null; value: string | null; }
interface MondayItem { id: string; name: string; column_values: MondayColumnValue[]; }

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("VITE_MONDAY_API_TOKEN is not set");
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "API-Version": MONDAY_API_VERSION },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Monday request failed (${res.status})`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  return json.data as T;
}

async function fetchAllItems(boardId: number, cols: readonly string[]): Promise<MondayItem[]> {
  const PAGE = 200;
  const query = `
    query ($boardId: ID!, $cols: [String!]) {
      boards(ids: [$boardId]) {
        items_page(limit: ${PAGE}) {
          cursor
          items { id name column_values(ids: $cols) { id text value } }
        }
      }
    }
  `;
  const data = await gql<{ boards: { items_page: { cursor: string | null; items: MondayItem[] } }[] }>(
    query, { boardId, cols },
  );
  const firstPage = data.boards?.[0]?.items_page?.items ?? [];
  let cursor = data.boards?.[0]?.items_page?.cursor ?? null;
  const all: MondayItem[] = [...firstPage];
  while (cursor) {
    const nextQuery = `
      query ($cursor: String!, $cols: [String!]) {
        next_items_page(limit: ${PAGE}, cursor: $cursor) {
          cursor
          items { id name column_values(ids: $cols) { id text value } }
        }
      }
    `;
    const next = await gql<{ next_items_page: { cursor: string | null; items: MondayItem[] } }>(
      nextQuery, { cursor, cols },
    );
    const items = next.next_items_page?.items ?? [];
    cursor = next.next_items_page?.cursor ?? null;
    if (items.length > 0) all.push(...items); else break;
  }
  return all;
}

// ── Column value extractors ─────────────────────────────────────────

function cv(item: MondayItem, id: string) { return item.column_values.find((c) => c.id === id); }
function txt(item: MondayItem, id: string): string { return cv(item, id)?.text ?? ""; }
function phoneVal(item: MondayItem, id: string): string {
  const v = cv(item, id)?.value;
  if (!v) return "";
  try { return JSON.parse(v).phone ?? ""; } catch { return cv(item, id)?.text ?? ""; }
}
function emailVal(item: MondayItem, id: string): string {
  const v = cv(item, id)?.value;
  if (!v) return cv(item, id)?.text ?? "";
  try { return JSON.parse(v).email ?? cv(item, id)?.text ?? ""; } catch { return cv(item, id)?.text ?? ""; }
}
function locationVal(item: MondayItem, id: string): string {
  const v = cv(item, id)?.value;
  if (!v) return cv(item, id)?.text ?? "";
  try { return JSON.parse(v).address ?? ""; } catch { return cv(item, id)?.text ?? ""; }
}
function longTextParts(item: MondayItem, id: string): { text: string; updatedAt: string } {
  const c = cv(item, id);
  const text = c?.text ?? "";
  const raw = c?.value;
  if (!raw) return { text, updatedAt: "" };
  try { const p = JSON.parse(raw); return { text: p.text ?? text, updatedAt: p.updated_at ?? "" }; }
  catch { return { text, updatedAt: "" }; }
}

// blank defaults
const EMPTY: Omit<PatientQuestion, "id" | "name" | "message" | "messageUpdatedAt" | "source" | "boardId"> = {
  dob: "", phone: "", email: "", address: "", gender: "",
  status: "", daysToOrder: "", orderingCycle: "", nextOrder: "", subscription: "", orderType: "",
  primaryInsurance: "", memberId1: "", secondaryInsurance: "", memberId2: "",
  sensorsType: "", suppliesType: "", infusionSet1: "", infQty1: "", infusionSet2: "", infQty2: "",
  doctor: "", npi: "", doctorAddress: "", doctorPhone: "", doctorFax: "",
  cgmCoverage: "", mr: "", mnExpiry: "", diagnosis: "",
  sensorsAuthStatus: "", suppliesAuthStatus: "", sensorsAuthId: "", sensorsUnits: "",
  sensorsStartAuth: "", sensorsEndAuth: "", suppliesUnits: "", suppliesStartAuth: "", suppliesEndAuth: "",
  orderCount: "", claimsStatus: "", denialReason: "",
  totalRevenue: "", totalCost: "", totalGP: "", arr: "",
  stediActive: "", stediDedRemaining: "", insuranceChange: "", priorAuthReq: "", primaryClaimPaid: "",
  patientOrderResponse: "", patientInsuranceResponse: "",
  secondaryPayer: "", claimType: "", dos: "", claimSentDate: "", daysOutstanding: "",
  actionContext: "", denialAction: "", secondaryStatus: "", estPay: "",
  secondaryPaid: "", secondaryPaidDate: "", claimId: "", notesActivity: "",
  primaryPaidAmount: "", primaryPRAmount: "", primaryMemberId: "", primaryPayor: "", secondaryMemberId: "",
};

// ── Public API ──────────────────────────────────────────────────────

export async function fetchPatientQuestions(): Promise<PatientQuestion[]> {
  const [subItems, claimsItems] = await Promise.all([
    fetchAllItems(SUB_BOARD_ID, SUB_READ_COLS).catch(() => []),
    fetchAllItems(CLAIMS_BOARD_ID, CLAIMS_READ_COLS).catch(() => []),
  ]);

  const results: PatientQuestion[] = [];

  // Subscription board
  for (const item of subItems) {
    const msg = longTextParts(item, SUB_COL.patientHelpMessage);
    if (!msg.text.trim()) continue;
    const explicitTs = txt(item, SUB_COL.responseTimestamp);
    results.push({
      ...EMPTY,
      id: item.id,
      name: item.name,
      message: msg.text,
      messageUpdatedAt: explicitTs || msg.updatedAt || new Date().toISOString(),
      source: "subscription",
      boardId: SUB_BOARD_ID,
      // demographics
      dob: txt(item, SUB_COL.dob),
      phone: phoneVal(item, SUB_COL.phone),
      email: emailVal(item, SUB_COL.email),
      address: locationVal(item, SUB_COL.address),
      gender: txt(item, SUB_COL.gender),
      // subscription meta
      status: txt(item, SUB_COL.status),
      daysToOrder: txt(item, SUB_COL.daysToOrder),
      orderingCycle: txt(item, SUB_COL.orderingCycle),
      nextOrder: txt(item, SUB_COL.nextOrder),
      subscription: txt(item, SUB_COL.subscription),
      orderType: txt(item, SUB_COL.orderType),
      // insurance
      primaryInsurance: txt(item, SUB_COL.primaryInsurance),
      memberId1: txt(item, SUB_COL.memberId1),
      secondaryInsurance: txt(item, SUB_COL.secondaryInsurance),
      memberId2: txt(item, SUB_COL.memberId2),
      // order
      sensorsType: txt(item, SUB_COL.sensorsType),
      suppliesType: txt(item, SUB_COL.suppliesType),
      infusionSet1: txt(item, SUB_COL.infusionSet1),
      infQty1: txt(item, SUB_COL.infQty1),
      infusionSet2: txt(item, SUB_COL.infusionSet2),
      infQty2: txt(item, SUB_COL.infQty2),
      // doctor
      doctor: txt(item, SUB_COL.doctor),
      npi: txt(item, SUB_COL.npi),
      doctorAddress: locationVal(item, SUB_COL.doctorAddress),
      doctorPhone: phoneVal(item, SUB_COL.doctorPhone),
      doctorFax: emailVal(item, SUB_COL.doctorFax),
      // medical necessity
      cgmCoverage: txt(item, SUB_COL.cgmCoverage),
      mr: txt(item, SUB_COL.mr),
      mnExpiry: txt(item, SUB_COL.mnExpiry),
      diagnosis: txt(item, SUB_COL.diagnosis),
      // auth
      sensorsAuthStatus: txt(item, SUB_COL.sensorsAuthStatus),
      suppliesAuthStatus: txt(item, SUB_COL.suppliesAuthStatus),
      sensorsAuthId: txt(item, SUB_COL.sensorsAuthId),
      sensorsUnits: txt(item, SUB_COL.sensorsUnits),
      sensorsStartAuth: txt(item, SUB_COL.sensorsStartAuth),
      sensorsEndAuth: txt(item, SUB_COL.sensorsEndAuth),
      suppliesUnits: txt(item, SUB_COL.suppliesUnits),
      suppliesStartAuth: txt(item, SUB_COL.suppliesStartAuth),
      suppliesEndAuth: txt(item, SUB_COL.suppliesEndAuth),
      // other
      orderCount: txt(item, SUB_COL.orderCount),
      claimsStatus: txt(item, SUB_COL.claimsStatus),
      denialReason: longTextParts(item, SUB_COL.denialReason).text,
      totalRevenue: txt(item, SUB_COL.totalRevenue),
      totalCost: txt(item, SUB_COL.totalCost),
      totalGP: txt(item, SUB_COL.totalGP),
      arr: txt(item, SUB_COL.arr),
      stediActive: txt(item, SUB_COL.stediActive),
      stediDedRemaining: txt(item, SUB_COL.stediDedRemaining),
      insuranceChange: txt(item, SUB_COL.insuranceChange),
      priorAuthReq: txt(item, SUB_COL.priorAuthReq),
      primaryClaimPaid: txt(item, SUB_COL.primaryClaimPaid),
      patientOrderResponse: txt(item, SUB_COL.patientOrderResponse),
      patientInsuranceResponse: txt(item, SUB_COL.patientInsuranceResponse),
    });
  }

  // Secondary Claims board
  for (const item of claimsItems) {
    const msg = longTextParts(item, CLAIMS_COL.patientMessage);
    if (!msg.text.trim()) continue;
    results.push({
      ...EMPTY,
      id: item.id,
      name: item.name,
      message: msg.text,
      messageUpdatedAt: msg.updatedAt || new Date().toISOString(),
      source: "claims",
      boardId: CLAIMS_BOARD_ID,
      // demographics
      dob: txt(item, CLAIMS_COL.dob),
      phone: phoneVal(item, CLAIMS_COL.phone),
      email: "",
      address: locationVal(item, CLAIMS_COL.address),
      gender: txt(item, CLAIMS_COL.gender),
      // insurance
      secondaryPayer: txt(item, CLAIMS_COL.secondaryPayer),
      secondaryMemberId: txt(item, CLAIMS_COL.secondaryMemberId),
      primaryPayor: txt(item, CLAIMS_COL.primaryPayor),
      primaryMemberId: txt(item, CLAIMS_COL.primaryMemberId),
      // claims
      claimType: txt(item, CLAIMS_COL.claimType),
      dos: txt(item, CLAIMS_COL.dos),
      claimSentDate: txt(item, CLAIMS_COL.claimSentDate),
      daysOutstanding: txt(item, CLAIMS_COL.daysOutstanding),
      actionContext: txt(item, CLAIMS_COL.actionContext),
      denialAction: txt(item, CLAIMS_COL.denialAction),
      secondaryStatus: txt(item, CLAIMS_COL.secondaryStatus),
      estPay: txt(item, CLAIMS_COL.estPay),
      secondaryPaid: txt(item, CLAIMS_COL.secondaryPaid),
      secondaryPaidDate: txt(item, CLAIMS_COL.secondaryPaidDate),
      claimId: txt(item, CLAIMS_COL.claimId),
      notesActivity: longTextParts(item, CLAIMS_COL.notesActivity).text,
      primaryPaidAmount: txt(item, CLAIMS_COL.primaryPaidAmount),
      primaryPRAmount: txt(item, CLAIMS_COL.primaryPRAmount),
      // doctor
      doctor: txt(item, CLAIMS_COL.doctor),
      npi: txt(item, CLAIMS_COL.npi),
      doctorAddress: locationVal(item, CLAIMS_COL.doctorAddress),
      doctorPhone: phoneVal(item, CLAIMS_COL.drPhone),
      cgmCoverage: txt(item, CLAIMS_COL.cgmCoverage),
      diagnosis: txt(item, CLAIMS_COL.diagnosis),
      status: txt(item, CLAIMS_COL.secondaryStatus),
    });
  }

  results.sort((a, b) => {
    const ta = new Date(a.messageUpdatedAt).getTime() || 0;
    const tb = new Date(b.messageUpdatedAt).getTime() || 0;
    return tb - ta;
  });

  return results;
}

export async function fetchPatientQuestionsCount(): Promise<number> {
  const questions = await fetchPatientQuestions();
  return questions.length;
}
