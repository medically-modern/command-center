import { describe, it, expect } from "vitest";
import { computeNextOrder, effectiveNextOrder, nextOrderCadences } from "./workflow";
import type { NextOrderCadence } from "@/lib/shared/nextOrderCadence";

const SENSORS: NextOrderCadence = { line: "sensors" };
const SUPPLIES: NextOrderCadence = { line: "supplies" };
const PUMP: NextOrderCadence = { line: "insulin_pump" };

describe("computeNextOrder — no evidence is a BLANK, never today", () => {
  /** The regression this file exists for. `computeNextOrder([])` returned
   *  today, so every served line with no billing history got a reorder date
   *  stamped on the day the rep pressed Send. On the live board that was 89
   *  CGM rows, none of which fell on a weekend — see shared/nextOrderCadence.ts. */
  it("returns '' when there are no last bill dates", () => {
    expect(computeNextOrder([], SENSORS)).toBe("");
    expect(computeNextOrder([], SUPPLIES)).toBe("");
    expect(computeNextOrder([], PUMP)).toBe("");
  });

  it("returns '' when every entry is blank or unparseable", () => {
    expect(computeNextOrder(["", "  ", "not-a-date"], SENSORS)).toBe("");
  });

  it("never returns today for an empty history", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(computeNextOrder([], SENSORS)).not.toBe(today);
  });
});

describe("computeNextOrder — the cadence is per line and per payer", () => {
  it("sensors: +90 days by default, +30 for 1 unit, +60 for 2", () => {
    expect(computeNextOrder(["2026-01-01"], SENSORS)).toBe("2026-04-01");
    expect(computeNextOrder(["2026-01-01"], { line: "sensors", units: "1" })).toBe("2026-01-31");
    expect(computeNextOrder(["2026-01-01"], { line: "sensors", units: "2" })).toBe("2026-03-02");
  });

  it("supplies: +90 days, or +60 on Medicaid", () => {
    expect(computeNextOrder(["2026-01-01"], SUPPLIES)).toBe("2026-04-01");
    expect(computeNextOrder(["2026-01-01"], { line: "supplies", isMedicaid: true })).toBe("2026-03-02");
  });

  it("insulin pump: +4 years, or +5 on Medicare A&B — NOT 90 days", () => {
    expect(computeNextOrder(["2026-01-01"], PUMP)).toBe("2029-12-31"); // 1460d
    expect(computeNextOrder(["2026-01-01"], { line: "insulin_pump", isMedicare: true })).toBe("2030-12-31"); // 1825d — 2028 is the one leap day in the span
  });

  it("uses the latest of multiple last bill dates", () => {
    expect(computeNextOrder(["2025-01-01", "2026-01-01", "2024-06-01"], SENSORS)).toBe(
      computeNextOrder(["2026-01-01"], SENSORS),
    );
  });

  it("is UTC-anchored, so no east-of-UTC day rollback", () => {
    expect(computeNextOrder(["2026-03-15"], SENSORS)).toBe("2026-06-13");
  });
});

describe("effectiveNextOrder — the date on screen is the date that gets written", () => {
  it("prefers an explicit edit over the Monday value and the computed default", () => {
    expect(effectiveNextOrder("2026-05-05", "2026-06-06", ["2026-01-01"], SENSORS)).toBe("2026-05-05");
  });

  it("falls back to the existing Monday value when there is no edit", () => {
    expect(effectiveNextOrder(null, "2026-06-06", ["2026-01-01"], SENSORS)).toBe("2026-06-06");
  });

  it('treats a cleared edit ("") as no edit and falls back', () => {
    expect(effectiveNextOrder("", "2026-06-06", ["2026-01-01"], SENSORS)).toBe("2026-06-06");
    expect(effectiveNextOrder("", "", ["2026-01-01"], SENSORS)).toBe("2026-04-01");
  });

  it("resolves to '' when nothing is set and there is no last bill date", () => {
    expect(effectiveNextOrder(null, "", [], SENSORS)).toBe("");
  });

  it("normalizes the result to a YYYY-MM-DD slice", () => {
    expect(effectiveNextOrder("2026-05-05T00:00:00", "", [], SENSORS)).toBe("2026-05-05");
  });
});

describe("nextOrderCadences — one builder, so the card and the send agree", () => {
  const base = {
    primaryInsurance: "Horizon BCBS",
    secondaryInsurance: "",
    sosUnitsSensors: "",
  };

  it("flags Medicare A&B on the pump line only", () => {
    const c = nextOrderCadences({ ...base, primaryInsurance: "Medicare A&B" });
    expect(c.insulin_pump.isMedicare).toBe(true);
    expect(c.sensors.line).toBe("sensors");
    expect(c.supplies.isMedicaid).toBe(false);
  });

  it("flags Medicaid from either policy on the supplies line", () => {
    expect(nextOrderCadences({ ...base, primaryInsurance: "Fidelis Medicaid" }).supplies.isMedicaid).toBe(true);
    expect(nextOrderCadences({ ...base, secondaryInsurance: "NY Medicaid" }).supplies.isMedicaid).toBe(true);
    expect(nextOrderCadences(base).supplies.isMedicaid).toBe(false);
  });

  it("carries the sensors units through", () => {
    expect(nextOrderCadences({ ...base, sosUnitsSensors: "1" }).sensors.units).toBe("1");
  });

  it("prefers an in-page payer correction over the board value", () => {
    const c = nextOrderCadences({
      ...base,
      primaryInsurance: "Horizon BCBS",
      primaryInsuranceEdited: "Medicare A&B",
    });
    expect(c.insulin_pump.isMedicare).toBe(true);
  });
});
