import { describe, it, expect } from "vitest";
import { SKU_GROUPS, type SkuTrackerRow } from "./skuTrackerApi";
import { mkOrder } from "./fixtures";
import {
  cashPayQuote, canQuoteCashPay, cashPayLineItems, cashPayTotalCents, round2, unitOopPrice,
  CASH_PAY_MARKUP, MIN_ORDER_MARKUP, SHIPPING_HANDLING, SHIPPING_HANDLING_LABEL,
} from "./cashPayPricing";

/**
 * Costs are the LIVE `numeric_mm4wd6b` values read off the Cardinal SKU
 * Tracker on 2026-09-21. They are fixtures so the arithmetic is pinned, but
 * they are real: re-read the board before changing one.
 */
const row = (
  name: string, groupId: string, unitCost: number | null, sku = "SKU",
): SkuTrackerRow => ({
  id: name + groupId, name, groupId, sku, description: "", uom: "BX",
  unitCost, qtyAvail: 100, status: "Available",
  lastChanged: "2026-09-21 09:05 ET", notes: "", runHistory: "",
});

const TRACKER: SkuTrackerRow[] = [
  // ⚠️ Two rows are named "t:slim" — the PUMP at 3992.5763 and the CARTRIDGE at
  // 30.95. They are told apart by GROUP alone, which is the whole reason the
  // quote joins through `skuRowForLine` rather than by name.
  row("t:slim", SKU_GROUPS.cartridges, 30.95, "TN1013310I"),
  row("t:slim", SKU_GROUPS.insulinPumps, 3992.5763, "PUMP-TSLIM"),
  row('AutoSoft XC 9 mm 43"', SKU_GROUPS.infusionSets, 71.94, "TN1001729I"),
  row("Dexcom G7", SKU_GROUPS.cgmSensors, 57.32, "EDSTPAT013MEDIMA"),
  row("Dexcom G7 / G7 15-Day → G7 Receiver", SKU_GROUPS.cgmReceivers, 234.2801, "EDSTKAT013MEDIM"),
  // An Inactive product: the tracker really does carry 0 here.
  row('AutoSoft 90 9 mm 23"', SKU_GROUPS.infusionSets, 0, "INACTIVE"),
  // The Run Log headline row — must never join to a line.
  row("Last run: 2026-09-21 09:05 ET (cron) — 14 changed", SKU_GROUPS.runLog, null),
];

/** Debbie Hinze's real order, 12848746815 — a 90-day supply. */
const debbie = mkOrder({
  cartridgeType: "t:slim", qtyCartridge: "3",
  infusionSet1: 'AutoSoft XC 9 mm 43"', qtyInfusionSet1: "3",
  cgmType: "Dexcom G7", qtySensors: "9",
  primaryInsurance: "Cash Pay",
});

describe("Debbie Hinze — the one real cash pay order we have", () => {
  /* Paid 2026-08-19. The note on her order records "Cardinal cost $824.55 +
     25% markup" and Janelle quoted her $1,030.69 on the phone. If this test
     fails, the rule has drifted from the only price a patient has agreed to. */
  it("reproduces the $1,030.69 quote to the cent", () => {
    const q = cashPayQuote(debbie, TRACKER);
    expect(q.refusal).toBe("");
    expect(q.cardinalCost).toBe(824.55);
    expect(q.total).toBe(1030.69);
  });

  it("prices each line the way the invoice does", () => {
    const q = cashPayQuote(debbie, TRACKER);
    const by = (p: string) => q.lines.find((l) => l.product === p)!;
    expect(by("t:slim").lineCost).toBe(92.85);
    expect(by("t:slim").linePrice).toBe(116.06);
    expect(by('AutoSoft XC 9 mm 43"').lineCost).toBe(215.82);
    expect(by('AutoSoft XC 9 mm 43"').linePrice).toBe(269.78);
    expect(by("Dexcom G7").lineCost).toBe(515.88);
    expect(by("Dexcom G7").linePrice).toBe(644.85);
  });

  it("adds NO shipping line — the markup is $206.14, well over the floor", () => {
    const q = cashPayQuote(debbie, TRACKER);
    expect(q.markup).toBe(206.14);
    expect(q.markup).toBeGreaterThanOrEqual(MIN_ORDER_MARKUP);
    expect(q.shipping).toBe(0);
    expect(cashPayLineItems(q).map((i) => i.label))
      .not.toContain(SHIPPING_HANDLING_LABEL);
  });

  it("joins t:slim to the CARTRIDGE row, not the $3,992 pump", () => {
    const q = cashPayQuote(debbie, TRACKER);
    const cart = q.lines.find((l) => l.product === "t:slim")!;
    expect(cart.family).toBe("cartridges");
    expect(cart.unitCost).toBe(30.95);
    expect(cart.sku).toBe("TN1013310I");
  });
});

