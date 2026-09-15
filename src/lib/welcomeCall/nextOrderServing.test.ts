import { describe, it, expect } from "vitest";
import { computeNextOrder, resolveNextOrderWrite } from "./workflow";

/** Local-calendar YYYY-MM-DD — mirrors nextOrderDate.test.ts. */
function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * MM-1042: sensor next order date was being populated (with "today", so it
 * matched supplies/pump) for patients not being served sensors. The fix gates
 * each next-order write on whether that product is served.
 */
describe("resolveNextOrderWrite — not-served products must stay empty", () => {
  it("does NOT default a not-served line to today (the MM-1042 bug)", () => {
    const today = ymdLocal(new Date());
    const value = resolveNextOrderWrite({
      served: false,
      edited: null,
      mondayDate: "", // nothing on the board
      lastBillDates: [], // no billing history → served path would give "today"
    });
    // Served path would have produced today; the not-served path must not.
    expect(computeNextOrder([])).toBe(today); // sanity: the trap exists
    expect(value).toBeNull(); // board already empty → skip, never write today
  });

  it("clears a stale date on a not-served line", () => {
    const value = resolveNextOrderWrite({
      served: false,
      edited: null,
      mondayDate: "2026-07-15",
      lastBillDates: [],
    });
    expect(value).toBe(""); // clear the stale value
  });

  it("honors an explicit rep edit even on a not-served line", () => {
    const value = resolveNextOrderWrite({
      served: false,
      edited: "2026-09-01",
      mondayDate: "",
      lastBillDates: [],
    });
    expect(value).toBe("2026-09-01");
  });
});

describe("resolveNextOrderWrite — served products keep existing behavior", () => {
  it("still applies the computed today default for a served line with no history", () => {
    const today = ymdLocal(new Date());
    const value = resolveNextOrderWrite({
      served: true,
      edited: null,
      mondayDate: "",
      lastBillDates: [],
    });
    expect(value).toBe(today);
  });

  it("writes last-bill + 90 days for a served line", () => {
    const value = resolveNextOrderWrite({
      served: true,
      edited: null,
      mondayDate: "",
      lastBillDates: ["2026-01-01"],
    });
    expect(value).toBe(computeNextOrder(["2026-01-01"]));
  });

  it("skips the write when the effective value already matches the board", () => {
    const value = resolveNextOrderWrite({
      served: true,
      edited: "2026-05-05",
      mondayDate: "2026-05-05",
      lastBillDates: [],
    });
    expect(value).toBeNull();
  });
});
