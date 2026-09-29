/**
 * Brandon's order card on the patient screen's Subscription › Orders tab
 * (pixel-match Phase 2) — the looks are his `orderCard`; every FACT is the
 * order board's, read through the orders slice's own rules.
 *
 * ⚠️⚠️ **`orderStage` + `cardinalStatus` decide, never a second reading of the
 * status columns here** (§5.35): the group is not the stage on that board and
 * API Status is, so a local rule would have this card disagreeing with the
 * `/orders` page its own link opens. This file only turns their answer into
 * his pill words.
 *
 * ⚠️⚠️ **His mockup INVENTS which items went in which box** (`shipmentsOf`
 * guesses: "the backordered set is pending, the rest shipped"). The board has
 * no such data — per-line shipment status from Cardinal does not exist
 * (PIXEL_MATCH_PLAN.md §7). So a shipment is a TRACKING NUMBER, the items are
 * drawn inside a shipment only when there is exactly one box and nothing is
 * still with Cardinal, and a date or a signature is put on a box only when the
 * order has one box. Guessing would be a confident, wrong answer on the one
 * call where a patient asks what arrived.
 *
 * ⚠️⚠️ **Superseded where Cardinal's Line Item Detail says** (2026-09-29): that
 * column DOES name the SKUs in each tracking number (`lib/orders/lineItems.ts`),
 * so `orderShipmentsFromLines` draws each parcel WITH its items and the
 * not-yet-shipped lines in one block that is never numbered as a shipment
 * (Brandon: *"shipment 1 of 2 and 2 of 2 are confusing people"*). The
 * guess-free rule above still stands for every order that column says nothing
 * about — `orderShipments` is what those draw.
 */
import { backorderedEntries } from "@/lib/orders/substitution";
import {
  cardinalStatus,
  fmtDate,
  isOpenStage,
  orderStage,
  trackingUrl,
  type Order,
} from "@/lib/orders/workflow";
import { orderHeadline } from "@/lib/orders/headline";
import { lineItemView, type BoxItem, type PendingItem } from "@/lib/orders/lineItems";

export type PillTone = "active" | "lightgreen" | "blue" | "red" | "amber" | "grey";
export type PillIcon = "check" | "truck" | "alert" | "clock" | null;

export interface OrderPill {
  tone: PillTone;
  icon: PillIcon;
  text: string;
}

type PillInput = Pick<
  Order,
  | "groupId" | "orderStatus" | "apiStatus" | "holdReason" | "apiMessage"
  | "deliveryDate" | "orderDate" | "estimatedShipDate" | "shipDate" | "carrier" | "signedBy" | "backordered"
>;

const BLOCKING = new Set(["hold", "error", "review", "deleted"]);

/**
 * An order that shipped BEFORE Cardinal records began — it sits in
 * Shipped/Delivered with no API Status and no ship date (§5.35: 609 such rows).
 * ⚠️ The slice's own headline draws exactly this line ("Before Cardinal records
 * began — no tracking on file"), and this mirrors its condition rather than
 * inventing one; `orderCard.test.ts` holds the two to each other. His mockup
 * calls its version of these "Ordered via DDP"; we do not know that of ours,
 * so it is not said.
 */
export function isPreTracking(o: Pick<Order, "groupId" | "orderStatus" | "apiStatus" | "holdReason" | "apiMessage" | "shipDate">): boolean {
  return (
    orderStage(o) === "shipped" &&
    cardinalStatus(o.apiStatus, o.holdReason, o.apiMessage).kind === "none" &&
    !(o.shipDate ?? "").trim()
  );
}

/**
 * The one pill in the card's band and on the history row — his vocabulary.
 *
 * ⚠️ "In transit" only when Cardinal SAYS shipped: a pre-poller row reads
 * "shipped" with no Cardinal record at all (§5.35, 609 of them), and calling a
 * 2025 order "in transit" would be a claim nothing on the board supports.
 */
