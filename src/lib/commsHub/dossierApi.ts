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
import { MONDAY_API_URL, hasMondayAuth, mondayIdentityHeaders } from "../shared/mondayEndpoint";
import { BOARDS, type BoardDef } from "../systemMgmt/mondayApi";
import { toE164 } from "../fax/ringcentralApi";
import { contactKey } from "../contactState/contactState";
import { markStuck, nameMatchAccepted, type DossierItem, type PatientIdentity } from "./dossier";
import { appendStampedNote } from "../shared/noteStamp";
import { assertLongTextFits } from "../shared/longText";
import { userInitials } from "../shared/auth";
import type { FaxMatchRow } from "./faxDirectory";
import { stageDetailColumns } from "./stageDetail";

const MONDAY_API_VERSION = "2024-10";

function getToken(): string {
  return (import.meta.env.VITE_MONDAY_API_TOKEN as string | undefined) ?? "";
}

/**
 * Can we reach Monday at all?
 *
 * ⚠️ **`hasMondayAuth()`, NOT a bundled-token check.** In production the SPA
 * runs through the gateway and `VITE_MONDAY_API_TOKEN` is deliberately absent —
 * the gateway injects the token server-side (§5.1). A `!!getToken()` gate is
 * therefore FALSE in exactly the deployment that matters, and its failure mode
 * is silent: every dossier renders "this number isn't on any pipeline board"
 * and every fax matches no provider, with nothing erroring. `getToken()` is
 * still sent as the Authorization header below, empty or not, because that is
 * what the gateway expects and ignores.
 */
