import { describe, it, expect } from "vitest";
import { SKU_GROUPS, type SkuTrackerRow } from "./skuTrackerApi";
import { orderLines, skuRowForLine, receiverAliases, openOrdersBySku, familyOfRow } from "./skuJoin";
import { mkOrder } from "./fixtures";

/**
 * The join is BY NAME across two boards, so the fixtures are the LIVE names
 * of both as read on 2026-09-15 — the order board's product labels and the
 * tracker's row names. A label added to either board is a real thing to
 * re-check here; a silent miss reads as "not on the SKU tracker".
 */
const TRACKER_NAMES: Record<string, string[]> = {
  [SKU_GROUPS.infusionSets]: [
    'AutoSoft 90 6 mm 23"', 'AutoSoft 90 6 mm 43"', 'AutoSoft 90 9 mm 23"', 'AutoSoft 90 9 mm 43"',
    'AutoSoft XC 6 mm 5"', 'AutoSoft XC 6 mm 23"', 'AutoSoft XC 6 mm 32"', 'AutoSoft XC 6 mm 43"',
    'AutoSoft XC 9 mm 23"', 'AutoSoft XC 9 mm 43"', 'AutoSoft 30 13 mm 23"', 'AutoSoft 30 13 mm 43"',
    'TruSteel 6 mm 23"', 'TruSteel 6 mm 32"', 'TruSteel 8 mm 23"', 'TruSteel 8 mm 32"',
    'VariSoft 13 mm 23"', 'VariSoft 13 mm 32"', 'VariSoft 17 mm 23"', 'Contact 6 mm 23"',
    'Inset 6 mm 23"', 'Mio Advance Clear 9mm 23"', 'Inset 6 mm 32"', 'QuickSet 18"',
  ],
  [SKU_GROUPS.insulinPumps]: ["Mobi", "iLet", "t:slim", "Minimed 780G"],
  [SKU_GROUPS.cartridges]: ["Mobi", "iLet", "t:slim", "Minimed 780G"],
  [SKU_GROUPS.cgmSensors]: [
    "FreeStyle Libre 3 Plus", "Dexcom G7", "Dexcom G7 15-Day", "FreeStyle Libre 2 Plus", "Dexcom G6",
    "FreeStyle Libre 14-Day", "Simplera Sync", "Guardian 4",
  ],
  [SKU_GROUPS.cgmReceivers]: [
    "Dexcom G7 / G7 15-Day → G7 Receiver", "Dexcom G6 → G6 Receiver", "Libre 3 Plus → Libre 3 Reader",
    "Libre 2 Plus → Libre 2 Reader", "Libre 14-Day → 14-Day Reader",
  ],
  [SKU_GROUPS.runLog]: ["Last run: 2026-09-15 09:05 ET (cron) — 31 changed"],
};

/** The order board's Infusion Set Type 1 labels (minus Not Serving). */
const ORDER_SET_LABELS = [
  'AutoSoft 90 6 mm 23"', 'AutoSoft 90 6 mm 43"', 'AutoSoft 90 9 mm 23"', 'AutoSoft 90 9 mm 43"',
  'AutoSoft XC 6 mm 5"', 'AutoSoft XC 6 mm 23"', 'AutoSoft XC 6 mm 32"', 'AutoSoft XC 6 mm 43"',
  'AutoSoft XC 9 mm 23"', 'AutoSoft 30 13 mm 43"', 'TruSteel 6 mm 23"', 'AutoSoft 30 13 mm 23"',
  'QuickSet 18"', 'VariSoft 13 mm 23"', 'VariSoft 13 mm 32"', 'VariSoft 17 mm 23"', 'Inset 6 mm 23"',
  'TruSteel 8 mm 32"', 'Contact 6 mm 23"', 'TruSteel 6 mm 32"', 'TruSteel 8 mm 23"',
  'Mio Advance Clear 9 mm 23"', 'AutoSoft XC 9 mm 43"',
];
/** The order board's CGM Type labels (minus Not Serving), duplicate casing included. */
const ORDER_CGM_LABELS = [
  "FreeStyle Libre 3 Plus", "Dexcom G7", "Dexcom G7 15-Day", "FreeStyle Libre 2 Plus", "Dexcom G6",
  "FreeStyle Libre 14-Day", "Freestyle Libre 2 Plus", "Simplera Sync", "Guardian 4",
];
const ORDER_PUMP_LABELS = ["Mobi", "iLet", "t:slim", "Minimed 780G"];

let n = 0;
const rows: SkuTrackerRow[] = Object.entries(TRACKER_NAMES).flatMap(([groupId, names]) =>
  names.map((name) => ({
    id: String(++n), name, groupId, sku: `SKU${n}`, description: "", uom: "BX", unitCost: 1, qtyAvail: 100,
    status: "Available", lastChanged: "2026-09-15 09:05 ET", oopPrice: null, notes: "", productUrl: "", runHistory: "",
  })),
);

