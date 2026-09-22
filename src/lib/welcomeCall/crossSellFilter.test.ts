// The cross-sell split of the Welcome Call queue (Katie + Brandon, 2026-09-21:
// Corey takes the cross-sell calls, somebody else takes the rest).
//
// What these pin, in order of what would hurt most if it broke:
//  1. The two scopes PARTITION the queue — nobody worked twice, nobody orphaned.
//  2. `viewFilterFromParams` still ignores the cross-sell values, which is the
//     one property keeping every OTHER slice untouched by this feature.
//  3. The rule is imported, never re-implemented, so the bar, the sidebar and
//     the chip on the patient's header cannot disagree.
// Run: npx vitest run src/lib/welcomeCall/crossSellFilter.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { applyCrossSellScope } from "./sidebarList";
import type { Patient } from "./workflow";
import {
  CROSS_SELL_FILTER_ROLES,
  crossSellScopeFromParams,
  filterQuery,
  isCrossSellFilter,
  viewFilterFromParams,
} from "@/lib/roleView";

const p = (over: Partial<Patient>): Patient =>
  ({ id: "x", name: "n", serving: "", requestType: "", ...over } as Patient);

const ids = (list: Patient[]) => list.map((x) => x.id);

// Real board vocabulary: Serving / Request Type labels as they appear live.
const crossA = p({ id: "c1", serving: "Insulin Pump + CGM", requestType: "Insulin Pump" });
const plainA = p({ id: "n1", serving: "Insulin Pump", requestType: "Insulin Pump" });
const crossB = p({ id: "c2", serving: "Supplies + CGM", requestType: "Supplies" });
// Asked for CGM themselves — serving matches the ask, so not a cross-sell.
const askedCgm = p({ id: "n2", serving: "CGM", requestType: "CGM" });
// ⚠️ Blank Request Type. §5.31f: a blank is the ABSENCE of a record of what the
// patient originally wanted, never evidence they did not ask for CGM.
const blankReq = p({ id: "n3", serving: "CGM", requestType: "" });
const queue = [crossA, plainA, crossB, askedCgm, blankReq];

describe("applyCrossSellScope", () => {
  it("splits the queue into cross-sells and the rest", () => {
    expect(ids(applyCrossSellScope(queue, "crossSell"))).toEqual(["c1", "c2"]);
    expect(ids(applyCrossSellScope(queue, "nonCrossSell"))).toEqual(["n1", "n2", "n3"]);
  });

  it("PARTITIONS the queue — every patient in exactly one bucket, nobody lost", () => {
    const a = applyCrossSellScope(queue, "crossSell");
    const b = applyCrossSellScope(queue, "nonCrossSell");
    expect(a.length + b.length).toBe(queue.length);
    expect(new Set([...ids(a), ...ids(b)])).toEqual(new Set(ids(queue)));
    expect(ids(a).filter((i) => ids(b).includes(i))).toEqual([]);
  });

  it("a blank Request Type is NOT a cross-sell (§5.31f)", () => {
    expect(ids(applyCrossSellScope([blankReq], "crossSell"))).toEqual([]);
    expect(ids(applyCrossSellScope([blankReq], "nonCrossSell"))).toEqual(["n3"]);
  });

  it("no scope hands back the SAME array — every other role is untouched", () => {
    // Identity, not just equality: this runs inside a useMemo feeding the
    // sidebar, and a fresh array each poll would re-render it for nothing.
    expect(applyCrossSellScope(queue, null)).toBe(queue);
  });

  it("reads the BOARD serving, never the rep's unsaved edit", () => {
    // The header chip correctly reads `servingEdited` — it describes the
    // patient on screen. A QUEUE that did would yank a patient out of the
    // sidebar mid-call the moment the rep touched Serving, and would disagree
    // with the burndown count, which reads the board.
    const editing = p({ id: "e1", serving: "Insulin Pump", requestType: "Insulin Pump",
      servingEdited: "Insulin Pump + CGM" } as Partial<Patient>);
    expect(ids(applyCrossSellScope([editing], "crossSell"))).toEqual([]);
    expect(ids(applyCrossSellScope([editing], "nonCrossSell"))).toEqual(["e1"]);
  });
});

