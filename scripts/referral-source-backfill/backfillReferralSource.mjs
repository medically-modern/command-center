// Backfill Subscription "Referral Source" color_mm6thrwv from the patient's own
// pipeline record. Profile Send Off / Medical Evaluation / Insurance / Welcome Call
// all carry the SAME column id color_mm1w5wxr; Subscription is the one board where
// the value does not hop, so ~91% of its items were blank (763 of 834, 2026-09-11).
//
//   node backfillReferralSource.mjs                  → dry run (default)
//   node backfillReferralSource.mjs --apply          → write, then verify each write
//   node backfillReferralSource.mjs --layers=uid,name,ilet --apply
//
// LAYERS, most-evidence-first. Each patient is resolved by the FIRST layer that answers:
//   uid      Patient UID match against Welcome Call / Insurance / Medical Evaluation.
//            Those three carry both the UID and the referral column — this is the
//            patient's own record, so it is evidence, not inference.
//            ⚠️ THE UID IS CHECKED AGAINST THE NAME, because at least one UID on these
//            boards is plain wrong: 8c623d19-…91f28 is "Samira Delacruz" on Subscription
//            and "josephin yap" on Welcome Call — two different people. Taking the UID at
//            face value writes one patient's referral source onto another, silently. A
//            UID hit whose name is not compatible is REJECTED and reported, never used.
//            (263 of 268 names agree outright; the rest are spelling variants.)
//   name     Name match against any source board, ACCEPTED ONLY with a second signal
//            (phone agrees, or DOB agrees) — lib/commsHub/dossier.nameMatchAccepted's
//            rule. Two patients called Maria Garcia is ordinary at this size.
//   ilet     INFERENCE, the one half of the Supplies Type rule that measures true:
//            Supplies Type iLet -> Beta Bionics. Beta Bionics is the only maker of the
//            iLet, and it held on 13 of the 14 verifiable patients (the 14th is
//            CareCentrix). ON by default.
//   supplies THE REST of that rule — Mobi/t:slim -> Tandem. ⚠️ OFF BY DEFAULT AND
//            MEASURED WRONG: against the 354 patients whose source we can establish,
//            t:slim is Tandem only 56% of the time and Mobi 65%; the rest are really
//            Doctor / Patient / CareCentrix. The pump brand says which manufacturer's
//            pump the patient is ON, not who referred them — plenty of t:slim patients
//            came from their own doctor. Turning this on writes a referral source the
//            board data contradicts for roughly 112 of 278 patients. Re-run
//            `node validateSuppliesRule.mjs` before ever enabling it.
//
// ⚠️ VALUES ARE MAPPED BY LABEL TEXT, NEVER BY INDEX. The two columns carry the same ten
// labels at DIFFERENT indices — Profile Send Off has 6=Wellstart 7=Solace Advocates 8=SNJ,
// Subscription has 6=Solace Advocates 7=SNJ 8=Wellstart. An index copy would silently
// mislabel all three, and a status write to an index a column does not have is dropped
// with NO error (CLAUDE.md §5.12/§5.20/§5.31c/§5.31d/§5.33). The destination index is read
// from the live settings_str at runtime and a label with no destination ABORTS the run.
//
// Only ever fills a BLANK cell — an existing value is never overwritten.
// Prints item ids and counts, never a patient name (PHI, CLAUDE.md §9).

const GW = "https://monday-gateway-production.up.railway.app/gql";

const SUB_BOARD = 18407459988;
const SUB_REFERRAL_SOURCE = "color_mm6thrwv"; // status, "Referral Source"
const SUB_PATIENT_UID = "text_mm3af3zt";
const SUB_SUPPLIES_TYPE = "color_mkxmnheg";
const SUB_DOB = "text_mkvdefh1";
const SUB_PHONE = "phone_mkp0q3cw";

const PIPELINE_REFERRAL_SOURCE = "color_mm1w5wxr"; // same id on all four source boards
const SOURCES = [
  { tag: "welcome-call",      board: 18410804557, uid: "text_mm3av5nt", dob: "text_mm1xvxst", phone: "phone_mm1x44yk" },
  { tag: "insurance",         board: 18410601299, uid: "text_mm3a2b3n", dob: "text_mm1xvxst", phone: "phone_mm1x44yk" },
  { tag: "medical-evaluation",board: 18406060017, uid: "text_mm3ac5a0", dob: "text_mm1xvxst", phone: "phone_mm1x44yk" },
  { tag: "profile-send-off",  board: 18406352652, uid: null,            dob: "text_mm1xvxst", phone: "phone_mm1x44yk" },
];

const ILET_INFERENCE = { "iLet": "Beta Bionics" };
const SUPPLIES_INFERENCE = { "Mobi": "Tandem", "t:slim": "Tandem" };

