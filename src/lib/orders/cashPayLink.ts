/**
 * The cash pay payment link's life: generate it, send it, watch for the money.
 *
 * Brandon's handoff (2026-08-18), items 2 and 6: the order board grows a
 * **Generate Cash Pay Link** action for cash pay patients; the link, the date
 * it was sent and the amount are saved on the order; the texting automation
 * and the co-insurance 15-day reminder loop are reused rather than rebuilt.
 *
 * ⚠️⚠️ **TWO PRESSES, DELIBERATELY** (Josh, 2026-09-21 — asked directly, and he
 * chose the pair over one button). Generating a link mints a Stripe Checkout
 * session for a specific amount; sending it puts that amount in front of the
 * patient. A rep must be able to read the quote, check it against what they
 * told the patient on the call, and only then send — which a single press
 * takes away. It is also what makes a WRONG quote recoverable: a generated,
 * unsent link costs nothing.
 *
 * ⚠️⚠️ **ONCE A LINK EXISTS, ITS AMOUNT IS THE PRICE — this module never
 * re-prices.** Tracker costs move daily (`skuwatch` scrapes at 9:05 ET) and
 * Stripe fixes the amount when the session is created, so an order quoted on
 * Monday is charged Monday's figure however Cardinal's cost moves before the
 * patient pays. The margin absorbs it (`cashPayPricing.ts` header, Josh's
 * call). `quoteDrift` therefore REPORTS a difference and never acts on one:
 * silently re-pricing would charge a patient a number nobody quoted them.
 */

import { cashPayPaid, hasCashPayRelease, type CashPayGateInput } from "./cashPayGate";

/** What the order carries about its link. */
export interface CashPayLinkInput extends CashPayGateInput {
  /** `text_mm7dzgzd` — the Stripe Checkout URL, written by the payment service. */
  cashPayLink?: string | null;
  /** `numeric_mm7devxs` — the amount the link was minted for, in dollars. */
  cashPayAmount?: string | null;
  /** `date_mm7d7wxe` — stamped when the link went to the patient. */
  cashPayLinkSent?: string | null;
}

const has = (v: string | null | undefined) => (v ?? "").trim() !== "";

/**
 * Where this order is in the flow. One value, so the card's heading, its
 * primary button and its colour cannot disagree about what is going on.
 */
export type CashPayLinkStep =
  /** The money has landed. Nothing left to press. */
  | "paid"
  /** A manager sent it to Cardinal unpaid, with a reason. */
  | "released"
  /** A link exists and has gone to the patient — we are waiting. */
  | "awaitingPayment"
  /** A link exists and has NOT been sent. The second press. */
  | "send"
  /** No link yet. The first press. */
  | "generate";

export function cashPayLinkStep(o: CashPayLinkInput): CashPayLinkStep {
  /* Paid first: it is the only terminal state, and a paid order must never
     offer to re-send a link for money already taken. Released next — a manager
     has already decided this one goes out unpaid, so pressing Send after that
     would ask a patient for money nobody is now waiting on. */
  if (cashPayPaid(o)) return "paid";
  if (hasCashPayRelease(o.notes)) return "released";
  if (!has(o.cashPayLink)) return "generate";
  return has(o.cashPayLinkSent) ? "awaitingPayment" : "send";
}

/**
 * Why Generate must not be pressed — or "" when it may.
 *
 * `quoteRefusal` is `cashPayQuote(...).refusal`: a line the tracker cannot
 * price refuses the whole quote, and it must refuse the link with it. Minting
 * a session for a total that silently omits a product the patient is about to
 * be shipped is the one failure this flow cannot have.
 */
export function generateRefusal(
  o: CashPayLinkInput,
  opts: { quoteRefusal: string; wired: boolean },
): string {
  const step = cashPayLinkStep(o);
  if (step === "paid") return "This order is already paid.";
  if (step === "released") return "A manager released this order — it isn't waiting on a payment.";
  if (opts.quoteRefusal) return opts.quoteRefusal;
  if (!opts.wired) return NOT_WIRED;
  return "";
}

/**
 * Why Send must not be pressed — or "" when it may.
 *
 * ⚠️ A phone number is REQUIRED, and that is not pedantry: the send is a text.
 * With no number the automation fires against nothing and the rep is told a
 * link went out that never did — the accepted-is-not-delivered class §5.5
 * records, one step earlier.
 */
export function sendRefusal(
  o: CashPayLinkInput & { phone?: string | null },
  opts: { wired: boolean },
): string {
  const step = cashPayLinkStep(o);
  if (step === "paid") return "This order is already paid.";
  if (step === "released") return "A manager released this order — it isn't waiting on a payment.";
  if (step === "generate") return "Generate the link first.";
  if (!has(o.phone)) return "No phone number on this order — the link goes out as a text.";
  if (!opts.wired) return NOT_WIRED;
  return "";
}

/** The one sentence both refusals use while the flow is dark (`config.ts`). */
export const NOT_WIRED =
  "Payment links aren't switched on yet — read the patient the total below and take payment the way you do today.";

/**
 * Has the order changed since its link was minted?
 *
 * Returns "" when it has not, or when there is no link to compare against.
 * ⚠️ REPORTING ONLY. The sent amount stands (see the header); what this buys
 * is a rep noticing that the products moved after the patient was quoted,
 * which is a conversation to have rather than a number to quietly change.
 */
export function quoteDrift(o: CashPayLinkInput, todayTotal: number): string {
  if (!has(o.cashPayLink)) return "";
  const minted = Number((o.cashPayAmount ?? "").toString().replace(/[$,\s]/g, ""));
  if (!Number.isFinite(minted) || minted <= 0) return "";
  if (Math.abs(minted - todayTotal) < 0.005) return "";
  return `This order prices at ${money(todayTotal)} today, but the link the patient has is for ${money(minted)}. The sent price stands — ${
    todayTotal > minted ? "the products or Cardinal's costs have gone up since" : "it has come down since"
  }.`;
}

/** $1,030.69 — the shape a rep reads aloud. */
export function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * What the card says is happening, in one line.
 *
 * ⚠️ It names the STATE, never the button: "Waiting on the patient" tells a rep
 * on a call what to say, where "Link sent" makes them work out whether that
 * means paid.
 */
export function cashPayHeadline(o: CashPayLinkInput): string {
  switch (cashPayLinkStep(o)) {
    case "paid":
      return "Paid — this order can go to Cardinal.";
    case "released":
      return "Released by a manager — this order can go to Cardinal unpaid.";
    case "awaitingPayment":
      return `Waiting on the patient${has(o.cashPayLinkSent) ? ` — link sent ${o.cashPayLinkSent}` : ""}.`;
    case "send":
      return "Link ready — not sent to the patient yet.";
    default:
      return "No payment link yet.";
  }
}
