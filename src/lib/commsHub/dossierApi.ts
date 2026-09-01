/**
 * Monday reads for the Communications Hub: one patient's trail across every
 * board, and the reverse lookup from an inbound fax to a doctor's patients.
 *
 * Board ids and column ids come from systemMgmt's `BOARDS` registry rather than
 * a second hardcoded list, so a board added there is picked up here too — the
 * same reasoning `patientLookup.ts` gives. The DOCTOR columns are the one thing
 * BOARDS does not carry, so they live here, in one table.
 *
 * ⚠️ Every read here is **on click**, never on render. A rep clicks through a
 * lot of conversations, so each lookup is also memoised for the session: the
 * trail behind a phone number does not change while somebody reads a text.
 */
import { MONDAY_API_URL, mondayIdentityHeaders } from "../shared/mondayEndpoint";
import { BOARDS, type BoardDef } from "../systemMgmt/mondayApi";
import { toE164 } from "../fax/ringcentralApi";
import { contactKey } from "../contactState/contactState";
import { markStuck, type DossierItem } from "./dossier";
import type { FaxMatchRow } from "./faxDirectory";

const MONDAY_API_VERSION = "2024-10";

function getToken(): string {
  return (import.meta.env.VITE_MONDAY_API_TOKEN as string | undefined) ?? "";
}

