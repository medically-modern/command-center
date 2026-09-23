# Communications inbox — the "Unresolved queue" (v2): plan and diff (Sep 2026)

> Josh, 2026-09-23: *"this is the new comms dash, make a plan for implementing and diff it to what
> we have compared to what the dash asks for, inline notes need to be thought through … make a
> detailed plan for building this and ask any questions on anything that is unclear / seems
> destructive"*

**Status: DRAFT — nothing is built.** The build waits on the questions in §9. When a phase ships,
record it in CLAUDE.md (a new §5 section, the way §5.47 recorded the call archive) and mark it here.

**Source.** Brandon's `command-center-mockup-REAL-DATA_2.html` (7.7 MB). The spec is the script
block headed *"COMMUNICATIONS v2 — the Unresolved queue (Brandon + Katie, 2026-09-22)"*, plus the
Reports override and the patient-screen hook after it.
- ⚠️ The file carries real PHI and stays **out of this repo** (`_reference/brandon-redesign/README.md`).
- ⚠️ v2 is in **neither** the 9/18 handoff doc (rev 34) **nor** the sample-data mockup in
  `_reference/`. Both predate it. The mockup's code and the comments inside it are the whole spec.
  This doc quotes the rules so nobody has to open the PHI file to learn what was asked.

---

## 0. In one screen

**What it is.** Unread stops being the work signal; our own **resolved / unresolved** state replaces it.
- Every inbound text, missed call or voicemail **opens (or reopens)** an item for that patient.
- Our replies **never** close it.
- A person closes it with one click that also records **how**: *Called* (a note is required),
  *Texted*, or *No action needed*.
- There is a 24-hour target, and the breaches are counted in Reports.

**What that needs that we don't have: shared, durable state.** Today the only read state is
RingCentral's own `readStatus`, and nothing anywhere records that a text was *handled*. So the core
of this build is a **gateway module** on the messaging Postgres pool that:
- captures inbound and outbound events every minute;
- stores who resolved what, how, when, and with what note.

The hub list, the header badge, the patient screen and Reports all read from it.

**Most of the UI exists already.**
- Today's Text and Phone tabs *are* the mockup's Texts / Calls / VMs logs.
- The thread, the dossier pane and the find-a-patient search are all built.

**New:** the Inbox list, one timeline per patient, the resolve bar with its inline notes, the header
badge, and the SLA card.

**Build order is additive-first (§8).** The Inbox is *added* as a new default rail, and the current
Phone / Text / Fax rails stay exactly as they are until the team has used it. Nothing in §9's list of
destructive or unclear items happens without an answer.

---

## 1. What the mockup specifies

### 1.1 The rules — its header comment, plus what its code actually does

1. **The unit is the patient.** The primary and alternate phone numbers fold into one item. An
   unmatched number is its own item until somebody matches it.
2. **What opens or reopens an item:** an inbound text (MMS included), a missed inbound call, or a
   voicemail.
   - An **answered** inbound call opens nothing.
   - Faxes never open anything; Fax stays its own rail.
3. **Our replies never close it.** A text or call to the patient only *suggests* how it was resolved
   (rule 5).
4. **Closing is one click that says how:** `Called` · `Texted` · `No action needed`.
   - `Called` opens an inline note, *"What did you talk about? (required)"*. It resolves only once
     the note has text, by Enter or Resolve.
   - The other two resolve immediately, then offer *"Add a note (optional)"*.
5. **Suggestion.** If we called or texted *after* the item opened, the matching button is
   highlighted with the time (`Called 11:40 AM`), and its label changes from *Mark resolved* to
   *Confirm*. It never resolves anything on its own.
6. **Left VM.** The header comment says it *"logs an attempt and keeps it open (the 24h clock keeps
   running)"*. ⚠️ **It is not built in the mockup.** There is no button, and its attempts state is
   read but never written. See Q6.
7. **Undo.** A row you just resolved stays in the list, greyed with a ✓ ("sticky"), until you open
   another item. While it is sticky, *Undo* puts it back on the unresolved list.
8. **Everyone works the same list.** The manager summary strip was removed in v2.1. *Unresolved* and
   *Over 24h* are list tabs, and the SLA detail lives in Reports & Metrics.

### 1.2 The screen

**Left rail:** `Inbox` (the work queue) · `Fax` · `Texts` · `Calls` · `VMs`.
- The three logs list every event of their kind, inbound and outbound, newest first. Their filters:
  - Texts: All / Received / Sent;
  - Calls: All / Inbound / Outbound / Missed;
  - VMs: no filter.
- Any log row opens the same item detail as the Inbox.
- Fax is unchanged from today's mockup.

**Inbox list:**
- tabs `Unresolved n` · `Over 24h n` (red) · `All`;
- `Mine | All patients` — shown only when you have assigned patients (Q5);
- a search box for name or number;
- sort: *Longest waiting* (the default) or *Newest*;
- type chips: *All · Texts · Missed calls · Voicemails*.

Each row shows:
- the name and a **stage pill**:
  - light green: Intake · Medical Evaluation · Insurance · Welcome Call;
  - dark green: Subscription;
  - red: Inactive;
  - grey: Unmatched;
- the wait (red over 24h), or `✓ how · who` once resolved;
- a preview line;
- a coloured left edge for the type: text blue, missed call orange, voicemail purple.

