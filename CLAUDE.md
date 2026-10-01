# CLAUDE.md — Command Center architecture & orientation

Internal "Command Center" (a.k.a. *Samantha Checklist*) for **Medically Modern**, a
diabetes-supplies / DME provider. This is a **React + TypeScript SPA** whose backend
of record is **Monday.com**. It is one frontend in a larger backend constellation
(see [Backend ecosystem](docs/claude/8-deployment.md)); this repo is *only* the SPA
plus two small support services (a Cloudflare worker and a couple of Railway helpers).

> **Read this first, then the three reference docs:**
> [`BOARD_SCHEMA.md`](BOARD_SCHEMA.md) (Welcome Call board columns),
> [`monday-integration-spec.md`](monday-integration-spec.md) (Samantha board + Send Request),
> [`WRITE_RELIABILITY_AUDIT.md`](WRITE_RELIABILITY_AUDIT.md) (every UI→Monday write path, ranked by risk).

## How this file is organised — read this before adding to it

This file is loaded into **every** session, so it holds only what applies everywhere. Until 2026-09-25 it also held every feature's notes and had reached about 1.13 million characters, which used up a large share of each session's context before any work began. **Those notes now live in `docs/claude/`, moved word for word, one file per section, named by the same section number:** §5.31d is `docs/claude/5.31d-phone-slots-and-caregiver.md`, §7 is `docs/claude/7-manager-views.md`. A code comment that cites "CLAUDE.md §5.30" means `docs/claude/5.30-*.md`; glob for the number.

- **Before you change code in an area, read that area's sections** (the index is under §5). They hold the decisions, the measurements taken on the live boards, and the ⚠️ notes about what not to do. Most of those notes exist because a bug shipped once.
- **Debugging a reported problem?** Grep `docs/claude/11-where-to-look-first.md` first. It maps about 240 symptoms to the section that explains them.
- **New knowledge goes in `docs/claude/`.** A new section is a new file named `<number>-<slug>.md`, plus one line in the §5 index. Add to this file only a rule that applies everywhere, in a line or two.
- **Never `@`-import a `docs/claude` file here.** An import is loaded into every session, which would undo the split. Write paths inside backticks.
- §1, §2, §4 and §12 are kept here in full. §3 and §6–§11 are summarised here, with the full text in `docs/claude/`.

---

## 1. Mental model in one paragraph

Each operational **role** (Evaluate, Benefits, Welcome Call, …) is a stage in a patient's
journey. A role = one **page** + a **sidebar** of patients + **panels** that read/write
**Monday.com columns**. The SPA does not own a database — Monday boards *are* the
database. The app **reads** by polling Monday GraphQL and **writes** on nearly every user
action. **Patients move between stages via Monday automations**, not the app: the app
flips a "Stage Advancer" status column, and a board automation marks the item complete
and moves it to the next group/board. The app's job is to gather/validate the data for a
stage and then flip that advancer **last**, after confirming the data landed.

---

## 2. Tech stack & commands

- **Vite 5** + **React 18** + **TypeScript**, SWC plugin. Router: `react-router-dom` v6.
- UI: **shadcn/ui** (Radix primitives in `src/components/ui/*`, mostly stock) + **Tailwind**.
- Data fetching: hand-rolled `gql()` per role module + `@tanstack/react-query` (lightly used).
- PDF: `pdf-lib` + `pdfjs-dist`. Forms: `react-hook-form` + `zod`. Tests: **vitest** + Testing Library.

```bash
npm run dev        # vite dev server
npm run build      # production build (base path set by CI, see §8)
npm run lint       # eslint
npm test           # vitest run   (unit tests: evalState round-trips, accessStore, roleView, auth)
```

There is **no CLAUDE-managed backend in this repo** beyond `worker/` and `services/`. `services/supabase-mirror` copies monday boards into Supabase, read-only and switched off unless `MIRROR_ENABLED=1` (§5.55); `supabase/` holds its migrations and PHI-free board snapshots.
The Python backends the SPA mirrors (financial estimate, DVS automations) live on Railway.

