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

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-10";

// ── Board / column IDs ─────────────────────────────────────────────

const SUB_BOARD_ID = 18407459988;
const CLAIMS_BOARD_ID = 18413019028;

// Subscription board columns
const SUB_COL = {
  patientHelpMessage: "long_text_mm3xnb6k",
  responseTimestamp: "text_mm3kt9bs",
  status: "color_mm2t7tdy",
  phone: "phone_mkp0q3cw",
  email: "email_mkp01rrw",
  dob: "text_mkvdefh1",
  primaryInsurance: "color_mm254qxj",
} as const;

// Secondary Claims board columns
const CLAIMS_COL = {
  patientMessage: "long_text_mm3yqgyt",
  phone: "phone_mm1znnww",
  secondaryPayer: "color_mkxq1a2p",
  dob: "text_mkp3y5ax",
  secondaryStatus: "color_mm3a5yak",
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

interface MondayColumnValue {
  id: string;
  text: string | null;
  value: string | null;
}

interface MondayItem {
  id: string;
  name: string;
  column_values: MondayColumnValue[];
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
  if (!res.ok) throw new Error(`Monday request failed (${res.status})`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  return json.data as T;
}

// ── Paginated fetch for a single board ──────────────────────────────

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
    if (items.length > 0) all.push(...items);
    else break;
  }
  return all;
}

// ── Column value extractors ─────────────────────────────────────────

function cv(item: MondayItem, id: string) {
  return item.column_values.find((c) => c.id === id);
}

function txt(item: MondayItem, id: string): string {
  return cv(item, id)?.text ?? "";
}

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

/** Extract text and updated_at from a long_text column value. */
function longTextParts(item: MondayItem, id: string): { text: string; updatedAt: string } {
  const c = cv(item, id);
  const text = c?.text ?? "";
  const raw = c?.value;
  if (!raw) return { text, updatedAt: "" };
  try {
    const parsed = JSON.parse(raw);
    return { text: parsed.text ?? text, updatedAt: parsed.updated_at ?? "" };
  } catch {
    return { text, updatedAt: "" };
  }
}

// ── Public API ──────────────────────────────────────────────────────

export async function fetchPatientQuestions(): Promise<PatientQuestion[]> {
  const [subItems, claimsItems] = await Promise.all([
    fetchAllItems(SUB_BOARD_ID, SUB_READ_COLS).catch(() => []),
    fetchAllItems(CLAIMS_BOARD_ID, CLAIMS_READ_COLS).catch(() => []),
  ]);

  const results: PatientQuestion[] = [];

  // Subscription board → "Patient Help Message"
  for (const item of subItems) {
    const msg = longTextParts(item, SUB_COL.patientHelpMessage);
    if (!msg.text.trim()) continue; // Skip if empty

    // Use the explicit response timestamp if available, fall back to long_text updated_at
    const explicitTs = txt(item, SUB_COL.responseTimestamp);
    const timestamp = explicitTs || msg.updatedAt || new Date().toISOString();

    results.push({
      id: item.id,
      name: item.name,
      message: msg.text,
      messageUpdatedAt: timestamp,
      source: "subscription",
      boardId: SUB_BOARD_ID,
      phone: phoneVal(item, SUB_COL.phone),
      email: emailVal(item, SUB_COL.email),
      insurance: txt(item, SUB_COL.primaryInsurance),
      status: txt(item, SUB_COL.status),
      dob: txt(item, SUB_COL.dob),
    });
  }

  // Secondary Claims board → "Patient Message"
  for (const item of claimsItems) {
    const msg = longTextParts(item, CLAIMS_COL.patientMessage);
    if (!msg.text.trim()) continue; // Skip if empty

    results.push({
      id: item.id,
      name: item.name,
      message: msg.text,
      messageUpdatedAt: msg.updatedAt || new Date().toISOString(),
      source: "claims",
      boardId: CLAIMS_BOARD_ID,
      phone: phoneVal(item, CLAIMS_COL.phone),
      email: "",
      insurance: txt(item, CLAIMS_COL.secondaryPayer),
      status: txt(item, CLAIMS_COL.secondaryStatus),
      dob: txt(item, CLAIMS_COL.dob),
    });
  }

  // Sort by most recent message first
  results.sort((a, b) => {
    const ta = new Date(a.messageUpdatedAt).getTime() || 0;
    const tb = new Date(b.messageUpdatedAt).getTime() || 0;
    return tb - ta;
  });

  return results;
}

/** Count of patients with messages (for dashboard role counts). */
export async function fetchPatientQuestionsCount(): Promise<number> {
  const questions = await fetchPatientQuestions();
  return questions.length;
}