export function orderPill(o: PillInput): OrderPill {
  const stage = orderStage(o);
  const cs = cardinalStatus(o.apiStatus, o.holdReason, o.apiMessage);
  if (stage === "delivered") {
    return { tone: "active", icon: "check", text: o.deliveryDate ? `Delivered ${fmtDate(o.deliveryDate)}` : "Delivered" };
  }
  if (stage === "cancelled") return { tone: "grey", icon: null, text: "Cancelled" };
  if (stage === "returns") return { tone: "amber", icon: null, text: orderHeadline(o).text };
  if (stage === "stuck") return { tone: "red", icon: "alert", text: "Stuck on the order board" };
  if (cs.kind === "partial") return { tone: "lightgreen", icon: "check", text: "Partially shipped" };
  if (BLOCKING.has(cs.kind)) return { tone: "red", icon: "alert", text: cs.label };
  if (cs.kind === "backordered") return { tone: "red", icon: "alert", text: "Backordered" };
  if (cs.kind === "substitution") return { tone: "amber", icon: "clock", text: cs.label };
  if (stage === "shipped") {
    if (isPreTracking(o)) return { tone: "grey", icon: null, text: "Shipped · no tracking" };
    return cs.kind === "shipped"
      ? { tone: "blue", icon: "truck", text: "In transit" }
      : { tone: "blue", icon: "truck", text: "Shipped" };
  }
  if (stage === "toPlace") return { tone: "amber", icon: "clock", text: "Waiting to be placed" };
  if (stage === "onHold") return { tone: "amber", icon: "clock", text: "On hold" };
  if (stage === "placing") return { tone: "amber", icon: "clock", text: "Being placed" };
  if (cs.kind === "accepted") return { tone: "amber", icon: "clock", text: "Accepted" };
  if (cs.kind === "warning") return { tone: "amber", icon: "clock", text: "Accepted with a warning" };
  if (cs.kind === "processing") return { tone: "amber", icon: "clock", text: "Processing" };
  if (cs.kind === "none") return { tone: "amber", icon: "clock", text: "Placed" };
  // A Cardinal label this app has no rule for — printed verbatim (§5.20).
  return { tone: "amber", icon: "clock", text: cs.label || "In progress" };
}

export interface ShipmentBox {
  /** 1-based, and `of` counts the still-to-come block too. */
  n: number;
  of: number;
  /** "" for a box the board holds no tracking number for. */
  track: string;
  url: string | null;
  carrier: string;
  pill: OrderPill;
  /** The signature — only on an order with ONE box (it is an order field). */
  signedBy: string;
}

export interface PendingBox {
  n: number;
  of: number;
  /** Red when Cardinal said backordered, amber when it only said "not all". */
  tone: "red" | "amber";
  label: string;
  /** The backordered products the board names, verbatim. */
  products: string[];
  eta: string;
  qty: string;
}

export interface ShipmentView {
  boxes: ShipmentBox[];
  /** Still with Cardinal — only while the order is not complete (below). */
  pending: PendingBox | null;
  /** Nothing has shipped: one block. `backordered` is what the board's daily
   *  sweep says is on Cardinal's backorder list for this OPEN order — shown,
   *  never turned into a shipment state. `heading` never says "yet" about an
   *  order that is finished. */
  notYet: { heading: string; pill: OrderPill; eta: string; backordered: string[] } | null;
  /** Draw the order's items INSIDE the one box — true only when every item
   *  certainly went in it. Otherwise they are listed once, on their own. */
  itemsInBox: boolean;
}

type ShipInput = PillInput & Pick<Order, "tracking" | "backorderedQty">;

/**
 * Boxes, the still-to-come block, or "not shipped yet".
 *
 * ⚠️⚠️ **"Still to come" is CARDINAL'S verdict on this order, not the stage.**
 * A partially shipped order's stage is `shipped` — `orderStage` files it with
 * the shipped orders, and `isOpenStage` calls it closed — so a rule keyed on
 * the open stages never showed the part that has not shipped. The first cut
 * did exactly that, and its own test caught it. Partial, backordered and a
 * substitution each say something is still to come, on any order that is not
 * complete.
 *
 * ⚠️ **The backordered column is written on EVERY order by a daily sweep,
 * delivered ones included** (§5.35), so it is read only where `/orders` reads
 * it — an open order — or beside Cardinal's own partial / backordered /
 * substitution verdict for this order. On a finished order it is history.
 */