---

## 3. The boards (source of truth)

| Board | ID | Roles / purpose |
|---|---|---|
| **DTC Intake** | `18392794310` | Top of funnel. Read-only here. |
| **Profile Send Off** | `18406352652` | Four roles: `profile` (Referral Intake), `unverifiedReferrals` (Info Collection), `intakeCleanup` (Profile Clean-Up), `inSystemReferrals` (Already In System). Splits and exits: §5.10, §5.20, §5.48. |
| **Medical Evaluation** ("Masheke") | `18406060017` | `evaluate`, `sendRequest`, `confirmReceipt`, `chaseFax`, `chaseParachute`, `doctorAppointments`. |
| **Insurance** ("Samantha") | `18410601299` | `benefits`, `submitAuth`, `authOutstanding`, `authDenied`, `dvs`. DVS is defined by the **stage**, not the group. |
| **Welcome Call** | `18410804557` | `welcomeCall` + `finalConfirm` (see `BOARD_SCHEMA.md`). Propose Stuck ladder: §5.34. |
| **Subscription Board - Updated** | `18407459988` | `subscription`, and one source for Patient Questions. |
| **Secondary Claims Board** | `18413019028` | Second source for Patient Questions. |
| **MM Doctor Database** | `18142847597` | NPI → doctor record + Doctor Notes (`shared/doctorDb.ts`). |
| **New Order Board** | `18405457690` | `orders` (§5.35): one item per order, read-only except the backorder-substitution pick. The group lags the API Status, so read the status first. |
| **Cardinal SKU Tracker** | `18420366344` | Every SKU we order at Cardinal: price, quantity available, status. Scraped daily at 9:05 ET. |

Each board's groups, exits and gotchas: `docs/claude/3-boards.md`.

**Column IDs are the contract.** Every `lib/<role>/mondayMapping.ts` maps domain fields to
Monday column IDs (`color_…`, `text_…`, `date_…`, `dropdown_…`). If a column is renamed on
Monday the *title* changes but the *ID* doesn't, so reads keep working — but if a column is
**deleted/recreated**, the ID changes and reads silently return empty. There is no schema
validation; these IDs are institutional knowledge captured in the mapping files + the two
schema docs.

---

## 4. Repo layout — the per-role convention

Everything is sliced by role. For a role `X` you'll typically find a parallel set:

```
src/lib/X/        mondayApi.ts      gql() calls + board ID + column read/write primitives
                  mondayMapping.ts  Monday columns  <->  domain Patient model
                  mondayWrite.ts    the "Send to Monday" transaction (uses verifiedWrite)
                  workflow.ts       Patient type + validation + derived state for role X
src/components/X/  panels, cards, sidebar, modals for role X
src/hooks/X/       useMondayPatients.ts (poll + local overlay), etc.
src/pages/         XPage.tsx        wires hook + components together
```

Shared, cross-role code lives in `src/lib/shared/*`, `src/components/shared/*`,
`src/components/ui/*` (shadcn), and root hooks `src/hooks/use*.ts`.

`src/lib/config.ts` is the **role registry** (`ROLES[]`: id, label, color, icon, route).
`fax` and `authDenied` are **count-only** roles with an empty `route` (intentional). They are
NOT equivalent in the UI, though: **`fax` IS clickable** in both burndowns and opens
**`/fax-inbox`**, special-cased by role id in `DailyBurndown`'s `openBar` and `OperationsTab`'s
`isFax` (2026-08-20). Keep it a special case rather than filling in `route` — that field is also
how `DailyBurndown` builds the filter-aware role link and how `ReportIssueButton` maps a pathname
back to a role, so populating it changes two behaviours to fix one. **`authDenied` stays
unclickable** everywhere: its stage is deliberately unbuilt (§7). `systemMgmt` is deliberately
**not** in `ROLES` (reached via the Oversight button, not role assignment).

---

## 5. Core mechanisms, and an index of every §5 section

Five mechanisms the rest of the app depends on. The full text of each is in its file.

