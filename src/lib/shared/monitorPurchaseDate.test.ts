import { describe, it, expect } from "vitest";

import {
  MONITOR_PLACEHOLDER_MONTHS_BACK,
  deriveMonitorPurchaseDate,
  monthYearMonthsBefore,
  needsMonitorPurchaseDate,
  toMonthYear,
} from "./monitorPurchaseDate";
import {
  isOriginalMedicare as fcIsOriginalMedicare,
  servingIncludesCgm as fcServingIncludesCgm,
} from "../finalConfirm/workflow";
import {
  isOriginalMedicare as wcIsOriginalMedicare,
  servingIncludesCgm as wcServingIncludesCgm,
} from "../welcomeCall/workflow";

/**
 * Monitor Purchase Date — the CGM twin of Prior Pump Purchase Date.
 *
 * Unlike the pump rule (duplicated per role, kept honest by
 * priorPumpDate.test.ts), this one has a single shared implementation that both
 * Welcome Call and Final Confirm re-export. What still needs pinning is that
 * the shared rule's inlined predicates agree with the two roles' own
 * `isOriginalMedicare` / `servingIncludesCgm` helpers — that is the seam where
 * a future edit to either role could silently desync the gate.
 */

const TODAY = "2026-08-13";
/** TODAY minus MONITOR_PLACEHOLDER_MONTHS_BACK (24) months. */
const PLACEHOLDER = "08/2024";

const CGM_SERVINGS = ["CGM", "Insulin Pump + CGM", "Supplies + CGM"];
const NON_CGM_SERVINGS = ["Insulin Pump", "Supplies Only"];

/** A patient who would get the placeholder, so each test can vary one field. */
function baseInput(over: Partial<Parameters<typeof deriveMonitorPurchaseDate>[0]> = {}) {
  return {
    current: "",
    primaryInsurance: "Medicare A&B",
    monitorQty: "0",
    serving: "CGM",
    sosLastBillMonitor: "",
    sosNeverBilledMonitor: true,
    todayYmd: TODAY,
    ...over,
  };
}

describe("month math", () => {
  it("formats a YYYY-MM-DD as MM/YYYY", () => {
    expect(toMonthYear("2024-05-17")).toBe("05/2024");
    expect(toMonthYear("2026-12-01")).toBe("12/2026");
  });

  it("returns '' for anything unparseable rather than a bogus date", () => {
    for (const bad of ["", "   ", "not a date", "05/2024", "2024-5-7"]) {
      expect(toMonthYear(bad), bad).toBe("");
      expect(monthYearMonthsBefore(bad, 24), bad).toBe("");
    }
  });

  it("walks back whole months without a Date object (no DST/TZ drift)", () => {
    expect(monthYearMonthsBefore("2026-08-13", 24)).toBe("08/2024");
    // Crossing a year boundary mid-year.
    expect(monthYearMonthsBefore("2026-03-01", 24)).toBe("03/2024");
    // Not a multiple of 12.
    expect(monthYearMonthsBefore("2026-01-31", 1)).toBe("12/2025");
    expect(monthYearMonthsBefore("2026-01-31", 13)).toBe("12/2024");
    // Day-of-month is irrelevant — the field is month granularity.
    expect(monthYearMonthsBefore("2026-08-01", 24)).toBe(
      monthYearMonthsBefore("2026-08-31", 24),
    );
  });

  it("the placeholder really is two years back", () => {
    expect(MONITOR_PLACEHOLDER_MONTHS_BACK).toBe(24);
    expect(monthYearMonthsBefore(TODAY, MONITOR_PLACEHOLDER_MONTHS_BACK)).toBe(PLACEHOLDER);
  });
});