describe("every live order-board label joins to a tracker row", () => {
  it("infusion sets — including the one spelling gap (9 mm vs 9mm)", () => {
    for (const label of ORDER_SET_LABELS) {
      const row = skuRowForLine({ family: "infusionSets", product: label }, rows);
      expect(row, label).not.toBeNull();
    }
    expect(skuRowForLine({ family: "infusionSets", product: 'Mio Advance Clear 9 mm 23"' }, rows)?.name).toBe('Mio Advance Clear 9mm 23"');
  });

  it("CGM sensors, case-folded", () => {
    for (const label of ORDER_CGM_LABELS) {
      expect(skuRowForLine({ family: "cgmSensors", product: label }, rows), label).not.toBeNull();
    }
  });

  it("pumps and cartridges are the same four names on both boards", () => {
    for (const label of ORDER_PUMP_LABELS) {
      expect(skuRowForLine({ family: "insulinPumps", product: label }, rows)?.groupId).toBe(SKU_GROUPS.insulinPumps);
      expect(skuRowForLine({ family: "cartridges", product: label }, rows)?.groupId).toBe(SKU_GROUPS.cartridges);
    }
  });

  it("never crosses families — a pump named like a cartridge is not a cartridge", () => {
    expect(skuRowForLine({ family: "insulinPumps", product: "t:slim" }, rows)?.groupId).toBe(SKU_GROUPS.insulinPumps);
  });
});

describe("receivers are named by their sensor", () => {
  it("parses the aliases on the left of the arrow", () => {
    expect(receiverAliases("Dexcom G7 / G7 15-Day → G7 Receiver")).toEqual(["dexcom g7", "g7 15 day"]);
    expect(receiverAliases("Libre 3 Plus → Libre 3 Reader")).toEqual(["libre 3 plus"]);
  });

  it("matches the sensor label as a suffix — the FreeStyle prefix is not on the tracker", () => {
    const rec = (product: string) => skuRowForLine({ family: "cgmReceivers", product }, rows)?.name ?? null;
    expect(rec("FreeStyle Libre 3 Plus")).toBe("Libre 3 Plus → Libre 3 Reader");
    expect(rec("FreeStyle Libre 2 Plus")).toBe("Libre 2 Plus → Libre 2 Reader");
    expect(rec("Freestyle Libre 2 Plus")).toBe("Libre 2 Plus → Libre 2 Reader");
    expect(rec("FreeStyle Libre 14-Day")).toBe("Libre 14-Day → 14-Day Reader");
    expect(rec("Dexcom G7")).toBe("Dexcom G7 / G7 15-Day → G7 Receiver");
    expect(rec("Dexcom G7 15-Day")).toBe("Dexcom G7 / G7 15-Day → G7 Receiver");
    expect(rec("Dexcom G6")).toBe("Dexcom G6 → G6 Receiver");
  });

  it("a sensor whose receiver is the pump joins to nothing, and says so", () => {
    expect(skuRowForLine({ family: "cgmReceivers", product: "Simplera Sync" }, rows)).toBeNull();
    expect(skuRowForLine({ family: "cgmReceivers", product: "Guardian 4" }, rows)).toBeNull();
  });

  it("the G6 receiver never answers for a G7 sensor", () => {
    expect(skuRowForLine({ family: "cgmReceivers", product: "Dexcom G7" }, rows)?.name).not.toMatch(/G6/);
  });
});

describe("orderLines", () => {
  it("a product with a quantity above zero is a line; a blank quantity is not", () => {
    const o = mkOrder({
      cgmType: "Dexcom G7", qtySensors: "9", qtyMonitor: "1",
      pumpType: "t:slim", qtyPump: "", cartridgeType: "t:slim", qtyCartridge: "3",
      infusionSet1: 'AutoSoft XC 6 mm 23"', qtyInfusionSet1: "3", infusionSet2: "Not Serving", qtyInfusionSet2: "0",
      sensorsAuthId: "S1", monitorAuthId: "M1",
    });
    const lines = orderLines(o);
    expect(lines.map((l) => `${l.family}:${l.product}:${l.quantity}`)).toEqual([
      "cgmSensors:Dexcom G7:9", "cgmReceivers:Dexcom G7:1", "cartridges:t:slim:3", 'infusionSets:AutoSoft XC 6 mm 23":3',
    ]);
    expect(lines[0].authId).toBe("S1");
    expect(lines[1].authId).toBe("M1");
  });

  it("Not Serving is not a product", () => {
    expect(orderLines(mkOrder({ cgmType: "Not Serving", qtySensors: "9" }))).toEqual([]);
  });
});

describe("openOrdersBySku", () => {
  it("counts each order once per SKU", () => {
    const a = mkOrder({ id: "a", infusionSet1: 'TruSteel 6 mm 23"', qtyInfusionSet1: "3", infusionSet2: 'TruSteel 6 mm 23"', qtyInfusionSet2: "1" });
    const b = mkOrder({ id: "b", infusionSet1: 'TruSteel 6 mm 23"', qtyInfusionSet1: "3", cgmType: "Dexcom G7", qtySensors: "9" });
    const counts = openOrdersBySku([a, b], rows);
    const truSteel = rows.find((r) => r.name === 'TruSteel 6 mm 23"')!;
    const g7 = rows.find((r) => r.name === "Dexcom G7" && r.groupId === SKU_GROUPS.cgmSensors)!;
    expect(counts.get(truSteel.id)).toBe(2);
    expect(counts.get(g7.id)).toBe(1);
  });
});

describe("familyOfRow", () => {
  it("the run log row belongs to no family", () => {
    expect(familyOfRow(rows.find((r) => r.groupId === SKU_GROUPS.runLog)!)).toBeNull();
    expect(familyOfRow(rows[0])).toBe("infusionSets");
  });
});