describe("the profit floor is an ORDER-level rule", () => {
  /* Brandon's own worked example: "one box of cartridges is ~$31 cost →
     ~$7.74 markup, which doesn't even cover shipping". */
  it("one box of cartridges earns $7.74, so $10 shipping is added", () => {
    const q = cashPayQuote(
      mkOrder({ cartridgeType: "t:slim", qtyCartridge: "1" }), TRACKER,
    );
    expect(q.cardinalCost).toBe(30.95);
    expect(q.markup).toBe(7.74);
    expect(q.shipping).toBe(SHIPPING_HANDLING);
    expect(q.total).toBe(48.69);
  });

  it("the shipping line is a real line the patient sees", () => {
    const q = cashPayQuote(
      mkOrder({ cartridgeType: "t:slim", qtyCartridge: "1" }), TRACKER,
    );
    const items = cashPayLineItems(q);
    expect(items.at(-1)).toEqual({
      label: SHIPPING_HANDLING_LABEL, quantity: 1, amountCents: 1000,
    });
  });

  it("fires on the ORDER total, not per line — many small lines can clear it", () => {
    /* Three cartridge boxes earn $23.21 between them. Each line ALONE would be
       under $10; per-line the floor would wrongly add shipping. */
    const q = cashPayQuote(
      mkOrder({ cartridgeType: "t:slim", qtyCartridge: "3" }), TRACKER,
    );
    expect(q.markup).toBe(23.21);
    expect(q.shipping).toBe(0);
  });

  it("exactly $10 of markup does NOT add shipping — the rule is 'less than'", () => {
    /* 40 / 1.25 = 32 of cost earns exactly 8.00... so pick a cost that lands
       the markup on 10.00 precisely: 40.00 of cost -> 50.00 -> markup 10.00. */
    const q = cashPayQuote(
      mkOrder({ cartridgeType: "Exact", qtyCartridge: "1" }),
      [row("Exact", SKU_GROUPS.cartridges, 40)],
    );
    expect(q.markup).toBe(10);
    expect(q.shipping).toBe(0);
    expect(q.total).toBe(50);
  });
});

