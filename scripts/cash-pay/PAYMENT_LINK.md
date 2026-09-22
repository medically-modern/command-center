# Cash pay payment links — the two board automations

The code is built and pushed on both sides. What is left is **three things in monday and one
variable on Railway**, none of which a script can do: monday's automation builder is a UI, and the
secret is Josh's to generate.

While they are missing the card is inert and says so — `CASH_PAY_LINK_FROM_COMMAND_CENTER` in
`src/lib/orders/config.ts` is still `false`, and `cashPayCard.test.ts` pins it there. **The quote
is live regardless**, so a rep can already read a patient their total and take payment the way they
do today.

---

## How it works once it is on

```
rep presses Generate            Command Center writes Cash Pay Amount (verified),
   in the Command Center   ──▶  then flips Cash Pay Action → "Generate link"
                                          │
                        board automation 1 │  send a webhook
                                          ▼
     coins-form-payment  ──▶  mints a Stripe payment link, writes Cash Pay Link
                                          │
rep presses Send                          ▼
   in the Command Center   ──▶  Cash Pay Action → "Send to patient"
                                          │
                        board automation 2 │  send SMS from the RC number
                                          ▼
                              the patient gets the link
                                          │
                              they pay ───┤
                                          ▼
          Stripe webhook  ──▶  Stripe Charge ID + Cash Pay Paid Date
                               + Order Status → "Paid Cash"
                                          │
                                          ▼
                          the ordering gate opens for that order
```

