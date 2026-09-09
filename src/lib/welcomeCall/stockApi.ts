/**
 * Cardinal SKU Tracker read — the feed behind `infusionStock.ts`.
 *
 * Its own board (`18420366344`, 46 rows), scraped daily by a cron that stamps
 * `Last Changed`; the pure verdict rules live in `infusionStock.ts` and are
 * tested without a network. This file is only the fetch, so the two can't drag
 * each other's concerns around — the same split as `callRules` beside
 * `inboundCalls`.
 *
 * ⚠️ **The join is by NAME, and it is verified, not assumed.** Audited against
 * the live boards 2026-09-09: 24 of the Welcome Call Infusion Set column's 25
 * labels have a tracker row, and the one mismatch is a spacing difference
 * (`Mio Advance Clear 9mm 23"` here vs `9 mm` there) which `stockKey`
 * normalises — that case is exactly why it exists. `Luer 6 mm 32"` has no row
 * at all and correctly reads "No stock data" rather than green. Re-run that
 * comparison before trusting a new label.
 */
import { MONDAY_API_URL, mondayIdentityHeaders, hasMondayAuth } from "@/lib/shared/mondayEndpoint";
import type { StockRow } from "./infusionStock";

export const STOCK_BOARD_ID = 18420366344;

export const STOCK_COL = {
  qtyAvail: "numeric_mm4w1yk8",
  status: "color_mm4wr14r",
  lastChanged: "text_mm4wkpy5",
} as const;

interface MondayItem {
  name: string;
  column_values: { id: string; text: string | null }[];
}

/** The board holds 46 rows and is not expected to grow much; one page covers
 *  it. A truncated read would silently downgrade real sets to "No stock data",
 *  so the limit is deliberately well clear of the real count. */
const LIMIT = 200;

/**
 * Every tracker row. Throws on a Monday error so the caller can keep showing
 * nothing rather than caching an empty index as an answer — an empty index
 * reads as "no stock data" on EVERY set, which looks like a working feature
 * reporting bad news.
 */
export async function fetchInfusionStock(): Promise<StockRow[]> {
  // ⚠️ `hasMondayAuth()`, never a bundled-token check: in production the SPA
  // runs through the gateway with VITE_MONDAY_API_TOKEN absent (§5.1), so a
  // `!!getToken()` gate is false in exactly the deployment that matters.
  //
  // ⚠️ THROWS rather than returning [] — "we cannot ask" is not "we asked and
  // the board is empty". An empty array indexes to a non-null EMPTY map, and
  // `stockVerdict` answers "No stock data" for every set off one of those: a
  // build with no Monday auth would render a confident negative on every
  // infusion set instead of hiding the feature. That is the exact failure
  // `useInfusionStock`'s own header warns about, and this early return walked
  // straight into it (Greptile, PR #55). Throwing leaves the hook's index null,
  // which is what makes the pills silent.
  if (!hasMondayAuth()) {
    throw new Error("Monday auth unavailable — cannot read the Cardinal SKU Tracker");
  }

  const query = `
    query ($boardId: ID!, $cols: [String!]) {
      boards(ids: [$boardId]) {
        items_page(limit: ${LIMIT}) {
          items { name column_values(ids: $cols) { id text } }
        }
      }
    }
  `;
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...mondayIdentityHeaders() },
    body: JSON.stringify({
      query,
      variables: { boardId: STOCK_BOARD_ID, cols: Object.values(STOCK_COL) },
    }),
  });
  const json = await res.json();
  // A 200 carrying `errors[]` is this app's most common silent failure (§5.2).
  if (json.errors) {
    throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  }

  const items: MondayItem[] = json.data?.boards?.[0]?.items_page?.items ?? [];
  return items.map((it) => {
    const col = (id: string) => it.column_values.find((c) => c.id === id)?.text ?? "";
    const raw = col(STOCK_COL.qtyAvail).trim();
    const n = Number(raw);
    return {
      name: it.name,
      // ⚠️ A blank or unparseable quantity is NULL, not 0. `stockVerdict` reads
      // 0 as "out of stock, red"; the tracker's own header row carries a blank
      // here, and so would any row the scraper hasn't filled. Null lets the
      // status column decide instead of inventing a shortage.
      qtyAvail: raw === "" || !Number.isFinite(n) ? null : n,
      status: col(STOCK_COL.status),
      lastChanged: col(STOCK_COL.lastChanged),
    };
  });
}
