import { describe, it, expect } from "vitest";
import { GROUPS } from "./mondayApi";
import { orderTimeline } from "./timeline";
import { mkOrder, placed, delivered, HOLD_SENTENCE } from "./fixtures";

const states = (o: Parameters<typeof orderTimeline>[0]) => orderTimeline(o).map((s) => `${s.key}:${s.state}`);

describe("orderTimeline", () => {
  it("a to-place order is created and waiting to be placed", () => {
    expect(states(mkOrder())).toEqual(["created:done", "placed:current", "cardinal:pending", "shipped:pending", "delivered:pending"]);
    expect(orderTimeline(mkOrder())[1].lines[0]).toMatch(/waiting to be placed on the order board/i);
  });

  it("on hold names the day it comes back", () => {
    const t = orderTimeline(mkOrder({ orderStatus: "On Hold", orderDate: "2026-09-20" }));
    expect(t[1].state).toBe("current");
    expect(t[1].lines[0]).toMatch(/9\/20\/2026/);
  });

  it("a hold blocks the Cardinal step — the node marks it, the headline carries the reason", () => {
    const t = orderTimeline(placed({ apiStatus: HOLD_SENTENCE }));
    expect(t.map((s) => s.state)).toEqual(["done", "done", "blocked", "pending", "pending"]);
    expect(t[2].lines).toEqual(["On hold"]);
  });

  it("an accepted order that has not shipped shows the estimate", () => {
    const t = orderTimeline(placed({ estimatedShipDate: "2026-09-16" }));
    expect(t[2].state).toBe("done");
    expect(t[3].state).toBe("pending");
    expect(t[3].lines[0]).toMatch(/Estimated ship 9\/16\/2026/);
  });

  it("partially shipped is a note on Shipped, not done", () => {
    const t = orderTimeline(placed({ apiStatus: "Partially Shipped", shipDate: "2026-09-12", carrier: "UPS", tracking: ["1Z1"] }));
    expect(t[3].state).toBe("note");
    expect(t[3].lines[0]).toBe("9/12/2026 · UPS");
    expect(t[3].lines).toContain("Partially shipped — the rest is still to come");
  });

  it("keeps each step to the fact, not the plumbing", () => {
    const t = orderTimeline(delivered({ lastCardinalSync: "9/10/2026, 08:33:48 ET", orderType: "First Order" }));
    // The date alone on Created — the order type is the header's, through
    // orderTypeLabel, which knows when "First Order" is contradicted.
    expect(t[0].lines).toEqual(["9/10/2026"]);
    // The Cardinal order number, never the poller's sync timestamp.
    expect(t[1].lines).toEqual(["Cardinal order 1100000002"]);
    // The tracking numbers are buttons in the header, not a count here.
    expect(t[3].lines).toEqual(["9/8/2026 · UPS"]);
  });

  it("delivered is done all the way down, with the date and nothing the headline already says", () => {
    const t = orderTimeline(delivered());
    expect(t.map((s) => s.state)).toEqual(["done", "done", "done", "done", "done"]);
    expect(t[4].lines).toEqual(["9/11/2026"]);
  });

  it("a pre-poller order says it has no Cardinal record rather than pretending", () => {
    const t = orderTimeline(mkOrder({ groupId: GROUPS.shippedDelivered, orderStatus: "Process Claim", apiStatus: "" }));
    expect(t[2].state).toBe("done");
    expect(t[2].lines[0]).toMatch(/No Cardinal record/);
    expect(t[3].state).toBe("done");
  });

  it("returns and cancellations add a terminal step", () => {
    expect(states(delivered({ orderStatus: "Return Complete" })).at(-1)).toBe("returned:note");
    expect(states(mkOrder({ groupId: GROUPS.cancelled, orderStatus: "Stuck" })).at(-1)).toBe("cancelled:blocked");
  });
});
