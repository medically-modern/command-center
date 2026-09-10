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
import { BOARDS, phoneColIdsFor } from "../systemMgmt/mondayApi";
import { toE164 } from "../fax/ringcentralApi";
import { lookupDirectory } from "../commsHub/directoryApi";

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
  /** Every normalisable number this item carries, primary first. The narrowing
   *  in `findPatientByPhone` compares against ALL of them — otherwise a
   *  caregiver's call matched the row and was then thrown away for not equalling
   *  the patient's own number. */
  phones?: string[];
}

/** Every phone column on every board — the READ set, so a matched item can be
 *  named whichever of its numbers matched. Includes the Alternate Phone
 *  columns added 2026-09-10 (§5.31d): a caregiver ringing from their own
 *  number is exactly who that column exists to resolve. */
const PHONE_COL_IDS = [...new Set(BOARDS.flatMap((b) => phoneColIdsFor(b)))];
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
  // ⚠️ With Alternate Phone in the read set (§5.31d) an item can carry TWO
  // usable numbers, and this picks the first in `PHONE_COL_IDS` order, i.e. a
  // PRIMARY. That is right for a row's displayed number, and it is why
  // `findPatientByPhone` matches on `phones` below rather than on this one.
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
    phones: (it.column_values ?? [])
      .filter((c) => PHONE_COL_IDS.includes(c.id))
      .map((c) => toE164(c.text || ""))
      .filter(Boolean),
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

  /**
   * ⚠️ **Postgres first, and this is the one caller where that really matters:
   * this runs WHILE THE PHONE IS RINGING.** `IncomingCallHost` calls it the
   * moment a call arrives, to put a name on the card the rep is about to press
   * "Take it" on — and the fan-out below is seven Monday queries, on a budget
   * shared with every page the office has open. The directory answers the same
   * question from one indexed row.
   *
   * A miss falls through to the live fan-out unchanged, so a patient created
   * this morning — or an outage, or a directory that has never run — costs the
   * old behaviour rather than an anonymous card.
   */
  try {
    const hit = (await lookupDirectory([want])).hits.get(want.replace(/\D/g, "").slice(-10));
    if (hit) {
      return {
        itemId: hit.itemId,
        name: hit.name,
        // The caller asked about this number, so it IS the patient's — the
        // directory stores only a hash and could not return it.
        phone: want,
        boardId: hit.boardId === null ? "" : String(hit.boardId),
        boardName: hit.boardName,
      };
    }
  } catch {
    /* the fan-out below is the fallback — never let this path fail a ringing call */
  }

  const perBoard = await Promise.all(
    BOARDS.map(async (b) => {
      try {
        const data = await gql<{ boards: Array<{ items_page?: { items: RawItem[] } }> }>(
          /* ⚠️ `operator: or` across this board's phone columns. The last four
             digits are in the primary number OR the alternate, never both, so
             the default AND would match nobody — and Monday answers that with
             200 and an empty list, which reads exactly like "this caller is not
             a patient". One rule per column, ORed. */
          `query ($board: [ID!], $q: CompareValue!, $cols: [String!]) {
             boards (ids: $board) {
               items_page (
                 limit: 50,
                 query_params: { rules: [${phoneColIdsFor(b)
                   .map((c) => `{ column_id: ${JSON.stringify(c)}, compare_value: $q, operator: contains_text }`)
                   .join(", ")}], operator: or }
               ) {
                 items { id name board { id } column_values (ids: $cols) { id text } }
               }
             }
           }`,
          { board: [String(b.boardId)], q: [tail], cols: PHONE_COL_IDS },
        );
        return (data.boards?.[0]?.items_page?.items ?? []).map(toPatientRef);
      } catch {
        // One board failing must not leave the caller anonymous everywhere.
        return [];
      }
    }),
  );

  /* ⚠️ Compared against EVERY number on the row, not just the displayed one.
     The wide `contains_text` net can match on Alternate Phone, and narrowing
     to `p.phone` alone would then discard that row for not equalling the
     patient's primary — the caregiver's call would come up anonymous having
     been found. */
  return perBoard.flat().find((p) => (p.phones ?? [p.phone]).includes(want)) ?? null;
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
