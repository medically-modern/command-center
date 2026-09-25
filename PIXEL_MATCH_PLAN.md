# Brandon's pixel-match — plan (Sep 2026)

> Josh, 2026-09-24, forwarding Brandon's instructions: *"at this point hes so anal about it matching
> his exact mockup we just need to add the information he specified exactly the way he detailed it
> … obviously none of the roles need to be changed, just the command center wrapper he outlinied"*
> — then: *"read it and make a plan . note that his claude doesnt know shit. approve all ui asks,
> 0 backend changes allowed."*

**Status: Phase 1 BUILT on the test site (2026-09-24) — see "Phase 1 — as built" under §5; the
other phases are not started.** CLAUDE.md §5.51 is the durable record. Brandon's instructions, with
the patient in them redacted:
[`_reference/brandon-redesign/PIXEL_MATCH_INSTRUCTIONS_2026-09-24.txt`](_reference/brandon-redesign/PIXEL_MATCH_INSTRUCTIONS_2026-09-24.txt).
Every board fact below was read from the live Subscription board on 2026-09-24 (column names, types
and labels only, no patient rows).

---

## 0. In one screen

- **Every UI ask is approved. Nothing on the backend changes.** §1 says exactly where that line is.
- **One thing is missing:** the sample-data mockup we hold is from 9/18. It has none of the
  Communications screens he names (§2.1). Screens A, C, E, F, G and H can start now. D (Communications)
  and the coordinator half of B wait for his current file.
- **His biggest ask is fully specified and can start now:** the patient screen's Subscription ›
  Profile and the right column, the 16 differences he listed (Phase 1).
- **Some of his steps would break the app or leak PHI if followed as written** (§2). The plan keeps
  his goal and replaces those steps.
- **Process:** one phase at a time on the test site (this repo's `main`), stopping after each so you
  can look. Nothing reaches the live site until you press Sync.

---

## 1. "Zero backend" — where the line is

| Never touched | In scope |
|---|---|
| The gateway (`services/monday-gateway`), the Cloudflare worker, every Railway service | Components, pages and CSS in `src/` |
| Monday boards, columns, labels, automations, webhooks | Reading columns that already exist |
| Env vars, secrets, config files, package versions | Writing columns that already exist, through the writers the app already has |

**Four of Brandon's own asks need the app to write Subscription-board columns it doesn't write today.**
Every one of these columns already exists on the board:

- **Frequency** → Order Frequency `color_mm48kv1c`.
- **CGM qty / Cartridges qty** → `numeric_mm3sr332` / `numeric_mm3sfe56`.
- **The editable Contacts** → Primary Contact `color_mm72vm7p`, Alternate Contact `color_mm723hfk`,
  Caregiver Name `text_mm72mdzk`, Caregiver Authorized `boolean_mm72nt75`, Alternate Phone
  `phone_mm72r19q`.
- **Visit date + MN docs in the one Save** → through the same writers Update Clinicals uses.

His Safety Rule 2 forbids exactly this (write builders, column maps). Under his rule those four ship as
controls that do nothing. I read your rule as "no backend", and this isn't backend — §4.1 asks you to
confirm.

---

## 2. Where his handoff is wrong

1. **The mockup file.** Our copy (`_reference/brandon-redesign/command-center-mockup.html`) dates from
   the 9/18 handoff. None of the screen-D functions he names are in it — `ibList`, `ibLogList`,
   `ibDetail`, `ibResolveBar`, `ibFindPane`, `ibOfficePane` — and neither are "Called patient" rows,
   "Add as an office phone", "Their patients with us" or the SLA card. We need **his current
   sample-data file** and the **v2 .docx**. Not the REAL-DATA file.
2. **"Copy the REAL-DATA mockup into the repo under /design."** No. It holds 3,168 real patients, and
   this repo force-pushes to prod (CLAUDE.md §8, §9). It stays on his machine. Reference material lives
   in `_reference/brandon-redesign/` (your call, 9/18), not `/design`.
3. **His verification can't run as written.**
   - It needs a signed-in session to the live app, and every live screenshot is PHI. He wants those
     committed.
   - *"Abort every non-GET request"* blocks every Monday **read**. Monday's API is GraphQL and reads
     are POSTs, so the app would render empty screens and every comparison would be of blanks.
   - Replacement: §6. His sample mockup beside the app running on fake data copied from his sample
     patients. Same data on both sides, nothing can write, no PHI.
4. **"Financials figures — no backend yet."** Wrong. The Subscription board has 12 financial columns
   (Sensors / Supplies revenue, cost and GP; Total revenue, cost and GP; Shipping; ARR; ARP). The app
   already reads all 12, and `/subscription` already shows them. Only *Lifetime revenue* has no column,
   so it shows "—".
   - His card hardcodes a "Supplies" block. For a sensors-only patient that shows blanks while their
     Sensors figures sit on the board. We draw his markup once per line the patient is served, the
     same rule `/subscription`'s card uses.
5. **"Inbox resolutions and required call notes — no backend yet."** Wrong. Both are built and live
   on the gateway since 9/23 (CLAUDE.md §5.49). *Called* already refuses to save without a note.
6. **"Last eligibility check" and "OOP remaining".** Both exist on the Subscription board: Last
   Eligibility Check `date_mm43n083` and OOP Max Remaining `text_mm3gs345`. We just don't read them
   yet. *Active status* and *Deductible left* are already read.
7. **The mockup's dropdown options are made up.**

   | Field | Mockup offers | The board has |
   |---|---|---|
   | Subscription | … Pump, Pump & Sensors | Supplies · Sensors · Sensors & Supplies — no Pump |
   | Supplies type | Omnipod 5, "t:slim X2" | Mobi · t:slim · iLet · Minimed 780G · Not Serving |
   | Sensors type | 7 options | 10 — adds Guardian 4, Libre 14-Day, Instinct |
   | Frequency | 30 / 60 / 90 | 30 / 60 / 75 / 90 — and 75 is Aetna-only (CLAUDE.md §5.31) |
   | Infusion set 1 / 2 | 8 / 3 | about 25 each |

   Monday drops a write to a label a column doesn't have, with no error (CLAUDE.md §5.12 and five
   more). So every select uses the board's own labels.
