/**
 * Create the "Diagnosis" DROPDOWN beside the existing status column on each
 * board in the chain. Additive and idempotent: re-running finds the dropdown it
 * already made (matched on title + type) and leaves it alone.
 *
 * It deliberately does NOT retitle or delete the old status column — the hop
 * automations still read it until they are re-pointed. Retiring is a separate,
 * later step.
 *
 *   node createColumns.mjs            # dry run
 *   node createColumns.mjs --apply
 */
import { BOARDS, gql } from "./boards.mjs";

const APPLY = process.argv.includes("--apply");
const out = [];

for (const b of BOARDS) {
  const d = await gql(`query($b:ID!){boards(ids:[$b]){columns{id title type}}}`, { b: b.board });
  const cols = d.boards[0].columns;
  const existing = cols.find((c) => c.type === "dropdown" && c.title === b.title);
  if (existing) {
    console.log(`= ${b.name.padEnd(18)} already has dropdown "${b.title}" -> ${existing.id}`);
    out.push({ ...b, to: existing.id });
    continue;
  }
  if (!APPLY) {
    console.log(`+ ${b.name.padEnd(18)} would create dropdown "${b.title}" (old status ${b.from})`);
    continue;
  }
  const r = await gql(
    `mutation($b:ID!,$t:String!){create_column(board_id:$b,title:$t,column_type:dropdown){id}}`,
    { b: b.board, t: b.title },
  );
  const id = r.create_column.id;
  console.log(`+ ${b.name.padEnd(18)} created dropdown "${b.title}" -> ${id}`);
  out.push({ ...b, to: id });
}

if (APPLY) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(new URL("./columns.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
  console.log("\nwrote columns.json (the from -> to map the migration and the app use)");
}