describe("needsMonitorPurchaseDate", () => {
  it("asks Original Medicare + Monitor Qty 0 for every CGM serving", () => {
    for (const serving of CGM_SERVINGS) {
      expect(needsMonitorPurchaseDate("Medicare A&B", "0", serving), serving).toBe(true);
    }
  });

  it("never asks a pump-only patient, even on Original Medicare", () => {
    for (const serving of NON_CGM_SERVINGS) {
      expect(needsMonitorPurchaseDate("Medicare A&B", "0", serving), serving).toBe(false);
    }
  });

  it("does not ask when a monitor is being sold (Monitor Qty 1)", () => {
    expect(needsMonitorPurchaseDate("Medicare A&B", "1", "Insulin Pump + CGM")).toBe(false);
  });

  it("treats a blank Monitor Qty as 0 — anything not exactly '1' counts", () => {
    for (const qty of ["", "  ", "0", "00"]) {
      expect(needsMonitorPurchaseDate("Medicare A&B", qty, "CGM"), `qty ${qty}`).toBe(true);
    }
  });

  it("does not ask non-Original-Medicare patients (Advantage plans included)", () => {
    for (const ins of ["United Medicare", "Aetna Medicare", "Humana", "Wellcare", "Medicaid", "Cigna", ""]) {
      expect(needsMonitorPurchaseDate(ins, "0", "CGM"), ins).toBe(false);
    }
  });

  it("trusts unknown (blank) serving as CGM-served so a missing column can't wipe a collected date", () => {
    expect(needsMonitorPurchaseDate("Medicare A&B", "0", "")).toBe(true);
    expect(needsMonitorPurchaseDate("Medicare A&B", "0", "  ")).toBe(true);
  });

  it("agrees with BOTH roles' own isOriginalMedicare / servingIncludesCgm helpers", () => {
    const insurances = ["Medicare A&B", " Medicare A&B ", "United Medicare", "Aetna Commercial", "Medicaid", ""];
    const servings = ["", "  ", ...CGM_SERVINGS, ...NON_CGM_SERVINGS, "cgm", "CGM "];
    for (const ins of insurances) {
      for (const serving of servings) {
        const expected =
          wcIsOriginalMedicare(ins) && (serving.trim() === "" || wcServingIncludesCgm(serving));
        const label = `${ins} / ${serving}`;
        expect(needsMonitorPurchaseDate(ins, "0", serving), label).toBe(expected);
        // Final Confirm's copies must give the same answer as Welcome Call's.
        expect(fcIsOriginalMedicare(ins), label).toBe(wcIsOriginalMedicare(ins));
        expect(fcServingIncludesCgm(serving), label).toBe(wcServingIncludesCgm(serving));
      }
    }
  });
});

describe("deriveMonitorPurchaseDate", () => {
  it("stamps the rolling placeholder when SoS reports no billing history", () => {
    expect(deriveMonitorPurchaseDate(baseInput())).toBe(PLACEHOLDER);
  });

  it("is rolling, not the fixed 05/2024 from the original request", () => {
    expect(deriveMonitorPurchaseDate(baseInput({ todayYmd: "2027-01-04" }))).toBe("01/2025");
    expect(deriveMonitorPurchaseDate(baseInput({ todayYmd: "2026-05-31" }))).toBe("05/2024");
  });

  it("prefers a real SoS last bill date over the placeholder", () => {
    expect(
      deriveMonitorPurchaseDate(
        baseInput({ sosLastBillMonitor: "2023-11-02", sosNeverBilledMonitor: false }),
      ),
    ).toBe("11/2023");
  });

  it("still prefers the real date if both signals somehow disagree", () => {
    expect(
      deriveMonitorPurchaseDate(
        baseInput({ sosLastBillMonitor: "2023-11-02", sosNeverBilledMonitor: true }),
      ),
    ).toBe("11/2023");
  });

  it("never overwrites a value the rep already entered", () => {
    expect(deriveMonitorPurchaseDate(baseInput({ current: "03/2021" }))).toBe("03/2021");
    expect(
      deriveMonitorPurchaseDate(baseInput({ current: "03/2021", sosLastBillMonitor: "2023-11-02" })),
    ).toBe("03/2021");
  });

  it("re-fills a field the rep cleared (Josh, 2026-08-13) — overwrite, don't blank, is the escape hatch", () => {
    expect(deriveMonitorPurchaseDate(baseInput({ current: "" }))).toBe(PLACEHOLDER);
    expect(deriveMonitorPurchaseDate(baseInput({ current: "   " }))).toBe(PLACEHOLDER);
  });

  it("stays blank when Benefits has not answered SoS yet — nothing to assert, the rep asks", () => {
    expect(
      deriveMonitorPurchaseDate(baseInput({ sosNeverBilledMonitor: false, sosLastBillMonitor: "" })),
    ).toBe("");
  });

  it("clears the field when the patient stops being eligible, even if a value is present", () => {
    const withValue = { current: "03/2021" };
    // Insurance changed away from Original Medicare.
    expect(deriveMonitorPurchaseDate(baseInput({ ...withValue, primaryInsurance: "Humana" }))).toBe("");
    // A monitor is now being sold.
    expect(deriveMonitorPurchaseDate(baseInput({ ...withValue, monitorQty: "1" }))).toBe("");
    // Serving narrowed to pump-only.
    expect(deriveMonitorPurchaseDate(baseInput({ ...withValue, serving: "Supplies Only" }))).toBe("");
  });

  it("is idempotent — feeding its own output back changes nothing", () => {
    const first = deriveMonitorPurchaseDate(baseInput());
    const second = deriveMonitorPurchaseDate(baseInput({ current: first }));
    expect(second).toBe(first);
  });
});
