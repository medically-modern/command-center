/**
 * The Supabase board page's gateway route (docs/claude/5.55 *The board page*).
 * Rules, route refusals, the READ ONLY transaction, and — against a real
 * Postgres when MIRROR_TEST_DB_URL is set — the SQL itself over the mirror's
 * own schema:
 *
 *   MIRROR_TEST_DB_URL=postgres://postgres@127.0.0.1:5433/postgres?sslmode=disable npx vitest run services/monday-gateway/mirrorBoard
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { BOARD_SQL, compactCell, shapeBoard, validBoardId } from "./mirrorBoardRules.mjs";
import { readBoard, registerMirrorBoard } from "./mirrorBoard.mjs";

const HERE = join(process.cwd(), "services/monday-gateway");

/* Synthetic rows in the mirror's shapes — no real patient. */
const ROWS = {
  board: { board_id: "18406352652", name: "Profile Send Off Board", items_count: 2823, last_incremental_sync_at: new Date("2026-09-29T20:43:00Z") },
  groups: [
    { group_id: "g_done", title: "Completed", color: "#00c875", position: "131072.0" },
    { group_id: "g_intake", title: "1. Intake", color: "#579bfc", position: "65536.0" },
  ],
  columns: [
    { column_id: "name", title: "Name", type: "name", position: 0 },
    { column_id: "color_x", title: "Already In System", type: "status", position: 1 },
    { column_id: "date_x", title: "Date of Intake", type: "date", position: 2 },
    { column_id: "dropdown_x", title: "Diagnosis", type: "dropdown", position: 3 },
    { column_id: "file_x", title: "Card", type: "file", position: 4 },
    { column_id: "text_x", title: "Notes", type: "text", position: 5 },
  ],
  labels: [
    { column_id: "color_x", label_id: 0, label: "Yes", hex: "#df2f4a" },
    { column_id: "color_x", label_id: 1, label: "No", hex: "#00c875" },
  ],
  items: [
    {
      item_id: "13000000001", name: "Test Patient", group_id: "g_intake",
      monday_created_at: new Date("2026-09-29T14:00:00Z"), monday_updated_at: new Date("2026-09-29T15:00:00Z"),
      column_values: {
        color_x: { text: "No", value: { index: 1, changed_at: "2026-09-29T15:00:00Z" } },
        date_x: { text: "2026-09-29", value: { date: "2026-09-29" } },
        dropdown_x: { text: "E11.9, E10.9", value: { ids: [3, 4] } },
        file_x: { text: "https://x.monday.com/protected_static/a.pdf", value: { files: [{ name: "card.pdf" }] } },
        text_x: { text: "", value: null },
      },
    },
  ],
};

describe("rules", () => {
  it("validBoardId takes digits only", () => {
    expect(validBoardId("18406352652")).toBe("18406352652");
    expect(validBoardId(" 18406352652 ")).toBe("18406352652");
    for (const bad of ["", "abc", "1840; DROP", "12", null]) expect(validBoardId(bad)).toBeNull();
  });

  it("compactCell: blank is omitted; status keeps its label id; files are a count, never a URL", () => {
    expect(compactCell("text", { text: "", value: null })).toBeNull();
    expect(compactCell("text", null)).toBeNull();
    expect(compactCell("status", { text: "No", value: { index: 1 } })).toEqual({ t: "No", i: 1 });
    expect(compactCell("status", { text: "", value: null })).toBeNull();
    expect(compactCell("dropdown", { text: "A, B", value: { ids: [1, 2] } })).toEqual({ t: "A, B", ids: [1, 2] });
    expect(compactCell("file", { text: "https://x/protected_static/a.pdf", value: { files: [{}, {}] } })).toEqual({ n: 2 });
    expect(JSON.stringify(compactCell("file", { text: "https://x/protected_static/a.pdf", value: { files: [{}] } }))).not.toContain("http");
  });

  it("shapeBoard: groups in monday's order, the name column dropped, labels keyed for colour lookup", () => {
    const out = shapeBoard(ROWS);
    expect(out.groups.map((g) => g.title)).toEqual(["1. Intake", "Completed"]);
    expect(out.columns.map((c) => c.id)).toEqual(["color_x", "date_x", "dropdown_x", "file_x", "text_x"]);
    expect(out.labels.color_x[1]).toEqual({ label: "No", hex: "#00c875" });
    expect(out.board).toEqual({ id: "18406352652", name: "Profile Send Off Board", itemsOnMonday: 2823, syncedAt: "2026-09-29T20:43:00.000Z" });
    expect(out.items[0]).toMatchObject({ id: "13000000001", groupId: "g_intake", createdAt: "2026-09-29T14:00:00.000Z" });
    expect(out.items[0].cells).toEqual({ color_x: { t: "No", i: 1 }, date_x: { t: "2026-09-29" }, dropdown_x: { t: "E11.9, E10.9", ids: [3, 4] }, file_x: { n: 1 } });
  });

  it("every statement only reads", () => {
    for (const sql of Object.values(BOARD_SQL)) {
      expect(sql.trim()).toMatch(/^SELECT/);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i);
    }
  });
});