**Item detail:**
- A header with the name, the stage pill, the number and a **Call** button.
- **One timeline:**
  - texts as bubbles;
  - calls and voicemails as rows — a voicemail shows its transcript and a *Listen* button;
  - past resolutions as quiet dividers: `Resolved · Called · Katie · Sep 16 · 3:10 PM — "note"`.
- Below the timeline, the composer.
- Below the composer, the **resolve bar**: `Waiting 3h 12m` and
  `Mark resolved: [Called] [Texted] [No action needed]`.

**Right pane:** *Patient Profile* — the patient screen's main column, embedded, plus an *Open Profile
Page* button.
- For an **unmatched** item it shows a find-a-patient search.
- After a pick it asks *"Add (xxx) xxx-xxxx to \<patient\>?"*, with three choices:
  - `[Add as alternate phone]` — *which replaces the existing one*;
  - `Use as primary phone instead`;
  - `Pick someone else`.
- After that, the number's texts and calls "sit on their profile".

**Header:** the Communications tab's red badge becomes the **unresolved** count, not the unread count.

**Patient screen:** a compact resolve bar at the top of the Texts | Calls column, whenever the patient
has an open item. If they have none, it shows their last resolution.

**Reports & Metrics:** a *Communications SLA · 24 hours* card.
- Unresolved now, with how many are over 24h.
- The share resolved within 24h.
- The median time to resolve, from the first inbound message to resolved.
- How items were resolved.
- A per-rep table: resolved · within 24h · median · how.
- An *Open breaches* link.
- The card's own footnote asks the live build for *"by week, by stage (the pill), and by rep, with
  a trend line"*.

## 2. Mockup scaffolding we must NOT port

- **Its data source.** The mockup's sample comes from a Monday board, *Faxes, Calls, VMS, Parachute*
  (`18398061249`).
  - That board stopped receiving texts, calls and voicemails on 07/14, and it only ever held
    inbound traffic.
  - The handoff says so itself (its line 202): the live build reads RingCentral. That stays.
- **Its fake clock and seeded history** (`IB_NOW` / `ibTick` / `ibSeed`). They exist only so the
  screens look lived-in.
- **Its matching,** which is *"by phone digits, then by name"*. ⚠️ A name is not an identity
  (§5.28 `nameMatchAccepted`). We match on the number, through the patient directory.
- **Its Call button,** which appends a fake `Called patient · 3:12` row. The live one dials
  through the softphone; the real call-log row arrives on the next capture (§4.2).
- **`Mine` assignments.** These are set on sample data only; the real-data build has no per-patient
  owner field (Q5).

## 3. Diff — what the mockup asks for vs. what we have

