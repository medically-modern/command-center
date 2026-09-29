import { describe, expect, it } from "vitest";
import { lineItemView, parseLineItemDetail, pendingStatusText, skuLabel } from "./lineItems";
import type { SkuTrackerRow } from "./skuTrackerApi";
import { SKU_GROUPS } from "./skuTrackerApi";

/* Every shape below was read off the live New Order Board on 2026-09-29;
   tracking numbers are made up. */

const PARTIAL = `ORDER STATUS 9/29/2026, 11:00:48 ET
L2 TN1002817I x3 BX @71.94 -> Backordered (BO: 3)
L1 TN1013310I x3 BX @30.95 -> SHIPPED
   SHIP FedEx 100000000001 qty 3 on 2026-09-15 from NEW JERSEY WAREHOUSE`;

const TWO_BOXES = `ORDER STATUS 9/29/2026, 11:03:03 ET
L1 TN1013310I x1 BX @30.95 -> SHIPPED
   SHIP FedEx 100000000001 qty 1 on 2026-09-24 from NEW JERSEY WAREHOUSE
L3 EDSTPAT013MEDIMA x9 BX @57.319995 -> SHIPPED
   SHIP FedEx 100000000001 qty 9 on 2026-09-24 from NEW JERSEY WAREHOUSE
L2 TN1002825I x1 BX @71.94 -> SHIPPED
   SHIP FedEx 100000000002 qty 1 on 2026-09-29 from OHIO WAREHOUSE 6335`;

const SUBSTITUTED = `ORDER STATUS 9/24/2026, 14:02:09 ET
L2 TN1002817I x3 BX @71.94 -> Backordered (BO: 3)
L1 TN1013310I x3 BX @30.95 -> SHIPPED
   SHIP FedEx 100000000001 qty 3 on 2026-09-15 from NEW JERSEY WAREHOUSE
L2 TN1002817I xnull BX @71.94 -> Deleted
SUBSTITUTED (dropped by Cardinal): TN1002817I

SUBSTITUTION ORDER 1120000001
L1 TN1001680I x3 BX @71.94 -> SHIPPED
   SHIP FedEx 100000000002 qty 3 on 2026-09-23 from NEW JERSEY WAREHOUSE`;

const DROPPED_NO_SUB = `ORDER STATUS 9/7/2026, 21:20:14 ET
L2 BBIBB4120IM x3 BX @70.2 -> Backordered (BO: 3)
L1 BBIBB2010IM x3 BX @31.36 -> SHIPPED
   SHIP FedEx 100000000001 qty 3 on 2026-08-04 from NEW JERSEY WAREHOUSE
L3 BBIBB3010IM x3 BX @1.1 -> SHIPPED
   SHIP FedEx 100000000001 qty 3 on 2026-08-04 from NEW JERSEY WAREHOUSE
L2 BBIBB4120IM xnull BX @70.2 -> Deleted
SUBSTITUTED (dropped by Cardinal): BBIBB4120IM`;

const SPLIT_LINE_ECHO = `ORDER STATUS 9/28/2026, 22:40:15 ET
L1 TN1013310I x3 BX @30.95 -> SHIPPED
   SHIP FedEx 100000000001 qty 3 on 2026-08-18 from NEW JERSEY WAREHOUSE
L2 TN1002825I x2 BX @71.94 -> Accepted
   SHIP FedEx 100000000002 qty 1 on 2026-08-19 from OHIO WAREHOUSE 6335
L2 TN1002825I x1 BX @71.94 -> SHIPPED
   SHIP FedEx 100000000002 qty 1 on 2026-08-19 from OHIO WAREHOUSE 6335`;

const PLACEHOLDERS = `ORDER STATUS 9/27/2026, 12:01:06 ET
L1 9999 xnull EA @0 -> Deleted
L2 EDSTKAT013MEDIM x1 EA @234.2801 -> SHIPPED
   SHIP FedEx 100000000001 qty 1 on 2026-09-23 from NEW JERSEY WAREHOUSE
L3 00MMWELCOME xnull EA @0 -> SHIPPED`;

const ROWS = [
  { id: "1", name: "t:slim", groupId: SKU_GROUPS.cartridges, sku: "TN1013310I" },
  { id: "2", name: 'AutoSoft 90 6 mm 23"', groupId: SKU_GROUPS.infusionSets, sku: "TN1002817I" },
  { id: "3", name: "Dexcom G7 / G7 15-Day → G7 Receiver", groupId: SKU_GROUPS.cgmReceivers, sku: "EDSTKAT013MEDIM" },
  { id: "4", name: "Last run: 2026-09-29", groupId: SKU_GROUPS.runLog, sku: "" },
] as unknown as SkuTrackerRow[];

