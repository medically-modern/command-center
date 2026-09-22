#!/usr/bin/env node
/**
 * Which Profile Send Off column reaches Welcome Call, and as what.
 *
 * The Cash Pay route skips Medical Evaluation and Insurance (CLAUDE.md §5.48),
 * so its create-item step has to carry in ONE hop what three hops carry today.
 * Rather than eyeball two 150-column boards, this chains the three live
 * automations a column must survive:
 *
 *   7917676280  Profile Send Off  → Medical Evaluation
 *   7918295320  Medical Evaluation → Insurance
 *   7918324247  Insurance          → Welcome Call
 *
 * ⚠️ It reads SAVED `list_automations` output rather than calling monday — it
 * holds no credentials and can write nothing. Point it at the directory the
 * monday MCP tool saved its responses into; the three boards' files are
 * matched by the board id inside them, not by filename.
 *
 * ⚠️ **A column mapping names its source nowhere obvious.** The create-item
 * block's `inboundFieldsSourceConfig` gives a `workflowVariableKey` per target
 * column; the variable resolves to the trigger column through
 * `sourceMetadata.outboundFieldKey`, and a TRANSFORMED one (a date, a
 * dynamic-text item name) only through its `config.dependencies` chain. Read
 * the direct key alone and the transformed columns look unmapped.
 *
 * ⚠️ **One source can feed SEVERAL targets** — Profile Send Off's Deductible
 * feeds both "Deductible" and "Stedi Individual Deductible" on Medical
 * Evaluation, and only the first survives to Welcome Call. Collapsing the
 * mapping into a source→target Map silently keeps whichever came last, which
 * dropped Deductible from the first version of this table.
 *
 * Usage:  node scripts/cash-pay/deriveHopChain.mjs <dir-of-saved-responses>
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const HOPS = [
  { id: "7917676280", from: "18406352652", label: "Profile Send Off → Medical Evaluation" },
  { id: "7918295320", from: "18406060017", label: "Medical Evaluation → Insurance" },
  { id: "7918324247", from: "18410601299", label: "Insurance → Welcome Call" },
];

/** `item.color_mm1w7e5q.label` → `color_mm1w7e5q` */
const bare = (k) => (k || "").replace(/^item\./, "").replace(/\.(label|labels|text)$/, "");

function findWorkflow(dir, workflowId) {
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".txt") && !f.endsWith(".json")) continue;
    let j;
    try { j = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { continue; }
    const wf = (j.workflows || []).find((w) => String(w.id) === workflowId);
    if (wf) return wf;
  }
  return null;
}

/**
 * [sourceColumn, targetColumn] for every column the create-item block COPIES.
 *
 * ⚠️ Not every target is a copy. A mapping whose variable resolves to no source
 * column is a CONSTANT the automation sets — 7918324247 writes the literal
 * "TIME IN PIPELINE -->" into Welcome Call's section-divider column that way.
 * Those are reported separately rather than thrown on (they carry nothing from
 * the patient) and rather than silently treated as a copy of nothing, which is
 * how one would go missing from the chain without anybody noticing.
 */
function pairs(wf) {
  const vars = new Map((wf.workflow_variables || []).map((v) => [v.workflowVariableKey, v]));
  const source = (key, seen = new Set()) => {
    if (seen.has(key)) return null;
    seen.add(key);
    const v = vars.get(key);
    if (!v) return null;
    if (v.sourceMetadata?.outboundFieldKey) return v.sourceMetadata.outboundFieldKey;
    for (const d of v.config?.dependencies ?? []) {
      const r = source(d, seen);
      if (r) return r;
    }
    return null;
  };
  const block = (wf.workflow_blocks || []).find((b) => b.title === "Create item in board");
  if (!block) throw new Error(`workflow ${wf.id} has no "Create item in board" block`);
  const out = [];
  const constants = [];
  for (const [target, ref] of Object.entries(block.inboundFieldsSourceConfig || {})) {
    if (!target.startsWith("item.")) continue;
    const s = source(ref.workflowVariableKey);
    if (!s) { constants.push(bare(target)); continue; }
    out.push([bare(s), bare(target)]);
  }
  return { rows: out, constants };
}

/** source → [targets]; a fan-out is real, so never a plain Map of one. */
const fan = (rows) => rows.reduce((m, [s, t]) => m.set(s, [...(m.get(s) ?? []), t]), new Map());

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/cash-pay/deriveHopChain.mjs <dir-of-saved-list_automations-responses>");
  process.exit(2);
}

const steps = HOPS.map((h) => {
  const wf = findWorkflow(dir, h.id);
  if (!wf) {
    console.error(`!! ${h.label}: workflow ${h.id} not found in ${dir}.`);
    console.error(`   Run the monday MCP list_automations for board ${h.from} and save its output there.`);
    process.exit(1);
  }
  const { rows, constants } = pairs(wf);
  console.error(
    `${h.label}: ${rows.length} copied` +
    (constants.length ? `, ${constants.length} set to a constant (${constants.join(", ")})` : ""),
  );
  return fan(rows);
});

const [a, b, c] = steps;
const reached = [];
const lost = [];
for (const [pso, mes] of a) {
  const hits = [];
  for (const me of mes) for (const ins of b.get(me) ?? []) for (const wc of c.get(ins) ?? []) hits.push([me, ins, wc]);
  if (hits.length) for (const [me, ins, wc] of hits) reached.push({ pso, me, ins, wc });
  else lost.push(pso);
}

console.error(`\nreaches Welcome Call: ${reached.length}   stops earlier: ${lost.length}`);
console.log(JSON.stringify({ reached, lost }, null, 2));