8. **His coordinator view is older than his own notes.** It is the 9/18 "My Patients". Since then he
   has sent about 60 notes that shaped today's Care Coordinator page: the Calendly day strip, the
   filters, the pill grid, Review Profile, the carrier dropdown, the call and text counters
   (CLAUDE.md §5.30c–h). Porting the 9/18 view would undo them. Phase 7 waits for his current file.
9. **Oversight charts.** His histograms bucket by days only. Our Insurance manager columns bucket by
   *reason* on purpose (Katie and you, 7/29). We take his look and keep the reason bars.
10. **Mockup scaffolding is not ported.** The "Stand-in" notice (we render the real tool, read-only —
    §5.39c2), "Mockup shows inbound texts only", "No texts in this snapshot", "Syncing with Monday…",
    and the dark mock toolbar.
11. **Branch, PR, "never push to main".** Your standing rule: push to this repo's `main`, which
    deploys the test site only. The live site changes only when you press Sync. I stop after each
    phase so the diff can be reviewed, which is the point of his rule.
12. **"Patient coordinator assignment" and "Only my patients".** No backend. They also go against a
    standing decision: no owner per patient (CLAUDE.md §5.13, §5.30). Built as disabled UI and listed
    in §7.
13. **"Add as an office phone".** There's no column to store a second number for a doctor's office.
    Built as disabled UI and listed in §7.
14. **His rule 4, "every field that saves today must still save", clashes with his layout.** The layout
    drops three things the patient screen edits today:
    - Ordering Cycle: still editable on `/subscription`.
    - Order Type (he marks it "not editable"): still editable on `/subscription`.
    - The Email pencil: editable nowhere else for a subscribed patient (§4.2).

---

## 3. Already approved by "approve all UI asks" — and what each reverses

No action needed. Listed so nothing surprises anybody.

- **Save moves to the top** (Reset + blue Save), with his amber *"Unsaved changes"* bar that sticks
  to the top once you edit. This reverses your 9/23 *"send to monday button at the bottom"*. Save
  stays on screen after any edit, so the reason for the bottom bar still holds.
- **Recent notes in the right column become read-only** (composer removed). This reverses 9/21.
  Notes are still added on the Subscription notes card (subscribed patients), on the stage pages and
  in the Communications profile pane.
- **Reports & Metrics becomes his full page:** Katie's tracker link, the pipeline tiles, the
  subscription and order tiles, *Queues today* bars and the SLA card. This reverses your 9/22 blank
  page. Every number comes from data the app already reads. The queue bars ARE `useRoleCounts`, so
  they can't disagree with the burndown (CLAUDE.md §5.8).
