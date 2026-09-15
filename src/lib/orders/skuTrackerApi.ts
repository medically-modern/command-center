/**
 * Cardinal SKU Tracker — the FULL board, for the Orders page.
 *
 * `lib/welcomeCall/stockApi.ts` reads the same board (`18420366344`) for three
 * columns and hands `infusionStock.ts` a name-keyed index; that stays as it is.
 * This role wants the whole row — SKU, family, cost, the link — for its stock
 * table and for joining an order's lines to what Cardinal can ship
 * (`skuJoin.ts`). Same incident guards as that read (§5.31b), one 46-row board,
 * refreshed on a 30-minute TTL against a scraper that runs once a day.
 *
 * ⚠️ The `Run Log` group holds ONE row whose NAME is the last run
 * ("Last run: 2026-09-15 09:05 ET (cron) — 31 changed") and whose Run History
 * is the trailing log; it is not a SKU and `isRunLogRow` keeps it out of every
 * product list.
 */
import { MONDAY_API_URL, hasMondayAuth, mondayAuthHeaders, mondayIdentityHeaders } from "../shared/mondayEndpoint";
import type { StockRow } from "../welcomeCall/infusionStock";

export const SKU_BOARD_ID = 18420366344;
export const SKU_BOARD_URL = `https://medicallymodern-force.monday.com/boards/${SKU_BOARD_ID}`;

export const SKU_GROUPS = {
  runLog: "group_mm4w9gaw",
  infusionSets: "group_mm4wcen0",
  insulinPumps: "group_mm4w6y9c",
  cartridges: "group_mm4wjbg3",
  cgmSensors: "group_mm4w1fs9",
  cgmReceivers: "group_mm4wgha",
} as const;

export const SKU_COL = {
  sku: "text_mm4wgzdw",
  productPage: "link_mm4wz81e",
  description: "text_mm4wazkc",
  uom: "text_mm4wtf4y",
  unitCost: "numeric_mm4wd6b",
  qtyAvail: "numeric_mm4w1yk8",
  status: "color_mm4wr14r",
  lastChanged: "text_mm4wkpy5",
  oopPrice: "numeric_mm5bs4hd",
  notes: "text_mm4w76xk",
  runHistory: "long_text_mm4wcfmh",
} as const;

/** A tracker row. Structurally a `StockRow`, so `infusionStock`'s
 *  `indexStock`/`stockVerdict` accept it unchanged. */
export interface SkuTrackerRow extends StockRow {
  id: string;
  groupId: string;
  sku: string;
  description: string;
  uom: string;
  unitCost: number | null;
  oopPrice: number | null;
  notes: string;
  /** The Cardinal product page URL, or "" */
  productUrl: string;
  /** Run Log rows only. */
  runHistory: string;
}

export function isRunLogRow(row: Pick<SkuTrackerRow, "groupId">): boolean {
  return row.groupId === SKU_GROUPS.runLog;
}

interface RawItem {
  id: string;
  name: string;
  group: { id: string };
  column_values: { id: string; text: string | null; value: string | null }[];
}

/** Well clear of the 46 rows the board holds; a truncated read would silently
 *  drop real SKUs into "no stock data". */
const LIMIT = 200;

function num(raw: string): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Every tracker row. THROWS on a Monday error or when there is no Monday auth
 * — "we could not ask" must never become an empty table that reads as "nothing
 * is tracked" (the `stockApi.ts` rule, verbatim).
 */
export async function fetchSkuTracker(signal?: AbortSignal): Promise<SkuTrackerRow[]> {
  if (!hasMondayAuth()) throw new Error("Monday auth unavailable — cannot read the Cardinal SKU Tracker");
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "API-Version": "2024-10",
      ...mondayAuthHeaders(),
      ...mondayIdentityHeaders(),
    },
    body: JSON.stringify({
      query: `query ($boardId: ID!, $cols: [String!]) {
        boards(ids: [$boardId]) {
          items_page(limit: ${LIMIT}) {
            items { id name group { id } column_values(ids: $cols) { id text value } }
          }
        }
      }`,
      variables: { boardId: String(SKU_BOARD_ID), cols: Object.values(SKU_COL) },
    }),
    signal,
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  }
  const items: RawItem[] = json.data?.boards?.[0]?.items_page?.items ?? [];
  return items.map((it) => {
    const byId = new Map(it.column_values.map((c) => [c.id, c]));
    const txt = (id: string) => byId.get(id)?.text ?? "";
    let productUrl = "";
    try {
      const v = byId.get(SKU_COL.productPage)?.value;
      if (v) productUrl = (JSON.parse(v) as { url?: string }).url ?? "";
    } catch {
      productUrl = "";
    }
    return {
      id: it.id,
      name: it.name,
      groupId: it.group?.id ?? "",
      sku: txt(SKU_COL.sku).trim(),
      description: txt(SKU_COL.description).trim(),
      uom: txt(SKU_COL.uom).trim(),
      unitCost: num(txt(SKU_COL.unitCost)),
      // ⚠️ Blank/unparseable is NULL, never 0 — `stockVerdict` reads 0 as red
      // "Out of stock", and the run-log row's blank would invent a shortage.
      qtyAvail: num(txt(SKU_COL.qtyAvail)),
      status: txt(SKU_COL.status),
      lastChanged: txt(SKU_COL.lastChanged),
      oopPrice: num(txt(SKU_COL.oopPrice)),
      notes: txt(SKU_COL.notes).trim(),
      productUrl,
      runHistory: txt(SKU_COL.runHistory),
    };
  });
}
