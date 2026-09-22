/**
 * The ordering switch.
 *
 * Josh, 2026-09-15: *"right now we order from the new order board. this is only
 * for observation, but someday we will flip the switch on letting them order
 * from this ui (they'd just flip to "ordered" — that does it) — just not today."*
 *
 * So the one write this role knows how to make — Order Status → "Ordered",
 * which is the webhook trigger that hands the item to cardinal-api-poller — is
 * built (`mondayWrite.markOrdered`) and DARK. `OrdersPage` renders the "Mark as
 * Ordered" button only when this is true; while it is false every order shows
 * the note that it is placed on the board, with the link.
 *
 * `orderingSwitch.test.ts` pins this at false. Flipping it is a decision, and
 * the test failing is the reminder to read the checklist in CLAUDE.md §5.35
 * before making it: the flip is a status CHANGE the board keys on, so the
 * write re-reads the column first and refuses anything that is not sitting at
 * "Order" (a second press on a placed order would otherwise be a silent no-op
 * — §9's advancer class — or, worse, re-order a copied item).
 */
export const ORDERING_FROM_COMMAND_CENTER = false;

/**
 * The cash pay link switch.
 *
 * The card's two presses — **Generate Cash Pay Link** and **Send to patient**
 * — reach outside this repo, and neither destination exists yet:
 *
 * 1. Generate calls `coins-form-payment`'s `POST /api/cash-pay/create-link`,
 *    which mints a **Stripe PAYMENT LINK** and writes Cash Pay Link + Cash Pay
 *    Amount back onto the order. That route is not built.
 *
 *    ⚠️⚠️ **A PAYMENT LINK, NOT A CHECKOUT SESSION — verified against Stripe's
 *    API reference, 2026-09-22.** A Checkout Session's `expires_at` "can be
 *    anywhere from 30 minutes to 24 hours after Checkout Session creation. By
 *    default, this value is 24 hours" — so a session URL texted to a patient is
 *    dead by the next morning, and the 15-day reminder loop the handoff asks
 *    for would be chasing a link that cannot be paid. A Payment Link has no
 *    expiry at all (it has `active` + `inactive_message` instead), takes
 *    inline `line_items[].price_data`, and **copies its `metadata` onto every
 *    Checkout Session it creates** — which is what carries `itemId` and
 *    `service: "cash-pay"` through to `checkout.session.completed`.
 *    The existing pay-secondary flow uses a Checkout Session correctly: there
 *    the patient is already on the page when it is minted.
 * 2. Send fires the order board's texting trigger, which needs a column and an
 *    automation the board does not have.
 *
 * ⚠️ So the buttons render INERT with the reason on screen rather than being
 * hidden — §5.39g's rule, and the one this codebase keeps having to reverse
 * (§5.10 · §5.20 · §5.31c · §5.31f · §5.39d): a control whose passing move is
 * invisible is worse than a control that says what it is waiting for. What
 * does NOT wait is the quote: the card prices the order today, so a rep on the
 * phone can read the patient their number and take payment another way.
 *
 * `cashPayCard.test.ts` pins this at false. Flip it only once BOTH halves are
 * live, and re-read CLAUDE.md §5.48 first — the Generate press spends money's
 * worth of trust: it mints a session for an amount a patient is then charged,
 * and the quote is honoured from that moment (`cashPayPricing.ts`).
 */
export const CASH_PAY_LINK_FROM_COMMAND_CENTER = false;