- **"Medical Evaluation" replaces "Medical Necessity" across the wrapper**: stepper, info strip,
  inbox stage pill, search chips. This reverses your 9/03 Search label and the 9/23 inbox-pill
  default. The stage pages keep their own names.
- **The settings menu becomes his:** Calls, Texts, Appearance, Sign out. The six colour themes aren't
  in it, so they go.
- **The right column loses its name block, bell and dark Call button.** Calling still works (Phase 1).
- **Order Type and Ordering Cycle stop being editable on the patient screen.** Both are still editable
  on `/subscription`.

---

## 4. Needs a word from you

1. **The §1 line**: write the existing columns the app doesn't write today (Frequency, the two
   quantities, Contacts, visit date + MN docs in the Save). *Default: yes.*
2. **Email.** The pencil he removes is the only place in the app to change a subscribed patient's
   email. Welcome Call and Intake cover onboarding patients. *Default: remove it, as he asks.*
3. **Address, insurance and doctor on the profile.** His 9/18 cards draw them as plain text. You made
   them editable here on 9/23, and his own rule 4 says what saves today keeps saving. *Default: keep
   them editable, in his `.input.sm` controls, which already look like his grey Address box.*

---

## 5. The phases

Each phase ends with the unit tests, the typecheck (`npx tsc -b --force`), the side-by-side compare
(§6) and a push to test `main`. Then I stop for you.

### Phase 0 — prep, no visible change *(small)*
- Put his current sample mockup and the v2 .docx in `_reference/brandon-redesign/`, replacing the old
  ones as its README says.
- Build the compare harness (§6) and the fake data: his sample patients, copied into the fake gateway.
- Write `_reference/brandon-redesign/DATA_MAP.md`: for each screen, component → hook → column, for
  every read and every write. His rule 4, checked against the code rather than taken on trust.

### Phase 1 — Subscription › Profile and the right column, his 16 *(large)*
**Layout**
- **(1)** No Back row. It is hidden in the redesign layout only. In the old layout it is the only
  way off the patient screen (CLAUDE.md §5.39d), so it stays there.
- **(2)** Top bar: the phone shown as (xxx) xxx-xxxx. The Subscription chip shows Subscription Status
  (Active · Paused · Not Active, `color_mm2t7tdy`), not the group name. No Email pencil (§4.2).
- **(3)** The Profile | Orders row gets Reset + blue Save on the right, or *"Read-only for <name>"*
  without Edit profile.
  - The pinned bottom Send bar goes.
  - His amber dirty bar shows after the first edit and sticks to the top of the scroll area, with
    Discard and Save to Monday.
  - The checks the Send button runs today still run and still say what's wrong. They show in that bar
    and on a refused Save.
- **(4)** Overview strip:
  - Status with the green dot.
  - Subscription reads "Sensors · First Order · 90-Days" (adds the Order Frequency read).
  - First order is the earliest order, else the Subscription item's creation date (already on the
    record).
- **(5), (6)** One *Order details* card, two columns, board labels (§2.7):
  - Next order date | Subscription
  - Frequency | Reorder form status chip (read-only)
  - Sensors type | CGM qty
  - Supplies type (pump) | Cartridges qty
  - Infusion set 1 | Inf. qty 1
  - Infusion set 2 | Inf. qty 2
  - The grid: overview → Demographics | Insurance | Medical Necessity & Auth (his `1fr 1fr 1.35fr`)
    → Order details | Doctor info | Financials → Subscription notes, full width.
- **(7)** Demographics:
  - Gender | Email; Address; Referral source | Can text.
  - A divider, then editable Contacts: Primary contact and Alternate contact (Patient / Caregiver),
    Caregiver name, Caregiver authorized, Alternate phone, and Last patient contact (read-only). Plus
    his hint line.
  - The separate Contacts card and the "Can text: not answered" line go.
  - The Contacts writes follow the §5.31d rules. The label ids were read live today, and they match
    Welcome Call: Patient 7 · Caregiver 4 · Yes 1 · No 2. A blank is not a No. A phone number Monday
    can't parse is refused before the write, not dropped silently.
- **(8)** Insurance, lower half: Last eligibility check | Active status; Deductible left | OOP
  remaining. The Stedi eligibility / Insurance change? / Primary claim paid? block goes.
