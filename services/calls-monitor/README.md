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
| `DRY_RUN` | `1` to print instead of notifying |
| `CALL_ARCHIVE_HEALTH_URL` | optional — `…/calls/archive-health` |
| `VOICEMAIL_ARCHIVE_HEALTH_URL` | optional — `…/voicemail/archive-health` |
| `MMS_ARCHIVE_HEALTH_URL` | optional — `…/mms/archive-health` |
| `COMMS_INBOX_HEALTH_URL` | optional — `…/comms/inbox-health`. Pages when the Communications inbox's minute-by-minute capture tick has stopped (the list would silently stop growing). Notes waiting to be copied to Monday are logged, never paged |
| `SMS_ARCHIVE_HEALTH_URL` | optional — `…/messaging/archive-health`. Pages when the SMS text archive stops keeping up (the gateway's own verdict: no run ever, stale past 3 days, or truncated) AND when the health check itself errors or is unreachable — texts age out of RingCentral at ~30 days, so a dead archive loses them permanently |
| `DIRECTORY_HEALTH_URL` | optional — `…/directory/health`. Same rule for the patient name directory, at default priority — a dead refresh degrades to live Monday lookups (slower names on incoming calls), it loses nothing |
| `PHONE_HEALTH_URL` | optional — `…/calls/phone-health?key=$AUDIT_KEY`. Pages when somebody assigned to answer has a browser **open** that cannot register with RingCentral. ⚠️ The key is required: this route names employees, so it takes either a verified Google identity or `AUDIT_KEY`, and a cron has neither an identity nor a way to get one. A 401 is logged with that hint rather than read as health |
| `PHONE_ALERT_HOURS` | optional — the local window that check may page in, default `8-19` (weekdays only). ⚠️ §5.13 asks for this by name: the previous browser check was removed for paging every evening, and a tab left open on a failing registration at 6pm is still failing at 3am |
| `PHONE_ALERT_TZ` | optional — IANA zone for that window, default `America/New_York`. Read through `Intl`, never the container's clock: Railway runs UTC |

⚠️ **The ntfy topic is the only thing protecting these alerts.** An ntfy topic
is readable by anyone who knows its name, so it is generated with ~145 bits of
entropy and kept OUT of this repo — it lives in the Railway variable and on the
phones subscribed to it. Don't paste it into code, commits, or issues.

## Note on repo visibility

`medically-modern/command-center-test` is **private** (GitHub Team, 2026-08-05). Railway pulls it
through its GitHub App installation rather than a token, so private visibility changes nothing here
and needs no configuration.

⚠️ The parts that DO care are the personal access tokens: the Cloudflare worker's `GITHUB_PAT`
(reads/writes `access.json`), baseline-cron's `GITHUB_PAT`, and `GH_PAT` in `sync-from-test.yml`.
A classic PAT scoped `public_repo` works on a public repo and 404s on a private one, silently. The
`access.json` case is the one to watch: a 404 there leaves the SPA in bootstrap mode, where
*everyone* is treated as a manager. All three were verified working after the switch.
