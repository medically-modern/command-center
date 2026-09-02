/**
 * patientDirectoryRules.mjs — the pure half of the patient name directory.
 *
 * No `pg`, no `fetch`, no express, so every rule here is unit-testable without
 * a database or a network. Same split as `callRules` vs `inboundCalls`,
 * `smsArchiveRules` vs `smsArchive`, and `callHistoryQuery` vs its route.
 */

/**
 * Which boards carry patients, and where their phone lives.
 *
 * ⚠️ This MIRRORS the SPA's `systemMgmt/mondayApi.ts` BOARDS registry — the
 * same hand-synced-contract hazard CLAUDE.md §5.7 records for the OOP estimator
 * and §5.17 for the Cardinal address parser, and it fails the same way: a board
 * added there and not here goes silently unnamed rather than erroring. It is a
 * mirror rather than an import because the gateway is a separate Node service
 * that does not build the SPA's TypeScript.
 *
 * `directoryCoverage.test.ts` on the SPA side asserts the two agree, so the
 * drift shows up as a failing build rather than as patients whose names never
 * resolve.
 */
export const DIRECTORY_BOARDS = [
  { boardId: 18392794310, name: "DTC Intake", phoneColId: "phone_mkwrkc73" },
  { boardId: 18413019028, name: "Secondary Claims", phoneColId: "phone_mm1znnww" },
  { boardId: 18407459988, name: "Subscription Board", phoneColId: "phone_mkp0q3cw" },
  { boardId: 18406352652, name: "Profile Send Off", phoneColId: "phone_mm1x44yk" },
  { boardId: 18406060017, name: "Medical Evaluation", phoneColId: "phone_mm1x44yk" },
  { boardId: 18410601299, name: "Insurance", phoneColId: "phone_mm1x44yk" },
  { boardId: 18410804557, name: "Welcome Call", phoneColId: "phone_mm1x44yk" },
];

/**
 * Pipeline position, for picking which board's copy of a patient wins.
 *
 * A patient is one item PER BOARD (CLAUDE.md §6), so one number resolves to
 * several rows. The furthest-along board holds the freshest name — an intake
 * row can carry a typo a later stage corrected. Boards that are not pipeline
 * stages rank below every stage rather than above them.
 */
const PIPELINE_RANK = {
  18392794310: 0, // DTC Intake
  18406352652: 1, // Profile Send Off
  18406060017: 2, // Medical Evaluation
  18410601299: 3, // Insurance
  18410804557: 4, // Welcome Call
  18407459988: 5, // Subscription
  18413019028: -1, // Secondary Claims — parallel reconciliation, not a stage
};

export function boardRank(boardId) {
  const r = PIPELINE_RANK[Number(boardId)];
  return r === undefined ? -1 : r;
}

/** Rows per page of the board scan. Monday's `items_page` ceiling is 500. */
export const PAGE_SIZE = 500;

/**
 * Pages per board before the scan gives up.
 *
 * ⚠️ Sized well above the real boards (Profile Send Off is the biggest at
 * ~2,600 items, so 6 pages) precisely so hitting it means something is wrong.
 * A run that stops early is reported `truncated`, and the health route treats
 * that as NOT ok — a directory that quietly stopped covering half a board looks
 * exactly like one that is working.
 */
export const MAX_PAGES = 40;

/** Last 10 digits — the only substring present in every rendering of a US
 *  number, and what `last4` is sliced from. Mirrors the SPA's `contactKey`. */
export function last10(value) {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
}

/** E.164, so the same patient hashes the same however their number was typed.
 *  ⚠️ Must run BEFORE hashing — see phoneHash.mjs' warning; a number that
 *  normalises differently silently stops matching. */
export function toE164(value) {
  const d = last10(value);
  return d.length === 10 ? `+1${d}` : "";
}

/**
 * One board item → a directory row, or null if it can't be one.
 *
 * Null for a nameless item or one with no usable phone: a row with no number
 * can never be looked up, and a row with no name would render as blank, which
 * is worse than falling through to the phone number.
 */
export function toDirectoryRow(item, board, hash) {
  const name = String(item?.name ?? "").trim();
  if (!name) return null;
  const raw = (item?.column_values ?? []).find((c) => c && c.id === board.phoneColId)?.text;
  const e164 = toE164(raw);
  if (!e164) return null;
  return {
    phoneHmac: hash(e164),
    last4: last10(e164).slice(-4),
    name,
    mondayItemId: String(item.id),
    boardId: Number(board.boardId),
    boardName: board.name,
    rank: boardRank(board.boardId),
  };
}

/**
 * Collapse a scan to one row per number — the furthest-along board wins.
 *
 * ⚠️ Deliberately NOT one row per (number, board). The directory answers "whose
 * number is this", and a lookup that returned five rows would push the choice
 * of which name to show into every caller, where it would be made differently
 * each time. `boardRank` makes that choice once, here.
 *
 * ⚠️ A tie is broken by the LATER item id, not by scan order. Two live items on
 * one board for one number is a household (John and Sue Hartley share
 * 3046977788 on the live board), and scan order is Monday's, which is not
 * stable across runs — without a deterministic tie-break the displayed name
 * would flip between two real people from one day to the next.
 */
export function collapseRows(rows) {
  const best = new Map();
  for (const r of rows) {
    if (!r) continue;
    const prev = best.get(r.phoneHmac);
    if (!prev || r.rank > prev.rank || (r.rank === prev.rank && r.mondayItemId > prev.mondayItemId)) {
      best.set(r.phoneHmac, r);
    }
  }
  return [...best.values()];
}

/**
 * Is this directory fit to be served?
 *
 * ⚠️ NOT ok when no run has ever succeeded, however many rows the table holds:
 * a job that was deployed but never actually ran must not read healthy. And not
 * ok when the last good run was truncated — the run really did sync, which is
 * why it is still recorded `ok`, but it did not cover everything, and that
 * verdict belongs here rather than being lost. Same shape as `archiveHealth`.
 */
export function directoryHealth({
  lastOkAt,
  lastRunAt,
  lastError,
  lastTruncated,
  rows,
  staleAfterHours = 48,
  now = Date.now(),
} = {}) {
  const lastOk = lastOkAt ? new Date(lastOkAt).getTime() : 0;
  const ageHours = lastOk ? (now - lastOk) / 3_600_000 : null;
  const stale = !lastOk || ageHours > staleAfterHours;
  return {
    ok: !!lastOk && !stale && !lastTruncated,
    stale,
    truncated: !!lastTruncated,
    lastOkAt: lastOkAt ? new Date(lastOkAt).toISOString() : null,
    lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
    lastError: lastError || null,
    ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
    rows: Number(rows || 0),
  };
}

/**
 * Bound a lookup request.
 *
 * ⚠️ A cap, not a suggestion. The Comms Hub asks about a whole inbox, and an
 * unbounded `IN (...)` list is both a slow query and an easy way for one client
 * to make the gateway do arbitrary work. 500 covers the largest real list in
 * one call; anything beyond that is the caller's to page.
 */
export const MAX_LOOKUP = 500;

export function boundLookup(numbers) {
  const seen = new Set();
  for (const n of numbers ?? []) {
    const e164 = toE164(n);
    if (e164) seen.add(e164);
    if (seen.size >= MAX_LOOKUP) break;
  }
  return [...seen];
}