describe("parseLineItemDetail", () => {
  it("reads the stamp, the lines, BO counts and SHIP records", () => {
    const p = parseLineItemDetail(PARTIAL);
    expect(p.stamp).toBe("9/29/2026, 11:00:48 ET");
    const [bo, shipped] = p.sections[0].entries;
    expect(bo).toMatchObject({ lineNum: 2, sku: "TN1002817I", qty: 3, status: "Backordered", backordered: 3, ships: [] });
    expect(shipped.ships).toEqual([
      { carrier: "FedEx", track: "100000000001", qty: 3, date: "2026-09-15", warehouse: "NEW JERSEY WAREHOUSE" },
    ]);
  });

  it("reads a substitution order as its own section, and the dropped SKUs", () => {
    const p = parseLineItemDetail(SUBSTITUTED);
    expect(p.dropped).toEqual(["TN1002817I"]);
    expect(p.sections.map((s) => [s.kind, s.cahNumber, s.entries.length])).toEqual([
      ["order", "", 3],
      ["substitution", "1120000001", 1],
    ]);
  });

  it("a USPS number is a tracking number too", () => {
    const p = parseLineItemDetail("L1 TN1013310I x3 BX @30.95 -> SHIPPED\n   SHIP USPS 9205590000000000000000 qty 3 on 2026-08-18 from NEW JERSEY WAREHOUSE");
    expect(p.sections[0].entries[0].ships[0]).toMatchObject({ carrier: "USPS", track: "9205590000000000000000" });
  });
});

describe("lineItemView", () => {
  it("the reported shape: one parcel with the cartridges, the infusion sets still backordered", () => {
    const v = lineItemView(PARTIAL, ["100000000001"])!;
    expect(v.boxes).toEqual([
      { track: "100000000001", carrier: "FedEx", date: "2026-09-15", items: [{ sku: "TN1013310I", qty: 3, substitute: false }] },
    ]);
    expect(v.pending).toEqual([{ sku: "TN1002817I", qty: 3, status: "Backordered", dropped: false }]);
    expect(v.unlisted).toEqual([]);
  });

  it("two parcels each carry their own items, in the board's tracking order", () => {
    const v = lineItemView(TWO_BOXES, ["100000000001", "100000000002"])!;
    expect(v.boxes.map((b) => [b.track, b.items.map((i) => `${i.sku}×${i.qty}`)])).toEqual([
      ["100000000001", ["TN1013310I×1", "EDSTPAT013MEDIMA×9"]],
      ["100000000002", ["TN1002825I×1"]],
    ]);
    expect(v.pending).toEqual([]);
  });

  it("a substitution's parcel is marked, and the dropped line is not still to come", () => {
    const v = lineItemView(SUBSTITUTED, ["100000000001", "100000000002"])!;
    expect(v.boxes[1].items).toEqual([{ sku: "TN1001680I", qty: 3, substitute: true }]);
    expect(v.pending).toEqual([]);
    expect(v.replaced).toBe("TN1002817I");
  });

  it("⚠️ a dropped line with NO substitution yet is still owed to the patient", () => {
    const v = lineItemView(DROPPED_NO_SUB, ["100000000001"])!;
    expect(v.pending).toEqual([{ sku: "BBIBB4120IM", qty: 3, status: "Dropped by Cardinal", dropped: true }]);
    expect(v.boxes[0].items.map((i) => i.sku)).toEqual(["BBIBB2010IM", "BBIBB3010IM"]);
  });

  it("⚠️ a SHIP record echoed under both halves of a split line counts ONCE", () => {
    const v = lineItemView(SPLIT_LINE_ECHO, ["100000000001", "100000000002"])!;
    expect(v.boxes[1].items).toEqual([{ sku: "TN1002825I", qty: 1, substitute: false }]);
    expect(v.pending).toEqual([{ sku: "TN1002825I", qty: 1, status: "Accepted", dropped: false }]);
  });

  it("the 9999 hold line and the welcome insert are not products", () => {
    const v = lineItemView(PLACEHOLDERS, ["100000000001"])!;
    expect(v.boxes[0].items.map((i) => i.sku)).toEqual(["EDSTKAT013MEDIM"]);
    expect(v.pending).toEqual([]);
    expect(v.unboxed).toEqual([]);
  });

  it("⚠️ a board tracking number the text does not list is UNLISTED, never guessed", () => {
    const v = lineItemView(PARTIAL, ["100000000001", "100000000009"])!;
    expect(v.boxes.map((b) => b.track)).toEqual(["100000000001"]);
    expect(v.unlisted).toEqual(["100000000009"]);
  });

  it("an empty or unpolled column is null — the card draws what it always drew", () => {
    expect(lineItemView("", [])).toBeNull();
    expect(lineItemView("ORDER STATUS 9/7/2026, 21:20:14 ET\nL1 9999 xnull EA @0 -> Deleted", [])).toBeNull();
  });
});

describe("skuLabel", () => {
  it("names a SKU by the tracker, the receiver by its right-hand side", () => {
    expect(skuLabel("TN1013310I", ROWS)).toEqual({ product: "t:slim", family: "cartridges", familyLabel: "Cartridges" });
    expect(skuLabel("EDSTKAT013MEDIM", ROWS)).toMatchObject({ product: "G7 Receiver", family: "cgmReceivers" });
  });
  it("an unknown SKU (or no tracker yet) is the code, verbatim", () => {
    expect(skuLabel("ZZ123", ROWS)).toEqual({ product: "ZZ123", family: null, familyLabel: "Cardinal SKU" });
    expect(skuLabel("TN1013310I", null).product).toBe("TN1013310I");
  });
});

describe("pendingStatusText", () => {
  it("says backordered, not-shipped-yet, or dropped", () => {
    expect(pendingStatusText({ status: "Backordered", dropped: false })).toBe("Backordered");
    expect(pendingStatusText({ status: "Accepted", dropped: false })).toBe("Not shipped yet");
    expect(pendingStatusText({ status: "Dropped by Cardinal", dropped: true })).toBe("Dropped by Cardinal");
  });
});
