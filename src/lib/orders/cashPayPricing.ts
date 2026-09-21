/**
 * What a Cash Pay patient is charged for an order.
 *
 * ⚠️ **THIS MODULE SETS A PRICE A PATIENT IS BILLED.** Treat every change as
 * higher-stakes than the code size suggests — the number it returns is texted
 * to a patient, charged by Stripe, and is what the order ships against.
 *
 * The rule (Brandon, 2026-08-18, handoff part 2):
 *   1. Each line's cost is the **Cardinal SKU Tracker** `Cost` column
 *      (`numeric_mm4wd6b`, scraped daily at 9:05 ET) x the order's quantity.
 *   2. Apply a **25% markup** and **round per line** to the cent.
 *   3. **Profit floor, at ORDER level, not per line:** if the markup dollars
 *      come to less than $10, add a separate **$10 "Shipping & handling"**
 *      line. If the markup is already >= $10, no shipping line. 25% alone does
 *      not cover shipping on a small order — one box of cartridges is ~$31 of
 *      cost, which earns ~$7.74.
 *
 * **Verified against the only real cash pay order we have.** Debbie Hinze
 * (order 12848746815, paid 2026-08-19): a 90-day supply of 3 boxes of t:slim
 * cartridges, 3 boxes of AutoSoft XC 9 mm 43" and 9 Dexcom G7 sensors. Tracker
 * costs on 2026-09-21 were 30.95 / 71.94 / 57.32, giving $824.55 of Cardinal
 * cost; per-line x1.25 gives 116.06 + 269.78 + 644.85 = **$1,030.69**, which is
 * the figure Janelle quoted her to the cent. Markup $206.14, so no shipping
 * line. `cashPayPricing.test.ts` pins that case — if it ever stops matching,
 * the rule has drifted from the one price a human actually agreed to pay.
 *
 * ⚠️ The quote is **honoured once sent** (Josh, 2026-09-21). Tracker costs move
 * daily and Stripe fixes the amount when the Checkout session is created, so an
 * order priced on Monday ships at Monday's price even if Cardinal's cost rises
 * before the patient pays. The margin absorbs it. Nothing here re-prices.
 */

import { isRunLogRow, type SkuTrackerRow } from "./skuTrackerApi";
import { orderLines, skuRowForLine, FAMILY_LABEL, type OrderLine, type ProductFamily } from "./skuJoin";

/** Brandon's standard markup. */
export const CASH_PAY_MARKUP = 1.25;
/** Below this much markup on the ORDER, a shipping line is added. */
export const MIN_ORDER_MARKUP = 10;
/** The shipping line's amount, and the label the patient sees on it. */
export const SHIPPING_HANDLING = 10;
export const SHIPPING_HANDLING_LABEL = "Shipping & handling";

export interface CashPayLine {
  family: ProductFamily;
  /** The order board's product label, e.g. `AutoSoft XC 9 mm 43"`. */
  product: string;
  /** The tracker row's Cardinal item number, for the reconciliation trail. */
  sku: string;
  quantity: number;
  /** Cardinal's cost for ONE, straight off the tracker. */
  unitCost: number;
  /** unitCost x quantity, unrounded — what Cardinal charges us. */
  lineCost: number;
  /** lineCost x 1.25, rounded to the cent — what the patient is charged. */
  linePrice: number;
}

export interface CashPayQuote {
  lines: CashPayLine[];
  /** 0, or SHIPPING_HANDLING when the profit floor fires. */
  shipping: number;
  /** What Cardinal charges us for the whole order. */
  cardinalCost: number;
  /** Patient price minus Cardinal cost, BEFORE any shipping line. */
  markup: number;
  /** The number the patient is billed. */
  total: number;
  /**
   * Empty when the order can be priced. Otherwise the reason, in words a rep
   * can act on — and the quote must NOT be offered.
   */
  refusal: string;
}

/**
 * Money, to the cent, half-up — what a person doing this by hand does.
 *
 * ⚠️ **`Math.round(n * 100)` IS WRONG HERE AND COSTS A CENT ON REAL ORDERS.**
 * Debbie's infusion-set line is 215.82 x 1.25 = 269.775, which IEEE-754 stores
 * as 269.77499999999998; scaled by 100 that is 26977.499999999996, so a naive
 * round sends it DOWN to 269.77 and her order totals $1,030.68 — a cent under
 * the $1,030.69 she was quoted and agreed to. `Number.EPSILON` (2.2e-16) is
 * six orders of magnitude too small to correct a 4e-12 scaling error, so
 * adding it changes nothing.
 *
 * `toPrecision(12)` snaps the scaled value back to the decimal a human wrote
 * before rounding: 12 significant figures is far more than any order total
 * needs (we would need to exceed $99,999,999.99 to lose a cent) and far fewer
 * than the ~15-17 at which the float noise lives. Caught by the Debbie test,
 * which exists precisely because it is anchored to a price a patient paid.
 */