| Mockup | Today (`/assigned-patients`, CLAUDE.md §5.28) | Verdict |
|---|---|---|
| **Unresolved state, shared by everyone** | Nothing. Read state is RingCentral's `readStatus` — one per message, shared with the RC desktop app. Nothing anywhere records "handled". | **MISSING — the core of the build (§4)** |
| Inbox: Unresolved / Over 24h / All, search, sort, type chips, stage pill, wait clock | Text tab = conversations + an Unread filter; Phone tab = calls + a voicemail sub-tab with Today / Missed | **MISSING** — the list is new; search and sort exist per tab |
| Unit = the patient (primary + alternate number folded together) | Unit = one phone number (one RingCentral conversation) | **PARTIAL** — the directory maps number → record (§5.29); the grouping is new |
| Texts log (All / Received / Sent) | Text tab (All / Unread, New text, mark read/unread, naming progress) | **PARTIAL** — Received/Sent is new; Unread exists and the mockup drops it (Q10) |
| Calls log (All / Inbound / Outbound / Missed) | Phone tab (Today / All / Missed; recordings play + ⤓ + *Download N*; archive playback §5.47) | **PARTIAL** — Inbound/Outbound is new; our recordings go further than the mockup |
| VMs log | Phone → Voicemail (transcripts, heard/unheard, a call opening the voicemail it left). Since 2026-09-23 the audio and transcripts are also archived (§5.47b) | **HAVE** — ours does more |
| Fax rail | Fax tab (views, sending office + its patients, read/unread) | **HAVE** — v2 doesn't change it |
| One timeline per item: texts + calls + VMs + resolution dividers | Separate pieces: `ConversationThread`, `VoicemailDetail`, call rows. A call that left a voicemail stacks the VM above the thread | **MISSING** — a new component built from the existing pieces |
| Composer under the timeline | `ConversationThread`'s composer: opt-out guard, delivery-failure note (§5.5), MMS, Can Text | **HAVE** — reuse it, never copy it |
| Resolve bar: wait + Called(note) / Texted / No action; suggestion; sticky + Undo; optional note | — | **MISSING** |
| Left VM (logs an attempt, stays open) | — (the mockup doesn't build it either) | **UNCLEAR** (Q6) |
| Right pane = the patient screen's main column + Open Profile Page | `PatientDossierPanel`: stage path, writable notes, every stage's notes, per-stage call detail, household switcher, find-without-writing, Open profile page | **DIFFERENT** — already flagged in `DIFF_2026-09-22.md` §14 (§7 here) |
| Unmatched → find → **add the number to the patient** (alternate or primary) | `DossierSearch` finds and shows the profile and **writes nothing** — deliberately (§5.28) | **NEW WRITE — destructive** (§6, Q4) |
| `Mine \| All patients` | No per-patient owner exists anywhere. §5.13 and §5.30 record *no ownership* | **CONFLICT** (Q5) |
| Header badge = unresolved count | No badge at all (`DIFF_2026-09-22.md` §1 already lists it missing) | **MISSING** |
| Patient screen: compact resolve bar | `PatientCommsColumn` (Texts thread, Calls button, alternate-number switch, Recent notes) | **MISSING** |
| Reports: Communications SLA card | Reports & Metrics is deliberately blank — "No reports available yet" (Josh, 2026-09-22, §5.46b) | **MISSING, and it reverses a 9/22 decision** (Q8) |
| The hub header (dialer, "which calls ring me") | The navy header with a dialer and the ring-preferences bell, plus the bell on a conversation (`WatchCallbackButton`) | **HAVE** — v2 doesn't redraw the header; keep ours |
| Outbound-call attribution ("We called · Katie") | None: one shared RingCentral extension, so the call log can't say who (§5.13b). `sent_messages` attributes texts only | **MISSING** (small — §4.6) |

**Built today, not in the mockup, and it must survive** (§5.39f's lossless rule):
- New text to any number (`NewTextPanel`), and the naming progress bar.
- The opt-out guard and the delivery-failure notes (§5.5).
- MMS attachments.
- Recordings: *Download N*, and archive playback (§5.16, §5.47).
- Voicemail heard/unheard, and a call opening the voicemail it left.
- Mark read/unread — the RingCentral desktop app sees it.
- The household switcher, *"N patients share this number"* (§5.28).
- The per-stage call detail (`stageDetail.ts`) and every stage's notes.
- The ring-preferences bell and the watch-callback bell.

---

## 4. Architecture

### 4.1 Why the state lives on the gateway

- **It is shared.** "Everyone works the same list", so one rep's resolution has to reach every other
  rep within a poll. Browser storage cannot do that.
- **The badge is on every page.** A count in the header of every screen cannot come from each
  browser polling RingCentral's three lists — that is INCIDENT_2026-08-20's shape. The count must be
  a Postgres read.
- **It has to last.** The SLA needs history, and RingCentral's message store keeps about 30 days
  (§5.27).
- **Where it lives.** A new `services/monday-gateway/commsInbox.mjs`, plus a pure
  `commsInboxRules.mjs` with its own tests.
  - It is registered from `messaging.mjs`, so it lands on the **messaging pool** — the §5.27 / §5.29
    / §5.47 boundary.
  - It gets the same source-scan test the call archive has.

### 4.2 Capturing events — the three archives already hold them

**All three kinds of event are already archived on the messaging pool, just not quickly enough.**

| Archive | Holds | Refreshes |
|---|---|---|
| `sms_archive` (§5.27) | every text, both directions: body, status, `created_at` | **daily**, 35-day window |
| `voicemail_archive` (§5.47b — landed 2026-09-23) | every voicemail: duration, `created_at`, **transcript** | **hourly**, 35-day window |
| `call_archive` (§5.47) | every call-log row: direction, `result`, `leg_results`, duration | **hourly**, over 2 days (deep pass ~daily) — and only while the S3 bucket is configured |

**So the inbox does not keep its own copy of events.** It adds one thing: a **60-second hot tick**.
- The tick reads RingCentral's last 2 hours: one `message-store` read (**no `messageType` param** —
  the multi-value filter returns 400 on this account, §5.5, so filter locally, the way
  `/messaging/conversation` does) and one `call-log?view=Detailed` read.
- It hands each record to **its owning archive's own upsert**, so every table keeps exactly one
  writer. That matters because the archives carry invariants of their own — for example, a scan
  may only ever move `none` → `pending` (§5.47).
- It never writes those tables directly.

The inbox's own tables are only what is new (§4.3).

- **Reconcile, never increment** (§5.27, §5.47).
  - Each tick re-reads an overlapping window and upserts on RingCentral's own id.
  - So any successful tick repairs every missed tick from the last two hours, and the archives' own
    daily or hourly passes repair anything older.
- **Cost.** About **2 RingCentral requests a minute**, against a global budget of 90 a minute.
  Background requests are refused once the minute reaches 63. A refused tick is skipped, not
  retried hot — the call archive's shedding pattern.
- **A free side effect:** texts and voicemails become **minute-fresh** in their archives, for every
  other reader too.
- **Missed, answered or voicemail: the verdict is the SPA's rule.** It lives in
  `src/lib/callHistory/callHistory.ts` (`callConnected` / `isVoicemail`) and reads the call's
  **legs**.
  - This matters because a claimed (forwarded) call counts as *answered* even though its top-level
    result looks terminal (§5.13, §5.16).
  - `call_archive` deliberately does **not** store a verdict. The inbox computes it when it reads,
    from `result` and `leg_results`. Check at build time that those two fields are everything the
    rule reads.
  - That makes the gateway copy a hand-synced mirror — the §5.7 / §5.29 hazard. So it ships with a
    **parity test** that runs both copies over the same fixtures (the `directoryCoverage.test.ts` /
    `chaseMethodMirror.test.ts` convention).
- **Later, optionally:** `message-sync` (ISync), which `rcAllowlist.mjs` already names as the
  planned upgrade, or a message-store webhook.
  - ⚠️ Either needs its **own** route and reconcile.
  - Adding a filter to the existing telephony subscription would be silently dropped at renewal
    (`inboundCalls.mjs`).

### 4.3 Tables — only what is new

All on the messaging pool, created with `CREATE … IF NOT EXISTS`, one statement per module.

**The events are read, not copied** (§4.2):
- inbound and outbound texts from `sms_archive` — with `sent_messages` joined on the RingCentral id
  for who sent it;
- calls from `call_archive`;
- voicemails and their transcripts from `voicemail_archive`.

All three already key on `phone_hmac` + time, with an index for it.

```sql
comms_resolutions (
  id BIGSERIAL PRIMARY KEY,
  resolution_id UUID NOT NULL,          -- one click = one id, one row per number in the group
  phone_hmac TEXT NOT NULL,
  how TEXT NOT NULL,                    -- called | texted | no_action | left_vm (an attempt: does NOT close)
  note TEXT,                            -- the inline note (PHI — §5)
  covers_through TIMESTAMPTZ NOT NULL,  -- the newest inbound the rep SAW — §4.4
  resolved_by TEXT NOT NULL,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  item_board BIGINT, item_id TEXT,      -- the patient record at the time, when matched
  mirrored_to TEXT, mirror_error TEXT,  -- where the note was copied on Monday (§5)
  undone_by TEXT, undone_at TIMESTAMPTZ)
  -- index: (phone_hmac, resolved_at DESC)

comms_links (                           -- §6: "this number is that patient", inbox-only
  phone_hmac TEXT PRIMARY KEY, last4 TEXT,
  board_id BIGINT, item_id TEXT,
  linked_by TEXT NOT NULL, linked_at TIMESTAMPTZ NOT NULL DEFAULT now())

comms_dials (                           -- who pressed Call, for "We called · Katie"
  id BIGSERIAL PRIMARY KEY, phone_hmac TEXT NOT NULL,
  dialed_by TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now())

comms_inbox_runs (...)                  -- the *_runs ledger every sync module has
```

- ⚠️ **There is no phone-number column. HMAC + last4 only.**
  - That is the one property bounding every PHI table on this pool (§5.47).
  - A source-scan test pins it, the way `callArchiveRules.test.mjs` does. See Q1 for the alternative.
- ⚠️ **Resolutions are stored per NUMBER and grouped when read.**
  - A patient's record changes as they move boards — every board makes a new item (§6 of
    CLAUDE.md). A resolution keyed to a Welcome Call item id would be orphaned the day they reach
    Subscription. A phone number survives the hop.
  - So one click writes one row per number in the group, all sharing a `resolution_id`.
  - An unmatched number that is linked later brings its history with it. Nothing has to be
    re-keyed; the mockup has to migrate its state by hand for exactly this.

