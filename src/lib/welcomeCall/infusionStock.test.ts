import { describe, it, expect } from "vitest";
import {
  stockKey,
  indexStock,
  stockVerdict,
  LOW_STOCK_THRESHOLD,
  type StockRow,
} from "./infusionStock";

const TODAY = "2026-09-09";

/** Real rows from the Cardinal SKU Tracker (18420366344), read 2026-09-09. */
const LIVE: StockRow[] = [
  { name: 'AutoSoft XC 6 mm 23"', qtyAvail: 1715, status: "Available", lastChanged: "2026-09-09 09:05 ET" },
  { name: 'AutoSoft XC 9 mm 43"', qtyAvail: 35, status: "Available", lastChanged: "2026-09-09 09:05 ET" },
  { name: 'AutoSoft 90 6 mm 23"', qtyAvail: 220, status: "Backordered", lastChanged: "2026-08-04 09:06 ET" },
  { name: 'AutoSoft XC 6 mm 32"', qtyAvail: 3, status: "Backordered", lastChanged: "2026-09-09 09:05 ET" },
  { name: 'AutoSoft 90 9 mm 23"', qtyAvail: 0, status: "Inactive", lastChanged: "2026-07-06 10:30 ET" },
  { name: 'Contact 6 mm 23"', qtyAvail: 1, status: "Backordered", lastChanged: "2026-08-28 09:05 ET" },
  { name: 'Inset 6 mm 23"', qtyAvail: 833, status: "Available", lastChanged: "2026-09-09 09:05 ET" },
  // ⚠️ The tracker spells this "9mm"; the board label says "9 mm".
  { name: 'Mio Advance Clear 9mm 23"', qtyAvail: 127, status: "Available", lastChanged: "2026-09-09 09:05 ET" },
  { name: 'QuickSet 18"', qtyAvail: 29, status: "Available", lastChanged: "2026-09-09 09:05 ET" },
];

const idx = indexStock(LIVE);
const v = (label: string, today = TODAY) => stockVerdict(label, idx, today);

describe("⚠️ status decides, quantity only explains", () => {
  it("calls a Backordered set RED even with 220 on hand", () => {
    // The row that breaks a count-only rule. Under "low if under 20" this is a
    // healthy green pill on a set Cardinal cannot ship.
    const r = v('AutoSoft 90 6 mm 23"');
    expect(r.tone).toBe("red");
    expect(r.blocked).toBe(true);
    expect(r.label).toBe("Backordered");
    expect(r.detail).toContain("220");
  });

  it("calls an Inactive set red, not just out of stock", () => {
    const r = v('AutoSoft 90 9 mm 23"');
    expect(r.tone).toBe("red");
    expect(r.label).toBe("Discontinued");
  });

  it("blocks every non-Available status on the live board", () => {
    for (const row of LIVE.filter((r) => r.status !== "Available")) {
      expect(v(row.name).blocked, `${row.name} (${row.status})`).toBe(true);
    }
  });

  it("never returns green for anything that isn't Available", () => {
    for (const row of LIVE.filter((r) => r.status !== "Available")) {
      expect(v(row.name).tone).not.toBe("green");
    }
  });
});

describe("Available sets read off the count", () => {
  it("is green well above the threshold", () => {
    const r = v('AutoSoft XC 6 mm 23"');
    expect(r.tone).toBe("green");
    expect(r.label).toBe("1,715 in stock");
  });

  it("is amber under the low-stock mark", () => {
    // 29 is above 20, 35 is above 20 — both green; nothing Available on the
    // live board is currently low, so the amber case is pinned synthetically.
    const low = indexStock([
      { name: "X", qtyAvail: LOW_STOCK_THRESHOLD - 1, status: "Available", lastChanged: "2026-09-09 09:05 ET" },
    ]);
    const r = stockVerdict("X", low, TODAY);
    expect(r.tone).toBe("amber");
    expect(r.label).toBe("19 left");
    expect(r.blocked).toBe(false);
  });

  it("treats the threshold itself as fine", () => {
    const at = indexStock([
      { name: "X", qtyAvail: LOW_STOCK_THRESHOLD, status: "Available", lastChanged: "2026-09-09 09:05 ET" },
    ]);
    expect(stockVerdict("X", at, TODAY).tone).toBe("green");
  });

  it("is red when Available but nothing is on the shelf", () => {
    const none = indexStock([
      { name: "X", qtyAvail: 0, status: "Available", lastChanged: "2026-09-09 09:05 ET" },
    ]);
    const r = stockVerdict("X", none, TODAY);
    expect(r.tone).toBe("red");
    expect(r.blocked).toBe(true);
  });
});

