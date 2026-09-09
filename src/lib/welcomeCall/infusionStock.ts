/**
 * lib/welcomeCall/infusionStock.ts — "can we actually ship this set?"
 *
 * ── WHY (Brandon, 2026-09-09) ──
 * *"Bring in SKU counts like their mockup has with the pills. Define low stock
 * as anything below 20."* The source is the **Cardinal SKU Tracker** board
 * (`18420366344`), scraped daily — `Qty Avail`, `PROD Status` and a
 * `Last Changed` stamp per SKU.
 *
 * ⚠️ **The ops mockup's pills are PLACEHOLDER data.** Its own caption says so:
 * *"Compatibility and stock come from the infusion-set inventory board.
 * Placeholder data until the board id and column ids are wired in."* So there is
 * no prototype behaviour to copy here — this module is the first real wiring,
 * and the rule below was decided from the live board rather than from the mock.
 *
 * ⚠️ **STATUS DECIDES, QUANTITY ONLY EXPLAINS.** A count-only rule ("low if
 * under 20") reads the live board exactly backwards on its most dangerous rows.
 * Measured 2026-09-09:
 *
 *   AutoSoft 90 6 mm 23"   Qty 220  Backordered  ← green under a count rule
 *   AutoSoft XC 6 mm 32"   Qty   3  Backordered
 *   AutoSoft 90 9 mm 23"   Qty   0  Inactive
 *   Contact 6 mm 23"       Qty   1  Backordered  ← 1 of only 2 iLet sets
 *
 * A rep picking the first of those would see a healthy green pill on a set
 * Cardinal cannot ship. This is the same shape as the SMS delivery rule
 * (CLAUDE.md §5.5): the STATUS carries the verdict and the number only ever
 * explains it. Josh confirmed the direction 2026-09-09.
 *
 * ⚠️ **A set with no tracker row is UNKNOWN, never in stock.** `Luer 6 mm 32"`
 * is a real board label with no row on the tracker at all. Rendering it as
 * available because no row said otherwise is silence reading as approval — the
 * failure `infusionCompat.ts` was rewritten to avoid one file over.
 */

/** Below this, an otherwise-available SKU is called low (Brandon, 2026-09-09). */
export const LOW_STOCK_THRESHOLD = 20;

/**
 * How stale a `Last Changed` stamp may be before the pill stops claiming to
 * know. The tracker is scraped daily; two missed days means the scraper is
 * broken, and a stale number is indistinguishable from a fresh one on screen.
 */
export const STOCK_STALE_DAYS = 3;

export type StockTone = "green" | "amber" | "red" | "grey";

export interface StockRow {
  /** Tracker item name, e.g. `AutoSoft XC 6 mm 23"`. */
  name: string;
  /** `Qty Avail` (numeric_mm4w1yk8). */
  qtyAvail: number | null;
  /** `PROD Status` (color_mm4wr14r): Available · Backordered · Inactive. */
  status: string;
  /** `Last Changed` (text_mm4wkpy5), e.g. "2026-09-09 09:05 ET". */
  lastChanged: string;
}

export interface StockVerdict {
  tone: StockTone;
  /** Short pill text, e.g. "1,715 in stock" or "Backordered". */
  label: string;
  /** Longer line for a tooltip or the note under the select. */
  detail: string;
  /** True when Cardinal cannot ship this today. */
  blocked: boolean;
}

/**
 * Tracker names and board labels are ALMOST identical — the exception is real:
 * the tracker says `Mio Advance Clear 9mm 23"` where the Infusion Set columns
 * say `9 mm`. An exact-string join silently misses exactly that SKU, so both
 * sides are normalised: case-folded, punctuation-flattened, spaces collapsed,
 * and the space between a number and `mm` removed.
 */