### 4.4 The rules — `commsInboxRules.mjs` (pure, tested)

**Grouping.** A number becomes a patient via `comms_links` first, then via `patient_directory`. The
directory refreshes daily, stores one row per number, and lets the furthest-along board win.
- A group is `(board, item)`. An unmatched number is its own group.
- **A brand-new patient's number** is matched live. At capture time the gateway has the number in
  the clear, so a directory miss runs the same batched Monday `any_of` lookup the browser's
  fallback runs (§5.29). The answer is cached against the HMAC.
- ⚠️ **A household number** — 18 of 3,140 are shared by different patients (§5.28) — groups under
  the directory's one pick.
  - The right pane's person switcher still lets the rep move to the other patient.
  - A resolution belongs to the number, so both patients see it.
- **The stage pill** comes from the directory's board, so it can be up to a day stale. The right
  pane always shows the truth.
  - *Inactive* needs the Subscription **group**, which the directory doesn't store today. Add
    `group_id` to its rows.

**Open, and how long it has waited.**
- A number is **open** when its newest inbound event is later than the newest `covers_through` on
  it that hasn't been undone.
- A group is open when any of its numbers is open.
- The **wait** runs from the first inbound event after the last resolution — the mockup's
  `openedBy`.

⚠️ **Compare against `covers_through`, not `resolved_at`.**
- The mockup compares the resolution *time* against the last inbound message. So a text that lands
  while the rep is typing the Called note gets swallowed: resolved, never seen.
- Instead, the client sends the newest inbound message it was showing, and anything newer reopens
  the item.
- This is my addition. The mockup never hit the problem because its data doesn't move.

**Resolving is a compare-and-set on the open period.**
- If somebody else resolved the item since you loaded it, the route answers **409** with who and
  when.
- The UI then shows that, instead of writing a second resolution. Two reps on one item is an
  ordinary afternoon.

**Over 24h** is wall-clock time in the mockup (`864e5` ms). Q7 asks whether weekends should count.

**The suggestion** is the newest outbound event after `openedBy`: an outbound `call_archive` row
suggests *Called*, an outbound `sms_archive` row suggests *Texted*.
- ⚠️ **Only an outbound text with a sender may suggest *Texted*** — a row in `sent_messages`, which
  means somebody pressed Send in the Command Center.