describe("the params contract", () => {
  const sp = (q: string) => new URLSearchParams(q);

  it("viewFilterFromParams IGNORES the cross-sell values", () => {
    // ⚠️ The load-bearing one. masheke / samantha / finalConfirm / profile /
    // subscription all read this and know nothing about cross-sell; because it
    // falls through to the default, they need no change and cannot be handed a
    // value they would mishandle. An escalated cross-sell patient therefore
    // stays the manager's, exactly like any other escalated patient (§5.34).
    expect(viewFilterFromParams(sp("filter=crossSell"))).toBe("nonEscalated");
    expect(viewFilterFromParams(sp("filter=nonCrossSell"))).toBe("nonEscalated");
    // …and the three it does recognise still work.
    expect(viewFilterFromParams(sp("filter=all"))).toBe("all");
    expect(viewFilterFromParams(sp("manager=1"))).toBe("escalated");
  });

  it("crossSellScopeFromParams reads only the two, null for everything else", () => {
    expect(crossSellScopeFromParams(sp("filter=crossSell"))).toBe("crossSell");
    expect(crossSellScopeFromParams(sp("filter=nonCrossSell"))).toBe("nonCrossSell");
    expect(crossSellScopeFromParams(sp("filter=all"))).toBeNull();
    expect(crossSellScopeFromParams(sp("manager=1"))).toBeNull();
    expect(crossSellScopeFromParams(sp(""))).toBeNull();
  });

  it("the burndown bar link round-trips back to the same scope", () => {
    for (const f of ["crossSell", "nonCrossSell"] as const) {
      expect(crossSellScopeFromParams(sp(filterQuery(f).replace(/^\?/, "")))).toBe(f);
    }
    // The three escalation filters keep their existing links untouched.
    expect(filterQuery("escalated")).toBe("?manager=1");
    expect(filterQuery("all")).toBe("?filter=all");
    expect(filterQuery("nonEscalated")).toBe("");
  });

  it("isCrossSellFilter names exactly the two", () => {
    expect(isCrossSellFilter("crossSell")).toBe(true);
    expect(isCrossSellFilter("nonCrossSell")).toBe(true);
    expect(isCrossSellFilter("all")).toBe(false);
    expect(isCrossSellFilter("escalated")).toBe(false);
    expect(isCrossSellFilter("nonEscalated")).toBe(false);
  });

  it("only Welcome Call may be given a cross-sell filter", () => {
    // `isCrossSell` is a Welcome Call rule and only that page applies the
    // scope. Offering it elsewhere would store a setting nothing reads.
    expect([...CROSS_SELL_FILTER_ROLES]).toEqual(["welcomeCall"]);
  });
});

describe("one rule, not a copy", () => {
  it("the bar count imports isCrossSell rather than re-deriving it", () => {
    // A second copy of "serving has CGM and request type doesn't" is how the
    // bar and the sidebar start disagreeing about who Corey is meant to call —
    // §5.32g's argument for one shared module, one queue over.
    const src = readFileSync("src/hooks/useRoleCounts.ts", "utf8");
    expect(src).toContain('import { isCrossSell } from "@/lib/welcomeCall/workflow"');
    expect(src).toMatch(/isCrossSell\(\{/);
    expect(src).not.toMatch(/servingIncludesCgm/);
  });

  it("the sidebar filter does too", () => {
    const src = readFileSync("src/lib/welcomeCall/sidebarList.ts", "utf8");
    expect(src).toMatch(/import \{ isCrossSell, type Patient \}/);
    expect(src).not.toMatch(/servingIncludesCgm/);
  });
});