- **(9)** Medical Necessity & Auth:
  - MR status + expiry | Files, with View and Download. Files come from the file's signed link,
    never the column's own text, which only works signed in to Monday (CLAUDE.md §5.30f).
  - Diagnosis | Sensors auth + end date.
  - Supplies auth | Infusion set auth ID.
  - Cartridge auth ID.
  - Upload MN Docs drop zone | Visit date, with its help text.
  - The "Authorisation & MN" card and its footnote go.
  - **The visit date saves through `saveVisitDateVerified`**, which writes MN Expiry and the MR
    status together (CLAUDE.md §5.36). It does not go through `/subscription`'s own visit-date path,
    which writes MN Expiry alone — a known gap. Files go through the existing `uploadFileToColumn`.
- **(10)** Doctor info moves to the bottom row, middle, still editable.
- **(11)** Financials card, from the 12 columns (§2.4).
- **(12)** Subscription notes card: composer, Add note, newest first. It uses the existing notes
  writer, which re-reads the column before appending.
- **(13)** The "Subscription Board · Subscriptions · …" footnote goes.
- **(15)** His `.eyebrow` labels and `.input.sm` controls, ported exactly under the patient screen's
  own stylesheet scope, so nothing else in the app changes.

**The one Save, in order:**
1. The Subscription save, including the new fields. One verified write, as today.
2. The visit date, which is its own verified write because the MR status fires a webhook.
3. The files.

If a step fails, the message says which one, and whatever didn't save stays on screen.

**Right column (14)**
- The header is only *Texts N | Calls N*.
- Then the phone line, formatted. With an alternate number: Text alt / Call alt.
- The thread loses its name block, bell and dark Call button. The Communications hub keeps its header.
- The composer: one line, "Write a text…", blue "Send text", with the same opt-out, delivery and Can
  Text guards (the shared composer).
- The resolve row sits under the text box.
- **The Calls tab becomes his inline list**:
  - All / Missed / Voicemail filters.
  - Rows: Patient called · We called · who · Missed call · Voicemail + new.
  - Listen (our scrubbable player), the transcript, Call back (dials here), Mark heard.
  - The data comes from the Communications inbox's own Postgres copy while the inbox is on. So there's
    no RingCentral read per patient (the 2026-08-20 incident).
  - With the inbox off, it comes from the RingCentral call log, fetched when the tab is opened. The
    *Calls N* count then appears after it's opened.
  - This replaces today's Communications button in that tab. The pop-up stays on every stage page's
    header.
- **Recent notes** are read-only: the last three, with an *All notes* link.
  - For a subscribed patient, *All notes* goes to the Subscription notes card. His link goes to the
    Onboarding view, which shows a different board's notes than the three it summarises.
- **Calling:** his column has no Call button. The blue number in the top bar and the number on the
  phone line both dial in the app, with no change to how they look. Plus his Call back and Call alt.

#### Phase 1 — as built (2026-09-24)
Josh's answers changed four things from the plan above, and the build follows his answers:
- *"leave communcaitons alone"* — Phase 4 is skipped, and item (14) is **look only**: the tabs, the
  number line, the bare thread and the one-line composer are built; **the Calls tab keeps the
  Communications button** (no inline list), and **the resolve bar stays at the top** of the column
  where the Inbox plan put it.
- *"Save moves from the bottom … The right column's notes lose their add box … — leave these"* —
  **the Send stays in the bar pinned to the bottom**, and **Recent notes keep their composer**.
  The §3 bullets for both are withdrawn.
- *"1. YES"* · *"2. leave it"* · *"3. keep them editable"* — the eight columns are written (as a
  delta); **the Email pencil stays**; address, insurance and doctor stay editable for an editor.
- *"its so so critical that we are just changing the visuals and not the backend or label options"*
  — every select offers the list the app already offered; nothing about the writers changed.

Found while building, and decided without asking — each is in CLAUDE.md §5.51:
- **Calling:** a small *Call* chip beside the primary number, rather than making the number itself
  dial (a clickable number dials on the click a rep uses to select it — §5.31f's copy complaint).
- ***Calls N*** has no number: counting calls would read RingCentral's call log for every patient
  opened. ***Texts N*** is the thread's own count once it loads.
- **The editable Contacts** are his three columns when they fit and two when they don't (three
  selects at 1440 cut "Patient" to "Patien").
