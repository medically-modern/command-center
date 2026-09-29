#!/usr/bin/env node
/**
 * Generate the typed view of a mirrored board — one Postgres column per
 * board column — from the board's shape snapshot and the app's own column
 * names.
 *
 *   node scripts/supabase-mirror/gen-view.mjs \
 *     supabase/snapshots/profile_send_off_board.json \
 *     src/lib/profile/mondayApi.ts \
 *     monday_mirror.profile_send_off > services/supabase-mirror/db/0002_profile_send_off_view.sql
 *
 * Column NAMES come from the app's `COL` map (`lib/profile/mondayApi.ts`)
 * wherever the board column has one — `dupCheckResult` → `dup_check_result`
 * — so the view speaks the vocabulary the code already uses. A board column
 * the app never mapped is named from its monday title. Either way the monday
 * column id is kept in a comment on the line, because the id is the contract
 * (CLAUDE.md §3) and the title can be renamed under it.
 *
 * Per monday type:
 *   status    → <name> TEXT (the label) + <name>_id INT (the label id)
 *   dropdown  → <name> TEXT (monday's comma-joined text) + <name>_ids INT[]
 *   date      → <name> DATE (+ <name>_time TIME where the cell carries one)
 *   numbers   → <name> NUMERIC
 *   phone / email → TEXT (the number / address, not the display text)
 *   location  → <name> TEXT + <name>_lat / <name>_lng NUMERIC
 *   file      → <name> JSONB (the files array)
 *   everything else → TEXT (monday's `text`)
 *
 * ⚠️ Regenerate — never hand-edit — when the board gains a column, and ship
 * it as a NEW migration (CREATE OR REPLACE VIEW cannot drop or reorder
 * columns; a changed set is DROP VIEW + CREATE, which this file emits).
 * `viewAgreement.test.mjs` fails when the committed SQL is stale.
 */
import { readFileSync } from "node:fs";

export function snakeCase(s) {
  return String(s)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

/** `COL = { key: "column_id", … }` → { column_id: key }. */
export function colNamesFrom(tsSource) {
  const out = {};
  const m = tsSource.match(/export const COL = \{([\s\S]*?)\n\} as const;/);
  if (!m) return out;
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^\s*([A-Za-z0-9_]+):\s*"([^"]+)"/);
    if (mm) out[mm[2]] = mm[1];
  }
  return out;
}

const RESERVED = new Set(["name", "item_id", "board_id", "group_id", "group_title", "state", "monday_created_at", "monday_updated_at", "column_values", "first_seen_at", "last_seen_at", "missing_since", "values_hash"]);

export function columnPlan(board, names) {
  const used = new Set(RESERVED);
  const plan = [];
  for (const c of board.columns) {
    if (c.type === "name") continue;
    let base = names[c.id] ? snakeCase(names[c.id]) : snakeCase(c.title);
    if (!base || /^[0-9]/.test(base)) base = `col_${snakeCase(c.id)}`;
    let name = base;
    let n = 2;
    while (used.has(name)) name = `${base}_${n++}`;
    used.add(name);
    plan.push({ id: c.id, title: c.title, type: c.type, name });
  }
  return plan;
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function viewSql(board, names, viewName) {
  const plan = columnPlan(board, names);
  const lines = [];
  const add = (expr, alias, id, title) => lines.push(`  ${expr} AS ${alias}, -- ${id} · ${title}`);
  for (const c of plan) {
    const cv = "i.column_values";
    const t = q(c.id);
    switch (c.type) {
      case "status":
        add(`monday_mirror.cv_text(${cv}, ${t})`, c.name, c.id, c.title);
        add(`monday_mirror.cv_status_id(${cv}, ${t})`, `${c.name}_id`, c.id, `${c.title} (label id)`);
        break;
      case "dropdown":
        add(`monday_mirror.cv_text(${cv}, ${t})`, c.name, c.id, c.title);
        add(`monday_mirror.cv_dropdown_ids(${cv}, ${t})`, `${c.name}_ids`, c.id, `${c.title} (label ids)`);
        break;
      case "date":
        add(`monday_mirror.cv_date(${cv}, ${t})`, c.name, c.id, c.title);
        add(`monday_mirror.cv_time(${cv}, ${t})`, `${c.name}_time`, c.id, `${c.title} (time of day, ET)`);
        break;
      case "numbers":
        add(`monday_mirror.cv_number(${cv}, ${t})`, c.name, c.id, c.title);
        break;
      case "phone":
        add(`monday_mirror.cv_phone(${cv}, ${t})`, c.name, c.id, c.title);
        break;
      case "email":
        add(`monday_mirror.cv_email(${cv}, ${t})`, c.name, c.id, c.title);
        break;
      case "location":
        add(`monday_mirror.cv_address(${cv}, ${t})`, c.name, c.id, c.title);
        add(`monday_mirror.cv_lat(${cv}, ${t})`, `${c.name}_lat`, c.id, `${c.title} (lat)`);
        add(`monday_mirror.cv_lng(${cv}, ${t})`, `${c.name}_lng`, c.id, `${c.title} (lng)`);
        break;
      case "file":
        add(`monday_mirror.cv_files(${cv}, ${t})`, c.name, c.id, c.title);
        break;
      default:
        add(`monday_mirror.cv_text(${cv}, ${t})`, c.name, c.id, `${c.title} (${c.type})`);
    }
  }
  // The last select line must not end in a comma: strip it from the last entry.
  const last = lines.length - 1;
  lines[last] = lines[last].replace(/, -- /, " -- ");
  return `-- GENERATED by scripts/supabase-mirror/gen-view.mjs from ${board.name} (board ${board.board_id}),
-- shape snapshot ${board.snapshot_taken}, ${plan.length} board columns. Do not edit by hand.
--
-- One row per mirrored item, one Postgres column per board column, typed.
-- Reads monday_mirror.items; nothing here is written by anyone.

DROP VIEW IF EXISTS ${viewName};
CREATE VIEW ${viewName} AS
SELECT
  i.item_id,
  i.board_id,
  i.name,
  i.group_id,
  g.title AS group_title,
  i.state,
  i.monday_created_at,
  i.monday_updated_at,
  i.last_seen_at,
  i.missing_since,
${lines.join("\n")}
FROM monday_mirror.items i
LEFT JOIN monday_mirror.groups g ON g.board_id = i.board_id AND g.group_id = i.group_id
WHERE i.board_id = ${board.board_id};
`;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const [snapshotPath, tsPath, viewName] = process.argv.slice(2);
  if (!snapshotPath || !tsPath || !viewName) {
    console.error("usage: gen-view.mjs <board snapshot json> <mondayApi.ts> <schema.view_name>");
    process.exit(2);
  }
  const board = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const names = colNamesFrom(readFileSync(tsPath, "utf8"));
  process.stdout.write(viewSql(board, names, viewName));
}
