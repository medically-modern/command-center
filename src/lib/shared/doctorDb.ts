/**
 * Doctor Database (board 18142847597) — lookup by NPI, read/write Doctor Notes.
 *
 * The Doctor Notes column lives on the DB board itself (long_text_mm44az6q).
 * Every pipeline stage can call these helpers to show & edit doctor-level notes.
 */

import { MONDAY_API_URL, mondayIdentityHeaders } from "./mondayEndpoint";
const MONDAY_API_VERSION = "2024-10";
/** ⚠️ EXPORTED because `commsHub/dossierApi` joins inbound faxes against this
 *  board too. It reads these ids rather than keeping its own copy: a column
 *  deleted and recreated changes its ID and then reads return EMPTY rather than
 *  erroring (§3), so a second hand-kept list would go silently stale. */
export const DOCTOR_DB_BOARD = 18142847597;
const COL_DOCTOR_NOTES = "long_text_mm44az6q";
const COL_NPI = "text_mkwhtqjb";
// Order followers (Corey 9) — name + email pairs surfaced as mailto links.
// Up to 5 followers; name is optional (email-only followers are fine).
const FOLLOWER_COLS: { name: string; email: string }[] = [
  { name: "text_mm1vp9qt", email: "email_mm1vncc6" },
  { name: "text_mm1vw9d", email: "email_mm1vsp3v" },
  { name: "text_mm4vj1fj", email: "email_mm4vea9t" },
  { name: "text_mm4v441t", email: "email_mm4v6whb" },
  { name: "text_mm4vhnws", email: "email_mm4vphes" },
];
export const MAX_FOLLOWERS = FOLLOWER_COLS.length;
// Clinicals method ("MN Exchange?" status): Parachute / Fax / Email.
const COL_METHOD = "color_mm1vr8rd";
const METHOD_INDEX: Record<string, number> = { Parachute: 0, Fax: 1, Email: 2 };
// Contact fields for creating a new provider / a location profile.
const COL_DOC_ADDRESS = "text_mkzc21ns";
const COL_DOC_PHONE = "phone";
const COL_SCRIPT_FAX = "email_mkwh2ywd";
const COL_SCRIPT_EMAIL = "email";
const COL_CLINIC = "dropdown_mm1vd9fs";
/** The subset of this board's contract the fax→office join needs. */
export const DOCTOR_DB_COLS = {
  fax: COL_SCRIPT_FAX,
  clinic: COL_CLINIC,
  npi: COL_NPI,
  phone: COL_DOC_PHONE,
} as const;
const READ_COLS = [
  COL_NPI, COL_DOCTOR_NOTES,
  ...FOLLOWER_COLS.flatMap((f) => [f.name, f.email]),
  COL_DOC_ADDRESS, COL_DOC_PHONE, COL_SCRIPT_FAX, COL_SCRIPT_EMAIL, COL_METHOD, COL_CLINIC,
];

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

const normName = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export interface DoctorRecord {
  itemId: string;
  name: string;
  npi: string;
  notes: string;
  followers: OrderFollower[];
  /** Location/contact fields — a doctor may have several DB items (profiles),
   *  each a distinct clinic location under the same name/NPI. */
  clinic: string;
  address: string;
  phone: string;
  fax: string;
  email: string;
  method: string;
}

type DbItem = { id: string; name: string; column_values: { id: string; text: string }[] };

function toRecord(item: DbItem): DoctorRecord {
  const colVal = (id: string) => item.column_values.find((c) => c.id === id)?.text ?? "";
  const followers: OrderFollower[] = [];
  for (const fc of FOLLOWER_COLS) {
    const name = colVal(fc.name).trim();
    const email = colVal(fc.email).trim();
    if (name || email) followers.push({ name, email });
  }
  return {
    itemId: item.id,
    name: item.name,
    npi: colVal(COL_NPI),
    notes: colVal(COL_DOCTOR_NOTES),
    followers,
    clinic: colVal(COL_CLINIC),
    address: colVal(COL_DOC_ADDRESS),
    phone: colVal(COL_DOC_PHONE),
    fax: colVal(COL_SCRIPT_FAX),
    email: colVal(COL_SCRIPT_EMAIL),
    method: colVal(COL_METHOD),
  };
}

/**
 * Search the Doctor Database by name OR NPI (contains-match), returning every
 * matching item. A single doctor may have multiple items (profiles) — one per
 * clinic location — so the caller groups by NPI and shows each as a location.
 */