describe("a line we cannot price refuses the whole quote", () => {
  it("refuses a product that is not on the tracker", () => {
    const q = cashPayQuote(
      mkOrder({ cgmType: "Nonexistent Sensor", qtySensors: "9" }), TRACKER,
    );
    expect(q.refusal).toMatch(/isn't on the Cardinal SKU Tracker/);
    expect(q.total).toBe(0);
    expect(q.lines).toEqual([]);
  });

  it("refuses a tracker row whose cost is 0 — an Inactive product", () => {
    const q = cashPayQuote(
      mkOrder({ infusionSet1: 'AutoSoft 90 9 mm 23"', qtyInfusionSet1: "3" }), TRACKER,
    );
    expect(q.refusal).toMatch(/no cost for/);
    expect(q.total).toBe(0);
  });

  it("refuses when ONE line of several is unpriceable — never a partial total", () => {
    /* The dangerous failure: quoting $1,030.69 while silently dropping a
       product the patient is about to be shipped. */
    const q = cashPayQuote(
      mkOrder({
        cartridgeType: "t:slim", qtyCartridge: "3",
        infusionSet1: 'AutoSoft 90 9 mm 23"', qtyInfusionSet1: "3",
      }),
      TRACKER,
    );
    expect(q.refusal).not.toBe("");
    expect(q.total).toBe(0);
  });

  it("refuses an order with no products", () => {
    expect(cashPayQuote(mkOrder({}), TRACKER).refusal)
      .toMatch(/no products/);
  });

  it("canQuoteCashPay agrees with the refusal", () => {
    expect(canQuoteCashPay(debbie, TRACKER)).toBe(true);
    expect(canQuoteCashPay(mkOrder({}), TRACKER)).toBe(false);
  });
});

describe("what Stripe is handed", () => {
  it("the charged cents are the sum of the lines, never a re-rounded total", () => {
    const q = cashPayQuote(debbie, TRACKER);
    expect(cashPayTotalCents(q)).toBe(103069);
    expect(cashPayTotalCents(q))
      .toBe(cashPayLineItems(q).reduce((s, i) => s + i.amountCents, 0));
  });

  it("carries the quantity and a label naming the product family", () => {
    const items = cashPayLineItems(cashPayQuote(debbie, TRACKER));
    expect(items).toHaveLength(3);
    expect(items[0].quantity).toBe(9);
    expect(items.map((i) => i.label)).toEqual([
      "Dexcom G7 (CGM sensors)",
      "t:slim (Cartridges)",
      'AutoSoft XC 9 mm 43" (Infusion sets)',
    ]);
  });

  it("a refused quote hands Stripe nothing at all", () => {
    const q = cashPayQuote(mkOrder({}), TRACKER);
    expect(cashPayLineItems(q)).toEqual([]);
    expect(cashPayTotalCents(q)).toBe(0);
  });
});

describe("round2 — the half-up cases float gets wrong", () => {
  /* ⚠️ Regression. `Math.round(n * 100)` returns 269.77 for this value because
     269.775 is stored as 269.77499999999998. That is a cent off Debbie's real
     quote. Verified to fail against the naive implementation, and against the
     `+ Number.EPSILON` one, which is far too small to correct it. */
  it("269.775 rounds UP to 269.78, as a person doing it by hand would", () => {
    expect(round2(269.775)).toBe(269.78);
    expect(round2(215.82 * CASH_PAY_MARKUP)).toBe(269.78);
  });

  it("the other Debbie lines survive the same treatment", () => {
    expect(round2(92.85 * CASH_PAY_MARKUP)).toBe(116.06);
    expect(round2(515.88 * CASH_PAY_MARKUP)).toBe(644.85);
    expect(round2(30.95 * CASH_PAY_MARKUP)).toBe(38.69);
  });

  it("leaves exact values alone", () => {
    expect(round2(50)).toBe(50);
    expect(round2(0)).toBe(0);
    expect(round2(1030.69)).toBe(1030.69);
  });
});

describe("unitOopPrice — the Inventory column computes exactly what the mockup shows", () => {
  /* Josh, 2026-09-25: "how is he calculating oop in the mockup? add the same
     logic to our test". Every (cost → OOP) pair below is read off his mockup
     screenshots of the tracker — cost × 1.25 through JS rounding — so a drift
     in either the markup or the rounding fails against numbers a human saw. */
  it("matches every value in the screenshots, the float ties included", () => {
    const seen: Array<[number, number]> = [
      [37.65, 47.06], // Minimed 780G cartridges
      [143.85, 179.81], // Mio Advance 9mm 23" — 179.8125, the tie float breaks DOWN
      [30.95, 38.69], // Mobi cartridges
      [129.3, 161.63], // QuickSet 18"
      [3992.58, 4990.73], // t:slim pump
      [63.77, 79.71], // TruSteel
      [71.94, 89.93], // VariSoft / AutoSoft — 89.925, the tie a naive round loses
      [70.2, 87.75], // Contact 6 mm 23"
      [269.8, 337.25], // Dexcom G6 → G6 Receiver
      [57.32, 71.65], // Dexcom G7 sensors
      [234.28, 292.85], // G7 receiver
      [85.98, 107.48], // Dexcom G7 15-Day — 107.475 rounds UP
    ];
    for (const [cost, oop] of seen) expect(unitOopPrice(cost), `cost ${cost}`).toBe(oop);
  });

  it("a real 0 prices to 0 (the Inactive rows) and a missing cost to null, never $0", () => {
    expect(unitOopPrice(0)).toBe(0);
    expect(unitOopPrice(null)).toBeNull();
    expect(unitOopPrice(undefined)).toBeNull();
  });
});

describe("the constants are the ones Brandon specified", () => {
  it("25% markup, $10 floor, $10 shipping", () => {
    expect(CASH_PAY_MARKUP).toBe(1.25);
    expect(MIN_ORDER_MARKUP).toBe(10);
    expect(SHIPPING_HANDLING).toBe(10);
  });
});
