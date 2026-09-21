/**
 * Top every Diagnosis DROPDOWN up to the full historic vocabulary (§5.40).
 *
 * WHY, and why it is not optional for a clean cutover:
 *   migrateDiagnosis.mjs creates a label only for a code some item actually
 *   HOLDS, so each new dropdown came out carrying 26-37 of the 43 real ICD-10
 *   codes the five retired status columns knew between them. Two consequences:
 *     1. the rep's picker offers fewer codes than it did yesterday (reachable --
 *        both comboboxes have an "add a code" box -- but a visible change), and
 *     2. THE HOP RISK. Once the hops copy dropdown -> dropdown, a value whose
 *        label does not exist on the destination may arrive BLANK. Whether a hop
 *        creates a missing label is UNMEASURED (§5.40). Pre-creating the union
 *        removes that question for every code we have ever used; only a
 *        brand-new code still depends on the answer.
 *
 * HOW: monday has no mutation that edits a board dropdown's labels directly
 * (`update_dropdown_managed_column` is for account-level MANAGED columns, not
 * these). So labels are minted the way §5.33 records Josh adding a payer: write
 * them onto ONE existing item with `create_labels_if_missing`, then restore that
 * item's exact prior value. A terminal-group item is chosen on purpose, and a
 * NEW item is deliberately NOT created -- create-item automations on these
 * boards would fire (New Order's 7917933994 would stamp a real order).
 *
 *   node scripts/diagnosis-migration/backfillLabels.mjs           # dry run
 *   node scripts/diagnosis-migration/backfillLabels.mjs --apply
 *
 * SAFE TO RE-RUN: it only ever adds labels that are missing, and restores.
 */
import { readFileSync } from "node:fs";
import { gql, sleep } from "./boards.mjs";

const MAP = JSON.parse(new URL("./columns.json", import.meta.url).pathname
  ? readFileSync(new URL("./columns.json", import.meta.url), "utf8") : "[]");
const APPLY = process.argv.includes("--apply");

// A real ICD-10 code: letter, two alphanumerics, optional dot + up to 4 more.
// Anything else in the historic label sets is junk ("Collect", "Evaluate",
// "10.676767", "E024.414", "10.649") -- none is in use on any row, and the
// Evaluate picker already filters two of them out, so they are NOT carried over.
const ICD = /^[A-TV-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/i;

// Groups a spare item can be borrowed from: nothing here is being worked.
const TERMINAL = /completed|complete|cancel|stuck|closed|paid|not active|bad debt/i;

const labelsOf = (settings, kind) => kind === "status"
  ? Object.values(JSON.parse(settings || "{}").labels || {}).filter(Boolean).map(String)
  : ((JSON.parse(settings || "{}").labels) || []).map((l) => String(l.name));

async function readCols(b) {
  const d = await gql(
    `query($board:ID!,$cols:[String!]){boards(ids:[$board]){columns(ids:$cols){id type settings_str}}}`,
    { board: b.board, cols: [b.from, b.to] });
  const by = Object.fromEntries(d.boards[0].columns.map((c) => [c.id, c]));
  return { st: labelsOf(by[b.from].settings_str, "status"), dd: labelsOf(by[b.to].settings_str, "dropdown") };
}

// 1. the union, read from all ten columns, so every board ends up identical.
const state = [];
for (const b of MAP) { state.push({ ...b, ...(await readCols(b)) }); await sleep(150); }
const union = new Set();
for (const s of state) for (const l of [...s.st, ...s.dd]) union.add(l.trim());
const real = [...union].filter((l) => ICD.test(l)).sort();
const skipped = [...union].filter((l) => !ICD.test(l)).sort();

console.log(`${APPLY ? "APPLY" : "DRY RUN"} -- union ${union.size} distinct, ${real.length} real ICD-10`);
console.log(`not carried over (not a code, and on no row): ${skipped.join(", ")}\n`);

let added = 0;
for (const s of state) {
  const missing = real.filter((l) => !s.dd.includes(l));
  if (!missing.length) { console.log(`${s.name.padEnd(20)} already complete (${s.dd.length})`); continue; }
  console.log(`${s.name.padEnd(20)} +${missing.length}: ${missing.join(", ")}`);
  if (!APPLY) { added += missing.length; continue; }

  // Borrow one finished item and put it back exactly as it was.
  const g = await gql(`query($board:ID!){boards(ids:[$board]){groups{id title}}}`, { board: s.board });
  const grp = g.boards[0].groups.find((x) => TERMINAL.test(x.title));
  if (!grp) { console.log(`   !! no terminal group on ${s.name} -- skipped, add these by hand`); continue; }
  const it = await gql(
    `query($board:ID!,$grp:String!,$col:String!){boards(ids:[$board]){groups(ids:[$grp]){items_page(limit:1){items{id name column_values(ids:[$col]){id value}}}}}}`,
    { board: s.board, grp: grp.id, col: s.to });
  const item = it.boards[0].groups[0].items_page.items[0];
  if (!item) { console.log(`   !! "${grp.title}" is empty -- skipped, add these by hand`); continue; }
  const before = item.column_values[0]?.value ?? null;   // exact prior value, restored verbatim
  console.log(`   minting on ${item.id} ("${item.name}", group "${grp.title}"), prior value ${before ?? "empty"}`);

  try {
    await gql(
      `mutation($board:ID!,$item:ID!,$vals:JSON!){change_multiple_column_values(board_id:$board,item_id:$item,column_values:$vals,create_labels_if_missing:true){id}}`,
      { board: s.board, item: item.id, vals: JSON.stringify({ [s.to]: { labels: missing } }) });
  } finally {
    // ALWAYS restore, even if the mint threw part-way: leaving a finished
    // patient carrying 15 diagnoses is the one outcome worth guarding against.
    await gql(
      `mutation($board:ID!,$item:ID!,$vals:JSON!){change_multiple_column_values(board_id:$board,item_id:$item,column_values:$vals){id}}`,
      { board: s.board, item: item.id, vals: JSON.stringify({ [s.to]: before ? JSON.parse(before) : {} }) });
  }

  const after = await readCols(s);
  const still = real.filter((l) => !after.dd.includes(l));
  const back = await gql(`query($item:ID!,$col:String!){items(ids:[$item],limit:5){column_values(ids:[$col]){value}}}`,
    { item: item.id, col: s.to });
  const restored = back.items[0].column_values[0]?.value ?? null;
  const ok = JSON.stringify(restored ? JSON.parse(restored) : null) === JSON.stringify(before ? JSON.parse(before) : null);
  console.log(`   -> dropdown now ${after.dd.length} labels, ${still.length} still missing; item restored: ${ok ? "yes" : "NO -- CHECK " + item.id}`);
  added += missing.length - still.length;
  await sleep(300);
}
console.log(`\n${APPLY ? "added" : "would add"} ${added} labels`);