describe("route", () => {
  function fakePool({ board = ROWS.board, throwOn = null } = {}) {
    const log = [];
    const client = {
      query: vi.fn(async (sql) => {
        log.push(sql.trim().split(/\s+/).slice(0, 2).join(" "));
        if (throwOn && sql.includes(throwOn)) throw new Error("relation does not exist");
        if (sql === BOARD_SQL.board) return { rows: board ? [board] : [] };
        if (sql === BOARD_SQL.groups) return { rows: ROWS.groups };
        if (sql === BOARD_SQL.columns) return { rows: ROWS.columns };
        if (sql === BOARD_SQL.labels) return { rows: ROWS.labels };
        if (sql === BOARD_SQL.items) return { rows: ROWS.items };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    return { pool: { connect: async () => client }, client, log };
  }
  function harness(opts = {}) {
    const routes = new Map();
    const app = { get: (p, h) => routes.set(p, h) };
    registerMirrorBoard({ app, pool: opts.pool ?? null, identify: async () => (opts.anon ? null : { email: "rep@medicallymodern.com" }) });
    return routes;
  }
  async function call(routes, query = {}) {
    let status = 200, body = null;
    const res = { status(c) { status = c; return this; }, json(j) { body = j; return this; } };
    await routes.get("/mirror/board")({ query, headers: {} }, res);
    return { status, body };
  }

  it("401 without a signed-in employee — before touching the database", async () => {
    const f = fakePool();
    const out = await call(harness({ pool: f.pool, anon: true }), { board: "18406352652" });
    expect(out.status).toBe(401);
    expect(f.client.query).not.toHaveBeenCalled();
  });

  it("503 when the gateway has no SUPABASE_DB_URL", async () => {
    const out = await call(harness({ pool: null }), { board: "18406352652" });
    expect(out.status).toBe(503);
  });

  it("400 for a board id that is not digits", async () => {
    const out = await call(harness({ pool: fakePool().pool }), { board: "x; drop" });
    expect(out.status).toBe(400);
  });

  it("404 for a board the mirror doesn't hold", async () => {
    const out = await call(harness({ pool: fakePool({ board: null }).pool }), { board: "12345678" });
    expect(out.status).toBe(404);
  });

  it("200: every read sits inside BEGIN READ ONLY … COMMIT, and the client is released", async () => {
    const f = fakePool();
    const out = await call(harness({ pool: f.pool }), { board: "18406352653" });
    expect(out.status).toBe(200);
    expect(out.body.items).toHaveLength(1);
    expect(f.log[0]).toBe("BEGIN READ");
    expect(f.log.at(-1)).toBe("COMMIT");
    expect(f.log.slice(1, -1).every((s) => s.startsWith("SELECT"))).toBe(true);
    expect(f.client.release).toHaveBeenCalledTimes(1);
  });

  it("a failed read is a 502 with no row data, rolled back and released", async () => {
    const f = fakePool({ throwOn: "monday_mirror.items" });
    const out = await call(harness({ pool: f.pool }), { board: "18406352654" });
    expect(out.status).toBe(502);
    expect(JSON.stringify(out.body)).not.toContain("Test Patient");
    expect(f.log).toContain("ROLLBACK");
    expect(f.client.release).toHaveBeenCalledTimes(1);
  });
});

describe("wiring", () => {
  it("index.mjs registers the route, and the module never writes", () => {
    const index = readFileSync(join(HERE, "index.mjs"), "utf8");
    expect(index).toContain('import { registerMirrorBoard } from "./mirrorBoard.mjs";');
    expect(index).toMatch(/^registerMirrorBoard\(\{ app \}\);$/m);
    const src = readFileSync(join(HERE, "mirrorBoard.mjs"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).toContain('"BEGIN READ ONLY"');
    expect(src).toMatch(/_pool\.on\("error"/); // an idle drop must never crash the prod gateway
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/);
  });
});

const DB = process.env.MIRROR_TEST_DB_URL;
(DB ? describe : describe.skip)("the SQL against the mirror's real schema", () => {
  it("reads a board, hides a column monday dropped long ago, and skips missing items", async () => {
    // Runtime require, never a literal import("pg") — see mirrorBoard.mjs.
    const from = ["services/monday-gateway", "services/supabase-mirror"].find((d) => existsSync(join(process.cwd(), d, "node_modules/pg")));
    const pg = createRequire(join(process.cwd(), from, "package.json"))("pg");
    const pool = new pg.Pool({ connectionString: DB, max: 2, ssl: false });
    try {
      await pool.query("DROP SCHEMA IF EXISTS monday_mirror CASCADE");
      const dir = join(process.cwd(), "services/supabase-mirror/db");
      for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await pool.query(readFileSync(join(dir, f), "utf8"));
      const B = 18406352652;
      await pool.query("INSERT INTO monday_mirror.boards (board_id, name, items_count, last_incremental_sync_at) VALUES ($1,'Profile Send Off Board',2,now())", [B]);
      await pool.query("INSERT INTO monday_mirror.groups (board_id, group_id, title, color, position) VALUES ($1,'g2','Completed','#00c875','131072.0'),($1,'g1','1. Intake','#579bfc','65536.0')", [B]);
      await pool.query("INSERT INTO monday_mirror.columns (board_id, column_id, title, type, position) VALUES ($1,'name','Name','name',0),($1,'color_x','Already In System','status',1)", [B]);
      await pool.query("INSERT INTO monday_mirror.columns (board_id, column_id, title, type, position, seen_at) VALUES ($1,'text_gone','Deleted Column','text',2, now() - interval '3 hours')", [B]);
      await pool.query("INSERT INTO monday_mirror.labels (board_id, column_id, label_id, label, hex) VALUES ($1,'color_x',1,'No','#00c875')", [B]);
      await pool.query(`INSERT INTO monday_mirror.items (item_id, board_id, name, group_id, state, monday_created_at, column_values) VALUES
        (1, $1, 'Patient A', 'g1', 'active', now(), '{"color_x":{"text":"No","value":{"index":1}}}'),
        (2, $1, 'Patient B', 'g2', 'missing', now(), '{}')`, [B]);

      const out = await readBoard(pool, String(B));
      expect(out.groups.map((g) => g.title)).toEqual(["1. Intake", "Completed"]);
      expect(out.columns.map((c) => c.id)).toEqual(["color_x"]);
      expect(out.items.map((i) => i.name)).toEqual(["Patient A"]);
      expect(out.items[0].cells.color_x).toEqual({ t: "No", i: 1 });
      expect(out.labels.color_x[1].hex).toBe("#00c875");
      expect(await readBoard(pool, "99999999")).toBeNull();

      // READ ONLY is enforced by Postgres, not by convention.
      const c = await pool.connect();
      try {
        await c.query("BEGIN READ ONLY");
        await expect(c.query("DELETE FROM monday_mirror.items")).rejects.toThrow(/read-only/);
      } finally {
        await c.query("ROLLBACK").catch(() => {});
        c.release();
      }
    } finally {
      await pool.query("DROP SCHEMA IF EXISTS monday_mirror CASCADE").catch(() => {});
      await pool.end();
    }
  });
});
