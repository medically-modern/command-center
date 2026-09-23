# Communications inbox — the "Unresolved queue" (v2): plan and diff (Sep 2026)

> Josh, 2026-09-23: *"this is the new comms dash, make a plan for implementing and diff it to what
> we have compared to what the dash asks for, inline notes need to be thought through … make a
> detailed plan for building this and ask any questions on anything that is unclear / seems
> destructive"*

**Status: DRAFT — nothing is built.** Josh answered every question on 2026-09-23: the five
destructive items and the four follow-ups (§9.1). Nothing is open; the defaults in §9.3 stand unless
he changes one. When a phase ships, record it in CLAUDE.md (a new §5 section, the way §5.47 recorded
the call archive) and mark it here.

**Source.** Brandon's `command-center-mockup-REAL-DATA_2.html` (7.7 MB). The spec is the script
block headed *"COMMUNICATIONS v2 — the Unresolved queue (Brandon + Katie, 2026-09-22)"*, plus the
Reports override and the patient-screen hook after it.
- ⚠️ The file carries real PHI and stays **out of this repo** (`_reference/brandon-redesign/README.md`).
- ⚠️ v2 is in **neither** the 9/18 handoff doc (rev 34) **nor** the sample-data mockup in
  `_reference/`. Both predate it. The mockup's code and the comments inside it are the whole spec.
  This doc quotes the rules so nobody has to open the PHI file to learn what was asked.

**Section numbers.** §0–§11, and §5.1–§5.10 under Inline notes, are this plan's own. Anything else
(§5.12 and up) is CLAUDE.md, and where a number could be either, the text says *CLAUDE.md*.

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

**Where it is saved — everything for a number in one place** (§4.9 has the full map).
- **One database:** the gateway's messaging Postgres, which already archives every text, call,
  voicemail and photo. The audio and photos sit beside it in the `call-recordings` bucket. Every
  table is keyed by the number's hash, never the number itself.
- **What's new is small:** `comms_resolutions` holds each resolution with its inline note, and
  `comms_links` holds "this number is that patient".
- **One route, `/comms/item`, makes it one timeline.** It reads all of it for the patient's numbers
  and returns texts, calls, voicemails you can play, and resolutions with their notes, in time order.
  That is the mockup's single timeline.
- **The note also goes to Monday** — into the patient's notes when the rep moves on (§9.1 D5), so the
  rep who opens their stage page tomorrow reads it too.

**Most of the UI exists already.**
- Today's Text and Phone tabs *are* the mockup's Texts / Calls / VMs logs.
- The thread, the dossier pane and the find-a-patient search are all built.

**New:** the Inbox list, one timeline per patient, the resolve bar with its inline notes and a *Left
voicemail* button, the header badge, and the SLA card.

**Build order is additive-first (§8).** The Inbox is *added* as a new default rail, and the current
Phone / Text / Fax rails stay exactly as they are until the team has used it. The destructive items
were each decided explicitly (§9.1); nothing else destructive is in the plan.

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
   read but never written. **Decided: we build it, as a fourth button (§9.1 D6).**
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
- `Mine | All patients` — shown only when you have assigned patients. **Not built** (§9.1 D2);
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
  owner field. Not built (§9.1 D2).

## 3. Diff — what the mockup asks for vs. what we have

