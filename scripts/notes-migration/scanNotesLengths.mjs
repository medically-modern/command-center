// Read-only scan: how many items have a long_text notes column at/near Monday's
// 2000-char cap. Prints id / name / group / length ONLY — never a note body.
const GW = "https://monday-gateway-production.up.railway.app/gql";
const TARGETS = [
  { board: 18406060017, col: "long_text_mm27zjt2", label: "Medical Evaluation · MN Workflow Notes" },
  { board: 18410601299, col: "long_text_mm2ffsme", label: "Insurance · Reference Notes" },
  { board: 18410804557, col: "long_text_mm2ffsme", label: "Welcome Call · Notes" },
  { board: 18407459988, col: "long_text_mm3rj7k7", label: "Subscription · Patient Notes" },
];
async function gql(query) {
  const r = await fetch(GW, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}
for (const t of TARGETS) {
  const rows = [];
  let cursor = null, page = 0;
  do {
    const q = cursor
      ? `{ next_items_page(limit: 500, cursor: "${cursor}") { cursor items { id name group { title } column_values(ids: ["${t.col}"]) { text } } } }`
      : `{ boards(ids: [${t.board}]) { items_page(limit: 500) { cursor items { id name group { title } column_values(ids: ["${t.col}"]) { text } } } } }`;
    const d = await gql(q);
    const pg = cursor ? d.next_items_page : d.boards[0].items_page;
    for (const it of pg.items) {
      const len = (it.column_values[0]?.text ?? "").length;
      rows.push({ id: it.id, name: it.name, group: it.group?.title ?? "", len });
    }
    cursor = pg.cursor; page++;
  } while (cursor && page < 20);
  const at = rows.filter(r => r.len === 2000);
  const near = rows.filter(r => r.len >= 1800 && r.len < 2000);
  const over = rows.filter(r => r.len > 2000);
  console.log(`\n=== ${t.label} — ${rows.length} items ===`);
  console.log(`  at 2000 (FULL, appends are being dropped): ${at.length}`);
  console.log(`  1800–1999 (one or two notes from full):     ${near.length}`);
  if (over.length) console.log(`  >2000 (?!): ${over.length}`);
  const hist = {}; for (const r of rows) { const b = r.len === 0 ? "0" : r.len < 500 ? "1-499" : r.len < 1000 ? "500-999" : r.len < 1500 ? "1000-1499" : r.len < 1800 ? "1500-1799" : r.len < 2000 ? "1800-1999" : "2000"; hist[b] = (hist[b] || 0) + 1; }
  console.log("  histogram:", JSON.stringify(hist));
  for (const r of [...at, ...near].sort((a, b) => b.len - a.len))
    console.log(`  ${r.len === 2000 ? "FULL" : "    "} ${r.len}  ${r.id}  ${r.group.padEnd(22)}  ${r.name}`);
}
