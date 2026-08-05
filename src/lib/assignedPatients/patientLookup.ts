/**
 * Cross-board patient lookup for Assigned Patients.
 *
 * The assignment store deliberately holds no patient data — just an HMAC of the
 * number and a Monday item id (see services/monday-gateway/assignments.mjs). So
 * every name and phone number on screen is resolved from Monday at render time,
 * which is what this module does.
 *
 * Boards and their phone columns come from systemMgmt's BOARDS registry rather
 * than a second hardcoded list, so a board added there is picked up here too.
 */
import { MONDAY_API_URL, mondayIdentityHeaders } from "../shared/mondayEndpoint";
import { BOARDS } from "../systemMgmt/mondayApi";
import { toE164 } from "../fax/ringcentralApi";

const MONDAY_API_VERSION = "2024-10";

function getToken(): string {
  return (import.meta.env.VITE_MONDAY_API_TOKEN as string | undefined) ?? "";
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: getToken(),
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

export interface PatientRef {
  itemId: string;
  name: string;
  phone: string;
  boardId: string;
  boardName: string;
}

const PHONE_COL_IDS = [...new Set(BOARDS.map((b) => b.phoneColId))];
const boardName = (id: string): string =>
  BOARDS.find((b) => String(b.boardId) === String(id))?.boardName || "";

interface RawItem {
  id: string;
  name: string;
  board?: { id: string } | null;
  column_values?: Array<{ id: string; text: string | null }>;
}

function toPatientRef(it: RawItem): PatientRef {
  // Boards use different phone column ids; take the first one that has a value.
  // Take the first phone column that yields a NORMALISABLE number — a board
  // whose value is partial or malformed must not shadow one that's usable.
  const phoneCol = (it.column_values ?? []).find(
    (c) => PHONE_COL_IDS.includes(c.id) && toE164(c.text || ""),
  );
  const bid = it.board?.id ? String(it.board.id) : "";
  return {
    itemId: String(it.id),
    name: it.name || "",
    phone: toE164(phoneCol?.text || ""),
    boardId: bid,
    boardName: boardName(bid),
  };
}

/** Resolve assignment rows (item ids) to displayable patients.
 *  Monday drops ids it can't find — a deleted item simply won't come back, and
 *  callers should treat a missing id as an assignment to clean up rather than
 *  an error. */
export async function fetchPatientsByItemIds(itemIds: string[]): Promise<PatientRef[]> {
  const ids = [...new Set((itemIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const out: PatientRef[] = [];
  // Monday caps items(ids:) — chunk so a big rep list doesn't blow the limit.
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const data = await gql<{ items: RawItem[] }>(
      `query ($ids: [ID!], $cols: [String!]) {
         items (ids: $ids) {
           id name
           board { id }
           column_values (ids: $cols) { id text }
         }
       }`,
      { ids: chunk, cols: PHONE_COL_IDS },
    );
    out.push(...(data.items ?? []).map(toPatientRef));
  }
  return out;
}

/**
 * Who is calling — resolve an inbound number to a patient across every board.
 *
 * ⚠️ Matched on the LAST FOUR DIGITS, then filtered by normalised equality.
 * That looks backwards until you try it the obvious way: boards store phone
 * numbers in whatever shape they were typed, so a `contains_text` search for
 * "3475550101" misses "(347) 555-0101" and a search for "555-0101" misses the
 * unformatted one. The last four digits are the only substring present in every
 * rendering. The wide net is then narrowed by toE164 comparison, so a coincidental
 * "0101" elsewhere in the column can't return the wrong patient.
 *
 * Returns null rather than throwing — a caller we can't name still has to ring.
 */
export async function findPatientByPhone(phone: string): Promise<PatientRef | null> {
  const want = toE164(phone);
  if (!want) return null;
  const tail = want.replace(/\D/g, "").slice(-4);
  if (tail.length < 4) return null;

  const perBoard = await Promise.all(
    BOARDS.map(async (b) => {
      try {
        const data = await gql<{ boards: Array<{ items_page?: { items: RawItem[] } }> }>(
          `query ($board: [ID!], $q: CompareValue!, $cols: [String!], $col: String!) {
             boards (ids: $board) {
               items_page (
                 limit: 50,
                 query_params: { rules: [{ column_id: $col, compare_value: $q, operator: contains_text }] }
               ) {
                 items { id name board { id } column_values (ids: $cols) { id text } }
               }
             }
           }`,
          { board: [String(b.boardId)], q: [tail], cols: PHONE_COL_IDS, col: b.phoneColId },
        );
        return (data.boards?.[0]?.items_page?.items ?? []).map(toPatientRef);
      } catch {
        // One board failing must not leave the caller anonymous everywhere.
        return [];
      }
    }),
  );

  return perBoard.flat().find((p) => p.phone && p.phone === want) ?? null;
}

/** Search patients by name across every pipeline board, for the manager's
 *  assign dialog. Returns at most `limit` per board. */
export async function searchPatientsByName(query: string, limit = 10): Promise<PatientRef[]> {
  const q = (query || "").trim();
  if (q.length < 2) return [];
  const results = await Promise.all(
    BOARDS.map(async (b) => {
      try {
        const data = await gql<{
          boards: Array<{ items_page?: { items: RawItem[] } }>;
        }>(
          `query ($board: [ID!], $q: CompareValue!, $cols: [String!], $limit: Int!) {
             boards (ids: $board) {
               items_page (
                 limit: $limit,
                 query_params: { rules: [{ column_id: "name", compare_value: $q, operator: contains_text }] }
               ) {
                 items { id name board { id } column_values (ids: $cols) { id text } }
               }
             }
           }`,
          { board: [String(b.boardId)], q: [q], cols: PHONE_COL_IDS, limit },
        );
        return (data.boards?.[0]?.items_page?.items ?? []).map(toPatientRef);
      } catch {
        // One board failing (permissions, a renamed column) must not blank the
        // whole search — the other boards still return.
        return [];
      }
    }),
  );
  const seen = new Set<string>();
  return results.flat().filter((p) => {
    if (seen.has(p.itemId)) return false;
    seen.add(p.itemId);
    return true;
  });
}
