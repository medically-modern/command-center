import { describe, it, expect } from "vitest";
import { GROUPS } from "./mondayApi";
import {
  cardinalStatus, holdReasonFrom, orderStage, orderFlags, trackingUrl, orderMatchesQuery,
  ordersForSamePatient, orderTypeLabel, fmtDate, fmtMoney, qty, phoneDigits,
} from "./workflow";
import { mkOrder, placed, delivered, HOLD_SENTENCE, HOLD_RELEASED_SENTENCE, BOOKING_ERROR_SENTENCE } from "./fixtures";

describe("cardinalStatus — Cardinal's sentences, normalised", () => {
  it("reads the hold sentence into a reason", () => {
    const s = cardinalStatus(HOLD_SENTENCE);
    expect(s.kind).toBe("hold");
    expect(s.label).toBe("On hold — Credit Check Failure");
    expect(s.holdReason).toBe("Credit Check Failure");
    expect(s.detail).toBe(HOLD_SENTENCE);
  });

  it("a released hold with another applied is still a hold, on the NEW reason", () => {
    const s = cardinalStatus(HOLD_RELEASED_SENTENCE);
    expect(s.kind).toBe("hold");
    expect(s.holdReason).toBe("9999 Line Level Hold");
  });

  /* The live shape: API Status "Warning" while Hold Reason names the hold.
     The label alone would call it a mild warning. */
  it("a Hold Reason beside a soft status IS the answer", () => {
    expect(cardinalStatus("Warning", "Credit Check Failure").kind).toBe("hold");
    expect(cardinalStatus("Warning", "Credit Check Failure").label).toBe("On hold — Credit Check Failure");
    expect(cardinalStatus("Accepted", "Initial Review by Rep").kind).toBe("hold");
    expect(cardinalStatus("", "", HOLD_SENTENCE).kind).toBe("hold");
  });

  it("but a Hold Reason never downgrades a shipped or delivered order", () => {
    // The poller never clears the column, so delivered orders still carry the
    // hold that once delayed them.
    expect(cardinalStatus("Delivered", "Credit Check Failure").kind).toBe("delivered");
    expect(cardinalStatus("SHIPPED", "Credit Check Failure").kind).toBe("shipped");
    expect(cardinalStatus("Partially Shipped", "9999 Hold").kind).toBe("partial");
  });

  it("the rest of the vocabulary", () => {
    expect(cardinalStatus("").kind).toBe("none");
    expect(cardinalStatus("Warning").kind).toBe("warning");
    expect(cardinalStatus("Success").kind).toBe("accepted");
    expect(cardinalStatus("Working on it").kind).toBe("processing");
    expect(cardinalStatus(BOOKING_ERROR_SENTENCE).kind).toBe("error");
    expect(cardinalStatus("Needs Review").kind).toBe("review");
    expect(cardinalStatus("Backordered").kind).toBe("backordered");
    expect(cardinalStatus("Substitution Needed").kind).toBe("substitution");
    expect(cardinalStatus("Substitution Shipped").kind).toBe("shipped");
    expect(cardinalStatus("Deleted").kind).toBe("deleted");
  });

  it("prints an unrecognised label verbatim rather than bucketing it as fine", () => {
    const s = cardinalStatus("Some New Cardinal State");
    expect(s.kind).toBe("unknown");
    expect(s.label).toBe("Some New Cardinal State");
  });

  it("holdReasonFrom handles both capitalisations and stops at the comma", () => {
    expect(holdReasonFrom(HOLD_SENTENCE)).toBe("Credit Check Failure");
    expect(holdReasonFrom(HOLD_RELEASED_SENTENCE)).toBe("9999 Line Level Hold");
    expect(holdReasonFrom("Accepted")).toBe("");
  });
});

