/**
 * What the Welcome Call OOP card says for a Cash Pay patient.
 *
 * ⚠️ **Today it says `No rate schedule for "Cash Pay"`** — measured against the
 * live estimator, 2026-09-22. `PAYER_RATE_SCHEDULE` has no Cash Pay entry, and
 * correctly cannot: there is no payer, no deductible and no coinsurance to
 * schedule. So `estimateOop` returns `{ok: false}` and the card falls into its
 * generic branch and prints the reason verbatim — which reads as a missing
 * payer, i.e. a data problem somebody should go and fix, on the one card a rep
 * uses to tell a patient what they owe. Nothing is broken; the card simply has
 * no branch for the one patient whose answer is not an estimate at all.
 *
 * ⚠️⚠️ **IT IS A LINK, NOT A QUOTE — Josh's amendment, and the reason is the
 * stage.** The form here carries the products and quantities, so this card
 * COULD run `orders/cashPayPricing` and print a number. It must not: at Welcome
 * Call those quantities are still being negotiated on the call, so a figure
 * rendered here is one a rep reads to a patient and then changes. The price
 * becomes real on the ORDER, where `CashPayCard` prices it, mints the Stripe
 * session for that exact amount and honours it from then on
 * (`cashPayPricing.ts`). Two places quoting one patient two numbers is the
 * failure this avoids — and the second of them would be the one the patient
 * heard first.
 *
 * So: say there is nothing to estimate, and point at the costs.
 *
 * ⚠️⚠️ **ON THIS BOARD THE MARKER IS PRIMARY INSURANCE ALONE.** Welcome Call
 * has no General Insurance column (§5.30e, Josh 2026-09-14) and its `Patient`
 * type has no such field, so `isCashPayPatient` can only ever answer from the
 * second of the two columns it reads. Which makes the intake mirror
 * (`profile/cashPayIntake.cashPayMirrorEdit`) load-bearing rather than tidy:
 * a cash pay patient whose Primary Insurance was never mirrored across arrives
 * here indistinguishable from an insured one — and the same is true of the
 * Order board's cash pay card, which keys on the same column.
 */

/**
 * The in-app Cardinal SKU Tracker (§5.39i — the global header calls it
 * Inventory), as an absolute href for a NEW TAB.
 *
 * ⚠️ **`BASE_URL`, never a bare `/orders`.** The SPA is served from a repo
 * subpath on GitHub Pages and the router carries a `basename` (`App.tsx`), so
 * a root-relative href lands outside the app — on the org's Pages index — with
 * no error. React Router's own `<Link to>` applies the basename for you; a
 * plain `<a href>` does not, and a plain `<a>` is what a new tab needs.
 *
 * ⚠️ A NEW TAB is the point, not a flourish: the rep is mid-call on a form
 * holding unsaved edits, and navigating this tab away loses them.
 */
export const INVENTORY_HREF = `${import.meta.env.BASE_URL}orders?view=stock`;

export const CASH_PAY_OOP_TITLE = "Cash pay — no benefit to estimate";

export const CASH_PAY_OOP_NOTE =
  "There is no insurance on this patient, so nothing here is covered. Price the order from Cardinal's costs; the exact total is worked out on the order itself, where the payment link is generated.";

export const INVENTORY_LINK_LABEL = "Open Cardinal costs (Inventory)";