export function orderShipments(o: ShipInput): ShipmentView {
  const stage = orderStage(o);
  const cs = cardinalStatus(o.apiStatus, o.holdReason, o.apiMessage);
  const complete = orderIsComplete(o);
  const open = isOpenStage(stage);
  const tracks = (o.tracking ?? []).map((t) => (t ?? "").trim()).filter(Boolean);
  const shippedOrDelivered = stage === "shipped" || stage === "delivered" || cs.kind === "partial";

  const cardinalSaysPending = cs.kind === "partial" || cs.kind === "backordered" || cs.kind === "substitution";
  const products = !complete && (open || cardinalSaysPending) ? backorderedEntries(o.backordered) : [];
  const stillToCome = !complete && cardinalSaysPending;

  /* A pre-tracking order has no box to draw: nothing on the board says how,
     when or in how many parcels it went (his DDP card draws none either). */
  const count = tracks.length || (shippedOrDelivered && !isPreTracking(o) ? 1 : 0);
  const of = count + (stillToCome ? 1 : 0);
  const single = count === 1;

  /* The BOX's own journey. ⚠️ "In transit" only while the ORDER is in transit:
     a returned order's box went out and was delivered, and saying it is on its
     way would be the one thing it certainly is not. */
  const boxPill = (): OrderPill => {
    if (stage === "delivered" || cs.kind === "delivered") {
      return { tone: "active", icon: "check", text: single && o.deliveryDate ? `Delivered ${fmtDate(o.deliveryDate)}` : "Delivered" };
    }
    if (stage === "shipped" && (cs.kind === "shipped" || cs.kind === "partial")) {
      return { tone: "blue", icon: "truck", text: single && o.shipDate ? `In transit · shipped ${fmtDate(o.shipDate)}` : "In transit" };
    }
    return { tone: "blue", icon: "truck", text: single && o.shipDate ? `Shipped ${fmtDate(o.shipDate)}` : "Shipped" };
  };

  const boxes: ShipmentBox[] = [];
  if (count > 0) {
    const list = tracks.length ? tracks : [""];
    list.forEach((track, i) => {
      boxes.push({
        n: i + 1,
        of,
        track,
        url: track ? trackingUrl(track, o.carrier) : null,
        carrier: (o.carrier ?? "").trim(),
        pill: boxPill(),
        signedBy: single && (stage === "delivered" || cs.kind === "delivered") ? (o.signedBy ?? "").trim() : "",
      });
    });
  }

  /* Red when something is named or refused (backordered, substitution
     needed); amber when Cardinal only said "not all of it yet", or the swap is
     already ordered. */
  const pendingLook = (): { tone: "red" | "amber"; label: string } => {
    if (cs.kind === "substitution") {
      return { tone: /ordered/i.test(cs.label) ? "amber" : "red", label: cs.label };
    }
    if (cs.kind === "partial" && !products.length) return { tone: "amber", label: "Waiting on Cardinal" };
    return { tone: "red", label: "Backordered" };
  };

  const pending: PendingBox | null = stillToCome
    ? {
        n: of,
        of,
        ...pendingLook(),
        products,
        eta: o.estimatedShipDate ? fmtDate(o.estimatedShipDate) : "",
        qty: (o.backorderedQty ?? "").trim(),
      }
    : null;

  const notYet =
    count === 0 && !stillToCome && !isPreTracking(o)
      ? {
          heading: stage === "cancelled" ? "Not shipped" : stage === "returns" ? "No shipment on record" : "Not shipped yet",
          pill: orderPill(o),
          eta: !complete && o.estimatedShipDate ? fmtDate(o.estimatedShipDate) : "",
          backordered: products,
        }
      : null;

  return { boxes, pending, notYet, itemsInBox: single && !pending };
}

/** The order number a rep reads out: Cardinal's, else the PO, else the item. */
export function orderNumberLabel(o: Pick<Order, "cahOrderNumber" | "poNumber" | "id">): string {
  if (o.cahOrderNumber) return `#${o.cahOrderNumber}`;
  if (o.poNumber) return o.poNumber;
  return `#${o.id.slice(-4)}`;
}

/**
 * Delivered, cancelled, or a finished return — nothing left to do on it.
 * ⚠️ A finished return is the slice's own headline's call ("Returned"), never
 * a second reading of the status column here.
 */
export function orderIsComplete(o: Parameters<typeof orderHeadline>[0]): boolean {
  const stage = orderStage(o);
  if (stage === "delivered" || stage === "cancelled") return true;
  return stage === "returns" && orderHeadline(o).text === "Returned";
}

/**
 * Nothing left to do on it: complete, or shipped before Cardinal records
 * began. Draws the card's green edge and leaves the order out of "N orders
 * still open" — a 2025 order with no tracking is not open work.
 */
export function orderIsSettled(o: Parameters<typeof orderHeadline>[0]): boolean {
  return orderIsComplete(o) || isPreTracking(o);
}

/**
 * The sentence under "Latest order" — his three, with our headline in the
 * third, because "Still in progress" alone says less than the board knows.
 */
export function selectedOrderSentence(o: ShipInput, opts: { canSwap: boolean }): string {
  if (orderIsComplete(o)) return "Complete — nothing to do on it.";
  if (isPreTracking(o)) {
    const h = orderHeadline(o);
    return [h.text, h.detail].filter(Boolean).join(" · ");
  }
  const view = orderShipments(o);
  if (view.pending) {
    /* ⚠️ Only where the swap is really offered: the Substitution card sends
       from an OPEN order alone (a partially shipped one is `shipped`), and
       only for somebody with Adjust orders. A sentence pointing at a control
       that is not there is the dead end this codebase records reversing. */
    const swappable = opts.canSwap && view.pending.products.length > 0 && isOpenStage(orderStage(o));
    return swappable
      ? "Part of it is still with Cardinal — the backordered set can be swapped below."
      : "Part of it is still with Cardinal.";
  }
  return `Still in progress · ${orderHeadline(o).text}`;
}