describe("orderStage — where an order is", () => {
  it("the pre-placement statuses", () => {
    expect(orderStage(mkOrder({ orderStatus: "Order" }))).toBe("toPlace");
    expect(orderStage(mkOrder({ orderStatus: "On Hold" }))).toBe("onHold");
    expect(orderStage(mkOrder({ orderStatus: "Stuck" }))).toBe("stuck");
    expect(orderStage(mkOrder({ orderStatus: "Ordered" }))).toBe("placing");
    expect(orderStage(mkOrder({ orderStatus: "" }))).toBe("other");
  });

  it("API Status beats the group for a placed order", () => {
    // 11 live rows: delivered while still in Accepted / Partial (the SHIPPED-
    // only move automation never saw them).
    expect(orderStage(placed({ apiStatus: "Delivered" }))).toBe("delivered");
    expect(orderStage(placed({ apiStatus: "Partially Shipped" }))).toBe("shipped");
    expect(orderStage(placed({ apiStatus: "SHIPPED" }))).toBe("shipped");
    // And holds sitting in Shipped/Delivered are still in progress.
    expect(orderStage(delivered({ apiStatus: HOLD_SENTENCE, deliveryDate: "" }))).toBe("inProgress");
    expect(orderStage(placed({ apiStatus: "Accepted" }))).toBe("inProgress");
    expect(orderStage(placed({ apiStatus: BOOKING_ERROR_SENTENCE }))).toBe("inProgress");
  });

  it("no Cardinal record: shipped if the board says so, otherwise placed and waiting", () => {
    // 609 pre-poller orders sit in Shipped/Delivered with a blank API Status.
    expect(orderStage(delivered({ apiStatus: "", deliveryDate: "" }))).toBe("shipped");
    expect(orderStage(placed({ apiStatus: "" }))).toBe("inProgress");
  });

  it("Ordered with a Cardinal verdict already on the item (a copied row)", () => {
    expect(orderStage(delivered({ orderStatus: "Ordered" }))).toBe("delivered");
  });

  it("returns and cancellations, by group or by status", () => {
    expect(orderStage(mkOrder({ groupId: GROUPS.returns, orderStatus: "Process Claim" }))).toBe("returns");
    expect(orderStage(delivered({ orderStatus: "Return Complete" }))).toBe("returns");
    expect(orderStage(mkOrder({ groupId: GROUPS.cancelled, orderStatus: "Stuck" }))).toBe("cancelled");
    expect(orderStage(placed({ apiStatus: "Deleted" }))).toBe("cancelled");
  });

  it("Paid Cash is a placed order like any other", () => {
    expect(orderStage(delivered({ orderStatus: "Paid Cash" }))).toBe("delivered");
  });
});

describe("orderFlags — what needs a person", () => {
  it("a held order is rose, with Cardinal's reason", () => {
    const f = orderFlags(placed({ apiStatus: "Warning", holdReason: "Credit Check Failure" }));
    expect(f.map((x) => x.id)).toEqual(["hold"]);
    expect(f[0].tone).toBe("rose");
    expect(f[0].label).toBe("On hold — Credit Check Failure");
  });

  it("availability flags only count while the order is open", () => {
    expect(orderFlags(placed({ backordered: "AutoSoft 90 6mm 23\" infusion sets" })).map((x) => x.id)).toContain("backordered");
    // The daily sweep writes the column on delivered orders too.
    expect(orderFlags(delivered({ backordered: "AutoSoft 90 6mm 23\" infusion sets" }))).toEqual([]);
    expect(orderFlags(placed({ inactiveProducts: "t:slim pump" })).map((x) => x.id)).toContain("inactive");
  });

  it("substitution: an error is rose, Sent is information", () => {
    expect(orderFlags(placed({ substitutionStatus: "Error: No SKU On Board" }))[0].tone).toBe("rose");
    expect(orderFlags(placed({ substitutionStatus: "Sent" }))[0].tone).toBe("sky");
  });

  it("the pre-check flags a to-place order, and only an unclean one", () => {
    expect(orderFlags(mkOrder({ preCheck: "Mismatch" })).map((x) => x.id)).toEqual(["precheck"]);
    expect(orderFlags(mkOrder({ preCheck: "Good to Go (fixed)" }))).toEqual([]);
    expect(orderFlags(placed({ preCheck: "Mismatch" }))).toEqual([]);
  });

  it("a healthy order has none", () => {
    expect(orderFlags(placed())).toEqual([]);
    expect(orderFlags(delivered())).toEqual([]);
  });
});

describe("trackingUrl", () => {
  it("keys on the number's shape", () => {
    expect(trackingUrl("1Z999AA10123456784")).toMatch(/ups\.com/);
    expect(trackingUrl("123456789012")).toMatch(/fedex\.com/);
    expect(trackingUrl("9400111899223197428490")).toMatch(/usps\.com/);
  });
  it("the Carrier column wins over the shape", () => {
    expect(trackingUrl("123456789012", "UPS")).toMatch(/ups\.com/);
  });
  it("says nothing rather than guess", () => {
    expect(trackingUrl("ABC")).toBeNull();
    expect(trackingUrl("")).toBeNull();
  });
});

