import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COL, LIST_COLUMN_IDS, DETAIL_COLUMN_IDS, type MondayItem } from "./mondayApi";
import { mondayItemToOrder } from "./mondayMapping";

/**
 * The order list is read in two tiers (§5.25): the sidebar, the overview and
 * the stock view's open-order counts render from LIST_COLUMN_IDS; the open
 * order gets DETAIL_COLUMN_IDS. A field read off a list row but missing from
 * the slim set does NOT error — it reads "" on every row for ever. This test
 * fails instead (the `listColumns.test.ts` convention).
 */

/** Order field → the column(s) that carry it. This IS the contract. */
const SLIM_FIELD_COLUMNS: Record<string, string[]> = {
  orderStatus: [COL.orderStatus],
  orderStatusIndex: [COL.orderStatus],
  apiStatus: [COL.apiStatus],
  orderDate: [COL.orderDate],
  orderType: [COL.orderType],
  subscriptionType: [COL.subscriptionType],
  shipMethod: [COL.shipMethod],
  preCheck: [COL.preCheck],
  phone: [COL.phone],
  cahOrderNumber: [COL.cahOrderNumber],
  poNumber: [COL.poNumber],
  holdReason: [COL.holdReason],
  apiMessage: [COL.apiMessage],
  backordered: [COL.backordered],
  inactiveProducts: [COL.inactiveProducts],
  substitutionStatus: [COL.substitutionStatus],
  estimatedShipDate: [COL.estimatedShipDate],
  shipDate: [COL.shipDate],
  deliveryDate: [COL.deliveryDate],
  carrier: [COL.carrier],
  tracking: [COL.tracking1, COL.tracking2, COL.tracking3, COL.tracking4, COL.tracking5],
  cgmType: [COL.cgmType],
  qtySensors: [COL.qtySensors],
  qtyMonitor: [COL.qtyMonitor],
  pumpType: [COL.pumpType],
  qtyPump: [COL.qtyPump],
  infusionSet1: [COL.infusionSet1],
  qtyInfusionSet1: [COL.qtyInfusionSet1],
  infusionSet2: [COL.infusionSet2],
  qtyInfusionSet2: [COL.qtyInfusionSet2],
  cartridgeType: [COL.cartridgeType],
  qtyCartridge: [COL.qtyCartridge],
};

/** Not columns — present on every record. */
const ALWAYS_AVAILABLE = new Set(["id", "name", "groupId", "groupTitle", "partial", "createdAt", "updatedAt"]);

/**
 * Read by list-side code but harmless as "" there: `orderLines` carries the
 * per-product auth ids, which only the OPEN order's lines table displays.
 * Nothing on a row, in the overview or in a count reads them.
 */
const BLANK_ON_LIST_IS_FINE = new Set([
  "monitorAuthId", "sensorsAuthId", "pumpAuthId", "infusionSetAuthId", "cartridgesAuthId",
]);

/** Source files whose `o.<field>` / `order.<field>` reads run against LIST rows. */
const ROW_SOURCES = [
  "src/lib/orders/sidebarList.ts",
  "src/lib/orders/workflow.ts",
  "src/lib/orders/skuJoin.ts",
  "src/lib/orders/rowSummary.ts",
  "src/components/orders/OrdersSidebar.tsx",
  "src/components/orders/OrdersOverview.tsx",
  "src/components/orders/SkuTrackerView.tsx",
];

function fieldsReadIn(relPath: string): string[] {
  const src = readFileSync(resolve(process.cwd(), relPath), "utf8");
  const hits = src.match(/\b(?:o|order)\.[a-zA-Z_][a-zA-Z0-9_]*/g) ?? [];
  return [...new Set(hits.map((h) => h.slice(h.indexOf(".") + 1)))];
}