- **Read-only** is native `disabled` on every control, so View and Download still work.
- **The eight new writes were checked against the board's automations and webhooks** first: none
  triggers anything; one webhook fires on every column change, as every existing save already does.

Not fixed, and reported: every Subscription send turns Fax / Parachute "Email" or "Dashboard" into
"Fax" (10 patients on 2026-09-24; **fixed separately the same day**, see CLAUDE.md §5.51); Lifetime
revenue has no column.

### Phase 2 — Subscription › Orders and the Onboarding view *(medium)*
- **Orders:**
  - The selected order on top: the latest by default, with *Back to latest*.
  - His order card:
    - Items with quantities.
    - Shipments from the five tracking numbers and Cardinal's status.
    - Partially shipped / delivered.
    - The backordered-set swap. It is the existing Substitution card, reused rather than copied. It
      writes and emails Cardinal, and needs Adjust orders.
  - The history table: click a row to show it above.
  - Per-line shipment status from Cardinal doesn't exist (§7). We show what the board holds.
- **Onboarding:**
  - The second stage reads "Medical Evaluation".
  - His snapshot header over our real read-only tool:
    - Sub-step tabs.
    - A green *"Snapshot · as it looked when … was left"* or blue *"Live — the patient is here now"*
      chip.
    - A grey *Read-only* chip.
    - *Open <tool>*.

#### Phase 2 — as built (2026-09-24)
Built as planned above, with the visuals-only rule applied throughout: every fact on the order card
is the orders slice's own rule, and nothing about any writer changed. Details in CLAUDE.md §5.51c.

Found while building, and decided without asking — each is in CLAUDE.md §5.51c:
- **"Medical Evaluation" is on the patient screen only** — the stepper and the info strip. The
  Communications Inbox pill still says "Medical Necessity" (*"leave communcaitons alone"*), and so do
  System Management's search rows, because their label is shared with the Communications
  find-a-patient pane. §3's "across the wrapper … inbox stage pill, search chips" is therefore
  narrowed to the stepper and the strip.
- **Shipments are tracking numbers, not his per-item boxes.** His `shipmentsOf` guesses which items
  went in which box; the board holds no such data (§7). Items go inside a box only when there is one
  box and nothing still to come.
- **Pre-tracking orders** (shipped before Cardinal records began) get a grey "Shipped · no tracking"
  pill, no box and no tracker, and aren't counted as open. His mockup calls these "Ordered via DDP";
  we don't know that of ours, so the card doesn't say it.
- **The swap sentence** ("can be swapped below") appears only where the swap really is: an open
  order, for somebody with Adjust orders.
- **Kept, not in his mockup:** *Open on Orders* on the selected order (the old rows' door to placing,
  the cash-pay card and the full details), and the record picker on the Onboarding view (his sample
  has one record per stage; ours can have several).
- **One chip his two don't cover:** a live record opened on a step the patient already passed reads
  "Live record · today's values" — it is neither a snapshot nor where the patient is.
- **His stage sub-line** ("as it looked when the patient left it") is only true of a completed
  record, so on a live one it says the tool shows today's values.
- **His `.pill.lightgreen`** is never styled in his file; it is drawn light green.
- **Fixed on the way:** Tailwind's own `outline` utility matched his `.btn.outline` and drew a 3px
  black ring on every outline button on the patient screen, two of them since they shipped.

Not built: nothing from the Phase 2 list above.

### Phase 3 — the shell *(medium)*
- **Header:** his tabs, badge, Users and gear, measured against his CSS. The Stage Manager tab isn't
  in his header, and stays for the people you granted it (CLAUDE.md §5.41).
