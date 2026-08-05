# Handoff — RingCentral message archive

**For:** the next Claude picking this up.
**Asked for by Josh, 2026-08-05:** *"download all of the texts every two weeks and append all of
the new ones to a Google Doc… we lose text history after a certain amount of messages and a
database would be helpful."*

---

## 1. Why this exists

**RingCentral is currently the only copy of every patient text message Medically Modern has ever
sent or received.** The Command Center stores *no message text anywhere* — deliberately.
`services/monday-gateway/messaging.mjs` writes only an attribution index:

```sql
sent_messages(phone_hmac, sender_email, rc_message_id, sent_at, monday_item_id)
```

Four values, none of them the body. A patient's phone number is PHI, so it is stored as
HMAC-SHA256 with a server-side pepper; message bodies are fetched from RingCentral at render time
and never persisted. That was the right call for a live UI and it is exactly why there is no
backup: nothing in this system was ever designed to keep a copy.

Josh reports history disappearing "after a certain amount of messages." If true, patient
conversations are already being lost, and the loss is silent.

---

## 2. Verify this FIRST, before designing anything

**Everything downstream depends on RingCentral's actual retention, and nobody has measured it.**

`messaging.mjs` currently queries with a **3,650-day** (`dateFrom`) lookback and pages up to
10 × 250 = **2,500 messages** per conversation. That is an *assumption*, not a verified fact. Find
out:

1. What is the real retention on this account's plan — time-based, count-based, or both?
2. Does the cap apply per-conversation or per-mailbox?
3. How far back can `message-store` actually return today?

Cheapest empirical check: query `message-store` with `dateFrom` set years back and see where the
oldest record sits. Compare against a patient known to have texted long ago.

**Why it matters:** if retention is short, the first run is a *rescue* and should reach back as far
as the API allows, immediately. If retention is years, this is routine hygiene and can be built
carefully. It also determines whether the 2,500-message pagination cap in
`/messaging/conversation` is silently truncating the opt-out guard — a real correctness bug, since
an aged-out `STOP` would stop being honored.

⚠️ Report the answer to Josh before building. It may change the priority entirely.

---

## 3. Push back on the Google Doc — gently, but do push back

Josh asked for a Google Doc. **A single growing Doc will fail**, and he already sensed why when he
added "a database would be helpful." Both can be true; the Doc just shouldn't be the system of
record.

- **Google Docs cap at ~1.02 million characters.** At an average SMS of ~120 characters plus a
  header line, that is roughly 5,000–7,000 messages. A busy month could approach that alone. When
  the cap hits, the append fails — and a backup that fails silently is worse than none.
- **A Doc is not searchable in the way this needs.** "Every message with this patient," "what did
  we send in March," "did anyone text this number" — those are queries, not scrolling.
- **Appends are not idempotent.** Re-run a Doc append after a partial failure and you get
  duplicates with no key to dedupe on.

**Recommended shape instead:**

| Layer | What | Why |
|---|---|---|
| **System of record** | Postgres table, one row per message, PK on RingCentral's message id | Idempotent, queryable, dedupes for free |
| **Human access** | Periodic export — one Google **Doc or Sheet per month**, or dated files in Drive | Readable, shareable, never unbounded |

If Josh still wants Docs specifically, do **one Doc per calendar month**, named
`MM Texts YYYY-MM`, never one growing document. That keeps every file well under the cap and makes
"pull up March" trivial.

**On making this a Claude scheduled task:** don't, for the pipeline itself. This is deterministic
ETL — copy rows, dedupe on a primary key, retry on failure. A cron service does that cheaply,
predictably, and auditably, and it costs nothing per run. Reserve Claude for the parts that need
judgment: a monthly "here's what the archive looks like, here's what looks wrong" summary is a
genuinely good Claude task. The copying is not.

---

## 4. Architecture

Mirror the two existing cron services — `services/baseline-cron` and `services/calls-monitor`.
Both are Railway cron services built from this repo with a `rootDirectory`; copy their
`Dockerfile` and `package.json` verbatim.

```
services/rc-archive/
  index.mjs        the sync
  archive.mjs      pure: normalize a RC record → a row   (unit-testable, no I/O)
  archive.test.mjs
  Dockerfile
  package.json
  README.md
```

Railway service config: cron `0 6 */14 * *` (or simply twice-monthly `0 6 1,15 * *` — cleaner than
`*/14`, which drifts across month boundaries), `restartPolicyType: NEVER`, watch patterns scoped to
`services/rc-archive/**`.

### Incremental sync — use `message-sync`, not date windows

`services/monday-gateway/ringcentral.mjs` already documents this:

> `message-sync` (incremental SMS sync with a sync token) is the eventual upgrade for the inbox
> poll, but it is deliberately NOT allowlisted yet: nothing calls it, and this proxy should only
> ever expose paths in use.

**This job is the reason to finally use it.** `GET /restapi/v1.0/account/~/extension/~/message-sync`
returns a `syncToken`; passing it back returns only what changed since. Persist the token between
runs. Date-window scanning re-reads everything forever and gets slower every cycle.

Fall back to `message-store` with an explicit `dateFrom` for the initial backfill.

⚠️ **`dateFrom` is mandatory, not optional.** RingCentral's message store defaults to roughly the
**last 24 hours**. CLAUDE.md §5.5 records this biting the fax count already — unread faxes older
than a day silently vanished over a weekend. Omit `dateFrom` on a backfill and you will archive one
day and believe you archived everything.

### Idempotency

Primary key on RingCentral's message `id`. Use `ON CONFLICT (rc_id) DO NOTHING`. A re-run, an
overlapping window, or a retry after a half-finished run then costs nothing and corrupts nothing.

