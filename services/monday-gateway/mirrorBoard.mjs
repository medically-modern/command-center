/**
 * The Supabase copy of a monday board, for the Monday-style board page
 * (`/supabase-board`, docs/claude/5.55 *The board page*).
 *
 * WHY THROUGH THE GATEWAY, rather than the browser reading Supabase:
 *  · The copy is PHI and the `monday_mirror` schema has RLS on with NO
 *    policies, on purpose — Supabase's API hands nothing to anybody. Opening
 *    it to the browser would mean Supabase Auth (the app signs in with Google,
 *    §5.4) or a policy that any publishable-key holder could satisfy.
 *  · This gateway already checks a signed-in medicallymodern.com employee on
 *    every PHI route. That identity check is the whole gate here, as it is on
 *    /calendly/day.
 *
 * ⚠️ READ ONLY, enforced by Postgres: every read runs inside
 * `BEGIN READ ONLY`, so even a mistaken statement cannot write. The same
 * connection string as the mirror service is used (a Railway reference
 * variable, never a second copy of the password); a dedicated read-only role
 * is the hardening step listed in §5.55.
 *
 * ⚠️ PRODUCTION SAFETY. This gateway serves test AND prod. An idle client that
 * Supabase's pooler drops emits `error` on the pool; unhandled, that kills the
 * process. The pool below handles it, keeps at most two connections, and lets
 * idle ones go after 10 s. Unset SUPABASE_DB_URL → the route answers 503 and
 * nothing connects at all.
 */
import { createRequire } from "node:module";
import { verifyGoogleIdentity } from "./auth.mjs";
import { BOARD_SQL, ITEM_LIMIT, shapeBoard, validBoardId } from "./mirrorBoardRules.mjs";

const DB_URL = process.env.SUPABASE_DB_URL || "";

function sslFor(url) {
  return /sslmode=disable/.test(url || "") ? false : { rejectUnauthorized: false };
}

let _pool = null;
function defaultPool() {
  if (!DB_URL) return null;
  if (!_pool) {
    // ⚠️ Required lazily, never `import pg from "pg"`: the test run (a root
    // `npm install`) has no gateway node_modules, and vite fails to transform a
    // file that names an unresolvable package — the CI break of 2026-09-29.
    const { Pool } = createRequire(import.meta.url)("pg");
    _pool = new Pool({
      connectionString: DB_URL,
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      ssl: sslFor(DB_URL),
    });
    _pool.on("error", (e) => console.warn(`[mirror-board] idle Supabase connection dropped: ${e?.message ?? e}`));
  }
  return _pool;
}

/**
 * A short shared cache: a room of open board pages asking at once shares one
 * read. The copy itself only moves every two minutes (the mirror's pass).
 */
const CACHE_MS = 15_000;
const cache = new Map(); // boardId → { at, body }

/** Read one board's copy inside a READ ONLY transaction. Exported for the route test. */
export async function readBoard(pool, boardId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const board = (await client.query(BOARD_SQL.board, [boardId])).rows[0];
    if (!board) {
      await client.query("ROLLBACK");
      return null;
    }
    const groups = (await client.query(BOARD_SQL.groups, [boardId])).rows;
    const columns = (await client.query(BOARD_SQL.columns, [boardId])).rows;
    const labels = (await client.query(BOARD_SQL.labels, [boardId])).rows;
    const items = (await client.query(BOARD_SQL.items, [boardId, ITEM_LIMIT])).rows;
    await client.query("COMMIT");
    return shapeBoard({ board, groups, columns, labels, items });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export function registerMirrorBoard({ app, pool: injected = null, identify = verifyGoogleIdentity } = {}) {
  const getPool = () => injected ?? defaultPool();

  app.get("/mirror/board/health", (_req, res) => {
    res.json({ ok: true, configured: Boolean(injected || DB_URL) });
  });

  app.get("/mirror/board", async (req, res) => {
    // Blocking identity: the answer is every column of every patient in the copy.
    const who = await identify(req.headers["x-mm-auth"]);
    if (!who?.email) return res.status(401).json({ ok: false, error: "Sign in required" });

    const pool = getPool();
    if (!pool) return res.status(503).json({ ok: false, error: "SUPABASE_DB_URL not set on the gateway" });

    const boardId = validBoardId(req.query.board ?? "18406352652");
    if (!boardId) return res.status(400).json({ ok: false, error: "board must be a monday board id" });

    const hit = cache.get(boardId);
    if (hit && Date.now() - hit.at < CACHE_MS) return res.json({ ...hit.body, cached: true });

    try {
      const body = await readBoard(pool, boardId);
      if (!body) return res.status(404).json({ ok: false, error: `board ${boardId} is not mirrored` });
      cache.set(boardId, { at: Date.now(), body });
      res.json(body);
    } catch (e) {
      // The message only — never a row. A dead copy is a 502, never an empty 200.
      console.warn(`[mirror-board] read failed: ${e?.message ?? e}`);
      res.status(502).json({ ok: false, error: "Could not read the Supabase copy" });
    }
  });
}
