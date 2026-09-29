/**
 * Brandon's order card (pixel-match Phase 2) — the rules that turn the orders
 * slice's answer into his pill words and his shipment blocks. Each of these
 * fails silently on screen: a wrong pill reads as a fact.
 */
import { describe, expect, it } from "vitest";
import { GROUPS } from "@/lib/orders/mondayApi";
import { mondayItemToOrder } from "@/lib/orders/mondayMapping";
import type { Order } from "@/lib/orders/workflow";
import { orderHeadline } from "@/lib/orders/headline";
import {
  isPreTracking,
  orderIsComplete,
  orderIsSettled,
  orderNumberLabel,
  orderPill,
  orderShipments,
  orderShipmentsFromLines,
  selectedOrderSentence,
} from "./orderCard";

/** A whole Order with every column blank — the mapping's own defaults. */
function order(over: Partial<Order> = {}): Order {
  const base = mondayItemToOrder({
    id: "1234567890",
    name: "Test Patient",
    group: { id: GROUPS.acceptedPartial },
    column_values: [],
  });
  return { ...base, ...over };
}

const placed = (over: Partial<Order> = {}) =>
  order({ orderStatus: "Process Claim", orderDate: "2026-09-01", cahOrderNumber: "1120000009", ...over });

describe("orderPill — his words, the slice's verdict", () => {
  it("delivered carries the delivery date", () => {
    expect(orderPill(placed({ apiStatus: "Delivered", deliveryDate: "2026-09-11" }))).toEqual({
      tone: "active",
      icon: "check",
      text: "Delivered 9/11/2026",
    });
  });

  it("⚠️ 'In transit' only when Cardinal SAYS shipped — a pre-poller row is just 'Shipped'", () => {
    expect(orderPill(placed({ apiStatus: "SHIPPED" })).text).toBe("In transit");
    // §5.35: 609 rows sit in Shipped/Delivered with no Cardinal record at all.
    const withDate = placed({ apiStatus: "", groupId: GROUPS.shippedDelivered, shipDate: "2025-12-03" });
    expect(orderPill(withDate)).toEqual({ tone: "blue", icon: "truck", text: "Shipped" });
  });

  it("⚠️ an order from before Cardinal records began is grey 'no tracking', never open work", () => {
    const pre = placed({ apiStatus: "", groupId: GROUPS.shippedDelivered, cahOrderNumber: "" });
    expect(isPreTracking(pre)).toBe(true);
    expect(orderPill(pre)).toEqual({ tone: "grey", icon: null, text: "Shipped · no tracking" });
    // No box is invented for it, and nothing says "not shipped yet".
    const v = orderShipments(pre);
    expect(v.boxes).toEqual([]);
    expect(v.notYet).toBeNull();
    expect(v.pending).toBeNull();
    // Not "complete" (nothing says it arrived) — but settled: not open work.
    expect(orderIsComplete(pre)).toBe(false);
    expect(orderIsSettled(pre)).toBe(true);
    expect(selectedOrderSentence(pre, { canSwap: true })).toBe(
      "Shipped · Before Cardinal records began — no tracking on file",
    );
  });

  it("⚠️ 'pre-tracking' is the slice's OWN line — held to the headline's", () => {
    // The mirror must not drift from `orderHeadline`, which draws the same
    // distinction in the /orders page's sentence.
    const cases = [
      placed({ apiStatus: "", groupId: GROUPS.shippedDelivered }),
      placed({ apiStatus: "", groupId: GROUPS.shippedDelivered, shipDate: "2025-12-03" }),
      placed({ apiStatus: "SHIPPED", groupId: GROUPS.shippedDelivered }),
      placed({ apiStatus: "", groupId: GROUPS.acceptedPartial }),
    ];
    for (const o of cases) {
      expect(isPreTracking(o)).toBe(orderHeadline(o).detail.startsWith("Before Cardinal records began"));
    }
  });

  it("partially shipped is his light green", () => {
    expect(orderPill(placed({ apiStatus: "Partially Shipped" }))).toMatchObject({
      tone: "lightgreen",
      text: "Partially shipped",
    });
  });

  it("a hold reads Cardinal's reason, in red", () => {
    const p = orderPill(
      placed({ apiStatus: "Order has been put on hold, Hold reason: Credit Check Failure, Please call" }),
    );
    expect(p).toMatchObject({ tone: "red", icon: "alert", text: "On hold — Credit Check Failure" });
  });

  it("the pre-placement statuses, cancelled and stuck", () => {
    expect(orderPill(order({ orderStatus: "Order" })).text).toBe("Waiting to be placed");
    expect(orderPill(order({ orderStatus: "On Hold" })).text).toBe("On hold");
    expect(orderPill(order({ groupId: GROUPS.cancelled })).text).toBe("Cancelled");
    expect(orderPill(order({ orderStatus: "Stuck" })).tone).toBe("red");
  });

  it("⚠️ a Cardinal label with no rule is printed VERBATIM, never guessed", () => {
    expect(orderPill(placed({ apiStatus: "Carrier Exception" })).text).toBe("Carrier Exception");
  });
});

