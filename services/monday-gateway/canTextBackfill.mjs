/**
 * canTextBackfill.mjs — fill in **Can Text** for the patients we can already
 * prove receive texts (CLAUDE.md §5.31d).
 *
 * ── WHY THIS LIVES ON THE GATEWAY ──
 * It cannot live in the SPA repo as an ordinary script, and that is structural
 * rather than a preference: the evidence is `sms_archive`, whose rows are keyed
 * by **`phone_hmac`** and never by a number (§5.27's PHI rule). Hashing a board
 * number to look it up needs `PHONE_HMAC_PEPPER`, which is a Railway variable
 * and deliberately exists nowhere else. So the join has to happen where the
 * pepper and the database already are — here — and it is one indexed query per
 * number rather than 449 API round trips.
 *
 * ── DRY RUN IS THE DEFAULT, AND IT IS NOT A FORMALITY ──
 * Nothing is written unless `CANTEXT_BACKFILL_APPLY=1`. This is a bulk write
 * against live PHI rows; §10 records what an unattended bulk writer did to the
 * Welcome Call board on 2026-09-02 (73 writes, every one refused at HTTP 200,
 * nothing thrown, nothing noticed). A dry run prints exactly the same numbers
 * the real run would act on, computed by the same pure code, so reading it is
 * worth something.
 *
 * ⚠️ **It only ever writes "Yes".** See `canTextRules.canTextFromMessages` for
 * the argument; the short version is that a wrong Yes costs nothing a rep
 * cannot see, and a wrong No silently moves a patient's reorders onto a call
 * queue. Where the archive is silent the column stays blank and the rep answers
 * it on the call, which the send gate already requires.
 *
 * ⚠️ **The archive is younger than the boards.** It began on 2026-08-01, so a
 * patient last texted in June looks identical to one never texted. That is a
 * reason to run this repeatedly as the archive grows, not a reason to guess.
 *
 * Run:
 *   node canTextBackfill.mjs              # dry run — prints, writes nothing
 *   CANTEXT_BACKFILL_APPLY=1 node canTextBackfill.mjs
 */
import { DIRECTORY_BOARDS, phoneColIdsFor } from "./patientDirectoryRules.mjs";
import { canTextFromMessages, needsCanTextBackfill, summarise } from "./canTextRules.mjs";

const MONDAY_URL = process.env.MONDAY_API_URL || "https://api.monday.com/v2";
const TOKEN = process.env.MONDAY_API_TOKEN || "";
const VER = process.env.MONDAY_API_VERSION || "2024-10";
const APPLY = process.env.CANTEXT_BACKFILL_APPLY === "1";
const PAGE_SIZE = Number(process.env.CANTEXT_BACKFILL_PAGE_SIZE || 200);

/**
 * The two boards that HAVE a Can Text column (§5.31d). Derived from the shared
 * board table rather than re-listed, so a board added there is not silently
 * missed — but named explicitly, because the other five have no such column and
 * writing to a column id they do not carry is refused at HTTP 200 (§10).
 */
const CAN_TEXT_BOARDS = [
  { boardId: 18410804557, canTextColId: "color_mm72v5q7" },
  { boardId: 18407459988, canTextColId: "color_mm72jg9e" },
];

/** Label id for "Yes", read back off the live board 2026-09-10. ⚠️ Monday
 *  derived it from the label COLOUR, not the index the create call asked for,
 *  and a write to an id that does not exist is dropped with NO error. */
const YES_LABEL_ID = 1;

async function callMonday(query, variables) {
  const r = await fetch(MONDAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: TOKEN, "API-Version": VER },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json().catch(() => null);
  /* ⚠️ Monday answers a refused write with HTTP 200 and an `errors[]` body
   * (§10). A bulk job that does not read it reports a clean run having written
   * nothing — which is exactly how the 2026-09-02 clinic-address backfill
   * failed 73 times in silence. */
  if (j?.errors?.length) {
    throw new Error(`Monday: ${j.errors.map((e) => e?.message ?? String(e)).join("; ")}`);
  }
  return j?.data ?? null;
}

