import { describe, it, expect } from "vitest";
import { GROUPS } from "./mondayApi";
import { orderHeadline } from "./headline";
import { orderFlags } from "./workflow";
import { mkOrder, placed, delivered, HOLD_SENTENCE, BOOKING_ERROR_SENTENCE } from "./fixtures";

describe("orderHeadline — the sentence a rep reads down the phone", () => {
  it("delivered: the date, then who signed", () => {
    expect(orderHeadline(delivered())).toEqual({ text: "Delivered 9/11/2026", detail: "Signed by FRONT DOOR", flagId: null });
  });

  it("shipped: the date and the carrier; partial says the rest is coming", () => {
    expect(orderHeadline(placed({ apiStatus: "SHIPPED", shipDate: "2026-09-08", carrier: "UPS" })).text).toBe("Shipped 9/8/2026 via UPS");
    const partial = orderHeadline(placed({ apiStatus: "Partially Shipped", shipDate: "2026-09-08" }));
    expect(partial.text).toBe("Partially shipped 9/8/2026");
    expect(partial.detail).toMatch(/rest is still to come/);
  });

  it("a pre-poller order says so rather than inventing a tracking number", () => {
    const h = orderHeadline(mkOrder({ groupId: GROUPS.shippedDelivered, orderStatus: "Process Claim" }));
    expect(h.text).toBe("Shipped");
    expect(h.detail).toMatch(/no tracking on file/i);
  });

  it("before Cardinal has it: waiting, on hold until a date, being placed", () => {
    expect(orderHeadline(mkOrder())).toEqual({ text: "Waiting to be placed", detail: "Created 9/10/2026", flagId: null });
    expect(orderHeadline(mkOrder({ orderStatus: "On Hold", orderDate: "2026-09-20" })).text).toBe("On hold until 9/20/2026");
    expect(orderHeadline(mkOrder({ orderStatus: "Ordered" })).text).toBe("Being placed with Cardinal");
  });

  it("placed: accepted, processing, or still waiting for an answer", () => {
    expect(orderHeadline(placed()).text).toBe("Accepted by Cardinal — not shipped yet");
    expect(orderHeadline(placed({ estimatedShipDate: "2026-09-16" })).detail).toBe("Estimated ship 9/16/2026");
    expect(orderHeadline(placed({ apiStatus: "Working on it" })).text).toBe("Cardinal is processing it");
    expect(orderHeadline(placed({ apiStatus: "" })).text).toBe("Placed — waiting for Cardinal");
  });

  it("a problem IS the headline, and names the flag it stands in for", () => {
    const held = placed({ apiStatus: HOLD_SENTENCE });
    expect(orderHeadline(held)).toEqual({ text: "On hold at Cardinal — Credit Check Failure", detail: "", flagId: "hold" });
    expect(orderHeadline(placed({ apiStatus: BOOKING_ERROR_SENTENCE })).flagId).toBe("error");
    expect(orderHeadline(placed({ apiStatus: "Needs Review" })).flagId).toBe("review");
    const bo = orderHeadline(placed({ apiStatus: "Backordered", backordered: 'AutoSoft 90 6mm 23" infusion sets' }));
    expect(bo.text).toBe("Backordered at Cardinal");
    expect(bo.detail).toBe('AutoSoft 90 6mm 23" infusion sets');
    expect(bo.flagId).toBe("backordered");
  });

  it("every flagId it names is a flag orderFlags actually raises on that order", () => {
    const cases = [
      placed({ apiStatus: HOLD_SENTENCE }),
      placed({ apiStatus: BOOKING_ERROR_SENTENCE }),
      placed({ apiStatus: "Needs Review" }),
      placed({ apiStatus: "Backordered" }),
      placed({ apiStatus: "Substitution Needed" }),
    ];
    for (const o of cases) {
      const id = orderHeadline(o).flagId;
      expect(id).not.toBeNull();
      expect(orderFlags(o).map((f) => f.id)).toContain(id);
    }
  });

  it("an unrecognised Cardinal label is printed verbatim, never smoothed over", () => {
    expect(orderHeadline(placed({ apiStatus: "Some New Status" })).text).toBe("Some New Status");
  });

  it("terminal states", () => {
    expect(orderHeadline(mkOrder({ groupId: GROUPS.cancelled })).text).toBe("Cancelled");
    expect(orderHeadline(mkOrder({ groupId: GROUPS.returns, orderStatus: "Return in Progress" })).text).toBe("Return in progress");
    expect(orderHeadline(mkOrder({ groupId: GROUPS.returns, orderStatus: "Return Complete" })).text).toBe("Returned");
    expect(orderHeadline(mkOrder({ orderStatus: "Stuck" })).text).toBe("Stuck on the order board");
  });
});
