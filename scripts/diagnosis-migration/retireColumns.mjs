/**
 * Retitle the five OLD Diagnosis status columns to "<title> (retired)".
 *
 * WHY THIS RUNS BEFORE THE AUTOMATIONS ARE RE-POINTED, not after:
 * every board now carries TWO columns with the SAME TITLE — the retired status
 * and the new dropdown ("Diagnosis" on four boards, "Diagnosis Code" on New
 * Order). monday's automation editor picks a column by TITLE, so the two are
 * indistinguishable there, and choosing the wrong one looks exactly like a
 * finished re-point while the hop goes on copying a frozen column. Renaming
 * first makes the picker unambiguous.
 *
 * It is safe to do before the re-point: a rename changes the TITLE only, never
 * the id (CLAUDE.md §3), so the eleven hop automations keep working off the old
 * column until a person re-points them, and the app — which reads the dropdowns
 * by id since the cutover — never looks at these columns at all.
 *
 * HIDING the columns is deliberately NOT done here. That is the last step, after
 * the hops are re-pointed and the migration has been re-run, and it is a view
 * change rather than a column change. And they are never DELETED: 4,000+ items
 * still reference them and they are the rollback.
 *
 * Guarded: refuses a column whose live title is not the one we expect, so it can
 * never append "(retired)" to whatever happens to be sitting at that id.
 *
 *   node scripts/diagnosis-migration/retireColumns.mjs            # dry run
 *   node scripts/diagnosis-migration/retireColumns.mjs --apply
 */
import { BOARDS, gql } from "./boards.mjs";

const APPLY = process.argv.includes("--apply");
const SUFFIX = " (retired)";

const live = async (board) =>
  (await gql(`query($b:[ID!]){boards(ids:$b){columns{id title type}}}`, { b: [board] }))
    .boards[0].columns;

let renamed = 0, already = 0, refused = 0;

for (const b of BOARDS) {
  const columns = await live(b.board);
  const status = columns.find((c) => c.id === b.from);
  const dropdown = columns.find((c) => c.type === "dropdown" && c.title.trim() === b.title);

  if (!status) {
    console.log(`REFUSED  ${b.name.padEnd(18)} ${b.from} — no such column on the board`);
    refused++;
    continue;
  }
  if (status.title.endsWith(SUFFIX)) {
    console.log(`already  ${b.name.padEnd(18)} ${b.from} — "${status.title}"`);
    already++;
    continue;
  }
  if (status.title.trim() !== b.title) {
    // Not the column this script was written for. Say so rather than rename it.
    console.log(`REFUSED  ${b.name.padEnd(18)} ${b.from} — expected "${b.title}", found "${status.title}"`);
    refused++;
    continue;
  }
  if (!dropdown) {
    // The rename exists to disambiguate from the dropdown. If there is no
    // dropdown there is nothing to disambiguate, and something is wrong.
    console.log(`REFUSED  ${b.name.padEnd(18)} ${b.from} — no "${b.title}" dropdown on this board to disambiguate from`);
    refused++;
    continue;
  }

  const next = status.title + SUFFIX;
  if (!APPLY) {
    console.log(`would    ${b.name.padEnd(18)} ${b.from}  "${status.title}" -> "${next}"   (dropdown ${dropdown.id} keeps "${dropdown.title}")`);
    continue;
  }

  await gql(
    `mutation($b:ID!,$c:String!,$t:String!){change_column_title(board_id:$b,column_id:$c,title:$t){id title}}`,
    { b: b.board, c: b.from, t: next },
  );

  // Read back: a 200 is not a write (§5.2).
  const after = (await live(b.board)).find((c) => c.id === b.from);
  if (after?.title !== next) {
    console.log(`FAILED   ${b.name.padEnd(18)} ${b.from} — reads back as "${after?.title}"`);
    refused++;
    continue;
  }
  console.log(`renamed  ${b.name.padEnd(18)} ${b.from}  -> "${next}"   (dropdown ${dropdown.id} still "${dropdown.title}")`);
  renamed++;
}

console.log(`\n${APPLY ? "applied" : "dry run"}: renamed ${renamed} | already done ${already} | refused ${refused}`);
if (refused) process.exitCode = 1;
