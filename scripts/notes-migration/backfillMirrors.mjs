// STOPGAP, retired 2026-09-04 10:08 ET — kept in case a hop automation is ever re-pointed at a retired column again.
// Between the app cutover (2026-09-03 8 PM ET) and Josh re-pointing the two hop automations in Monday's UI
// (7918295320 at 10:01 ET, 7918324247 at 10:08 ET on 2026-09-04) every create-item hop copied the retired,
// now-frozen long_text column, so the destination's notes mirror arrived EMPTY. This fills those mirrors from
// the source board's NEW text column. Idempotent: skips a mirror that already has text. It filled 3 Insurance
// items on 2026-09-04 (hopped 09:14–09:52 ET); every run since reports 0 pending.
// Joins by Patient UID, falls back to exact name; prints ids and lengths only — never a note body.
//   node backfillMirrors.mjs            → dry run (counts + item ids)
//   node backfillMirrors.mjs --apply    → write + re-read verify
const APPLY = process.argv.includes("--apply");
const SINCE = "2026-09-04T00:00:00Z"; // 8:00 PM ET Sep 3 — the app cutover
const GW = "https://monday-gateway-production.up.railway.app/gql";
async function gql(q, v = {}) { const r = await fetch(GW, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q, variables: v }) }); const j = await r.json(); if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300)); return j.data; }
const ME = 18406060017, INS = 18410601299, WC = 18410804557;
const UID = { [ME]: "text_mm3ac5a0", [INS]: "text_mm3a2b3n", [WC]: "text_mm3av5nt" };
const T = (it, id) => it.column_values.find((c) => c.id === id)?.text ?? "";
async function recent(board, cols) { const d = await gql(`{ boards(ids:[${board}]){ items_page(limit:100, query_params:{order_by:[{column_id:"__creation_log__",direction:desc}]}){ items{ id name created_at column_values(ids:${JSON.stringify([UID[board], ...cols])}){ id text } } } } }`); return d.boards[0].items_page.items.filter((i) => i.created_at >= SINCE); }
async function findSource(board, uid, name, cols) {
  if (uid) { const d = await gql(`{ items_page_by_column_values(board_id:${board}, limit:5, columns:[{column_id:"${UID[board]}", column_values:[${JSON.stringify(uid)}]}]){ items{ id name column_values(ids:${JSON.stringify(cols)}){ id text } } } }`); if (d.items_page_by_column_values.items.length === 1) return d.items_page_by_column_values.items[0]; }
  const d = await gql(`{ boards(ids:[${board}]){ items_page(limit:10, query_params:{rules:[{column_id:"name", compare_value:[${JSON.stringify(name)}], operator:contains_text}]}){ items{ id name column_values(ids:${JSON.stringify(cols)}){ id text } } } } }`);
  const exact = d.boards[0].items_page.items.filter((i) => i.name === name); return exact.length === 1 ? exact[0] : null;
}
async function write(board, item, col, text) { await gql(`mutation($i:ID!,$b:ID!,$v:JSON!){ change_multiple_column_values(item_id:$i, board_id:$b, column_values:$v){ id } }`, { i: item, b: String(board), v: JSON.stringify({ [col]: text }) }); const d = await gql(`{ items(ids:[${item}]){ column_values(ids:["${col}"]){ text } } }`); return (d.items[0].column_values[0]?.text ?? "") === text; }
// plan: [destBoard, destCol, srcBoard, srcCol, label]
const PLAN = [
  [INS, "text_mm3xbvss", ME, "text_mm6vevjf", "Insurance ← ME notes mirror"],
  [WC, "text_mm6vqq2k", INS, "text_mm6vzc7q", "WC Notes (pre-seed) ← Insurance notes"],
  [WC, "text_mm5pegde", INS, "text_mm6vzc7q", "WC Insurance-notes mirror ← Insurance notes"],
  [WC, "text_mm6v4fny", INS, "text_mm3xbvss", "WC MN mirror ← Insurance MN mirror"],
  [WC, "text_mm6vvsjy", INS, "text_mm3xfw5a", "WC Profile mirror ← Insurance Profile mirror"],
];
let fixed = 0, pending = 0;
for (const [db, dc, sb, sc, label] of PLAN) {
  const items = await recent(db, [dc]);
  for (const it of items) {
    if (T(it, dc)) continue; // already filled
    const src = await findSource(sb, T(it, UID[db]), it.name, [sc]); if (!src) { console.log(`  ? ${label}: ${db}/${it.id} no unique source`); continue; }
    const val = T(src, sc); if (!val) continue; // nothing to copy
    pending++;
    if (APPLY) { const ok = await write(db, it.id, dc, val); console.log(`  ${ok ? "✔" : "✘"} ${label}: item ${it.id} ← ${sb}/${src.id} (${val.length} chars)`); if (ok) fixed++; }
    else console.log(`  · ${label}: item ${it.id} ← ${sb}/${src.id} (${val.length} chars) [would copy]`);
  }
}
console.log(APPLY ? `filled ${fixed}/${pending}` : `${pending} mirror(s) to fill — run with --apply`);
