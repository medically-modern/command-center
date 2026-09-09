import { describe, it, expect } from "vitest";
import {
  monitorSaleVerdict,
  daysBeforeYmd,
  MONITOR_LIFETIME_DAYS,
  MONITOR_LIFETIME_YEARS,
} from "./monitorSale";
import { sosLookbackDays, sosCutoffYmd } from "@/lib/samantha/benefitsDerive";
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
  it("mirrors sosLookbackDays('cgm-monitor', …, isMedicare) exactly", () => {
    expect(sosLookbackDays("cgm-monitor", false, true)).toBe(MONITOR_LIFETIME_DAYS);
    expect(MONITOR_LIFETIME_DAYS).toBe(365 * MONITOR_LIFETIME_YEARS);
  });

  it("⚠️ produces the SAME CUTOFF DATE as sosCutoffYmd, every day for 8 years", () => {
    // The constant matched all along while the arithmetic around it did not:
    // subtracting five CALENDAR years is a day off from 1,825 days whenever the
    // span contains a leap day, so a patient last billed 2021-09-09 read Clear
    // on the Insurance board and cannot-send here. Comparing the constants
    // could never have caught that — only comparing the cutoffs does.
    // (Greptile, PR #55.)
    const start = Date.UTC(2026, 0, 1);
    for (let d = 0; d < 365 * 8; d++) {
      const today = new Date(start + d * 86_400_000).toISOString().slice(0, 10);
      expect(daysBeforeYmd(today, MONITOR_LIFETIME_DAYS))
        .toBe(sosCutoffYmd("cgm-monitor", false, today, true));
    }
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
    // sosCutoffYmd's rule: STRICTLY before the cutoff clears it. From
    // 2026-09-09 the cutoff is 2021-09-10 — 1,825 days back, the span carrying
    // leap day 2024 — so 09-10 is still inside and 09-09 has expired.
    expect(v({ sosLastBillMonitor: "2021-09-10" }).state).toBe("cannot-send");
    expect(v({ sosLastBillMonitor: "2021-09-09" }).state).toBe("can-send");
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

  it("⚠️ is unknown for a YYYY-MM-DD-SHAPED value that is not a real date", () => {
    // The dangerous half: "2020-99-99" passes a shape-only check AND compares
    // lexically before the cutoff, so it took the sellable branch and
    // pre-filled Monitor Qty to 1 — authorising a Medicare monitor order off
    // unreadable data. Every malformed case above happens to fail the shape
    // check too, which is why a shape check looked sufficient (Greptile, PR #55).
    for (const bad of ["2020-99-99", "2021-02-30", "2021-00-10", "2021-13-01", "2021-04-31"]) {
      const r = v({ sosLastBillMonitor: bad });
      expect(r.state, bad).toBe("unknown");
      expect(r.defaultQty, bad).toBe("");
    }
  });

  it("⚠️ an unreadable date does NOT suppress a real never-billed flag", () => {
    // Falling through to the never-billed branch is the point of doing the
    // date check first: garbage must not authorise on its own, but it must
    // also not block a positive SoS answer sitting beside it.
    const r = v({ sosLastBillMonitor: "2020-99-99", sosNeverBilledMonitor: true });
    expect(r.state).toBe("can-send");
    expect(r.defaultQty).toBe("1");
  });

  it("still accepts real leap-day dates on both sides of the cutoff", () => {
    // The validation must not overshoot into rejecting valid dates. One leap
    // day older than the 2021-09-10 cutoff, one inside it — both real, both
    // classified on their date rather than rejected as unreadable.
    expect(v({ sosLastBillMonitor: "2020-02-29" }).state).toBe("can-send");
    expect(v({ sosLastBillMonitor: "2024-02-29" }).state).toBe("cannot-send");
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

describe("daysBeforeYmd", () => {
  it("subtracts whole days, leap day included", () => {
    expect(daysBeforeYmd("2026-09-09", MONITOR_LIFETIME_DAYS)).toBe("2021-09-10");
    expect(daysBeforeYmd("2026-01-01", 1)).toBe("2025-12-31");
    expect(daysBeforeYmd("2024-03-01", 1)).toBe("2024-02-29");
  });

  it("returns '' for a malformed date rather than a wrong one", () => {
    expect(daysBeforeYmd("nope", 5)).toBe("");
  });
});