- **Search:**
  - Make his placeholder true rather than editing it: add member ID, doctor name and clinic, doctor
    phone and insurance to the live search. These are existing columns, still one request.
  - His results row, including the *hit* column that says which field matched (e.g. "Member ID
    ABC123").
  - His footer line.
- **Settings menu:**
  - Your line: who you are.
  - **Calls:** status, *Ring me*, *Which calls ring me* (All · Pinned numbers — *Only my patients*
    disabled, §2.12), the call banner toggle.
  - **Texts:** notify me.
  - **Appearance:** Light / Dark / System.
  - Sign out.
  - These map onto the ring preferences that already exist (CLAUDE.md §5.13).

#### Phase 3 — as built (2026-09-25)
- **The header search is WIDE** — Josh: *"wider header search - yes i want it"*. `useLiveSearch(…, { fields: true })`
  asks every board's member ids, doctor name, clinic, doctor phone and insurance in the same request
  (`lib/systemMgmt/mondayApi.ts` `searchFields`, one aliased query, no new read), and each row's right edge says
  which field matched (`lib/shell/searchHit.ts`, e.g. "Member ID ABC123"). His footer line under the rows.
  The placeholder promises exactly what the box does (§5.39f: a placeholder is a contract).
- **The settings menu in his look** (`GlobalHeader.tsx`, `shell.css`): who you are, a **Calls** group on the
  ring preferences that already exist (`components/shell/CallSettings.tsx` + `lib/shell/callStatusLine.ts` —
  status line, *Ring me*, *Which calls ring me*; *Only my patients* stays disabled, §2.12), **Appearance**
  (Light / Dark / System), Sign out. **No "Texts: notify me"** — Josh: *"dont build that yet"*.
- The Stage Manager tab stays for the people granted it (CLAUDE.md §5.41); his header has no such tab.
- Tests: `components/shell/{globalSearch,settingsMenu}.test.tsx`, `lib/shell/searchHit.test.ts`,
  `lib/systemMgmt/searchFields.test.ts`.

### Phase 4 — Communications *(medium to large; needs his current file)*
- A pixel pass on the rail, the list, the thread, the resolve row, the logs and the profile pane.
- For a caller on no board: match the number against doctors' office phones (patient boards and the
  Doctor Database) and show his office card with *"Their patients with us"*. *Add as an office phone*
  is disabled (§2.13).
- What we built beyond his mockup stays: the Stage filter you asked for on 9/23, *Link only*, the
  new-text panel. The rule since 9/18 is that nothing working gets lost (CLAUDE.md §5.39f).

### Phase 5 — Fax *(medium)*
- `/fax-inbox`, which the FAX bar opens, becomes his screen:
  - Faxes on the left, Update Clinicals on the right, 50/50.
  - Page previews, using the PDF viewer the app already has.
  - It is built from today's combined fax page (`/fax`), which already shares Update Clinicals.
- First, a check that the old `/fax-inbox` does nothing the new one can't. The old page stays
  reachable until you say.

#### Phase 5 — as built (2026-09-25)
- **`/fax-inbox` is his 50/50 screen** — faxes on the left, Update Clinicals on the right — built from the
  combined fax page (`FaxBarPage.tsx`, which already shares `ClinicalsWorkPane`), styled by
  `pages/fax/faxInbox.css` (`.cc-fx`), with the list rules in `lib/fax/faxInbox.ts`. Page previews use the
  PDF viewer the app already has.
- **The old page stays reachable** as `/fax-inbox/classic` (`FaxInboxClassicPage.tsx`) until Josh says
  otherwise — URL only, no menu entry.
- Not built, deliberately: *"Attach this fax as clinicals"* as a one-press action (the pane's own flow does
  it, with its stamps), preview icons per page, and marking a fax read on open (the read flag is
  RingCentral's, §5.28).
- Tests: `pages/faxInbox.test.tsx`.

### Phase 6 — Inventory, Reports, Users *(medium)*
- **Inventory:** a pixel pass. It was already ported from his screen (CLAUDE.md §5.39i).
- **Reports:** his full page (§3).
  - Katie's tracker: his text says the live build embeds it. We embed it if Monday allows its page to
    be framed, and link out to it, as the mockup does, if not.
  - The counts mirror the ones the dashboards already use.
- **Users:** his cards — custom view, abilities, the role grid. Same saves, same `access.json`.

#### Phase 6 — as built (2026-09-25)
- **Inventory** (`components/orders/SkuTrackerView.tsx`): a pixel pass against his `.invy` / `.cat` /
  `.fchip` / `.invt`. Kept beyond his mockup: the Orders | Inventory header and the **Open orders**
  column, both function (§5.39i).
- **Reports & Metrics** (`pages/OperationsPage.tsx` — the file name kept for the route and the lossless
  test; `pages/reports/reports.css` `.cc-rp`; rules in `lib/reports/reportsRules.ts`, reads in
  `lib/reports/reportsApi.ts` + `hooks/reports/useReportsData.ts`): his full page. Every number is a reading
  of a rule that already exists — `searchBucket`, `SystemPatient.escalated`, `infoStrip.daysSince`,
  `isFormLead`, `orderStage` / `orderFlags` / `isOpenStage`, `useRoleCounts` + `operationsGroups`.
  - **Katie's tracker LINKS OUT, never an iframe:** measured 2026-09-25 with curl on the exact URL host
    (`medicallymodern-force.monday.com` → 302 to sign-in; its `frame-ancestors` names only monday.com,
    Microsoft and partner hosts). The card says so.
  - Beyond his mockup, kept for function: a **Refresh** button, a fifth **Other** queues card, and the
    Communications SLA card (§5.49) under a "Communications" eyebrow while the Inbox is on.
  - DTC Intake is excluded from the four pipeline tiles (no page); Intake's "avg days in stage" reads the
    item's creation date because Profile Send Off has no stage-start column (`BoardDef.stageStartColId`,
    pinned to `INFO_COL` by test); the snapshot read gained `created_at` and that column.
