// Pre/post verification for the long_text → text conversion.
// Deliberately reads the OLD long_text columns: `compare` proves the originals were never touched.
//   node snapshotNotes.mjs snapshot <outfile.json>   → per item: length + newline count for each in-scope column (no bodies)
//   node snapshotNotes.mjs compare  <file.json>      → re-reads and reports any item whose length/newlines changed
// A conversion that keeps every value produces ZERO diffs. Any diff is a stop-and-look.
const [mode, file] = process.argv.slice(2);
if (!mode || !file) { console.log("usage: node snapshotNotes.mjs snapshot|compare <file.json>"); process.exit(1); }
const GW = "https://monday-gateway-production.up.railway.app/gql";
const SCOPE = [
  [18410804557, ["long_text_mm5gx6j6", "long_text_mm5g1txs", "long_text_mm2ffsme"], "Welcome Call"],
  [18410601299, ["long_text_mm2ffsme"], "Insurance"],
  [18406060017, ["long_text_mm27zjt2"], "Medical Evaluation"],
  [18407459988, ["long_text_mm3rj7k7"], "Subscription"],
];
async function gql(q) { const r = await fetch(GW, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }); const j = await r.json(); if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300)); return j.data; }
async function read() {
  const out = {};
  for (const [board, cols, label] of SCOPE) {
    const ids = JSON.stringify(cols); let cursor = null, page = 0; out[board] = { label, cols, items: {} };
    do {
      const q = cursor ? `{ next_items_page(limit:500,cursor:"${cursor}"){ cursor items{ id column_values(ids:${ids}){ id text } } } }`
                       : `{ boards(ids:[${board}]){ items_page(limit:500){ cursor items{ id column_values(ids:${ids}){ id text } } } } }`;
      const d = await gql(q); const pg = cursor ? d.next_items_page : d.boards[0].items_page;
      for (const it of pg.items) { const rec = {}; for (const cv of it.column_values) { const t = cv.text ?? ""; rec[cv.id] = [t.length, (t.match(/\n/g) || []).length]; } out[board].items[it.id] = rec; }
      cursor = pg.cursor; page++;
    } while (cursor && page < 20);
  }
  return out;
}
const { writeFileSync, readFileSync } = await import("node:fs");
if (mode === "snapshot") {
  const snap = await read(); writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), snap }));
  for (const [b, v] of Object.entries(snap)) console.log(`${v.label}: ${Object.keys(v.items).length} items × ${v.cols.length} column(s) snapshotted`);
  console.log("wrote", file);
} else if (mode === "compare") {
  const { takenAt, snap: before } = JSON.parse(readFileSync(file, "utf8")); const after = await read();
  let diffs = 0;
  for (const [b, v] of Object.entries(before)) {
    let same = 0, changed = 0, missing = 0;
    for (const [id, rec] of Object.entries(v.items)) {
      const now = after[b]?.items[id]; if (!now) { missing++; continue; }
      for (const col of v.cols) { const [l0, n0] = rec[col] ?? [0, 0]; const [l1, n1] = now[col] ?? [0, 0]; if (l0 === l1 && n0 === n1) same++; else { changed++; diffs++; console.log(`  DIFF ${v.label} item ${id} ${col}: len ${l0}→${l1} newlines ${n0}→${n1}`); } }
    }
    console.log(`${v.label}: ${same} unchanged · ${changed} changed · ${missing} items no longer present (since ${takenAt})`);
  }
  console.log(diffs === 0 ? "✔ every value identical" : `✘ ${diffs} differences — stop and look`);
}
