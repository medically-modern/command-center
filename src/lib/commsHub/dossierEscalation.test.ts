/**
 * ⚠️ The dossier's escalation read (§5.43) — a SOURCE SCAN, because every part
 * of it fails silently.
 *
 * `dossierCols` is a hand-maintained read set: a column missing from it comes
 * back as `""` on every record with no error at all (§5.11's trap). And the
 * label INDEX only exists in a status column's `value`, which the query has to
 * ask for by name — drop it and `escalationLevelFrom` falls back to text alone,
 * which is right for every label on the boards TODAY and silently wrong the day
 * one is renamed. Neither of those shows on screen; a test is the only catch.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { escalationLevelFrom } from "@/lib/systemMgmt/escalationDetail";
import { BOARDS } from "@/lib/systemMgmt/mondayApi";

const src = readFileSync(join(__dirname, "dossierApi.ts"), "utf8");

describe("⚠️ the dossier reads the escalation column", () => {
  it("dossierCols asks for board.escalationColId", () => {
    const fn = src.slice(src.indexOf("function dossierCols"), src.indexOf("async function boardSearch"));
    expect(fn, "the escalation column is not in the read set").toContain("board.escalationColId");
  });

  it("⚠️ every query that BUILDS A RECORD asks for `value`, not just `text`", () => {
    // Two queries feed `toDossierItem`: the board search (DOSSIER_QUERY) and
    // the by-id read. Both must carry `value` or the index is never available.
    const building = src.slice(0, src.indexOf("async function readNotesNow"));
    const withValue = building.match(/column_values \(ids: \$cols\) \{ id text value \}/g) ?? [];
    expect(withValue.length, "a record-building query dropped `value`").toBeGreaterThanOrEqual(2);
    expect(
      building.match(/column_values \(ids: \$cols\) \{ id text \}/g),
      "a record-building query still reads text only",
    ).toBeNull();
  });

  it("…and `readNotesNow` is deliberately NOT one of them", () => {
    // It reads a single notes column to re-base an append (§5.28) and builds no
    // record, so asking for `value` there would spend bytes on nothing. Scoped
    // by name rather than by counting, so adding a query cannot quietly pass.
    const notes = src.slice(src.indexOf("async function readNotesNow"));
    expect(notes).toContain("column_values (ids: $cols) { id text }");
  });

  it("the level is derived by the SHARED rule, never re-implemented here", () => {
    expect(src).toContain("escalationLevelFrom(");
    expect(src, "a second copy of the rung rule").not.toContain('=== "Final Escalation Required"');
  });

  it("⚠️ an unreadable index is null, never 0 — 0 is a real rung", () => {
    const fn = src.slice(src.indexOf("const indexOf ="), src.indexOf("/**", src.indexOf("const indexOf =")));
    expect(fn).toContain("return null");
    expect(fn, "an unparseable value must not become index 0").not.toMatch(/\?\?\s*0|\|\|\s*0/);
  });
});

/**
 * ⚠️ The four boards with no escalation column must read as "not escalated",
 * not throw and not guess — `escalationColId` is null on them by design.
 */
describe("⚠️ boards with no escalation column", () => {
  it("are a real part of the registry, so the null path is exercised", () => {
    const without = BOARDS.filter((b) => !b.escalationColId);
    expect(without.length).toBeGreaterThan(0);
    for (const b of without) {
      expect(escalationLevelFrom(b.boardId, "", null)).toBeNull();
    }
  });

  it("a split board still resolves both rungs by text alone", () => {
    // Text first is what makes the read correct even where `value` is missing —
    // the index is the rename guard, not the primary signal.
    expect(escalationLevelFrom(18406060017, "Final Escalation Required", null)).toBe("final");
    expect(escalationLevelFrom(18406060017, "Manager Escalation Required", null)).toBe("manager");
    // …and the index is what survives a rename.
    expect(escalationLevelFrom(18406060017, "Renamed Later", 2)).toBe("final");
    expect(escalationLevelFrom(18406060017, "Renamed Later", 0)).toBe("manager");
  });
});
