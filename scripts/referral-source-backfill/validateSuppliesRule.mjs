// Measures the Supplies Type -> Referral Source inference against ground truth.
// Run this BEFORE enabling backfillReferralSource.mjs' `supplies` layer, and re-run it
// whenever somebody proposes that rule again — it is intuitive, it is asserted from the
// floor periodically, and the board data has not supported it.
//
//   node validateSuppliesRule.mjs
//
// Ground truth = every Subscription item whose Referral Source we can establish: already
// on the board, or matched to the patient's own pipeline record by Patient UID or by
// name + DOB/phone. Prints counts only, never a patient name (PHI, CLAUDE.md §9).
//
// Result on 2026-09-11 (n=354): iLet -> Beta Bionics 13/14 (93%); t:slim -> Tandem 61/108
// (56%); Mobi -> Tandem 49/75 (65%). The pump brand says which manufacturer's pump the
// patient is ON, not who referred them — the misses are mostly real Doctor referrals.

const GW = "https://monday-gateway-production.up.railway.app/gql";
const RULE = { "Mobi": "Tandem", "t:slim": "Tandem", "iLet": "Beta Bionics" };

async function gql(q) {
  const r = await fetch(GW, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
  const j = await r.json(); if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300)); return j.data;
}
async function page(board, cols) {
  const sel = `id name column_values(ids:[${cols.filter(Boolean).map(c => `"${c}"`).join(",")}]){ id text }`;
  let cursor = null, out = [], n = 0;
  do { const q = cursor ? `{ next_items_page(limit:500,cursor:"${cursor}"){ cursor items{ ${sel} } } }`
                        : `{ boards(ids:[${board}]){ items_page(limit:500){ cursor items{ ${sel} } } } }`;
       const d = await gql(q); const pg = cursor ? d.next_items_page : d.boards[0].items_page;
       out.push(...pg.items); cursor = pg.cursor; n++; } while (cursor && n < 30);
  return out;
}
const txt = (it, id) => it.column_values.find(c => c.id === id)?.text ?? "";
const nm = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const dg = s => String(s || "").replace(/\D/g, "").slice(-10);

const sub = (await page(18407459988, ["color_mm6thrwv", "text_mm3af3zt", "color_mkxmnheg", "text_mkvdefh1", "phone_mkp0q3cw"]))
  .map(it => ({ n: nm(it.name), rs: txt(it, "color_mm6thrwv"), uid: txt(it, "text_mm3af3zt").trim(),
                sup: txt(it, "color_mkxmnheg"), dob: txt(it, "text_mkvdefh1").trim(), ph: dg(txt(it, "phone_mkp0q3cw")) }));

const byUid = new Map(), byName = new Map();
for (const [board, uidCol] of [[18410804557, "text_mm3av5nt"], [18410601299, "text_mm3a2b3n"], [18406060017, "text_mm3ac5a0"], [18406352652, null]]) {
  for (const it of await page(board, ["color_mm1w5wxr", uidCol, "text_mm1xvxst", "phone_mm1x44yk"])) {
    const rs = txt(it, "color_mm1w5wxr"); if (!rs) continue;
    const u = uidCol ? txt(it, uidCol).trim() : ""; if (u && !byUid.has(u)) byUid.set(u, rs);
    const k = nm(it.name); if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push({ rs, dob: txt(it, "text_mm1xvxst").trim(), ph: dg(txt(it, "phone_mm1x44yk")) });
  }
}
const truth = [];
for (const s of sub) {
  if (s.rs) { truth.push({ ...s, known: s.rs }); continue; }
  const u = s.uid && byUid.get(s.uid); if (u) { truth.push({ ...s, known: u }); continue; }
  const c = (byName.get(s.n) || []).filter(x => (x.ph && s.ph && x.ph === s.ph) || (x.dob && s.dob && x.dob === s.dob));
  const uq = [...new Set(c.map(x => x.rs))]; if (uq.length === 1) truth.push({ ...s, known: uq[0] });
}
console.log(`Ground truth: ${truth.length} Subscription patients with an establishable Referral Source\n`);
for (const st of ["Mobi", "t:slim", "iLet", "Minimed 780G", "Not Serving"]) {
  const rows = truth.filter(t => t.sup === st);
  if (!rows.length) { console.log(`${st}: no ground truth`); continue; }
  const c = {}; for (const r of rows) c[r.known] = (c[r.known] || 0) + 1;
  const exp = RULE[st], hit = exp ? (c[exp] || 0) : 0;
  console.log(`${st.padEnd(13)} n=${String(rows.length).padStart(3)}  rule says ${(exp || "(no rule)").padEnd(13)} -> ${hit}/${rows.length}${exp ? ` (${Math.round(hit / rows.length * 100)}%)` : ""}`);
  console.log(`              actual: ${Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`);
}
