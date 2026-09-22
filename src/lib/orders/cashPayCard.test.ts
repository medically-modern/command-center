import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CASH_PAY_LINK_FROM_COMMAND_CENTER } from "./config";
import {
  cashPayHeadline, cashPayLinkStep, generateRefusal, money, NOT_WIRED, quoteDrift, sendRefusal,
} from "./cashPayLink";
import { CASH_PAY_RELEASE_MARKER } from "./cashPayGate";

const cash = { primaryInsurance: "Cash Pay", phone: "5555550100" };
const LINK = "https://checkout.stripe.com/c/pay/cs_test_abc";

describe("where the money has got to", () => {
  it("walks generate → send → awaiting → paid", () => {
    expect(cashPayLinkStep({ ...cash })).toBe("generate");
    expect(cashPayLinkStep({ ...cash, cashPayLink: LINK })).toBe("send");
    expect(cashPayLinkStep({ ...cash, cashPayLink: LINK, cashPayLinkSent: "2026-09-22" }))
      .toBe("awaitingPayment");
    expect(cashPayLinkStep({ ...cash, cashPayLink: LINK, cashPayLinkSent: "2026-09-22", stripeChargeId: "pi_1" }))
      .toBe("paid");
  });

  it("⚠️ PAID outranks everything — a paid order never offers to ask again", () => {
    expect(cashPayLinkStep({ ...cash, cashPayPaidDate: "2026-09-23" })).toBe("paid");
    expect(generateRefusal({ ...cash, cashPayPaidDate: "2026-09-23" }, { quoteRefusal: "", wired: true }))
      .toMatch(/already paid/);
    expect(sendRefusal({ ...cash, cashPayLink: LINK, cashPayPaidDate: "2026-09-23" }, { wired: true }))
      .toMatch(/already paid/);
  });

  it("a manager's release also stops the asking", () => {
    const released = { ...cash, notes: `[Sep 22, 2026, 9:00 AM] ${CASH_PAY_RELEASE_MARKER}] cheque —JH` };
    expect(cashPayLinkStep(released)).toBe("released");
    expect(sendRefusal({ ...released, cashPayLink: LINK }, { wired: true })).toMatch(/released/);
  });

  it("names the state rather than the button", () => {
    expect(cashPayHeadline({ ...cash })).toMatch(/No payment link/);
    expect(cashPayHeadline({ ...cash, cashPayLink: LINK })).toMatch(/not sent/);
    expect(cashPayHeadline({ ...cash, cashPayLink: LINK, cashPayLinkSent: "2026-09-22" }))
      .toMatch(/Waiting on the patient/);
    expect(cashPayHeadline({ ...cash, stripeChargeId: "pi_1" })).toMatch(/^Paid/);
  });
});

describe("what refuses each press", () => {
  it("a quote we can't stand behind refuses the link", () => {
    /* ⚠️ The whole point: a line the tracker can't price refuses the QUOTE
       (cashPayPricing), and it must refuse the link with it — a session minted
       for a total that omits a product is a patient charged for less than they
       are shipped. */
    expect(generateRefusal(cash, { quoteRefusal: "Dexcom G7 isn't on the tracker", wired: true }))
      .toBe("Dexcom G7 isn't on the tracker");
  });

  it("Send needs a link first", () => {
    expect(sendRefusal(cash, { wired: true })).toMatch(/Generate the link first/);
  });

  it("⚠️ Send needs a PHONE — the link goes out as a text", () => {
    expect(sendRefusal({ ...cash, phone: "", cashPayLink: LINK }, { wired: true }))
      .toMatch(/No phone number/);
  });

  it("both say the same thing while the flow is dark", () => {
    expect(generateRefusal(cash, { quoteRefusal: "", wired: false })).toBe(NOT_WIRED);
    expect(sendRefusal({ ...cash, cashPayLink: LINK }, { wired: false })).toBe(NOT_WIRED);
  });

  it("nothing refuses them once wired and priced", () => {
    expect(generateRefusal(cash, { quoteRefusal: "", wired: true })).toBe("");
    expect(sendRefusal({ ...cash, cashPayLink: LINK }, { wired: true })).toBe("");
  });
});

