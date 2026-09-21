import { describe, it, expect } from "vitest";
import {
  isCashPayOrder, cashPayPaid, cashPayOrderingRefusal, cashPayAllowsOrdering,
  cashPayReleaseRefusal, cashPayReleaseNote, hasCashPayRelease,
  cashPayPaymentState, CASH_PAY_RELEASE_MARKER,
} from "./cashPayGate";
import { placeabilityReason, canMarkOrdered, orderingRefusal } from "./mondayWrite";

const cash = { primaryInsurance: "Cash Pay" };
const insured = { primaryInsurance: "Aetna Commercial" };

describe("the gate blocks an unpaid cash pay order", () => {
  it("refuses with no payment on file", () => {
    expect(cashPayOrderingRefusal(cash)).toMatch(/No payment on file/);
    expect(cashPayAllowsOrdering(cash)).toBe(false);
  });

  it("allows it once Stripe writes the charge id", () => {
    expect(cashPayAllowsOrdering({ ...cash, stripeChargeId: "pi_3abc" })).toBe(true);
  });

  it("allows it on the paid date alone — the pair can be half-written", () => {
    expect(cashPayAllowsOrdering({ ...cash, cashPayPaidDate: "2026-09-23" })).toBe(true);
  });

  it("⚠️ NEVER touches an insured order", () => {
    expect(cashPayOrderingRefusal(insured)).toBe("");
    expect(cashPayOrderingRefusal({})).toBe("");
    expect(cashPayAllowsOrdering(insured)).toBe(true);
  });

  it("blank or whitespace payment columns are not payment", () => {
    expect(cashPayAllowsOrdering({ ...cash, stripeChargeId: "   " })).toBe(false);
    expect(cashPayAllowsOrdering({ ...cash, cashPayPaidDate: "" })).toBe(false);
  });
});

describe("⚠️ the gate reads the PAYMENT COLUMNS, not the Paid Cash label", () => {
  /* This is the whole reason reusing label id 6 is safe. Debbie Hinze's order
     sits at Order Status "Paid Cash" while the order is Delivered — it was set
     by hand months ago. A label-keyed gate would read her finished order as
     ready to place. */
  it("a Paid Cash label with no payment columns is still unpaid", () => {
    expect(cashPayPaid({ ...cash })).toBe(false);
    expect(cashPayOrderingRefusal({ ...cash })).toMatch(/No payment on file/);
  });

  it("Debbie's delivered order is refused by its CAH number", () => {
    /* Positive evidence it has been to Cardinal, whatever the status says. */
    expect(placeabilityReason("Paid Cash", { cahOrderNumber: "1120157406" }))
      .toMatch(/already been placed/);
    expect(canMarkOrdered("Paid Cash", { cahOrderNumber: "1120157406" })).toBe(false);
  });

  it("a freshly paid cash order — Paid Cash, no CAH number — IS placeable", () => {
    expect(placeabilityReason("Paid Cash")).toBe("");
    expect(canMarkOrdered("Paid Cash", { cahOrderNumber: "" })).toBe(true);
  });

  it("a CAH number refuses even a status that would otherwise pass", () => {
    expect(canMarkOrdered("Order", { cahOrderNumber: "1120157406" })).toBe(false);
  });
});

describe("the two rules compose", () => {
  it("an unpaid cash order at Order is refused for the MONEY, not the status", () => {
    const r = orderingRefusal({ orderStatus: "Order", ...cash });
    expect(r).toMatch(/No payment on file/);
  });

  it("a paid cash order at Paid Cash passes both", () => {
    expect(orderingRefusal({
      orderStatus: "Paid Cash", ...cash, stripeChargeId: "pi_3abc",
    })).toBe("");
  });

  it("the status rule still wins where it applies", () => {
    expect(orderingRefusal({
      orderStatus: "On Hold", ...cash, stripeChargeId: "pi_3abc",
    })).toMatch(/on hold/);
  });

  it("an insured order is judged on status alone, exactly as before", () => {
    expect(orderingRefusal({ orderStatus: "Order", ...insured })).toBe("");
    expect(orderingRefusal({ orderStatus: "Process Claim", ...insured }))
      .toMatch(/already been placed/);
  });
});

describe("the manager override — there must be a way through", () => {
  /* Janelle on Debbie: "she is older and does not have Venmo". Patients pay by
     cheque and over the phone; a Stripe-only gate would leave those orders
     unplaceable for ever. */
  const release = { notes: `[8/19/26, 2:14 PM · ${CASH_PAY_RELEASE_MARKER}] Paid by cheque —JH` };

  it("a stamped release opens the gate", () => {
    expect(hasCashPayRelease(release.notes)).toBe(true);
    expect(cashPayAllowsOrdering({ ...cash, ...release })).toBe(true);
  });

  it("⚠️ a rep cannot release — manager only", () => {
    expect(cashPayReleaseRefusal(cash, { isManager: false, reason: "Paid by cheque" }))
      .toMatch(/Only a manager/);
  });

  it("⚠️ a reason is required — it is the only record of why", () => {
    expect(cashPayReleaseRefusal(cash, { isManager: true, reason: "   " }))
      .toMatch(/Give a reason/);
    expect(cashPayReleaseRefusal(cash, { isManager: true, reason: "Paid by cheque" }))
      .toBe("");
  });

  it("refuses to release what is already paid or already released", () => {
    expect(cashPayReleaseRefusal({ ...cash, stripeChargeId: "pi_1" }, { isManager: true, reason: "x" }))
      .toMatch(/already paid/);
    expect(cashPayReleaseRefusal({ ...cash, ...release }, { isManager: true, reason: "x" }))
      .toMatch(/already been released/);
  });

  it("refuses to release an insured order", () => {
    expect(cashPayReleaseRefusal(insured, { isManager: true, reason: "x" }))
      .toMatch(/isn't a cash pay order/);
  });

  it("the note carries the marker and the reason, and stamps no date of its own", () => {
    const n = cashPayReleaseNote("  Paid by cheque, cleared 8/19  ");
    expect(n).toBe(`${CASH_PAY_RELEASE_MARKER}] Paid by cheque, cleared 8/19`);
    /* noteStamp adds the ET timestamp and initials INSIDE the bracket — this
       must not add its own, or every line carries two dates. */
    expect(n).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{2}/);
  });
});

describe("what the card says about the money", () => {
  it("names each state", () => {
    expect(cashPayPaymentState({ ...cash })).toBe("unpaid");
    expect(cashPayPaymentState({ ...cash, cashPayLinkSent: "2026-09-21" })).toBe("linkSent");
    expect(cashPayPaymentState({ ...cash, stripeChargeId: "pi_1" })).toBe("paid");
    expect(cashPayPaymentState({
      ...cash, notes: `x ${CASH_PAY_RELEASE_MARKER}] y`,
    })).toBe("released");
  });

  it("paid outranks a link having been sent", () => {
    expect(cashPayPaymentState({
      ...cash, cashPayLinkSent: "2026-09-21", stripeChargeId: "pi_1",
    })).toBe("paid");
  });
});

describe("isCashPayOrder", () => {
  it("reads either payer column, exactly", () => {
    expect(isCashPayOrder({ primaryInsurance: "Cash Pay" })).toBe(true);
    expect(isCashPayOrder({ generalInsurance: "cash pay" })).toBe(true);
    expect(isCashPayOrder({ primaryInsurance: "Cash Payment Plan" })).toBe(false);
    expect(isCashPayOrder({})).toBe(false);
  });
});
