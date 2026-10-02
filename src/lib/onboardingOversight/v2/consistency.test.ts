/**
 * V2-K (Brandon): ONE definition of Past Due and Untouched across the whole dashboard. The same owner/step (or
 * owner/escalation kind) shows identical numbers on every screen: tiles, By Employee, the tile breakdowns, By Stage,
 * and "Where it's breaking". Buckets are mutually exclusive and never combine owners.
 */
import { describe, it, expect } from "vitest";
import { demoSnapshot } from "../__fixtures__/demoSnapshot";
import { buildV2, NO_OWNER } from "./model";
import { listFor } from "./lists";
import { DEFAULT_STEPS } from "./steps";

const m = buildV2(demoSnapshot(), DEFAULT_STEPS);
describe("dashboard consistency (V2-K)", () => {
  it("V2-K1 every open patient is in exactly one bucket; owners are single names", () => {
    const all = m.buckets.flatMap((b) => b.keys); expect(new Set(all).size).toBe(all.length); expect(all.length).toBe(m.rows.length);
    for (const b of m.buckets) expect(b.owner).not.toMatch(/,/);
  });
  it("V2-K2 tiles = sum of buckets (processor and escalation past due)", () => {
    expect(m.buckets.filter((b) => b.kind === "step").reduce((n, b) => n + b.pastDue, 0)).toBe(m.tiles.processorPastDue);
    expect(m.buckets.filter((b) => b.kind === "esc").reduce((n, b) => n + b.pastDue, 0)).toBe(m.tiles.escalationsPastDue);
  });
  it("V2-K3 a processor's step shows the same Past Due in By Employee (by step), the breakdown, By Stage and the bucket list", () => {
    for (const b of m.buckets.filter((x) => x.kind === "step" && x.owner !== NO_OWNER)) {
      const p = m.people.find((x) => x.name === b.owner)?.bySteps.find((x) => x.stepId === b.where);
      if (p) expect(p.pastDue).toBe(b.pastDue);
      const sub = m.stages.flatMap((s) => s.subs ?? []).find((s) => s.subStepId === b.where);
      if (sub) expect(sub.late - sub.lateEsc).toBe(b.pastDue);
      expect(listFor(m, `brk:proc:${b.where}:late`)!.rows.length).toBe(b.pastDue);
    }
  });
  it("V2-K4 an escalation owner's kind shows the same Past Due and Untouched in By Employee, the overview list and the bucket list", () => {
    for (const b of m.buckets.filter((x) => x.kind === "esc")) {
      const e = m.escOwners.find((x) => x.name === b.owner)!; const t = e.byType[b.where as "proposedStuck" | "edgeCase" | "unclassified"];
      expect(t.past).toBe(b.pastDue); expect(t.untouched).toBe(b.untouched); expect(t.n).toBe(b.inBucket);
    }
    for (const e of m.escOwners) expect(Object.values(e.byType).reduce((n, t) => n + t.past, 0)).toBe(e.past2);
  });
  it("V2-K5 Untouched is a subset of Past Due everywhere it is shown", () => { for (const b of m.buckets) expect(b.untouched).toBeLessThanOrEqual(b.pastDue); });
  it("V2-K6 one rounding rule: on every row the days shown and the past-due status agree (late <=> days > normal)", () => {
    for (const r of m.rows) {
      if (r.with !== "Processor") expect(r.late).toBe((r.escDays ?? 0) > (r.normal ?? 2));
      else if (r.actionableDays != null && r.normal != null) expect(r.late).toBe(r.actionableDays > r.normal);
    }
  });
});