describe("⚠️ a sent quote is never re-priced, only reported on", () => {
  /* Tracker costs move daily and Stripe fixes the amount when the session is
     created (§5.48). Silently re-pricing would charge a patient a number
     nobody quoted them. */
  it("says nothing when the price has not moved", () => {
    expect(quoteDrift({ ...cash, cashPayLink: LINK, cashPayAmount: "1030.69" }, 1030.69)).toBe("");
  });

  it("says nothing at all when there is no link to compare against", () => {
    expect(quoteDrift({ ...cash }, 1030.69)).toBe("");
    expect(quoteDrift({ ...cash, cashPayLink: LINK, cashPayAmount: "" }, 1030.69)).toBe("");
  });

  it("names both numbers and which one stands", () => {
    const up = quoteDrift({ ...cash, cashPayLink: LINK, cashPayAmount: "1030.69" }, 1055.10);
    expect(up).toContain("$1,030.69");
    expect(up).toContain("$1,055.10");
    expect(up).toMatch(/sent price stands/);
    expect(up).toMatch(/gone up/);
    expect(quoteDrift({ ...cash, cashPayLink: LINK, cashPayAmount: "$1,030.69" }, 1000)).toMatch(/come down/);
  });
});

describe("money reads the way a rep says it", () => {
  it("is Debbie's quote to the cent", () => {
    expect(money(1030.69)).toBe("$1,030.69");
  });
});

/**
 * The switch, and the wiring the card depends on. A source scan (the
 * `listColumns.test.ts` convention) because every one of these fails SILENTLY:
 * a card that stops being mounted, or quietly grows an ability gate, looks
 * exactly like a cash pay order that has nothing to pay.
 */
describe("the cash pay link switch, and how the card is mounted", () => {
  const page = readFileSync("src/pages/OrdersPage.tsx", "utf8");
  const card = readFileSync("src/components/orders/CashPayCard.tsx", "utf8");

  it("is OFF — flipping it is a decision (config.ts has the checklist)", () => {
    expect(CASH_PAY_LINK_FROM_COMMAND_CENTER).toBe(false);
  });

  it("the card is mounted on the open order", () => {
    expect(page).toMatch(/<CashPayCard\b/);
    expect(page).toMatch(/import \{ CashPayCard \}/);
  });

  it("⚠️ and is NOT ability-gated — Josh: “No gate — any rep”", () => {
    /* ⚠️ The window runs BOTH WAYS around the mount. A gate wraps a card, so
       it lands BEFORE the tag — a scan that only looked forward passed while
       the card sat inside an <AbilityGate>, which is the exact regression this
       assertion exists to catch. */
    const at = page.indexOf("<CashPayCard");
    expect(at).toBeGreaterThan(-1);
    const around = page.slice(Math.max(0, at - 400), at + 300);
    expect(around).not.toMatch(/AbilityGate|canAdjustOrders|hasAbility/);
  });

  it("⚠️ keyed on the order, so a typed release reason can't follow a click", () => {
    expect(page).toMatch(/<CashPayCard key=\{open\.id\}/);
  });

  it("⚠️ the RELEASE is manager-only, which is the different question", () => {
    expect(card).toMatch(/access\.type === "manager"/);
    expect(card).toMatch(/releaseCashPayOrder/);
  });

  it("⚠️ renders nothing for an insured order", () => {
    expect(card).toMatch(/if \(!isCashPayOrder\(order\)\) return null;/);
  });

  it("⚠️ a press enabled with no endpoint refuses LOUDLY, never silently", () => {
    expect(card).toMatch(/notBuilt/);
    expect(card).toMatch(/onClick=\{notBuilt\}/);
  });
});
