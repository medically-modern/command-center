/**
 * Pure list math for the Orders sidebar. The sidebar renders exactly what
 * these functions return, and the page auto-selects from `sidebarVisibleList`,
 * so the row a rep looks at first and the order the page opens on cannot
 * drift apart (the `subscription/sidebarList` rule).
 *
 * Sections run in the order the ordering desk works them: what still has to
 * be placed, what is snoozed, what Cardinal has but hasn't shipped (problems
 * first), then the shipped and delivered history newest-first. Delivered is
 * the long tail — ~1,350 of ~1,480 rows — so it is CAPPED at the most recent
 * `DELIVERED_LIMIT` until the rep searches or asks for all of it; the search
 * always covers every order, which is the whole point of the page.
 */
import { orderFlags, orderStage, type Order, type OrderStage, orderMatchesQuery } from "./workflow";

export const DELIVERED_LIMIT = 75;

export interface OrderSections {
  toPlace: Order[];
  onHold: Order[];
  inProgress: Order[];
  shipped: Order[];
  delivered: Order[];
  returns: Order[];
  stuck: Order[];
  other: Order[];
  cancelled: Order[];
  /** Delivered rows beyond the cap — how many the sidebar is not showing. */
  deliveredHidden: number;
}

export interface SidebarOptions {
  /** The search box's text; empty shows everything (capped). */
  query?: string;
  /** Lift the delivered cap. */
  showAllDelivered?: boolean;
}

const byOrderDateAsc = (a: Order, b: Order) => (a.orderDate || "9999").localeCompare(b.orderDate || "9999");
const byOrderDateDesc = (a: Order, b: Order) => (b.orderDate || "").localeCompare(a.orderDate || "");
const byShipDesc = (a: Order, b: Order) =>
  (b.shipDate || b.orderDate || "").localeCompare(a.shipDate || a.orderDate || "");
const byDeliveredDesc = (a: Order, b: Order) =>
  (b.deliveryDate || b.shipDate || b.orderDate || "").localeCompare(a.deliveryDate || a.shipDate || a.orderDate || "");

/** Rose flags float an in-progress order to the top of its section. */
const attentionRank = (o: Order) => (orderFlags(o).some((f) => f.tone === "rose") ? 0 : 1);

export function sidebarSections(orders: readonly Order[], opts: SidebarOptions = {}): OrderSections {
  const query = (opts.query ?? "").trim();
  const rows = query ? orders.filter((o) => orderMatchesQuery(o, query)) : [...orders];

  const buckets: Record<OrderStage, Order[]> = {
    toPlace: [], onHold: [], placing: [], inProgress: [], shipped: [], delivered: [],
    returns: [], cancelled: [], stuck: [], other: [],
  };
  for (const o of rows) buckets[orderStage(o)].push(o);

  // Placing rides with To place: it is the same queue a second later, and a
  // rep watching the list should see the order they just flipped, not lose it.
  const toPlace = [...buckets.toPlace.sort(byOrderDateAsc), ...buckets.placing.sort(byOrderDateAsc)];
  const onHold = buckets.onHold.sort(byOrderDateAsc);
  const inProgress = buckets.inProgress
    .map((o, i) => ({ o, i, rank: attentionRank(o) }))
    .sort((a, b) => a.rank - b.rank || byOrderDateAsc(a.o, b.o) || a.i - b.i)
    .map((x) => x.o);
  const shipped = buckets.shipped.sort(byShipDesc);
  const deliveredAll = buckets.delivered.sort(byDeliveredDesc);
  const cap = query || opts.showAllDelivered ? deliveredAll.length : DELIVERED_LIMIT;
  const delivered = deliveredAll.slice(0, cap);

  return {
    toPlace,
    onHold,
    inProgress,
    shipped,
    delivered,
    deliveredHidden: deliveredAll.length - delivered.length,
    returns: buckets.returns.sort(byOrderDateDesc),
    stuck: buckets.stuck.sort(byOrderDateDesc),
    other: buckets.other.sort(byOrderDateDesc),
    cancelled: buckets.cancelled.sort(byOrderDateDesc),
  };
}

/** Every row the sidebar renders, flattened in exact render order. */
export function sidebarVisibleList(orders: readonly Order[], opts: SidebarOptions = {}): Order[] {
  const s = sidebarSections(orders, opts);
  return [...s.toPlace, ...s.onHold, ...s.inProgress, ...s.shipped, ...s.delivered, ...s.returns, ...s.stuck, ...s.other, ...s.cancelled];
}