- The reason: the Railway automations (the Day-20 reorder text, the drop-off nudges) text from the
  same line. Without this rule, a patient who asked *"when does my order ship?"* would get a
  *Texted 9:00 AM — Confirm* suggestion off a robot's reorder link.
- An outbound text with no sender (sent from the RingCentral desktop app, or by an automation) still
  shows in the timeline and suggests nothing.

**What opens an item.**
- **Opens:**
  - an inbound SMS or MMS;
  - an inbound call-log row that did not connect (the leg rule), unless RingCentral says `Blocked`;
  - a voicemail.
- **Never opens:**
  - a fax;
  - anything from our own numbers (`RC_SMS_FROM` + `SMS_ARCHIVE_OUR_NUMBERS`, the list
    `sms_archive` already excludes).
- **An open question:** numbers that aren't patients — Q12.

**Left VM** (only if Q6 = yes) is a resolution row with `how = left_vm`. It does **not** move
`covers_through`, so the item stays open. It shows in the timeline and counts in the SLA as an
attempt.

### 4.5 Routes

All are hard-authenticated with `inboundCalls`' `requireCaller`, which never lets "unknown" through,
except the health route.

| Route | Does | Reads |
|---|---|---|
| `GET /comms/inbox?view=open\|over\|all&type=&q=&sort=` | The list. Each row: an opaque key (the `/calls/prefs` `allow[].id` precedent) · name · last4 · stage pill · wait · preview · kind · last resolution | Postgres |
| `GET /comms/inbox/count` | `{open, over}` for the header badge | Postgres |
| `GET /comms/item?key=` | One item's events and resolutions. Its numbers are resolved **on open** (§4.8) | Postgres, plus one RingCentral or Monday read to resolve the number |
| `POST /comms/resolve` | Takes `{key, how, note?, seenThrough}`. Answers **409** if it's already resolved, and **400** for `called` without a note — the server enforces what the UI enforces | Postgres |
| `POST /comms/undo` | Only the resolver, within 15 minutes (Q13) | Postgres |
| `POST /comms/note` | The optional note after *Texted* or *No action needed* | Postgres |
| `POST /comms/link` | Links an unmatched number to a patient — inbox-only (§6) | Postgres |
| `POST /comms/dialed` | The softphone reports who dialed which number | Postgres |
| `POST /comms/state` | Takes `{numbers[]}` and returns that group's state, for a patient screen that already holds the numbers. The `/directory/lookup` posture: nothing is disclosed the caller didn't bring | Postgres |
| `GET /comms/sla?days=` | The Reports card | Postgres |
| `GET /comms/inbox-health` | **Unauthenticated**, counts only. **Not ok** if no tick has ever succeeded, if the last success is stale, or if the deep pass was truncated | Postgres |

### 4.6 The browser side

- **New modules:** `lib/commsInbox/{api,rules}.ts` and `hooks/commsInbox/useInbox.ts`.
  - The store follows `rcStore`'s rules: one module-level store, a stable snapshot, a TTL, and no
    polling from hidden tabs.
  - But it reads **Postgres**, never RingCentral: a 30 s TTL for the list, 60 s for the badge.
- **New components:** `components/commsInbox/{InboxList, ItemTimeline, ResolveBar,
  FindPatientPane}.tsx`.
- ⚠️ **`ItemTimeline` reuses the thread; it never copies it.**
  - `ConversationThread` carries the opt-out consent rule (it needs the full history), the delivery
    re-check (§5.5), MMS attachments and Can Text.
  - So extract a `useConversation(phone)` hook and a `Composer` from it. Both the old thread and the
    new timeline render those, and there stays exactly one copy of each guard.
  - Calls and voicemails come from the existing readers **on open** — `fetchPatientCallHistory`, and
    the voicemail list filtered by number.
  - The resolution dividers come from `/comms/item`.
- **Header badge** (`GlobalHeader`): the unresolved count.
  - It is fetched only for people who can see the tab (`comms`).
  - A 60 s poll of `/comms/inbox/count`, skipped while the tab is hidden. No RingCentral.
- **The Call button** already dials through the one softphone (`useWebPhone`). It additionally POSTs
  to `/comms/dialed`. That is what makes *"We called · Katie"*, and an attributed *Called*
  suggestion, possible.

### 4.7 RingCentral budget

| | RingCentral requests |
|---|---|
| Gateway capture | about 2 a minute, background tier |
| Inbox list · count · item state · resolve | **0** — Postgres |
| Opening an item | the same as opening a thread today: the conversation plus the call history, on open |
| The logs (Texts / Calls / VMs) | unchanged from today's tabs until phase 3; later they could be served from the three archives |

### 4.8 PHI — what is new

**One new thing lands on the messaging pool: `note`** — what the rep wrote.
- That is the same category as `sms_archive.body` and `voicemail_archive.transcript`. Both were
  accepted explicitly (§5.27, §5.47b).
- The list's previews are read from those two columns. Nothing is copied.

**Two categories this design avoids:**
- **The phone number in the clear.**
- **The caller-ID name.** `voicemail_archive` stores *"never the number, and never the caller-ID
  name"*, deliberately, and the inbox follows it.