const flags = process.argv.slice(2);
const APPLY = flags.includes("--apply");
const layerArg = flags.find(f => f.startsWith("--layers="));
const LAYERS = new Set((layerArg ? layerArg.slice(9) : "uid,name,ilet").split(",").map(s => s.trim()).filter(Boolean));
for (const l of LAYERS) if (!["uid", "name", "ilet", "supplies"].includes(l)) { console.error(`unknown layer "${l}"`); process.exit(1); }

async function gql(query, variables = {}) {
  const r = await fetch(GW, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  // A Monday write is HTTP 200 WITH errors[] on refusal — read it and stop, never
  // report a clean run having written nothing (CLAUDE.md §10, the 2026-09-02 incident).
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 400));
  return j.data;
}

async function pageItems(board, cols) {
  const sel = `id column_values(ids:[${cols.filter(Boolean).map(c => `"${c}"`).join(",")}]){ id text }`;
  let cursor = null, out = [], n = 0;
  do {
    const q = cursor
      ? `{ next_items_page(limit:500,cursor:"${cursor}"){ cursor items{ ${sel} name } } }`
      : `{ boards(ids:[${board}]){ items_page(limit:500){ cursor items{ ${sel} name } } } }`;
    const d = await gql(q);
    const pg = cursor ? d.next_items_page : d.boards[0].items_page;
    out.push(...pg.items); cursor = pg.cursor; n++;
    if (n >= 30) { console.error(`  ⚠️ ${board}: stopped at ${n} pages — list may be truncated`); break; }
  } while (cursor);
  return out;
}

const txt = (it, id) => it.column_values.find(c => c.id === id)?.text ?? "";
const normName = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const digits = s => String(s || "").replace(/\D/g, "").slice(-10);
const trim = s => String(s || "").trim();
const tokens = s => normName(s).replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(t => t.length >= 3);

/**
 * Is this UID hit plausibly the same human? Fails CLOSED — a rejected match costs one
 * blank cell, an accepted wrong one puts another patient's referral source on the row.
 * Accepts an exact name, an annotated one ("Emilio Crespo (send claim to …)") and a
 * middle name ("Barbara Hester Anderson" / "Barbara Anderson"); rejects a shared first
 * name alone, which is what a bad UID looks like.
 */
function nameCompatible(a, b) {
  const na = normName(a), nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb || na.startsWith(nb) || nb.startsWith(na)) return true;
  const ta = new Set(tokens(a));
  return tokens(b).filter(t => ta.has(t)).length >= 2;
}

/** Destination label -> index, read from the LIVE column. Never inferred. */
async function destIndexByLabel() {
  const d = await gql(`{ boards(ids:[${SUB_BOARD}]){ columns(ids:["${SUB_REFERRAL_SOURCE}"]){ settings_str } } }`);
  const s = JSON.parse(d.boards[0].columns[0].settings_str);
  const map = new Map();
  for (const [index, label] of Object.entries(s.labels || {})) if (label) map.set(label, Number(index));
  return map;
}