- **5.1 Where GraphQL goes** (`lib/shared/mondayEndpoint.ts`). With `VITE_MONDAY_GATEWAY_URL` set, which is how production runs, every `gql()` goes through the gateway, which adds the Monday token and records the call. Without it, calls go straight to api.monday.com with the bundled token. Gate Monday features on `hasMondayAuth()` (gateway configured, or a bundled token), never on the bundled token alone: a production build without the token is supported and planned (§10), and a token-only check fails silently there (§5.28).
- **5.2 Verified write** (`lib/shared/verifiedWrite.ts`, the most important utility). Monday answers 200 before a value is indexed, so an automation triggered by a status change can read stale values in the other columns. `executeWritesWithVerification` therefore snapshots, writes the data columns, polls until they read back, and only then writes the stage advancer. If verification times out, it throws and does not advance. On the gateway fast path the whole transaction goes to the durable `POST /send`, which sends each task's **declared** `value`, so that value must equal what the task's `fn` writes. With `requireDone`, a `GatewayPendingError` means the job is queued and will run: tell the rep not to repeat it, and never retry.
- **5.3 Access** (`lib/accessStore.ts`, `lib/roleView.ts`). Stored in `public/data/access.json`, read and written through the worker's `/gh-state`, polled every 10s. Managers see everything; processors see their assigned role bars. While `managers[]` is empty, everyone is a manager. Abilities and home views: §5.39c, §5.39g-h, §5.39j.
- **5.4 Auth** (`components/AuthGate.tsx`). Google sign-in, limited to medicallymodern.com, and active only when `VITE_GOOGLE_CLIENT_ID` is set. The stored identity is the session. The ID token is never refreshed and nothing blocks on its freshness.
- **5.8 Counting contract.** Live role counts come from `src/hooks/useRoleCounts.ts`. The start-of-day baseline comes from `scripts/snapshot-baseline.mjs` (at build time) and `services/baseline-cron/index.mjs` (9 AM ET cron). The two generators are plain Node and cannot import the hook, so they must mirror it by hand, as must each role's sidebar. If they drift, the Operations tab shows phantom +in/−out chips all day. Change all of them together; scan tests pin the `.mjs` copies.

**Index.** Every section is `docs/claude/<number>-*.md`. **5.39g-h** is one file, cited as either §5.39g or §5.39h.

