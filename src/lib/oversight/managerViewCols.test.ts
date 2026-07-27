/**
 * Manager-view drill-down columns (2026-07).
 *
 * A manager reading a Final Decisions / Manager Intervention row must see the
 * SAME fields as the Processor Overview row it sits beside — the drill-down
 * doubles as the reference for what a stage tracks. That mirroring is derived
 * from `rowOf` at CHART_DEFS build time (withMirroredRowCols), so these tests
 * guard the derivation rather than a hand-maintained column list.
 */
import { describe, it, expect } from "vitest";
import { CHART_DEFS, OVERSIGHT_SECTIONS } from "./oversightApi";

const byId = new Map(CHART_DEFS.map((c) => [c.id, c]));
const colIds = (id: string) => (byId.get(id)?.drilldownCols ?? []).map((c) => c.colId);

/** Every manager-column chart across both 3-column manager views. */
const MANAGER_CHART_IDS = OVERSIGHT_SECTIONS.flatMap((s) => [
  ...(s.secondaryChartIds ?? []),
  ...(s.tertiaryChartIds ?? []),
]);

describe("manager-view column mirroring", () => {
  it("covers both manager views", () => {
    const withRows = MANAGER_CHART_IDS.filter((id) => byId.get(id)?.rowOf);
    expect(withRows.length).toBeGreaterThan(0);
    // Medical Evaluation (10 manager charts) + Insurance (6) all declare a row.
    expect(withRows).toEqual(MANAGER_CHART_IDS);
  });

  it("gives every manager chart a superset of its row's stage columns", () => {
    for (const id of MANAGER_CHART_IDS) {
      const chart = byId.get(id)!;
      const base = colIds(chart.rowOf!);
      expect(base.length).toBeGreaterThan(0);
      expect(colIds(id)).toEqual(expect.arrayContaining(base));
    }
  });

  it("mirrors the Insurance Final Decisions charts off their own stage", () => {
    // The three far-right cards must match Benefits / Submit Auth / Auth
    // Outstanding respectively — not each other.
    const pairs: [string, string][] = [
      ["benefits-final-escalation", "benefits"],
      ["submit-auth-final-escalation", "submit-auth"],
      ["auth-outstanding-final-escalation", "auth-outstanding"],
    ];
    for (const [managerId, stageId] of pairs) {
      expect(byId.get(managerId)?.rowOf).toBe(stageId);
      expect(colIds(managerId)).toEqual(expect.arrayContaining(colIds(stageId)));
    }
  });

  it("keeps the decision columns first, ahead of the mirrored stage columns", () => {
    // Proposed Reason is why the manager is looking — it must not get pushed
    // to the far right behind a dozen inherited stage columns.
    for (const id of MANAGER_CHART_IDS) {
      const chart = byId.get(id)!;
      if (!chart.decision) continue;
      const cols = colIds(id);
      const reasonIdx = cols.indexOf("__proposedReason__");
      expect(reasonIdx).toBeGreaterThanOrEqual(0);
      const ownCount = MANAGER_OWN_COL_COUNT;
      expect(reasonIdx).toBeLessThan(ownCount);
    }
  });

  it("never duplicates a column id", () => {
    for (const id of MANAGER_CHART_IDS) {
      const cols = colIds(id);
      expect(cols).toHaveLength(new Set(cols).size);
    }
  });
});

/** The authored (pre-mirror) column blocks are short — Proposed Reason sits
 *  within the first few columns of every decision chart. */
const MANAGER_OWN_COL_COUNT = 8;