| Mockup | Today (`/assigned-patients`, CLAUDE.md §5.28) | Verdict |
|---|---|---|
| **Unresolved state, shared by everyone** | Nothing. Read state is RingCentral's `readStatus` — one per message, shared with the RC desktop app. Nothing anywhere records "handled". | **MISSING — the core of the build (§4)** |
| Inbox: Unresolved / Over 24h / All, search, sort, type chips, stage pill, wait clock | Text tab = conversations + an Unread filter; Phone tab = calls + a voicemail sub-tab with Today / Missed | **MISSING** — the list is new; search and sort exist per tab |
| Unit = the patient (primary + alternate number folded together) | Unit = one phone number (one RingCentral conversation) | **PARTIAL** — the directory maps number → record (§5.29); the grouping is new |
| Texts log (All / Received / Sent) | Text tab (All / Unread, New text, mark read/unread, naming progress) | **PARTIAL** — Received/Sent is new; Unread exists and the mockup drops it — retired (§9.1 D4) |
| Calls log (All / Inbound / Outbound / Missed) | Phone tab (Today / All / Missed; recordings play + ⤓ + *Download N*; archive playback §5.47) | **PARTIAL** — Inbound/Outbound is new; our recordings go further than the mockup |
| VMs log | Phone → Voicemail (transcripts, heard/unheard, a call opening the voicemail it left). Since 2026-09-23 the audio and transcripts are also archived (§5.47b) | **HAVE** — ours does more |
| Fax rail | Fax tab (views, sending office + its patients, read/unread) | **HAVE** — v2 doesn't change it |
| One timeline per item: texts + calls + VMs + resolution dividers | Separate pieces: `ConversationThread`, `VoicemailDetail`, call rows. A call that left a voicemail stacks the VM above the thread. Texts, calls, recordings, voicemails and photos are all archived (§5.27, §5.47, §5.47b, §5.47c), but nothing puts them on one timeline | **MISSING** — a new component built from the existing pieces, read from the archives (§4.9) |
| Composer under the timeline | `ConversationThread`'s composer: opt-out guard, delivery-failure note (CLAUDE.md §5.5), MMS, Can Text | **HAVE** — reuse it, never copy it |
| Resolve bar: wait + Called(note) / Texted / No action; suggestion; sticky + Undo; optional note | — | **MISSING** |
| Left VM (logs an attempt, stays open) | — (the mockup doesn't build it either) | **MISSING — built as a fourth button, playing the recording of the call it was left on** (§4.4, §9.1 D6) |
| Right pane = the patient screen's main column + Open Profile Page | `PatientDossierPanel`: stage path, writable notes, every stage's notes, per-stage call detail, household switcher, find-without-writing, Open profile page | **DIFFERENT** — swap approved, carrying all five jobs (§7, §9.1 D3) |
| Unmatched → find → **add the number to the patient** (alternate or primary) | `DossierSearch` finds and shows the profile and **writes nothing** — deliberately (§5.28) | **NEW WRITE — approved** (§6, §9.1 D1) |
| `Mine \| All patients` | No per-patient owner exists anywhere. §5.13 and §5.30 record *no ownership* | **NOT BUILT** (§9.1 D2) |
| Header badge = unresolved count | No badge at all (`DIFF_2026-09-22.md` §1 already lists it missing) | **MISSING** |
| Patient screen: compact resolve bar | `PatientCommsColumn` (Texts thread, Calls button, alternate-number switch, Recent notes) | **MISSING** |
| Reports: Communications SLA card | Reports & Metrics is deliberately blank — "No reports available yet" (Josh, 2026-09-22, §5.46b) | **MISSING — built as drawn, replacing the blank page** (§9.1 D8) |
| The hub header (dialer, "which calls ring me") | The navy header with a dialer and the ring-preferences bell, plus the bell on a conversation (`WatchCallbackButton`) | **HAVE** — v2 doesn't redraw the header; keep ours |
| Outbound-call attribution ("We called · Katie") | None: one shared RingCentral extension, so the call log can't say who (§5.13b). `sent_messages` attributes texts only | **MISSING** (small — §4.6) |

**Built today, not in the mockup, and it must survive** (§5.39f's lossless rule):
- New text to any number (`NewTextPanel`), and the naming progress bar.
- The opt-out guard and the delivery-failure notes (CLAUDE.md §5.5).
- MMS attachments.
- Recordings: *Download N*, and archive playback (§5.16, §5.47).
- Voicemail heard/unheard (the flag and the right-click; the Unheard *filter* is retired, §9.1 D4),
  and a call opening the voicemail it left.
- Mark read/unread — the RingCentral desktop app sees it. (The Unread *filter* is retired, §9.1 D4;
  the flag itself stays in step with RingCentral.)
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

### 4.2 Capturing events — the archives already hold them

**Every kind of event is already archived on the messaging pool, just not quickly enough.**

| Archive | Holds | Refreshes |
|---|---|---|
| `sms_archive` (§5.27) | every text, both directions: body, status, **delivery error**, `created_at`, and the list of any photos attached | **daily**, 35-day window |
| `voicemail_archive` (§5.47b — landed 2026-09-23) | every voicemail: duration, `created_at`, **transcript**; the audio in the bucket | **hourly**, 35-day window |
| `call_archive` (§5.47) | every call-log row: direction, `result`, `leg_results`, duration; the recording in the bucket | **hourly**, over 2 days (deep pass ~daily) — and only while the S3 bucket is configured |
| `mms_archive` (§5.47c — landed 2026-09-23) | the photos, videos and contact cards sent with texts; the bytes in the bucket | **hourly**. Its queue is `sms_archive`'s attachment list, so it never reads RingCentral for metadata |

**So the inbox does not keep its own copy of events.** It adds one thing: a **60-second hot tick**.
- The tick reads RingCentral's last 2 hours: one `message-store` read (**no `messageType` param** —
  the multi-value filter returns 400 on this account, CLAUDE.md §5.5, so filter locally, the way
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
- **Photos follow within the hour.** A text with a photo lands in `sms_archive` on the tick, and
  `mms_archive` fetches the bytes on its next hourly run. Until then the timeline shows the photo
  from RingCentral, exactly as today's thread does (§4.6).
- **Missed, answered or voicemail: the verdict is the SPA's rule.** It lives in
  `src/lib/callHistory/callHistory.ts` (`callConnected` / `isVoicemail`) and reads the call's
  **legs**.
  - This matters because a claimed (forwarded) call counts as *answered* even though its top-level
    result looks terminal (§5.13, §5.16).
  - `call_archive` deliberately does **not** store a verdict. The inbox computes it when it reads,
    from `result` and `leg_results`. Check at build time that those two fields are everything the
    rule reads.
  - That makes the gateway copy a hand-synced mirror — the CLAUDE.md §5.7 / §5.29 hazard. So it ships with a
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
- voicemails and their transcripts from `voicemail_archive`;
- photos from `mms_archive`, through the list `sms_archive` already keeps.

All of them already key on `phone_hmac` + time, with an index for it.

```sql
comms_resolutions (
  id BIGSERIAL PRIMARY KEY,
  resolution_id UUID NOT NULL,          -- one click = one id, one row per number in the group
  phone_hmac TEXT NOT NULL,
  how TEXT NOT NULL,                    -- called | texted | no_action | left_vm (an attempt: never closes)
  note TEXT,                            -- the inline note (PHI — §5); always null for left_vm
  covers_through TIMESTAMPTZ NOT NULL,  -- the newest inbound the rep SAW — §4.4
  resolved_by TEXT NOT NULL,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  item_board BIGINT, item_id TEXT,      -- the patient record at the time, when matched
  mirror_claimed_at TIMESTAMPTZ,        -- the copy to Monday is claimed before it is written (§5.4)
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
  - A source-scan test pins it, the way `callArchiveRules.test.mjs` does. It is a stated default
    (§9.3); the alternative — the number stored encrypted — would be a new PHI category.
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
- A number is **open** when its newest inbound event is later than the newest `covers_through` among
  its resolutions that are neither undone nor a *Left voicemail*.
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

**Over 24h — Saturday and Sunday don't count (§9.1 D7).** The mockup uses wall-clock time
(`864e5` ms); ours skips the weekend.
- The wait is the time since `openedBy`, minus every hour of Saturday and Sunday in Eastern time.
- A text at 6 PM Friday reads *Waiting 15h* at 9 AM Monday, and turns red at 6 PM Monday.
- A message that arrives on the weekend starts its clock at midnight Monday. A Saturday text reads
  *Waiting 0m* all weekend, *Waiting 9h* at 9 AM Monday, and turns red as Tuesday begins.
- Eastern is read through `Intl`, never a fixed offset — the way `callArchiveRules.isOfficeHours`
  already does it. So a daylight-saving weekend, which is 47 or 49 real hours long, still skips
  exactly Saturday and Sunday.
- Holidays count like weekdays. Nothing in the app knows them; there is no holiday list anywhere in
  `src/`.
- ⚠️ **One function, `countedWaitMs(openedBy, now)`, on the gateway, and no copy in the browser.**
  The wait on screen, the red flag, the *Over 24h* tab and every number on the SLA card come from
  it. The browser only shows the wait it is given. The list and the open item refresh every 30
  seconds, which is finer than the minutes the screen displays, so a second copy for the browser to
  tick with would buy nothing but a mirror to drift (the CLAUDE.md §5.7 hazard).

**The suggestion** is the newest outbound event after `openedBy`: an outbound `call_archive` row
suggests *Called*, an outbound `sms_archive` row suggests *Texted*.
- ⚠️ **Only a CONNECTED outbound call suggests *Called*** — the same leg rule as the missed-call
  verdict. This departs from the mockup, whose suggestion also fires on `Called patient · no answer`.
  *Called* asks *"What did you talk about? (required)"*, so highlighting it after an unanswered
  callback invites a rep to resolve an item nobody spoke about. The unanswered call still shows in
  the timeline.
- ⚠️ **A callback that reached the patient's voicemail probably reads as *connected*.** To the phone
  network, a voicemail box answers the call, and our rule reads any leg RingCentral calls
  *Call connected* as connected. That is reasoned, not measured on this account; phase 1 settles it
  with one test call (§8). If it holds, *Called* is highlighted after the rep left a message. So a
  call that a *Left voicemail* press links to (below) never suggests *Called*.
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
- **Numbers that aren't patients** — doctor offices, vendors — open items like anyone else, as the
  mockup's rule says (§9.3). Phase 1 counts them.
- **A missed call that went to our voicemail is ONE event,** not two. The call-log row and the
  voicemail it left are joined by the number-and-time rule the hub's Phone tab already uses
  (`callVoicemail.ts`, §5.28), and the item shows it as a voicemail. If the rule finds no match they
  stay two rows — it fails closed.
  - The gateway needs that rule too, to label list rows, so its copy ships with a parity test, like
    the missed-call verdict (§4.2).

**Left voicemail (§9.1 D6).**
- It is a row in `comms_resolutions` with `how = left_vm` and no note.
- It does **not** move `covers_through`, so the item stays open and its 24-hour clock keeps running.
- It sits apart from the three *Mark resolved* buttons, because it resolves nothing.
- In the timeline it reads *Left voicemail · Katie · 2:10 PM*. On the SLA card it counts as an
  **attempt**, never as a resolution.
- **Listen.** Calls are recorded in both directions (§5.16), so the message the rep left is in that
  call's recording. The row links to **the newest outbound call to the patient's numbers that ended
  no more than 15 minutes before the press**, and plays its recording.
  - The link is worked out when the timeline is read, never stored. A call that reaches the archive
    a minute after the press still links.
  - ⚠️ **No such call, no Listen.** It fails closed, like a call opening the voicemail it left
    (§5.28): linking the wrong call would play the rep a different conversation.
  - The call is also its own row in the timeline, with its own play button, either way.
- **Undo** comes from its toast, under the same server rule as a resolution: the author, within 15
  minutes.
- It writes nothing to Monday (there is no note), and it doesn't count as a Welcome Call or Intake
  call attempt (§5.8).

### 4.5 Routes

All are hard-authenticated with `inboundCalls`' `requireCaller`, which never lets "unknown" through,
except the health route.

| Route | Does | Reads |
|---|---|---|
| `GET /comms/inbox?view=open\|over\|all&type=&q=&sort=` | The list. Each row: an opaque key (the `/calls/prefs` `allow[].id` precedent) · name · last4 · stage pill · wait · preview · kind · last resolution | Postgres |
| `GET /comms/inbox/count` | `{open, over}` for the header badge | Postgres |
| `GET /comms/item?key=` | One item's timeline: every event on the patient's numbers from the four archives, the resolutions with their notes, and who sent or dialed (§4.9). Its numbers are resolved **on open** (§4.8) | Postgres, plus one RingCentral or Monday read to resolve the number |
| `POST /comms/resolve` | Takes `{key, how, note?, seenThrough}`, where `how` is `called` · `texted` · `no_action` · `left_vm`. Answers **409** if it's already resolved, and **400** for `called` without a note — the server enforces what the UI enforces | Postgres |
| `POST /comms/undo` | Only the author, within 15 minutes, and never once the note has been copied to Monday (§5.4) | Postgres |
| `POST /comms/note` | The optional note after *Texted* or *No action needed* | Postgres |
| `POST /comms/mirror` | The resolver's browser claims an uncopied note, then reports where it landed on Monday, or the error (§5.4) | Postgres |
| `POST /comms/link` | Records *this number is that patient* (§6). Written after the Monday write succeeds, or alone for a link-only pick | Postgres |
| `POST /comms/dialed` | The softphone reports who dialed which number | Postgres |
| `POST /comms/state` | Takes `{numbers[]}` and returns that group's state, for a patient screen that already holds the numbers. The `/directory/lookup` posture: nothing is disclosed the caller didn't bring | Postgres |
| `GET /comms/sla?days=` | The Reports card | Postgres |
| `GET /comms/inbox-health` | **Unauthenticated**, counts only. **Not ok** if no tick has ever succeeded, if the last success is stale, or if the last tick was cut short. It also reports how many notes are waiting to be copied to Monday, and the oldest | Postgres |

### 4.6 The browser side

- **New modules:** `lib/commsInbox/{api,rules}.ts` and `hooks/commsInbox/useInbox.ts`.
  - The store follows `rcStore`'s rules: one module-level store, a stable snapshot, a TTL, and no
    polling from hidden tabs.
  - But it reads **Postgres**, never RingCentral: a 30 s TTL for the list, 60 s for the badge.
- **New components:** `components/commsInbox/{InboxList, ItemTimeline, ResolveBar,
  FindPatientPane}.tsx`.
- ⚠️ **`ItemTimeline` reuses the thread; it never copies it.**
  - `ConversationThread` carries the opt-out consent rule (it needs the full history), the delivery
    re-check (CLAUDE.md §5.5), MMS attachments and Can Text.
  - So extract a `useConversation(phone)` hook and a `Composer` from it. Both the old thread and the
    new timeline render those, and there stays exactly one copy of each guard.
  - **Everything else on the timeline comes from `/comms/item`** — the archived texts, calls,
    voicemails and photos, and the resolutions (§4.9). Not from RingCentral's lists.
  - **The live thread is laid over it for the newest texts.** The two are merged by RingCentral's
    message id, and **the live copy wins a collision**: an archived text can still say *Queued* after
    RingCentral has turned it into *SendingFailed* (CLAUDE.md §5.5, §5.27).
  - **Playback is archive-first, RingCentral second** — the §5.47 `recordingSource` rule, applied to
    voicemails and photos too. Recordings, voicemails and photos come from `/calls/recording`,
    `/voicemail/audio` and `/mms/media`, and anything newer than the archive's last run comes from
    RingCentral when Play is pressed, never on open.
  - The archive's URL goes into a bare `<audio src>` or `<img src>` and is never `fetch()`ed. A
    browser `fetch` of the redirect needs CORS on the bucket, which Railway can't set (§5.47).
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
| Opening an item | one conversation read, for the live thread — the same as opening a thread today. Calls, voicemails and photos come from the archives, not RingCentral's lists. One too new for the archive is fetched from RingCentral when someone presses Play |
| The logs (Texts / Calls / VMs) | unchanged from today's tabs until phase 3; later they could be served from the archives |

### 4.8 PHI — what is new

**One new thing lands on the messaging pool: `note`** — what the rep wrote.
- That is the same category as `sms_archive.body` and `voicemail_archive.transcript`. Both were
  accepted explicitly (§5.27, §5.47b).
- The list's previews are read from those two columns. Nothing is copied.

**No new audio or photo storage.** Playback reuses the archives' own routes, so every presigned URL
issued for the timeline is audited like any other (§5.47).

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
- If `···1234` on unknown callers isn't acceptable, the alternative is to store the number
  encrypted — a new PHI category, so it is a decision, not a tidy-up (§9.3).

### 4.9 Where everything is saved — one place per number

Josh, 2026-09-23: *"where are we going to save this info? like the way his mockup works with
inlining the notes and including everything in once place for taht number"*.

The mockup keeps all of it in page memory, so a reload loses it. The live build keeps it in **one
database** — the gateway's messaging Postgres (`ASSIGNMENTS_DATABASE_URL`, service `cmd ctr server`),
which already holds the four archives — plus the **`call-recordings` bucket** beside it for audio and
photos. Every table is keyed by the **number's hash**, so "everything for this number" is one
indexed lookup per table.

| On the timeline | Saved in | Audio or photo | Played from |
|---|---|---|---|
| Texts, both directions, with their delivery verdicts | `sms_archive`, plus `sent_messages` for who pressed Send | — | — |
| Photos sent with a text | listed in `sms_archive`, fetched by `mms_archive` | bucket, `mms/` | `/mms/media` |
| Calls, both directions: answered, missed, and the leg that connected | `call_archive`, plus `comms_dials` for who pressed Call | bucket, `recordings/` | `/calls/recording` |
| Voicemails patients leave us, with transcripts | `voicemail_archive` | bucket, `voicemails/` | `/voicemail/audio` |
| *Left voicemail* — the rep's attempt | `comms_resolutions` (`left_vm`) | the recording of the call it links to | `/calls/recording` |
| Resolutions and their inline notes | `comms_resolutions` | — | — |
| "This number is that patient" | `comms_links` | — | — |

**How it becomes one place.**
- `/comms/item` takes the item's numbers — the patient's primary and alternate, grouped as §4.4
  describes — reads every table above by their hashes, and returns **one list in time order**.
- When the patient has two numbers, each row says which one it came in on.
- The browser lays the live thread over it for the newest texts (§4.6), so a text sent a second ago,
  and its late delivery verdict, appear without waiting for the archive.
- **Faxes are not on it.** A fax is an office's, not a patient's, and keeps its own rail.

**The note is saved twice** (§9.1 D5):
- in `comms_resolutions`, always, the moment the rep resolves — this is the copy the inbox,
  the timeline and the report read;
- in the patient's Monday notes, when the rep moves on — this is the copy for whoever opens the
  patient's stage page tomorrow.

**Kept forever.** None of the four archives prunes (§5.27, §5.47, §5.47b, §5.47c), and neither do
the new tables (§9.3).

**How far back it reaches.** Each archive holds only what RingCentral still had the day it started:
- texts from 2026-08-01;
- calls and recordings from about late June 2026 (90 days before 2026-09-21);
- voicemails and photos from about late August 2026 (30 days before 2026-09-23).

Anything older had already been deleted by RingCentral, and nothing can bring it back.

**Why not keep it on Monday instead?**
- An unknown number has no Monday item to write to.
- A patient is a different item on every board. A resolution stored on their Welcome Call item
  would drop out of view the day they reach Subscription; a phone number survives the hop.
- Two reps resolving the same item is an ordinary afternoon, and Monday has no compare-and-set. So
  it couldn't answer the second rep with *"Katie resolved this at 2:10"* (§4.4's 409).
- The header badge is on every page for every rep. Counting on Monday every minute is the kind of
  load that drained the account's budget in §5.25; counting in Postgres costs nothing.
- The texts, calls and voicemails are in Postgres already. Keeping the resolutions beside them is
  what makes the timeline one query, instead of seven boards plus three RingCentral lists.

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

**5.2 Notes are copied to Monday (decided — §9.1 D5).** A note that says what was discussed is case
history, and the person working that patient tomorrow reads the stage's notes, not the inbox. So:
- Copy every **non-empty** note on a **matched** patient who has a **live** record.
- Write it into that record's notes column — the active board, the same record Recent notes writes
  to.
- Use the one existing writer, `dossierApi.appendNoteToRecord`. It re-reads the column before
  appending, and asks the live board about the 2,000-character cap.
- Stamp it with the stage label **Communications**:
  `[Sep 23, 2026, 2:10 PM] Communications: Called — told her it ships Friday —JH`.
- A `No action needed` with no note writes **nothing** to Monday, and a *Left voicemail* never has a
  note, so it never writes either.
- A patient with no live record (every record completed) gets the log only. A completed item is
  read-only in new code (§5.38).

**5.3 Order and failure.**
- Resolve first (Postgres), copy to Monday second — when the rep moves on (§5.4).
- A failed copy never un-resolves anything. The rep is shown *"Resolved — couldn't copy your note on
  \<patient\> to Monday: …"*, naming the patient because by then they are on the next item. The row
  records `mirror_error`.
- The copy runs **in the browser**, as the signed-in rep, and **only the resolver's** browser runs
  it. `appendNoteToRecord` stamps the signed-in person's initials, so a copy made from somebody
  else's browser would sign the note with the wrong name. It also keeps the audit attribution every
  other note path has. It then reports `mirrored_to` back to the log.

**5.4 When the copy happens (decided — §9.1 D5: when the rep moves on).**
- Monday notes are append-only, and Monday has no compare-and-set, so a copied line can't be taken
  back. That is why the copy waits.
- **It runs when the row stops being sticky** — the moment the rep opens another item or leaves the
  Inbox, which is also when Undo stops being offered.
  - An Undo before then leaves nothing on Monday. That matters most for the wrong-patient case: a
    note resolved against the wrong item, caught while it is still sticky, never reaches that
    patient's record.
  - **The server refuses an Undo once the note is copied,** so the two can never disagree: a
    Communications line on Monday always means a resolution that stands.
- **If the tab closes first,** the log row stays uncopied (`mirrored_to` null, no `mirror_error`),
  and that rep's browser copies it the next time Communications opens. The note is never lost; it
  is only late.
  - A copy made more than 15 minutes after the resolve says when the resolve happened —
    `… Communications: Called (Sep 23, 2:10 PM) — told her it ships Friday —KT` — because the
    stamp's own time is when the line was written.
- **Two open tabs can't copy it twice.** The browser claims the note (`POST /comms/mirror`, a
  compare-and-set on `mirror_claimed_at`) before it writes to Monday.
  - A claim that never reports back is released after 10 minutes. That can, rarely, repeat a line on
    Monday; a repeated line is a smaller harm than a missing one, and `commsNoteLine()` guarantees a
    repeat can't be read as anything but a note (§5.5).
- **The health route counts the notes still waiting** (§4.5), so notes from a rep who never came
  back to Communications show up there instead of sitting unnoticed.

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
  counter, and neither does a *Left voicemail*. A patient reaching out and us calling back is not an
  outreach attempt, and the mockup never writes one (§9.3).

**5.9 Rules the server enforces too.**
- `called` without a note → 400.
- Notes are trimmed and made single-line.
- The log caps a note at a sane length (say 2,000 characters), so a paste can't bloat it.
- Monday's side is fine: the six live notes columns have been uncapped `text` since 2026-09-03.

**5.10 On the patient screen,** the compact bar carries the same *Called* note input, so resolving
from a profile follows the same rules.

---

## 6. Unmatched number → a patient (decided — §9.1 D1)

The mockup writes the number onto the patient after a pick: *Add as alternate phone*, which
**replaces** any existing alternate, or *Use as primary phone instead*, which replaces the primary.
Josh approved both on 2026-09-23 (*"fine"*). This is how it gets built.

**The flow** (phase 2).
1. The rep searches with `DossierSearch` — the same live search as the header's — and picks a
   patient. The
   pane shows their profile under the *"Found by search"* banner. **Nothing is written yet.**
2. The prompt, as drawn: *"Add (xxx) xxx-xxxx to \<patient\>?"* — `[Add as alternate phone]`
   *(replaces (xxx) xxx-xxxx)* · `Use as primary phone instead` · `Pick someone else`.
3. The Monday write goes first. Once it succeeds, `POST /comms/link` records *this number is that
   patient*, so the number's texts and calls move to them in the inbox at once — the link also
   covers the day until the patient directory's next refresh picks the new number up (§5.29).
   - If the Monday write fails, the error is shown and nothing else happens; the rep retries.

**Through the existing writers only — never a hand-rolled mutation.**
- *Use as primary* **is** the patient screen's phone pencil (§5.46g): `contactEdit.phoneRefusal`
  first, then `contactEdit.contactWrites` builds the values and `dossierApi.updatePatientContact`
  sends them. That path:
  - writes the **live record** only (the anchor); the next board hop carries the new number forward;
  - **clears Can Text**, because that answer was about the old line (§5.31d);
  - refuses a completed record, and refuses a number it can't parse **before** writing.
- *Add as alternate* reuses the same send — `updatePatientContact` takes values already in the
  board's own shape — with a sibling rule in `contactEdit` that builds the **Alternate Phone** value
  from `contacts.CONTACT_COL`. So there is still one mutation for both numbers. It writes that column
  on the live record and nothing else. That is exactly what the Welcome Call page does when a rep
  changes that slot's number: `phoneSlots.setSlotNumber` keeps the slot's Patient/Caregiver answer,
  and the alternate slot has no Can Text of its own.
  - It never touches **Caregiver Name** or **Caregiver Authorized**. Those are consent records and
    stay the Welcome Call page's; if its rules need a fresh answer, that page's own send gate asks
    the rep there (`phoneSlotGaps`).
  - It runs the same refusal before the write (`phoneRefusal`), since `planPhoneWrite` skips a
    number it can't parse and would otherwise report success having written nothing.
- The *(replaces …)* the button carries is read from the live record, so the rep sees what goes.
- **Gated on Edit profile** (`editProfile`), like the pencil — on the button and in the handler
  (§5.39h). Without it, the rep can still link the number in the inbox (step 3 alone).

**Where there is no alternate column** — a stated default, §9.3. Alternate Phone exists only on
**Welcome Call** (`phone_mm7265hp`) and **Subscription** (`phone_mm72r19q`). For a patient whose live
record is on Profile Send Off, Medical Evaluation or Insurance, the alternate button reads **Link to
\<name\>**: the history moves to them in the inbox and nothing is written to Monday. The Welcome
Call rep collects the alternate number on the call, as today. *Use as primary* works on every board.

**Consequences worth knowing** — none needs an answer.
- A **replaced** number's past texts and calls leave this patient's timeline once the directory
  refreshes, because it deletes a number a record has moved off (§5.29). The mockup behaves the
  same way. Resolutions are per number, so nothing is lost — that history shows under the old number.
- The browser's name cache (`useDirectoryNames`) remembers misses for the whole session, so a link
  must drop that number's miss, or the list keeps saying "Unknown" until a reload.

## 7. The right pane (decided — §9.1 D3)

`DIFF_2026-09-22.md` §14 already notes that the mockup's pane is the **patient screen**, not our
`PatientDossierPanel`. Josh decided on 2026-09-23 to swap it, carrying the shared-number switcher
and the dossier pane's other jobs (§9.1 D3).

**What swapping them takes.** Split `PatientPage` into a route shell and a body component.
- The shell keeps `useParams` / `useSearchParams`.
- The body takes its view state (`view`, `step`, `snap`, `tool`, `sub`) as props, or reads a
  namespaced set of params.
- It is the same move §5.39c2 found the stage pages had already made.

**What must come with it — all five jobs the dossier pane does and the patient screen does not.**
The draft proposed dropping the fifth; that is reversed.
1. **The household switcher** (*N patients share this number*, §5.28). The composer's attribution and
   the note writer follow the selection, so without it a note or a text can land on the wrong person.
2. **A writable notes box** — the Comms Hub's composer, through `appendNoteToRecord`. The embedded
   main column has no Recent notes: those live in `.pt-side`, and the hub replaces that column with
   the thread.
3. **Every stage's notes** — the collapsed trail (`stageNoteTrail`).
4. **Find-a-patient** (`DossierSearch`) when the number is on no board, with its *"Found by search"*
   banner. It is now the first half of §6's flow.
5. **The per-stage call detail** (`stageDetail.ts`), including Welcome Call's wide one.

Plus the pane's *Open profile page* button, which the mockup draws too.

**What it costs.** One or two more Monday reads per item opened — the stage panel's full-width
record, and the subscription view. They are on open and never polled, so it's allowed, but the pane
is heavier than today's.

**When.** Phase 4. Phases 2–3 keep today's `PatientDossierPanel`, which already does all five.

---

## 8. Build order

Each phase lands on its own, and nothing is removed before phase 3.

**Phase 0 — done.** Every question is answered (§9.1).

**Phase 1 — the gateway, in shadow mode, with no UI (M).**
- Build all of §4.2–§4.5 and §4.9, behind `COMMS_INBOX_ENABLED`.
- Run it for a few business days and *measure before anyone sees it*:
  - items opened per day, by kind;
  - how many are unmatched;
  - how many are replies to automated texts;
  - how many are doctor offices, vendors or spam.
- **One test call** from the line to a staff phone that sends it to voicemail. Does RingCentral log
  the call as connected, and is there a recording? That settles whether *Called* lights up after a
  message was left, and whether *Left voicemail*'s Listen has a recording to play (§4.4).
- Compare its open set against what the hub's lists show.
- Wire up the health route and `calls-monitor`.
- **Tests:**
  - the rules: open · reopen · the cover race · 409 · suggestion · grouping · household · undo · left
    VM (it never closes, and its call link finds the nearest call or nothing);
  - the weekend clock: a Friday-evening arrival, a weekend arrival, and both daylight-saving weekends;
  - the Monday-copy outbox: two tabs claiming one note, a stale claim, and Undo refused once copied;
  - the missed-call parity test, and the call-to-voicemail join's;
  - the no-plaintext-number source scan.

**Phase 2 — the Inbox (L).**
- Add an **Inbox rail as the hub's default**. Phone, Text and Fax stay untouched.
- Build:
  - the list;
  - the item timeline, reusing the thread and read from the archives, with Play on calls, voicemails
    and photos (§4.6, §4.9);
  - the resolve bar with its inline notes and the *Left voicemail* button (§4.4);
  - the Monday copy when the rep moves on (§5.2–§5.4);
  - unmatched → find → add the number to the patient, or link it (§6);
  - the header badge.
- **Prerequisite:** anchor `isResetLine` (§5.5).
- Render-check at 1100 / 1440 / dark, with a **long** real list (CLAUDE.md §7's lesson).

**Phase 3 — spread it (M).**
- The patient screen's compact resolve bar.
- Reshape the logs:
  - Calls and VMs become their own rails;
  - Texts becomes a log with Received / Sent;
  - every log row opens the item.
- Unread is retired: Texts becomes All / Received / Sent and the voicemail list drops Unheard
  (§9.1 D4).
- Dial attribution.

**Phase 4 — the rest (L).**
- The right pane becomes the embedded patient screen, carrying §7's five jobs.
- **The SLA card as drawn** (§9.1 D8), once the log has a few weeks in it. Reports & Metrics shows it
  in place of *"No reports available yet"*.
  - *Left voicemail* appears on it as attempts, beside the resolution counts and in the per-rep
    table — never counted as a resolution.
  - The rest of what the handoff specifies for that page — Katie's tracker embedded and the pipeline
    numbers (§5.46b) — stays unbuilt. The card doesn't change that.

**Phase 5 — optional.**
- The SLA card's footnote views — by week, by stage, and a trend line — from the same log (§9.3).
- Capture through `message-sync` or a webhook instead of polling.
- The manager sidebar contact marks switch to "unresolved". Today they show "who spoke last", so the
  two screens will disagree by design until then.
- A count on the dashboard's Communications bar. ⚠️ That is a CLAUDE.md §5.8 counting-contract change, and
  both baseline generators would need to reach the gateway.

## 9. Decisions and questions

### 9.1 Decided — Josh, 2026-09-23

| # | The item | His answer | What it means for the build |
|---|---|---|---|
| D1 | Writing phone numbers onto patient records: *Add as alternate* replaces the existing alternate, *Use as primary* clears Can Text | *"fine"* | Built as the mockup draws it, in phase 2, through the existing writers (§6). *Use as primary* replaces the patient's current primary number, as the mockup does. |
| D2 | `Mine \| All patients` | *"dont integrate that"* | Not built. Everyone works one list — which is also the §5.13 / §5.30 *no ownership* rule. |
| D3 | Swapping the right pane for the patient screen | *"incldue the switcher for shared numbers and the other four jobs"* | Swapped in phase 4, carrying all five jobs (§7). The draft had proposed dropping the per-stage call detail; it stays. |
| D4 | Retiring Unread | *"that makes sense"* | Below. |
| D5 | Should a resolve note also go into the patient's Monday notes? | *"1A"* — yes, when the rep moves on | The note is saved to the log the moment the rep resolves, and copied into the patient's notes on the board they're on now when the rep opens their next item. An Undo before then leaves nothing on Monday; a closed tab is caught up the next time that rep opens Communications (§5.2–§5.4). |
| D6 | A callback goes to voicemail — what does the rep press? | *"2A — and voicemail should be in the timeline to listen to since we record them"* | A fourth button, *Left voicemail*: it logs the attempt, keeps the item open with its clock running, and counts as an attempt in the report. Voicemails play in the timeline from our archive (§4.4, §4.9). |
| D7 | Do weekends count toward the 24 hours? | *"3B"* | Saturday and Sunday, Eastern, don't count. A Friday 6 PM text reads *Waiting 15h* at 9 AM Monday and turns red at 6 PM Monday. One clock for the screen, the red flag and the report; holidays count like weekdays (§4.4). |
| D8 | Should Reports & Metrics show the communications report? | *"4A"* | The *Communications SLA · 24 hours* card, as drawn and per-rep table included, in place of *"No reports available yet"*. Anyone with the Reports tab sees it. Phase 4 (§8). |

**D4, precisely** — my reading of *"Retiring Unread"*; say so if the voicemail half should stay.
- **Goes:**
  - the *Unread* filter on the Texts list, which becomes the mockup's *All / Received / Sent*;
  - the *Unheard* filter on voicemails — the mockup's VMs log has no filter.
  - The Inbox's *Unresolved* list replaces both as the "needs attention" view.
- **The header badge** counts unresolved items, never unread ones.
- **Stays:**
  - **Fax's** Unread view. v2 doesn't change Fax, and faxes never open items.
  - Opening a message still marks it read in RingCentral, and the right-click read/unread stays.
    Reps also work this line in the RingCentral desktop app, which shows that flag (§5.28).

**D6, precisely** — my reading of *"voicemail should be in the timeline to listen to since we record
them"*; say so if only one half was meant. Both kinds play:
- **A voicemail a patient leaves us** plays from `voicemail_archive`, with its transcript — so it is
  still there after RingCentral deletes its own copy at about 30 days.
- **The message the rep left** is inside the recording of their call, because calls are recorded in
  both directions. The *Left voicemail* row plays that call's recording (§4.4).
  - ⚠️ That assumes a call answered by the patient's voicemail box gets recorded like any connected
    call. It is reasoned, not measured; phase 1's test call settles it (§8).

### 9.2 Open — none

The four follow-ups were answered on 2026-09-23 as *1A 2A 3B 4A* (D5–D8 above). What each option
meant is in the previous version of this file (commit `ffbb589`).

Two things are still to be **measured**, not decided. Both are in phase 1 (§8):
- whether a callback that reached voicemail is logged as connected, and recorded (§4.4);
- how many items a day are doctor offices, vendors, or replies to automated texts (§9.3).

### 9.3 Defaults — no answer needed

Each follows the mockup or a rule the app already has. Say so to change one.
- **Phone numbers are never stored in plain text** — HMAC + last4, like every table on the messaging
  database (§4.3, §4.8). An unknown caller shows as *Unknown caller ···1234* in the list; the full
  number appears once the item is opened.
- **No alternate column → "Link to \<name\>"** for patients on Profile Send Off, Medical Evaluation
  or Insurance (§6).
- **Permissions.** Anyone who can open Communications (`comms`) can resolve. Adding a number to a
  patient's record also needs *Edit profile*, like the phone pencil (§6).
- **Undo** is shown while the row is sticky, as drawn. The server takes it only from the resolver,
  within 15 minutes, and not once the note has been copied to Monday (§5.4). Nothing can be deleted.
- **The resolve log is kept forever**, like the recordings (§5.47). It is the report's history.
- **The stage pill uses the patient screen's names:** *Medical Necessity*, not the mockup's
  *Medical Evaluation*.
- **Called and Left voicemail don't count as a Welcome Call or Intake call attempt.** The mockup
  never writes one.
- **The SLA card's footnote** asks the live build for views *"by week, by stage (the pill), and by
  rep, with a trend line"*. The per-rep view is the table the card draws, and it ships with the card.
  The by-week, by-stage and trend views come in phase 5, from the same log: they need weeks of
  history before they show anything.
- **Doctor offices, vendors and replies to automated texts open items like anyone else.** That is
  the mockup's rule, and its own sample opens an item on a *"Got it, thank you!"* sent back to a
  reorder text. Phase 1 counts all three before anyone sees the list; revisit then.
- **Only a callback that connected suggests *Called*** (§4.4).

## 10. Guards and keep-in-agreement

Write these into CLAUDE.md when the feature ships.

- The missed-call verdict in `commsInboxRules` ⇄ `src/lib/callHistory/callHistory.ts` (the parity
  test).
- The call-to-voicemail join in `commsInboxRules` ⇄ `src/lib/commsHub/callVoicemail.ts` (a parity
  test too).
- `countedWaitMs` has **one** copy, on the gateway. The browser only shows the wait it is given, so
  the screen, the red flag and the report can't drift apart (§4.4).
- The *Left voicemail* → call link is worked out when the timeline is read, never stored, and fails
  closed (§4.4).
- Only the resolver's browser copies a note to Monday, after claiming it, and the server refuses an
  Undo once it is copied (§5.4).
- Playback goes through the archives' own routes — `/calls/recording`, `/voicemail/audio`,
  `/mms/media` — never a new bucket read, so every presigned URL stays audited (§5.47).
- The own-number exclusion list ⇄ `sms_archive`'s.
- The hot tick writes each archive **only through that archive's own upsert** — one writer per
  table, so its invariants hold (§5.47's `none` → `pending` rule, among others).
- `ItemTimeline` and `ConversationThread` share `useConversation` / `Composer`. **Never a second
  copy** of the opt-out, delivery or Can Text guards.
- Every Monday write of a note goes through `appendNoteToRecord`.
- Adding a number to a patient goes through `contactEdit`'s rules and the one existing mutation,
  `dossierApi.updatePatientContact`, with the refusal checked **before** the write — never a
  hand-rolled mutation, and never a write to Caregiver Name or Caregiver Authorized (§6).
- The swapped right pane carries all five of §7's jobs. A source-scan test names them, so none can
  quietly drop in a later tidy-up.
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
  - Not queued: the task tool timed out when I tried. Worth fixing on its own.
