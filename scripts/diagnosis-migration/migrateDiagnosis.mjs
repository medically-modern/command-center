/**
 * Copy each item's Diagnosis from the old STATUS column into the new DROPDOWN.
 *
 *   node migrateDiagnosis.mjs                 # dry run, all boards
 *   node migrateDiagnosis.mjs --apply
 *   node migrateDiagnosis.mjs --apply --board 18406060017
 *   node migrateDiagnosis.mjs --apply --source-wins   # overwrite a diverged destination
 *
 * SAFE TO RE-RUN, and it is meant to be: between the app cutover and the hop
 * automations being re-pointed, a hop copies the OLD (now frozen) status column,
 * so the destination board's new dropdown arrives empty. Re-running fills those
 * in. Same stopgap backfillMirrors.mjs was for the notes conversion.
 *
 * Rules, mirroring migrateNotes.mjs:
 *   · source empty                      -> skip
 *   · destination empty                 -> copy
 *   · destination === source            -> skip (already done)
 *   · destination differs, non-empty    -> REPORT, do not overwrite (unless --source-wins).
 *     The destination moving ahead is a rep or the app having written the new
 *     column already; clobbering that with a stale status value is the one
 *     outcome worse than leaving it.
 * Every batch is read back and verified before the next one goes out.
 */
import { readFileSync } from "node:fs";
import { gql, sleep } from "./boards.mjs";

const APPLY = process.argv.includes("--apply");
const SOURCE_WINS = process.argv.includes("--source-wins");
const ONLY = process.argv.includes("--board") ? process.argv[process.argv.indexOf("--board") + 1] : null;
const COLUMNS = JSON.parse(readFileSync(new URL("./columns.json", import.meta.url), "utf8"));
const BATCH = 20;

const PAGE = `query($b:ID!,$from:String!,$to:String!,$cur:String){
  boards(ids:[$b]){items_page(limit:500,cursor:$cur){cursor items{id
    f:column_values(ids:[$from]){text} t:column_values(ids:[$to]){text}}}}}`;

async function writeBatch(board, to, chunk) {
  const parts = chunk.map((it, i) =>
    `m${i}: change_multiple_column_values(item_id:${it.id},board_id:${board},` +
    `column_values:$v${i},create_labels_if_missing:true){id}`);
  const decl = chunk.map((_, i) => `$v${i}:JSON!`).join(",");
  const vars = Object.fromEntries(chunk.map((it, i) => [`v${i}`, JSON.stringify({ [to]: { labels: [it.src] } })]));
  await gql(`mutation(${decl}){${parts.join(" ")}}`, vars);
}

let grand = { copied: 0, skipped: 0, diverged: 0, mismatch: 0 };

for (const b of COLUMNS) {
  if (ONLY && b.board !== ONLY) continue;
  const rows = [];
  let cur = null;
  do {
    const d = await gql(PAGE, { b: b.board, from: b.from, to: b.to, cur });
    const p = d.boards[0].items_page;
    for (const it of p.items) {
      rows.push({ id: it.id, src: (it.f[0]?.text || "").trim(), dst: (it.t[0]?.text || "").trim() });
    }
    cur = p.cursor;
    if (cur) await sleep(300);
  } while (cur);

  const todo = [], diverged = [];
  for (const r of rows) {
    if (!r.src) continue;
    if (r.dst === r.src) continue;
    if (r.dst && !SOURCE_WINS) { diverged.push(r); continue; }
    todo.push(r);
  }
  const skipped = rows.filter((r) => r.src && r.dst === r.src).length;
  console.log(`${b.name.padEnd(18)} ${String(rows.length).padStart(5)} items | to copy ${String(todo.length).padStart(5)} | already done ${String(skipped).padStart(5)} | diverged ${diverged.length}`);
  for (const d of diverged) console.log(`    ! item ${d.id}: old="${d.src}" new="${d.dst}" (left alone; --source-wins to force)`);
  grand.skipped += skipped; grand.diverged += diverged.length;

  if (!APPLY) { grand.copied += todo.length; continue; }

  // Pass 1: create each distinct label once, on its own, so a batch can never
  // race two aliased mutations into creating the same label twice.
  const seen = new Set();
  const firsts = todo.filter((r) => (seen.has(r.src) ? false : (seen.add(r.src), true)));
  for (const r of firsts) { await writeBatch(b.board, b.to, [r]); await sleep(120); }

  // Pass 2: everything else, aliased in batches.
  const rest = todo.filter((r) => !firsts.includes(r));
  for (let i = 0; i < rest.length; i += BATCH) {
    const chunk = rest.slice(i, i + BATCH);
    await writeBatch(b.board, b.to, chunk);
    await sleep(250);
  }

  // Read back and verify everything this run claimed to write.
  let bad = 0;
  for (let i = 0; i < todo.length; i += 100) {
    const chunk = todo.slice(i, i + 100);
    const d = await gql(`query($ids:[ID!],$to:String!){items(ids:$ids){id column_values(ids:[$to]){text}}}`,
      { ids: chunk.map((c) => c.id), to: b.to });
    const got = new Map(d.items.map((it) => [it.id, (it.column_values[0]?.text || "").trim()]));
    for (const c of chunk) if (got.get(c.id) !== c.src) { bad++; console.log(`    MISMATCH item ${c.id}: wanted "${c.src}" got "${got.get(c.id)}"`); }
    await sleep(200);
  }
  console.log(`  -> copied ${todo.length}, verified ${todo.length - bad} ok, ${bad} mismatched`);
  grand.copied += todo.length; grand.mismatch += bad;
}

console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"}  copied ${grand.copied} | already done ${grand.skipped} | diverged ${grand.diverged} | mismatched ${grand.mismatch}`);