describe("orderMatchesQuery", () => {
  const o = mkOrder({ name: "Jane Q Doe", phone: "15555550123", cahOrderNumber: "1121265988", poNumber: "MM-13045922552-20260915", tracking: ["1Z999AA10123456784", "1Z999AA10123456785"] });
  it("name words in any order, case-insensitive", () => {
    expect(orderMatchesQuery(o, "doe jane")).toBe(true);
    expect(orderMatchesQuery(o, "JANE")).toBe(true);
    expect(orderMatchesQuery(o, "smith")).toBe(false);
  });
  it("a phone with punctuation, and with or without the country code", () => {
    expect(orderMatchesQuery(o, "(555) 555-0123")).toBe(true);
    expect(orderMatchesQuery(o, "5550123")).toBe(true);
  });
  it("Cardinal order, PO and every tracking number", () => {
    expect(orderMatchesQuery(o, "1121265988")).toBe(true);
    expect(orderMatchesQuery(o, "MM-13045922552")).toBe(true);
    expect(orderMatchesQuery(o, "1Z999AA10123456785")).toBe(true);
  });
  it("an empty query matches everything", () => {
    expect(orderMatchesQuery(o, "  ")).toBe(true);
  });
});

describe("ordersForSamePatient", () => {
  const a = mkOrder({ id: "a", name: "Jane Doe", phone: "5555550100" });
  const b = mkOrder({ id: "b", name: "Jane Doe", phone: "" });
  const c = mkOrder({ id: "c", name: "J. Doe (copy)", phone: "15555550100" });
  const d = mkOrder({ id: "d", name: "Someone Else", phone: "5555550199" });
  it("joins on the phone first, then an exact name, never itself", () => {
    expect(ordersForSamePatient(a, [a, b, c, d]).map((o) => o.id).sort()).toEqual(["b", "c"]);
  });
});

describe("formatting", () => {
  it("dates are reformatted, never parsed (§9)", () => {
    expect(fmtDate("2026-09-05")).toBe("9/5/2026");
    expect(fmtDate("9/10/2026, 08:33 ET")).toBe("9/10/2026, 08:33 ET");
    expect(fmtDate("")).toBe("");
  });
  it("money and quantities", () => {
    expect(fmtMoney("3787.83")).toBe("$3,787.83");
    expect(fmtMoney("x")).toBe("x");
    expect(qty("")).toBeNull();
    expect(qty("0")).toBe(0);
    expect(qty("3")).toBe(3);
    expect(phoneDigits("+1 (555) 555-0100")).toBe("5555550100");
  });
});

describe("orderTypeLabel — 'First Order' only when the board doesn't contradict it", () => {
  const first = { id: "a", name: "Jane Doe", phone: "5555550100", orderType: "First Order", orderDate: "2026-09-15" };
  const earlier = { ...first, id: "old", orderDate: "2026-06-01" };
  const sameDay = { ...first, id: "twin" };
  const later = { ...first, id: "new", orderDate: "2026-10-01" };
  const other = { ...first, id: "x", name: "Someone Else", phone: "5555550199", orderDate: "2026-01-01" };

  it("shows it when this really is the patient's only order", () => {
    expect(orderTypeLabel(first, [first, other])).toBe("First Order");
  });

  it("drops it when the same patient has an EARLIER order", () => {
    expect(orderTypeLabel(first, [first, earlier])).toBe("");
  });

  it("drops it on BOTH of a same-day pair — one of them is wrong and we can't say which", () => {
    expect(orderTypeLabel(first, [first, sameDay])).toBe("");
    expect(orderTypeLabel(sameDay, [first, sameDay])).toBe("");
  });

  it("a LATER order is no contradiction — this one still was the first", () => {
    expect(orderTypeLabel(first, [first, later])).toBe("First Order");
  });

  it("a missing date on either side proves nothing, so the chip stands", () => {
    expect(orderTypeLabel({ ...first, orderDate: "" }, [first, earlier])).toBe("First Order");
    expect(orderTypeLabel(first, [first, { ...earlier, orderDate: "" }])).toBe("First Order");
  });

  it("'Reorder' and a blank are passed through untouched", () => {
    expect(orderTypeLabel({ ...first, orderType: "Reorder" }, [first, earlier])).toBe("Reorder");
    expect(orderTypeLabel({ ...first, orderType: "" }, [first])).toBe("");
  });
});
