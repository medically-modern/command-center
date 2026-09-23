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

  /* ✅ ON since 2026-09-22, behind monday webhooks 641115241 (mint) and
     641125712 (text), both proved end to end on a throwaway order: a real
     pay.medicallymodern.com link, a real SMS (RingCentral messageId
     3313052761012), the sent date stamped and the trigger cleared each time.

     If this fails, somebody turned it off. That is a SAFE state — the buttons
     go inert with the reason on screen and the quote keeps rendering, so a rep
     can still price the order — but confirm it was deliberate, and read
     config.ts for what has to be live before turning it back on. */
  it("is ON — both webhooks are live and were verified end to end", () => {
    expect(CASH_PAY_LINK_FROM_COMMAND_CENTER).toBe(true);
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
    // ⚠️ The key is PREFIXED because this card and `SubstitutionCard` are
    // siblings: two children of one parent both carrying `key={open.id}`
    // collide, and React warns they "may be duplicated and/or omitted".
    // What matters here is unchanged — the key still carries `open.id`, so a
    // sidebar click still remounts the card and drops the typed reason.
    expect(page).toMatch(/<CashPayCard key=\{`cash-\$\{open\.id\}`\}/);
    expect(page).toMatch(/<SubstitutionCard key=\{`sub-\$\{open\.id\}`\}/);
  });

  it("⚠️ the RELEASE is manager-only, which is the different question", () => {
    expect(card).toMatch(/access\.type === "manager"/);
    expect(card).toMatch(/releaseCashPayOrder/);
  });

  it("⚠️ renders nothing for an insured order", () => {
    expect(card).toMatch(/if \(!isCashPayOrder\(order\)\) return null;/);
  });

  it("⚠️ a press enabled with no endpoint refuses LOUDLY, never silently", () => {
    /* The presses call real handlers now, so the guard moved INSIDE them:
       every one opens by checking the switch and falling back to the loud
       refusal. Flipping the flag before the board automation exists would
       otherwise enable a button that does nothing at all — the silent no-op
       class §9 records costing five days of a rep re-pressing Advance. */
    expect(card).toMatch(/notBuilt/);
    const guards = card.match(/if \(!wired\) return notBuilt\(\);/g) ?? [];
    expect(guards.length).toBe(2);
  });

  it("⚠️ both presses are wired to a handler, not to a toast", () => {
    expect(card).toMatch(/onClick=\{\(\) => void generate\(\)\}/);
    expect(card).toMatch(/onClick=\{\(\) => void send\(\)\}/);
  });

  it("⚠️ the watcher is cancelled when the order changes", () => {
    /* It is bound to the order that was open when the press was made, so one
       surviving a sidebar click paints the PREVIOUS order's link onto this
       card — §5.5's `useDeliveryRecheck` rule, with a payment on it. */
    const at = card.indexOf("if (forId.current !== order.id)");
    expect(at).toBeGreaterThan(-1);
    expect(card.slice(at, at + 500)).toMatch(/watch\.current\.cancelled = true/);
  });
});

/**
 * The two writers. Source scans again: every one of these fails silently on a
 * board that answers 200 to a write it then discards.
 */
describe("⚠️ the board is the trigger, and what that costs", () => {
  const write = readFileSync("src/lib/orders/mondayWrite.ts", "utf8");
  const api = readFileSync("src/lib/orders/mondayApi.ts", "utf8");

  it("Generate is a VERIFIED write with the action column held back", () => {
    /* Monday returns 200 on the amount before it is indexed, and the webhook
       reads that very cell the instant the automation fires (§5.2). */
    const at = write.indexOf("export async function generateCashPayLink");
    expect(at).toBeGreaterThan(-1);
    const body = write.slice(at, write.indexOf("export async function sendCashPayLink"));
    expect(body).toMatch(/executeWritesWithVerification/);
    expect(body).toMatch(/stageColumnId: COL\.cashPayAction/);
    expect(body).toMatch(/expectedText: amount/);
  });

  it("⚠️ it refuses an order that already has a link, rather than re-pricing it", () => {
    /* Once a link exists its amount IS the price: writing a new amount beside
       an unchanged link leaves the board stating a figure Stripe will not
       charge. Replacing one is a deliberate, visible act. */
    const at = write.indexOf("export async function generateCashPayLink");
    const body = write.slice(at, write.indexOf("export async function sendCashPayLink"));
    expect(body).toMatch(/readColumnText\(itemId, COL\.cashPayLink\)/);
    expect(body).toMatch(/already has a payment link/);
  });

  it("⚠️ both presses CLEAR the trigger when it already holds a value", () => {
    /* Monday takes a status write onto its own value at 200, fires nothing and
       records no activity (§9) — so a chase, or a retry after a failure, would
       be a silent no-op with a green toast on top. */
    const clears = write.match(/if \(action\.trim\(\)\) await clearStatus\(itemId, COL\.cashPayAction\);/g) ?? [];
    expect(clears.length).toBe(2);
  });

  it("⚠️ the label ids are the ones monday assigned, not the ones asked for", () => {
    /* Read back from the live `settings_str` on 2026-09-22 — monday derives a
       new label's id from its COLOUR, which is why these are 0 / 3 / 2. A
       write to an id the column does not have is dropped at 200. */
    expect(api).toMatch(/cashPayAction: "color_mm7e3rxj"/);
    const at = api.indexOf("export const CASH_PAY_ACTION_INDEX");
    const body = api.slice(at, at + 200);
    expect(body).toMatch(/generate: 0/);
    expect(body).toMatch(/send: 3/);
    expect(body).toMatch(/failed: 2/);
  });

  it("⚠️ nothing in the app writes “Link failed” — that is the service's word", () => {
    /* It is how a refused mint reaches a rep at all; the app writing it would
       be the app reporting on a service it never heard from. */
    expect(write).not.toMatch(/CASH_PAY_ACTION_INDEX\.failed/);
  });
});