describe("LIST_COLUMN_IDS covers what the list-side code reads", () => {
  for (const file of ROW_SOURCES) {
    it(`${file} reads nothing the slim fetch omits`, () => {
      const missing = fieldsReadIn(file).filter(
        (f) => !ALWAYS_AVAILABLE.has(f) && !BLANK_ON_LIST_IS_FINE.has(f) && !(f in SLIM_FIELD_COLUMNS),
      );
      expect(
        missing,
        `Fields read against list rows but not in LIST_COLUMN_IDS — they read "" on every ` +
          `row with no error. Add the column to LIST_COLUMN_IDS and to SLIM_FIELD_COLUMNS: ${missing.join(", ")}`,
      ).toEqual([]);
    });
  }

  it("every contracted column is actually in LIST_COLUMN_IDS", () => {
    const declared = new Set(LIST_COLUMN_IDS);
    const missing = Object.entries(SLIM_FIELD_COLUMNS)
      .flatMap(([f, cols]) => cols.filter((c) => !declared.has(c)).map((c) => `${f} → ${c}`));
    expect(missing).toEqual([]);
  });

  it("the slim set is a subset of the detail set, and neither repeats a column", () => {
    const detail = new Set(DETAIL_COLUMN_IDS);
    expect(LIST_COLUMN_IDS.filter((c) => !detail.has(c))).toEqual([]);
    expect(new Set(LIST_COLUMN_IDS).size).toBe(LIST_COLUMN_IDS.length);
    expect(new Set(DETAIL_COLUMN_IDS).size).toBe(DETAIL_COLUMN_IDS.length);
  });

  it("every COL id is a distinct Monday column id", () => {
    const ids = Object.values(COL);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("mondayItemToOrder", () => {
  const item: MondayItem = {
    id: "42",
    name: "Test Patient",
    group: { id: "group_mm52gfr5" },
    created_at: "2026-09-10T00:00:00Z",
    column_values: [
      { id: COL.orderStatus, text: "Process Claim", value: JSON.stringify({ index: 4 }) },
      { id: COL.apiStatus, text: "Warning", value: null },
      { id: COL.phone, text: "5555550100", value: JSON.stringify({ phone: "5555550100", countryShortName: "US" }) },
      { id: COL.address, text: "1 Main St, Town, NY 10001", value: JSON.stringify({ address: "1 Main St, Town, NY 10001", lat: "0", lng: "0" }) },
      { id: COL.tracking1, text: "1Z1", value: null },
      { id: COL.tracking3, text: "1Z3", value: null },
      { id: COL.qtyInfusionSet1, text: "3", value: null },
    ],
  };

  it("maps status text + index, phone/location JSON, and the tracking columns in order with blanks dropped", () => {
    const o = mondayItemToOrder(item, { partial: true });
    expect(o.orderStatus).toBe("Process Claim");
    expect(o.orderStatusIndex).toBe(4);
    expect(o.phone).toBe("5555550100");
    expect(o.address).toBe("1 Main St, Town, NY 10001");
    expect(o.tracking).toEqual(["1Z1", "1Z3"]);
    expect(o.groupTitle).toBe("Accepted / Partial");
    expect(o.partial).toBe(true);
    expect(o.files).toEqual({});
  });

  it("a full read is not stamped partial", () => {
    expect(mondayItemToOrder(item).partial).toBeUndefined();
  });

  it("resolves file columns through the item's assets", () => {
    const withFiles: MondayItem = {
      ...item,
      column_values: [
        ...item.column_values,
        { id: COL.podPdf, text: "pod.pdf", value: JSON.stringify({ files: [{ name: "pod.pdf", assetId: 777 }] }) },
      ],
      assets: [{ id: "777", name: "pod.pdf", url: "https://files.example/protected", public_url: "https://files.example/public" }],
    };
    const o = mondayItemToOrder(withFiles);
    expect(o.files[COL.podPdf]).toEqual([{ assetId: "777", name: "pod.pdf", url: "https://files.example/public" }]);
  });
});
