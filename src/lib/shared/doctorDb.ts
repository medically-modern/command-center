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
// Order followers (Corey 9) — name + email pairs surfaced as mailto links.
const COL_FOLLOWER1 = "text_mm1vp9qt";
const COL_FOLLOWER1_EMAIL = "email_mm1vncc6";
const COL_FOLLOWER2 = "text_mm1vw9d";
const COL_FOLLOWER2_EMAIL = "email_mm1vsp3v";
// Clinicals method ("MN Exchange?" status): Parachute / Fax / Email.
const COL_METHOD = "color_mm1vr8rd";
const METHOD_INDEX: Record<string, number> = { Parachute: 0, Fax: 1, Email: 2 };
// Contact fields for creating a new provider.
const COL_DOC_ADDRESS = "text_mkzc21ns";
const COL_DOC_PHONE = "phone";
const COL_SCRIPT_FAX = "email_mkwh2ywd";
const COL_SCRIPT_EMAIL = "email";
const READ_COLS = [
  COL_NPI, COL_DOCTOR_NOTES,
  COL_FOLLOWER1, COL_FOLLOWER1_EMAIL, COL_FOLLOWER2, COL_FOLLOWER2_EMAIL,
] as const;

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

export interface OrderFollower {
  name: string;
  email: string;
}

export interface DoctorRecord {
  itemId: string;
  name: string;
  npi: string;
  notes: string;
  followers: OrderFollower[];
}

type DbItem = { id: string; name: string; column_values: { id: string; text: string }[] };

function toRecord(item: DbItem): DoctorRecord {
  const colVal = (id: string) => item.column_values.find((c) => c.id === id)?.text ?? "";
  const followers: OrderFollower[] = [];
  const f1 = colVal(COL_FOLLOWER1).trim();
  const f2 = colVal(COL_FOLLOWER2).trim();
  if (f1 || colVal(COL_FOLLOWER1_EMAIL)) followers.push({ name: f1, email: colVal(COL_FOLLOWER1_EMAIL) });
  if (f2 || colVal(COL_FOLLOWER2_EMAIL)) followers.push({ name: f2, email: colVal(COL_FOLLOWER2_EMAIL) });
  return {
    itemId: item.id,
    name: item.name,
    npi: colVal(COL_NPI),
    notes: colVal(COL_DOCTOR_NOTES),
    followers,
  };
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
        column_values(ids: [${READ_COLS.map((c) => `"${c}"`).join(", ")}]) {
          id
          text
        }
      }
    }
  }`;

  type Resp = { items_page_by_column_values: { items: DbItem[] } };

  const data = await gql<Resp>(query, {
    board: DOCTOR_DB_BOARD,
    cols: [{ column_id: COL_NPI, column_values: [npi.trim()] }],
  });

  const item = data.items_page_by_column_values.items[0];
  return item ? toRecord(item) : null;
}

/**
 * Create a new provider on the Doctor Database board (Corey 7). Writes the
 * contact fields, clinicals method, order followers, and notes. Returns the new
 * item id. The Clinic dropdown is intentionally not set here — clinic is
 * captured on the patient board; add it on the DB board manually if needed.
 */
export async function createDoctorItem(fields: {
  name: string;
  npi: string;
  address?: string;
  phone?: string;
  fax?: string;
  email?: string;
  method?: string;
  notes?: string;
  followers?: OrderFollower[];
}): Promise<string> {
  const cols: Record<string, unknown> = {};
  if (fields.npi) cols[COL_NPI] = fields.npi;
  if (fields.address) cols[COL_DOC_ADDRESS] = fields.address;
  if (fields.phone) {
    const digits = fields.phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    if (digits) cols[COL_DOC_PHONE] = { phone: digits, countryShortName: "US" };
  }
  if (fields.fax) cols[COL_SCRIPT_FAX] = { email: fields.fax, text: fields.fax };
  if (fields.email) cols[COL_SCRIPT_EMAIL] = { email: fields.email, text: fields.email };
  const mIdx = fields.method ? METHOD_INDEX[fields.method] : undefined;
  if (mIdx !== undefined) cols[COL_METHOD] = { index: mIdx };
  const [f1, f2] = fields.followers ?? [];
  if (f1?.name) cols[COL_FOLLOWER1] = f1.name;
  if (f1?.email) cols[COL_FOLLOWER1_EMAIL] = { email: f1.email, text: f1.email };
  if (f2?.name) cols[COL_FOLLOWER2] = f2.name;
  if (f2?.email) cols[COL_FOLLOWER2_EMAIL] = { email: f2.email, text: f2.email };
  if (fields.notes) cols[COL_DOCTOR_NOTES] = { text: fields.notes };

  const query = `mutation ($board: ID!, $name: String!, $vals: JSON!) {
    create_item(board_id: $board, item_name: $name, column_values: $vals, create_labels_if_missing: true) { id }
  }`;
  const data = await gql<{ create_item: { id: string } }>(query, {
    board: DOCTOR_DB_BOARD,
    name: fields.name,
    vals: JSON.stringify(cols),
  });
  return data.create_item.id;
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