- **Plumbing and shared:** 5.1 GraphQL endpoint · 5.2 verified write · 5.3 access · 5.4 auth · 5.5 files, email, fax, SMS delivery, PDF viewer · 5.8 burndown and counting contract · 5.18 Profile Status badge · 5.38 the completed item *is* the stage snapshot (don't build a history store) · 5.40 dark mode and tokens · 5.54 the reload nudge (open tabs learn a newer build is live) · 5.56 Expedited (a manager's intake tick; the hops carry it; arrivals due today, not tomorrow)
- **Medical Evaluation:** 5.6 Evaluate state machine · 5.6b OOW marker, next-day arrivals · 5.9 Chase split (Fax vs Email/Parachute/Dashboard) · 5.9b Send Request: sending isn't advancing · 5.9c Chase fax drawer · 5.9d provider edits (Save provider; a corrected fax reaching the send) · 5.12 Doctor Appointments · 5.46 Diagnosis is a dropdown (all five boards)
- **Intake / Profile Send Off:** 5.10 Verified · Unverified · Already In System split · 5.11 Run Stedi Check (inline in `ProfilePage.tsx`) · 5.19 benefits-check address · 5.19b doctor fax required · 5.19c provider prefill · 5.20 Info Collection vs Profile Clean-Up · 5.20b In Network verdict and Intake Warnings · 5.21 DTC duplicate check · 5.23 intake form's insurance step · 5.24 partial forms are workable · 5.25 two-tier list/detail read
- **Insurance:** 5.32a Auth Outstanding arrivals due next day · 5.32c Humana same-or-similar despite auth · 5.32d phone edit on Auth Outstanding · 5.32e an entered Last Bill Date is never erased · 5.33 insurance pickers read the board's labels · 5.58 who to call on Benefits (the address decides: NJ/FL Blue → CareCentrix), the POS 11 banner, BCBS FL's own CareCentrix modifiers
- **Welcome Call and Final Confirm:** 5.7 OOP estimator · 5.14 Monitor Purchase Date · 5.17 Cardinal address format · 5.22 serving ↔ order lines · 5.22b Monitor Qty is 0 or 1 · 5.26 ops layer · 5.31 order rules (caps, 75 days, monitor sale) · 5.31b screen · 5.31c insurance/auth block, Order Frequency · 5.31d phone slots and caregiver · 5.31e call-scheduled chip · 5.31f Katie's first-week fixes · 5.31g benefits answer never left intake · 5.31h email editable · 5.31i date bucket and attempt logger · 5.32 Last Bill Date (one column family) · 5.32b C30 · 5.32f C18 and paid DVS claims · 5.32g C31 infusion-set cap (Aetna = Aetna Commercial from 2026-10-01) · 5.34 Propose Stuck ladder · 5.37 canonical payer policy
- **Care Coordinator:** 5.15 scheduled calls and Calendly booking · 5.30 the dashboard (and the two-screens table) · 5.30b welcome calls on the grid · 5.30c day strip reads Calendly · 5.30d page audit · 5.30e, 5.30f, 5.30g, 5.30i Brandon's notes · 5.30h carrier dropdown · 5.30j Masani's 2026-09-25 notes (warnings panel, Active pill, sticky header, shared advance claims, the SOP, log-attempt reach on every call path) · 5.30k Brandon's 2026-09-29 notes (suggestion colour, shipment contents from Line Item Detail, the pane divider, AM/PM attempts, the in-system sentence, WC panel docks left, card rotate, growing text box, unmatched bookings) · 5.30l Calendly bookings link to a chart by phone too (and the Calendly setup it needs)
- **Phones, texts and archives:** 5.13 inbound calls · 5.13b answering in the browser (Route B; Route A plan) · 5.13c each person's own RingCentral line (Connect RingCentral) · 5.16 call history and recordings · 5.27 SMS archive · 5.28 Communications Hub and contact marks · 5.29 patient name directory · 5.47 call-recording archive · 5.47b voicemail archive · 5.47c MMS archive · 5.47d who picked up (the answering extension, saved and shown) · 5.47e call transcripts (Google Speech-to-Text on the archived recordings; chirp_3 in `us` is the only diarizing combination) · 5.49 Communications Inbox · 5.50 the Communications button · 5.51b call counts · 5.53 the 2026-09-25 comms audit (stuck dial/hang-up, voicemail vs missed, inverted missed calls, provision metronome)
- **Orders, Subscription and payments:** 5.35 Orders and the SKU tracker · 5.36 MR status · 5.39i Inventory · 5.48 Cash Pay
- **Off monday:** 5.55 the Supabase mirror — Profile Send Off's 164 columns and 35 automations inventoried, mirrored read-only into `monday_mirror` (live on Railway since 2026-09-29, new patients only), the monday-look board page `/supabase-board` (§5.55 1b), and the flip plan
- **Redesign: shell, search, access:** 5.39b shell and layout switch · 5.39c abilities, home views, fax bar · 5.39d the layout one-way door · 5.39e the roster · 5.39f UI rewrite, not a function rewrite · 5.39g-h my view, borrowing a view, abilities · 5.39j Access page edits vs the poll · 5.41 Reports and Stage Manager pages · 5.42 search returns one row per patient · 5.44 search failures and the settings menu · 5.46h search hides a patient's own orders; Orders page load · 5.52 pixel-match phases 3–7
- **Redesign: the patient screen:** 5.39 patient screen · 5.39c2 per-stage panels · 5.39c3 recent notes · 5.39c4 fax bar right pane · 5.43 dossier escalation column · 5.45 Subscription view · 5.45b editable Subscription profile · 5.46b the 2026-09-22 pass · 5.46c reorder form · 5.46d expected items · 5.46e contacts · 5.46f info strip · 5.46g top-bar email and pencils · 5.51 pixel-match phase 1 · 5.51c pixel-match phase 2 · 5.57 Remove from Stuck (managers only, beside the Stuck chip; back to where Monday's activity log says; Welcome Call clears the advancer rather than re-texting) · 5.59 profile order rules (payer caps on the quantities, max Frequency per payer, Cardinal stock flag on a new set) and the Comms list | thread divider

---

## 6. Patient flow across boards (the big picture)

```
DTC Intake (18392794310)
   │  "Send To Medical Necessity"
   ▼
Profile Send Off (18406352652)  ──profile role: complete demographics/insurance/doctor
   │  "Advance to MN" → automation 7917676280 creates the Medical Evaluation item
   ▼
Medical Evaluation (18406060017)──evaluate → sendRequest → confirmReceipt → chase (fax | email+parachute)
   ▼
Insurance (18410601299)         ──benefits → submitAuth → authOutstanding (→ authDenied)
   ▼
Welcome Call (18410804557)      ──welcomeCall → finalConfirm roles
   │  Final Confirm's advancer fires the create-item hop to Subscription (§5.14)
   ▼
Subscription (18407459988) / Claims boards  ──recurring orders, reconciliation
```

Patients move between boards through **Monday automations**, not the app: the SPA flips the stage advancer after verifying its writes (§5.2). The tracker order is `lib/commsHub/pipelineOrder.ts`. More detail: `docs/claude/6-patient-flow.md`.

---

## 7. Cross-cutting / manager views

- **Pipeline Oversight** (`components/oversight/OversightTab.tsx`, `lib/oversight/oversightApi.ts`) shows per-stage charts. Most stages have three columns: Processor Overview, Manager Intervention and Final Decisions. **Every escalated patient must land in exactly one column's chart.** An escalation takes a patient out of the rep's queue and out of the role count, so a state that matches no chart is invisible everywhere in the app. `insuranceCoverage.test.ts` and `columnExclusivity.test.ts` guard this. Oversight reads must go through the gateway (`MONDAY_API_URL` / `mondayIdentityHeaders`), never a hardcoded api.monday.com.
- **System Management** (`/system-mgmt`). Search asks Monday live on every query and reads every group of every board. Never add a group filter: every group added to a board later would silently become unsearchable. The seven-board snapshot only feeds the chart and the totals.
- Also here: Patient Questions, Fax Inbox, and Access admin (`/access`).

Full text: `docs/claude/7-manager-views.md`.

---

## 8. Deployment reality

- **Frontend:** GitHub Pages via `deploy.yml`. The Vite base path decides which repo the app reads and writes its data files in (the test build uses `command-center-test`, prod uses `command-center`), computed in `lib/shared/dataRepo.ts` and never hardcoded.
- **Gateway** (`services/monday-gateway`): Railway service `cmd ctr server` with Postgres `cmd ctr db`. `/send` requires a verified medicallymodern.com Google token. Every request is recorded, without request bodies, so no PHI is stored. **Worker** (`worker/`): deployed by `deploy-worker.yml`.
- **This repo is the source of truth; prod (`command-center`) is a mirror.** Prod is only reached by *Sync from Test Repo*, which force-pushes test's `main` onto prod. **Only Josh runs it** (§9). Only committed code travels. GitHub Actions secrets, including every `VITE_*` build secret, must be copied into the prod repo by hand, or prod builds with them blank. Cloudflare worker secrets and Railway variables live on the shared services and a sync never touches them. The sync keeps prod's own `access.json`. It overwrites `baseline.json` and `fax-state.json`, which repair themselves.
- Test and prod share one gateway, one worker, the Railway backends and the Monday boards.

Full text, including the other Railway services: `docs/claude/8-deployment.md`.

---

## 9. Conventions and gotchas: the rules that apply everywhere

Full text, with the incidents behind each rule: `docs/claude/9-conventions-and-gotchas.md`.

**Git and release**
- **Push to `main`** (Josh's standing instruction). Commit, `git fetch`, rebase onto `origin/main` (baseline-cron commits land on their own), then push. No feature branches or PRs unless he asks.
- 🚫 **Never run the *Sync from Test Repo* workflow. Only Josh presses it**, every time, however it would be triggered (Actions tab, `gh workflow run`, an MCP call). It force-pushes test's `main` over prod, and running it again does not undo it. Finish on test, say the change is ready for prod, and stop. If he asks you to run it, that covers that one run only.

**Writing to Monday**
- **Verify before you advance.** Any write a Monday automation reacts to goes through `executeWritesWithVerification`, with the trigger column as `stageColumnId` (§5.2).
- **Automations fire when a status *changes*, not on its value.** Writing the value a column already holds returns 200, records no activity-log entry and fires nothing. Give advancer tasks an `expectedText` (`lib/shared/advancerNoop.ts`) so such a send is refused instead of silently doing nothing. A re-send must clear the column first. Diagnose from the gateway's `/audit.json`, never the board's activity log, which can't show these writes at all. Never "repair" a stuck patient by clearing the advancer: the next press creates a duplicate downstream item.
- **Status label ids belong to each column, and Monday picks them** (the lowest free slot, or an id derived from the label's colour). They don't follow display order and differ between boards. Read `settings_str` back after creating a label; never infer an id. A write to an id the column doesn't have is dropped at HTTP 200 with no error. This has come up on seven columns so far (§5.12, 5.20, 5.31c, 5.31d, 5.33, 5.36, 5.48).
- **HTTP 200 doesn't mean it worked.** A wrong-shaped value comes back 200 with a GraphQL `errors[]` and writes nothing. For example, `location` needs `lat`/`lng`; `long_text` takes `{"text": …}` and `text` takes a bare string, while `change_multiple_column_values` with a bare string works for both. Bulk jobs belong in the slice's `write*` helpers, must read `errors[]`, and must stop on one (§10).
- **Status columns hold at most 39 labels** (ids end at 160). Past that, `create_labels_if_missing` drops the write silently. Put open-ended vocabularies in a dropdown (§5.46).
- **Long-text columns silently cut values at 2,000 characters.** Guard writes with `components/shared/longTextGuard` / `lib/shared/longText`. The notes columns became uncapped `text` columns on 2026-09-03, with new ids (§10).
- **Notes are stamped** `[ET timestamp] <Stage>: <text> —<initials>` through `lib/shared/noteStamp.ts` (`appendStampedNote`). New panels pass `notePrefix`; writers outside a panel pass `initials`. Monday has no compare-and-set, so re-read a notes column right before appending to it.
- **Before changing what the app writes to a column, read every board automation that has a condition on it** (`list_automations`, and resolve its variables). Some check `is empty`, and a coerced 0 silences them (§5.22b). Older automations can't be edited through the API; a person edits them in Monday's UI.
- **Structural board changes** (columns, labels, automations) are an off-hours job, tried on a sandbox board first (Josh).

**Reading Monday data**
- **Column IDs, not titles, are the contract** (§3). A column that is deleted and recreated gets a new id, and reads then come back empty with no error.
- **Use exact label strings when writing by label, casing included**, or Monday creates a duplicate label. Prefer writing by index.
- **A blank means unknown, not "no"** (Can Text, the network answer, secondary insurance, Request Type, stock quantities). Don't let missing data read as No, and don't default to selling something because the data is missing. The few deliberate exceptions, such as Monitor Qty being written as 0 (§5.22b), are documented in their sections.
- **Monday dates are Eastern and have no time zone.** Compare them in ET using their date parts, never through `new Date()` in a UTC runtime. Calendly's `start_time` and an item's `created_at` are exceptions: those are real instants.
- **ISO date text doesn't survive create-item automations** (`2022-01-01` comes out as `01 January 2022`). Dates cross boards in DATE columns.
- **A file column's `text` is a `protected_static` URL that redirects to a login page.** Get the asset's signed `public_url` at click time; it expires after an hour (§5.30f).
- **"Change it in all N places" lists are real.** When a section lists several places that apply one rule (role page, `useRoleCounts`, Oversight `CHART_FILTERS`, both baseline generators, …), change every one. The failure is silent: a patient counted in the wrong bar, or in none. Many of these lists are pinned by source-scan tests.

**RingCentral, polling and the gateway**
- **The whole company shares ONE RingCentral extension** (§5.13b). On 2026-08-20 one runaway browser tab took down texting, the fax count and the call log for test and prod (`INCIDENT_2026-08-20_RINGCENTRAL.md`). Per-patient RingCentral reads happen **when the patient is opened, never on render or on a timer**, with a module-level cache and one request in flight per key. A hook whose return value can end up in a dependency array must return a memoized, stable value; fix the hook, not the caller (the incident's rule 2). Don't fire off unawaited requests from an effect (rule 3). Background jobs use `rcLimiter`'s `background` tier.
- **Railway's HTTP log returns at most 500 lines per query, about 13 minutes of gateway traffic.** For anything older, use the gateway's own Postgres records: `/audit.json?key=…` (Monday GraphQL calls), `/audit/requests.json?key=…` (all other requests), `/calls/history` (calls).

**PHI**
- **Patient data is on every board.** Don't write it to logs, artifacts or commits. The gateway records metadata only (`LOG_PAYLOAD=false`) and strips query strings. Tables that hold PHI (the SMS, call, voicemail and MMS archives, the name directory, the Communications inbox) live on the messaging database (`ASSIGNMENTS_DATABASE_URL`), never the audit database, and store phone numbers as an HMAC plus the last four digits, never in full.

**UI and React**
- **Name the screen, not the data.** The Welcome Call stage page (`/welcome-call`) and the Care Coordinator dashboard (`/care-coordinator`) both show Welcome Call columns, and a change to a component they share (`masheke/mmKit`'s `PatientContact`) lands on both. Limit a change to the screen that asked for it (see the table at the top of §5.30).
- **Inside `.pf-root` and `.bnr`, a shadcn `<Button>` renders unstyled**, because those pages' reset rules outrank Tailwind's single-class utilities. Use the page's own button classes (`.btn` under `.pf-root`, `.tbtn` under `.bnr`) or `skin="page"`.
- **Anything that belongs to one patient is keyed by that patient.** Notes boxes and editors take `key={patient.id}`. A send is refused while a typed note hasn't been added (`refusePendingNote`). Reset calls the hook's `discardEdits` and never writes blanks. A deep-linked patient goes through the same edit overlay as the queue. A successful advance hides the patient through `lib/shared/pendingAdvance.ts`, a temporary claim that expires and is never cleared just because the patient is missing from a poll.
- **A failed read must show on screen:** `components/shared/StaleDataNotice` sits on every queue page. Paging is for failed writes; failed reads page only past both a count and a rate threshold (`sendAlerts.sweepAlertReason`).
- **New lazy routes use `lazyWithReload`** (`lib/shared/chunkReload.ts`), never a bare `lazy`: each deploy replaces the code chunks that open tabs still point at. Back navigation uses history first (`hooks/useBackNavigation.ts`). Toasts sit top-centre, because both other corners covered a button.
- **Use colour tokens, and define a new token in both `:root` and `.dark`** (`src/index.css`). A token missing from `.dark` stays light in dark mode (§5.40). Redesign restyles are opt-in props passed by a single caller, so the "as today" layout stays unchanged byte for byte (§5.39b, §5.52).
- **Moving or removing UI: check what it was the way into.** A page whose only entry point you remove is gone from the product even though its route still works. `components/shell/lossless.test.ts` lists those entry points (§5.39f). The redesign changes the UI, never what the app can do.
- **Render UI changes in a browser before shipping** (§5.30d's rule), at more than one width (the docs use 1100 and 1440) and in dark mode. Layout bugs often only appear with a long, realistically sized list (§7, §5.30c).

**Tests and CI**
- **The typecheck gate is `npx tsc -b --force`. Never use `tsc --noEmit`,** which checks zero files with this repo's solution-style tsconfig. Some safety rules are enforced only by the type system through required props and arguments (§10).
- **Code that nothing calls doesn't fail; its passing tests just make it look finished.** When a rule has to be wired in, add a test that scans for the call site (the `listColumns.test.ts` / `*Wiring.test.ts` convention) (§5.31b).
- Many of the rules in these docs are pinned by named tests. If one fails after your change, read the section it points to before you "fix" the test.

---

## 10. Known risks and open items

Full list, with what was measured: `docs/claude/10-known-risks.md`.

- **One secret still ships in the bundle:** `VITE_MONDAY_API_TOKEN`, the fallback for direct mode, unused when the gateway URL is set. The RingCentral credentials and the GitHub PAT are already out of the bundle; don't rotate a RingCentral credential as "exposed".
- **Write order in some inline panel actions** (Send Request, Confirm Receipt, Chase) can flip a trigger before the other columns are indexed (`WRITE_RELIABILITY_AUDIT.md` H1–H5, M2).
- A "never billed" attestation can't be undone from the UI. Final Confirm's split order races a Monday automation (M6).
- Some writers of columns that are still `long_text` have no 2,000-character guard (the list is in §10). Subscription's Escalate button saves nothing. A completed patient can still be re-advanced from Patient Intake, because `UnverifiedReferralsPage` has no review-mode gate.
- `strictNullChecks` is off (`tsconfig.app.json`).

---

## 11. Where to look first

| Task | Start here |
|---|---|
| A role's page behaves wrong | `src/pages/<Role>Page.tsx` → `hooks/<role>/useMondayPatients.ts` → `lib/<role>/workflow.ts` |
| A value isn't saving to Monday | `lib/<role>/mondayWrite.ts` + `lib/shared/verifiedWrite.ts`; check the column IDs in `mondayMapping.ts`; then the gateway's `/audit.json` |
| A write "disappeared" | gateway `/audit` (Postgres `gql_log` / `send_jobs`) |
| "What was the gateway doing at …?" | `GET /audit/requests.json?key=…` (Postgres `request_log`), not Railway's logs |
| A rep saw stale or blank data | `components/shared/StaleDataNotice` + `lib/shared/mondayError.ts`; gateway `/audit/errors.json` |
| Who can see what | `lib/accessStore.ts`, `lib/roleView.ts`, `components/AccessProvider.tsx` |
| Files won't load / PDF viewer | `lib/shared/mondayAssets.ts`, `components/shared/FileViewerModal.tsx`, `worker/src/index.js` |
| Manager pipeline / oversight charts | `components/oversight/OversightTab.tsx` + `lib/oversight/oversightApi.ts` |
| **Anything more specific** | grep `docs/claude/11-where-to-look-first.md` (about 240 rows) |

---

## 12. Pushing changes from the Claude (Cowork) environment

The default GitHub integration is **blocked** here, but a plain `git push` over HTTPS gets
through if you sidestep it **two ways at once**:

1. **Put the PAT in the remote URL** —
   `https://<PAT>@github.com/medically-modern/command-center-test.git`. This stops the local
   `insteadOf` rule from rewriting the remote to the `claude@anthropic` proxy (the rewrite is
   what blocks the normal integration).
2. **Use the `github.com` git transport, not the REST API.** The egress proxy **allows**
   `github.com` git push/fetch but **blocks** the `api.github.com` REST path — so anything
   going through the GitHub REST API (the normal integration) fails.

Before pushing, **`git fetch` and rebase your commit onto live `main`.** `main` advances on
its own from automated **baseline-cron** commits; rebasing makes your change a clean
fast-forward and **preserves** those commits instead of clobbering them.

The PAT is a secret and is **deliberately not written in this repo** (see §10 — no secrets in
the bundle/repo). **Ask Josh for the key** before pushing.
