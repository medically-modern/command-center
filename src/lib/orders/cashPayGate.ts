/**
 * A Cash Pay order cannot be placed with Cardinal until the money lands.
 *
 * Brandon's handoff (2026-08-18), item 5: *"Hard gate: a Cash Pay order cannot
 * be placed with Cardinal until payment lands ... the Ordered action should
 * hard-stop before that."* Confirmed by Josh, 2026-09-21, after he had briefly
 * said the reorder case could go ungated: **the full gate stands**, with a
 * manager override.
 *
 * ⚠️⚠️ **THE GATE READS THE PAYMENT COLUMNS, NOT THE "PAID CASH" LABEL** — and
 * that is the whole reason it is safe to reuse that label (Josh's call,
 * 2026-09-21). Order Status has carried a `Paid Cash` label (id 6) since long
 * before this build, and it is a TERMINAL marker on the two historical cash
 * orders: Debbie Hinze's sits at `Paid Cash` while the order is **Delivered**.
 * A gate keyed on the label alone would read her finished order as "paid,
 * ready to order" and offer to place it a second time. Stripe Charge ID and
 * Cash Pay Paid Date are written by one thing only — the
 * `checkout.session.completed` webhook — so they mean what they say.
 *
 * ⚠️ There is deliberately a way through. Janelle's note about Debbie is the
 * reason: *"she is older and does not have Venmo"* — patients pay by cheque and
 * over the phone, and a Stripe-only gate would leave those orders unplaceable
 * for ever, which is the dead end §5.10 · §5.20 · §5.31c · §5.31f · §5.39d
 * each record reversing. A MANAGER releases it with a typed reason, stamped
 * into the order's Notes with who and when. That stamp is the only record of
 * why goods went out against no Stripe payment, which is why the reason is
 * required rather than a confirm dialog.
 */

import { isCashPayPatient } from "../shared/cashPay";

/** What the gate needs off the order item. */
export interface CashPayGateInput {
  primaryInsurance?: string | null;
  generalInsurance?: string | null;
  /** `text_mm7dkma5`, written by the Stripe webhook. */
  stripeChargeId?: string | null;
  /** `date_mm7dejzt`, written by the Stripe webhook. */
  cashPayPaidDate?: string | null;
  /** `long_text_mm60y0ap` — where a manager's release is stamped. */
  notes?: string | null;
}

const has = (v: string | null | undefined) => (v ?? "").trim() !== "";

/** Is this a cash pay order at all? Orders carry Primary Insurance only. */
export function isCashPayOrder(o: CashPayGateInput): boolean {
  return isCashPayPatient({
    primaryInsurance: o.primaryInsurance ?? "",
    generalInsurance: o.generalInsurance ?? "",
  });
}

/**
 * Has a Stripe payment landed?
 *
 * Either column is enough: they are written in the same webhook, and requiring
 * both would strand an order on a half-written pair — which is the failure mode
 * of a system whose whole job is to not strand orders. Neither is written by
 * anything else.
 */
export function cashPayPaid(o: CashPayGateInput): boolean {
  return has(o.stripeChargeId) || has(o.cashPayPaidDate);
}

/**
 * The marker a manager's release leaves in Notes.
 *
 * ⚠️ Deliberately a distinctive bracketed prefix, matched as a substring — the
 * same shape as `[Proposed Stuck …]` (§5.9), so `noteStamp`'s date and initials
 * ride INSIDE the bracket and the marker survives any wording change after it.
 */
export const CASH_PAY_RELEASE_MARKER = "[Cash Pay Released";

export function hasCashPayRelease(notes: string | null | undefined): boolean {
  return (notes ?? "").includes(CASH_PAY_RELEASE_MARKER);
}

/**
 * The note body a release writes. The caller passes it to
 * `shared/noteStamp.appendStampedNote`, which adds the ET timestamp and the
 * releasing manager's initials — so this never stamps its own date.
 */
export function cashPayReleaseNote(reason: string): string {
  return `${CASH_PAY_RELEASE_MARKER}] ${reason.trim()}`;
}

/**
 * Why this cash pay order must not be placed yet — or "" when it may.
 *
 * Returns "" for every order that is NOT cash pay, so a caller can compose it
 * with the ordinary status rule without asking which kind of order it has.
 */
export function cashPayOrderingRefusal(o: CashPayGateInput): string {
  if (!isCashPayOrder(o)) return "";
  if (cashPayPaid(o)) return "";
  if (hasCashPayRelease(o.notes)) return "";
  return "No payment on file. A cash pay order can't go to Cardinal until the Stripe payment lands — send the payment link, or ask a manager to release it.";
}

/** Can this order be placed, payment considered? */
export function cashPayAllowsOrdering(o: CashPayGateInput): boolean {
  return cashPayOrderingRefusal(o) === "";
}

/**
 * Why the release button must not be offered — or "" when it may.
 *
 * ⚠️ Manager only, and a reason is REQUIRED. Josh, 2026-09-21. A rep alone
 * cannot send unpaid goods to Cardinal; the reason is the only trace of why an
 * order bypassed the payment it exists to collect.
 */
export function cashPayReleaseRefusal(
  o: CashPayGateInput,
  opts: { isManager: boolean; reason: string },
): string {
  if (!isCashPayOrder(o)) return "This isn't a cash pay order.";
  if (cashPayPaid(o)) return "This order is already paid — it doesn't need releasing.";
  if (hasCashPayRelease(o.notes)) return "This order has already been released.";
  if (!opts.isManager) return "Only a manager can release an unpaid cash pay order.";
  if (!opts.reason.trim()) return "Give a reason — it's the only record of why this went out unpaid.";
  return "";
}

/** How the card describes where the money is. */
export type CashPayPaymentState = "paid" | "released" | "linkSent" | "unpaid";

export function cashPayPaymentState(
  o: CashPayGateInput & { cashPayLinkSent?: string | null },
): CashPayPaymentState {
  if (cashPayPaid(o)) return "paid";
  if (hasCashPayRelease(o.notes)) return "released";
  if (has(o.cashPayLinkSent)) return "linkSent";
  return "unpaid";
}
