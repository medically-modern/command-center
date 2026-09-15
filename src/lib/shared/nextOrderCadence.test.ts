import { describe, it, expect } from "vitest";
import { computeNextOrderDate, nextOrderOffsetDays, addDaysUtc } from "./nextOrderCadence";
import { computeNextOrderDates } from "@/lib/samantha/workflow";
import type { InsuranceState, ProductCodeState } from "@/lib/samantha/workflow";

/** Build the Insurance-side state for one product with a last bill + units. */
function insWith(code: string, lastBillDate: string, units?: string): InsuranceState {
  return {
    universal: {},
    codes: { [code]: { status: "pending", lastBillDate, units } as ProductCodeState },
  } as unknown as InsuranceState;
}

/**
 * ⚠️ THE POINT OF THIS FILE. The Insurance stage and the Welcome Call stage
 * write the SAME three Monday columns. They used to do it by different rules,
 * and because Welcome Call only ever fills a blank, the disagreement was
 * invisible until it landed on exactly the patients Insurance had no answer
 * for. `lib/shared/*` must not import a role slice, so the rule is stated once
 * in nextOrderCadence.ts and the Insurance path keeps its own copy — these
 * cases are what stop the two drifting apart again.
 */
describe("parity with samantha/computeNextOrderDates — one cadence, two stages", () => {
  it("sensors: 90 / 60 / 30 days by billed units", () => {
    for (const [units, expected] of [[undefined, 90], ["2", 60], ["1", 30]] as const) {
      const ins = computeNextOrderDates(insWith("cgm-sensors", "2026-01-01", units), "Horizon BCBS", "");
      const shared = computeNextOrderDate(["2026-01-01"], { line: "sensors", units });
      expect(shared).toBe(ins.sensorsNextOrderDate);
      expect(nextOrderOffsetDays({ line: "sensors", units })).toBe(expected);
    }
  });

  it("supplies: 90 days, 60 on Medicaid, from the LATER of sets and cartridges", () => {
    const state = {
      universal: {},
      codes: {
        "infusion-sets": { status: "pending", lastBillDate: "2026-01-01" },
        cartridges: { status: "pending", lastBillDate: "2026-02-15" },
      },
    } as unknown as InsuranceState;
    for (const payer of ["Horizon BCBS", "Fidelis Medicaid"]) {
      const ins = computeNextOrderDates(state, payer, "");
      const shared = computeNextOrderDate(["2026-01-01", "2026-02-15"], {
        line: "supplies",
        isMedicaid: payer.toLowerCase().includes("medicaid"),
      });
      expect(shared).toBe(ins.suppliesNextOrderDate);
    }
  });

  it("insulin pump: 4 years, 5 on Medicare A&B", () => {
    for (const payer of ["Horizon BCBS", "Medicare A&B"]) {
      const ins = computeNextOrderDates(insWith("pump", "2026-01-01"), payer, "");
      const shared = computeNextOrderDate(["2026-01-01"], {
        line: "insulin_pump",
        isMedicare: payer === "Medicare A&B",
      });
      expect(shared).toBe(ins.ipNextOrderDate);
    }
  });

  it("no last bill: BOTH stages return '' — neither invents a date", () => {
    const empty = { universal: {}, codes: {} } as unknown as InsuranceState;
    const ins = computeNextOrderDates(empty, "Horizon BCBS", "");
    expect(ins.sensorsNextOrderDate).toBe("");
    expect(ins.ipNextOrderDate).toBe("");
    expect(ins.suppliesNextOrderDate).toBe("");
    expect(computeNextOrderDate([], { line: "sensors" })).toBe("");
    expect(computeNextOrderDate([], { line: "insulin_pump" })).toBe("");
    expect(computeNextOrderDate([], { line: "supplies" })).toBe("");
  });
});

describe("addDaysUtc", () => {
  it("is UTC-anchored — no local-midnight/toISOString day rollback", () => {
    expect(addDaysUtc("2026-03-15", 90)).toBe("2026-06-13");
    expect(addDaysUtc("2026-01-01", 0)).toBe("2026-01-01");
  });

  it("crosses a leap day correctly", () => {
    expect(addDaysUtc("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("returns '' for anything that is not a leading YYYY-MM-DD", () => {
    expect(addDaysUtc("", 90)).toBe("");
    expect(addDaysUtc("03/15/2026", 90)).toBe("");
  });
});