export function stockKey(label: string): string {
  return (label ?? "")
    .toLowerCase()
    .replace(/[”“]/g, '"')
    .replace(/(\d)\s*mm/g, "$1mm")
    .replace(/[^a-z0-9"]+/g, " ")
    .trim();
}

/** Index tracker rows by their join key. Later rows win, matching Monday order. */
export function indexStock(rows: StockRow[]): Map<string, StockRow> {
  const m = new Map<string, StockRow>();
  for (const r of rows) m.set(stockKey(r.name), r);
  return m;
}

function daysBetween(aYmd: string, bYmd: string): number | null {
  const p = (s: string) => /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  const a = p(aYmd), b = p(bYmd);
  if (!a || !b) return null;
  const ms =
    Date.UTC(+a[1], +a[2] - 1, +a[3]) - Date.UTC(+b[1], +b[2] - 1, +b[3]);
  return Math.round(ms / 86_400_000);
}

/** Thousands separator, so "1715 in stock" reads as a number a rep can scan. */
function num(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * The verdict for one set label.
 *
 * Precedence — status first, always:
 *   1. No tracker row        → grey "No stock data". Never green.
 *   2. Inactive              → red. Cardinal has discontinued it.
 *   3. Backordered           → red, WHATEVER the count says.
 *   4. Stale stamp           → grey. We had an answer, but not a current one.
 *   5. No readable quantity  → grey. A status without a count is not a count.
 *   6. Available, qty <= 0   → red. Available with nothing on the shelf.
 *   7. Available, qty < 20   → amber, with the count.
 *   8. Available             → green, with the count.
 */
export function stockVerdict(
  setLabel: string,
  index: Map<string, StockRow>,
  todayYmd: string,
): StockVerdict {
  const label = (setLabel ?? "").trim();
  if (!label || label === "Not Serving") {
    return { tone: "grey", label: "", detail: "", blocked: false };
  }

  const row = index.get(stockKey(label));
  if (!row) {
    return {
      tone: "grey",
      label: "No stock data",
      detail: `${label} has no row on the Cardinal SKU Tracker — check availability before promising it.`,
      blocked: false,
    };
  }

  const status = (row.status ?? "").trim().toLowerCase();
  if (status === "inactive") {
    return {
      tone: "red",
      label: "Discontinued",
      detail: `Cardinal lists ${label} as Inactive — pick another set.`,
      blocked: true,
    };
  }
  if (status === "backordered") {
    // ⚠️ The count is deliberately NOT consulted here. The worst row on the
    // live board is Backordered with 220 on hand.
    return {
      tone: "red",
      label: "Backordered",
      detail:
        `${label} is on backorder at Cardinal` +
        (row.qtyAvail != null ? ` (${num(row.qtyAvail)} shown on hand, but it can't be ordered).` : "."),
      blocked: true,
    };
  }

  const age = daysBetween(todayYmd, row.lastChanged);
  if (age == null || age > STOCK_STALE_DAYS) {
    return {
      tone: "grey",
      label: "Stock unknown",
      detail: `Stock for ${label} was last checked ${row.lastChanged || "at an unknown time"} — too old to rely on.`,
      blocked: false,
    };
  }

  /* ⚠️ A missing quantity is UNKNOWN, not zero. This read `row.qtyAvail ?? 0`
     and so reported red "Out of stock" for any Available row whose count did
     not parse — an invented shortage on a set Cardinal can ship, which is the
     one direction that costs a sale on the call. The tracker's own header row
     carries a blank here, and `stockApi` deliberately maps blanks to null
     rather than 0 so this branch can tell the two apart; coercing them back
     together threw that away. Caught by `stockApi.test.ts`. */
  if (row.qtyAvail == null) {
    return {
      tone: "grey",
      label: "Stock unknown",
      detail: `Cardinal lists ${label} as ${row.status.trim() || "available"} but the tracker has no quantity for it.`,
      blocked: false,
    };
  }

  const qty = row.qtyAvail;
  if (qty <= 0) {
    return {
      tone: "red",
      label: "Out of stock",
      detail: `${label} shows 0 available at Cardinal.`,
      blocked: true,
    };
  }
  if (qty < LOW_STOCK_THRESHOLD) {
    return {
      tone: "amber",
      label: `${num(qty)} left`,
      detail: `Only ${num(qty)} of ${label} at Cardinal — under the ${LOW_STOCK_THRESHOLD} low-stock mark.`,
      blocked: false,
    };
  }
  return {
    tone: "green",
    label: `${num(qty)} in stock`,
    detail: `${num(qty)} of ${label} available at Cardinal.`,
    blocked: false,
  };
}
