/**
 * The whole pass against a REAL Postgres with a FAKE monday — the schema
 * applies, a full read lands every item, an incremental read records the
 * diff, a reconcile marks a vanished item missing, and the typed view reads
 * the labels back. Skipped unless MIRROR_TEST_DB_URL points at a scratch
 * database (it creates and drops the monday_mirror schema there):
 *
 *   MIRROR_TEST_DB_URL=postgres://postgres:pw@127.0.0.1:5433/postgres npx vitest run services/supabase-mirror
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { join } from "node:path";

/**
 * ⚠️ `pg` is loaded with a runtime require, never `import("pg")`. The service's
 * dependencies live in its own node_modules, which CI (a root `npm install`)
 * does not have — and vite resolves every literal import specifier while
 * transforming this file, even inside a skipped suite. A literal `import("pg")`
 * here failed the whole deploy workflow from 2026-09-29 18:42 to ~21:00.
 */
const requirePg = () => createRequire(join(process.cwd(), "services/supabase-mirror/package.json"))("pg");

const URL = process.env.MIRROR_TEST_DB_URL;
const maybe = URL ? describe : describe.skip;

const BOARD = 18406352652;
const SHAPE = {
  boards: [{
    id: String(BOARD), name: "Profile Send Off Board", items_count: 2,
    groups: [{ id: "group_mm1xf2jb", title: "1. Intake", color: "#579bfc", position: "1" }, { id: "group_mm64b83h", title: "Already In System", color: "#df2f4a", position: "2" }],
    columns: [
      { id: "name", title: "Name", type: "name", settings_str: "{}" },
      { id: "color_mm2xe7r8", title: "Already In System", type: "status", settings_str: '{"labels":{"0":"Yes","1":"No"},"labels_colors":{"0":{"color":"#df2f4a"},"1":{"color":"#00c875"}}}' },
      { id: "date_mm1wf43j", title: "Date of Intake", type: "date", settings_str: "{}" },
      { id: "numeric_mm5ze82q", title: "Attempt Counter", type: "numbers", settings_str: "{}" },
      { id: "phone_mm1x44yk", title: "Pt. Phone", type: "phone", settings_str: "{}" },
      { id: "dropdown_mm5ex3d7", title: "SNF/Hospice/Hospital", type: "dropdown", settings_str: '{"labels":[{"id":1,"name":"Hospital/SNF"},{"id":2,"name":"Hospice"}]}' },
    ],
  }],
};
const item = (id, over = {}) => ({
  id: String(id), name: `Patient ${id}`, created_at: "2026-09-28T10:00:00Z", updated_at: "2026-09-28T10:00:00Z", group: { id: "group_mm1xf2jb" },
  column_values: [
    { id: "color_mm2xe7r8", type: "status", text: "No", value: '{"index":1}' },
    { id: "date_mm1wf43j", type: "date", text: "2026-09-28", value: '{"date":"2026-09-28"}' },
    { id: "numeric_mm5ze82q", type: "numbers", text: "2", value: '"2"' },
    { id: "phone_mm1x44yk", type: "phone", text: "15555550100", value: '{"phone":"15555550100","countryShortName":"US"}' },
    { id: "dropdown_mm5ex3d7", type: "dropdown", text: "Hospice", value: '{"ids":[2]}' },
  ],
  ...over,
});

/** A monday that answers from `state`, counting what it was asked. */
function fakeMonday(state) {
  const calls = [];
  return {
    calls,
    fetch: async (_url, init) => {
      const doc = JSON.parse(init.body);
      calls.push(doc);
      const q = doc.query;
      let data;
      if (q.includes("groups { id title")) data = SHAPE;
      else if (q.includes("items(ids: $ids)")) data = { items: state.items.filter((i) => doc.variables.ids.includes(i.id)) };
      else if (q.includes("order_by")) data = { boards: [{ items_page: { cursor: null, items: [...state.items].sort((a, b) => b.updated_at.localeCompare(a.updated_at)) } }] };
      else if (q.includes("column_values")) data = { boards: [{ items_page: { cursor: null, items: state.items } }] };
      else data = { boards: [{ items_page: { cursor: null, items: state.items.map((i) => ({ id: i.id, created_at: i.created_at, updated_at: i.updated_at, group: i.group })) } }] };
      data.complexity = { query: 10, after: 19_000_000 };
      return { ok: true, status: 200, json: async () => ({ data }) };
    },
  };
}

