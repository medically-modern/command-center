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
 * ⚠️⚠️ **THE BOARD IS THE TRIGGER — nothing here calls Stripe or holds a token**
 * (Josh, 2026-09-21: *"do that route, it works perfectly fine dont mess it
 * up"*, choosing coins' own mechanism over an API call from the browser):
 *
 *   Generate  ─▶ Cash Pay Amount, verified, then Cash Pay Action "Generate
 *                link" ─▶ board automation ─▶ webhook to coins-form-payment
 *                ─▶ it mints a **Stripe PAYMENT LINK** and writes Cash Pay
 *                Link back.
 *   Send      ─▶ Cash Pay Action "Send to patient" ─▶ board automation texts
 *                it from the RC number and stamps Cash Pay Link Sent.
 *
 * ⚠️⚠️ **A PAYMENT LINK, NOT A CHECKOUT SESSION — verified against Stripe's API
 * reference, 2026-09-22.** A Checkout Session's `expires_at` "can be anywhere
 * from 30 minutes to 24 hours after Checkout Session creation. By default, this
 * value is 24 hours" — so a session URL texted to a patient is dead by the next
 * morning, and the 15-day reminder loop the handoff asks for would be chasing a
 * link that cannot be paid. A Payment Link has no expiry at all (`active` +
 * `inactive_message` instead), takes inline `line_items[].price_data`, and
 * **copies its `metadata` onto every Checkout Session it creates** — which is
 * what carries `itemId` and `service: "cash-pay"` through to
 * `checkout.session.completed`. The pay-secondary flow uses a Checkout Session
 * correctly: there the patient is already on the page when it is minted.
 *
 * ⚠️ **The cost of the board route is the ITEMISATION.** A monday webhook
 * carries an item id and a status label, so the only price that service can see
 * is Cash Pay Amount — one number — and the Stripe page shows one line rather
 * than the three products quoted. The total is identical; rebuilding the lines
 * over there would be a second copy of the pricing rule in a second repo, whose
 * drift is a patient charged an amount no screen ever showed. The itemised
 * route (`POST /api/cash-pay/create-link`) is built and tested and is simply
 * not what the board calls.
 *
 * ⚠️ So the buttons render INERT with the reason on screen rather than being
 * hidden — §5.39g's rule, and the one this codebase keeps having to reverse
 * (§5.10 · §5.20 · §5.31c · §5.31f · §5.39d): a control whose passing move is
 * invisible is worse than a control that says what it is waiting for. What
 * does NOT wait is the quote: the card prices the order today, so a rep on the
 * phone can read the patient their number and take payment another way.
 *
 * ✅ **LIVE from 2026-09-22**, once all three pieces outside this repo existed:
 * `CASH_PAY_WEBHOOK_SECRET` on the coins service, monday webhook **641115241**
 * (Cash Pay Action → "Generate link" → mint) and **641125712** (→ "Send to
 * patient" → text + stamp).
 *
 * **Proved end to end on a throwaway order before flipping**, not reasoned
 * about: Generate minted a real `pay.medicallymodern.com` link and cleared the
 * trigger; Send texted it — RingCentral messageId 3313052761012 — stamped Cash
 * Pay Link Sent and cleared the trigger again. Test row deleted.
 *
 * ⚠️ **They are monday API webhooks, not automations.** monday's automation
 * builder has no "send a webhook" ACTION, only a "when a webhook is received"
 * TRIGGER, so this could not be built as a recipe. Every other integration on
 * that board is an API webhook too.
 *
 * ⚠️ **The secret rides in the URL PATH**, because monday signs every delivery
 * with its own JWT in `Authorization` — a service reading the header first
 * never compares the real key and refuses a correctly-configured webhook with
 * 401. The coins service compares all three now; the path is the one channel
 * nothing can shadow.
 *
 * ⚠️ **monday suspends an endpoint that keeps failing and still lists the
 * webhook**, with no status field to read. After fixing a 401, delete and
 * recreate the webhook — a fixed endpoint alone does not resume delivery.
 *
 * Turning it off again is safe: the buttons go inert with the reason on screen
 * and the quote keeps rendering, so a rep can still price the order and take
 * payment another way. The Generate press spends money's worth of trust — it
 * mints a link for an amount the patient is then charged, and the quote is
 * honoured from that moment (`cashPayPricing.ts`).
 */
export const CASH_PAY_LINK_FROM_COMMAND_CENTER = true;
