/**
 * An order's product lines, and which Cardinal SKU each one is.
 *
 * The New Order board says WHAT was ordered in product-label columns (CGM
 * Type, Insulin Pump Type, Infusion Set Type 1/2, Cartridge Type) with a
 * quantity beside each; the Cardinal SKU Tracker says what Cardinal can ship,
 * one row per SKU, grouped by family. The two are joined BY NAME, and that
 * join is verified rather than assumed — `skuJoin.test.ts` holds every live
 * label of both boards as read on 2026-09-15, and the tracker's own audit
 * (`stockApi.ts`) found the one spelling gap `stockKey` exists to close
 * (`Mio Advance Clear 9mm 23"` vs `9 mm`). Re-run that comparison before
 * trusting a new label.
 *
 * ⚠️ Receivers are the exception: the order board has no receiver column —
 * Qty: CGM Monitor is the quantity, and the CGM Type says which reader. The
 * tracker names its receiver rows as `<sensor(s)> → <receiver>`
 * ("Dexcom G7 / G7 15-Day → G7 Receiver"), so the left side is parsed as
 * aliases and matched as a SUFFIX of the sensor label: "FreeStyle Libre 3
 * Plus" ends with "Libre 3 Plus". Simplera Sync and Guardian 4 have no
 * receiver row (the 780G pump is the receiver) and correctly join to nothing.
 */
import { stockKey } from "../welcomeCall/infusionStock";
import { SKU_GROUPS, isRunLogRow, type SkuTrackerRow } from "./skuTrackerApi";
import { qty, type Order } from "./workflow";

export type ProductFamily = "cgmSensors" | "cgmReceivers" | "insulinPumps" | "cartridges" | "infusionSets";

export const FAMILY_LABEL: Record<ProductFamily, string> = {
  cgmSensors: "CGM sensors",
  cgmReceivers: "CGM receiver",
  insulinPumps: "Insulin pump",
  cartridges: "Cartridges",
  infusionSets: "Infusion sets",
};

export const FAMILY_GROUP: Record<ProductFamily, string> = {
  cgmSensors: SKU_GROUPS.cgmSensors,
  cgmReceivers: SKU_GROUPS.cgmReceivers,
  insulinPumps: SKU_GROUPS.insulinPumps,
  cartridges: SKU_GROUPS.cartridges,
  infusionSets: SKU_GROUPS.infusionSets,
};

/** The order the families read in — how the boards and the reps list them. */
export const FAMILY_ORDER: readonly ProductFamily[] = [
  "cgmSensors", "cgmReceivers", "insulinPumps", "cartridges", "infusionSets",
];

export interface OrderLine {
  family: ProductFamily;
  /** The order board's product label, e.g. `AutoSoft XC 6 mm 23"`. */
  product: string;
  quantity: number;
  /** The per-product auth id column, where the board has one. */
  authId: string;
}

type LineInput = Pick<
  Order,
  | "cgmType" | "qtySensors" | "qtyMonitor"
  | "pumpType" | "qtyPump"
  | "infusionSet1" | "qtyInfusionSet1" | "infusionSet2" | "qtyInfusionSet2"
  | "cartridgeType" | "qtyCartridge"
  | "monitorAuthId" | "sensorsAuthId" | "pumpAuthId" | "infusionSetAuthId" | "cartridgesAuthId"
>;

const served = (label: string) => {
  const l = (label ?? "").trim();
  return l && l.toLowerCase() !== "not serving" ? l : "";
};

/**
 * The lines an order carries — a product with a quantity above zero. A label
 * with a blank quantity is NOT a line: blank means "never set" on this board
 * (§5.22b), and the pre-check reports it, so inventing a quantity here would
 * put a product on screen that Cardinal was never asked for.
 */
export function orderLines(o: LineInput): OrderLine[] {
  const lines: OrderLine[] = [];
  const push = (family: ProductFamily, product: string, q: number | null, authId: string) => {
    if (!product || q === null || q <= 0) return;
    lines.push({ family, product, quantity: q, authId: (authId ?? "").trim() });
  };
  const cgm = served(o.cgmType);
  push("cgmSensors", cgm, qty(o.qtySensors), o.sensorsAuthId);
  // The receiver line is named by its sensor — that is all the board records.
  push("cgmReceivers", cgm, qty(o.qtyMonitor), o.monitorAuthId);
  push("insulinPumps", served(o.pumpType), qty(o.qtyPump), o.pumpAuthId);
  push("cartridges", served(o.cartridgeType), qty(o.qtyCartridge), o.cartridgesAuthId);
  push("infusionSets", served(o.infusionSet1), qty(o.qtyInfusionSet1), o.infusionSetAuthId);
  push("infusionSets", served(o.infusionSet2), qty(o.qtyInfusionSet2), o.infusionSetAuthId);
  return lines;
}

/** Tracker rows of one family, the run-log row never among them. */
export function rowsForFamily(rows: readonly SkuTrackerRow[], family: ProductFamily): SkuTrackerRow[] {
  return rows.filter((r) => !isRunLogRow(r) && r.groupId === FAMILY_GROUP[family]);
}

/** "Dexcom G7 / G7 15-Day → G7 Receiver" → ["dexcom g7", "g7 15 day"] (keyed). */
export function receiverAliases(rowName: string): string[] {
  const left = (rowName ?? "").split("→")[0] ?? "";
  return left
    .split("/")
    .map((s) => stockKey(s))
    .filter(Boolean);
}

/** The tracker row for a line, or null when the tracker has no row for it. */
export function skuRowForLine(line: Pick<OrderLine, "family" | "product">, rows: readonly SkuTrackerRow[]): SkuTrackerRow | null {
  const key = stockKey(line.product);
  if (!key) return null;
  const candidates = rowsForFamily(rows, line.family);
  if (line.family === "cgmReceivers") {
    return (
      candidates.find((r) => receiverAliases(r.name).some((alias) => key === alias || key.endsWith(" " + alias))) ??
      null
    );
  }
  return candidates.find((r) => stockKey(r.name) === key) ?? null;
}

/** The family a tracker row belongs to, or null for the run log. */
export function familyOfRow(row: Pick<SkuTrackerRow, "groupId">): ProductFamily | null {
  for (const f of FAMILY_ORDER) if (FAMILY_GROUP[f] === row.groupId) return f;
  return null;
}

/**
 * How many OPEN orders carry each SKU — the number beside a backordered row
 * that turns "AutoSoft 90 6 mm 23\" is backordered" into "…and four orders
 * waiting to ship are on it". Keyed by tracker row id.
 */
export function openOrdersBySku(
  openOrders: readonly LineInput[],
  rows: readonly SkuTrackerRow[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const o of openOrders) {
    const seen = new Set<string>();
    for (const line of orderLines(o)) {
      const row = skuRowForLine(line, rows);
      if (!row || seen.has(row.id)) continue;
      seen.add(row.id);
      counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
    }
  }
  return counts;
}
