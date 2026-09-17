/**
 * The one sentence the page answers a phone call with — "where is this
 * patient's order?" — and the next thing a rep would say after it.
 *
 * `rowSummary` says the same thing in a list row's five words; this is the
 * full-sentence version the header renders in large type. Both derive from
 * `orderStage` + `cardinalStatus`, so they cannot disagree about WHERE an
 * order is, only about how much to say.
 *
 * ⚠️ When the sentence already states an attention flag (a hold, a booking
 * error, a backorder…), `flagId` names it so the header does not draw the
 * same fact twice — once as the headline and again as a banner beneath it.
 * An unrecognised Cardinal label is printed verbatim (§5.20's rule), never
 * smoothed into "in progress".
 */
import { cardinalStatus, fmtDate, orderStage, type Order } from "./workflow";
import { backorderedEntries } from "./substitution";

export interface OrderHeadline {
  /** The answer, e.g. "Delivered 9/11/2026". */
  text: string;
  /** The quieter second line, e.g. "Signed by FRONT DOOR". "" when there is none. */
  detail: string;
  /** The `orderFlags` id this sentence already covers, if any. */
  flagId: string | null;
}

type Input = Pick<
  Order,
  | "groupId" | "orderStatus" | "apiStatus" | "holdReason" | "apiMessage"
  | "orderDate" | "estimatedShipDate" | "shipDate" | "carrier" | "deliveryDate" | "signedBy" | "backordered"
>;

const say = (text: string, detail = "", flagId: string | null = null): OrderHeadline => ({ text, detail, flagId });

export function orderHeadline(o: Input): OrderHeadline {
  const stage = orderStage(o);
  const cs = cardinalStatus(o.apiStatus, o.holdReason, o.apiMessage);
  const created = o.orderDate ? `Created ${fmtDate(o.orderDate)}` : "";

  switch (stage) {
    case "cancelled":
      return say("Cancelled");
    case "returns":
      return say(/complete/i.test(o.orderStatus ?? "") ? "Returned" : "Return in progress");
    case "stuck":
      return say("Stuck on the order board");
    case "toPlace":
      return say("Waiting to be placed", created);
    case "placing":
      return say("Being placed with Cardinal", "Cardinal's answer arrives in a moment");
    case "onHold":
      // Order Date doubles as the return date on this board (workflow 7919939752).
      return say(o.orderDate ? `On hold until ${fmtDate(o.orderDate)}` : "On hold");
    case "inProgress": {
      switch (cs.kind) {
        case "hold":
          return say(cs.holdReason ? `On hold at Cardinal — ${cs.holdReason}` : "On hold at Cardinal", "", "hold");
        case "error":
          return say("Cardinal couldn't book it", "", "error");
        case "review":
          return say("Needs review at Cardinal", "", "review");
        case "backordered":
          return say("Backordered at Cardinal", backorderedEntries(o.backordered).join(", "), "backordered");
        case "substitution":
          return say(cs.label, "", "substitution");
        case "none":
          return say("Placed — waiting for Cardinal", created);
        case "processing":
          return say("Cardinal is processing it");
        case "accepted":
          return say("Accepted by Cardinal — not shipped yet", o.estimatedShipDate ? `Estimated ship ${fmtDate(o.estimatedShipDate)}` : "");
        case "warning":
          return say("Accepted with a warning — not shipped yet", o.estimatedShipDate ? `Estimated ship ${fmtDate(o.estimatedShipDate)}` : "");
        default:
          return say(cs.label);
      }
    }
    case "shipped": {
      const on = o.shipDate ? ` ${fmtDate(o.shipDate)}` : "";
      const via = o.carrier ? ` via ${o.carrier}` : "";
      if (cs.kind === "partial") return say(`Partially shipped${on}${via}`, "The rest is still to come");
      if (!o.shipDate && cs.kind === "none") return say("Shipped", "Before Cardinal records began — no tracking on file");
      return say(`Shipped${on}${via}`);
    }
    case "delivered":
      return say(o.deliveryDate ? `Delivered ${fmtDate(o.deliveryDate)}` : "Delivered", o.signedBy ? `Signed by ${o.signedBy}` : "");
    default:
      return say(o.orderStatus || "No status");
  }
}