What that means on screen:
- The list shows the patient's name from the directory. For an unmatched caller, it shows
  *Unknown caller* and `···1234`.
- The RingCentral caller-ID name appears once the item is opened, read live, the way the hub reads
  it today.
- The full number is resolved **when the item is opened**: from the patient's Monday record when
  matched, otherwise from the RingCentral record by id.
- Searching by a full number still works, because the gateway hashes what you type.
- If `···1234` on unknown callers isn't acceptable, Q1 has the alternative: store the number
  encrypted.

---

## 5. Inline notes — thought through

The mockup has two inline notes:
- **Required.** `Called` opens *"What did you talk about? (required)"*, and Resolve stays disabled
  until it has text.
- **Optional.** After `Texted` or `No action needed`, *"Add a note (optional)"* + Save is offered
  once, right after resolving.

Both render in the timeline divider and in the resolved footer. In the mockup they exist only in page
memory. This is everything that has to be decided about them.

> I read "inline notes" as these two. If you meant the design notes written inline in the mockup's
> code, those are §1–§2, with my read on each.

**5.1 The log is the record.**
- Every note is stored in `comms_resolutions.note` first, whatever else happens.
- That is also the only place a note on an **unmatched** number can live — there is no Monday item
  to write it to.

**5.2 Should notes be copied to Monday? (Q2)** A note that says what was discussed is case history,
and the person working that patient tomorrow reads the stage's notes, not the inbox. So the default
proposal:
- Copy every **non-empty** note on a **matched** patient who has a **live** record.
- Write it into that record's notes column — the active board, the same record Recent notes writes
  to.
- Use the one existing writer, `dossierApi.appendNoteToRecord`. It re-reads the column before
  appending, and asks the live board about the 2,000-character cap.
- Stamp it with the stage label **Communications**:
  `[Sep 23, 2026, 2:10 PM] Communications: Called — told her it ships Friday —JH`.
- A `No action needed` with no note writes **nothing** to Monday.
- A patient with no live record (every record completed) gets the log only. A completed item is
  read-only in new code (§5.38).

**5.3 Order and failure.**
- Resolve first (Postgres), copy to Monday second.
- A failed copy never un-resolves anything. The UI says *"Resolved — couldn't copy your note to
  Monday: …"*, and the row records `mirror_error`.
- The copy runs **in the browser**, as the signed-in rep. That keeps the audit attribution every
  other note path has. It then reports `mirrored_to` back to the log.

**5.4 Undo vs. the Monday copy (Q3).**
- Monday notes are append-only, and Monday has no compare-and-set.
- **Default:** Undo does **not** touch Monday, and the undo toast says so.
  - The argument: a *Called* note records a conversation that happened. Undoing means "this still
    needs attention", not "the call didn't happen".
- **The alternative:** hold the copy until the row stops being sticky. That loses the note if the
  tab closes first.

**5.5 ⚠️ A comms note must never be read as a stage's own structured line.** Two of these columns are
*parsed*.

The **Medical Evaluation notes** (`text_mm6vevjf`) are Doctor Appointments' attempt **counter**
(§5.12).
- Any line shaped `… · <Phone call|Text message|Email> — <known outcome>` counts as an outreach
  attempt.
- Worse, `isResetLine` in `lib/masheke/apptOutreach.ts` is an **unanchored `includes`**. **Any**
  line containing `Provider requires a new visit` or `[Returned to queue` resets the count. That
  hands the rep unlimited retries, and nothing says so.
- So a rep writing *"office says provider requires a new visit"* does exactly that.
- ⚠️ **This is live today, for every notes box on that board — not just the inbox.**
- **Fix it at the source:** anchor `isResetLine` to the stamps that really write those markers. That
  is a phase 2 prerequisite, with a test.
- The copy's line builder, `commsNoteLine()`, must also rewrite `" · "` and strip newlines, so it can
  never produce an attempt line either.

The **Welcome Call notes** carry the `--- WC INTAKE v1 ---` block. `callIntake` already strips those
markers from caretaker notes; `commsNoteLine()` must do the same.

**A test must prove** a copied note is never counted as an attempt, never resets the counter, never
becomes a proposed-stuck reason, and never splits the Welcome Call intake block.

**5.6 ⚠️ The lost-update window is real, and 5.1 is what makes it survivable.**
- Several writers replace the **whole** notes column from the page's own copy of it:
  - the stage pages' Add-note button (`sendNotesToMonday`);
  - the Welcome Call and Subscription sends.
- That copy can be up to a poll old. So a comms note copied to Monday while a Welcome Call rep has
  the page open can be overwritten by their Send.