export interface ParcelView {
  /** 1-based among PARCELS only — the not-yet-shipped block is never counted. */
  n: number;
  of: number;
  track: string;
  url: string | null;
  carrier: string;
  pill: OrderPill;
  signedBy: string;
  /** What Cardinal lists in this parcel; null when its line list does not
   *  mention this tracking number yet (the list is older than the column). */
  items: BoxItem[] | null;
}

export interface LinesShipmentView {
  parcels: ParcelView[];
  /** Still to ship, by Cardinal's line list — null on a finished order. */
  pending: { tone: "red" | "amber"; label: string; eta: string; items: PendingItem[] } | null;
  /** Cardinal calls these shipped without naming a parcel. */
  unboxed: BoxItem[];
  /** Cardinal's stamp, shown when a parcel is not in its list yet. */
  stamp: string;
  /** The SKU a substitution replaced, when there is exactly one. */
  replaced: string;
}

/**
 * The shipments drawn from Cardinal's Line Item Detail — each parcel with its
 * own items (Brandon, 2026-09-29). Null when the column
 * says nothing usable, when the order shipped before Cardinal records began,
 * or when Cardinal's verdict says something is still to come and the line list
 * does not — the card then draws `orderShipments` exactly as before, so a
 * pending block Cardinal asserts is never hidden by an older list.
 */
export function orderShipmentsFromLines(o: ShipInput & Pick<Order, "lineItemDetail">): LinesShipmentView | null {
  if (isPreTracking(o)) return null;
  const li = lineItemView(o.lineItemDetail ?? "", (o.tracking ?? []).map((t) => (t ?? "").trim()).filter(Boolean));
  if (!li) return null;
  const stage = orderStage(o);
  const cs = cardinalStatus(o.apiStatus, o.holdReason, o.apiMessage);
  const complete = orderIsComplete(o);
  if (!complete && !li.pending.length && orderShipments(o).pending) return null;

  const tracks = [...li.boxes.map((b) => b.track), ...li.unlisted];
  const of = tracks.length;
  const single = of === 1;
  const delivered = stage === "delivered" || cs.kind === "delivered";
  const pillFor = (date: string): OrderPill => {
    if (delivered) {
      return { tone: "active", icon: "check", text: single && o.deliveryDate ? `Delivered ${fmtDate(o.deliveryDate)}` : "Delivered" };
    }
    /* A partially shipped order whose ONE parcel has arrived: the order's
       Delivery Date can only be that parcel's. Saying "in transit" over a
       box that came two weeks ago is the confusion this view exists to end. */
    if (single && o.deliveryDate) return { tone: "active", icon: "check", text: `Delivered ${fmtDate(o.deliveryDate)}` };
    const shipped = date || (single ? o.shipDate : "");
    const moving = stage === "shipped" && (cs.kind === "shipped" || cs.kind === "partial");
    if (moving) return { tone: "blue", icon: "truck", text: shipped ? `In transit · shipped ${fmtDate(shipped)}` : "In transit" };
    return { tone: "blue", icon: "truck", text: shipped ? `Shipped ${fmtDate(shipped)}` : "Shipped" };
  };

  const parcels: ParcelView[] = tracks.map((track, i) => {
    const box = li.boxes.find((b) => b.track === track) ?? null;
    return {
      n: i + 1,
      of,
      track,
      url: trackingUrl(track, box?.carrier || o.carrier),
      carrier: (box?.carrier || o.carrier || "").trim(),
      pill: pillFor(box?.date ?? ""),
      signedBy: single && delivered ? (o.signedBy ?? "").trim() : "",
      items: box ? box.items : null,
    };
  });

  let pending: LinesShipmentView["pending"] = null;
  if (!complete && li.pending.length) {
    const named = li.pending.some((p) => p.dropped || /^backordered$/i.test(p.status));
    const look =
      cs.kind === "substitution"
        ? { tone: (/ordered/i.test(cs.label) ? "amber" : "red") as "red" | "amber", label: cs.label }
        : named
          ? { tone: "red" as const, label: "Backordered" }
          : { tone: "amber" as const, label: "Waiting on Cardinal" };
    pending = { ...look, eta: o.estimatedShipDate ? fmtDate(o.estimatedShipDate) : "", items: li.pending };
  }

  return { parcels, pending, unboxed: li.unboxed, stamp: li.stamp, replaced: li.replaced };
}
