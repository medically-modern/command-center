import { describe, it, expect } from "vitest";
import {
  monitorSaleVerdict,
  yearsBeforeYmd,
  MONITOR_LIFETIME_YEARS,
} from "./monitorSale";
import { sosLookbackDays } from "@/lib/samantha/benefitsDerive";
import { deriveMonitorPurchaseDate } from "./monitorPurchaseDate";

const TODAY = "2026-09-09";

const v = (over: Partial<Parameters<typeof monitorSaleVerdict>[0]> = {}) =>
  monitorSaleVerdict({
    sosLastBillMonitor: "",
    sosNeverBilledMonitor: false,
    todayYmd: TODAY,
    ...over,
  });

describe("the 5-year lifetime agrees with the Insurance stage", () => {
  it("⚠️ mirrors sosLookbackDays('cgm-monitor', …, isMedicare) exactly", () => {
    // Duplicated rather than imported (lib/shared must not depend on a role
    // slice). This is the pin that makes a change to either one loud.
    expect(sosLookbackDays("cgm-monitor", false, true)).toBe(365 * MONITOR_LIFETIME_YEARS);
  });
});

describe("a real SoS last bill decides it", () => {
  it("inside 5 years → cannot send, Qty 0, amber", () => {
    const r = v({ sosLastBillMonitor: "2026-01-01" });
    expect(r.state).toBe("cannot-send");
    expect(r.defaultQty).toBe("0");
    expect(r.tone).toBe("amber");
    expect(r.note).toContain("01/2026");
  });

  it("older than 5 years → CAN send, Qty 1, green, and still shows the date", () => {
    // Josh, 2026-09-09: "show the old billing date though and that its green
    // cause older than 5 years."
    const r = v({ sosLastBillMonitor: "2020-04-19" });
    expect(r.state).toBe("can-send");
    expect(r.defaultQty).toBe("1");
    expect(r.tone).toBe("green");
    expect(r.lastBill).toBe("2020-04-19");
    expect(r.note).toContain("04/2020");
  });

  it("treats the cutoff itself as still inside the lifetime", () => {
    // sosCutoffYmd's rule: STRICTLY before the cutoff clears it. A bill exactly
    // 5 years old has not expired yet.
    expect(v({ sosLastBillMonitor: "2021-09-09" }).state).toBe("cannot-send");
    expect(v({ sosLastBillMonitor: "2021-09-08" }).state).toBe("can-send");
  });

  it("⚠️ a last-bill date BEATS the never-billed flag when both are set", () => {
    // Benefits can re-run after a correction and leave both. The date is the
    // more specific fact, so a patient who demonstrably has a recent monitor is
    // never sold another on the strength of a stale flag.
    const r = v({ sosLastBillMonitor: "2026-06-12", sosNeverBilledMonitor: true });
    expect(r.state).toBe("cannot-send");
    expect(r.defaultQty).toBe("0");
  });
});

describe("never billed → sell them one", () => {
  it("defaults Qty to 1 and says why", () => {
    const r = v({ sosNeverBilledMonitor: true });
    expect(r.state).toBe("can-send");
    expect(r.defaultQty).toBe("1");
    expect(r.tone).toBe("green");
    expect(r.note).toMatch(/no medicare billing history/i);
  });
});

describe("⚠️ no SoS answer is UNKNOWN, never a no", () => {
  it("defaults no quantity at all and tells the rep to ask", () => {
    const r = v();
    expect(r.state).toBe("unknown");
    expect(r.defaultQty).toBe("");
    expect(r.tone).toBe("grey");
  });

  it("is unknown for a blank, whitespace or malformed date", () => {
    for (const bad of ["", "   ", "not a date", "2026-13", "06/12/2026"]) {
      expect(v({ sosLastBillMonitor: bad }).state).toBe("unknown");
    }
  });
});

describe("⚠️ it composes with monitorPurchaseDate rather than fighting it", () => {
  const medicare = { primaryInsurance: "Medicare A&B", serving: "CGM" };

  it("selling (Qty 1) means no purchase date is asked for", () => {
    // This is what dissolves the circularity: the sale default keys off SoS,
    // the date keys off the quantity, and neither reads the other's output.
    const sale = v({ sosNeverBilledMonitor: true });
    expect(sale.defaultQty).toBe("1");
    expect(
      deriveMonitorPurchaseDate({
        current: "",
        ...medicare,
        monitorQty: sale.defaultQty,
        sosLastBillMonitor: "",
        sosNeverBilledMonitor: true,
        todayYmd: TODAY,
      }),
    ).toBe("");
  });

  it("⚠️ flipping Qty back to 0 still yields the SOP placeholder", () => {
    // Josh, 2026-09-09: the fabricated ~24-month date "is fine and part of sop".
    // The rep's escape hatch from the sale default must keep producing it.
    expect(
      deriveMonitorPurchaseDate({
        current: "",
        ...medicare,
        monitorQty: "0",
        sosLastBillMonitor: "",
        sosNeverBilledMonitor: true,
        todayYmd: TODAY,
      }),
    ).toBe("09/2024");
  });

  it("a real last bill flows into the date field unchanged when not selling", () => {
    expect(
      deriveMonitorPurchaseDate({
        current: "",
        ...medicare,
        monitorQty: "0",
        sosLastBillMonitor: "2026-01-01",
        sosNeverBilledMonitor: false,
        todayYmd: TODAY,
      }),
    ).toBe("01/2026");
  });
});

describe("yearsBeforeYmd", () => {
  it("subtracts whole years", () => {
    expect(yearsBeforeYmd("2026-09-09", 5)).toBe("2021-09-09");
    expect(yearsBeforeYmd("2026-01-31", 5)).toBe("2021-01-31");
  });

  it("clamps Feb 29 back to Feb 28 rather than rolling into March", () => {
    // The conservative direction: an EARLIER cutoff, so nobody is declared
    // sellable a day too soon.
    expect(yearsBeforeYmd("2028-02-29", 5)).toBe("2023-02-28");
    expect(yearsBeforeYmd("2028-02-29", 4)).toBe("2024-02-29");
  });

  it("returns '' for a malformed date rather than a wrong one", () => {
    expect(yearsBeforeYmd("nope", 5)).toBe("");
  });
});