- That is the exposure every note path already carries (§5.28: *"they append onto a 15-second
  poll"*). The inbox only adds more writes to it.
- **The note survives in the log either way** — which is exactly why the log comes first.

**5.7 Noise.** The Care Coordinator card shows the **newest line** of the notes (§5.30e). A stream of
Communications lines would push the useful line off it. That is a second reason never to copy a
note-less *No action needed*.

**5.8 What notes do NOT do.**
- They can't be edited or deleted afterwards — append-only, like every other note path. A correction
  is a new note.
- A *Called* resolution does **not** bump Welcome Call's Call Attempts or Patient Intake's attempt
  counter. A patient reaching out and us calling back is not an outreach attempt (Q11).

**5.9 Rules the server enforces too.**
- `called` without a note → 400.
- Notes are trimmed and made single-line.
- The log caps a note at a sane length (say 2,000 characters), so a paste can't bloat it.
- Monday's side is fine: the six live notes columns have been uncapped `text` since 2026-09-03.

**5.10 On the patient screen,** the compact bar carries the same *Called* note input, so resolving
from a profile follows the same rules.

---

## 6. Unmatched number → a patient (Q4 — destructive)

The mockup writes the number onto the patient: *Add as alternate phone*, which **replaces** any
existing alternate, or *Use as primary phone*. Here is what that runs into.

**The Alternate Phone column exists only on Welcome Call** (`phone_mm7265hp`) **and Subscription**
(`phone_mm72r19q`).
- The Welcome Call phone slots own it, along with Alternate Contact, Can Text and Caregiver
  (§5.31d).
- A second writer for that column is the §5.31c / §5.31d failure.
- Patients on Intake, Medical Evaluation or Insurance have no alternate column at all.

**Primary Phone** is written by the patient screen's pencil (`updatePatientContact`, §5.46g), and
that writer:
- writes the **anchor record only** — other boards keep the old number;
- **clears Can Text**, which is its rule;
- refuses a completed record.

**"(replaces X)" silently discards a real number** — possibly a caregiver's.

**Proposal:**
1. **Phase 2 writes nothing to Monday.** The rep's pick records an **inbox-only link**
   (`comms_links`): *this number is that patient*. That gives the mockup's result — the history now
   sits on their profile, in the inbox — immediately and reversibly.
2. **Later, and only if Q4 = yes:** *"Also save it on their profile"*, as an explicit second action,
   through the existing writers:
   - the primary number through the pencil path, behind `editProfile`;
   - the alternate number through a writer that follows the phone-slot rules, on Welcome Call and
     Subscription records only;
   - and it **never** overwrites an existing alternate unless the rep chooses that on screen.
3. **Clear the name cache on link.** The browser's name cache (`useDirectoryNames`) remembers misses
   for the whole session, so making a link must drop that number's miss. Otherwise the list keeps
   saying "Unknown" until a reload.

## 7. The right pane (Q9)

`DIFF_2026-09-22.md` §14 already notes that the mockup's pane is the **patient screen**, not our
`PatientDossierPanel`.

**What swapping them takes.** Split `PatientPage` into a route shell and a body component.
- The shell keeps `useParams` / `useSearchParams`.
- The body takes its view state (`view`, `step`, `snap`, `tool`, `sub`) as props, or reads a
  namespaced set of params.
- It is the same move §5.39c2 found the stage pages had already made.

**What must survive:** four jobs the dossier pane does and the patient screen does not.
1. **The household switcher** (*N patients share this number*). The composer's attribution depends
   on it.
2. **A writable notes box, plus every stage's notes.** The embedded main column has no Recent notes:
   those live in `.pt-side`, and the hub replaces that column with the thread.
3. **Find-a-patient without writing** (`DossierSearch`), and its *"Found by search"* banner.
4. **The per-stage call detail.** This one can go: the info strip plus the read-only stage panels
   replace it well.

**What it costs.** One or two more Monday reads per item opened — the stage panel's full-width
record, and the subscription view. They are on open and never polled, so it's allowed, but the pane
is heavier than today's.

**Default:** keep `PatientDossierPanel` through phases 1–3, and swap in phase 4 with the checklist
above.

---

## 8. Build order

Each phase lands on its own, and nothing is removed before phase 3.

**Phase 0 — decisions.** §9.

**Phase 1 — the gateway, in shadow mode, with no UI (M).**
- Build all of §4.2–§4.5, behind `COMMS_INBOX_ENABLED`.
- Run it for a few business days and *measure before anyone sees it*:
  - items opened per day, by kind;
  - how many are unmatched;
  - how many are replies to automated texts;
  - how many are doctor offices, vendors or spam.
- Compare its open set against what the hub's lists show.
- Wire up the health route and `calls-monitor`.
- **Tests:**
  - the rules: open · reopen · the cover race · 409 · suggestion · grouping · household · over 24h ·
    undo · left VM;
  - the missed-call parity test;
  - the no-plaintext-number source scan.

**Phase 2 — the Inbox (L).**
- Add an **Inbox rail as the hub's default**. Phone, Text and Fax stay untouched.
- Build:
  - the list;
  - the item timeline, reusing the thread;
  - the resolve bar with its inline notes — log plus Monday copy (§5);
  - unmatched → link, inbox-only (§6);
  - the header badge.
- **Prerequisite:** anchor `isResetLine` (§5.5).
- Render-check at 1100 / 1440 / dark, with a **long** real list (§7's lesson).

**Phase 3 — spread it (M).**
- The patient screen's compact resolve bar.
- Reshape the logs:
  - Calls and VMs become their own rails;
  - Texts becomes a log with Received / Sent;
  - every log row opens the item.
- Unread moves to the Texts log (Q10).
- Dial attribution.
- Left VM, if Q6 = yes.

**Phase 4 — the rest (L).**
- The right pane becomes the embedded patient screen, with §7's checklist.
- The SLA card in Reports (Q8), once the log has a few weeks in it.
- *Save the number on their profile*, if Q4 = yes.

**Phase 5 — optional.**
- Capture through `message-sync` or a webhook instead of polling.
- The manager sidebar contact marks switch to "unresolved". Today they show "who spoke last", so the
  two screens will disagree by design until then.
- A count on the dashboard's Communications bar. ⚠️ That is a §5.8 counting-contract change, and
  both baseline generators would need to reach the gateway.

## 9. Questions

Each question comes with the default I'd build if you say "go with defaults". The **bold** ones block
phase 1 or 2.

1. **Phone numbers (PHI).**
   - **Default:** **don't store them.** HMAC + last4 only, with the full number resolved on open, so
     unknown callers show `···1234` in the list.
   - **Alternative:** store them encrypted with a Railway key. Simpler and durable, but a new PHI
     category.
2. **Copy resolve notes to Monday?**
   - **Default:** **yes** — non-empty notes on matched patients with a live record, stamped
     `Communications`; never a note-less *No action needed*.
   - **Alternatives:** never copy them; or copy only *Called* notes.
3. **Undo after a note was copied.**
   - **Default:** leave the Monday line, and say so in the toast.
   - **Alternative:** hold the copy until the row stops being sticky.
4. **Writing numbers onto patient records** (the mockup's add-as-alternate / use-as-primary).
   - **Default:** **not in phase 2.** Only an inbox-only link; later an explicit *Save to profile*
     through the existing writers, which never silently replaces a number.
   - Is replacing an existing alternate ever OK?
5. **`Mine | All patients`.**
   - **Default:** **don't build it.** It needs a per-patient owner that no board has.
   - It also contradicts §5.13 ("it does not matter who picks up") and §5.30 ("no assignment").
6. **Left VM.** It's in the rules but not in the mockup's UI.
   - **Default:** **build it,** as a fourth button that logs an attempt and leaves the item open.
   - Or drop it?
7. **The 24-hour clock.** The mockup counts wall-clock hours, so every Friday-evening text is a breach
   by Monday morning.
   - **Default:** **don't count Saturday and Sunday.**
   - Or keep wall clock as drawn, or count business hours only?
8. **Reports & Metrics.** You blanked it on 9/22.
   - **Default:** add the SLA card in phase 4, as the first real report.
   - OK to un-blank it?
9. **The right pane.**
   - **Default:** keep today's dossier pane until phase 4, then swap to the embedded patient screen,
     carrying §7's four survivors.
10. **Unread.**
    - **Default:** opening an item still marks its messages read in RingCentral, so the desktop app
      stays in step.
    - The Inbox has no Unread filter. The Texts log keeps Unread, plus mark read/unread.
    - The badge counts unresolved items, not unread ones.
11. **Does *Called* also count as a stage call attempt** (Welcome Call attempts, the Patient Intake
    counter)?
    - **Default:** no.
12. **Numbers that aren't patients** — doctor offices, vendors, spam.
    - **Default:** they open items like anyone else, labelled with the RingCentral or Doctor Database
      name, and get resolved *No action needed*.
    - Or should offices in the Doctor Database skip the queue? (A doctor's office calling back about
      clinicals is often the most important call of the day.)
13. **Permissions.**
    - **Default:** anyone who can open Communications (`comms`) can resolve.
    - Undo belongs to the resolver, within 15 minutes. Nothing can be deleted.
14. **Retention.**
    - **Default:** keep the resolution log forever, like the recordings (§5.47) — it is the SLA's
      history.
15. **The stage pill's label.** The mockup says "Medical Evaluation"; our stepper says "Medical
    Necessity".
    - **Default:** match the patient screen.
16. **Replies to automated texts** (reorder confirmations, drop-off nudges) will open items, so
    "Got it, thanks!" becomes work.
    - As designed, or exclude them?
    - **Default:** as designed, and measure it in phase 1 before deciding.

## 10. Guards and keep-in-agreement

Write these into CLAUDE.md when the feature ships.

- The missed-call verdict in `commsInboxRules` ⇄ `src/lib/callHistory/callHistory.ts` (the parity
  test).
- The own-number exclusion list ⇄ `sms_archive`'s.
- The hot tick writes each archive **only through that archive's own upsert** — one writer per
  table, so its invariants hold (§5.47's `none` → `pending` rule, among others).
- `ItemTimeline` and `ConversationThread` share `useConversation` / `Composer`. **Never a second
  copy** of the opt-out, delivery or Can Text guards.
- Every Monday write of a note goes through `appendNoteToRecord`.
- `commsNoteLine()` ⇄ the three note parsers: `apptOutreach`, `proposedStuck` and `callIntake`.
- The badge and the list read the **same** route family, so they can never disagree.
- No RingCentral call on any list, count or resolve route. A source-scan test pins it — the
  `can-text` convention (§5.31f).

## 11. Found along the way (not part of this plan)

- **`isResetLine` is unanchored** (§5.5). It is live today; the chance of hitting it is low, and it
  is silent when it hits.
- **`GET /messaging/call-health` is public and uncached,** and it does a real SIP provision on every
  hit.
  - Each hit spends the rate-limit key shared with softphone setup and the call-webhook renewal.
  - Per §5.13b, every provision creates a RingCentral device record.
  - Queued as a separate task.