async function main() {
  const dest = await destIndexByLabel();
  console.log(`Subscription "${SUB_REFERRAL_SOURCE}" labels: ${[...dest].map(([l, i]) => `${l}=${i}`).join(", ")}\n`);

  const subs = (await pageItems(SUB_BOARD, [SUB_REFERRAL_SOURCE, SUB_PATIENT_UID, SUB_SUPPLIES_TYPE, SUB_DOB, SUB_PHONE]))
    .map(it => ({
      id: it.id, name: normName(it.name), rawName: it.name,
      rs: txt(it, SUB_REFERRAL_SOURCE), uid: trim(txt(it, SUB_PATIENT_UID)),
      supplies: txt(it, SUB_SUPPLIES_TYPE), dob: trim(txt(it, SUB_DOB)), phone: digits(txt(it, SUB_PHONE)),
    }));
  console.log(`Subscription: ${subs.length} items · ${subs.filter(s => s.rs).length} already set · ${subs.filter(s => !s.rs).length} blank`);

  const byUid = new Map(), byName = new Map();
  for (const src of SOURCES) {
    const items = await pageItems(src.board, [PIPELINE_REFERRAL_SOURCE, src.uid, src.dob, src.phone]);
    let withRs = 0;
    for (const it of items) {
      const rs = txt(it, PIPELINE_REFERRAL_SOURCE);
      if (!rs) continue;
      withRs++;
      const uid = src.uid ? trim(txt(it, src.uid)) : "";
      if (uid && !byUid.has(uid)) byUid.set(uid, { rs, tag: src.tag, name: it.name });
      const key = normName(it.name);
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push({ rs, tag: src.tag, dob: trim(txt(it, src.dob)), phone: digits(txt(it, src.phone)) });
    }
    console.log(`  ${src.tag}: ${items.length} items, ${withRs} with a Referral Source`);
  }

  const plan = [], unresolved = [], conflicts = [], uidRejects = [];
  for (const s of subs) {
    if (s.rs) continue; // never overwrite
    if (LAYERS.has("uid") && s.uid) {
      const hit = byUid.get(s.uid);
      if (hit && nameCompatible(s.rawName, hit.name)) { plan.push({ ...s, value: hit.rs, via: `uid:${hit.tag}` }); continue; }
      if (hit) uidRejects.push({ id: s.id, tag: hit.tag }); // same UID, different human — fall through
    }
    if (LAYERS.has("name")) {
      // §5.28 nameMatchAccepted: a name alone is not an identity — require phone or DOB.
      const cands = (byName.get(s.name) || []).filter(c =>
        (c.phone && s.phone && c.phone === s.phone) || (c.dob && s.dob && c.dob === s.dob));
      const uniq = [...new Set(cands.map(c => c.rs))];
      if (uniq.length === 1) { plan.push({ ...s, value: uniq[0], via: `name:${cands[0].tag}` }); continue; }
      if (uniq.length > 1) { conflicts.push({ id: s.id, values: uniq }); continue; } // sources disagree — never guess
    }
    if (LAYERS.has("ilet") && ILET_INFERENCE[s.supplies]) {
      plan.push({ ...s, value: ILET_INFERENCE[s.supplies], via: `ilet:${s.supplies}` }); continue;
    }
    if (LAYERS.has("supplies") && SUPPLIES_INFERENCE[s.supplies]) {
      plan.push({ ...s, value: SUPPLIES_INFERENCE[s.supplies], via: `supplies:${s.supplies}` }); continue;
    }
    unresolved.push(s);
  }

  // A label with no destination index would be DROPPED SILENTLY — abort instead.
  const missing = [...new Set(plan.map(p => p.value))].filter(v => !dest.has(v));
  if (missing.length) {
    console.error(`\n❌ ABORT — these labels do not exist on ${SUB_REFERRAL_SOURCE}: ${missing.join(", ")}`);
    console.error(`   Add them to the Subscription column in Monday, then re-run. Writing them now would be`);
    console.error(`   silently dropped at HTTP 200.`);
    process.exit(1);
  }

  const byLayer = {}, byValue = {};
  for (const p of plan) { byLayer[p.via.split(":")[0]] = (byLayer[p.via.split(":")[0]] || 0) + 1; byValue[p.value] = (byValue[p.value] || 0) + 1; }
  console.log(`\nlayers enabled: ${[...LAYERS].join(", ")}`);
  console.log(`to write:   ${plan.length}   ${JSON.stringify(byLayer)}`);
  console.log(`values:     ${JSON.stringify(byValue)}`);
  console.log(`UID hits rejected on name (bad UID): ${uidRejects.length}`);
  for (const r of uidRejects) console.log(`   item ${r.id}: UID matches a ${r.tag} item for a different patient`);
  console.log(`conflicts:  ${conflicts.length} (sources disagree — left blank)`);
  for (const c of conflicts) console.log(`   item ${c.id}: ${c.values.join(" vs ")}`);
  console.log(`unresolved: ${unresolved.length} (left blank)`);
  const us = {}; for (const u of unresolved) us[u.supplies || "(blank)"] = (us[u.supplies || "(blank)"] || 0) + 1;
  console.log(`   by Supplies Type: ${JSON.stringify(us)}`);

  if (!APPLY) { console.log(`\ndry run — pass --apply to write`); return; }

  console.log(`\nwriting ${plan.length}…`);
  let ok = 0, bad = 0;
  for (const p of plan) {
    const index = dest.get(p.value);
    await gql(
      `mutation($item:ID!,$board:ID!,$vals:JSON!){ change_multiple_column_values(item_id:$item, board_id:$board, column_values:$vals){ id } }`,
      { item: p.id, board: String(SUB_BOARD), vals: JSON.stringify({ [SUB_REFERRAL_SOURCE]: { index } }) });
    const back = await gql(`{ items(ids:[${p.id}]){ column_values(ids:["${SUB_REFERRAL_SOURCE}"]){ text } } }`);
    const got = back.items[0].column_values[0]?.text ?? "";
    if (got === p.value) ok++;
    else { bad++; console.log(`   MISMATCH item ${p.id}: wrote "${p.value}" (index ${index}), read back "${got}"`); }
    await new Promise(r => setTimeout(r, 120)); // gentle on the shared complexity budget
  }
  console.log(`\nwrote+verified ${ok}, mismatched ${bad}`);
}

main().catch(e => { console.error(`\n❌ ${e.message}`); process.exit(1); });