describe("orderShipments — a shipment is a TRACKING NUMBER, never a guess", () => {
  it("one box, delivered: the items go in it, with the date and the signature", () => {
    const v = orderShipments(
      placed({
        apiStatus: "Delivered",
        deliveryDate: "2026-09-11",
        tracking: ["1Z999AA10123456784"],
        carrier: "UPS",
        signedBy: "FRONT DOOR",
      }),
    );
    expect(v.boxes).toHaveLength(1);
    expect(v.boxes[0]).toMatchObject({ n: 1, of: 1, signedBy: "FRONT DOOR", carrier: "UPS" });
    expect(v.boxes[0].pill.text).toBe("Delivered 9/11/2026");
    expect(v.boxes[0].url).toContain("ups.com");
    expect(v.itemsInBox).toBe(true);
    expect(v.pending).toBeNull();
    expect(v.notYet).toBeNull();
  });

  it("⚠️ two boxes: no date or signature on either, and the items are listed ONCE", () => {
    // The board holds one delivery date and one signature for the ORDER, and
    // nothing says which box carried what.
    const v = orderShipments(
      placed({ apiStatus: "Delivered", deliveryDate: "2026-09-11", tracking: ["111111111111", "222222222222"], signedBy: "X" }),
    );
    expect(v.boxes.map((b) => [b.n, b.of])).toEqual([[1, 2], [2, 2]]);
    expect(v.boxes.every((b) => b.pill.text === "Delivered")).toBe(true);
    expect(v.boxes.every((b) => b.signedBy === "")).toBe(true);
    expect(v.itemsInBox).toBe(false);
  });

  it("partially shipped: the box, then a block for what is still with Cardinal", () => {
    const v = orderShipments(
      placed({
        apiStatus: "Partially Shipped",
        tracking: ["123456789012"],
        backordered: 'AutoSoft 90 6mm 23" infusion sets',
        backorderedQty: "3",
        estimatedShipDate: "2026-09-30",
      }),
    );
    expect(v.boxes).toHaveLength(1);
    expect(v.boxes[0].of).toBe(2);
    expect(v.pending).toMatchObject({
      n: 2,
      of: 2,
      tone: "red",
      label: "Backordered",
      products: ['AutoSoft 90 6mm 23" infusion sets'],
      eta: "9/30/2026",
      qty: "3",
    });
    // Something is still to come, so no item is claimed to be in the box.
    expect(v.itemsInBox).toBe(false);
  });

  it("⚠️ the backordered column on a DELIVERED order is history, never a pending block", () => {
    // §5.35: a daily sweep writes it on every order, delivered ones included.
    const v = orderShipments(
      placed({ apiStatus: "Delivered", tracking: ["111111111111"], backordered: "Some set" }),
    );
    expect(v.pending).toBeNull();
    expect(v.itemsInBox).toBe(true);
  });

  it("nothing shipped yet: one 'not shipped yet' block carrying the order's own pill", () => {
    const v = orderShipments(placed({ apiStatus: "Accepted", estimatedShipDate: "2026-09-26" }));
    expect(v.boxes).toEqual([]);
    expect(v.pending).toBeNull();
    expect(v.notYet).toMatchObject({ eta: "9/26/2026", backordered: [] });
    expect(v.notYet?.pill.text).toBe("Accepted");
  });

  it("backordered before anything shipped: the still-to-come block, alone", () => {
    const v = orderShipments(placed({ apiStatus: "Backordered", backordered: "Set A" }));
    expect(v.boxes).toEqual([]);
    expect(v.pending).toMatchObject({ n: 1, of: 1, tone: "red", products: ["Set A"] });
    expect(v.notYet).toBeNull();
  });

  it("⚠️ a PARTIALLY SHIPPED order still shows what is to come — its stage is 'shipped'", () => {
    // `isOpenStage("shipped")` is false, and the first cut keyed on it: the
    // part that had not shipped simply was not drawn.
    const v = orderShipments(placed({ apiStatus: "Partially Shipped", groupId: GROUPS.acceptedPartial }));
    expect(v.pending).not.toBeNull();
    expect(v.boxes).toHaveLength(1);
  });

  it("⚠️ a returned order's box never says 'In transit'", () => {
    const v = orderShipments(
      order({ groupId: GROUPS.returns, orderStatus: "Return in Progress", apiStatus: "SHIPPED", tracking: ["123456789012"] }),
    );
    expect(v.boxes.map((b) => b.pill.text)).toEqual(["Shipped"]);
    expect(orderShipments(order({ groupId: GROUPS.cancelled })).notYet?.heading).toBe("Not shipped");
  });

  it("a substitution already ordered is amber; one still needed is red", () => {
    expect(orderShipments(placed({ apiStatus: "Substitution Ordered" })).pending).toMatchObject({ tone: "amber" });
    expect(orderShipments(placed({ apiStatus: "Substitution Needed" })).pending).toMatchObject({ tone: "red" });
  });

  it("partially shipped with no named product waits on Cardinal in amber, not red", () => {
    const v = orderShipments(placed({ apiStatus: "Partially Shipped", tracking: ["123456789012"] }));
    expect(v.pending).toMatchObject({ tone: "amber", label: "Waiting on Cardinal", products: [] });
  });

  it("a shipped order with no tracking number still gets one box", () => {
    const v = orderShipments(placed({ apiStatus: "SHIPPED", shipDate: "2026-09-10" }));
    expect(v.boxes).toHaveLength(1);
    expect(v.boxes[0]).toMatchObject({ track: "", url: null });
    expect(v.boxes[0].pill.text).toBe("In transit · shipped 9/10/2026");
  });
});

