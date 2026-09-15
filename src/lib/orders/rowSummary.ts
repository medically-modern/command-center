/**
 * The one line under an order's name in a list row — where it is, in that
 * stage's own words. Pure, and read against LIST rows (`listColumns.test.ts`).
 */
import { cardinalStatus, fmtDateShort, orderStage, type Order } from "./workflow";
import { orderLines, FAMILY_LABEL } from "./skuJoin";

/** The one line under the name: where it is, in that stage's own words. */
export function rowSummary(o: Order): string {
  const stage = orderStage(o);
  const cs = cardinalStatus(o.apiStatus, o.holdReason, o.apiMessage);
  switch (stage) {
    case "toPlace": return [productWords(o), o.orderType].filter(Boolean).join(" · ") || "To place";
    case "placing": return "Placing…";
    case "onHold": return `On hold · back ${o.orderDate ? fmtDateShort(o.orderDate) : "when the date arrives"}`;
    case "inProgress": return cs.kind === "none" ? "Placed · waiting for Cardinal" : cs.label;
    case "shipped": return [o.shipDate ? `Shipped ${fmtDateShort(o.shipDate)}` : cs.kind === "none" ? "No Cardinal record" : cs.label, o.carrier].filter(Boolean).join(" · ");
    case "delivered": return o.deliveryDate ? `Delivered ${fmtDateShort(o.deliveryDate)}` : "Delivered";
    case "returns": return o.orderStatus || "Return";
    case "cancelled": return o.orderStatus ? `Cancelled · ${o.orderStatus}` : "Cancelled";
    case "stuck": return "Stuck";
    default: return o.orderStatus || "No status";
  }
}

/** "Sensors + receiver" / "Pump + cartridges + sets" — the families on the order. */
export function productWords(o: Order): string {
  if (o.subscriptionType) return o.subscriptionType;
  const fams = [...new Set(orderLines(o).map((l) => FAMILY_LABEL[l.family]))];
  return fams.join(" + ");
}

