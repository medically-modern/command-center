import { describe, it, expect } from "vitest";
import { computeNextOrder, resolveNextOrderWrite } from "./workflow";
import type { NextOrderCadence } from "@/lib/shared/nextOrderCadence";

const SENSORS: NextOrderCadence = { line: "sensors" };

/**
 * MM-1042: sensor next order date was being populated (with "today", so it
 * matched supplies/pump) for patients not being served sensors. The fix gated
 * each next-order write on whether that product is served.
 *
 * ⚠️ The "today" default it was gating AGAINST is gone as of 2026-09-15 — a
 * line with no last-bill history now resolves to "" on both paths
 * (shared/nextOrderCadence.ts). The serving gate still matters and still has
 * its own job: a not-served line must CLEAR a stale board value, where a served
 * line with nothing to compute from leaves it alone.
 */
describe("resolveNextOrderWrite — not-served products must stay empty", () => {
  it("does not write anything to a not-served line that is already blank", () => {
    const value = resolveNextOrderWrite({
      served: false,
      edited: null,
      mondayDate: "",
      lastBillDates: [],
      cadence: SENSORS,
    });
    expect(value).toBeNull();
  });

  it("clears a stale date on a not-served line", () => {
    const value = resolveNextOrderWrite({
      served: false,
      edited: null,
      mondayDate: "2026-07-15",
      lastBillDates: [],
      cadence: SENSORS,
    });
    expect(value).toBe("");
  });

  it("honors an explicit rep edit even on a not-served line", () => {
    const value = resolveNextOrderWrite({
      served: false,
      edited: "2026-09-01",
      mondayDate: "",
      lastBillDates: [],
      cadence: SENSORS,
    });
    expect(value).toBe("2026-09-01");
  });
});

describe("resolveNextOrderWrite — served products", () => {
  /** The regression guard. A served line with no billing history used to write
   *  TODAY; 89 live CGM rows carried one. It must now write nothing at all. */
  it("writes NOTHING for a served line with no last-bill history", () => {
    const value = resolveNextOrderWrite({
      served: true,
      edited: null,
      mondayDate: "",
      lastBillDates: [],
      cadence: SENSORS,
    });
    expect(value).toBeNull();
  });

  /** ⚠️ Skip, not clear. Having no basis to compute a date is not evidence the
   *  date on the board is wrong — the rep's own entry arrives via `edited`. */
  it("leaves an existing board date alone when it has nothing to compute from", () => {
    const value = resolveNextOrderWrite({
      served: true,
      edited: null,
      mondayDate: "2026-07-15",
      lastBillDates: [],
      cadence: SENSORS,
    });
    expect(value).toBeNull();
  });

  it("writes the cadence result for a served line with history", () => {
    const value = resolveNextOrderWrite({
      served: true,
      edited: null,
      mondayDate: "",
      lastBillDates: ["2026-01-01"],
      cadence: SENSORS,
    });
    expect(value).toBe(computeNextOrder(["2026-01-01"], SENSORS));
    expect(value).toBe("2026-04-01");
  });

  it("uses the PUMP cadence on the pump line — years, not 90 days", () => {
    const value = resolveNextOrderWrite({
      served: true,
      edited: null,
      mondayDate: "",
      lastBillDates: ["2026-01-01"],
      cadence: { line: "insulin_pump", isMedicare: true },
    });
    expect(value).toBe("2030-12-31");
  });

  it("skips the write when the effective value already matches the board", () => {
    const value = resolveNextOrderWrite({
      served: true,
      edited: "2026-05-05",
      mondayDate: "2026-05-05",
      lastBillDates: [],
      cadence: SENSORS,
    });
    expect(value).toBeNull();
  });
});