**No browser ever holds a token.** The board is the trigger — exactly how the coinsurance flow has
worked for a year, which is the shape Josh asked for (2026-09-21: *"do that route, it works
perfectly fine dont mess it up"*).

---

## ✅ Steps 1 and 2 are DONE — verified end to end, 2026-09-22

`CASH_PAY_WEBHOOK_SECRET` is set on `coins-form-payment`, and the mint webhook is
**monday webhook `641121194`** on the New Order Board, firing on **Cash Pay Action →
Generate link (index 0)** only. Proved against a throwaway order: the flip minted a real
Stripe Payment Link, wrote it to **Cash Pay Link**, and cleared the trigger. Test row deleted.

⚠️ **It is a monday API webhook (`create_webhook`), not an automation.** monday's automation
builder has no "send a webhook" ACTION — the only webhook block is the *"When a webhook is
received"* TRIGGER — so the recipe below cannot be built that way. Every other integration on
this board (Cardinal poller, pre-check, backorder substitution) is an API webhook too; this
matches them.

⚠️⚠️ **THE SECRET GOES IN THE PATH, NOT THE QUERY STRING — and the reason is not the one you
would guess.** monday signs every delivery with a JWT in the **`Authorization` header**. The
service used to read `header || query || path`, so that chain always resolved to monday's JWT
and the real key was never compared: a correctly-configured webhook was refused **401**, which
reads exactly like a wrong secret. Fixed in `c678aa2` — every candidate is compared now, so the
query form works too. The path form is kept because it is the one channel nothing can shadow.

⚠️ **The save-time challenge proves nothing about the key.** The handshake is answered *before*
the auth check, so monday will happily save a URL with a typo'd secret and every real event will
then 401. Test with a real flip, never with the save.

⚠️ **monday stops delivering to an endpoint that keeps failing**, and the webhook still appears in
`webhooks(board_id:)` while suspended — there is no status field to read. After fixing a 401,
**delete and recreate the webhook**; a fixed endpoint alone does not resume it. That cost a
confusing ten minutes here.

⚠️ `webhooks(board_id:)` does not expose `url`, so there is no way to read back what monday
stored. The only evidence about a webhook's URL is how its deliveries behave.

**What is still outstanding: step 3 (the text automation) and the app switch.**

---

## Step 1 — the secret (Railway, ~1 minute)

On the **`coins-form-payment`** service, add:

| Variable | Value |
|---|---|
| `CASH_PAY_WEBHOOK_SECRET` | any long random string you generate |

⚠️ **NOT `MONDAY_WEBHOOK_SECRET`.** That variable is *unset* on this service today, so the
coinsurance webhook's own auth check is inert — and monday's "send a webhook" automation sends no
`authorization` header, so **setting it would start 401-ing the live coinsurance flow.** The cash
pay route has its own name for that reason.

⚠️ Until it is set the route answers **503** and mints nothing. That is deliberate: an endpoint that
mints Stripe payment links must never be open because somebody forgot to configure it.

Keep the value to hand — step 2 needs it in the URL.

---

## Step 2 — the mint automation (monday, ~2 minutes)

On the **New Order Board** `18405457690`:

> **When** *Cash Pay Action* changes to **Generate link**
> **then** send a webhook to

```
https://coins-form-payment-production.up.railway.app/webhook/monday/cash-pay?key=PASTE_THE_SECRET_HERE
```

⚠️ **"changes to Generate link", not "changes".** The column also carries *Send to patient*, and a
webhook on every change would mint a second link when a rep presses Send. (The service checks the
label too and skips anything else — belt and braces, because an endpoint that mints a payment link
must not rest on somebody else's radio button.)

⚠️ If monday lets you set a **header** on the webhook, use `Authorization: <the secret>` and drop
the `?key=` from the URL instead — a URL can end up in a log. Either is accepted.

When you save it, monday posts a one-off *challenge* to the URL and the service echoes it back; if
it saves cleanly, the URL is right.

### Testing it

Take one cash pay order that has **no** Cash Pay Link, put a small number in **Cash Pay Amount**
by hand (say `1.00`), and set **Cash Pay Action** → *Generate link*. Within a few seconds:

- **Cash Pay Link** fills in with a `https://buy.stripe.com/…` URL, and **Cash Pay Action** clears
  → it works.
- **Cash Pay Action** reads **Link failed** → the service refused. Railway's logs for
  `coins-form-payment` have the sentence (`[cash-pay/wh] Item … refused: …`) — usually the order is
  already paid, already with Cardinal, or its payer is not Cash Pay.
- **Nothing happens at all** → the automation did not fire, or the URL/secret is wrong. Check
  Railway's HTTP log for a request to `/webhook/monday/cash-pay`: a **401** is the secret, a **503**
  is the variable not being set, no request at all is the automation.

Then **deactivate that Stripe link** in the Stripe dashboard and clear the test row's Cash Pay Link
and Cash Pay Amount.

---

## Step 3 — the text automation (monday, ~2 minutes)

Same board:

> **When** *Cash Pay Action* changes to **Send to patient**
> **then** send an SMS from the RC number to *Primary Phone*
> **and** set *Cash Pay Link Sent* to **today**

⚠️ **The date is not optional.** The Command Center reads *Cash Pay Link Sent* as "this has gone to
the patient" — without it the card sits on *Link ready* for ever and a rep keeps re-sending.

The wording lives in code so it has one home — `cashPayText()` in
`coins-form-payment/backend/src/cashPay/index.js`. Today it reads:

> Hi {first name}, this is Medically Modern. Your supplies come to {amount}. You can pay securely
> here: {link}
>
> Questions? Call us on (347) 503-7148.

Use monday's own column tokens for the name, the amount and the link.

---

## Step 4 — flip the switch (me, once steps 1–3 are done)

Set `CASH_PAY_LINK_FROM_COMMAND_CENTER = true` in `src/lib/orders/config.ts`, update
`cashPayCard.test.ts`, and update CLAUDE.md §5.48. **Tell me when the two automations are live** —
flipping it before they are would enable a button that writes a status nothing listens to, which is
the silent no-op class this codebase keeps having to fix.

---

## The one thing that changed, and it is Josh's call to accept

⚠️⚠️ **The Stripe page shows ONE line, not the three products the rep quoted.**

A monday webhook carries an item id and a status label — no line items — so the only price the
payment service can see is the one number on the row. Rebuilding the products into lines over there
would mean a second copy of the pricing rule in a second repo, which is precisely what
`cashPayPricing.ts` exists to prevent: its drift would be a patient charged an amount no screen
ever showed.

So the patient sees **"Medically Modern — diabetes supplies · $1,030.69"** rather than a t:slim
line, an AutoSoft line and a Dexcom line. **The total is identical either way.** The itemisation is
on the Command Center card the rep reads from on the call.

That is a departure from handoff item 5, which asked for the itemised page. The itemised route
still exists and is tested — `POST /api/cash-pay/create-link` takes the lines — but it needs the
Command Center to call it directly with a service token, which is the shape Josh declined. If the
itemised page matters more than the mechanism, say so and it is a different afternoon's work.
