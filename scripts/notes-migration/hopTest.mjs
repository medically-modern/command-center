// TONIGHT: does the Profile→ME create-item automation (7917676280) carry a >2,000-char
// TEXT value intact? Uses the Profile Send Off *Tests* group. No patient data.
//   node hopTest.mjs           → prints the plan, writes nothing
//   node hopTest.mjs --apply   → creates the test item, fires the hop, measures, then deletes BOTH items
const APPLY = process.argv.includes("--apply");
const GW = "https://monday-gateway-production.up.railway.app/gql";
const PROFILE = 18406352652, TESTS_GROUP = "group_mm1wvq8p", NOTES = "text_mm389fs", MOVE_TO_ONBOARDING = "color_mm1zmeb3";
const ME = 18406060017, ME_MIRROR = "text_mm3xdze1";
const NAME = `ZZ HOP TEST ${Date.now()} (delete me)`;
const line = "[Sep 3, 2026, 9:00 PM] Test: filler entry NN for the >2000 hop test, ISO 2026-09-03 —ZZ";
const body = Array.from({ length: 34 }, (_, i) => line.replace("NN", String(i + 1).padStart(2, "0"))).join("\n\n"); // ~3,100 chars
async function gql(query, variables = {}) { const r = await fetch(GW, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) }); const j = await r.json(); if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300)); return j.data; }
console.log(`plan: create "${NAME}" in Profile Tests group with ${body.length}-char ${NOTES}, set ${MOVE_TO_ONBOARDING} → "Advance to MN", wait for the ME item, measure ${ME_MIRROR}, delete both.`);
if (!APPLY) process.exit(0);
const c = await gql(`mutation($b:ID!,$g:String!,$n:String!,$v:JSON!){ create_item(board_id:$b, group_id:$g, item_name:$n, column_values:$v){ id } }`, { b: String(PROFILE), g: TESTS_GROUP, n: NAME, v: JSON.stringify({ [NOTES]: body }) });
const profileId = c.create_item.id; console.log("created profile test item", profileId);
await gql(`mutation($i:ID!,$b:ID!,$v:JSON!){ change_multiple_column_values(item_id:$i, board_id:$b, column_values:$v){ id } }`, { i: profileId, b: String(PROFILE), v: JSON.stringify({ [MOVE_TO_ONBOARDING]: { label: "Advance to MN" } }) });
console.log("fired Advance to MN — waiting for the automation…");
let meId = null, mirrorLen = -1;
for (let i = 0; i < 20 && !meId; i++) {
  await new Promise(res => setTimeout(res, 5000));
  const d = await gql(`{ boards(ids:[${ME}]){ items_page(limit:25, query_params:{ rules:[{ column_id:"name", compare_value:["${NAME}"], operator:contains_text }] }){ items{ id name column_values(ids:["${ME_MIRROR}"]){ text } } } } }`);
  const hit = d.boards[0].items_page.items.find(it => it.name === NAME);
  if (hit) { meId = hit.id; mirrorLen = (hit.column_values[0]?.text ?? "").length; }
}
console.log(meId ? `ME item ${meId}: mirror ${ME_MIRROR} holds ${mirrorLen} chars (source ${body.length}) → ${mirrorLen === body.length ? "INTACT ✔" : mirrorLen === 2000 ? "TRUNCATED at 2000 ✘" : "DIFFERENT — inspect"}` : "no ME item appeared within 100s — check the automation, then delete the profile item by hand");
for (const [b, id] of [[ME, meId], [PROFILE, profileId]]) if (id) { await gql(`mutation{ delete_item(item_id:${id}){ id } }`); console.log(`deleted ${id} from ${b}`); }
