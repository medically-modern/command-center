import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const gatewaySrc = (f) => readFileSync(resolve(process.cwd(), "services/monday-gateway", f), "utf8");
import {
  buildAppActorsSql, parseAppActorsQuery, shapeAppActorRows, OVERSIGHT_BOARDS, MAX_DAYS, MAX_ROWS,
} from "./appActorsRules.mjs";

const NOW = Date.parse("2026-10-02T18:00:00Z");

describe("parseAppActorsQuery", () => {
  it("defaults to the last 28 days on the four onboarding boards", () => {
    const q = parseAppActorsQuery({}, NOW);
    expect(q.sinceMs).toBe(NOW - 28 * 864e5);
    expect(q.boards).toEqual(OVERSIGHT_BOARDS);
    expect(q.clamped).toBe(false);
  });

  it("never reaches back more than 60 days, and says so", () => {
    const q = parseAppActorsQuery({ since: "2026-01-01T00:00:00Z" }, NOW);
    expect(q.sinceMs).toBe(NOW - MAX_DAYS * 864e5);
    expect(q.clamped).toBe(true);
  });

  it("refuses a bad date and boards outside onboarding", () => {
    expect(parseAppActorsQuery({ since: "yesterday-ish" }, NOW).error).toMatch(/ISO/);
    expect(parseAppActorsQuery({ boards: "18407459988" }, NOW).error).toMatch(/boards/);
    expect(parseAppActorsQuery({ boards: "18406060017,18407459988" }, NOW).boards).toEqual(["18406060017"]);
  });
});

describe("buildAppActorsSql", () => {
  it("⚠️ selects column KEYS only — a written value never leaves Postgres", () => {
    const { sql, args } = buildAppActorsSql({ sinceMs: 1, boards: ["x"] });
    expect(sql).toContain("jsonb_object_keys(g.columns)");
    // The value-bearing column is never selected as such.
    expect(sql).not.toMatch(/SELECT[^]*\bcolumns\s*(,|AS|FROM)/i);
    expect(sql).not.toMatch(/variables|query_text/);
    expect(args).toEqual([["x"], 1, MAX_ROWS + 1]);
  });

  it("only successful writes on an item by a named actor", () => {
    const { sql } = buildAppActorsSql({ sinceMs: 1, boards: ["x"] });
    expect(sql).toContain("operation = 'mutation'");
    expect(sql).toContain("ok = true");
    expect(sql).toContain("item_id IS NOT NULL");
    expect(sql).toContain("actor IS NOT NULL");
    // send rows look up their job's queue time
    expect(sql).toContain("FROM send_jobs j");
  });
});

describe("shapeAppActorRows", () => {
  it("compacts rows, lower-cases the actor, drops writes with no columns", () => {
    const { rows, truncated } = shapeAppActorRows([
      { item_id: 1, board_id: 2, actor: "Katie@MedicallyModern.com", ms: "1700000000000", cols: ["color_a", "text_b"] },
      { item_id: 3, board_id: 2, actor: "x@y", ms: 5, cols: [] },
    ]);
    expect(rows).toEqual([["1", "2", "katie@medicallymodern.com", 1700000000000, ["color_a", "text_b"]]]);
    expect(truncated).toBe(false);
  });

  it("a send row carries when its job was queued (it logs when it finishes)", () => {
    const { rows } = shapeAppActorRows([
      { item_id: 1, board_id: 2, actor: "k", ms: 2000, cols: ["c"], start_ms: 500 },
      { item_id: 1, board_id: 2, actor: "k", ms: 2000, cols: ["c"], start_ms: null },
    ]);
    expect(rows[0][5]).toBe(500);
    expect(rows[1]).toHaveLength(5);
  });

  it("reports truncation instead of silently cutting history short", () => {
    const many = Array.from({ length: MAX_ROWS + 1 }, (_, i) => ({ item_id: i, board_id: 1, actor: "a", ms: i, cols: ["c"] }));
    const { rows, truncated } = shapeAppActorRows(many);
    expect(truncated).toBe(true);
    expect(rows).toHaveLength(MAX_ROWS);
  });
});

describe("the route", () => {
  const src = gatewaySrc("appActors.mjs");
  it("blocks on a verified sign-in before touching the database", () => {
    expect(src.indexOf("verifyGoogleIdentity(")).toBeLessThan(src.indexOf("pool.query("));
    expect(src).toContain('status(401)');
  });
  it("is registered in index.mjs", () => {
    const index = gatewaySrc("index.mjs");
    expect(index).toContain("registerAppActors({ app, pool })");
  });
});