maybe("syncBoard against Postgres", () => {
  let pg, pool, mod, state, monday;
  beforeAll(async () => {
    process.env.MIRROR_ENABLED = "1";
    process.env.MONDAY_API_TOKEN = "test";
    process.env.SUPABASE_DB_URL = URL;
    process.env.MIRROR_PAGE_DELAY_MS = "0";
    pg = requirePg();
    pool = new pg.Pool({ connectionString: URL, max: 2, ssl: /sslmode=disable|127\.0\.0\.1|localhost/.test(URL) ? false : { rejectUnauthorized: false } });
    await pool.query("DROP SCHEMA IF EXISTS monday_mirror CASCADE");
    mod = await import("./index.mjs");
    state = { items: [item(101), item(102)] };
    monday = fakeMonday(state);
    globalThis.fetch = monday.fetch;
  });
  afterAll(async () => {
    await pool?.query("DROP SCHEMA IF EXISTS monday_mirror CASCADE");
    await pool?.end();
  });

  it("applies the schema, then a first pass is a FULL read that lands every item and label", async () => {
    const files = await mod.applySchema(pool);
    expect(files).toEqual(["0001_monday_mirror.sql", "0002_profile_send_off_view.sql", "0003_profile_send_off_automations.sql"]);
    await mod.syncBoard(pool, BOARD);
    const { rows } = await pool.query("SELECT item_id, name, group_id, state FROM monday_mirror.items ORDER BY item_id");
    expect(rows.map((r) => [Number(r.item_id), r.name, r.group_id, r.state])).toEqual([[101, "Patient 101", "group_mm1xf2jb", "active"], [102, "Patient 102", "group_mm1xf2jb", "active"]]);
    const labels = await pool.query("SELECT column_id, label_id, label FROM monday_mirror.labels ORDER BY column_id, label_id");
    expect(labels.rows.map((r) => `${r.column_id}:${r.label_id}=${r.label}`)).toEqual(["color_mm2xe7r8:0=Yes", "color_mm2xe7r8:1=No", "dropdown_mm5ex3d7:1=Hospital/SNF", "dropdown_mm5ex3d7:2=Hospice"]);
    const runs = await pool.query("SELECT kind, ok, items_upserted FROM monday_mirror.sync_runs ORDER BY id");
    expect(runs.rows.map((r) => [r.kind, r.ok])).toEqual([["shape", true], ["full", true]]);
    expect(runs.rows[1].items_upserted).toBe(2);
    const seeded = await pool.query("SELECT count(*)::int AS n FROM monday_mirror.automations WHERE board_id = $1", [BOARD]);
    expect(seeded.rows[0].n).toBe(35);
  });

  it("the typed view reads a status label, a date, a number, a phone and a dropdown", async () => {
    const { rows } = await pool.query("SELECT already_in_system, already_in_system_id, date_of_intake::text AS date_of_intake, attempt_counter, pt_phone, stedi_facility_flags, stedi_facility_flags_ids FROM monday_mirror.profile_send_off WHERE item_id = 101");
    expect(rows[0].already_in_system).toBe("No");
    expect(rows[0].already_in_system_id).toBe(1);
    expect(rows[0].date_of_intake).toBe("2026-09-28");
    expect(Number(rows[0].attempt_counter)).toBe(2);
    expect(rows[0].pt_phone).toBe("15555550100");
    expect(rows[0].stedi_facility_flags).toBe("Hospice");
    expect(rows[0].stedi_facility_flags_ids).toEqual([2]);
  });

  it("a second pass is INCREMENTAL: only the changed item is written, with its diff", async () => {
    await pool.query("UPDATE monday_mirror.boards SET last_incremental_sync_at = now() - interval '10 minutes', last_reconcile_at = now()");
    state.items[0] = item(101, { updated_at: new Date().toISOString(), group: { id: "group_mm64b83h" }, column_values: item(101).column_values.map((c) => (c.id === "color_mm2xe7r8" ? { ...c, text: "Yes", value: '{"index":0,"changed_at":"2026-09-29T12:00:00Z"}' } : c)) });
    await mod.syncBoard(pool, BOARD);
    const run = await pool.query("SELECT kind, items_upserted, items_unchanged, changes FROM monday_mirror.sync_runs WHERE kind = 'incremental' ORDER BY id DESC LIMIT 1");
    expect(run.rows[0].items_upserted).toBe(1);
    expect(run.rows[0].changes).toBe(2);
    const ch = await pool.query("SELECT column_id, old_text, new_text FROM monday_mirror.item_changes WHERE item_id = 101 ORDER BY id");
    expect(ch.rows.map((r) => [r.column_id, r.old_text, r.new_text])).toEqual([["__group__", "group_mm1xf2jb", "group_mm64b83h"], ["color_mm2xe7r8", "No", "Yes"]]);
    const v = await pool.query("SELECT group_title, already_in_system FROM monday_mirror.profile_send_off WHERE item_id = 101");
    expect(v.rows[0]).toEqual({ group_title: "Already In System", already_in_system: "Yes" });
  });

  it("a RECONCILE marks an item monday stopped listing as missing, and re-reads a silent group move", async () => {
    await pool.query("UPDATE monday_mirror.boards SET last_incremental_sync_at = now(), last_reconcile_at = now() - interval '2 days'");
    state.items = [item(102, { group: { id: "group_mm64b83h" } })]; // 101 gone; 102 moved without an updated_at change
    await mod.syncBoard(pool, BOARD);
    const { rows } = await pool.query("SELECT item_id, state, group_id, missing_since IS NOT NULL AS flagged FROM monday_mirror.items ORDER BY item_id");
    expect(rows.map((r) => [Number(r.item_id), r.state, r.group_id, r.flagged])).toEqual([[101, "missing", "group_mm64b83h", true], [102, "active", "group_mm64b83h", false]]);
    const st = await pool.query("SELECT new_text FROM monday_mirror.item_changes WHERE item_id = 101 AND column_id = '__state__'");
    expect(st.rows.map((r) => r.new_text)).toEqual(["missing"]);
  });

  it("MIRROR_CREATED_SINCE: the mirror starts empty and takes only items created on/after it", async () => {
    const BOARD2 = 18406352653;
    mod.CONFIG.createdSince = "2026-10-01T00:00:00Z";
    state.items = [item(102), item(201, { created_at: "2026-10-02T09:00:00Z", updated_at: "2026-10-02T09:00:00Z" })];
    await mod.syncBoard(pool, BOARD2);
    const { rows } = await pool.query("SELECT item_id FROM monday_mirror.items WHERE board_id = $1 ORDER BY item_id", [BOARD2]);
    expect(rows.map((r) => Number(r.item_id))).toEqual([201]); // 102 (created 09-28) never entered
    const run = await pool.query("SELECT since IS NOT NULL AS scoped, items_upserted FROM monday_mirror.sync_runs WHERE board_id = $1 AND kind = 'full'", [BOARD2]);
    expect(run.rows[0].scoped).toBe(true);
    expect(run.rows[0].items_upserted).toBe(1);
    // A reconcile neither pulls the out-of-scope item in nor calls the in-scope one missing.
    await pool.query("UPDATE monday_mirror.boards SET last_incremental_sync_at = now(), last_reconcile_at = now() - interval '2 days' WHERE board_id = $1", [BOARD2]);
    await mod.syncBoard(pool, BOARD2);
    const after = await pool.query("SELECT item_id, state FROM monday_mirror.items WHERE board_id = $1 ORDER BY item_id", [BOARD2]);
    expect(after.rows.map((r) => [Number(r.item_id), r.state])).toEqual([[201, "active"]]);
    mod.CONFIG.createdSince = null;
  });

  it("never sent monday anything but queries", () => {
    expect(monday.calls.length).toBeGreaterThan(5);
    for (const c of monday.calls) expect(c.query.trim()).toMatch(/^query/);
  });
});
