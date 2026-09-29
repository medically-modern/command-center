/**
 * One schema, two homes: the service applies `services/supabase-mirror/db/*.sql`
 * on boot (its Docker build copies only its own directory), and
 * `supabase/migrations/` carries the same files for `supabase db push`. They
 * must be byte-identical, and the generated files must match what the
 * generators produce from the committed snapshots — a stale view is a column
 * the board has that the mirror silently does not.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SERVICE_DB = join(ROOT, "services/supabase-mirror/db");
const MIGRATIONS = join(ROOT, "supabase/migrations");

describe("schema agreement", () => {
  const files = readdirSync(SERVICE_DB).filter((f) => f.endsWith(".sql")).sort();

  it("the service ships the three files, numbered so they apply in order", () => {
    expect(files).toEqual(["0001_monday_mirror.sql", "0002_profile_send_off_view.sql", "0003_profile_send_off_automations.sql"]);
  });

  for (const f of files) {
    it(`supabase/migrations/${f} is byte-identical to the service's copy`, () => {
      expect(readFileSync(join(MIGRATIONS, f), "utf8")).toBe(readFileSync(join(SERVICE_DB, f), "utf8"));
    });
  }

  it("the typed view is what gen-view.mjs produces from the committed snapshot", () => {
    const out = execFileSync("node", [
      "scripts/supabase-mirror/gen-view.mjs",
      "supabase/snapshots/profile_send_off_board.json",
      "src/lib/profile/mondayApi.ts",
      "monday_mirror.profile_send_off",
    ], { cwd: ROOT, encoding: "utf8" });
    expect(readFileSync(join(SERVICE_DB, "0002_profile_send_off_view.sql"), "utf8")).toBe(out);
  });

  it("the automations seed is what gen-seed.mjs produces from the committed snapshot", () => {
    const out = execFileSync("node", ["scripts/supabase-mirror/gen-seed.mjs", "supabase/snapshots/profile_send_off_automations.json"], { cwd: ROOT, encoding: "utf8" });
    expect(readFileSync(join(SERVICE_DB, "0003_profile_send_off_automations.sql"), "utf8")).toBe(out);
  });

  it("the board snapshot carries every column the app maps (COL in lib/profile/mondayApi.ts)", () => {
    const board = JSON.parse(readFileSync(join(ROOT, "supabase/snapshots/profile_send_off_board.json"), "utf8"));
    const ids = new Set(board.columns.map((c) => c.id));
    const ts = readFileSync(join(ROOT, "src/lib/profile/mondayApi.ts"), "utf8");
    const block = ts.match(/export const COL = \{([\s\S]*?)\n\} as const;/)[1];
    const mapped = [...block.matchAll(/^\s*[A-Za-z0-9_]+:\s*"([^"]+)"/gm)].map((m) => m[1]);
    expect(mapped.length).toBeGreaterThan(100);
    expect(mapped.filter((id) => !ids.has(id))).toEqual([]);
  });

  it("RLS is on for every mirror table and no policy grants the API roles anything", () => {
    const sql = readFileSync(join(SERVICE_DB, "0001_monday_mirror.sql"), "utf8");
    const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS monday_mirror\.(\w+)/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThanOrEqual(8);
    for (const t of tables) expect(sql).toMatch(new RegExp(`ALTER TABLE monday_mirror\\.${t}\\s+ENABLE ROW LEVEL SECURITY;`));
    expect(sql).not.toMatch(/CREATE POLICY/);
  });
});