const PAGE = `
  query ($board: [ID!], $cols: [String!], $limit: Int!, $cursor: String) {
    boards (ids: $board) {
      items_page (limit: $limit, cursor: $cursor) {
        cursor
        items { id name column_values (ids: $cols) { id text } }
      }
    }
  }`;

/** Every item on one board, with its phone columns and its Can Text. */
async function scanBoard(board, canTextColId) {
  const cols = [...phoneColIdsFor(board), canTextColId];
  const out = [];
  let cursor = null;
  for (;;) {
    const data = await callMonday(PAGE, {
      board: [String(board.boardId)],
      cols,
      limit: PAGE_SIZE,
      cursor,
    });
    const page = data?.boards?.[0]?.items_page;
    for (const it of page?.items ?? []) {
      const cv = (id) => (it.column_values ?? []).find((c) => c?.id === id)?.text ?? "";
      out.push({
        itemId: String(it.id),
        name: it.name ?? "",
        // The PRIMARY number is what Can Text describes — the alternate has no
        // column of its own, so it is deliberately not consulted here.
        phone: cv(board.phoneColId),
        canText: cv(canTextColId),
      });
    }
    cursor = page?.cursor ?? null;
    if (!cursor) break;
  }
  return out;
}

/**
 * Run it.
 *
 * @param {object} deps
 * @param {(e164: string) => string} deps.phoneHmac  the gateway's own hasher
 * @param {(hmac: string) => Promise<Array<object>>} deps.messagesFor
 * @param {(raw: string) => string} deps.toE164
 */
export async function runCanTextBackfill({ phoneHmac, messagesFor, toE164, log = console.log }) {
  const decisions = [];

  for (const { boardId, canTextColId } of CAN_TEXT_BOARDS) {
    const board = DIRECTORY_BOARDS.find((b) => b.boardId === boardId);
    if (!board) {
      // Loud, not skipped: a board that fell out of the shared table means the
      // two lists have drifted and this job is quietly doing half its work.
      throw new Error(`canTextBackfill: board ${boardId} is not in DIRECTORY_BOARDS`);
    }
    const rows = await scanBoard(board, canTextColId);
    log(`${board.name}: ${rows.length} items`);

    for (const row of rows) {
      const eligible = needsCanTextBackfill(row);
      if (!eligible) {
        decisions.push({ ...row, eligible: false, verdict: "" });
        continue;
      }
      const e164 = toE164(row.phone);
      if (!e164) {
        decisions.push({ ...row, eligible: false, verdict: "" });
        continue;
      }
      const verdict = canTextFromMessages(await messagesFor(phoneHmac(e164)));
      decisions.push({ ...row, boardId, canTextColId, eligible: true, verdict });
    }
  }

  const writes = decisions.filter((d) => d.eligible && d.verdict === "yes");
  const summary = summarise(decisions);
  log(
    `\n${APPLY ? "APPLYING" : "DRY RUN"} — scanned ${summary.scanned}, ` +
      `${summary.eligible} with a number and a blank Can Text, ` +
      `${summary.yes} provable Yes, ${summary.unknown} left blank (no archived texts).`,
  );

  if (!APPLY) {
    log("Nothing written. Re-run with CANTEXT_BACKFILL_APPLY=1 to write the Yes rows.");
    return { ...summary, written: 0, failed: 0 };
  }

  let written = 0;
  let failed = 0;
  for (const w of writes) {
    try {
      await callMonday(
        `mutation ($board: ID!, $item: ID!, $col: String!, $val: JSON!) {
           change_column_value (board_id: $board, item_id: $item, column_id: $col, value: $val) { id }
         }`,
        {
          board: String(w.boardId),
          item: w.itemId,
          col: w.canTextColId,
          val: JSON.stringify({ index: YES_LABEL_ID }),
        },
      );
      written += 1;
    } catch (e) {
      // Counted and reported, never swallowed — see the errors[] note above.
      failed += 1;
      log(`  FAILED ${w.name} (${w.itemId}): ${e?.message ?? e}`);
    }
  }
  log(`Wrote ${written}, failed ${failed}.`);
  return { ...summary, written, failed };
}