describe("complete, the sentence, the number", () => {
  it("complete is delivered, cancelled or a FINISHED return — shipped is still open", () => {
    expect(orderIsComplete(placed({ apiStatus: "Delivered" }))).toBe(true);
    expect(orderIsComplete(order({ groupId: GROUPS.cancelled }))).toBe(true);
    expect(orderIsComplete(order({ groupId: GROUPS.returns, orderStatus: "Return Complete" }))).toBe(true);
    expect(orderIsComplete(order({ groupId: GROUPS.returns, orderStatus: "Return in Progress" }))).toBe(false);
    expect(orderIsComplete(placed({ apiStatus: "SHIPPED" }))).toBe(false);
  });

  it("⚠️ the sentence only offers the swap when the swap is actually there", () => {
    // An OPEN backordered order, and the ability: the card offers the send.
    const bo = placed({ apiStatus: "Backordered", backordered: "Set A" });
    expect(selectedOrderSentence(bo, { canSwap: true })).toMatch(/can be swapped below/);
    expect(selectedOrderSentence(bo, { canSwap: false })).toBe("Part of it is still with Cardinal.");
    // Partially shipped is `shipped`, where the Substitution card offers no
    // send — so the sentence must not point at one.
    const part = placed({ apiStatus: "Partially Shipped", tracking: ["123456789012"], backordered: "Set A" });
    expect(selectedOrderSentence(part, { canSwap: true })).toBe("Part of it is still with Cardinal.");
    expect(selectedOrderSentence(placed({ apiStatus: "Delivered" }), { canSwap: true })).toBe(
      "Complete — nothing to do on it.",
    );
    expect(selectedOrderSentence(placed({ apiStatus: "Accepted" }), { canSwap: true })).toMatch(
      /^Still in progress · /,
    );
  });

  it("the number a rep reads out: Cardinal's, then the PO, then the item", () => {
    expect(orderNumberLabel({ cahOrderNumber: "1120000009", poNumber: "MM-1-20260901", id: "9" })).toBe(
      "#1120000009",
    );
    expect(orderNumberLabel({ cahOrderNumber: "", poNumber: "MM-1-20260901", id: "9" })).toBe("MM-1-20260901");
    expect(orderNumberLabel({ cahOrderNumber: "", poNumber: "", id: "1234567890" })).toBe("#7890");
  });
});