- **Users** (`pages/AccessAdminPage.tsx` + `components/shell/AbilitiesEditor.tsx`, `pages/access/users.css`
  `.cc-us`): his cards — custom view, abilities (Answers calls / Manager / Admin on the same row), the role
  grid. The same thirteen writers into the same `access.json`. Kept: the **managers-only** gate (his is
  admins-only) and the two Add buttons (Add / Add as manager).
- Tests: `components/orders/*`, `lib/reports/reportsRules.test.ts`, `hooks/reports/useReportsData.test.tsx`,
  `pages/reports.test.tsx`, `pages/accessAdmin.test.tsx`; `lossless.test.ts` updated for the Reports page.

### Phase 7 — dashboards *(medium to large; the coordinator needs his current file)*
- **Stages view:** *"<name>'s stages"*.
- **The Stages | Oversight toggle, the Viewing dropdown and its banner:** these exist already and get
  his look.
- **Oversight:** his header and search across every stage, with the found patient pinned on top. The
  reason bars stay (§2.9).
- **Coordinator:** his look applied to today's page, until his current file says otherwise (§2.8).
  - The restyle happens only where it's shown as a home view.
  - `/care-coordinator` itself stays exactly as it is, per your "none of the roles need to be changed".

---

## 6. How we compare, without PHI and without writing anything

- **Both sides get the same fake data.** His sample mockup on one side. On the other, the app on the
  fake gateway, loaded with his sample patients (e.g. #/patient/101).
- **Two sizes:** 1440×900 and 1568×767. Each scrolling area is stepped through, and his "Viewing as"
  person is matched to the same access on our side.
- **Computed styles** are compared on the key elements: card padding and radius, the eyebrow font,
  input height, grid column widths, row heights.
- **Every difference goes into `_reference/brandon-redesign/DIFF.md`**, and gets fixed until only
  data values differ.
- **Nothing can write.** Requests are blocked by what they do, not by method:
  - any Monday request containing `mutation`,
  - RingCentral send and call routes,
  - the inbox's resolve / undo / note / mirror / link / dialed,
  - the worker's upload and send-message.

  Blocked requests are logged.
- **Screenshots aren't committed.** They are binary files, and this repo is copied to prod. They go
  on a private page for you and Brandon.

If Brandon wants a live-data side-by-side, he can run one on his own machine. His REAL-DATA file never
leaves it.

---

## 7. BACKEND_NEEDED — the starting list

Built as visible, disabled UI, and listed in `_reference/brandon-redesign/BACKEND_NEEDED.md`:

- **Extra office phone numbers for a doctor's office** — *Add as an office phone*.
- **Patient-coordinator ownership** — *Only my patients*, and "my patients" in the text alerts. It
  also goes against the standing no-ownership decision.
- **Per-line shipment status from Cardinal.**
- **Lifetime revenue.**
- **Anything else his current file turns up** (Phase 0).

---

## 8. What stays exactly as it is

- **Every stage page:** `/subscription`, `/welcome-call`, `/final-confirm`, the Insurance and Medical
  Evaluation pages, Intake, `/care-coordinator`. Where the wrapper shows one of them, it restyles
  around it, never inside it.
- **The old layout**, **the mock toolbar**, **Old pages**, **#/features**, and the stage tools under
  `/stage/:id` — his own out-of-scope list.
- **Every guard in CLAUDE.md** that a restyle could quietly drop:
  - the opt-out and delivery notes on texting,
  - the Can Text block,
  - the `editProfile` check on the button AND in the handler,
  - read-before-append on notes,
  - no RingCentral read on render,
  - `inert` on the embedded stage tools.
