/**
 * supabase-mirror — mirrors monday.com boards into Supabase (Postgres).
 *
 * ⚠️⚠️ READ-ONLY ON MONDAY. This service only ever sends GraphQL QUERIES.
 * It never writes a cell, moves an item or fires an automation, and
 * `noMondayWrites.test.mjs` fails the build if the word `mutation` appears
 * anywhere in it. The Command Center reads nothing from the mirror yet; it is
 * a sandbox until the port is designed (docs/claude/5.55).
 *
 * ⚠️ OFF unless `MIRROR_ENABLED=1`. Deploying it with the variable unset does
 * nothing but log one line and exit 0, so it can sit in Railway switched off.
 *
 * What one pass does (`syncBoard`):
 *   1. shape     — groups, columns, labels (every pass; cheap).
 *   2. full      — every item, every column — only when the board has never
 *                  been fully read (or `MIRROR_FULL=1`). Pages of
 *                  MIRROR_PAGE_SIZE with MIRROR_PAGE_DELAY_MS between them.
 *   3. incremental — otherwise: items ordered newest-updated-first, read until
 *                  the page reaches the previous pass's watermark (minus an
 *                  overlap), so a quiet hour costs one small request.
 *   4. reconcile — once a day: an ids-only scan of the whole board marks
 *                  items monday stopped listing as `missing` and re-reads
 *                  any whose group or updated_at disagrees with the mirror.
 * Every item read is diffed against the mirror's copy; differing columns go
 * to item_changes, and an unchanged item (same hash) is not written at all.
 *
 * ⚠️ Pacing (CLAUDE.md §9, the August 2026 complexity incident): a full read
 * of Profile Send Off is ~2,800 items × 164 columns ≈ 520k complexity in
 * ~60 requests, once. The steady state is one ~70-complexity request per
 * pass. The service reads monday's own `complexity.after` on every answer
 * and sleeps out the minute when it drops under MIRROR_COMPLEXITY_FLOOR.
 *
 * Env:
 *   MIRROR_ENABLED            "1" to run; anything else exits at once
 *   MONDAY_API_TOKEN          monday API token (read scope is enough)
 *   SUPABASE_DB_URL           Postgres connection string — Supabase's
 *                             "Session pooler" or direct URL, sslmode=require
 *   MIRROR_BOARD_IDS          comma-separated board ids (default 18406352652,
 *                             Profile Send Off)
 *   MIRROR_INTERVAL_SECONDS   between passes (default 120)
 *   MIRROR_PAGE_SIZE          items per full-read page (default 50)
 *   MIRROR_PAGE_DELAY_MS      pause between pages (default 400)
 *   MIRROR_OVERLAP_SECONDS    incremental overlap (default 300)
 *   MIRROR_RECONCILE_HOURS    reconcile cadence (default 24)
 *   MIRROR_COMPLEXITY_FLOOR   sleep when monday's remaining budget is under
 *                             this (default 2000000)
 *   MIRROR_FULL               "1" forces a full read on the next pass
 *   ONCE                      "1" runs one pass and exits
 *   DRY_RUN                   "1" reads monday and computes diffs but writes
 *                             nothing to Postgres (prints what it would do)
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  chunk,
  diffItems,
  idsPageQuery,
  incrementalSince,
  itemsByIdQuery,
  itemsPageQuery,
  labelsOf,
  normalizeItem,
  pageOf,
  parseSettings,
  reconcileDue,
  reconcilePlan,
  shapeQuery,
  takeUpdatedSince,
} from "./mirrorRules.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-10";

const env = (k, d) => (process.env[k] == null || process.env[k] === "" ? d : process.env[k]);
const CONFIG = {
  enabled: env("MIRROR_ENABLED", "") === "1",
  token: env("MONDAY_API_TOKEN", ""),
  dbUrl: env("SUPABASE_DB_URL", ""),
  boardIds: env("MIRROR_BOARD_IDS", "18406352652").split(",").map((s) => s.trim()).filter(Boolean),
  intervalSeconds: Number(env("MIRROR_INTERVAL_SECONDS", 120)),
  pageSize: Number(env("MIRROR_PAGE_SIZE", 50)),
  pageDelayMs: Number(env("MIRROR_PAGE_DELAY_MS", 400)),
  overlapSeconds: Number(env("MIRROR_OVERLAP_SECONDS", 300)),
  reconcileHours: Number(env("MIRROR_RECONCILE_HOURS", 24)),
  complexityFloor: Number(env("MIRROR_COMPLEXITY_FLOOR", 2_000_000)),
  forceFull: env("MIRROR_FULL", "") === "1",
  once: env("ONCE", "") === "1",
  dryRun: env("DRY_RUN", "") === "1",
};

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sslFor(url) {
  // A Supabase / Railway external connection string needs SSL; `sslmode=disable` opts out.
  return /sslmode=disable/.test(url || "") ? false : { rejectUnauthorized: false };
}

// ── monday ────────────────────────────────────────────────────────────────

/** One GraphQL query. Throws on HTTP or GraphQL errors; never retries a write (there are none). */
export async function mondayQuery(doc, { token = CONFIG.token, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(MONDAY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "API-Version": MONDAY_API_VERSION },
    body: JSON.stringify(doc),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`monday HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  if (json.errors?.length) throw new Error(`monday GraphQL: ${json.errors.map((e) => e.message).join("; ")}`);
  return json.data ?? {};
}

/** Sleep out the rest of the minute when monday's remaining budget is low. */
async function respectBudget(data) {
  const after = data?.complexity?.after;
  if (typeof after === "number" && after < CONFIG.complexityFloor) {
    log(`monday complexity budget low (${after} left) — pausing 60s`);
    await sleep(60_000);
  }
  return data?.complexity?.query ?? 0;
}

// ── Postgres ──────────────────────────────────────────────────────────────

export async function applySchema(pool) {
  const dir = join(HERE, "db");
  const files = readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    await pool.query(readFileSync(join(dir, f), "utf8"));
  }
  return files;
}

/** Upsert the board's shape. Returns the column list (id, type, settings) for the pass. */
async function syncShape(pool, boardId, data, runId) {
  const b = data.boards?.[0];
  if (!b) throw new Error(`board ${boardId} not readable`);
  const columns = b.columns.map((c, i) => ({ ...c, settings: parseSettings(c.settings_str), position: i }));
  if (CONFIG.dryRun) {
    log(`[dry] board ${boardId} "${b.name}": ${b.groups.length} groups, ${columns.length} columns, items_count=${b.items_count}`);
    return columns;
  }
  await pool.query(
    `INSERT INTO monday_mirror.boards (board_id, name, items_count, shape_synced_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (board_id) DO UPDATE SET name = EXCLUDED.name, items_count = EXCLUDED.items_count, shape_synced_at = now()`,
    [boardId, b.name, b.items_count ?? null],
  );
  for (const g of b.groups) {
    await pool.query(
      `INSERT INTO monday_mirror.groups (board_id, group_id, title, color, position, archived, deleted, seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (board_id, group_id) DO UPDATE SET title = EXCLUDED.title, color = EXCLUDED.color, position = EXCLUDED.position,
         archived = EXCLUDED.archived, deleted = EXCLUDED.deleted, seen_at = now()`,
      [boardId, g.id, g.title, g.color ?? null, g.position ?? null, !!g.archived, !!g.deleted],
    );
  }
  for (const c of columns) {
    await pool.query(
      `INSERT INTO monday_mirror.columns (board_id, column_id, title, type, description, settings, archived, position, seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (board_id, column_id) DO UPDATE SET title = EXCLUDED.title, type = EXCLUDED.type, description = EXCLUDED.description,
         settings = EXCLUDED.settings, archived = EXCLUDED.archived, position = EXCLUDED.position, seen_at = now()`,
      [boardId, c.id, c.title, c.type, c.description ?? null, JSON.stringify(c.settings), !!c.archived, c.position],
    );
    if (c.type === "status" || c.type === "dropdown") {
      for (const l of labelsOf(c)) {
        await pool.query(
          `INSERT INTO monday_mirror.labels (board_id, column_id, label_id, label, hex, is_done, is_deactivated, seen_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now())
           ON CONFLICT (board_id, column_id, label_id) DO UPDATE SET label = EXCLUDED.label, hex = EXCLUDED.hex,
             is_done = EXCLUDED.is_done, is_deactivated = EXCLUDED.is_deactivated, seen_at = now()`,
          [boardId, c.id, l.label_id, l.label, l.hex, l.is_done, l.is_deactivated],
        );
      }
    }
  }
  await pool.query(`UPDATE monday_mirror.sync_runs SET items_seen = $2 WHERE id = $1`, [runId, b.items_count ?? 0]);
  return columns;
}

/** The mirror's copy of some items, keyed by id. */
async function mirrorRows(pool, ids) {
  if (!ids.length) return new Map();
  const { rows } = await pool.query(
    `SELECT item_id, name, group_id, state, monday_updated_at, column_values, values_hash FROM monday_mirror.items WHERE item_id = ANY($1::bigint[])`,
    [ids],
  );
  return new Map(rows.map((r) => [Number(r.item_id), r]));
}

/**
 * Write a batch of monday items: unchanged ones touch last_seen_at only;
 * changed ones are upserted with their diffs recorded. Returns counts.
 */
async function writeItems(pool, boardId, rawItems, runId, stats) {
  const rows = rawItems.map((it) => normalizeItem(it, boardId));
  const prev = await mirrorRows(pool, rows.map((r) => r.item_id));
  for (const row of rows) {
    const old = prev.get(row.item_id);
    if (old && old.values_hash === row.values_hash && old.state === "active") {
      stats.items_unchanged++;
      if (!CONFIG.dryRun) await pool.query(`UPDATE monday_mirror.items SET last_seen_at = now() WHERE item_id = $1`, [row.item_id]);
      continue;
    }
    const changes = diffItems(old ? { ...old, state: old.state } : null, { ...row, state: "active" });
    stats.items_upserted++;
    stats.changes += changes.length;
    if (CONFIG.dryRun) {
      log(`[dry] ${old ? "update" : "insert"} item ${row.item_id} (${changes.length} changes${old ? "" : ", new"})`);
      continue;
    }
    await pool.query(
      `INSERT INTO monday_mirror.items (item_id, board_id, name, group_id, state, monday_created_at, monday_updated_at, column_values, values_hash,
         first_seen_at, last_seen_at, missing_since, sync_run_id)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8, now(), now(), NULL, $9)
       ON CONFLICT (item_id) DO UPDATE SET name = EXCLUDED.name, group_id = EXCLUDED.group_id, state = 'active',
         monday_created_at = EXCLUDED.monday_created_at, monday_updated_at = EXCLUDED.monday_updated_at,
         column_values = EXCLUDED.column_values, values_hash = EXCLUDED.values_hash, last_seen_at = now(), missing_since = NULL,
         sync_run_id = EXCLUDED.sync_run_id`,
      [row.item_id, boardId, row.name, row.group_id, row.monday_created_at, row.monday_updated_at, JSON.stringify(row.column_values), row.values_hash, runId],
    );
    for (const c of changes) {
      await pool.query(
        `INSERT INTO monday_mirror.item_changes (board_id, item_id, column_id, monday_updated_at, old_text, new_text, old_value, new_value, sync_run_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [boardId, row.item_id, c.column_id, row.monday_updated_at, c.old_text, c.new_text, c.old_value == null ? null : JSON.stringify(c.old_value), c.new_value == null ? null : JSON.stringify(c.new_value), runId],
      );
    }
  }
}

async function startRun(pool, boardId, kind, since = null) {
  if (CONFIG.dryRun) return { id: null, stats: newStats() };
  const { rows } = await pool.query(
    `INSERT INTO monday_mirror.sync_runs (board_id, kind, since, dry_run) VALUES ($1, $2, $3, false) RETURNING id`,
    [boardId, kind, since],
  );
  return { id: rows[0].id, stats: newStats() };
}
const newStats = () => ({ pages: 0, items_seen: 0, items_upserted: 0, items_unchanged: 0, items_missing: 0, changes: 0, complexity_used: 0 });

async function finishRun(pool, run, ok, error = null) {
  if (CONFIG.dryRun || run.id == null) {
    log(`[dry] run finished ok=${ok}`, JSON.stringify(run.stats), error ? `error=${error}` : "");
    return;
  }
  const s = run.stats;
  await pool.query(
    `UPDATE monday_mirror.sync_runs SET finished_at = now(), ok = $2, pages = $3, items_seen = GREATEST(items_seen, $4), items_upserted = $5,
       items_unchanged = $6, items_missing = $7, changes = $8, complexity_used = $9, error = $10 WHERE id = $1`,
    [run.id, ok, s.pages, s.items_seen, s.items_upserted, s.items_unchanged, s.items_missing, s.changes, s.complexity_used, error],
  );
}

// ── The passes ────────────────────────────────────────────────────────────

async function fullRead(pool, boardId, run) {
  let cursor = null;
  do {
    const data = await mondayQuery(itemsPageQuery(boardId, { limit: CONFIG.pageSize, cursor }));
    run.stats.complexity_used += await respectBudget(data);
    const page = pageOf(data);
    run.stats.pages++;
    run.stats.items_seen += page.items.length;
    await writeItems(pool, boardId, page.items, run.id, run.stats);
    cursor = page.cursor;
    log(`full: page ${run.stats.pages}, ${page.items.length} items (${run.stats.items_upserted} written, ${run.stats.items_unchanged} unchanged)`);
    if (cursor) await sleep(CONFIG.pageDelayMs);
  } while (cursor);
}

async function incrementalRead(pool, boardId, run, sinceIso) {
  let cursor = null;
  do {
    const data = await mondayQuery(itemsPageQuery(boardId, { limit: CONFIG.pageSize, cursor, orderByUpdated: true }));
    run.stats.complexity_used += await respectBudget(data);
    const page = pageOf(data);
    run.stats.pages++;
    const { items, done } = takeUpdatedSince(page.items, sinceIso);
    run.stats.items_seen += items.length;
    await writeItems(pool, boardId, items, run.id, run.stats);
    cursor = done ? null : page.cursor;
    if (cursor) await sleep(CONFIG.pageDelayMs);
  } while (cursor);
}

async function reconcile(pool, boardId, run) {
  const scanned = [];
  let cursor = null;
  do {
    const data = await mondayQuery(idsPageQuery(boardId, { cursor }));
    run.stats.complexity_used += await respectBudget(data);
    const page = pageOf(data);
    run.stats.pages++;
    scanned.push(...page.items);
    cursor = page.cursor;
    if (cursor) await sleep(CONFIG.pageDelayMs);
  } while (cursor);
  run.stats.items_seen = scanned.length;

  const { rows } = await pool.query(`SELECT item_id, group_id, state, monday_updated_at FROM monday_mirror.items WHERE board_id = $1`, [boardId]);
  const plan = reconcilePlan(rows, scanned);
  run.stats.items_missing = plan.missing.length;
  log(`reconcile: ${scanned.length} listed, ${plan.missing.length} missing, ${plan.stale.length} to re-read`);
  if (plan.missing.length && !CONFIG.dryRun) {
    await pool.query(
      `UPDATE monday_mirror.items SET state = 'missing', missing_since = COALESCE(missing_since, now()), sync_run_id = $2
       WHERE item_id = ANY($1::bigint[]) AND state <> 'missing'`,
      [plan.missing, run.id],
    );
    for (const id of plan.missing) {
      await pool.query(
        `INSERT INTO monday_mirror.item_changes (board_id, item_id, column_id, old_text, new_text, sync_run_id) VALUES ($1, $2, '__state__', 'active', 'missing', $3)`,
        [boardId, id, run.id],
      );
    }
  }
  for (const ids of chunk(plan.stale, 100)) {
    const data = await mondayQuery(itemsByIdQuery(ids));
    run.stats.complexity_used += await respectBudget(data);
    await writeItems(pool, boardId, data.items ?? [], run.id, run.stats);
    await sleep(CONFIG.pageDelayMs);
  }
}

/** One pass over one board. Exported so a test can drive it against a real Postgres. */
export async function syncBoard(pool, boardId, { forceFull = CONFIG.forceFull } = {}) {
  // Shape first — the column list is the contract for everything after.
  const shapeRun = await startRun(pool, boardId, "shape");
  try {
    const data = await mondayQuery(shapeQuery(boardId));
    shapeRun.stats.complexity_used += await respectBudget(data);
    await syncShape(pool, boardId, data, shapeRun.id);
    await finishRun(pool, shapeRun, true);
  } catch (e) {
    await finishRun(pool, shapeRun, false, String(e?.message ?? e));
    throw e;
  }

  const { rows } = CONFIG.dryRun
    ? { rows: [] }
    : await pool.query(`SELECT last_full_sync_at, last_incremental_sync_at, last_reconcile_at FROM monday_mirror.boards WHERE board_id = $1`, [boardId]);
  const board = rows[0] ?? {};
  const needFull = forceFull || !board.last_full_sync_at;

  if (needFull) {
    const run = await startRun(pool, boardId, "full");
    try {
      await fullRead(pool, boardId, run);
      await finishRun(pool, run, true);
      if (!CONFIG.dryRun) await pool.query(`UPDATE monday_mirror.boards SET last_full_sync_at = now(), last_incremental_sync_at = now(), last_reconcile_at = now() WHERE board_id = $1`, [boardId]);
    } catch (e) {
      await finishRun(pool, run, false, String(e?.message ?? e));
      throw e;
    }
    return;
  }

  const since = incrementalSince(board.last_incremental_sync_at, CONFIG.overlapSeconds);
  const run = await startRun(pool, boardId, "incremental", since);
  const startedAt = new Date();
  try {
    await incrementalRead(pool, boardId, run, since);
    await finishRun(pool, run, true);
    if (!CONFIG.dryRun) await pool.query(`UPDATE monday_mirror.boards SET last_incremental_sync_at = $2 WHERE board_id = $1`, [boardId, startedAt]);
  } catch (e) {
    await finishRun(pool, run, false, String(e?.message ?? e));
    throw e;
  }

  if (reconcileDue(board.last_reconcile_at, Date.now(), CONFIG.reconcileHours)) {
    const rr = await startRun(pool, boardId, "reconcile");
    try {
      await reconcile(pool, boardId, rr);
      await finishRun(pool, rr, true);
      if (!CONFIG.dryRun) await pool.query(`UPDATE monday_mirror.boards SET last_reconcile_at = now() WHERE board_id = $1`, [boardId]);
    } catch (e) {
      await finishRun(pool, rr, false, String(e?.message ?? e));
      throw e;
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (!CONFIG.enabled) {
    log("MIRROR_ENABLED is not 1 — the mirror is switched off. Exiting.");
    return;
  }
  if (!CONFIG.token) throw new Error("MONDAY_API_TOKEN not set");
  if (!CONFIG.dbUrl && !CONFIG.dryRun) throw new Error("SUPABASE_DB_URL not set");

  const pool = CONFIG.dbUrl ? new pg.Pool({ connectionString: CONFIG.dbUrl, max: 3, ssl: sslFor(CONFIG.dbUrl) }) : null;
  if (pool) {
    const files = await applySchema(pool);
    log(`schema applied: ${files.join(", ")}`);
  } else {
    log("[dry] no SUPABASE_DB_URL — reading monday only");
  }
  const dryPool = { query: async () => ({ rows: [] }) };

  for (;;) {
    for (const boardId of CONFIG.boardIds) {
      const t0 = Date.now();
      try {
        await syncBoard(pool ?? dryPool, boardId);
        log(`board ${boardId}: pass done in ${Math.round((Date.now() - t0) / 1000)}s`);
      } catch (e) {
        log(`board ${boardId}: pass FAILED — ${e?.message ?? e}`);
      }
    }
    if (CONFIG.once) break;
    await sleep(CONFIG.intervalSeconds * 1000);
  }
  await pool?.end();
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