describe("⚠️ a missing row is UNKNOWN, never in stock", () => {
  it("greys out a board label the tracker has never heard of", () => {
    // Luer 6 mm 32" is a real Infusion Set 1 label with no tracker row.
    const r = v('Luer 6 mm 32"');
    expect(r.tone).toBe("grey");
    expect(r.blocked).toBe(false);
    expect(r.label).toBe("No stock data");
  });

  it("says nothing at all for a blank or Not Serving", () => {
    for (const l of ["", "   ", "Not Serving"]) {
      expect(v(l).label).toBe("");
    }
  });
});

describe("⚠️ the tracker's 9mm vs the board's 9 mm", () => {
  it("joins Mio Advance Clear across the spelling difference", () => {
    // An exact-string join misses this one SKU, silently, and it would render
    // as "No stock data" forever.
    const r = v('Mio Advance Clear 9 mm 23"');
    expect(r.tone).toBe("green");
    expect(r.label).toBe("127 in stock");
  });

  it("normalises case, curly quotes and spacing", () => {
    expect(stockKey('AutoSoft XC 6 mm 23"')).toBe(stockKey('autosoft  xc 6mm 23”'));
  });
});

describe("staleness", () => {
  it("stops claiming to know once the scrape is days old", () => {
    // The tracker is scraped daily; a stale number looks identical to a fresh
    // one on screen, which is the whole reason this case exists.
    const r = v('AutoSoft XC 6 mm 23"', "2026-09-20");
    expect(r.tone).toBe("grey");
    expect(r.label).toBe("Stock unknown");
  });

  it("still trusts a stamp from within the window", () => {
    expect(v('AutoSoft XC 6 mm 23"', "2026-09-11").tone).toBe("green");
  });

  it("⚠️ staleness never rescues a Backordered set", () => {
    // Status is checked BEFORE freshness: an old Backordered row must not
    // decay into a neutral grey pill that reads as "probably fine".
    const r = v('AutoSoft 90 6 mm 23"', "2026-09-20");
    expect(r.tone).toBe("red");
    expect(r.blocked).toBe(true);
  });

  it("greys an unparseable stamp rather than trusting it", () => {
    const bad = indexStock([
      { name: "X", qtyAvail: 500, status: "Available", lastChanged: "sometime" },
    ]);
    expect(stockVerdict("X", bad, TODAY).tone).toBe("grey");
  });
});

describe("a status without a count", () => {
  const row = (qtyAvail: number | null) => [
    { name: 'Inset 6 mm 23"', qtyAvail, status: "Available", lastChanged: "2026-09-09 09:05 ET" },
  ];

  /* ⚠️ Regression: this branch read `row.qtyAvail ?? 0`, so an Available row
     with no readable count reported red "Out of stock" — an invented shortage
     on a set Cardinal can ship. `stockApi` maps a blank to null precisely so
     the two can be told apart. */
  it("is unknown, not out of stock", () => {
    const v = stockVerdict('Inset 6 mm 23"', indexStock(row(null)), "2026-09-09");
    expect(v.tone).toBe("grey");
    expect(v.blocked).toBe(false);
    expect(v.label).toBe("Stock unknown");
  });

  it("still reports a real zero as out of stock", () => {
    const v = stockVerdict('Inset 6 mm 23"', indexStock(row(0)), "2026-09-09");
    expect(v.tone).toBe("red");
    expect(v.blocked).toBe(true);
    expect(v.label).toBe("Out of stock");
  });

  /* Status still wins over the missing count — a backordered row is red
     whatever the quantity says, including when it says nothing. */
  it("does not let a missing count outrank Backordered", () => {
    const v = stockVerdict(
      'Inset 6 mm 23"',
      indexStock([{ name: 'Inset 6 mm 23"', qtyAvail: null, status: "Backordered", lastChanged: "2026-09-09 09:05 ET" }]),
      "2026-09-09",
    );
    expect(v.tone).toBe("red");
    expect(v.blocked).toBe(true);
  });
});
