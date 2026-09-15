/**
 * The five steps an order takes, as the timeline card draws them:
 *
 *   Created → Placed → Cardinal → Shipped → Delivered
 *
 * plus a terminal sixth for a return or a cancellation. Pure, so the card is
 * only the looks and the states are tested. `blocked` is the one state a rep
 * must act on (a hold, a booking error, a deletion); `note` is a step that
 * passed with something worth reading (backordered, a warning).
 */
import { cardinalStatus, fmtDate, orderStage, type Order } from "./workflow";

export type StepState = "done" | "current" | "pending" | "blocked" | "note";

export interface TimelineStep {
  key: "created" | "placed" | "cardinal" | "shipped" | "delivered" | "returned" | "cancelled";
  title: string;
  state: StepState;
  lines: string[];
}

type Input = Pick<
  Order,
  | "groupId" | "orderStatus" | "apiStatus" | "holdReason" | "apiMessage"
  | "orderDate" | "orderType" | "cahOrderNumber" | "poNumber" | "lastCardinalSync"
  | "shipDate" | "estimatedShipDate" | "carrier" | "tracking" | "deliveryDate" | "signedBy"
>;

export function orderTimeline(o: Input): TimelineStep[] {
  const stage = orderStage(o);
  const cs = cardinalStatus(o.apiStatus, o.holdReason, o.apiMessage);
  const placedEvidence = !!(o.cahOrderNumber || o.poNumber || o.lastCardinalSync);
  const placed = placedEvidence || ["inProgress", "shipped", "delivered", "returns"].includes(stage);
  const shippedKinds = ["shipped", "partial", "delivered"];
  const shipped = !!o.shipDate || shippedKinds.includes(cs.kind) || stage === "shipped" || stage === "delivered";
  const delivered = cs.kind === "delivered" || !!o.deliveryDate || stage === "delivered";

  const steps: TimelineStep[] = [];

  steps.push({
    key: "created",
    title: "Created",
    state: "done",
    lines: [[o.orderType, o.orderDate ? fmtDate(o.orderDate) : ""].filter(Boolean).join(" · ")],
  });

  // Placed
  if (placed) {
    const lines = [
      o.cahOrderNumber ? `Cardinal order ${o.cahOrderNumber}` : "",
      o.lastCardinalSync ? `Synced ${o.lastCardinalSync}` : "",
    ].filter(Boolean);
    steps.push({ key: "placed", title: "Placed", state: "done", lines: lines.length ? lines : ["Placed with Cardinal"] });
  } else if (stage === "onHold") {
    steps.push({
      key: "placed",
      title: "Placed",
      state: "current",
      lines: [`On hold — back in the queue ${o.orderDate ? fmtDate(o.orderDate) : "when the Order Date arrives"}`],
    });
  } else if (stage === "placing") {
    steps.push({ key: "placed", title: "Placed", state: "current", lines: ["Being placed — Cardinal's answer arrives in a moment"] });
  } else if (stage === "stuck") {
    steps.push({ key: "placed", title: "Placed", state: "blocked", lines: ["Marked Stuck on the board"] });
  } else if (stage === "cancelled") {
    steps.push({ key: "placed", title: "Placed", state: "pending", lines: [] });
  } else {
    steps.push({ key: "placed", title: "Placed", state: "current", lines: ["Waiting to be placed on the order board"] });
  }

  // Cardinal
  if (!placed) {
    steps.push({ key: "cardinal", title: "Accepted", state: "pending", lines: [] });
  } else if (cs.kind === "hold" || cs.kind === "error" || cs.kind === "review" || cs.kind === "deleted") {
    steps.push({ key: "cardinal", title: "Accepted", state: "blocked", lines: [cs.label, cs.detail !== cs.label ? cs.detail : ""].filter(Boolean) });
  } else if (cs.kind === "backordered" || cs.kind === "substitution" || cs.kind === "warning") {
    steps.push({ key: "cardinal", title: "Accepted", state: "note", lines: [cs.label] });
  } else if (cs.kind === "none" && !shipped) {
    steps.push({ key: "cardinal", title: "Accepted", state: "current", lines: ["Waiting for Cardinal's answer"] });
  } else if (cs.kind === "processing") {
    steps.push({ key: "cardinal", title: "Accepted", state: "current", lines: ["Cardinal is processing it"] });
  } else {
    steps.push({ key: "cardinal", title: "Accepted", state: "done", lines: [cs.kind === "none" ? "No Cardinal record (pre-dates the poller)" : "Accepted by Cardinal"] });
  }

  // Shipped
  if (shipped) {
    const lines = [
      [o.shipDate ? fmtDate(o.shipDate) : "", o.carrier].filter(Boolean).join(" · "),
      cs.kind === "partial" ? "Partially shipped — the rest is still to come" : "",
      o.tracking.length ? `${o.tracking.length} tracking number${o.tracking.length > 1 ? "s" : ""}` : "",
    ].filter(Boolean);
    steps.push({ key: "shipped", title: "Shipped", state: cs.kind === "partial" ? "note" : "done", lines: lines.length ? lines : ["Shipped"] });
  } else {
    steps.push({
      key: "shipped",
      title: "Shipped",
      state: "pending",
      lines: o.estimatedShipDate ? [`Estimated ship ${fmtDate(o.estimatedShipDate)}`] : [],
    });
  }

  // Delivered
  if (delivered) {
    const lines = [
      o.deliveryDate ? fmtDate(o.deliveryDate) : "",
      o.signedBy ? `Signed by ${o.signedBy}` : "",
    ].filter(Boolean);
    steps.push({ key: "delivered", title: "Delivered", state: "done", lines: lines.length ? lines : ["Delivered"] });
  } else {
    steps.push({ key: "delivered", title: "Delivered", state: "pending", lines: [] });
  }

  if (stage === "returns") {
    steps.push({ key: "returned", title: "Returned", state: "note", lines: [o.orderStatus || "In the Returns group"] });
  } else if (stage === "cancelled") {
    steps.push({ key: "cancelled", title: "Cancelled", state: "blocked", lines: [o.orderStatus || "In the Cancelled group"] });
  }

  return steps;
}
