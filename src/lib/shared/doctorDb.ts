/**
 * Doctor Database (board 18142847597) — lookup by NPI, read/write Doctor Notes.
 *
 * The Doctor Notes column lives on the DB board itself (long_text_mm44az6q).
 * Every pipeline stage can call these helpers to show & edit doctor-level notes.
 */

import { MONDAY_API_URL, mondayIdentityHeaders } from "./mondayEndpoint";
const MONDAY_API_VERSION = "2024-10";
const DOCTOR_DB_BOARD = 18142847597;
const COL_DOCTOR_NOTES = "long_text_mm44az6q";
const COL_NPI = "text_mkwhtqjb";

function getToken(): string {
  return (import.meta.env.VITE_MONDAY_API_TOKEN as string | undefined) ?? "";
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
  if (!res.ok) throw new Error(`Monday request failed (${res.status})`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  return json.data as T;
}

export interface DoctorRecord {
  itemId: string;
  name: string;
  npi: string;
  notes: string;
}

/**
 * Find a doctor in the Doctor Database by NPI.
 * Returns null if no match or NPI is empty.
 */
export async function findDoctorByNpi(npi: string): Promise<DoctorRecord | null> {
  if (!npi?.trim()) return null;

  const query = `query ($board: ID!, $cols: [ItemsPageByColumnValuesQuery!]!) {
    items_page_by_column_values(board_id: $board, limit: 1, columns: $cols) {
      items {
        id
        name
        column_values(ids: ["${COL_NPI}", "${COL_DOCTOR_NOTES}"]) {
          id
          text
        }
      }
    }
  }`;

  type Resp = {
    items_page_by_column_values: {
      items: {
        id: string;
        name: string;
        column_values: { id: string; text: string }[];
      }[];
    };
  };

  const data = await gql<Resp>(query, {
    board: DOCTOR_DB_BOARD,
    cols: [{ column_id: COL_NPI, column_values: [npi.trim()] }],
  });

  const item = data.items_page_by_column_values.items[0];
  if (!item) return null;

  const colVal = (id: string) => item.column_values.find((c) => c.id === id)?.text ?? "";

  return {
    itemId: item.id,
    name: item.name,
    npi: colVal(COL_NPI),
    notes: colVal(COL_DOCTOR_NOTES),
  };
}

/**
 * Write Doctor Notes back to the Doctor Database item.
 */
export async function saveDoctorNotes(itemId: string, notes: string): Promise<void> {
  const query = `mutation ($item: ID!, $board: ID!, $col: String!, $val: JSON!) {
    change_column_value(item_id: $item, board_id: $board, column_id: $col, value: $val) {
      id
    }
  }`;

  await gql(query, {
    item: Number(itemId),
    board: DOCTOR_DB_BOARD,
    col: COL_DOCTOR_NOTES,
    val: JSON.stringify({ text: notes }),
  });
}