export async function searchDoctors(query: string, limit = 50): Promise<DoctorRecord[]> {
  const q = query.trim();
  if (!q) return [];
  // Token matching: every word must appear in the name (or the NPI), so
  // "jason sloane" matches "JASON SLOANE" AND "JASON LOUIS SLOANE". Monday's
  // contains_text is contiguous-substring only, so OR the tokens server-side
  // for a broad candidate pull, then apply the every-token filter here.
  const tokens = q.split(/\s+/).filter(Boolean);
  const rules = [
    ...tokens.map((t) => `{ column_id: "name", compare_value: ${JSON.stringify(t)}, operator: contains_text }`),
    `{ column_id: "${COL_NPI}", compare_value: ${JSON.stringify(q)}, operator: contains_text }`,
  ];
  const gqlQuery = `query {
    boards(ids: ${DOCTOR_DB_BOARD}) {
      items_page(limit: ${limit}, query_params: { operator: or, rules: [${rules.join(", ")}] }) {
        items {
          id
          name
          column_values(ids: [${READ_COLS.map((c) => `"${c}"`).join(", ")}]) { id text }
        }
      }
    }
  }`;
  type Resp = { boards: { items_page: { items: DbItem[] } }[] };
  const data = await gql<Resp>(gqlQuery);
  const items = data.boards?.[0]?.items_page?.items ?? [];
  const normTokens = tokens.map(normName);
  return items.map(toRecord).filter((r) =>
    tokens.every((t, i) => normName(r.name).includes(normTokens[i]) || r.npi.includes(t)),
  );
}

/**
 * Update the contact/location fields on an existing Doctor DB item (profile).
 * Used by the "Edit selected location" action. Only the passed fields are
 * written; clinic is written as a dropdown label (created if missing).
 */
export async function saveDoctorLocation(itemId: string, f: {
  clinic?: string; address?: string; phone?: string; fax?: string; email?: string; method?: string;
}): Promise<void> {
  const cols: Record<string, unknown> = {};
  if (f.clinic !== undefined) cols[COL_CLINIC] = f.clinic ? { labels: [f.clinic] } : { labels: [] };
  if (f.address !== undefined) cols[COL_DOC_ADDRESS] = f.address;
  if (f.phone !== undefined) {
    const d = f.phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    cols[COL_DOC_PHONE] = { phone: d, countryShortName: "US" };
  }
  if (f.fax !== undefined) cols[COL_SCRIPT_FAX] = { email: f.fax, text: f.fax };
  if (f.email !== undefined) cols[COL_SCRIPT_EMAIL] = { email: f.email, text: f.email };
  if (f.method) { const idx = METHOD_INDEX[f.method]; if (idx !== undefined) cols[COL_METHOD] = { index: idx }; }
  const query = `mutation ($item: ID!, $board: ID!, $vals: JSON!) {
    change_multiple_column_values(item_id: $item, board_id: $board, column_values: $vals, create_labels_if_missing: true) { id }
  }`;
  await gql(query, { item: Number(itemId), board: DOCTOR_DB_BOARD, vals: JSON.stringify(cols) });
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
  (fields.followers ?? []).slice(0, FOLLOWER_COLS.length).forEach((f, i) => {
    if (f?.name) cols[FOLLOWER_COLS[i].name] = f.name;
    if (f?.email) cols[FOLLOWER_COLS[i].email] = { email: f.email, text: f.email };
  });
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

/**
 * Write the order-follower name/email pairs (up to 5) back to the Doctor DB
 * item in one mutation. Name is optional — email-only followers are written.
 */
export async function saveDoctorFollowers(itemId: string, followers: OrderFollower[]): Promise<void> {
  const cols: Record<string, unknown> = {};
  FOLLOWER_COLS.forEach((fc, i) => {
    const f = followers[i];
    cols[fc.name] = f?.name ?? "";
    cols[fc.email] = f?.email ? { email: f.email, text: f.email } : { email: "", text: "" };
  });
  const query = `mutation ($item: ID!, $board: ID!, $vals: JSON!) {
    change_multiple_column_values(item_id: $item, board_id: $board, column_values: $vals) { id }
  }`;
  await gql(query, { item: Number(itemId), board: DOCTOR_DB_BOARD, vals: JSON.stringify(cols) });
}
