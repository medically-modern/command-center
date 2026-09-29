#!/usr/bin/env node
/**
 * Turn a monday `list_automations` dump into the PHI-free automation
 * inventory the Supabase mirror seeds (`supabase/snapshots/<board>_automations.json`)
 * and the table in docs/claude/5.55.
 *
 * Board automations are NOT in monday's public GraphQL API. The only machine
 * read of them is the monday MCP server's `list_automations` tool, which a
 * Claude session can call; it saves the (large) answer to a file. Run:
 *
 *   node scripts/supabase-mirror/automations-from-mcp-dump.mjs <dump.json> > supabase/snapshots/profile_send_off_automations.json
 *
 * What it resolves, from the dump's `workflow_variables`:
 *  · every block's inbound field → the configured column / group / board /
 *    label (id AND title), or the upstream node's output it reads;
 *  · a condition's label LIST (`[78,80,…]`) → each entry's label, because those
 *    numbers are workflow-variable keys, not the column's own label ids — the
 *    column's id sits on the referenced variable (`config.value`).
 *  · "Create item in board" mappings → source column → destination column.
 * Legacy (recipe) automations are webhooks: the recipe sentence plus the
 * configured column / group / label. The webhook URL is not in the dump.
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: automations-from-mcp-dump.mjs <list_automations dump>");
  process.exit(2);
}
const dump = JSON.parse(readFileSync(file, "utf8"));

/** Rich-text → the variable key it interpolates, or the plain text. */
function richText(v) {
  if (!v || typeof v !== "object" || !v.root) return null;
  const keys = [];
  const walk = (n) => {
    if (!n) return;
    if (n.type === "field" && n.variableKey != null) keys.push(n.variableKey);
    (n.children || []).forEach(walk);
  };
  walk(v.root);
  return keys;
}

function resolveWorkflow(w) {
  const vars = new Map(w.workflow_variables.map((v) => [String(v.workflowVariableKey), v]));
  const label = (key) => {
    const v = vars.get(String(key));
    if (!v) return { unresolved: key };
    if (v.sourceKind === "host_metadata") return { board: "this" };
    if (v.sourceKind === "node_results") {
      return { from_node: v.sourceMetadata.workflowNodeId, field: v.sourceMetadata.outboundFieldKey };
    }
    const c = v.config || {};
    let val = c.value;
    // Rich text arrives JSON-ENCODED as a string; a plain reference to another
    // variable arrives as that variable's key with it listed in `dependencies`.
    if (typeof val === "string" && val.startsWith('{"root"')) {
      try { val = JSON.parse(val); } catch { /* leave as text */ }
    }
    if (Array.isArray(c.dependencies) && c.dependencies.length === 1 && String(val) === String(c.dependencies[0])) {
      return label(c.dependencies[0]);
    }
    if (Array.isArray(val) && val.every((x) => typeof x === "number")) {
      return val.length === 1 ? label(val[0]) : { any_of: val.map((k) => label(k)) };
    }
    const rt = richText(val);
    if (rt) return rt.length === 1 ? label(rt[0]) : { concat: rt.map((k) => label(k)) };
    if (val && typeof val === "object") return { value: val };
    const out = {};
    if (c.title != null) out.title = c.title;
    if (val != null) out.id = val;
    if (c.type) out.type = c.type;
    return out;
  };
  const blocks = [...w.workflow_blocks].sort((a, b) => a.workflowNodeId - b.workflowNodeId);
  const nodes = blocks.map((b) => {
    const fields = {};
    for (const [k, ref] of Object.entries(b.inboundFieldsSourceConfig || {})) {
      if (k === "fieldsUsages") continue;
      fields[k] = label(ref.workflowVariableKey);
    }
    return { node: b.workflowNodeId, block: b.title, fields };
  });
  const trigger = nodes[0];
  const conditions = nodes.slice(1).filter((n) => /^If /.test(n.block));
  const actions = nodes.slice(1).filter((n) => !/^If /.test(n.block));
  return {
    id: Number(w.id),
    kind: "workflow",
    active: !!w.is_active,
    created_at: w.created_at,
    updated_at: w.updated_at,
    description: (w.description || "").trim() || null,
    trigger,
    conditions,
    actions,
  };
}

const recipes = new Map();
for (const list of Object.values(dump.legacyAutomations?.recipes || {})) {
  for (const r of list || []) recipes.set(r.id, r.sentence);
}
function resolveLegacy(a) {
  return {
    id: a.id,
    kind: "legacy_recipe",
    active: a.active === true || a.state === "active",
    state: a.state,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
    recipe_id: a.recipeId,
    sentence: recipes.get(a.recipeId) || null,
    config: a.config || {},
    source: a.source || null,
  };
}

const out = {
  board_id: dump.legacyAutomations?.automations?.[0]?.boardId ?? null,
  snapshot_taken: new Date().toISOString().slice(0, 10),
  workflows: (dump.workflows || []).map(resolveWorkflow),
  legacy: (dump.legacyAutomations?.automations || []).map(resolveLegacy),
};
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
