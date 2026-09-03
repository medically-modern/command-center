// TONIGHT, ONLY IF the UI conversion does NOT keep the column id:
// copy every item's notes from the old long_text column to the new text column.
//   node migrateNotes.mjs <boardId> <fromColId> <toColId>          → dry run: counts only
//   node migrateNotes.mjs <boardId> <fromColId> <toColId> --apply  → writes, then re-reads and verifies
// Prints counts and lengths only — never a note body. Bare string via
// change_multiple_column_values (accepted for text; sandbox-verified 2026-09-03).
const [board, from, to, flag] = process.argv.slice(2);
if (!board || !from || !to) { console.log("usage: node migrateNotes.mjs <boardId> <fromColId> <toColId> [--apply]"); process.exit(1); }
const APPLY = flag === "--apply";
const GW = "https://monday-gateway-production.up.railway.app/gql";
async function gql(query, variables = {}) { const r = await fetch(GW, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) }); const j = await r.json(); if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300)); return j.data; }
const rows = []; let cursor = null, page = 0;
do {
  const q = cursor ? `{ next_items_page(limit:500,cursor:"${cursor}"){ cursor items{ id column_values(ids:["${from}","${to}"]){ id text } } } }`
                   : `{ boards(ids:[${board}]){ items_page(limit:500){ cursor items{ id column_values(ids:["${from}","${to}"]){ id text } } } } }`;
  const d = await gql(q); const pg = cursor ? d.next_items_page : d.boards[0].items_page;
  for (const it of pg.items) { const g = id => it.column_values.find(c => c.id === id)?.text ?? ""; rows.push({ id: it.id, src: g(from), dst: g(to) }); }
  cursor = pg.cursor; page++;
} while (cursor && page < 20);
const todo = rows.filter(r => r.src && r.src !== r.dst);
const already = rows.filter(r => r.src && r.src === r.dst).length;
console.log(`board ${board}: ${rows.length} items · ${rows.filter(r => r.src).length} with source notes · ${already} already identical · ${todo.length} to copy · ${rows.filter(r => !r.src && r.dst).length} have dest but no source (left alone)`);
if (!APPLY) { console.log("dry run — pass --apply to write"); process.exit(0); }
let ok = 0, bad = 0;
for (const r of todo) {
  await gql(`mutation($item:ID!,$board:ID!,$vals:JSON!){ change_multiple_column_values(item_id:$item, board_id:$board, column_values:$vals){ id } }`, { item: r.id, board: String(board), vals: JSON.stringify({ [to]: r.src }) });
  const d = await gql(`{ items(ids:[${r.id}]){ column_values(ids:["${to}"]){ text } } }`);
  const back = d.items[0].column_values[0]?.text ?? "";
  if (back === r.src) ok++; else { bad++; console.log(`  MISMATCH item ${r.id}: wrote ${r.src.length} chars, read back ${back.length}`); }
  await new Promise(res => setTimeout(res, 120)); // gentle on the shared complexity budget
}
console.log(`copied+verified ${ok}, mismatched ${bad}`);