describe("orderShipmentsFromLines — each parcel WITH its items (Brandon, 2026-09-29)", () => {
  /* The shape of the order Brandon pointed at: the cartridges went in one
     parcel and arrived, the infusion sets are backordered. Tracking made up. */
  const PARTIAL = [
    "ORDER STATUS 9/29/2026, 11:00:48 ET",
    "L2 TN1002817I x3 BX @71.94 -> Backordered (BO: 3)",
    "L1 TN1013310I x3 BX @30.95 -> SHIPPED",
    "   SHIP FedEx 100000000001 qty 3 on 2026-09-15 from NEW JERSEY WAREHOUSE",
  ].join("\n");
  const partial = (over: Partial<Order> = {}) =>
    placed({
      apiStatus: "Partially Shipped",
      carrier: "FedEx",
      tracking: ["100000000001"],
      shipDate: "2026-09-15",
      deliveryDate: "2026-09-16",
      backordered: 'AutoSoft 90 6mm 23" infusion sets',
      lineItemDetail: PARTIAL,
      ...over,
    });

  it("⚠️ the not-yet-shipped part is never numbered as a shipment", () => {
    const v = orderShipmentsFromLines(partial())!;
    expect(v.parcels.map((p) => [p.n, p.of, p.track])).toEqual([[1, 1, "100000000001"]]);
    expect(v.parcels[0].items).toEqual([{ sku: "TN1013310I", qty: 3, substitute: false }]);
    expect(v.pending).toMatchObject({ tone: "red", label: "Backordered" });
    expect(v.pending!.items).toEqual([{ sku: "TN1002817I", qty: 3, status: "Backordered", dropped: false }]);
  });

  it("the one parcel of a partial order that ARRIVED says delivered, not in transit", () => {
    expect(orderShipmentsFromLines(partial())!.parcels[0].pill).toEqual({
      tone: "active",
      icon: "check",
      text: "Delivered 9/16/2026",
    });
    expect(orderShipmentsFromLines(partial({ deliveryDate: "" }))!.parcels[0].pill.text).toBe(
      "In transit · shipped 9/15/2026",
    );
  });

  it("a delivered order has nothing still to come", () => {
    const v = orderShipmentsFromLines(partial({ apiStatus: "Delivered", groupId: GROUPS.shippedDelivered }))!;
    expect(v.pending).toBeNull();
  });

  it("no line list, or a pre-tracking order → null (the card draws what it always drew)", () => {
    expect(orderShipmentsFromLines(partial({ lineItemDetail: "" }))).toBeNull();
    expect(
      orderShipmentsFromLines(
        placed({ apiStatus: "", groupId: GROUPS.shippedDelivered, cahOrderNumber: "", lineItemDetail: PARTIAL }),
      ),
    ).toBeNull();
  });

  it("⚠️ Cardinal says partial but the (older) list says nothing is left → the old view, never a hidden block", () => {
    const allShipped = "L1 TN1013310I x3 BX @30.95 -> SHIPPED\n   SHIP FedEx 100000000001 qty 3 on 2026-09-15 from NJ";
    expect(orderShipmentsFromLines(partial({ lineItemDetail: allShipped }))).toBeNull();
  });
});