export function dossierConfigured(): boolean {
  return !!getToken();
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

interface RawItem {
  id: string;
  name: string;
  group?: { id: string; title: string } | null;
  column_values?: Array<{ id: string; text: string | null }>;
}

const textOf = (it: RawItem, colId: string | null): string =>
  (colId ? (it.column_values ?? []).find((c) => c.id === colId)?.text : "") ?? "";

/** Which groups on this board mean "finished", per the BOARDS registry. */
function completedGroupIds(board: BoardDef): Set<string> {
  return new Set(board.groupRoutes.filter((g) => g.isCompleted).map((g) => g.id));
}

/** Where a record on this board opens. Falls back to the board's first routed
 *  group, so a record in a group the registry doesn't route is still clickable
 *  rather than a dead end. */
function routeFor(board: BoardDef, groupId: string): string {
  const exact = board.groupRoutes.find((g) => g.id === groupId)?.roleRoute;
  if (exact) return exact;
  return board.groupRoutes.find((g) => g.roleRoute)?.roleRoute ?? "";
}

function toDossierItem(board: BoardDef, it: RawItem): DossierItem {
  const groupId = it.group?.id ?? "";
  const groupTitle = it.group?.title ?? "";
  const base = {
    itemId: String(it.id),
    name: it.name || "",
    phone: toE164(textOf(it, board.phoneColId)),
    boardId: board.boardId,
    boardName: board.boardName,
    groupId,
    groupTitle,
    isCompleted: completedGroupIds(board).has(groupId),
    route: routeFor(board, groupId),
    stageAdvancerText: textOf(it, board.stageAdvancerColId).trim(),
    notes: textOf(it, board.notesColId),
    nextActionDate: textOf(it, board.nextActionDateColId).trim(),
    daysSinceStage: textOf(it, board.daysSinceStageColId).trim(),
  };
  return { ...base, isStuck: markStuck(base) };
}

const DOSSIER_QUERY = `
  query ($board: [ID!], $col: ID!, $q: CompareValue!, $cols: [String!], $limit: Int!) {
    boards (ids: $board) {
      items_page (
        limit: $limit,
        query_params: { rules: [{ column_id: $col, compare_value: $q, operator: contains_text }] }
      ) {
        items { id name group { id title } column_values (ids: $cols) { id text } }
      }
    }
  }`;

function dossierCols(board: BoardDef): string[] {
  return [
    board.phoneColId,
    board.stageAdvancerColId,
    board.notesColId,
    board.nextActionDateColId,
    board.daysSinceStageColId,
  ].filter((c): c is string => !!c);
}

async function boardSearch(board: BoardDef, colId: string, needle: string, limit = 25): Promise<RawItem[]> {
  try {
    const data = await gql<{ boards: Array<{ items_page?: { items: RawItem[] } }> }>(DOSSIER_QUERY, {
      board: [String(board.boardId)],
      col: colId,
      q: [needle],
      cols: dossierCols(board),
      limit,
    });
    return data.boards?.[0]?.items_page?.items ?? [];
  } catch {
    // One board failing (permissions, a renamed column) must not blank the
    // whole trail — the other boards still answer. Same posture as
    // patientLookup's cross-board search.
    return [];
  }
}

/** Session cache. The trail behind a number does not change while a rep reads
 *  a text, and they click through conversations quickly. */
const dossierCache = new Map<string, DossierItem[]>();

/**
 * Every board record for the patient on this number.
 *
 * ⚠️ **Two passes, and the second one is not optional.** The phone pass finds
 * the records whose phone column carries the number — which is most of them,
 * since the column is copied across board hops. But a COMPLETED record can
 * carry a blank or differently-typed phone, and the completed records are
 * exactly what the stage history is made of, so a phone-only lookup would draw
 * a patient's path with the finished stages missing. The name pass fills those
 * in. Name matching is what `buildCompletionMap` uses for the same reason: the
 * name is all the boards genuinely share (§7).
 *
 * ⚠️ Matched on the LAST FOUR digits then narrowed by `toE164` equality — the
 * boards store numbers in whatever shape they were typed, so the last four are
 * the only substring present in every rendering (`patientLookup` documents the
 * same trick).
 */
export async function fetchDossierItems(phone: string): Promise<DossierItem[]> {
  const want = toE164(phone);
  if (!want || !dossierConfigured()) return [];
  const cached = dossierCache.get(want);
  if (cached) return cached;

  const tail = want.replace(/\D/g, "").slice(-4);
  if (tail.length < 4) return [];

  const byPhone = (
    await Promise.all(BOARDS.map(async (b) => (await boardSearch(b, b.phoneColId, tail)).map((it) => toDossierItem(b, it))))
  )
    .flat()
    .filter((i) => i.phone === want);

  // The name to search for comes from the phone pass, so a wrong number can
  // never pull in a stranger who happens to share a name.
  const name = byPhone.find((i) => i.name.trim())?.name.trim() ?? "";
  const byName = name
    ? (await Promise.all(BOARDS.map(async (b) => (await boardSearch(b, "name", name)).map((it) => toDossierItem(b, it)))))
        .flat()
        .filter((i) => i.name.trim().toLowerCase() === name.toLowerCase())
    : [];

  const seen = new Set<string>();
  const items = [...byPhone, ...byName].filter((i) => {
    const k = `${i.boardId}:${i.itemId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  dossierCache.set(want, items);
  return items;
}

/* ── Fax → doctor → their patients ─────────────────────────────────────────── */

/**
 * The doctor block, per board.
 *
 * ⚠️ Not in the BOARDS registry, which carries only what Search needs. The
 * four pipeline boards share one set of ids (the columns are copied across
 * board hops); Subscription has its own, and its clinic name lives in an
 * address column rather than the dropdown the others use.
 *
 * A board absent from this table simply isn't searched — DTC Intake and
 * Secondary Claims carry no doctor fax.
 */
const DOCTOR_COLS: Record<number, { fax: string; name: string; npi: string; clinic: string | null; phone: string }> = {
  18406352652: { fax: "email_mm1xdzcj", name: "text_mm1x46et", npi: "text_mm1x7d91", clinic: "dropdown_mm1xbvas", phone: "phone_mm1xz8c0" },
  18406060017: { fax: "email_mm1xdzcj", name: "text_mm1x46et", npi: "text_mm1x7d91", clinic: "dropdown_mm1xbvas", phone: "phone_mm1xz8c0" },
  18410601299: { fax: "email_mm1xdzcj", name: "text_mm1x46et", npi: "text_mm1x7d91", clinic: "dropdown_mm1xbvas", phone: "phone_mm1xz8c0" },
  18410804557: { fax: "email_mm1xdzcj", name: "text_mm1x46et", npi: "text_mm1x7d91", clinic: "dropdown_mm1xbvas", phone: "phone_mm1xz8c0" },
  18407459988: { fax: "email_mkxn9af2", name: "text_mkxn3wza", npi: "text_mkxnkgzg", clinic: null, phone: "phone_mkxnv7e5" },
};

/** Clinicals Method — which chase queue a patient is in (§5.9). Same id on the
 *  four pipeline boards that carry it. */
const CLINICALS_METHOD_COL = "color_mm1xw7y5";

const faxCache = new Map<string, FaxMatchRow[]>();

/**
 * Every patient record naming this fax number as their doctor's.
 *
 * The `contains_text` rule runs on the last four digits, because the column
 * holds `<digits>@rcfax.com` on some rows and a hand-typed number on others —
 * `faxDigits` then does the exact comparison in `buildFaxDirectory`.
 */
export async function fetchFaxMatches(faxNumber: string): Promise<FaxMatchRow[]> {
  const digits = contactKey(faxNumber);
  if (digits.length !== 10 || !dossierConfigured()) return [];
  const cached = faxCache.get(digits);
  if (cached) return cached;

  const tail = digits.slice(-4);
  const rows = (
    await Promise.all(
      BOARDS.filter((b) => DOCTOR_COLS[b.boardId]).map(async (board) => {
        const dc = DOCTOR_COLS[board.boardId];
        const cols = [
          ...dossierCols(board),
          dc.fax,
          dc.name,
          dc.npi,
          dc.phone,
          CLINICALS_METHOD_COL,
          ...(dc.clinic ? [dc.clinic] : []),
        ];
        try {
          const data = await gql<{ boards: Array<{ items_page?: { items: RawItem[] } }> }>(
            DOSSIER_QUERY,
            { board: [String(board.boardId)], col: dc.fax, q: [tail], cols, limit: 100 },
          );
          const items = data.boards?.[0]?.items_page?.items ?? [];
          return items.map((it): FaxMatchRow => {
            const base = toDossierItem(board, it);
            return {
              itemId: base.itemId,
              name: base.name,
              boardId: base.boardId,
              boardName: base.boardName,
              groupTitle: base.groupTitle,
              isCompleted: base.isCompleted,
              isStuck: base.isStuck,
              route: base.route,
              stage: base.stageAdvancerText,
              clinicalsMethod: textOf(it, CLINICALS_METHOD_COL).trim(),
              nextActionDate: base.nextActionDate,
              doctorName: textOf(it, dc.name).trim(),
              clinicName: dc.clinic ? textOf(it, dc.clinic).trim() : "",
              npi: textOf(it, dc.npi).trim(),
              doctorPhone: textOf(it, dc.phone).trim(),
              doctorFax: textOf(it, dc.fax).trim(),
            };
          });
        } catch {
          return [];
        }
      }),
    )
  ).flat();

  faxCache.set(digits, rows);
  return rows;
}

/** Test seam / manual refresh — drops both memoised lookups. */
export function clearDossierCaches(): void {
  dossierCache.clear();
  faxCache.clear();
}