---

## 5. Schema sketch

```sql
CREATE TABLE IF NOT EXISTS rc_messages (
  rc_id         TEXT PRIMARY KEY,          -- RingCentral's own id: the dedupe key
  direction     TEXT NOT NULL,             -- Inbound | Outbound
  type          TEXT NOT NULL,             -- SMS | Fax | VoiceMail
  from_number   TEXT,
  to_numbers    TEXT[],
  body          TEXT,                      -- ⚠️ PHI IN THE CLEAR — see §6
  created_at    TIMESTAMPTZ NOT NULL,
  attachments   JSONB,                     -- ids/URIs only, not bytes
  raw           JSONB,                     -- the whole record, for anything we didn't model
  archived_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON rc_messages (created_at);
CREATE INDEX ON rc_messages (from_number);

CREATE TABLE IF NOT EXISTS rc_sync_state (
  id          INT PRIMARY KEY DEFAULT 1,
  sync_token  TEXT,
  synced_at   TIMESTAMPTZ
);
```

Keep `raw` — RingCentral fields you didn't think to model are free to store now and impossible to
recover later once retention drops them.

**Attachments** (MMS images, fax PDFs) are a genuine open question: their content lives on
`media.ringcentral.com` behind auth and almost certainly ages out too. Storing ids alone means the
archive silently loses them. Flag this to Josh — fetching the bytes is a bigger, more expensive
job and should be a deliberate decision, not a surprise.

---

## 6. PHI — the constraint that shapes everything

**Message bodies are unambiguously PHI.** This archive is the first thing in the whole system to
hold patient-identifying content in the clear, and that reverses a property the current design
protects on purpose:

- `messaging.mjs` hashes phone numbers rather than storing them
- the gateway runs `LOG_PAYLOAD=false` so the audit DB holds metadata only
- CLAUDE.md §9: *"PHI everywhere… Don't write patient data to logs/artifacts/commits."*

None of that forbids an archive — a provider needs its records. It does mean:

1. **Wherever this lands needs a BAA with that vendor.** Google Workspace almost certainly already
   has one (MM sends patient email as the company through Gmail today — `worker/src/index.js`), so
   Drive/Docs is defensible. **Confirm, don't assume.** Railway's Postgres needs the same question
   asked.
2. **Never a Git repo.** Not private, not encrypted-in-repo. Not a PHI store.
3. **Don't log bodies.** The monitor pattern in `services/calls-monitor` is the model — log shapes
   and counts, never content.
4. **Retention has a floor, not just a ceiling.** HIPAA expects 6 years for designated record set
   material. Don't build auto-deletion without asking.
5. If bodies land in the gateway's existing Postgres, say so loudly in CLAUDE.md — it changes that
   database's classification, and future work will assume the old property still holds.

---

## 7. Code to reuse (don't rewrite these)

| Need | Use |
|---|---|
| Authenticated RingCentral calls | `services/monday-gateway/ringcentral.mjs` → `rcApiFetch()` — JWT auth, token caching, 401 refresh-and-retry |
| Pagination + filtering example | `messaging.mjs` `/messaging/conversation` — pages `message-store`, and shows the `last10()` matching trick |
| Cron service skeleton | `services/calls-monitor/` — Dockerfile, package.json, env-var validation, ET-aware time handling |
| Phone normalization | `services/monday-gateway/phoneHash.mjs` → `toE164()`. ⚠️ Numbers arrive in whatever shape they were typed; normalize before comparing or you get silent misses |
| Tests | `services/**/*.test.mjs` run in the repo-root vitest (`vitest.config.ts` includes them). Keep the pure logic in its own module so it tests without I/O |

---

## 8. Gotchas already paid for in this codebase

- **`dateFrom` defaults to ~24h.** See §4. This has already caused one production bug.
- **Railway containers run UTC.** Anything month- or business-hours-shaped must convert to ET
  explicitly — see `inBusinessHours()` in `services/calls-monitor/index.mjs`.
- **This account's `POST /sms` returns 500 while succeeding.** Irrelevant for a read-only job, but
  it tells you RingCentral's status codes on this account are not always truthful — verify against
  the message store rather than trusting a response.
- **RingCentral wraps webhook payloads in an envelope**, and their docs show the inner object. Cost
  a full debugging session on 2026-08-05. If you touch anything event-driven, read CLAUDE.md §5.13.
- **The gateway redeploys on every push to `main`.** Don't put long-running work in it; that's why
  this is a separate service.

---

## 9. Ask Josh before building

1. **Where does the archive live?** Postgres + periodic Drive export is the recommendation. Confirm
   the BAA position on whichever he picks.
2. **What's the real retention?** (§2 — measure it first; it may make this urgent.)
3. **Attachments — bytes or just references?** (§5)
4. **How far back should the first run reach?** As far as the API allows, presumably.
5. **Who may read the archive?** Managers only, or anyone signed in? Affects where the export lands
   and how it's shared.

---

## 10. Done means

- A cron service running on schedule, logging a per-run count.
- Re-running it changes nothing (idempotent on `rc_id`) — test this explicitly.
- A backfill reaching as far back as RingCentral allows, with the count reported.
- Pure normalization logic under unit test, including a malformed record.
- **It complains when it fails.** The lesson from the inbound-calls build, which ran broken and
  invisible for hours: a backup that stops working quietly is worse than none, because it reads as
  an all-clear. Point failures at the existing ntfy channel; `services/calls-monitor/index.mjs`
  shows the pattern.
- CLAUDE.md updated — especially if the gateway's Postgres now holds PHI.