export function round2(n: number): number {
  return Math.round(Number((n * 100).toPrecision(12))) / 100;
}

/** What `orderLines` needs — re-exported so callers need only this module. */
type QuoteInput = Parameters<typeof orderLines>[0];

/**
 * Price an order for a cash pay patient.
 *
 * ⚠️ **A LINE WE CANNOT PRICE REFUSES THE WHOLE QUOTE — it never prices at
 * zero.** The tracker carries real rows whose Cost reads `0` (every Inactive
 * product does), and a missing row is indistinguishable from a product Cardinal
 * has stopped selling. Letting either through would text a patient a total that
 * silently omits a product they are about to be shipped. Same direction as
 * §5.31b's "a missing quantity is UNKNOWN, not zero".
 */
export function cashPayQuote(
  order: QuoteInput,
  rows: readonly SkuTrackerRow[],
): CashPayQuote {
  const empty: CashPayQuote = {
    lines: [], shipping: 0, cardinalCost: 0, markup: 0, total: 0, refusal: "",
  };

  const productLines: OrderLine[] = orderLines(order);
  if (productLines.length === 0) {
    return { ...empty, refusal: "This order has no products on it yet." };
  }

  // The Run Log row is a headline, not a SKU — it must never join to a line.
  const skus = rows.filter((r) => !isRunLogRow(r));

  const lines: CashPayLine[] = [];
  for (const line of productLines) {
    const row = skuRowForLine(line, skus);
    if (!row) {
      return {
        ...empty,
        refusal: `${line.product} (${FAMILY_LABEL[line.family]}) isn't on the Cardinal SKU Tracker, so we can't price it. Check the product name matches a tracker row.`,
      };
    }
    if (row.unitCost === null || row.unitCost <= 0) {
      return {
        ...empty,
        refusal: `The Cardinal SKU Tracker has no cost for ${line.product} (${FAMILY_LABEL[line.family]}), so we can't price it. It may be an inactive product.`,
      };
    }
    const lineCost = row.unitCost * line.quantity;
    lines.push({
      family: line.family,
      product: line.product,
      sku: row.sku,
      quantity: line.quantity,
      unitCost: row.unitCost,
      lineCost: round2(lineCost),
      linePrice: round2(lineCost * CASH_PAY_MARKUP),
    });
  }

  const cardinalCost = round2(lines.reduce((s, l) => s + l.lineCost, 0));
  const priced = round2(lines.reduce((s, l) => s + l.linePrice, 0));

  /* The markup is what we ACTUALLY make — the rounded prices minus the rounded
     costs — rather than `cardinalCost * 0.25`. The two agree on every real
     order (they differ only by sub-cent rounding), and this one is the figure
     the floor is actually about: whether this order earns enough to cover
     posting it. */
  const markup = round2(priced - cardinalCost);
  const shipping = markup < MIN_ORDER_MARKUP ? SHIPPING_HANDLING : 0;

  return {
    lines,
    shipping,
    cardinalCost,
    markup,
    total: round2(priced + shipping),
    refusal: "",
  };
}

/** Can this order be billed? Cheap guard for a button's disabled state. */
export function canQuoteCashPay(
  order: QuoteInput,
  rows: readonly SkuTrackerRow[],
): boolean {
  return cashPayQuote(order, rows).refusal === "";
}

/**
 * The quote as Stripe line items and as the branded page's rows — one shape,
 * so the page a patient reads and the session Stripe charges cannot disagree
 * about what they are buying.
 */
export interface CashPayLineItem {
  label: string;
  quantity: number;
  /** Whole cents, which is what Stripe takes. */
  amountCents: number;
}

export function cashPayLineItems(quote: CashPayQuote): CashPayLineItem[] {
  if (quote.refusal) return [];
  const items: CashPayLineItem[] = quote.lines.map((l) => ({
    label: `${l.product} (${FAMILY_LABEL[l.family]})`,
    quantity: l.quantity,
    amountCents: Math.round(l.linePrice * 100),
  }));
  if (quote.shipping > 0) {
    items.push({
      label: SHIPPING_HANDLING_LABEL,
      quantity: 1,
      amountCents: Math.round(quote.shipping * 100),
    });
  }
  return items;
}

/**
 * ⚠️ The cents the patient is charged are summed from the LINE ITEMS, never
 * from `total` re-rounded. Stripe charges the sum of what it was handed, so a
 * total computed a second way can differ by a cent from the lines printed
 * above it — and a receipt whose lines do not add up to its total is the kind
 * of thing a patient telephones about.
 */
export function cashPayTotalCents(quote: CashPayQuote): number {
  return cashPayLineItems(quote).reduce((s, i) => s + i.amountCents, 0);
}
