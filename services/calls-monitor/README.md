# calls-monitor

Railway **cron** service. Every 10 minutes it asks the gateway whether the
Command Center can still receive inbound calls, and pushes to ntfy when it
can't.

## Why

Inbound calling fails **quietly**. A blacklisted subscription, a revoked
RingCentral permission, a gateway that won't boot, every browser dropping its
stream — all of them look exactly like a quiet afternoon. The feature ran for
hours in precisely that state (33 events delivered, 33 discarded) before anyone
could tell. This is the thing that notices.

## What it proves, and what it doesn't

It **cannot** prove delivery — only a real inbound call does that, and we don't
place synthetic calls into a production line. It proves the chain up to
delivery:

- the gateway is up and reports `configured`
- RingCentral says the subscription is **Active right now** (not "we created one
  once" — the id survives blacklisting unchanged, which is why
  `/calls/health` re-queries RC rather than replaying its own memory)
- the webhook URL still answers RingCentral's `Validation-Token` handshake
- events that arrive are parseable (`seen > 0 && unparsed === seen` is the
  envelope-bug signature)
- somebody's browser is attached, during business hours

The individual case — *this* rep's tab fell off — is not visible from here.
That is what `components/inboundCalls/CallStreamStatus.tsx` covers, in the tab
itself.

## Railway setup

Deploy `services/calls-monitor` with **cron** `*/10 * * * *`.

| Variable | Value |
|---|---|
| `CALLS_HEALTH_URL` | `https://monday-gateway-production.up.railway.app/calls/health` |
| `CALLS_WEBHOOK_URL` | `https://monday-gateway-production.up.railway.app/calls/webhook` |
| `NTFY_URL` | `https://ntfy-production-d31f.up.railway.app` |
| `NTFY_TOPIC` | the private topic (see below) |
| `BUSINESS_HOURS` | `9-18` (ET). Set empty to disable the "nobody connected" check |
| `DRY_RUN` | `1` to print instead of notifying |

⚠️ **The ntfy topic is the only thing protecting these alerts.** An ntfy topic
is readable by anyone who knows its name, so it is generated with ~145 bits of
entropy and kept OUT of this repo — it lives in the Railway variable and on the
phones subscribed to it. Don't paste it into code, commits, or issues.

`BUSINESS_HOURS` is evaluated in **Eastern**, not the container's clock. Railway
runs UTC; a naive hour check would put the window in the middle of the night and
alarm every evening until someone muted it — at which point it stops being a
monitor.
