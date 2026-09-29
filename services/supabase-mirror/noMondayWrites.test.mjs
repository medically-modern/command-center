/**
 * The mirror is READ-ONLY on monday. Every GraphQL document it builds is a
 * query; nothing in the service may contain a mutation, and nothing may write
 * a cell, move an item, or create one — a source scan, because the failure it
 * guards against is somebody "just adding" a write-back one day and turning
 * the sandbox into a second writer on a live board (CLAUDE.md §5.2, §9).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "services/supabase-mirror");
const sources = readdirSync(DIR).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"));

describe("supabase-mirror never writes to monday", () => {
  it("has source files to scan", () => {
    expect(sources).toContain("index.mjs");
    expect(sources).toContain("mirrorRules.mjs");
  });
  for (const f of sources) {
    it(`${f}: no mutation, no column write, no item create or move`, () => {
      const src = readFileSync(join(DIR, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(src).not.toMatch(/\bmutation\b/);
      expect(src).not.toMatch(/change_(multiple_)?column_values?|create_item|move_item_to_group|delete_item|archive_item|change_simple_column_value/);
    });
  }
  it("is off unless MIRROR_ENABLED=1, and has a dry run", () => {
    const src = readFileSync(join(DIR, "index.mjs"), "utf8");
    expect(src).toContain('env("MIRROR_ENABLED", "") === "1"');
    expect(src).toContain('env("DRY_RUN", "") === "1"');
  });
});