export function dossierConfigured(): boolean {
  return hasMondayAuth();
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

/**
 * Date of birth, per board — the corroborating identity signal behind
 * `nameMatchAccepted`. The five pipeline boards share one column id (it is
 * copied across board hops); Subscription and Secondary Claims have their own.
 *
 * ⚠️ A board absent from this table yields a BLANK dob, which makes a
 * blank-phone name match on it fail closed. DTC Intake is deliberately absent:
 * it is the read-only top of the funnel (§3), so the cost is at most one
 * missing first chip on a patient's path — and failing closed is the direction
 * that cannot put another patient's notes on this conversation.
 */
const DOB_COLS: Record<number, string> = {
  18406352652: "text_mm1xvxst", // Profile Send Off
  18406060017: "text_mm1xvxst", // Medical Evaluation
  18410601299: "text_mm1xvxst", // Insurance
  18410804557: "text_mm1xvxst", // Welcome Call
  18407459988: "text_mkvdefh1", // Subscription
  18413019028: "text_mkp3y5ax", // Secondary Claims
};

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
    dob: textOf(it, DOB_COLS[board.boardId] ?? null).trim(),
    route: routeFor(board, groupId),
    stageAdvancerText: textOf(it, board.stageAdvancerColId).trim(),
    notes: textOf(it, board.notesColId),
    notesColId: board.notesColId ?? "",
    notesColType: board.notesColType,
    nextActionDate: textOf(it, board.nextActionDateColId).trim(),
    daysSinceStage: textOf(it, board.daysSinceStageColId).trim(),
    cols: Object.fromEntries(
      (it.column_values ?? []).map((c) => [c.id, (c.text ?? "").trim()]),
    ),
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
    // ⚠️ Without this the DOB reads "" on every record and every blank-phone
    // name match fails closed — safe, but it would silently drop the completed
    // records the name pass exists to find.
    DOB_COLS[board.boardId] ?? null,
    // The per-stage facts the dossier pane shows. Named in one place
    // (stageDetail.ts) so a new field cannot go silently blank for want of a
    // matching entry in a hand-maintained read set (§5.11).
    ...stageDetailColumns(board.boardId),
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
  // never pull in a stranger who happens to share a name with somebody.
  const name = byPhone.find((i) => i.name.trim())?.name.trim() ?? "";
  // The anchor identity comes from the PHONE pass, so everything the name pass
  // admits is checked against a record we already know is this patient's.
  const anchor: PatientIdentity = { phone: want, dob: byPhone.find((i) => i.dob)?.dob ?? "" };
  const byName = name
    ? (await Promise.all(BOARDS.map(async (b) => (await boardSearch(b, "name", name)).map((it) => toDossierItem(b, it)))))
        .flat()
        .filter((i) => i.name.trim().toLowerCase() === name.toLowerCase())
        // ⚠️ A name is not an identity — see `nameMatchAccepted`.
        .filter((i) => nameMatchAccepted(i, anchor))
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


/* ── Writing a note from the hub ───────────────────────────────────────────── */

/**
 * Read one item's notes column, right now.
 *
 * ⚠️ **This is the whole safety of the append below.** Monday has no
 * compare-and-set on a column write: `change_column_value` REPLACES the value.
 * So whatever body we build has to be built on the freshest text we can get,
 * and the dossier's own copy is memoised for the session — minutes or hours
 * old by the time a rep types. Between then and now another rep can have added
 * a note on the role page, or an automation can have stamped an escalation
 * reason, and appending onto the stale copy would silently DELETE theirs.
 */
async function readNotesNow(boardId: number, itemId: string, columnId: string): Promise<string> {
  const data = await gql<{ items: Array<{ column_values?: Array<{ id: string; text: string | null }> }> }>(
    `query ($ids: [ID!], $cols: [String!]) {
       items (ids: $ids) { column_values (ids: $cols) { id text } }
     }`,
    { ids: [itemId], cols: [columnId] },
  );
  const found = data.items?.[0]?.column_values?.find((c) => c.id === columnId);
  if (!found) {
    // The item or column is gone. Refusing beats appending onto "" and wiping
    // the history we could not read.
    throw new Error("Couldn't read the current notes, so nothing was written.");
  }
  void boardId;
  return found.text ?? "";
}

/**
 * Append a stamped note to the patient's CURRENT stage, from the dossier pane.
 *
 * The hub is where a rep learns things — the patient mentions they are away
 * next week, the office says the doctor has left. Until now that had to be
 * retyped on the role page, so in practice it was lost. This writes the same
 * stamped line every role's NotesPanel writes, through the same helper, so a
 * note added here is indistinguishable from one added on the stage page.
 *
 * ⚠️ **The base is RE-READ immediately before the write**, never the dossier's
 * cached copy — see `readNotesNow`. That narrows the lost-update window to one
 * round trip, which is the same exposure every other note path in the app
 * carries (they append onto a 15-second poll); the cached copy would have made
 * it unbounded.
 *
 * ⚠️ **Stamped with the SUB-STAGE where there is one**, not just the board.
 * Several roles share one notes column (§9), and "Chase Clinicals" tells the
 * next reader far more than "Medical Evaluation" does.
 *
 * ⚠️ **`assertLongTextFits` before writing — on a `long_text` column ONLY.**
 * Monday long-text columns hold 2000 characters and TRUNCATE SILENTLY: a
 * longer write returns success and stores the first 2000, so what gets dropped
 * is always the note somebody just typed (§10). Nine items on the ME board
 * already sit at exactly 2000. Failing loudly is the point; trimming old
 * history to make room is the same harm, chosen by us. That limit is a
 * long_text limit and is NOT applied to a `text` column — a scan of Profile
 * Send Off on 2026-09-02 found live values up to 9,383 characters there and
 * none parked at a ceiling, so asserting 2000 would refuse writes the board
 * demonstrably accepts. `profile/unverifiedWrite.appendIntakeNote` writes that
 * same column with no length assertion for the same reason.
 *
 * ⚠️ **THE VALUE SHAPE FOLLOWS THE COLUMN TYPE, and getting it wrong is a
 * total, board-specific failure.** `long_text` takes `{"text": "…"}`; `text`
 * takes a bare JSON string. Hand Monday the long_text shape for a text column
 * and it answers *"invalid value, please check our API documentation for the
 * correct data structure for this column"* — 200 OK with a GraphQL `errors[]`,
 * so the rep gets a red toast full of Monday's protocol text and nothing is
 * written.
 *
 * This shipped that way (2026-09-01) and failed on **every Profile Send Off
 * record** — `text_mm389fs` is the one `text`-typed notes column in the
 * registry, and it belongs to the top of the funnel, i.e. exactly the patients
 * a rep is most often on the phone with in this hub. Every other board is
 * long_text, so the composer looked fine wherever anyone tried it first.
 * `profile/unverifiedWrite.appendIntakeNote` already carried a comment warning
 * about this exact crossing; it could not help a second consumer in another
 * file, which is why the type is now declared on `BoardDef` and carried on the
 * record (`DossierItem.notesColType`) rather than assumed here.
 *
 * Returns the new full body so the caller can show it without a re-read.
 */
export async function appendNoteToRecord(opts: {
  boardId: number;
  itemId: string;
  columnId: string;
  /** Which kind of column that is — decides the value shape AND whether the
   *  2000-character long_text guard applies. Comes from `DossierItem
   *  .notesColType`, i.e. from the board registry, never from a guess here. */
  columnType: "text" | "long_text" | null;
  text: string;
  /** Stage label for the stamp, e.g. "Chase Clinicals". */
  stage: string;
  /** The number this dossier was looked up by, so the cache can be updated. */
  phone: string;
}): Promise<string> {
  const body = (opts.text || "").trim();
  if (!body) throw new Error("Nothing to add");
  if (!opts.columnId) throw new Error("This board has no notes column to write to.");
  // A column whose type the registry does not declare must not be guessed at:
  // one of the two shapes would be rejected outright and the other could write
  // a `{"text": …}` object into a text column's face. Refusing names the fix.
  if (opts.columnType !== "text" && opts.columnType !== "long_text") {
    throw new Error(
      "This board's notes column has no declared type, so the note was not written. " +
        "Add `notesColType` for it in systemMgmt/mondayApi BOARDS.",
    );
  }

  const existing = await readNotesNow(opts.boardId, opts.itemId, opts.columnId);
  const next = appendStampedNote(existing, body, opts.stage, { initials: userInitials() });
  if (opts.columnType === "long_text") assertLongTextFits(next, `${opts.stage || "Stage"} notes`);

  const value = JSON.stringify(opts.columnType === "long_text" ? { text: next } : next);
  await gql(
    `mutation ($item: ID!, $board: ID!, $col: String!, $val: JSON!) {
       change_column_value(item_id: $item, board_id: $board, column_id: $col, value: $val) { id }
     }`,
    { item: opts.itemId, board: String(opts.boardId), col: opts.columnId, val: value },
  );

  // Keep the memoised trail in step, or re-selecting the patient shows the
  // note missing until the cache expires — which it never does in a session.
  const cached = dossierCache.get(toE164(opts.phone));
  if (cached) {
    const hit = cached.find((i) => i.itemId === opts.itemId && i.boardId === opts.boardId);
    if (hit) hit.notes = next;
  }
  return next;
}
