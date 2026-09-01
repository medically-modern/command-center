# CLAUDE.md — Command Center architecture & orientation

Internal "Command Center" (a.k.a. *Samantha Checklist*) for **Medically Modern**, a
diabetes-supplies / DME provider. This is a **React + TypeScript SPA** whose backend
of record is **Monday.com**. It is one frontend in a larger backend constellation
(see [Backend ecosystem](#backend-ecosystem-railway)); this repo is *only* the SPA
plus two small support services (a Cloudflare worker and a couple of Railway helpers).

> **Read this first, then the three reference docs:**
> [`BOARD_SCHEMA.md`](BOARD_SCHEMA.md) (Welcome Call board columns),
> [`monday-integration-spec.md`](monday-integration-spec.md) (Samantha board + Send Request),
> [`WRITE_RELIABILITY_AUDIT.md`](WRITE_RELIABILITY_AUDIT.md) (every UI→Monday write path, ranked by risk).

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

There is **no CLAUDE-managed backend in this repo** beyond `worker/` and `services/`.
The Python backends the SPA mirrors (financial estimate, DVS automations) live on Railway.

---

## 3. The boards (source of truth)

| Board | ID | Roles / purpose |
|---|---|---|
| **DTC Intake** | `18392794310` | Top of funnel; "Send To Medical Necessity" group feeds the pipeline. Read-only here (oversight/system-mgmt). |
| **Profile Send Off** | `18406352652` | `profile` ("Referral Intake", relabelled from "Verified Referrals" 2026-08-19) + `unverifiedReferrals` ("Non-Referral Intake — Info Collection", §5.20) + `intakeCleanup` ("Intake — Profile Clean-Up", group `group_mm6c3rhb`, §5.20) + `inSystemReferrals` ("Already In System") — FOUR roles on one board, split by Already In System then Referral Type/Source (§5.10), and the DTC form queue split again into two sub-stages (§5.20). Its own board (groups: *Patient Intake → 1. Intake → New Form Partial/Completed → Profile Clean-Up → Already In System → Tests → Stuck → Completed*). `profile` and `inSystemReferrals` work **1. Intake** (`group_mm1xf2jb`); the send-off exit is **Advance to MN** (`Move to Onboarding` → automation creates the Masheke item + moves to Completed) — except Already In System, whose exits are **Move to Profile Send Off** (flag → No, back to 1. Intake as a Verified Referral; replaced Advance to MN there 2026-08-18) and **Mark as Stuck**. ⚠️ **Send back to Patient Intake was REMOVED** (Josh, 2026-08-14) — see §5.10. **Not** the Welcome Call board. |
| **Medical Evaluation** ("Masheke") | `18406060017` | `evaluate`, `sendRequest`, `confirmReceipt`, `chaseFax`, `chaseParachute`, `doctorAppointments` (§5.12). Medical-necessity document collection. Stuck is propose→approve: reps flip **Escalation `color_mm1x7997` → "Final Escalation Required" (index 2)** and the reason is appended to the **MN notes `long_text_mm27zjt2`** (stamped `[Proposed Stuck …]`); managers approve/return from Oversight. (The old `color_mm5f37ve`/`text_mm5frng6` columns are retired.) |
| **Insurance** ("Samantha") | `18410601299` | `benefits`, `submitAuth`, `authOutstanding`, `authDenied`, `dvs` (**stage**-based — Stage Advancer index 1 "DVS", read-only monitor at `/dvs`). Groups: Benefits, Submit Auth, Auth Outstanding, **DVS**, Auth Denied, Escalations, Complete, Stuck. ⚠️ The board grew a **DVS group** (`group_mm5gp2r2`, Aug 2026) but the role is still **stage**-defined: stage-DVS items linger in whichever group an automation last left them, so `useDvsPatients`/`useRoleCounts` read the STAGE board-wide and must not be "fixed" to filter on the group. |
| **Welcome Call** | `18410804557` | `welcomeCall` + `finalConfirm` (two roles, same board, different groups). See `BOARD_SCHEMA.md`. |
| **Subscription Board - Updated** | `18407459988` | `subscription` role + one source for Patient Questions. |
| **Secondary Claims Board** | `18413019028` | Second source for Patient Questions inbox. |
| **MM Doctor Database** | `18142847597` | NPI → doctor record + Doctor Notes (`shared/doctorDb.ts`). Separate from patient boards. |

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

## 5. Core mechanisms (read these files to understand the app)

### 5.1 Monday endpoint routing — `lib/shared/mondayEndpoint.ts`
Single switch for *where* GraphQL goes:
- `VITE_MONDAY_GATEWAY_URL` set → every `gql()` POSTs to `${gateway}/gql`; the gateway injects
  the Monday token server-side and audits the request.
- Unset → calls `api.monday.com` directly with the bundled `VITE_MONDAY_API_TOKEN`.
- `mondayIdentityHeaders()` / `mondayAuthHeaders()` attach the signed-in user's Google token
  (`X-MM-Auth`) + email (`X-MM-User`) for audit attribution. **In production the SPA is meant
  to run through the gateway.**

### 5.2 Verified write — `lib/shared/verifiedWrite.ts` (the most important utility)
Monday returns `200` on a column write *before the value is indexed*, so an automation that
triggers on a status change can read **stale sibling columns**. `executeWritesWithVerification`
prevents this with a 4-phase protocol:
1. **Snapshot** all data columns before writing.
2. **Write** all data columns in parallel (with retry).
3. **Verify** by polling read-back (≤8 tries, ~12s) until each column either matches
   `expectedText` or differs from the snapshot (same-value writes confirmed via 3 stable reads).
4. **Advance** — only now write the stage-advancer column(s).
If verification times out it **throws and does NOT advance** — surfacing the problem instead
of shipping stale data downstream.
**Gateway fast path:** when the gateway is configured and every task carries a raw `value`, the
whole transaction is handed to the durable server-side `POST /send` (idempotent), so the browser
can close immediately. Any failure falls back to the client path — purely additive.
**Blocking saves (July 2026 dropped-date incident):** callers may pass `requireDone` (+
`waitForDoneMs`, `onProgress`) — then "gateway accepted" is NOT success: the call resolves only
once the job is CONFIRMED done in Monday, and throws `GatewayPendingError` if the wait runs out.
That error means the job is still queued server-side and WILL run — callers must surface
"queued, don't repeat" and must NOT retry or fall back to the client path (double-write).
Chase Clinicals + Confirm Receipt use this with a full-screen `SaveProgressOverlay` that blocks
ALL interaction (sidebar included) until Monday confirms: a mid-save patient switch used to
clobber panel state and silently drop the Next Action Date from the transaction, so completed
patients never left the due queue and burned attempts. Those panels also compute the follow-up
date **at save time**, never from component state, and a missing date now aborts the save loudly.

The six main "Send to Monday" flows use this correctly. **Inline panel actions** (attempt saves,
mark-complete, escalation modal, notes, Subscription's big write) historically bypassed it — see
`WRITE_RELIABILITY_AUDIT.md` for the H1–H6 / M-series findings before touching those paths.

### 5.3 Access control — `lib/accessStore.ts`, `lib/roleView.ts`, `lib/people.ts`
- Persisted to **`public/data/access.json`** via the GitHub Contents API (bundled
  `VITE_GITHUB_PAT`), polled every 10s, written with SHA-based optimistic concurrency.
- Model: **managers** (see the full app + all role bars) vs **processors**
  (`email → { name, roles[], roleFilters, roleOrder }` — see only assigned bars).
- **Bootstrap:** while `managers[]` is empty, *everyone* is a manager (so the first admin can
  configure without locking themselves out).
- `roleView.ts` turns a processor profile into ordered/filtered role bars; per-role escalation
  filter is `all | escalated | nonEscalated` (legacy `?manager=1` → escalated).
- **`public/data/assignments.json` is legacy/dead** — nothing reads it; access.json is the
  single source of truth. Safe to delete.

### 5.4 Auth gate — `components/AuthGate.tsx`, `lib/shared/auth.ts`
Google Identity Services sign-in, **active only when `VITE_GOOGLE_CLIENT_ID` is set**,
domain-locked to `medicallymodern.com`. **Sign-in is a gate, not a ticking token:** the stored
identity *is* the session and never lapses on its own — only explicit `signOut()` clears it. The
1-hour Google ID token is kept for best-effort gateway attribution; **there is NO background
refresh** (AuthGate's `SessionKeeper` was removed — it only popped One Tap), so the token simply
expires. Nothing blocks on its freshness: Monday writes fall back to the client path, and the
worker `/send-message` verifies the token's **signature + domain, not its expiry** (so sends work
all session — see §5.5). A stale token never drops the session or blocks a write/send.

### 5.5 Files, email & fax — `worker/src/index.js` (Cloudflare) + `lib/fax/ringcentralApi.ts`
The Cloudflare worker (`monday-file-proxy`) has three routes:
- `GET /asset?url=` — proxy Monday asset downloads (CORS; allowlisted Monday hosts). Used by
  `shared/mondayAssets.ts` and the `FileViewerModal` (pdf.js).
- `POST /` — relay multipart **file uploads** to Monday's file API.
- `POST /send-message` — send email **as the Gmail sender**, gated to signed-in
  medicallymodern.com users. `verifyIdToken` **cryptographically verifies the caller's Google ID
  token** (RS256 signature against Google's JWKS + issuer + domain) and **deliberately ignores both
  `exp` and `iat`** — sign-in is the durable gate, so a stale token sends however old it is (no open
  relay, but no re-auth either). Set the worker var `GOOGLE_CLIENT_ID` to also pin the `aud` to this app.
  > **Gotcha — ignoring `exp` is NOT enough (fixed 2026-08-03).** Google **rotates its signing keys
  > every day or two** and drops retired ones from the published JWKS, so a token whose `kid` was
  > gone couldn't be verified at all: sends 401'd with "Sign in with your medicallymodern.com
  > account is required" after a day or two, and expiry policy never entered into it. The worker now
  > **retains every key it has ever fetched** (`KEY_RETENTION_MS`, 180 days, in the Cache API +
  > memory) and falls back to that set, so one sign-in keeps sending for months. The security
  > property is unchanged — signatures still verify against keys Google really published. Do NOT
  > "simplify" this by accepting an unverified token: the endpoint sends mail AS the company. The
  > 401 body now distinguishes "no token" (signed out) from "couldn't verify" (past retention,
  > wrong `aud`, wrong domain).
  Recipients may be normal emails **or `<number>@rcfax.com`**, which
  **RingCentral converts to a fax**. This is how Send Request dispatches fax/email.
  All **email** recipients go out as **one grouped message** (`To:` everyone, plus the optional
  `cc` form field — Send Request's Cc input) so the Sent folder shows a single email to the
  group; each **@rcfax** recipient still gets its **own** message (a fax is point-to-point, and
  grouping would expose the rcfax addresses to the human recipients).
- `POST /email-threads` / `/email-thread` / `/email-reply` (Aug 2026) — the intake page's
  Messages card reads the GMAIL_SENDER mailbox's history with ONE patient address and replies
  into a thread. Replies use the **JSON** send endpoint with `{raw, threadId}` (not `/upload`) so
  Gmail files them into the same conversation, plus In-Reply-To/References so the patient's own
  client threads them too (`replyHeadersFor` in `lib/shared/emailThreads.ts` derives those from
  the LAST message — tested). Same `verifyIdToken` gate as `/send-message`.
  ⚠️ **The two READ routes need `GMAIL_REFRESH_TOKEN` minted with `gmail.readonly` on top of
  `gmail.send`.** Until that one-time re-consent they answer `200 {ok:false, needsScope:true}` —
  a flagged state, not an error — which the SPA (`GmailScopeMissingError`) renders as an amber
  setup note in `IntakeMessages`' email tab while sending keeps working. Replies need only
  `gmail.send`, so they work the moment reading does. Thread bodies are text/plain preferred,
  HTML crudely tag-stripped otherwise, capped at 20k chars; the threads search is
  `from:X OR to:X OR cc:X -in:chats`, 10 threads max.
`ringcentralApi.ts` also reads the **unread-fax count** (FAX dashboard role) and the Fax Inbox.
> **Gotcha — fax count window:** RingCentral's message store defaults `dateFrom` to **~the last 24h**.
> Both `fetchUnreadFaxCount` and `fetchInboundFaxes` must pass an explicit `dateFrom` (180-day lookback)
> or unread faxes older than a day (e.g. over a weekend) silently drop out of the count.

> **Gotcha — SMS sends 500 but deliver:** this account's `POST /extension/~/sms` returns a bare
> `500 Internal Server Error` while still accepting the message (it lands in the message store and
> delivers ~30s later). Reproduced on two separate OAuth apps (2026-07) — account-level, not
> app-record rot. `sendSms` therefore confirms a 5xx against the message store (exact text +
> recipient, created since the POST) before surfacing an error; without that, reps would retry and
> double-text patients. The masheke Text popup (`components/masheke/mmKit.tsx` `TextCompose`) rides
> on this. The RC OAuth app also needs the **Read Messages** scope or the popup's thread read fails.

> **Gotcha — an ACCEPTED text is not a DELIVERED text** (Brandon, 2026-08-20). RingCentral's own
> guide says it outright: a successful `POST /sms` "only confirms that the request was accepted by
> the system. It does not guarantee that the messages will be delivered." A text to a landline or a
> dead number is accepted, queued, and only *seconds later* flips to **`messageStatus:
> "SendingFailed"`** with a **`deliveryErrorCode`** (`SMS-RC-410`, `SMS-UP-410`, `SMS-CAR-411`, …).
> The RingCentral app shows that as a red failure on the bubble; the Command Center showed an
> ordinary sent bubble, because the conversation payload dropped both fields — so a rep who texted a
> wrong number got a green toast and never learned the patient heard nothing. Nothing errored.
> **The THREAD is the only surface that late verdict ever reaches**, which makes three things
> load-bearing:
> 1. `/messaging/conversation` passes `messageStatus` + `deliveryError` through **verbatim** — every
>    reading of them lives in **`lib/shared/smsDelivery.ts`**, so there is no mirrored carrier-code
>    table on the gateway to drift (the §5.7/§5.17 hand-synced-mirror hazard, deliberately avoided).
> 2. ⚠️ **STATUS decides, CODE only explains.** Deriving failure from the code inverts on
>    `SMS-CAR-104`/`-199` ("carrier never reported"), which ride on messages that were fine — and an
>    *unrecognised* code must never downgrade a real `SendingFailed` to silence. An unknown status is
>    **pending**, never failed: marking an in-flight message undelivered makes the rep double-text.
> 3. The failure arrives AFTER the post-send refresh, so `hooks/useDeliveryRecheck.ts` re-reads the
>    thread at +6s and +20s. ⚠️ Its `cancel()` is **correctness, not tidiness** — each reload is bound
>    to the patient who was open at send time, so a timer surviving a patient switch paints the
>    PREVIOUS patient's conversation into the open one. Cancel on every phone/patient change.
>
> Rendered by **one** component on all three texting surfaces —
> `components/shared/SmsDeliveryNote.tsx`, used by `assignedPatients/ConversationThread`, the
> `masheke/mmKit` `TextCompose` pop-up and `profile/IntakeMessages`; a rep can text from any of them,
> so a marker on one alone is the same gap one surface further along. ⚠️ It takes **`skin="page"`**
> inside `.pf-root` for the §9 reason (`.pf-root *` zeroes margin/padding and forces `border-color`,
> which ties with a single-class Tailwind utility and then wins on source order — the note would
> render as a stray line of grey text). `smsSend.confirmSmsAccepted` now returns
> `{accepted, failed, deliveryError}` rather than a bare boolean, so the 5xx path can't report a
> message RingCentral has *already* given up on as sent — best-effort only, since a carrier
> rejection often lands after its ~6s window.

**In-app file viewer** (`components/shared/FileViewerModal.tsx`): a "View" button calls
`openFileViewer({url,name})`; bytes are fetched via `shared/mondayAssets.ts` `fetchAssetBytes`
(direct CORS fetch → worker `/asset` proxy fallback) and PDFs render with **pdf.js** (`pdfjs-dist`,
worker self-hosted via Vite `?url` — *not* a CDN, so API/worker versions can't drift).
> **Gotcha — blank PDFs:** pdf.js needs `standardFontDataUrl` + `cMapUrl` **and `wasmUrl`**, or PDFs
> render **blank** with only a console warning (the error UI never fires). Two distinct causes: fonts
> aren't embedded (font glyphs invisible), **and/or** the page images are **JBIG2/JPEG2000 scans**
> (faxed clinicals!) — pdf.js 5+ moved those decoders to **WASM**, so without `wasmUrl` it logs
> `JBig2 failed to initialize` / `null/jbig2_nowasm_fallback.js` and the scan never paints. All three
> URLs default to a version-pinned jsDelivr path (`cmaps/`, `standard_fonts/`, `wasm/`); set
> **`VITE_PDFJS_ASSETS_URL`** to self-host (mirror all three dirs). `fetchAssetBytes` also
> times out and **rejects XML/HTML error bodies** — an expired Monday signed URL returns an S3
> `AccessDenied` body as a 200, which would otherwise render as a blank "file" instead of an error.

### 5.6 The Evaluate state machine — `lib/masheke/evalState.ts` (the densest domain logic)
Local-only `EvalState` in localStorage, with **Monday as source of truth** for "Monday-backed"
fields (Monday always wins on reload, even when blank). Produces: a validity rollup
(`deriveValidity` / `bannerMnEstablished` — the latter is the single source of truth for stage
routing on submit), a doctor-facing **ask list**, and an **MN checklist**.
> **Gotcha — "Option A" encoding:** the board has *no* per-requirement columns, so the rep's
> per-requirement **Yes/No/Invalid** answers are round-tripped through **two existing dropdown
> columns** (`IP MN Invalid Reasons`, `IP MN No Reasons`) by **exact label-string match**.
> Label strings (`IP_REQ_LABELS`, casing included) **must match the board exactly or Monday
> silently creates a duplicate label**. Edit these only against the live board; the round-trip
> tests (`evalState.roundtrip.test.ts`, `evalState.step2audit.test.ts`) guard it.

> **Evaluate UI rule** (`components/masheke/EvaluatePanel.tsx`): the CGM/IP **Coverage Path +
> Language** controls only render once that product's script is **Received (Yes) or Invalid**
> (mirrors how Clinicals detail shows only on receipt). It's a pure render gate — already-saved
> coverage/language still writes on send via `buildScriptCoverageWrites`.

### 5.7 OOP estimator — `lib/welcomeCall/oopEstimator.ts`
Estimates patient out-of-pocket for the Welcome Call. **Mirrors backend Python** (`claim_assumptions.py`,
`financial_estimate_service.py`, `insurance_rules.py`) that lives on Railway, **not in this repo**.
`PAYER_RATE_SCHEDULE` and the Medicaid/Medicare/NYSHIP/Humana special-cases are **hardcoded and must
be hand-synced** with that backend — there is no automated check for drift. (NYSHIP is a **$0-OOP
payer** in both this estimator and `profile/oopEstimate.ts` — `ZERO_OOP_PAYERS`/`ZERO_PAYERS`.) Eligibility inputs
(deductible, coinsurance %, OOP max) come from **Stedi**, written into Monday by the
`stedi-monday-integration` Railway service and read back by the SPA — for the profile role that's
the **inline Stedi step in `ProfilePage.tsx`**, *not* `StediPanel.tsx`, which is dead code (§5.11).

### 5.8 Burndown / baseline — `hooks/useServerBaseline.ts`, `components/dashboard/DailyBurndown.tsx`
Daily "start-of-day" role counts land in `public/data/baseline.json` **two ways**: the
`baseline-cron` Railway service (`services/baseline-cron`) **commits** it at 9 AM ET weekdays
(cron `0 13 * * 1-5`; the commit triggers a Pages deploy, so it's what the site serves for the
workday), and `deploy.yml` runs `scripts/snapshot-baseline.mjs` at **build time** (scheduled
7:00 UTC weekdays, via the monday-gateway) as the pre-9 AM fallback — the script skips itself
when a committed baseline for today already exists. **Counting contract:** both generators must
mirror `src/hooks/useRoleCounts.ts` exactly (same escalation/follow-up/NAD filters, same
chaseFax/chaseParachute split) — `OperationsTab` compares baseline vs that hook's live counts,
so any drift shows up as phantom +in/-out chips all day; change all three files together.
**Auth Outstanding is a PURE date bucket** (redesign 2026-07-21): snoozed iff Follow Up Date
is in the future — the Follow Up STATUS column is ignored for that group and a blank date
counts as due (`sidebarList.isSnoozedAuthOutstanding`; `samActive`/`countSamGroup` take a
`dateOnlyBucket` flag). Benefits/Submit Auth keep the status-based rule. **Masheke counts
exclude Proposed Stuck patients** (Escalation `color_mm1x7997` **index 2** = "Final Escalation
Required" — a stuck PROPOSAL; they await a manager decision in Oversight's Final Decisions.
Masheke "escalated" for counts/sidebar is now index **0** only — index 2 is proposed-stuck,
handled separately), and the **`dvs` role** counts Insurance items at Stage Advancer
index 1 ("DVS") board-wide (no dedicated group), excluding ONLY date-snoozed patients
(Follow Up Date in the future — same date-only rule as Auth Outstanding; mirrors the
`/dvs` page list). **Escalated DVS patients are INCLUDED** (Josh 2026-07-29): the DVS
queue/charts key purely off the DVS/Claims status columns — no automation flips DVS
patients to a manager escalation, so a label carried in from an earlier stage must not
hide them (useDvsPatients + useRoleCounts + both baseline `countDvs` changed together).
(Insurance Escalation `color_mm2vsh2f` = "Manager Escalation Required" OR "Final
Escalation Required" — split from a single "Escalation Required" in 2026-07;
`SAM_ESCALATED` in useRoleCounts + both baseline generators — still governs the OTHER
Insurance roles' active counts.) Stage-DVS items are conversely EXCLUDED from the
Benefits/Submit Auth/Auth Outstanding queues + counts (they linger in those groups — no
group-move automation). All these rules live in useRoleCounts + BOTH baseline generators +
the samantha/masheke `useMondayPatients` hooks; change them together. Roles
**missing from the baseline** render as "not connected" in the Operations tab (never `0 → N`).
**`patientQuestions` + `updateClinicals` joined the baseline 2026-08-20** — `updateClinicals`
reuses the Subscription group count (`useRoleCounts` derives both from one fetch, so it is not a
copy-paste slip), and `patientQuestions` ports `lib/patientQuestions`' two-board open-question
rule into both generators. ⚠️ `patientQuestions` publishes **no `patientIds`**, matching the hook,
which merges an empty id map: ids on one side of the comparison only would manufacture phantom
+in/-out chips. Still absent by nature: **`fax`** (a RingCentral count — the generators only reach
Monday and GitHub, so this needs RC credentials on the cron service) and **`assignedPatients`**
(no board, no queue, no count anywhere — §4).
The cron supports `DRY_RUN=1` (print, don't commit).
⚠️ **`DRY_RUN=1` alone is NOT read-only** — it skips only the GitHub commit; the Days Auth
Outstanding recalc below still WRITES to the Insurance board. Use `DRY_RUN=1 SKIP_DAYS_RECALC=1`
for a genuinely side-effect-free run. **Second job (2026-07-21):** after the
baseline commit it recalcs the Insurance board's **"Days Auth Outstanding"** number column
(`numeric_mm5f5ars`, Auth Outstanding group) = days since the earliest per-product Auth
Submission Date — idempotent recalc, not an increment; math mirrors
`src/lib/samantha/authOutstandingDays.ts` (its own counting contract); `SKIP_DAYS_RECALC=1`
disables it. The processor `DailyBurndown` bars render
**live counts only** (baseline is not drawn there); if no server baseline exists the views
bootstrap from live counts. Dates from Monday are **timezone-naive ET strings** — compare in
ET, not via raw `new Date()` (see `ringcentralApi.ts` / cron comments).

### 5.9 Chase Clinicals split — Fax vs "Email & Parachute" (don't merge Email back into Fax)
The Confirm-Receipt→Chase step has **one Monday stage** ("Chase Clinicals" on the Masheke board)
but is sliced into **two app roles** by the **Clinicals Method** status column
**`color_mm1xw7y5`** (live labels: **`Fax` · `Parachute` · `Email`**, plus blank):
- **`chaseFax`** (`/chase-fax`) — method **`Fax` or blank** (a missing method counts as fax so
  nobody falls through the cracks).
- **`chaseParachute`** (`/chase-parachute`, labelled **"Chase Clinicals — Email & Parachute"**) —
  method **`Parachute` or `Email`**. **Email deliberately rides with Parachute** for queueing and
  cadence, but it is still **sent by email** (the optional fax/email re-send box keys off the
  panel's `roleMethod`, so Email patients in this role never see the fax re-send path).

This grouping is applied in **five** places that must stay in agreement — if you "fix" one,
fix all five (a future Claude keeps wanting to put Email back with Fax):
1. **Role page** — `src/pages/ChaseClinicalsPage.tsx` (the `useMemo` patient filter + header label).
2. **Role counts / bars** — `src/hooks/useRoleCounts.ts` ("Chase Clinicals" bucket → `cm === "Parachute" || cm === "Email" ? "chaseParachute" : "chaseFax"`).
3. **Oversight charts** — `src/lib/oversight/oversightApi.ts` `CHART_FILTERS` (`chase-fax` = method NOT in
   [Email, Parachute]; `chase-email-parachute` = method IN [Email, Parachute]; same split on the
   Escalations · Attempt 4+ row, ANDed with MN Attempts `color_mm1wz0vg` = `Escalate`).
4. **Baseline (build time)** — `scripts/snapshot-baseline.mjs` `countMashekeStages` (was regressed
   to Email→chaseFax once; see §5.8 counting contract).
5. **Baseline (9 AM cron)** — `services/baseline-cron/index.mjs` `countMashekeStages`.

**Cadence:** on Complete the Next Action Date moves **+3 business days for every Clinicals Method**
(Fax/Email/Parachute/blank) — `ChaseClinicalsPanel.tsx` `nadBumpDays`. `config.ts`
`chaseFax`/`chaseParachute` are the role registry entries.

**Both chase roles carry the shared stamped NotesPanel** (2026-08-21). MN Workflow Notes were
render-only on this panel, so a rep who learned something on a chase call that wasn't an attempt
*outcome* had nowhere to put it — it went into the attempt note, where it reads as the outcome, or
nowhere. It is now `components/masheke/NotesPanel` (`variant="mm-inline"`) writing
`COL.mnEvalNotes` through `lib/shared/noteStamp`, identical to Evaluate / Send Request.
⚠️ `notePrefix` is **"Chase Clinicals" on BOTH roles**, not per-method: they are ONE Monday stage
sharing ONE notes column, the fax vs email/parachute split is already recorded by Clinicals Method,
and `NotesPanel`'s `ATTEMPT_LABEL_REGEX` bolds that exact string — `"Chase Clinicals — Fax:"`
matches neither. ⚠️ Adding a note writes **straight to Monday** and is deliberately **not** part of
the chase transaction: it does not gate "Chase Clinicals Completed", which still keys on the
attempt note in step 2. Those are different records — running case history vs. this attempt. The
panel passes **no `profileSendOffNotes`**, because `PriorStageNotes` directly above already renders
it (passing it would print the prior stage twice).

### 5.10 Profile Send Off split — Verified · Unverified · Already In System (July 2026)
Same pattern as §5.9: **one Monday stage** (Profile Send Off board `18406352652`, group
**1. Intake** `group_mm1xf2jb`) sliced into **three app roles** by three status columns —
**Already In System `color_mm2xe7r8`** (labels `Yes`/`No`), **Referral Type `color_mm1wm4n4`**
and **Referral Source `color_mm1w5wxr`**, evaluated in that order:
- **`inSystemReferrals`** (`/in-system-referrals`, "Already In System", added 2026-07-31) —
  Already In System **`Yes`**, whatever the referral type/source. Checked **first**.
  ⚠️ Also its **own group** now (`group_mm64b83h` "Already In System", wired up 2026-08-12).
  Nothing in the SPA read that group — not the Oversight fetch, not `useRoleCounts`, not either
  baseline generator — so the ten patients the board had moved there were invisible **everywhere**
  and the Oversight chart sat at a permanent 0. The role is **group OR status**: membership is the
  marker (an item can arrive with the column still blank), and the flag still counts on its own for
  items left in 1. Intake or a form group. Both routes are asserted in `columnExclusivity.test.ts`.
  The page reads both groups too — `ProfilePage`'s `VARIANT_GROUPS` hands this one variant a LIST
  and `fetchGroupItems` ORs it in a single paged query; the item's `group { id }` rides along
  because `profileReferralRole`'s 4th argument is what routes a patient whose status column was
  never written. Every other role still reads 1. Intake alone.
- **`unverifiedReferrals`** (`/unverified-referrals`, "Unverified Referrals") — Referral Type
  **`Patient`** OR Referral Source **`CareCentrix`** (and not already in system).
- **`profile`** (`/profile`, labelled **"Referral Intake"** — "Verified Referrals" until Brandon
  renamed it 2026-08-19; id unchanged through both renames so existing access.json role
  assignments keep working) — **everyone else**. The label lives in three places that must agree:
  `config.ts` `ROLES`, `ProfilePage`'s `VARIANT_LABEL`, and the `profile-send-off` chart title in
  `oversightApi.ts`.

⚠️ **"Send back to Patient Intake" was REMOVED from `ProfilePage` (Josh, 2026-08-14) — do not
rebuild it.** It rendered only on **`/profile`** (Verified Referrals): `canSendBack` was
`variant !== "inSystem"`, and `/unverified-referrals` is served by its own page, not this one. Two
things were wrong with it, both surfaced by the return-button audit. It moved the item to
`GROUPS.patientIntake` (`group_mm4vhqff`), a group **no SPA queue reads** — not `VARIANT_GROUPS`,
not `useRoleCounts`' `PROFILE_GROUP_ID`, neither baseline generator — so the patient left the app's
pipeline entirely with nothing tracking them. And it **never touched Intake Escalation**
`color_mm5zww42`, so an escalated referral was moved out carrying the flag; anything that later put
them back in *1. Intake* would have delivered them hidden from Unverified Referrals (`formActive`
excludes escalated labels) and from that page's rep view — the same stale-carry-over class
`enterDoctorAppointments` clears on entry to guard against (§5.12). Removed with its writer
(`profile/mondayWrite.sendBackToPatientIntake`), the `sendingBack`/`canSendBack`/`onSendBack`
plumbing and the now-orphaned `.route.intake` / `.route.outreach` CSS. `GROUPS.patientIntake`
survives as board schema only. That left **Verified Referrals with exactly one exit, Advance to MN**,
gated on the readiness checklist — so a referral that is genuinely missing information had no in-app
route out of that queue. This doc recorded that as "the accepted consequence, not an oversight".
⚠️ **It was not accepted — REVERSED 2026-08-20** (Josh, second report from the floor): patients whose
insurance came back inactive and who wouldn't answer the phone (Richard Clark the reported one) piled
up in the queue with a greyed-out Advance to MN and nothing else to press. **Mark as Stuck now renders
on BOTH of this page's queues**, and the fix is deliberately the DIRECT exit, not the Propose Stuck
ladder — Josh, same day: *"no propose stuck anywhere"*. The rep decides, a reason is required, the
patient moves to the Stuck group. Do not re-narrow this to Already In System.

**Already In System has a third exit: Mark as Stuck** (2026-08-12). Most patients in that queue
are already being served, so "Advance to MN" is wrong for them and they had no way out. It stamps `text_mm2vf40t` (**stuck reason**) and then moves the item
to `GROUPS.stuck` (`group_mm1xyczx`) — reason FIRST, so a failed move leaves a stamped patient
still in the queue rather than one parked in Stuck with no explanation. ⚠️ The **group is the only
marker**: Move to Onboarding `color_mm1zmeb3` has no Stuck label (its labels are Already Serving ·
Advance to MN · Send Back To Referral · Need More Info), so nothing on the item says "stuck" except
which group it sits in — which is why the reason is required and stamped with who/when.
⚠️ **`onMarkStuck` is UNCONDITIONAL from 2026-08-20** — both queues this page serves get it (see the
reversal above); only `onMoveToPipeline` is still Already-In-System-only. The stamp's stage label
therefore follows `selectedRole`, not `VARIANT_LABEL.inSystem` as it did while the button was
in-system-only: a deep-linked patient is exempt from the split, so the URL is not evidence of which
queue they are in, and this column is the only record of why they stopped.
⚠️ `onMoveToPipeline` stays scoped
via `BodyProps` to the **SELECTED PATIENT's** computed role
(`selectedRole` ← `profileReferralRole`, 2026-08-18) — **not** the page variant: Search routes
every 1. Intake row to `/profile` and a deep-linked `?patientId=` is exempt from the split, so an
in-system patient opened from Search landed on Verified Referrals offered **Advance to MN** (the
one exit that's wrong for them) and neither real exit — reported as "Mark as Stuck was removed".
On the queue pages patient and URL always agree, so queue work is unchanged; the key-off only
bites on deep links, in both directions (a verified patient deep-linked onto
`/in-system-referrals` gets Advance to MN, not the in-system exits).
**Already In System's Advance to MN is REPLACED by "Move to Profile Send Off"** (Josh,
2026-08-18). That queue's patients never advance straight to MN — the workable ones go back into
the normal pipeline instead: `mondayWrite.moveToProfileSendOff` writes Already In System → **"No"**
(an examined answer, not a blank) and then moves the item to **1. Intake**, where the split above
hands it to Verified Referrals. Flag FIRST, move second — either half-failure leaves the patient
still in this queue (the role is group OR status), visible and retryable
(`moveToProfileSendOff.test.ts` pins the order). The inbound half is board automation
**7922049614** (added the same day): Already In System → "Yes" moves the item INTO the in-system
group. The button is its exact inverse and triggers nothing — the automation fires on "Yes"
(index 0) only. Confirm-dialog only, no reason required: the flag flipping to No IS the record,
and the patient stays in the app's pipeline rather than parking in a dead-end group. Not gated on
the readiness checklist (it's a routing correction, not a completion) and disabled in
`reviewMode` like the other movers.

⚠️ Every one of this page's exits (Advance to MN, Move to Profile Send Off, Mark as Stuck)
**drops `?patientId=` on success** (`clearDeepLink`): the item moves to
another group so the next fetch won't return it, but a deep link is re-injected by
`useMondayPatients` on every poll AND is exempt from the role split — so a rep watched a patient
they'd just sent away sit in the sidebar. Clearing the URL only works because the hook now reads
the deep link through a **ref**: `refetch` is deliberately stable, so it had captured the
first-render id and kept re-injecting it no matter what the URL said.

**Both referral queues flag DTC-form twins** (Josh, 2026-08-18 — Verified Referrals AND Already In
System; the unverified route is its own page and IS the form queue, so it has nothing to flag). A
doctor (or manufacturer) referral often has a SECOND item for the same human that the patient
submitted through the DTC form. The page shows a "DTC Form Filled Out" header pill + a banner
naming the matched form item(s) with a "View form" link (form groups → `/unverified-referrals` with
the right `source`; a lead belonging to the OTHER referral queue → that queue's route) or an
in-place select when the twin already sits in the queue the rep is on (`dtcLeadRoute` takes the
current variant).
Canonical logic: **`lib/profile/dtcFormFlag.ts`** (+ tests) — a match is email OR full-10-digit
phone OR name+DOB together (never name alone), and the flag is suppressed on items whose own
Referral Type is "Patient" (TYPE only — referralSplit's vocabulary rule; the Source column's
"Patient" label decides nothing). Leads = a slim 60s poll of the two New Form groups
(`fetchDtcFormLeads` / `useDtcFormLeads`) PLUS patient-form items already inside the page's own
queue fetch — a form row marked "Yes" is MOVED into the in-system group and leaves the form groups
(the Ivy Gushea pair, 2026-07-28), so the poll alone would miss exactly the twin the flag exists
for. ⚠️ **READ-ONLY DISPLAY**: no queue membership, role count, baseline or board write changes,
which is why — unlike the splits above — it has NO keep-in-agreement list. Do not "promote" the
form groups into the queue fetch to feed it: `profileReferralRole` would route a flag-"Yes" form
row into this sidebar while `useRoleCounts` still counts it as Unverified — the §5.8
sidebar-vs-burndown drift.

The three are **mutually exclusive and exhaustive** — every active intake patient is in exactly
one queue, so role counts still sum to the group total (§5.8) and no patient is worked twice.
A blank Already In System counts as NOT in system (the column isn't always set).

> **The DTC form queue is itself split in two from 2026-08-19 — see §5.20.** The two form groups
> are *Info Collection* (`unverifiedReferrals`, left pane only) and the Profile Clean-Up group is
> *`intakeCleanup`*. Everything in this sub-section applies to BOTH: same board, same columns, same
> no-snooze rule, same Propose Stuck ladder.

⚠️ **Patient Intake has NO SNOOZE — do not give it one without building a next-action
mechanism first** (Josh, 2026-08-13). "Log call attempt" bumps the **Attempt Counter
`numeric_mm5ze82q`**, appends the note to the Call Log, and stops. The patient stays in the
queue; the attempt count is the only signal of how hard we've tried.
It used to write **Follow Up `color_mm3822qq` + Follow Up Date `date_mm3874an`**, and that pair
is a **one-way door on this board**: Follow Up is the flag every list uses to decide who is
active (`followUp !== "Done"`), while the DATE is read by *nothing* — not `sidebarList`, not
`useRoleCounts`, not either baseline generator, not a board automation. So one unanswered call
removed the patient from the sidebar, the role bar and the burndown **permanently**, while the
toast promised them back on a named day. (The column's index 1 is **"Done"** on the live board,
not the "Follow Up" the old code's comment claimed — its labels are *Working on it · Done ·
Stuck* — so the row also read as a finished patient.) `IntakeEdits` no longer carries the two
fields at all, and `unverifiedWrite.test.ts` asserts neither column can be written.
Four places implement "this queue ignores Follow Up" and must stay in agreement (§5.8):
1. **Sidebar** — `sidebarSections(patients, { ignoreFollowUp: true })`, passed by the page as
   `PatientsSidebar ignoreFollowUp`. ⚠️ It must IGNORE the column, not hide the section: the
   split moves `"Done"` patients OUT of the source groups, so hiding alone drops them entirely.
2. **Role counts** — `useRoleCounts.ts` `formActive` (escalation only).
3. **Baseline (build time)** — `scripts/snapshot-baseline.mjs` `countProfile`.
4. **Baseline (9 AM cron)** — `services/baseline-cron/index.mjs` `countProfile`.
Verified Referrals and Already In System still use the column as a genuine follow-up flag and
keep the split — this is a Patient-Intake-only rule. `returnIntakeToPipeline` clears a stale
Follow Up as a heal, not as part of the return.

**Which is why this queue is ORDERED least-tried-first** (`SidebarOptions.sortByAttempts`, both
flags together in the page's `SIDEBAR_OPTIONS`). Nothing ages a patient out of a stage with no
snooze, so the list only grows, and a rep working it top-down would re-ring the same people while
the bottom never got touched. Ascending, and the tie-break carries as much weight as the sort:
`Array.prototype.sort` is stable, so equal counts keep Monday's own order — **oldest submission
first**. Newest-first among the untried reads as "speed to lead" and produces exactly the rot this
prevents. The count renders on the row (`attemptCount`, "not tried yet" called out) — ordering a
list by a number the rep can't see is its own unexplained behaviour. The page's auto-select reads
`sidebarVisibleList` under the same options, so the row a rep looks at first and the patient the
page opens on can't drift apart.

⚠️ Referral **Source** also has a `Patient` label — only the **Type** column routes `Patient`
to Unverified. Canonical rule: `src/lib/profile/referralSplit.ts` `profileReferralRole`
(+ tests). The rule is applied in **five** places that must stay in agreement (same drill as §5.9):
1. **Role page** — `src/pages/ProfilePage.tsx` (`variant` prop; deep-linked `?patientId=` stays visible regardless of split).
2. **Role counts / bars** — `src/hooks/useRoleCounts.ts` (profile board task splits `profile` / `unverifiedReferrals` / `inSystemReferrals`).
3. **Oversight charts** — `src/lib/oversight/oversightApi.ts` `CHART_FILTERS` (`profile-send-off` = verified only; `profile-send-off-unverified` = Type `Patient` OR Source `CareCentrix` via `anyCols`; `profile-send-off-in-system` = Already In System `Yes` — the other two AND it out) + `CHART_ROUTES` in `OversightTab.tsx`.
4. **Baseline (build time)** — `scripts/snapshot-baseline.mjs` `countProfile` (§5.8 counting contract).
5. **Baseline (9 AM cron)** — `services/baseline-cron/index.mjs` `countProfile`.

### 5.12 Doctor Appointments — patient outreach when the provider needs a new visit (Aug 2026)
The office sometimes answers a clinicals chase with *"we haven't seen this patient recently — they
need to come in."* The chase is dead until the visit, so the rep flips the patient with the
**Doctor Appointment Required** button on either chase page (`DoctorAppointmentRequiredDialog` —
the ONLY entry point; there is deliberately no way for a rep to set this on their own judgment).
**One rule is the whole state machine:**
- **Appointment Date set** ⇒ a normal Chase patient, Next Action Date = appointment **+ 1 day**
  (weekend-clamped — never the appointment date itself, which would surface them the morning of
  the visit). They never enter the queue below. A **past** date is accepted on purpose ("she was
  seen last Thursday" / "I already went in"): `snoozeUntilAfterAppointment` floors the result at
  **today**, so those patients are due NOW rather than carrying a stale follow-up date.
- **Appointment Date blank** ⇒ Sub-Stage → **"Doctor Appointment"** (`SUB_STAGE_INDEX
  .doctorAppointment` = **0** — Monday assigns the index when a label is created in the UI and
  picked the lowest free slot; this column's other labels start at 8), the `doctorAppointments`
  role at `/doctor-appointments`.

**Three exits, and only three:** an appointment date (→ back to Chase, snoozed to appt+1); three
spent attempts (→ Escalation index 0, Manager Intervention); or **"won't schedule / wants to
cancel"** (→ Propose Stuck, at ANY attempt). Everything else keeps the patient in the queue,
snoozed. Propose Stuck climbs the **shared ladder** (`stageActions.proposeStuckLevel`, the same one
Submit Auth and DVS use): a rep's proposal lands in **Manager Intervention** (index 0), and a
manager proposing from there — or a proposal on an already-escalated patient — promotes to **Final
Decisions** (index 2). The page also carries the standard `StageActionBar`, so Propose Stuck /
Approve Stuck / Send back to pipeline are available from all three manager columns. Canonical logic: **`lib/masheke/apptOutreach.ts`**
(+ tests).
> The **Final Decisions view is the one place the "won't schedule / wants to cancel" outcome is
> hidden** (Josh, 2026-08-03): a proposal is what put the patient in that column, so proposing it
> again is a no-op — that manager Approves Stuck from the action bar instead. Gated on
> `?mv=final-decisions` only; every other view keeps it. The panel also re-defaults the selection
> when the filtered list changes, because the same component instance survives a change of `mv`
> and a hidden option must not stay armed on the Save button.

> **Why a refusal doesn't wait for the third attempt:** it's a rep JUDGMENT about what they were
> told, not a counter running out. It climbs one rung rather than jumping to Final so a manager
> actually reviews the refusal before the patient can leave the pipeline. The reason is
> stamped through the shared `stampProposedStuck` helper (so `extractProposedStuckReason` reads it
> with no special-casing) and carries the **stage and attempt number** — that notes column is
> shared, and a bare sentence wouldn't tell a manager whether the patient refused on call 1 or 3.
> ⚠️ Both rungs have a chart on the Doctor Appointments row, so neither can go invisible (§7).

> **The 3-attempt cap is a REP guardrail only** (`apptCapApplies`). An escalated patient has NO
> limit: the manager working them in Manager Intervention or Final Decisions logs as many attempts
> as it takes, and leaves that queue only by getting a date, sending them back to the pipeline, or
> promoting the Propose Stuck. The cap has already done its job by the time a patient reaches them.
>
> ⚠️ Which means the count needs a **reset marker**, or two ordinary situations silently lock a
> processor out of a patient they're supposed to work: a patient who re-enters the stage a second
> time, and a patient a manager hands back after logging five attempts of their own. Both would
> arrive with ≥3 attempt lines already in the notes. `apptAttemptsFromNotes` therefore counts only
> the lines AFTER the last marker — the stage-entry stamp, or `[Returned to queue`.

**No new Monday group and no new automation** — Sub-Stage `color_mm1wyr92` **IS** the stage
advancer on this board (`mondayWrite.recordAndAdvanceVerified` passes it as `stageColumnId`,
"the single write that moves the item"), so a new sub-stage index is the whole board change.
**One new column: Appointment Date `date_mm5w2vsf`.**

> **Every note this stage writes goes to MN Workflow Notes** `long_text_mm27zjt2` — outreach
> attempts have no columns of their own (Josh, 2026-08-03; three `Appt Attempt` text columns were
> created and then deleted). The attempt line is exactly:
> `8/3/26, 1:38 PM · Phone call — No answer / no response · <rep note> —JH`
>
> ⚠️ **THAT LINE IS THE COUNTER.** `apptAttemptsFromNotes` counts the lines in the notes body
> matching `{known method} — {known outcome}`, and numbers them by position, so the shape is a
> contract: a format change not matched in the parser doesn't error, it silently resets a
> patient's attempt count and hands the rep unlimited retries. It's also **why a note is mandatory
> on every attempt** (`canLogAttempt`) — a note-less save would be indistinguishable from no
> attempt. MN Attempts `color_mm1wz0vg` is deliberately NOT reused: it's Chase's and board-wide,
> so a patient who spent two chase attempts would arrive with one outreach attempt left.

> **Escalation is shared, so entry CLEARS it.** `enterDoctorAppointments` writes Escalation → Done
> on the way in. Without it, a manager working an escalated chase patient who clicks the button
> delivers them into this queue already escalated — and escalated patients are hidden from this
> sidebar, so they'd be **invisible on arrival, with no error**. Same stale-carry-over class of bug
> `evaluateReentry.ts` exists to self-heal. Three failed attempts escalate to **index 0** (Manager
> Intervention), never index 2 — index 2 is a stuck PROPOSAL awaiting a Final Decision, and an
> unreachable patient is a manager task, not a pipeline exit.
>
> **An appointment DATE clears it too, on all three paths** (Josh, 2026-08-03): a booked visit is
> the answer to "this chase is stuck", so the patient returns to the rep's queue rather than sitting
> in a manager column with a date nobody needs to act on. `returnToChaseWithAppointment` (the
> outreach panel's booked outcome) and `enterDoctorAppointments` always did;
> **`scheduleAppointmentFromChase`** — the entry dialog's "yes, they already have one" answer — did
> not, so a chase patient escalated at attempt 4+ kept the flag while waiting on a visit. All three
> now write Escalation → Done. This is not the Insurance-board anti-pattern §7 warns about: it's an
> explicit act by the person recording the date, not a hydrated flag re-written on every send, and
> the rep's own re-send re-raises it if the visit doesn't produce clinicals.
>
> ⚠️ **Clearing the escalation was only half of it — a booked visit RESTARTS THE CHASE ROUND**
> (Josh, 2026-08-14; `mondayWrite.buildFreshChaseRound` + `freshChaseRoundTasks`, tested). Both
> paths that land an appointment date (`scheduleAppointmentFromChase` and
> `returnToChaseWithAppointment`) put the patient back in a CHASE queue, and both left **MN
> Attempts `color_mm1wz0vg`** exactly where the pre-visit chase left it. That column — not which
> attempt columns are filled — is what `ChaseClinicalsPanel` derives the current slot from, so a
> patient whose button was pressed at attempt 4+ came back off the snooze to a **locked** panel:
> no attempt, no re-send, no way to move the date. Same dead end §7 documents for the manager's
> return. Both writes now roll the spent chase attempts into MN Workflow Notes, blank those three
> columns and reset MN Attempts → **Attempt 1**.
> ⚠️ **The clears are not optional once the counter moves.** Resetting MN Attempts while the chase
> columns still hold text is WORSE than leaving both: `handleSave` writes into the slot the COUNTER
> names (`chaseAttempt1`) while the cards render from the COLUMNS, so the next attempt would
> silently overwrite the old attempt 1 note.
> ⚠️ **Confirm Receipt's three columns are deliberately untouched** — the chase page parses them
> for its "who actually confirmed receipt" banner (the same reasoning as `attemptRollup`'s
> `chaseOnly` scope). Pinned by `freshChaseRound.test.ts`.
> The rollup is computed by the CALLER (`buildFreshChaseRound`) and handed to the write as the
> final `notes` plus a `clearChaseAttempts` flag — one computation, so the board write and the
> panel's optimistic patch can never disagree about what the notes now say. An overlay holding a
> pre-rollup body would be re-written by the next stage's send and lose the history.

**Cadence** — `APPT_ATTEMPT_SNOOZE_BUSINESS_DAYS` = **1 business day** for every logged attempt
(Brandon's v3 matrix), with **one** per-outcome exception: *"Spoke — patient will call the office"*
waits `WILL_CALL_SNOOZE_CALENDAR_DAYS` = **7 CALENDAR days** (Brandon, restored 2026-08-04 after
being flattened to 1 in the 2026-08-03 build). The next move is the patient's, so there's nothing
to check tomorrow. Calendar, not business, so it lands on the same weekday a week out and can never
fall on a weekend (7 business days would be a week and a half). It still burns an attempt, and the
**third attempt still escalates** — that check runs before the gap is chosen, so a longer snooze
never buys a fourth try. Reach-out methods are Phone call · Text message · Email.

**Sidebar sections differ by ROLE** (`apptSidebarSections`):
- *Reach out today* — the work. Everyone.
- *Awaiting reply* (snoozed) and *Scheduled* (booked a visit, so already back in Chase — sourced
  from `scheduledApptPatients`, closed by default) — **MANAGERS ONLY**, both of them. Neither is
  work; a processor's sidebar is "Reach out today" and nothing else. Gated on the
  **`?mv=` Oversight origin** — i.e. this is the manager VIEW, not "the signed-in user is a
  manager". Two earlier gates were both wrong: `?manager=1` is only set by SOME columns, so the
  folders vanished when a manager clicked in from Processor Overview; and gating on access level
  showed them permanently, including on the ordinary role page a processor works from. `mv` is set
  by every Oversight column and by nothing else.
  ⚠️ The manager view lists **every** patient in the stage, not just escalated ones — an
  escalated-only filter left it empty for the common pre-escalation case (attempt 3, follow-up
  tomorrow), which is exactly who a manager wants to see. That includes the **escalated** ones,
  sorted into the same two folders by Next Action Date like anyone else — hence
  `apptSidebarSections`' `includeEscalated` flag (true only for the manager view). Without it
  Manager Intervention read "Nobody due right now" while its own bar chart counted the patient:
  the filter used `isEscalatedIndex`, which is **index-0-only**, so index-0 patients vanished and
  index-2 (Final Decisions) came through — exactly the asymmetry that made Final look correct and
  Manager Intervention look broken. (Index 2 reaches the page by deep-link injection, since
  `useMondayPatients` drops `proposedStuck` from every stage queue.)
  ⚠️ **A booked visit WINS.** A patient whose Appointment Date is today-or-later is in *Scheduled*
  and nowhere else — never Reach out today, never Awaiting reply, whatever their Next Action Date
  says. There's nothing to do for them until the visit. That ordering is also what stops the same
  person appearing twice: `useMondayPatients` injects a deep-linked `?patientId=` into the main
  list even when it doesn't match this stage, so a booked patient arrives in `patients` AND
  `scheduledApptPatients`. The panel shows the booked date instead of the attempt form for those,
  because writes against a patient who isn't in this stage would corrupt the count.

Escalated patients drop out of the processor sidebar entirely — they're the manager's. **Role
counts follow the normal due-today rule**, so the role bar matches "Reach out today".

**Oversight — its own row across all three columns** (`doctor-appointments` /
`-manager` / `-final`, aligned by `rowOf`). The row covers **both halves** of the stage: the
outreach queue (Sub-Stage `Doctor Appointment`), and patients parked in **Chase** waiting for a
booked visit — the "yes" answer to the entry dialog, matched on **Appointment Date today-or-later**
(`ColCondition.dateOnOrAfterToday`, and the charts use the one composite `{type:"any"}` rule). The
chase charts exclude that second group so nobody is counted twice, and those patients drop off this
row on their own once the date passes. Their BEHAVIOUR is unchanged — still chase patients, still
due when the Next Action Date lands; this is only where a manager looks at them.
⚠️ That exclusion belongs on **all EIGHT chase charts, not just the two processor ones** — the two
`-escalations` (Attempt 4+), the two `-escalated-3rd`, and the two `-proposed-stuck` as well. It
shipped on the processor pair alone and the everyday path put a patient on two rows of the SAME
column: a chase patient at attempt 4+ keeps MN Attempts = `Escalate` when the office asks for a
visit, so recording the date left them on the Doctor Appointments bar AND the Chase bar of Manager
Intervention. Nothing goes blind by removing them, because `doctor-appointments-manager` / `-final`
already partition indices 0 and 2 over exactly that population — and the exclusion is scoped to a
FUTURE visit, so a patient whose appointment has passed returns to the chase chart with their
escalation intact. `appointmentsBar.test.ts` checks every (column × method) pair both ways.
The three filters partition by escalation — none / index 0 / index 2 — so **every** escalation
value lands in exactly one chart,
which is what guarantees §7 (a state matching no chart is invisible app-wide);
`appointmentsBar.test.ts` asserts that partition. All three route to `/doctor-appointments` — the
work is calling the PATIENT, and the chase UI would show the wrong job.
> This replaced an "Appts" appendix bar on the two chase charts (`ChartDef.appendixBar`, still in
> the codebase and unused). That put an **escalated** outreach patient in the PROCESSOR column —
> visible, but not where a manager looks. Its one lost benefit: chase patients snoozed waiting for
> a booked visit are back in the chase day buckets and will drift into "30+ Days" while parked.

**Keep-in-agreement (same drill as §5.9/§5.10) — the §5.8 counting contract:**
1. **Role page** — `src/pages/DoctorAppointmentsPage.tsx` + `hooks/masheke/useMondayPatients` `SUB_STAGE_FILTER`.
2. **Role counts** — `src/hooks/useRoleCounts.ts` (`stage === "Doctor Appointment"`). ⚠️ Without this branch the sub-stage falls through `if (!roleId) continue` and the patient is counted **nowhere** — no error, just invisible.
3. **Oversight** — `oversightApi.ts` `CHART_FILTERS` (`chase-fax-appointments`, `chase-email-parachute-appointments`) + the two `appendixBar` defs.
4. **Baseline (build time)** — `scripts/snapshot-baseline.mjs` `countMashekeStages`.
5. **Baseline (9 AM cron)** — `services/baseline-cron/index.mjs` `countMashekeStages`.

Shared with Chase, extracted 2026-08-03 so the two can't drift: `components/masheke/AttemptCards.tsx`
and `lib/masheke/attemptLog.ts` (attempt parse/format + note append).

### 5.11 Profile "Run Stedi Check" — the live UI is INLINE in `ProfilePage.tsx` (`StediPanel.tsx` is DEAD)
The profile role's whole Benefits step — Run Stedi Check button, **Eligibility Results grid**
(`ResCell` rows incl. the full-width **Stedi Address `text_mm5fqm4s`** row), cost sharing, insurance
entry — is rendered **inline in `src/pages/ProfilePage.tsx`** (+ `src/pages/profile/redesign.css`).
The July 2026 redesign replaced the old per-panel components but left them in the tree unimported:
**`components/profile/StediPanel.tsx` is dead code** (zero importers, static or dynamic — verified
2026-07-21; it carries a banner comment). Editing it changes nothing on screen — a past handoff
doc pointed there, so double-check you're in `ProfilePage.tsx` before touching Stedi UI.
Dead from the same redesign: `DoctorPanel`, `PatientProfileCard`, `ServingPanel`, `NotesPanel`,
`OopCard`, `ReadinessChecklist`, `ReferralEmailPanel`, `FollowUpModal`, `UpdatesSheet` (+
transitively `InsuranceSuggestions`, `DoctorFollowers`, `ParachuteLookupPanel` — imported only by
dead files). Still **live** in `components/profile/`: `PatientsSidebar`, `DoctorSection`, `NoteLog`,
`AddressAutocomplete` — and **`ClinicalsDownloadButton`, whose only live importer is
`samantha/AuthOutstandingPanel`** (don't break Auth Outstanding in a "profile dead code" cleanup).

**Flow** (all in `ProfilePage.tsx` `handleRunStedi` + the settle watcher): Run →
`writePatientProfile` + `verifyProfileWritten` (≤3 tries — Stedi reads Name/DOB/General
Insurance/working Member ID `text_mm4t8gbq` **from Monday**, so inputs must land first; verify
fails ⇒ the run aborts, Stedi never fires) → `triggerStediRun` flips `runStediEligibility`
`color_mm1yeksx` → the **`stedi-monday-integration`** Railway service writes the `stedi*` result
columns back **one at a time (~1/sec over 15–25s; there is NO "done" column)** → the page polls
every 4s and fingerprints **every** result column (`STEDI_SIGNATURE_KEYS`), revealing only after
the set has been stable ~10s (`STEDI_SETTLE_MS`; byte-identical re-runs reveal after 35s, hard
timeout 90s) — results appear all at once, never piecemeal.

**Adding a Stedi result column = 5 places, all in the profile slice** (same keep-in-agreement
drill as §5.9/§5.10 — Stedi Address, added 2026-07-21, is the worked example):
1. `lib/profile/mondayApi.ts` — `COL` entry **and** `READ_COLUMN_IDS` (every profile query fetches
   `column_values(ids: READ_COLUMN_IDS)` only; miss this and the field reads permanently blank).
2. `lib/profile/workflow.ts` — `Patient` field.
3. `lib/profile/mondayMapping.ts` — `mondayItemToPatient`.
4. `pages/ProfilePage.tsx` — `STEDI_SIGNATURE_KEYS` (miss this and the reveal can fire before your
   column lands) + the defensive `removeOverlayKeys` list in `handleRunStedi`.
5. `pages/ProfilePage.tsx` — the render (`ResCell` in the `res-grid` rows).
The SPA **never writes** `stedi*` columns — the Railway service owns them (the SPA only clears
three locally at run start). A result column that stays blank means the service isn't writing it,
not an SPA bug.

### 5.13 Inbound calls — the shared line, live in the app (Aug 2026)
Any inbound call to the MM line pops a card in the Command Center, wherever the rep is working, and
**"Take it" forwards the still-ringing call to that person's own phone.**

**The insight the whole feature rests on: SIGNAL and AUDIO are separable.** The browser softphone
(`useWebPhone.ts`) is **outbound only**, and has to be — every rep registers as the *same*
RingCentral extension, a SIP server caps an extension at **5 registrations**, and a shared
`instanceId` knocks older tabs off inbound entirely. So the browser can never be the thing that
learns about an incoming call. It doesn't have to be:
- **Signal** — **one** server-side webhook subscription on the gateway, fanned out over **SSE**.
  No SIP, no registration, no cap: ten browsers cost what one does.
- **Audio** — stays on RingCentral, on the claimer's **own** number, reached by **forwarding** the
  ringing call to them.

⚠️ **Don't "simplify" this by having the browser register for inbound SIP.** That is the design
that hits the 5-registration cap, and it fails by silently dropping the 6th tab, not by erroring.

**Claiming, not notifying.** RingCentral's **Forward Call Party** works on a party in
`Setup`/`Proceeding` — i.e. while the phone is still ringing — so "Take it" doesn't ask anyone to go
find the RingCentral app and race the shared line: the forward **is** the routing. Needs the
**`CallControl`** permission on the RC app (added 2026-08-05); without it the subscription can't be
created and `/calls/claim` 502s. **`GET /calls/health` reports which half is missing.**

**The model (Josh, 2026-08-05): the Command Center is ONE instance and IT DOES NOT MATTER WHO PICKS
UP.** There is deliberately **no routing, no ownership, no per-patient assignment**. Each employee
only chooses what reaches *their* screen — `all` (the default) / `list` / `off`. **Narrowing your
list quiets your screen; it can never make a call unanswerable by someone else.** Don't rebuild this
as an assignment model — the previous "assigned patients" model was removed in Aug 2026 for the same
reason.

**Matching is SERVER-side, per SSE connection.** Broadcasting every caller's number to every open tab
and filtering in the browser would hand each rep the numbers of patients their own rules excluded —
the filter is a **privacy boundary**, not a UI convenience.

⚠️ **`list` membership is EXPLICIT ONLY** (Josh, 2026-08-05). The obvious shortcut is to infer it
from `sent_messages` — the data is already there (`phone_hmac` + `sender_email`, §5.5), so "anyone
I've texted" costs no configuration and was in the first cut. It is wrong: a rep who texts fifty
patients a week would have silently rebuilt `all` under a name promising the opposite, and the
people who text most are exactly the ones who'd choose a narrow list. **Texting, calling, or opening
a patient's thread must never enrol them.** The only way onto the list is
`components/inboundCalls/WatchCallbackButton.tsx` (the bell on a conversation header — placed there
because that's the moment the intent exists) or typing a number into the settings dialog.
`callRules.test.mjs` asserts the `texted` fact does not ring.

> **PHI:** `call_ring_allow` stores the **HMAC**, never the number — same call `messaging.mjs` makes,
> for the same reason. `last4` is a display hint so a rep recognises their own entry; removal keys on
> the HMAC, so the number never travels back. The caller's full number **is** in the SSE payload —
> it goes only to employees whose own rules matched, and the browser needs it to name the patient.

**Caller → patient is resolved in the BROWSER** (`patientLookup.findPatientByPhone`), not the
gateway: the board + phone-column registry is systemMgmt's `BOARDS`, and a server-side copy is
exactly the drift §5.9/§5.10 exist to prevent. ⚠️ It matches on the **last four digits** then filters
by `toE164` equality — boards store numbers in whatever shape they were typed, and the last four are
the only substring present in every rendering (`3475550101` and `(347) 555-0101` share nothing else).

⚠️ **Deliveries are an ENVELOPE, not the shape the docs example shows.** What arrives is
`AccountTelephonySessionsEvent` — `{uuid, event, timestamp, subscriptionId, ownerId, body:{…}}` — and
`telephonySessionId`/`parties` live under **`body`**. The published example is the *inner* payload,
so reading the top level finds nothing and drops every event **while still returning 200**: a webhook
we can't parse is indistinguishable from one that was never sent. That is exactly how this shipped
(33 delivered, 33 acked, 33 dropped, nothing in the logs) and it took Railway HTTP-log forensics to
see. `unwrapEvent` handles it; **`/calls/health` now reports `events:{seen,rings,unparsed,lastAt}`**
so `seen` climbing while `rings` stays 0 names this failure instantly.

**Gotchas that produce a feature which "works" while showing the wrong thing** (all covered by
`callRules.test.mjs`):
- Reps' **outbound** calls raise these events too — filter on `direction === "Inbound"` or every
  click-to-call pops the whole office.
- `from` is the CALLER. Reading `to` keys everything on our own main line, collapsing every caller
  onto one "patient".
- A **claimed** call reports terminal on the original session no matter how it went — forwarding
  tears down the inbound leg. Reading that literally flashes **"Missed"** at the person who just
  took the call.
- **Reconcile the subscription, never blindly create it.** The gateway redeploys on every push to
  `main`; create-on-boot leaves a trail of subscriptions at the same URL and every call fans out
  two, three, five times. ⚠️ **A FAILED pass retries on a short bounded ladder** (2026-08-20,
  `reconcileBackoff.mjs` + tests: 30s · 1m · 2m · 4m · 8m, honouring RingCentral's `Retry-After`
  where that is longer, then the hourly pass takes over and re-arms). Boot-and-hourly used to be
  the whole recovery story, so one throttled lookup cost a full HOUR of the gateway not knowing its
  own subscription — which is what turned a single 429 into six pages. The ladder is bounded
  deliberately: what it recovers from is usually a throttle, and a hot retry loop is how you keep
  one alive. Passes are also coalesced now (hourly tick · retry · `/calls/resubscribe` can land
  together, and two at once would race the delete-the-extras step into deleting the subscription the
  other just adopted).
- **Ack the webhook FIRST**, then do the work — RingCentral retries and eventually blacklists a slow
  endpoint.

⚠️ **One replica is load-bearing** (`cmd ctr server`, checked 2026-08-05). The live-call registry is
in-memory, so a webhook landing on replica A never reaches a browser on replica B. If this is ever
scaled up the fix is Postgres **`LISTEN/NOTIFY`** — `pg` is already there — not a bigger map.

**Every failure mode here is SILENT, so three things watch it** (2026-08-05). A blacklisted
subscription, a revoked permission, a dead gateway, a dropped SSE stream — all of them look exactly
like a quiet afternoon:
1. **`/calls/health` re-queries RingCentral** for the subscription's status rather than replaying
   its own memory of creating one. ⚠️ The `subscriptionId` survives blacklisting **unchanged**, so
   checking that it exists reports health during a real outage; `subscriptionStatus` is the truth.
   The route takes no auth, so it reports counts and `subscriberAges` but **never employee emails**,
   and the RC lookup is cached 60s so a public URL can't drive unbounded RC calls.
2. **`components/inboundCalls/CallStreamStatus.tsx`** — the only thing that tells the affected REP.
   The hook always computed `connected`/`error` and nothing rendered them, so a browser whose stream
   died showed no cards, no error, no clue. A server-side monitor can't cover this: the gateway
   knows how many browsers are attached, not whose tab fell off. Silent while healthy on purpose.
3. **`services/calls-monitor`** — Railway cron (`*/10 * * * *`) → ntfy. Proves the chain up to
   delivery; it cannot prove delivery itself (only a real call does, and we don't place synthetic
   ones into a production line). `faults()` is pure + tested — an alert that stays quiet during an
   outage is worse than none, since it reads as an all-clear. ⚠️ Its ntfy topic is the only thing
   protecting the alerts and is deliberately **not in this repo** — Railway variable only.
   **The "no Command Center browser is connected" check was removed (Josh, 2026-08-17)** — it
   paged every time nobody happened to have a tab open, which is normal, not an outage. `faults()`
   no longer reads `health.subscribers` at all, and the `BUSINESS_HOURS`/`inBusinessHours` gate
   went with it (it existed only to keep that one check quiet outside work hours). The gateway
   still reports `subscribers` in `/calls/health` for humans reading the endpoint directly; the
   monitor just doesn't alert on it. Don't re-add this check without also re-adding some form of
   the business-hours gate, or it'll page overnight again.
   ⚠️ **A null `subscriptionId` is the GATEWAY's memory, never RingCentral's record** (fixed
   2026-08-20). The two fail apart: that memory is per-process and is filled by a reconcile pass
   which can fail for reasons that have nothing to do with the subscription — a **429 on the
   lookup** being the one that happens. So a redeploy plus a throttled first pass read as "no
   subscription" while RingCentral went on delivering webhooks to that very container: six pages
   saying *"no calls will arrive"*, four real calls ringing through, the last of them **one minute
   before an alert**. `faults()` now picks its sentence by what it can actually support — webhooks
   arriving inside `DELIVERING_WITHIN_MS` (20 min) prove the subscription is ALIVE and it says so;
   a stated gateway error means we could not CHECK and it claims nothing; only a null id with no
   reason offered keeps the blunt verdict. The inference runs ONE WAY — no recent events prove
   nothing, since that is just a quiet afternoon. It still reports the fault in every case (a
   gateway out of sync with its own subscription is real); only the verdict changed. An alert that
   declares an outage it has not established is the mirror image of the silence this monitor exists
   to break — it teaches everyone to swipe these away.

**A pin can't ring if the rep's mode is `off`**, and that silent no-op is the likeliest support
question the bell will generate — so `WatchCallbackButton` warns on add and renders the watched-but-
muted state as inert rather than active.

**Every ring is recorded in Postgres — `call_events` + `GET /calls/history`** (2026-08-21). Until
then the only record of a call was the in-memory `calls` registry (dropped by `pruneCalls` after
`KEEP_ENDED_MS`) and Railway's HTTP log, which returns **at most 500 lines per query — about
thirteen minutes** of this gateway's traffic. So "why did this call not reach me last Thursday"
was unanswerable by the time it was asked, and `eventStats` is counters, which cannot describe ONE
call. `recordEvent` appends a row per event — `ring` · `end` · `end_unseen` · `self` · `ignored` ·
`unparsed` — carrying the session, the outcome, how long it rang, and **`audience`: how many
screens it actually reached**, which is the field that separates "their ring rules filtered it out"
(audience 0, subscribers >0) from "nobody had a tab open" (both 0, normal — §5.13's monitor note).
- ⚠️ **HMAC + `last4`, never the number** — the same PHI call `call_ring_allow` and `messaging.mjs`
  make. `last4` is a matching HINT (four digits collide), normalised by **`callRules.last4`, the
  same helper that stamped the column on the way in** — a query that normalised differently would
  silently match nothing.
- ⚠️ **Fire-and-forget, `void`, never awaited.** The webhook acks first (RingCentral blacklists a
  slow endpoint); a dead Postgres must not become a slow webhook, and an audit row is a strictly
  smaller loss than the subscription. Nothing here may throw into `handleEvent`.
- ⚠️ Deliberately **UNPRUNED** — ~260 events/day, under 100k rows a year. An audit table that
  deletes the evidence somebody came looking for is worse than a big one.
**A refused claim speaks English** (2026-08-21). `/calls/claim` used to pass **RingCentral's own
refusal text** to the browser, which is a protocol string — a rep reported it as *"I received an
error code"* (MM-1090) when nothing was wrong: the card was still up, the caller had hung up 0.7s
earlier. `callRules.claimRefusal` (pure, tested) now maps RC **404/409 → 410 + one sentence**
("That call already ended — the caller hung up or somebody else picked it up"), while the raw text
still goes to `call_claims.detail` for `/calls/history`. ⚠️ **Everything else stays 502 with RC's
words**: a throttle, a revoked `CallControl` permission and a dead upstream are real faults, and
flattening them into the reassuring sentence would hide an outage behind a non-event. The client
also treats **404 and 409 like 410** (`IncomingCallHost`) — they are the same verdict caught one
layer earlier, and only 410 was handled, so the gateway's own "no longer ringing" came out as a red
error toast *and* left the dead card on screen to be clicked again.
- `/calls/history` is **authenticated** (`requireCaller`), unlike `/calls/health` beside it: it
  returns employee emails and per-call timing, health returns counts. Bounds + SQL are pure in
  **`callHistoryQuery.mjs`** (+ tests) — same split as `callRules` / `rcAllowlist` — clamped to 90
  days / 1000 rows, and it echoes back the window it *used*, since a silently narrowed window reads
  as "nothing happened". Claims are joined from `call_claims` rather than duplicated, so
  RingCentral's own refusal text still explains a 410 months later.

Files: `services/monday-gateway/inboundCalls.mjs` (subscription lifecycle · webhook · SSE hub ·
claim · prefs · `call_events`) + `callRules.mjs`/`callRules.test.mjs` (pure: which party, who gets
rung) + `callHistoryQuery.mjs`/`callHistoryQuery.test.mjs` (pure: the history query's bounds),
`lib/inboundCalls/callsApi.ts`, `hooks/inboundCalls/useInboundCalls.ts`,
`components/inboundCalls/IncomingCallHost.tsx` (mounted **app-wide** in `App.tsx` — a call arrives
wherever you're working) + `RingPreferencesDialog.tsx` (reached from the Patient Texting header).
Optional env: `CALLS_WEBHOOK_URL` (defaults to `https://$RAILWAY_PUBLIC_DOMAIN/calls/webhook`),
`CALLS_WEBHOOK_TOKEN` (defaults to a value derived from `PHONE_HMAC_PEPPER`, so it needs no new
Railway variable).

> **RingCentral app permissions are TWO, and they fail one at a time** (2026-08-05). `CallControl`
> covers the event filter + the forward; **`SubscriptionWebhook`** ("Webhook Subscriptions") covers
> the *delivery transport*. With only the first you get
> `[SubscriptionWebhook] application permission is required for [WebHook] transport` — the transport
> is checked first, so the event filter's permission isn't even evaluated until that one is granted.
> Production apps may need RingCentral support to enable it.
> **The verification token is truncated to 32 chars**: a full 64-char SHA-256 hex digest is rejected
> with `Parameter [deliveryMode.verificationToken] value is invalid`, an undocumented length limit
> (their OpenAPI spec declares a bare `string`). ⚠️ That same error ALSO means "your endpoint failed
> the Validation-Token handshake", so rule the handshake out first — `curl -X POST <webhook> -H
> 'Validation-Token: x' -i` must echo the header — before assuming it's the value.
> **`POST /calls/resubscribe`** (authenticated) forces a reconcile, so iterating on RC console
> settings costs neither a gateway redeploy nor the hourly wait.

### 5.14 Monitor Purchase Date — the CGM twin of Prior Pump Purchase Date (Aug 2026)
Medicare needs an obtained-date on file to bill CGM sensors (A4239) against a patient-owned
monitor (E2103), exactly as it does for pump supplies against a patient-owned pump. So Welcome
Call + Final Confirm carry **Monitor Purchase Date `text_mm6693sn`** (MM/YYYY text) beside the
existing **Medicare Prior Pump Date `text_mm58k9x9`**, gated the same way — Original Medicare
(`Medicare A&B` exactly, Advantage plans excluded) + product Qty ≠ 1 + a serving that includes the
product. Blank serving is trusted as served, so a column that failed to read can't hide the field
and wipe a collected date. Canonical rule: **`lib/shared/monitorPurchaseDate.ts`** (+ tests).

**⚠️ It AUTO-FILLS, and the pump deliberately does not — don't "align" them.** The pump path
writes the literal `TBD` and makes the rep ask the patient. The monitor stamps a value instead
(Brandon via Josh, 2026-08-13, asked for and confirmed explicitly), in this precedence:
a real **CGM Monitor SoS Last Bill** date → else, if SoS says never-billed, a **rolling
today−24-months** placeholder → else blank. A monitor's reasonable useful lifetime is 5 years
(`sosLookbackDays`), so a two-year-old date sits inside the lifetime, which is what asserts the
patient owns a current monitor. The window is **rolling, not the fixed 05/2024** from the original
request — a hardcoded constant drifts further from "two years ago" every month.
> A value already in the field always wins, so the derivation can never clobber the rep's answer;
> because it keys on emptiness, **clearing the field re-fills it** (Josh's call) — the escape hatch
> is to overwrite, not to blank. It returns `""` once the patient stops being eligible, which is
> what clears the board cell (both stages always write the column). That is one call doing both
> jobs, unlike the pump, which needs a separate clear effect.

**⚠️ Read the PER-PRODUCT SoS columns, never the `Never billed CGM` rollup.** The inputs are
**`boolean_mm5ad9rm`** (CGM Monitor SoS No Billing History) and **`date_mm599gk8`** (CGM Monitor
SoS Last Bill), copied from Insurance `boolean_mm5a6haz` / `date_mm59tx2g` by create-item
automation `7918324247`. The tempting `color_mm3z8rw0` "Never billed CGM" is wrong twice: it's a
Medicare rollup covering **sensors AND monitor together**, and it is only ever written when truthy
so it **can never be un-set** (§10 / audit B5) — a patient whose SoS later came back billed would
keep a fabricated date forever. The per-product columns are rewritten on every Benefits send, so
they self-correct.

Unlike `needsPriorPumpDate` (duplicated per role, kept honest by `priorPumpDate.test.ts`), this
rule is **one shared module both roles re-export**, so they can't drift; the test still pins it
against both roles' own `isOriginalMedicare` / `servingIncludesCgm`. On a **split order** the date
follows the monitor onto the **sensors** half and is cleared on the supplies half — the mirror of
what `medicarePriorPumpDate` does. Both writes ride the verified batch with the Stage Advancer as
`stageColumnId`, which is what guarantees the value is indexed before Final Confirm's advancer
fires the create-item hop to **Subscription `text_mm66werp`**.

### 5.15 Scheduled Calls + the booking path — Calendly owns the appointment (Aug 2026)
A DTC patient can book a 10-minute intake call. **Calendly is the system of record**; the Profile
Send Off board carries a **mirror** — Scheduled Call Time **`date_mm63na19`**, Booking Status
**`color_mm5zrbn3`** (*Scheduled · Unscheduled · Canceled*), Calendly Event URI
**`text_mm63e086`** — written by the **dtc-mm-form** backend and corrected by its Calendly webhook.
The `scheduledCalls` role (`/scheduled-calls`) reads that mirror with an ordinary board query, so
the SPA needs no Calendly credentials and the role counts like any other (§5.8).

**⚠️ The mirror joins on the invitee's EMAIL and nothing else.** `booking.js` `findPatientRow`
looks the invitee's address up against the row's Email column `text_mm1xc140`, scoped to the two
DTC form groups; `handleWebhookEvent` gives up with "no matching row" otherwise, and
`reconcileDay` — the repair for a missed webhook — uses the same lookup. So a patient who books
with a different address than the board holds gets a real appointment that exists in Calendly and
**nowhere else**: the intake page still reads "Not booked", the day grid never lists them, no
reminder fires, and nothing errors anywhere.
> **That is why the booking link is PREFILLED, and why the prefill must not be "tidied away".**
> Both senders append Calendly's `name` + `email` parameters — the form's own embed
> (`index.html mountCalendly`) and the rep's **`components/scheduledCalls/BookingLinkDialog`** via
> **`lib/scheduledCalls/bookingLink.ts`** (+ tests). It looks like cosmetic URL decoration and is
> in fact the only thing holding the patient to the address we know them by. The dialog prefills
> from the patient's row, or — in **email mode only**, never text, where that field is a phone —
> whatever the rep is sending to. It narrows the failure rather than closing it (Calendly lets an
> invitee edit a prefilled field), so the dialog also says so on screen when the row has **no**
> email, which is the case prefill cannot cover.

**There is no "type a new time" path anywhere, on purpose.** The Scheduling API is off on this
account — `POST /invitees` is refused with `invalid_location_choice` for every location shape — so
a locally-entered time could never become a real booking. `/api/intake/book` is kept because it is
correct against the documented API, but is **unreachable**; the form embeds Calendly's page, and a
rep reschedules through **`GET /api/intake/reschedule-link`** → Calendly's own per-invitee
reschedule URL, which swaps the event and fires the webhook that re-mirrors it. What this replaced
was a free-text slot plus a Confirm button that wrote Booking Status = Scheduled: it marked people
scheduled with no Calendly event, so they never appeared in this queue and the call never happened.
⚠️ **Booking Status cannot tell the two apart** and is therefore never rendered as truth —
the form writes `Scheduled` the moment a patient picks a time STRING, before any event exists.
`formatBookedCall(p.scheduledCallTime)` (the Calendly mirror) is the one fact that decides
whether a booking exists, on the intake page and in the day grid alike.

**Counted by CLOCK, not by a follow-up rule** — the only role that is. `remainingToday` is "how
many appointments are still ahead of you today", falling by one as each start time passes, so it
reaches zero at day's end whether or not a single call was made; that is understood and accepted
(Josh, 2026-08-10). Nothing marks a call done. The 9 AM baseline lands before any appointment has
passed, so it captures the day's full total and the live count burns down from it. Keep-in-agreement
(§5.8): `lib/scheduledCalls/workflow.ts` `remainingToday` · `useRoleCounts.ts` · **both** baseline
generators. ⚠️ A **canceled** booking keeps its row, so every one of them filters it out — and a
cancel clears the time column too, since a mirror still showing the old slot is what makes a rep
ring somebody who called off.
> Times are **naive Eastern wall-clock**: Monday stores the date column in UTC and returns `text`
> already rendered in the account's zone, so what comes back IS Eastern and needs no conversion.
> Everything here compares **minutes-in-the-day**, never `Date` objects — building a Date from a
> board value in a UTC container is the bug that had the old form booking people three hours out.
> `minutesOfDay` is anchored at both ends for the same reason: a loose match reads a display
> string like `2:00 PM` as 02:00.

**The ten-minute reminder is `components/scheduledCalls/ScheduledCallHost`**, mounted **app-wide**
in `App.tsx` beside `IncomingCallHost` — a rep is working somewhere else when a call comes due.
⚠️ It is gated to people who actually **hold the role** (`access.type === "processor"` + the role),
so managers deliberately get the queue on the page rather than the interruption — but the page
prints "You'll get a reminder 10 minutes before each call" to everyone, which is a promise it does
not keep for them (or for anyone, in bootstrap mode, where everyone is a manager). Fix the copy,
not the gate. It also fires only while a Command Center tab is open, and announces once per call
per day (`announced` resets at ET midnight, or a tab left open overnight carries yesterday's set
into today and the first morning call goes unannounced).

### 5.16 Patient call history — the "Calls" button in every stage header (Aug 2026)
A **Calls** button sits beside the Call and Text buttons on every patient header and opens the
patient's call history with the MM line: both directions, how long each call lasted, and a player
for any call RingCentral recorded. Pure logic in **`lib/callHistory/callHistory.ts`** (+ tests),
REST in `lib/fax/ringcentralApi.ts` (`fetchPatientCallHistory` / `fetchRecordingBlobUrl`), UI in
**`components/shared/CallHistoryButton.tsx`**.

**⚠️ The call-log `phoneNumber` filter takes DIGITS, not E.164 — a leading `+` returns NOTHING.**
Not an error: **HTTP 200 with an empty `records` list**, which is indistinguishable from a patient
nobody has ever called. `message-store` (SMS + fax) is the exact opposite — it *wants* the `+` —
so `toE164()` output is right for texting and wrong here, on the same API, with no signal either
way. This shipped, and every patient read "No calls with this number in the last year" while the
same window held 13 calls. Verified live: `+17174242514` → 0 records, `17174242514` → 13,
`(717) 424-2514` → 0. `callLogPhoneParam` is the one place that strips it; don't "tidy" it back to
`toE164`. The E.164 form is still what the local re-match and the display use — only the QUERY
differs. (`direction` is deliberately not passed: both directions is the default.)

> **Why the local re-match in `toPatientCalls` still matters:** the shared MM line does ~1000 voice
> calls every three weeks, so client-side filtering of an unfiltered log is not an option (a year
> would be ~17 pages of the whole office's calls shipped to a browser). RingCentral's filter does
> the work; the last-10 re-match is the guard that one patient's card can never show another's call.

**⚠️ `result` cannot be read literally — read the LEGS.** Claiming an inbound call forwards it,
which tears down the original leg, so a call a rep actually TOOK can arrive stamped with a
terminal-looking result. This is the same trap §5.13 documents for the live-call cards, and it
shows up again here: `callConnected` treats *any connected leg* as a connected call. A recording
also hangs off the leg that carried the audio, not the parent, on exactly those calls.

**⚠️ A named result outranks the duration heuristic.** RingCentral reports ring time in `duration`
on some missed calls, so "duration > 0 ⇒ somebody talked" — true for an unlabelled result — turns
an 18-second ring into an 18-second conversation. `MISSED_RESULTS` wins over the fallback; the
fallback exists only for labels we don't recognise. Results are matched **exactly**, never by
substring: "Answered Not Accepted" is a MISSED call that contains "answered".

**Fetched on OPEN, never on render** — the call-log is one of RingCentral's more rate-limited
endpoints and a header renders for every patient a rep clicks through. That's the deliberate trade
behind the button showing no missed-count badge until it's opened.

**Two external dependencies, both of which fail silently as "no data":**
- **`ReadCallLog`** on the RingCentral app record, or the call-log 403s. The SPA names that
  permission in the error rather than surfacing a bare 403 (§5.13 — RC permissions fail one at a
  time and each needs its own diagnosis).
- **`ReadCallRecording`** + recording actually enabled on the account, or the log simply carries no
  `recording` and no Play button is drawn. Absent recordings are the NORMAL case, not an error.

**Gateway allowlist (`services/monday-gateway/rcAllowlist.mjs`)** — split out of `ringcentral.mjs`
so the proxy's security boundary is unit-testable without its express/google-auth-library imports
(same split as `callRules.mjs` vs `inboundCalls.mjs`). Two widenings: `call-log` on the path
allowlist, and recording content on `/rc/fetch`. ⚠️ The two media URL shapes differ in their TAIL —
a fax attachment ends `/content/{attachmentId}`, a recording ends AT `/content` — so reusing the
fax pattern silently 403s every recording. `rcAllowlist.test.mjs` pins both, plus host-suffix
smuggling (`notringcentral.com`, `ringcentral.com.evil.com`).

`PatientContact` (masheke/mmKit) carries the button, so the five headers that already use it get it
for free; the other five render it directly — welcomeCall / finalConfirm / subscription
`PatientInfoCard`, `samantha/BenefitsPatientHeader` (Benefits · Submit Auth · Auth Outstanding) and
`masheke/ConfirmReceiptHeaderCard`. The button self-hides when there's no number on file, so a
header can drop it in unconditionally.

### 5.17 Cardinal address format — checked at Welcome Call + Final Profile Confirmation (Aug 2026)
Cardinal Health orders carry **two** addresses and validate both: the patient's (`shipTo`) and the
**doctor's** (`doctorInfo.address`). The ordering service parses them with its own deterministic
parser and **GATE 1 stops the order** on a hard failure — nothing is sent to Cardinal, the row lands
in *Needs Review* on the orders board, and a human has to reformat the address. That is hours (and a
board hop) downstream of the last stage where the address is still editable and somebody is on the
phone with the patient. So the two stages that can still fix an address now run **the same parse**:
**Final Profile Confirmation** as check-pack checks **C25** (patient address) and **C26** (clinic
address), and **Welcome Call** as an inline note under both of its address fields.

⚠️ **Welcome Call has NO clinic address** — that board reads `doctorName` + `doctorNpi` and nothing
else (`lib/welcomeCall/mondayApi.ts`), so the patient address is the whole of it there. C26 has no
Welcome Call equivalent, and giving it one means adding the column to the read set, the `Patient`
type, the mapping and the form — not a UI change.

**The preset is the whole rule:** `STREET [UNIT] , CITY , ST ZIP [, COUNTRY]` — **the apt/suite
goes on the STREET line** (Josh, 2026-08-18). The parser also accepts a unit as its own comma
segment (it rides on address line 2) and always did, but that is not what reps are taught: telling
them "Street, Apt, City" invites the exact typo below, where the comma lands after the street and
not after the unit. One line for everything before the city has no ambiguous middle at all.
The parse is deliberately faithful — it never abbreviates, reorders, guesses a city from a glued
street, or repairs punctuation. Hard: `EMPTY · MISSING_ZIP · MISSING_STATE · NOT_PRESET` (no comma
before the city) · `MISSING_STREET` (no house number — a clinic NAME on line 1 is the usual cause) ·
`MISSING_CITY` · `UNIT_IN_CITY`. Soft (ships, but says so): `EXTRA_SEGMENT` (an unrecognized middle
line — usually a valid `C/O`) · `PO_BOX` (parcel carriers can't deliver to one).

⚠️ **`lib/shared/cardinalAddress.ts` is a MIRROR of `Cardinal-api/src/address.js` — change one,
change the other.** Same class of hand-synced contract as `oopEstimator.ts` vs the Railway financial
backend (§5.7), and with the same failure mode if it drifts: the rep gets a green page and the order
still stops. `cardinalAddress.test.ts` is ported case-for-case from that repo's
`test/transform.test.js` for exactly this reason — it is the parity suite, not a nice-to-have.
The SPA cannot simply call the service: the ordering service reads the **orders board**
(`18405457690`), which the patient only reaches after Welcome Call → Subscription. At Final Confirm
there is no downstream item to ask about yet.

⚠️ **ONE deliberate divergence, and the DIRECTION of it is the whole argument** (Josh, 2026-08-18).
The SPA copy is **stricter by one rule**: the city slot has to look like a city
(`UNIT_IN_CITY` / the unit-only `MISSING_CITY`). Upstream has no such check, so
`665 Saratoga Rd, Ste 400 Gansevoort, NY 12831` parses there as city **"STE 400 GANSEVOORT"** and
**ships** — no hard flag, no soft flag, nothing on the board. It is the silent-wrong-city class that
repo's own `docs/ADDRESS_VALIDATION.md` records fixing once already (county-as-city, 26 of 101).
Flagging something the service would accept is the SAFE direction — a rep fixes an address that
would otherwise go out wrong. The dangerous direction is us passing what Cardinal refuses, which is
what the keep-in-agreement rule above is for. So keep porting upstream changes in, and **do not
delete this rule to make the two files match**; upstream still has the bug. Live today: it fires on
one patient and one doctor address on each of Welcome Call, Subscription and the Cardinal orders
board — small, and one of them is a real order already placed.

**Severity follows the pack's existing rule** — red = positive evidence the profile is wrong, so a
MALFORMED address is red and a BLANK one is amber (a missing input, like C22's blank DOB). Nothing
blocks Send: red/amber items get the standard per-finding ack in `SendWithChecksButton` and the
override is stamped into Notes, same as every other check.
> ⚠️ **The old `C22_ZIP_MISSING` (amber) is retired** — C25 reports a missing ZIP as HARD, with the
> reason and the required format. Two rows saying the same thing at two severities is how a check
> pack gets ignored.

**The format is shown, not just the complaint** (Josh's ask, 2026-08-18). One renderer does it on
both stages — **`components/shared/CardinalAddressNote`**, driven by `cardinalAddressNote()`: red
with the blocking reason + the required shape, amber for something that still ships, and **silent on
a blank or clean address**. Final Confirm's findings ALSO carry `CheckFinding.formatHint` (the same
`CARDINAL_FORMAT_HINT` string) so the panel and the send dialog print the format too. Don't add a
`formatHint` to a check whose field has no input on the page.
The **Clinic Address field also gained the red/amber ring** the patient address always had; before
this it had no error state at all, because nothing in the app looked at it.

**Neither stage BLOCKS on it.** Final Confirm is warnings-only by design (per-finding ack + a Notes
override stamp). Welcome Call keeps exactly the send gate it already had — `validatePatientForSend`'s
*"Address with zip code is required"*, still its own loose `\b\d{5}\b` regex — so this change can
only ever tell a rep MORE than before, never stop a call they could previously finish. What it did
replace is that form's two zip-only *"Zip code needs to be added!"* lines, which caught one of the
six ways an address fails. ⚠️ If you ever promote the format to a hard gate, do it at Welcome Call
(the rep is on the phone) and expect it to fire on ~6% of patients — see the audit below.

**Why the clinic address is the point of this** — live audit, 2026-08-18, over the real boards:

| Board | Patient address | Doctor / clinic address |
|---|---|---|
| Welcome Call *Completed* (248) | 15 hard | **27 hard**, 23 blank |
| Subscription (745) | 8 hard | **31 hard**, 7 blank |
| Cardinal orders (1151) | 6 hard | **46 hard**, 15 blank |

Repeat the audit with the parser and a board query before changing any of these thresholds — the
numbers, not an intuition, are what decided red-vs-amber and blank-vs-silent.

**Keep-in-agreement:**
1. **The rule** — `src/lib/shared/cardinalAddress.ts` ⇄ `Cardinal-api/src/address.js` (+ both test
   suites), minus the one documented divergence above.
2. **The checks** — `lib/finalConfirm/checkPack.ts` `cardinalAddressFindings` (C25/C26).
3. **The UI** — `components/shared/CardinalAddressNote.tsx` (the inline note on BOTH stages) +
   `finalConfirm/PatientInfoCard.tsx` (both rings), `welcomeCall/WelcomeCallForm.tsx` (both address
   fields), `FinalCheckPanel.tsx`, `SendWithChecksButton.tsx` (the last two render `formatHint`).
4. **Downstream, unchanged** — `Cardinal-api/src/precheck.js` still runs the same parse at order
   time and writes *Address Flag* on the orders board. This stage does not replace it; it stops most
   of what it catches from getting that far.
> **The DTC/CareCentrix intake page runs the parse too, from 2026-08-19** —
> `lib/profile/addressFormat.ts` `addressFormatIssue`, which layers this check UNDER
> `profile/workflow.addressWarning` (zip · `Street, City, ST 12345` · ALL-CAPS) and reports the
> first thing either one finds. It runs there and not on the other Profile Send Off routes because
> that is the stage where an address FIRST EXISTS: the intake form never asks for one, so it
> usually arrives from the benefits check rather than from a rep (§5.19). ⚠️ It is deliberately
> **not** pushed down into `addressWarning` itself — Profile Send Off treats that function's result
> as a readiness **blocker** (`ok: !!address && !addressIssue`), so widening it there would strand
> patients on a page nobody asked to change. The intake page only ever warns (§5.10).
> **The DVS doctor editor** writes these same two columns (`location_mm1xhw17` ·
> `location_mm1xjnfv`) and still does **not** run the check — deliberate scope, not an oversight;
> it is where a manager corrects a clinic address, so it is additive if wanted.

### 5.18 Profile Status — one status vocabulary on every role, every patient view (Aug 2026)
Every stage had its own idea of "what is going on with this patient", and none of them agreed:
masheke reads an escalation **INDEX**, Insurance reads a **LABEL**, Profile Send Off reads a flag
column, three boards call being asleep `Follow Up = "Done"` while Insurance calls it
`Follow Up = "Follow Up"` with a **blank date** — and being Stuck is not a column at all, it is
which **GROUP** the item sits in. A manager on a role page could not tell whether anybody was
working the patient. **Profile Status** collapses all of it into six words that mean the same thing
on every page. Canonical rule: **`lib/shared/profileStatus.ts`** (+ tests); looks:
`components/shared/ProfileStatusBadge.tsx`; per-board wiring:
`components/shared/PatientProfileStatus.tsx`.

**Precedence — first match wins, and it is the order Josh defined them in.** A patient is routinely
eligible for several at once, so the order IS the rule:

| # | Status | Fires when |
|---|---|---|
| 1 | **Stuck** | the item is in a board's **Stuck group** (`STUCK_GROUP_IDS`) |
| 2 | **Proposed Stuck** | Escalation index **2**, "Final Escalation Required" |
| 3 | **Escalated** | Escalation index **0**, "Manager Escalation Required" |
| 4 | **Paused** | parked with no clock that will wake them up — see below |
| 5 | **Waiting** | Next Action / Follow Up **Date in the future** (ET) |
| 6 | **Active** | everything else |

⚠️ An escalated patient snoozed to next Tuesday is **Escalated, not Waiting** — the manager flag is
the fact somebody must act on, and a date must never hide it.

**Paused has four routes in**, and they share one property: *no date will return the patient on its
own.* (1) **Already In System** (§5.10). (2) **Doctor Appointments outreach** — Sub-Stage
`Doctor Appointment` (§5.12). (3) **A booked visit that hasn't happened** — Appointment Date
today-or-later; a visit in the **PAST is NOT paused** (Josh, 2026-08-19: the chase is live again,
and `snoozeUntilAfterAppointment` floors those patients at today precisely so they are due now).
(4) **A dateless sleep** — Insurance's blank-date `Follow Up`, and `Follow Up = "Done"` on Profile
Send Off / Welcome Call / Final Confirm. ⚠️ Those three were the surprise in the audit: Josh's
assumption was that only Welcome Call could "sleep" a patient. `isSnoozedFollowUp`'s *"a dateless
Follow Up stays snoozed until cleared"* is an **indefinite** snooze, and Verified Referrals + Already
In System use `"Done"` the same way. They read **Paused rather than Waiting** (Josh, 2026-08-19)
because Waiting promises a date that will bring the patient back and here there isn't one.

**Two populations get NO badge (`null`), and the asymmetry is deliberate.**
- **Completed** — checked **FIRST, above Stuck**, so a stale escalation label on a finished item
  can't resurrect it. Search's completion badges deep-link into finished stages (§7), so role pages
  really do render these; a live-looking badge would be a lie.
- **Auth Denied** — checked **LAST**, and it only suppresses *Active*. The stage is deliberately
  unbuilt (§7), so there is no honest Active story — but **any denial escalates**, and an escalated
  denied patient is live manager work, so rungs 1–5 still report. Completed means "nothing here is
  actionable"; Auth Denied means "the patient is live, this stage just has no UI yet".

⚠️ **`STUCK_GROUP_IDS` / `COMPLETED_GROUP_IDS` are hand-maintained lists of group ids, i.e. exactly
the §5.10 bug class.** Monday **reuses group ids across boards** — `group_mm1xyczx` is Stuck on
Medical Evaluation AND Welcome Call AND Profile Send Off, while `group_mkp19fyp` is "Bad Debt" on
Secondary Claims and "Not Active Patients" on Subscription — so one id can only be trusted while
nothing outside the set shares it. `profileStatus.test.ts` asserts both sets against the live
`BOARDS` registry **in both directions**, and fails if a board grows a Stuck group that isn't listed
or if a listed id names a working group somewhere. That check is the point.

**Reads added to make the rule honest** (all purely additive — no write path touched):
- `group { id }` on every patient query on all five board slices, plus `groupId` on each `Patient`.
  Without it Stuck can never fire, silently.
- **Welcome Call + Final Confirm + Subscription** now read their escalation column into a new
  `escalationIndex` field. ⚠️ Deliberately **NOT** wired into `escalated`, which those three
  hardcode to `false` — that is the write-only escalation §10 says needs a **rewrite, not a
  piecemeal patch**. Profile Status is the only consumer; sidebars and role counts are unchanged.
  Without this read an escalated Welcome Call patient's badge would inherit `escalated: false` and
  read Active.
  The label TEXT is read alongside the index, because those two boards' indices are inferred from
  §10 rather than observed: `escalationRung` takes the index first (a rename can't blind it) but an
  **unrecognised** index falls through to the label instead of reading Active. ⚠️ Monday assigns a
  status index when the label is *created* and takes the lowest free slot, **not display order** —
  §5.12's Sub-Stage `Doctor Appointment` landed on **0** while that column's siblings start at 8 —
  so a board whose escalation labels were created in another order would otherwise mark escalated
  patients Active silently. Index **1 ("Done")** is the one index that stops the search: it is a
  positive "not escalated" and must beat a stale label.
- ⚠️ **Final Confirm reports Paused only via an appointment or the group** — that stage reads no
  Follow Up column at all (no `COL` entry, no field), and its role count is escalation-only
  (`useRoleCounts`: *"finalConfirm group (not escalated)"*). The badge matches the app rather than
  inventing a snooze the stage doesn't have.
- ⚠️ On Welcome Call the badge now agrees with the **burndown** and disagrees with the **sidebar** —
  which is the correct side. `useRoleCounts` already reads `color_mm1x7997` off the board while
  `sidebarSections` keys on `p.escalated`, hardcoded false; that disagreement is §10's, and Profile
  Status reads the board.

**Where it renders** — the patient header on every role page, via one of five board wrappers in
`PatientProfileStatus.tsx` (`Masheke` · `Insurance` · `Intake` · `WelcomeCall` · `Subscription`), so
a header is a one-line change and can never pick the wrong adapter:
`masheke/PatientProfileCard` (Evaluate) · `masheke/SendRequestHeaderCard` (Send Request · Confirm
Receipt · both Chase · Doctor Appointments) · `samantha/BenefitsPatientHeader` (Benefits · Submit
Auth · Auth Outstanding) · `samantha/PatientProfileCard` (DVS) · `welcomeCall`/`finalConfirm`/
`subscription` `PatientInfoCard` · `ProfilePage` (Verified Referrals · Already In System) ·
`UnverifiedReferralsPage` · `UpdateClinicalsPage`.
⚠️ **Patient Intake passes `ignoreFollowUp`**, mirroring the flag the page already hands
`sidebarSections` (§5.10): that queue's Follow Up pair is a one-way door nothing reads, so honouring
it would report **Paused** for a patient sitting in everybody's sidebar.
**System Management → Search** renders it too, via `systemProfileStatus`, replacing a flat "ACTIVE"
pill that was true of everything the row could ever be. ⚠️ That projection spans seven boards and
carries only the inputs that generalise — **no Sub-Stage, Appointment Date, Already In System or
Follow Up** — so a Search row can read **Active** for a patient the role page calls **Paused**. It
is a NARROWER read, never a contradictory one, and the test pins that. Widening it means adding
those columns to `BOARDS`' per-board read set, not special-casing the adapter.

**Not wired, deliberately:** *Scheduled Calls* has no patient view of its own (rows deep-link to
`/unverified-referrals`, which has the badge); *Patient Questions*, *Patient Texting* and *Fax
Inbox* are message/lookup surfaces, not pipeline stages — Patient Questions in particular spans
Secondary Claims, which is not a stage in the Active list at all.


### 5.19 The benefits-check address — filled in, repaired where possible, flagged where not (Aug 2026)
The DTC intake form never asks for an address (§5.10), so on `/unverified-referrals` the **benefits
check is usually where one first appears**: a successful Stedi run carries the payer's mailing line
in **Stedi Address `text_mm5fqm4s`**, and the page pours it into the empty Address field
(fill-when-blank, keyed on the columns rather than the run, so a patient re-opened days later still
gets it). Josh, 2026-08-18: *VERY IMPORTANT*. Brandon, 2026-08-19: it must also **say what it is**.

**Two shapes arrive, and the app used to accept both in silence.** Audited over the 22 Stedi
addresses on the live board (2026-08-19): **7 carried an extra middle comma segment**, and **not
one of the 22 raised a warning of any kind** — `addressWarning` accepts three-or-more segments, and
`checkCardinalAddress` accepts a unit on address line 2. So:
- **`9 BRENTWOOD RD, APT 6 A, BAY SHORE, NY 11706`** — the apt on its own line. That is not the
  preset reps are taught (§5.17: *Street + Apt/Suite on ONE line*), but where the unit belongs is
  **not a guess**, so `foldUnitOntoStreet` moves it onto the street line at fill time. This is the
  "have it match the format" half of the ask.
- **`20 Thornton Ave, C/O Julie Vanfleet, Auburn, NY 13021`** — a middle segment that is somebody's
  NAME. The fold refuses it (guessing where a name goes is what puts a parcel at the wrong door)
  and `addressFormatIssue` reports it instead, in Cardinal's own words plus `CARDINAL_FORMAT_HINT`.

**Plus a provenance prompt, which is the other half of the ask.** An address that is still the
payer's line and has never been confirmed shows *"Not confirmed with the patient — re-pick it from
the address suggestions"* beside the field, and an amber **Address not confirmed** block in *Ready
to Advance?* (only when no format complaint is already showing there — a rose "Address won't ship"
says the same thing louder). ⚠️ **The durable half of that test is the MAP PIN, not a render flag.**
A Places pick always sets lat/lng; the benefits-check fill deliberately never does (a payer gives a
line, not coordinates, and a wrong inherited pin is worse than none). So the condition is *no pin
AND the text still matches Stedi* — it survives a reload, a patient switch and a re-open, and
re-picking from the suggestions is exactly what clears it. A session-scoped `stediFilled` flag
would have gone quiet the moment the rep clicked another patient.

Canonical logic: **`lib/profile/addressFormat.ts`** (+ tests, whose fixtures are the real board
values). ⚠️ **Warnings only** — the intake stage's exits stay open by design (§5.10), and this must
never become a gate there. `isUnitSegment` is imported from `shared/cardinalAddress` rather than
re-implemented, so the fold and the parser can't disagree about what a unit is.


### 5.20 Patient Intake split in two — Info Collection · Profile Clean-Up (Aug 2026)
The DTC/CareCentrix intake page was **one page with two panes**: the left one collected what the
patient told us, the right one (Patient Profile Clean-Up) sat **blurred behind a lock** until
`evaluateUnlock` passed. Masani does a run of info-collection calls and cleans the profiles up
later, so those are two jobs, not two halves of one screen. **The lock became a STAGE BOUNDARY**
(Josh, 2026-08-19): the same conditions now enable an **Advance** button, and passing it moves the
patient to another group and another role. Canonical rule: **`lib/profile/intakeSubStage.ts`** (+ tests).

| | Info Collection | Profile Clean-Up |
|---|---|---|
| role id | **`unverifiedReferrals`** (unchanged) | **`intakeCleanup`** (new) |
| label | Non-Referral Intake — Info Collection | Intake — Profile Clean-Up |
| route | `/unverified-referrals` | `/profile-cleanup` |
| queue | the two DTC form groups | **`group_mm6c3rhb`** "Profile Clean-Up" |
| panes | LEFT ONLY — the right one isn't blurred, it isn't rendered | left + right, right always open |
| partial/completed selector | yes | no (one group — once advanced, which form group they came from is history) |
| exit | **Advance** → Clean-Up | Advance to MN (unchanged) |

⚠️ **The id follows the QUEUE, not the screen.** Clean-Up is the half that looks like the old page,
but `unverifiedReferrals` stayed with the half that kept reading the form groups — so no patient
changed bucket on deploy day and every `access.json` assignment kept working. The new id has to be
assigned by an admin in `/access`, or the second bar never appears.

**Two board changes, no new automation.** New group `group_mm6c3rhb`, and one new status column
**Intake Sub-Stage `color_mm6ct431`** — the advancer, which `executeWritesWithVerification`
*requires*: without a stage column to hold back there is nothing to verify against and the advance
fires unverified. ⚠️ **Its indices are `Info Collection` = 7 and `Profile Clean-Up` = 1**, not 0/1 —
the column was created asking for 0 and 1 and Monday assigned its own slots (§5.12's trap; read back
from `settings_str`, and Monday drops a write to a non-existent index **without erroring**).
The SPA does the group move itself rather than via a "status → move item" automation like
**7922049614**, because an automation adds an async window where the sub-stage says one thing and
the group says another. Verified first: **7917676280** (Move to Onboarding → create the Masheke item)
is board-wide with **no group condition**, so a new group cannot break Advance to MN.

**⚠️ THE GROUP IS THE QUEUE MARKER, THE COLUMN IS THE RECORD — and the order follows from it.**
`advanceToProfileCleanUp` writes every left-pane column, reads them back, fires the sub-stage
advancer, and moves the item **last** (`advanceToProfileCleanUp.test.ts` pins all three). If the move
fails the patient is still in a form group, so they are still in the rep's **own** sidebar with the
button that retries — and the error says exactly that. Keying membership off the column instead would
hand a half-advanced patient to a queue whose group they aren't in. Nothing but this app writes the
column, so unlike Already In System (§5.10) there is no "arrived with it blank" case to tolerate.
The Advance gate is `unlock.unlocked` **alone** — `readyMissing` counts the right pane's work, which
is the stage this button hands the patient *to*, so requiring it would make the queue unexitable.

⚠️ **The network answer is SHOWN, never gated — and `Unknown` is not a `No`** (Josh, 2026-08-25).
`evaluateUnlock` used to carry a fourth condition, *"Plan is in-network"*, hinting *"Out-of-network —
this needs escalation, not an advance"*. Both halves were wrong for whole populations. **In Network?**
`text_mm1xehx8` is written by `stedi-monday-integration` and does not always carry an answer: a 271
for **Original Medicare A&B** has no network indicator at all (fee-for-service Medicare has no
network — only supplier participation), so the column comes back the literal string **`Unknown`**.
The old boolean read anything-that-isn't-Yes as a No, so the readout printed **No** and the gate then
stranded the patient on a condition that could never pass — the same dead end §5.10 records reversing
for Verified Referrals. Reported on **Thomas Swan** (`12895859856`), Medicare A&B, DMERC Region C.
A board scan the same day found the column held **Yes ×2 and Unknown ×9 across 500 rows — not one
real negative had ever been written**, so the gate had only ever fired on missing data.
Canonical rule: **`lib/profile/intakeUnlock.ts` `networkAnswer`** (+ tests) — four states
(`yes · no · unknown · none`), and ⚠️ an **unrecognised** value is `unknown`, never `no`: a string we
have no rule for is a missing answer, and reporting it as a negative is the bug itself.
`inNetwork()` survives as `networkAnswer(p) === "yes"` and now drives **only** the readout's green
Yes. ⚠️ The readout is **`networkLabel`**, in the same module, and it prints an unrecognised answer
**VERBATIM** (Josh, 2026-08-25) — the board's `Unknown` included, and equally whatever the service
writes there next. Substituting our own word is a smaller version of the same bug: the rep loses what
the payer actually said, and a column that grew a new vocabulary announces itself to nobody. Only
`yes`/`no` are normalised to Yes/No, and a blank is `—`. That field deliberately does **not** go
through `stediYesNo`, which is a two-state helper and still correct for **Active**.
⚠️ **Coverage being INACTIVE still blocks** — that is a real, answerable fact about the patient and
re-running the check is what clears it. Only the network condition was removed.

**Propose Stuck is the SAME system on both** (Josh, 2026-08-19 — "doesn't matter if they came from
either of the new roles"). Same ladder, same modal, same manager decisions. ⚠️ Which is why
`EscalationCard` (the `StageActionBar`) was **extracted to one component rendered on both panes**:
it lived inline in the right pane, i.e. exactly where Info Collection stopped rendering, so a manager
arriving from an Oversight column would have lost Approve Stuck and Send back to pipeline. The rep's
own Propose Stuck sits in the exit row and would have masked it — the affordance a PROCESSOR uses
survives, the one only a MANAGER uses does not.

**Buttons** (Josh, 2026-08-19): the exit row's **"Save to Monday" is now "Save and Finish Later"**
and gives up the green (`.btn primary` → `.btn secondary`) — the row gets exactly one primary action,
and **Advance** takes the green because it is the button to press. Advance **saves on the way
through**, which a Save-then-Advance pair could never guarantee: the save is what gets verified
before the advancer fires. The old "Go to Profile Clean-Up →" scroll link survives on Clean-Up only.
The `.locked`/`.lockover`/`.lockmsg` CSS layer was **deleted**, not left unused — a blur rule nothing
sets is an invitation to re-lock a pane the app has no way to unlock.

**Keep-in-agreement (§5.8 counting contract) — 12 places.** A group that isn't added everywhere makes
patients **invisible**, not wrong:
1. **Role registry** — `config.ts` `ROLES` · 2. **Route** — `App.tsx` (`lazyWithReload`) ·
3. **Role counts** — `useRoleCounts.ts` `PROFILE_CLEANUP_GROUP_ID` ·
4. **Baseline (build)** — `scripts/snapshot-baseline.mjs` `countProfile` ·
5. **Baseline (cron)** — `services/baseline-cron/index.mjs` `countProfile` ·
6. **Oversight** — `oversightApi.ts`: its own ROW of three charts (`profile-send-off-cleanup` /
   `-escalated` / `-stuck`), their `CHART_FILTERS`, the `intake` section's chart lists, **and the
   board-groups fetch list** — miss that last one and every chart reads a permanent 0 ·
7. **Chart routes** — `OversightTab.tsx` `CHART_ROUTES` (all three → `/profile-cleanup`; sending a
   manager to `/unverified-referrals` shows them the left pane alone) ·
8. **Search** — `systemMgmt/mondayApi.ts` `groupRoutes` ·
9. **Profile Status** — `shared/profileStatus.ts` (neither Stuck nor Completed; its bidirectional
   test fails otherwise) · 10. **`fetchDtcFormLeads`** — a twin that has advanced is still a twin,
   so the flag on `/profile` would go quiet exactly when the twin starts being worked ·
11. **`scheduledCalls/mondayApi.ts` GROUPS + both baselines' `PROF_SCHED_GROUPS`** — the unlock gate
   accepts "Send request now" with no intake call, so a patient can hold a real Calendly booking and
   still be advanced; reading only the form groups would drop that appointment and its 10-minute
   reminder with nothing erroring (§5.15) · 12. **`columnExclusivity.test.ts`** — the new group joins
   the intake partition.

Clean-Up needs its **own** escalated + proposed-stuck charts, not bars folded into Info Collection's:
an escalation raised there would otherwise match no chart, and a state that matches no chart is
invisible app-wide (§7). ⚠️ `sortByAttempts` is **Info Collection's only** — least-tried-first exists
because that queue is a calling queue with no snooze (§5.10); on Clean-Up the attempt count records
calls made in the *previous* sub-stage and orders nothing, so the list keeps Monday's order (oldest
first). `ignoreFollowUp` holds on both: neither has a snooze.

**Provided Doctor Info falls back to the referral for CareCentrix** (Josh, 2026-08-21) —
`lib/profile/referralDoctorInfo.ts` (+ tests). That card reads two columns the **DTC web form**
owns (Provided Doctor Name `text_mm5z586h` · Provided Clinic Phone `text_mm5zjh88`). A CareCentrix
patient never fills that form in: they arrive through the **Manual Patient Intake Form** on DTC
Intake (board `18392794310`, view `231897594`), whose create-item automation writes the doctor into
the **VERIFIED** columns instead — so the card rendered EMPTY for exactly the patients whose doctor
we already knew, with the values one column over on the same item. The two populations are disjoint
(every other item in the form groups is Referral Source "Patient", verified columns blank), so the
fallback can't shadow anybody.
⚠️ **DISPLAY ONLY — do not fold it into the `Patient` object.** `intakeEditsFor` passes
`formProvidedDoctorName`/`formProvidedClinicPhone` back on EVERY save, so a merged fallback would
write the verified doctor into the "as provided" columns — and Select Correct Provider can change
the verified doctor later, which would then overwrite the as-provided record with the corrected one
and lose the discrepancy the two column sets exist to show (`unverifiedWrite.ts` §2).
⚠️ The clinic slot falls back to **Clinic Address and then Doctor Phone**, not Clinic Address alone:
of the doctor block only **Name and Phone survive the board hop** (the automation copies 10 columns
in total — Doctor Name · Doctor Phone · Pt. Phone · Email · DOB · Gender · Member ID 1 · Referral
Source · Request Type · CGM Type). Clinic Address is filled in later, by Select Correct Provider, so
address-only would leave the field blank on precisely the fresh referral this exists for.
**⚠️ THERE ARE TWO MANUAL INTAKE FORMS AND ONLY ONE OF THEM IS LOSSLESS.** Both feed this queue,
so a patient's data completeness depends on which one somebody happened to open (audited
2026-08-21).

| | **Intake Form** — USE THIS | **Manual Patient Intake Form** — lossy |
|---|---|---|
| lives on | **Profile Send Off** (view `246988391`, owner Brandon) | DTC Intake `18392794310` (view `231897594`) |
| writes | this board's own columns, **directly** | DTC Intake's columns, then a create-item automation copies **10** of them here |
| clinicals file | **arrives** (`file_mm1w5vwp`) | dropped |
| lands in | 1. Intake → automation **7921666432** moves Referral Source `CareCentrix` to New Form — Completed | same automation, same move |

The lossless one is how real CareCentrix referrals arrive: **`ccx-pdf-intake`** (Railway) logs into
the CareCentrix portal Mon–Fri at 10am/12pm/3pm/6pm ET, downloads the accepted referral's documents
and posts them to Slack; a person then fills the Intake Form, PDFs attached. Monday records it as
`create_pulse` with **`"source":"form"`** and the view id — that is how you tell the two paths apart
on any item. (`ccx-monitor-ashburn` in the `ccx-2` project only accepts referrals in the portal; it
holds no Monday credentials and creates nothing.)
> The DTC Intake form's automation copies exactly: Doctor Name · Doctor Phone · Pt. Phone · Email ·
> DOB · Gender · Member ID 1 · Referral Source · Request Type · CGM Type. It **drops** Patient
> Address, Primary Insurance, Doctor NPI/Email/Fax, Clinic Name/Address, Doc Preferred Method, Key
> Clinic Contact, the clinicals file and Additional Intake Comments (the last two have no
> destination column here at all). Left as-is deliberately (Josh, 2026-08-21) — the fix is to use
> the Profile Send Off form, not to widen the automation.

**The Intake Form asks for the benefits-check columns directly, from 2026-08-21.** General
Insurance `color_mm24ap4j` and the working Member ID `text_mm4t8gbq` are the whole Stedi input
(§5.11). Until that day the form collected **Primary Insurance** `color_mm1xg10n` and **Member ID 1**
`text_mm1x2qk2` instead — different columns, not what `useStediRun` sends — so every CareCentrix
patient was typed in twice (NATIVIDAD GONZALEZ `12854183914`: a rep hand-set both before pressing
Run). The two real inputs were added and the two look-alikes hidden; Email `text_mm1xc140` was
already on the form but hidden, and was unhidden the same day (it is the join key for Calendly
bookings, §5.15, and for `IntakeMessages`).
> ⚠️ **Hiding Member ID 1 is safe; hiding Primary Insurance costs a confirm.** The Clean-Up pane
> seeds `verified.memberId1` from `workingMemberId` and `writeVerifiedInsurance` writes it on save,
> so the "Member ID 1" readiness row still passes. Primary Insurance has no such backfill — it is
> filled by `primaryInsurance.ts`' suggestion engine *after* the benefits check, for the rep to
> confirm. **Serving is unaffected**: its auto-fill reads `primaryInsurance || generalInsurance`, and
> the form now supplies the second.
> ⚠️ **Add form questions in Monday's form editor ("add existing column"), never over the API.**
> `update_form_question` answers `Block not found` for a column the form has never carried, and
> `create_form_question` takes no column id — it would mint a **duplicate** board column instead of
> binding to the real one. Verify a binding by the question's key in the view's `settings_str`: it
> IS the column id.

⚠️ **Serving `color_mm1w1cm9` is on neither form** and is a readiness row. It is auto-derived on the
page (`canCrossSellCgm` × Request Type → `deriveServing`, fill-when-blank), and the board's CGM
Cross-Sell column wins over the payer guess when set — which a create automation sets — so it lands
on its own for the ordinary referral. Nothing types it in.


### 5.21 DTC form leads get a duplicate check — completed filed, partials flagged (Aug 2026)
The `duplicate-patient-check` webhook (`josh-monday-automations` on Railway) fires on **every**
create on Profile Send Off, but it gated on the group and accepted only **1. Intake** and **Already
In System** — so a patient who filled the DTC form was **never duplicate-checked at all**. That was
recorded in that repo's own `DUPLICATE_ANALYSIS.md` under Known gaps, and the Railway logs said it
outright on every submission: `created in group group_mm5z87zt … — ignoring`.

⚠️ **A blank result column did NOT mean "checked and clear".** When the check runs and finds
nothing it *writes* `Already In System = No`. Blank meant it never ran — which is why the gap sat
there unnoticed. Both new paths preserve that property by stamping something on every outcome.

The two form groups now come in at **two different depths** (Josh, 2026-08-19):

| | New Form — Completed | New Form — Partial Leads |
|---|---|---|
| check runs | yes | yes |
| Claude write-up (notes, docs, diffs) | yes | **no** |
| writes `Already In System` | **yes** | **NEVER** |
| result of a match | filed → board automation **7922049614** moves them to Already In System | a pill in the Command Center; patient stays in the calling queue |

**⚠️ `Already In System` is not a flag, it is a MOVE.** Automation 7922049614 is board-wide with no
group condition, so one write of "Yes" takes the item out of the form groups — off Info
Collection's queue entirely. That is the whole reason partials get their own path: an abandoned
form is a lead to ring, not a filing decision. `FLAG_ONLY_GROUPS` in
`automations/duplicate-patient-check.js` is the single switch that keeps that column out of the
partial branch, and `test/dtc-form-groups.test.js` pins it.

**The SPA pill reads the VERDICT column, not the flag** — `lib/profile/dupCheckFlag.ts`
(`isAlreadyInSystemResult`) off **Dup Check Result `color_mm65tv1m`**, rendered in the patient
header on the intake page. ⚠️ Reading `alreadyInSystem` there would render a pill that is
**permanently absent for exactly the patients it exists for**, because partials are deliberately
never filed — and nothing would error. `"New"` (checked, clear), `"Check failed"` and
`"Needs review"` are deliberately not flagged; the last belongs to the Already In System queue,
which has its own role and its own banner.

**Labels are pinned to the board.** A status write with a label the board doesn't have is rejected
outright — a silent production failure until somebody reads the logs — which is what that repo's
`write-scope.test.js` asserts. The partial path therefore reuses the existing **`Duplicate`** label
rather than adding one; what distinguishes it from an analysed duplicate is that the item is still
in the partial-leads GROUP and the Analysis column beside it is empty. Don't "fix" this with
`create_labels_if_missing` — that defeats the test.

**Still not covered:** the check never searches Profile Send Off itself (its five boards are
Medical Evaluation, Insurance, Welcome Call and the two Subscription boards), so a form twin of a
patient sitting on the *same* board is invisible to it. That case is the SPA's own read-only
`dtcFormFlag` (§5.10), and the two are independent.


### 5.22 Serving ↔ order lines — Pump Qty and the Next Order Dates (Aug 2026)
Two August incidents, **one shape**: the **Serving** label and the per-product columns are allowed
to disagree, and whichever one a downstream writer happens to key off decides what the patient
actually receives. Canonical rule: **`lib/shared/servingLines.ts`** (+ tests, whose fixtures are the
two real board rows).

- **Bradan French (WC item `12676537026`), 2026-08-03 — a pump shipped that shouldn't have.**
  Serving was `Supplies + CGM` (patient already owns the pump), but the Welcome Call save wrote
  **Pump Qty = 1**. Final Confirm passed, and Cardinal order `1119501795` shipped a t:slim at
  **$3,787.83** the next morning; caught 8/20, return opened 8/21.
  ⚠️ **`servingIncludesPump()` is TRUE for anything containing "supplies"** — correctly, since
  infusion sets and cartridges *are* pump supplies — so the Pump & Infusion section (and its live
  Pump Qty toggle) renders for supplies-only patients. **Selling a pump and shipping supplies for a
  pump the patient owns are different questions.** `servingSellsPumpDevice` (`/pump/i`) is the
  second one; never gate Pump Qty on the first. The only rule that had looked at this,
  `C14_PUMP_QTY_ON_CGM`, fired on `serving === "CGM"` **exactly**, so both `Supplies …` labels — the
  precise population that already owns a pump — were its blind spot.
- **Leann Austin (WC item `12740990902`), 2026-08-10 — a reorder was missed.**
  Serving said `Insulin Pump` (no CGM) while CGM Type was `Dexcom G7` and Subscription Type was
  `Sensors & Supplies`. `resolveNextOrderWrite` keys off **Serving alone**, read "CGM not served",
  and **wrote blank** to Sensors Next Order Date — which carried to Subscription empty, so nothing
  scheduled the reorder. A 2026-08-21 board scan found **28** patients on a Sensors subscription
  with a blank Sensors Next Order Date.

**A line is "served" here on the UNION of the evidence** — Serving, the product type column, the
Subscription Type and the quantity each get a vote. That is deliberately wider than what the write
paths use: the point is to notice when they disagree, which is exactly what neither stage could see.

**The gate is the affordance; the coercion is the guarantee.** `coercePumpQty` runs in **all three**
send paths (`welcomeCall/mondayWrite` ×2, `finalConfirm/mondayWrite`), because a value already on
the board — or one set before Serving was corrected — still reaches the send otherwise, which is
how Bradan French's `1` survived a Welcome Call save AND a Final Confirm send. Serving is trusted
only when **KNOWN** (blank ⇒ leave alone), the same contract `finalConfirm/mondayWrite` already uses
for the next-order-date clears and `needsPriorPumpDate`/`needsMonitorPurchaseDate` use for their
fields — a column that failed to read must never silently disable a control or drop a real sale.
⚠️ Safe on splits: `getSplitOverrides` gives the supplies half a coherent Serving (an
`Insulin Pump + CGM` original keeps **`Insulin Pump`**, so its pump survives) and the sensors half
`pumpQty: ""`, on which the coercion no-ops.

**Three new Final Confirm checks, all RED** (`checkPack.ts`) — red because each is positive evidence
the profile is wrong, not a missing input, and each one has already cost real money or a real order:
| ID | Fires when |
|---|---|
| **C27_PUMP_QTY_WITHOUT_PUMP** | Pump Qty > 0 and Serving names no pump. Runs on split profiles too. |
| **C28_SERVING_EXCLUDES_SERVED_PRODUCT** | Serving EXCLUDES a family the product columns / Subscription Type say we ARE serving. One-directional: the inverse is already C14. |
| **C29_NEXT_ORDER_DATE_MISSING** | A served line's Next Order Date is blank. One finding per line. |

`C14_PUMP_QTY_ON_CGM` kept its infusion-quantity half and **gave up its pump half to C27**, which is
strictly wider — two rules on one fact at two severities is how a check pack gets ignored (§5.17).

**Keep-in-agreement:**
1. **The rule** — `lib/shared/servingLines.ts` (+ tests).
2. **The gates** — `welcomeCall/WelcomeCallForm.tsx` (Switch disabled + zeroing effect) ·
   `finalConfirm/PatientInfoCard.tsx` (Input disabled; read-only rather than self-correcting,
   because Serving is editable right there and *that* is the fix).
3. **The guarantees** — `welcomeCall/mondayWrite.ts` (both writers) · `finalConfirm/mondayWrite.ts`.
4. **The checks** — `finalConfirm/checkPack.ts` C27/C28/C29.
⚠️ Welcome Call's own send gate (`validatePatientForSend`) is deliberately **unchanged** — this can
only ever tell a rep MORE than before, never stop a call they could previously finish (§5.17's rule).

### 5.23 The insurance step — one card answers it, and no card parks the patient (Aug 2026)
Step 5 of the DTC intake form (`mm-track-widget/intake-form.html`, mirrored as the dtc-mm-form
repo's `index.html`) offered three answers and mishandled two of them. Josh, 2026-08-21.

**A card photo is now the WHOLE answer.** Uploading one used to hand the patient on to *"Who's your
insurance with?"*, then *"A couple more details"* (member ID), then step 6's *"Good news — we're in
network with Anthem or Blue Cross Blue Shield"* — three screens asking for, or asserting, things
that are printed on the card they just sent. The photo path now goes straight from the confirmation
to step 7, **"Ready for us to contact your doctor?"**. `leaveInsuranceStep()` is the one place that
decides: `go(7)` for a card answer, `go(6)` for the manual path — which keeps the in-network screen
because that is the only path where a carrier was actually named. `completedBack()` is its mirror,
so Back never lands somebody on a screen they were never routed through.

**"I don't have it on me" is a PARK, not an answer.** It used to count as complete: the patient
walked to the confirmation screen, landed in *New Form — Completed*, and read a banner asking them
to text a photo to a care navigator — which nothing tracked and nobody chased. Now:
1. `parkForInsuranceCard()` POSTs **`/api/intake/insurance-link`**, which upserts the partial lead,
   mints an **`insurance-card`** upload link and texts + emails it.
2. The screen says *"No problem! We're sending you a link so you can upload your insurance
   information whenever you have it"*, with a **disabled Continue**.
3. The row stays a **partial lead**. Nothing advances.
4. When the card lands on **Insurance Card Photo `file_mm5zhy1`** — by the texted page, by the
   form's own uploader, or by a rep attaching one — Continue opens and step 7 is asked as normal.
   Submitting then promotes them to Completed exactly as any other patient.

**Upload links have a KIND** (`server/src/uploadLink.js` `UPLOAD_KINDS`). `cgm` is the original rep
link (§8.3, `file_mm5zhsxh`, 24h); `insurance-card` is this one (`file_mm5zhy1`, **90 days** —
"whenever you have it", and a parked patient has no automated route back if it dies).
⚠️ The kind is **inside the signature** and `/api/upload/:token` takes its destination column from
`verifyToken`, never from the request — so no link can be re-aimed at the other column. ⚠️ The
DEFAULT kind is **absent from the payload**, so a CGM token minted today is byte-identical to one
minted before kinds existed and every link already in a patient's messages still verifies. ⚠️ An
*unrecognised* kind is rejected rather than falling back to the default: falling back would append
the file to the wrong column, silently.

**Two new "sent once" columns, and they live on the BOARD** — *Resume Link Sent* `date_mm6eakae`
and *Insurance Link Sent* `date_mm6eev4b` (created 2026-08-21). Presence is the entire meaning;
nothing does arithmetic on them, which is why a rep clearing one by hand is a legitimate way to let
a link be re-sent. They are on the row rather than in the store because the store degrades to an
in-process Map without `REDIS_URL` and Railway redeploys on every push, so a store-only guard
forgets within days — and its failure mode is exactly what it exists to stop.
> **Save & finish later sends ONE link, ever.** Tapping it on step 3, again on step 4 and again on
> step 5 texted three links carrying three snapshots: it reads as spam, and it leaves the patient
> choosing between links with no way to tell which is current. A repeat save now re-shows the link
> on screen (`alreadySent: true` — a THIRD state on the sent screen, not the apology one, which
> would teach them something false about a link that works).
> ⚠️ **The snapshot id is reused per row** (`resumesnap:<itemId>`), and that is what makes "one
> link" honest rather than merely quiet: a fresh id would leave the link they already have pointing
> at their FIRST save forever. Reusing it overwrites the snapshot behind the same token.
> ⚠️ The stamp goes down **after** the send, and for the text OR the email landing — the opposite
> call from `deliverPatientDocs`' guard. That one protects against a double delivery; this one
> protects a patient's only route back into their form, so the order favours a possible second text
> over none at all.

**A second nudge exemption** (`dropOffRules.awaitingInsuranceCard`). A parked patient already has a
link, and the drop-off sequence would send them *"you're a couple of questions away, finish here"*
pointing at a different one. ⚠️ Keyed on the **Insurance Link Sent stamp**, not on Insurance
Provided Via — the status column is written the instant they tap the option, so keying on it would
exempt a patient whose text never went out, which is precisely who a nudge should reach.
Self-clearing, like the saved-for-later exemption: the card arriving makes them an ordinary lead.

**The rep's half.** *Start Insurance Follow-Up* (`/unverified-referrals`) now appends **the same
link** to its check-in text — same endpoint, same kind, same upload page, same column. Not a second
mechanism: asking for a card is one thing whether a form or a rep does the asking. ⚠️ A failed mint
does **not** block the text; the check-in is worth sending on its own and the rep is usually
mid-call. It is also why `logTextSent` now reads a `textPurpose` alongside the body — two buttons
put a `/u/` link in the composer and the Call Log has to name which.

**Keep-in-agreement (three repos):**
1. **The form** — `mm-track-widget/intake-form.html` ⇄ `dtc-mm-form-H7eG34s/index.html`. Byte-
   identical, and not cosmetically: the upload page's *"Finish your form →"* lands patients on the
   dtc copy, so a stale one would not know the parked screen exists.
2. **The service** — `server/src/uploadLink.js` (kinds + copy) · `uploadPage.js` (per-kind page) ·
   `server.js` (`/api/intake/insurance-link`, `/card-on-file/:token`, `/continue-link/:token`) ·
   `resumeState.js` (`insuranceAnswered` — a card answer skips step 6 because the live form does).
3. **The Command Center** — `lib/profile/uploadLink.ts` `UploadLinkKind`.
⚠️ The parked screen's poll is **one loop**, with a generation counter, a phase re-check before
every request and a 15-minute cap. A poll started per render is the shape that took RingCentral
down for the whole company on 2026-08-20 (§10).

### 5.24 Partial forms are workable — call them, and advance them (Aug 2026)
Info Collection's *Ready to Advance?* card used to render a different thing for partials: a
paragraph saying *"advancing a partial isn't defined yet — work it as outreach"*, a list of
blockers, and **no buttons at all** — no Save, no Log call attempt, no Advance. Josh, 2026-08-21:
*"partial and completed ready to advance section shouldn't be any different"*.

That was the wrong way round. This is a **calling queue** — the partials are exactly the rows a rep
rings — so the half of the stage with the most phone work had the fewest affordances, and a rep who
filled a patient's details in on the phone had nowhere to record the call and no way to move them
on. `canAdvanceToCleanUp` is now `unlock.unlocked` alone. The gate is identical for both because it
reads the **columns**, not how they were filled: a partial that passes it has been completed, by a
rep instead of by the patient.

Nothing else changed. `advanceToProfileCleanUp` is group-agnostic (it writes, verifies, advances,
then moves), so a partial advances by exactly the path a completed form does; and leaving the
Partial Leads group is what cancels the drop-off sequence, which only ever sweeps that group.
⚠️ **Drop-off Step is deliberately left saying where the PATIENT stopped** (e.g. "Step 3 - What
they need"). Rewriting it to Completed would make "did this profile come from the patient or from a
phone call?" unanswerable, and nothing downstream reads it as a queue rule.

**Both counts render on the sidebar row and the patient header** — `Call Attempts: # | Auto. Texts:
#`, one builder (`sidebarList.contactTally`) so the number a rep scanned the list by and the number
on the patient they opened cannot disagree.
⚠️ **"Auto. Texts" is Drop-off Attempt `numeric_mm67822b`, and it counts exactly two things** — the
intake form's 30-minute and 24-hour nudges, nothing else. The backend claims that counter BEFORE
each send, so it is the count of messages that actually went out rather than of messages we meant
to send; the resume link, the insurance upload link and every rep-sent text leave it alone. It is
clamped at 2 the same way the backend clamps it — a hand-typed 7 is a typo, not a seventh text, and
reporting one would send a rep into a call believing we had hounded somebody. **This is the half a
rep had no other way to see**: automated texts leave no note, no Call Log line and no trace on the
screen, so a patient who had received two looked identical to one nobody had ever contacted.
⚠️ `showContactTally` is passed by the intake page only. Verified Referrals and Already In System
patients never receive those texts, so there the number would be a permanent honest zero that reads
as broken.

### 5.25 Patient Intake reads in TWO TIERS — slim list, full detail (Aug 2026)
`New Form — Partial Leads` went from 8 items to 1,866 in one day. The intake page fetched its whole
queue with all **104** `READ_COLUMN_IDS` on a 15-second poll — ~194k column values a poll, per open
tab — which drained the account's **~10M/minute Monday complexity budget** within seconds of each
reset. Monday then 429'd everything for the rest of every minute, so **every role's counts stopped
loading**, not just this page. Two silent failures came out of the same measurement: the
localStorage cache had been dead for weeks (`persistPatientCache` swallows the
`QuotaExceededError` that 4–8 MB of patients throws against a ~5 MB quota), and `initialLoading`
blocks the page on the first FULL fetch regardless of the cache, so the cache could never have
helped the load time anyway.

**The list now reads `LIST_COLUMN_IDS` — nine fields — and the patient the rep OPENS is fetched at
full width into `detail`.** The seam is `selected`: it used to be a list row, and is now the detail
record, so every pane, the readiness gate and every write are untouched — they cannot tell the
difference. `useRoleCounts`, both baseline generators, Oversight and Search never went through this
array and are unaffected.

⚠️ **A list row is `partial` and must NEVER reach a write.** `col()` defaults a missing column to
`""`, so a narrow row is indistinguishable from a patient whose board record is blank — which is why
the marker exists rather than a value check. `intakeEditsFor` sends every field on every save, so one
partial record would blank ~95 real columns with nothing erroring. Three layers stop it: `selected`
is null until the detail fetch resolves; the whole pane block (Save, Advance, everything) renders
inside the `selected ? …` branch so the controls do not exist before then; and `assertNotPartial`
throws at the top of `intakeEditsFor`. **Never fall back to the row on a failed detail fetch** — show
the error.

⚠️ **`refetch` refreshes the open patient as well as the list, and that is load-bearing.** The Stedi
settle watcher polls `refetch(true)` waiting for the `stedi*` columns to land (§5.11) — the list no
longer carries them, so without the detail refresh the reveal would never fire and every run would
hit the 90-second timeout. Keeping it inside `refetch` is also what leaves every existing
post-write `refetch(true)` call site working unchanged.

⚠️ **The as-received snapshot is seeded from the DETAIL read, never the list.** `receivedRef` is
first-write-wins, so a narrow row would freeze `getReceived` at nine columns forever — and the pane
that reads it shows the call slot the PATIENT picked before a rep overrode it (one column doing two
jobs, §5.20). It would have read blank, silently. ⚠️ Optimistic overlays apply to `detail` too, or an
edit shows in the sidebar and nowhere else while still being saved.

**Keep-in-agreement:** every field read by `lib/profile/sidebarList.ts` or
`components/profile/PatientsSidebar.tsx`, plus the page's `intakeEscalation` manager filter, must be
in `LIST_COLUMN_IDS`. `listColumns.test.ts` scans those sources and fails the build otherwise —
adding a field to a row and forgetting the column is the §5.11 trap, and it shows as a permanently
blank value rather than an error. `useMondayPatients.twoTier.test.tsx` pins the two hazards above.
Phase 2, when wanted, is **Subscription** (69 cols × 712 items); every other queue is in the tens and
the waste is immaterial.

### 5.26 The Welcome Call ops layer — what shipped, and the two that didn't (Aug 2026)
The Aug-2026 ops redesign (a Lovable prototype) was taken as a **logic change, not a schema
change**: no Monday columns were added and no board automation was touched. Most of what it asked
for landed — the nine no-column facts in the Notes block (`lib/welcomeCall/callIntake.ts`), the
payer rules (`payerRules.ts`), pump↔set compatibility pulled forward from Final Confirm
(`shared/infusionCompat.ts`), auth validity windows, a visible POS, and two call-shaping prompts
(`workflow.ts` `isFirstTimePumpUser` / `secondaryAsk`).

⚠️ **The prototype's option lists do NOT match the board — do not port them.** Audited against the
live label sets 2026-08-28: its CGM list omits **Simplera Sync**, it writes `Sensors and Supplies`
where the board says `Sensors & Supplies`, only **4 of its 10 infusion sets** are real board labels
(the board has 25, and the app already reads them live via `useStatusOptions`), and its cross-sell
test reads `requestType.includes("cross")` against a Request Type column whose five labels contain
no such word — so that rule could never fire here. The app's own `isCrossSell` is
`servingIncludesCgm(serving) && !servingIncludesCgm(requestType)`. Pump Type and Serving are the
only two vocabularies that match exactly.

**Two asks were deliberately not built.**

**The Calendly "call scheduled" link — wanted, blocked on the board.** The prototype shows the
booked slot and a "View Calendly booking" link on this stage. The data exists — Scheduled Call Time
`date_mm63na19`, Calendly Event URI `text_mm63e086` — but on **Profile Send Off**, not Welcome Call
(§5.15). Nothing copies them across the board hop, so this needs either those columns added to the
create-item automation's copy list or a cross-board read; it is not a UI change. ⚠️ Whoever builds
it must render off **`scheduledCallTime`**, never Booking Status: the intake form writes
`Scheduled` the moment a patient picks a time STRING, before any Calendly event exists, so the
status column cannot tell a real booking from an abandoned one (§5.15).

**Per-policy verified / needs-update state — declined.** The prototype carries `primaryVerifiedOn`,
`primaryNeedsUpdate`, `secondaryVerifiedOn`, `secondaryNeedsUpdate`, plus plan type, group ID and
effective date per policy, and lets `secondaryNeedsUpdate` block readiness. Two reasons it was not
built, and both would have to be answered first:
1. **The columns do not exist.** This board has primary Plan Name `dropdown_mm2wrzrk` and Plan
   Begin Date `date_mm4w5hbc` and nothing else — no group ID, no verified-on, no needs-update, and
   nothing secondary beyond the payer label and Member ID 2.
2. ⚠️ **There is no SOURCE for "verified on".** Stedi runs at Profile Send Off (§5.11) and this
   board carries no eligibility-check timestamp, so the date would have nothing behind it — a
   confidence signal a rep would reasonably trust, backed by nothing. That is worse than its
   absence.
The half that is actionable on a call — *did the rep confirm this with the patient?* — already
ships as the `primary` / `secondary` confirm flags in the intake block. Build the rest only
alongside the eligibility-date plumbing, never as UI alone.

---

## 6. Patient flow across boards (the big picture)

```
DTC Intake (18392794310)
   │  "Send To Medical Necessity"
   ▼
Profile Send Off (18406352652)  ──profile role: complete demographics/insurance/doctor
   ▼
Welcome Call (18410804557)      ──welcomeCall → finalConfirm roles
   ▼
Medical Evaluation (18406060017)──evaluate → sendRequest → confirmReceipt → chase (fax | email+parachute)
   ▼
Insurance (18410601299)         ──benefits → submitAuth → authOutstanding (→ authDenied)
   ▼
Subscription (18407459988) / Claims boards  ──recurring orders, reconciliation
```

Movement between groups/boards is performed by **Monday automations** (e.g. "when Stage Advancer
status changes → set status / move item to group", and a "when item created → set statuses + copy
columns" automation on duplicated items). The SPA only flips the advancer; verify writes first.

---

## 7. Cross-cutting / manager views

- **Pipeline Oversight** (`/system-mgmt?tab=oversight`, `components/oversight/OversightTab.tsx` +
  `lib/oversight/oversightApi.ts`) — the manager dashboard. A **stage dropdown** (Intake · Medical
  Evaluation · Insurance · Welcome Call) renders one stage's charts at a time, bucketed by
  days-in-stage. **Manager views (2026-07-21, `MANAGER_VIEWS_DVS_BUILD.md`):** Medical Evaluation
  and Insurance use a 3-column scheme — Processor Overview / Manager Intervention / Final
  Decisions — rows aligned via `ChartDef.rowOf`. ME column 2 stacks **Attempt 4+** (MN Attempts
  `color_mm1wz0vg` = `"Escalate"` — the board has no literal "Attempt 4" label) with **3rd+ round**
  per stage (dedup: 3rd+ wins). ME column 3 = **Proposed Stuck** charts (keyed on Escalation
  `color_mm1x7997` **index 2** "Final Escalation Required"; the reason is extracted from the MN
  notes' stamped `[Proposed Stuck …]` line into a virtual `__proposedReason__` column) whose
  drill-down has the Oversight's first ACTION buttons: Approve Stuck (main Stage Advancer = Stuck,
  then clear the escalation — in that order) / Return to Queue (a modal that shows the MN notes,
  takes an OPTIONAL stamped note, sets Next Action Date = today, and clears the escalation so the
  patient re-enters the rep's queue). Every ME manager chart (incl. Proposed Stuck) opens the
  patient in the stage page (manager mode) to view/work in UI.
  ⚠️ **A return RESETS THE OUTREACH BUDGET, or the rep gets a patient they cannot work**
  (Josh, 2026-08-14; `lib/masheke/attemptRollup.ts` + tests, applied by `returnProposedToQueue`).
  Clearing the escalation is only half the job. **MN Attempts `color_mm1wz0vg` is what Confirm
  Receipt and Chase derive the current slot from — NOT which attempt columns are filled**
  (`currentAttempt` ← that column; `Escalate` ⇒ `isEscalated` ⇒ `locked = isEscalated &&
  !managerMode`, and `managerMode` is only ever `?manager=1`, which a processor's own role bar
  never sets). A returned patient therefore landed in the rep's sidebar, due today, counted in the
  burndown, showing a rose **"Escalated — all 3 attempts came back unsuccessful"** card *while the
  escalation had just been cleared*: notes editable, but no attempt, no fax/email re-send, no way
  to move the Next Action Date. They sat there forever. A **simulation across all six ME stages**
  (kept out of the repo; gates = queue · sidebar · role count · can-actually-work) found Evaluate,
  Confirm Receipt and both Chase roles dead on gate 4, and Doctor Appointments dead whenever the
  manager left the note box blank. The return now folds the spent attempt columns
  (`text_mm2yd068`/`mm2y9h4a`/`mm2ymtsk` · `text_mm2yhpjt`/`mm2yb3rv`/`mm2ybk06`) into the **MN
  Workflow Notes** under a dated header, blanks them, and writes MN Attempts back to **Attempt 1**
  (`MN_ATTEMPTS_INDEX.attempt1` = index **2** — this column's labels are not in numeric order).
  The counter reset is unconditional; the clears fire only when something was there.
  **Scope is per stage** (`returnAttemptReset`): `all` for Evaluate / Send Request / Confirm
  Receipt (the whole loop restarts from the top), **`chaseOnly` for the two Chase roles** — a chase
  return must NOT wipe the Confirm Receipt columns, because `ChaseClinicalsPanel` parses them for
  its "who actually confirmed receipt" banner. Doctor Appointments is `null`: it has no attempt
  columns, its counter is the attempt LINES in the notes.
  ⚠️ **The stamped `[Returned to queue …]` note is now written even when the manager leaves the box
  blank** (body defaults to "Returned by a manager", same as Patient Intake's
  `returnIntakeToPipeline` always did). That stamp is Doctor Appointments' **attempt-counter reset
  marker** (`apptOutreach.RESET_MARKERS`), so a note-less return used to leave three spent attempts
  counting and lock the rep out — silently, exactly as that module's own comment warns.
  ⚠️ **Append + clears ride ONE `change_multiple_column_values`** (all-or-nothing), so a cycle's
  notes can never be deleted without having landed in the history first — the same reasoning the
  rep-side re-eval rollup in `EvaluatePanel` carries, and both call `buildAttemptRollup` so the
  headers they write into that shared column can't drift. The escalation flip stays LAST and
  separate: it is what makes the patient visible to the rep, so it must not fire before the data.
  ⚠️ **`returnAttemptReset` is keyed by TWO vocabularies.** The stage page passes a `StageKey`, the
  drill-down passes the chart's `rowOf`, and the Email & Parachute chase is **`chase-parachute`** in
  one and **`chase-email-parachute`** in the other. A table holding one spelling doesn't error on
  the other — it returns null, the return looks like it worked, and the rep stays locked out. Both
  are listed and pinned by tests.
  ⚠️ This does **not** disturb the Attempt 4+ charts described below, despite their reliance on
  "MN Attempts is history, not a queue flag": those charts require escalation index 0, and a return
  clears the escalation, so a returned patient is off them either way. **Insurance columns 2/3 are
  REASON-BUCKETED (2026-07-29, `OVERSIGHT_CHART_RULES.md` §3):** the x-axis is one bar per reason
  (a patient can be in several bars; header count = distinct patients), driven by
  `ChartDef.reasonBuckets` + `reasonBucketsFor`. Column 2: Benefits (Inactive insurance · Pump SoS ·
  Check outstanding >5d — board facts, not the escalation label) and **Submit Auth** (the two DVS
  charts merged: DVS Retry · DVS Manual Review · Propose Stuck). Column 3 Benefits bars = arrival
  path (Propose Stuck stamp vs Universal Check columns); **Submit Auth column 3 mirrors column 2's
  three bars one rung up** and **Auth Outstanding column 3 has a single Propose Stuck bar** (both
  2026-08-02 — before that they were day-bucketed, which said nothing a manager could act on).
  **A chart's population is its `CHART_FILTERS` rule UNION its bars** (`patientMatchesChart`,
  2026-08-03). That union is what lets `submit-auth-manager` / `submit-auth-final-escalation` carry
  a "Submit Auth." stage rule at all: two of their three bars are stage-**DVS** patients, which a
  chart-level rule alone would filter out, so the rule can only ever ADD. `handlePatientClick`
  still overrides the route per patient (DVS rows → `/dvs`).
  ⚠️ **Every escalated patient must land in some manager chart** — an escalation removes them from
  the rep's queue AND from the role count, so a state that matches no chart is invisible in the
  whole app. Bars key on board FACTS and escalations are LABELS, so the two drift; each Insurance
  manager chart therefore carries a population rule wider than its bars. **Benefits and Submit Auth
  have both rungs; Auth Outstanding has ONLY Final Decisions** (Josh, 2026-08-03 — an escalation at
  that stage should only ever land in Final, so the `auth-outstanding-manager` chart built earlier
  that night was removed). Because that leaves one chart to catch everything, its population rule
  takes **either** escalation index (0 or 2) — nothing in the SPA writes Manager there any more
  (`authOutstandingOutcome` → `final` on the pump-SoS hold, `proposeStuckLevel` → `final`),
  but a label carried in from an earlier stage or written by one of
  the four DVS/claims automations would otherwise be invisible. Its two bars (**Pump SoS** ·
  **Propose Stuck**) match either rung for the same reason — deliberately unlike the Submit Auth
  pair, which splits on level so a promoted patient leaves the lower chart.
  **`authDenied` is the one deliberate exception (Josh, 2026-08-03): the stage is under
  construction — do NOT build UI for it.** It has no manager charts at all, and since ANY denial
  escalates those patients are worked on the board until the stage is built; don't "fix" this. (The
  Auth Outstanding send still writes **Manager** on a denial — the patient leaves for that unbuilt
  stage, so choosing Final would pre-judge a design nobody has done.) Manager
  Intervention decision buttons are the intent on every row except a bot-owned DVS one — a row a
  manager can see but not clear is still a stranded patient.
  ⚠️ **In practice only 2 of the 9 Manager Intervention charts carry them** (audited 2026-08-14):
  `submit-auth-manager` and `profile-send-off-unverified-escalated`. `benefits-manager-escalation`,
  all five ME `*-escalated-merged` and `doctor-appointments-manager` have **no `decision`**, and the
  drill-down renders its buttons from `ChartDef.decision` alone — so those seven offer no inline
  Return to Queue. Nobody is stranded (every one routes to the stage page with `?mv=`, where
  `StageActionBar` does offer Send back to pipeline), but it is an extra hop and the asymmetry with
  Final Decisions — where **every** chart has a decision — is not deliberate. `lib/oversight/insuranceCoverage.test.ts`
  enumerates the reachable (stage × escalation) states and fails if one goes blind (Auth Denied is
  carved out by name, and Auth Outstanding's Final-only shape via `FINAL_ONLY_ROWS` — both asserted
  as carve-outs); `lib/samantha/managerRail` mirrors these populations for the destination page's
  sidebar — change the two together.
  ⚠️ **The three columns must PARTITION the stage — nobody in two, nobody in none** (Brandon,
  2026-08-12). `insuranceCoverage.test.ts` guards the "none" half; `lib/oversight/
  columnExclusivity.test.ts` guards the "two" half, over ME · Insurance · Intake, from the real
  chart defs. Medical Evaluation had the second failure for as long as the manager views existed:
  its Processor Overview charts excluded escalation index 2 but **not index 0**, so 20 escalated
  patients (Ruben Dickens the reported one) were counted in the processor column AND a manager
  column, while being absent from the rep's sidebar and burndown — the processor bar was showing
  work nobody was doing. All five now exclude **[0, 2]**, matching Insurance and Doctor
  Appointments. Two consequences that must move together: the `*-escalations` ("Attempt 4+")
  filters now require index 0 (**MN Attempts is history, not a queue flag** — Return to Queue
  clears the escalation and deliberately leaves it set, which used to strand the patient on both
  bars), and each `*-escalated-merged` chart gained a **population rule** (stage + index 0) unioned
  with its two series, because the series don't cover every route to index 0 and Processor Overview
  no longer catches the remainder. `StackedStageChart` footnotes those as **"+N other escalation"**
  and lists them in the drill-down. **Insurance got the same treatment the same day**: the Benefits
  Manager Intervention bars *Inactive insurance* and *Pump SoS* keyed on the board FACT with no
  escalation condition (Katie/Josh, 2026-07-29), which put a non-escalated patient in two columns —
  and worse, made the row **uncleanable**: Return to Queue drops the label and hands the patient
  back to the rep, but the insurance is still Inactive, so they stayed on the manager's bar forever.
  All three bars now require Escalation index 0. Nothing is lost by that, because **every one of the
  three facts already writes the label**: `universalEscalationLevel` → manager for Inactive;
  `deriveInsuranceOutcome` → `blocker` for a not-clear pump (`workflow.ts`), which
  `mondayWrite` turns into manager when no universal check failed; and board automation
  **7921298383** for the days bucket. A fact set directly on the board without a label leaves the
  patient in Processor Overview — visible, and the rep's.
  ⚠️ **Do NOT add a Monday automation on the Not Clear Products dropdown** to "cover" the pump
  case. Monday cannot express *dropdown contains Insulin Pump* — the only trigger available is the
  whole column changing, which would escalate a patient whose CGM Sensors came back Not Clear, a
  case `deriveInsuranceOutcome` deliberately does NOT treat as a blocker. The app write is exact.
  **The DVS page edits DOCTOR details and downloads clinicals** (2026-08-12). It stays a
  read-only *monitor* of what the bot did, but the doctor block on `samantha/PatientProfileCard`
  is editable there — all eight columns (name · Clinicals Method · NPI · phone · fax · email ·
  clinic · clinic address, `COL.clinicAddress` added then) — plus `ClinicalsDownloadButton`. The
  card takes **`editScope="doctor"`**, which leaves identity + insurance read-only: those are the
  inputs the whole rail derives from, and the Stedi argument below applies unchanged. Edits go
  **straight to the board** (this page has no overlay and no Send), batched behind the card's Save
  — its inputs fire on every keystroke, so a per-change write would be a dozen board writes per
  name. ⚠️ `writeEmail`/`writePhone` **skip** a value they can't parse rather than throwing, so
  `unwritableDoctorFields` checks the draft BEFORE the first write — otherwise a typo'd fax saves
  green having written nothing (§10's optimistic-UI trap), or leaves a half-saved record.
  ⚠️ **There is NO Escalate toggle in the Insurance UI — don't reintroduce one** (Josh,
  2026-08-03). The only escalation affordance is the **Propose Stuck popup**, plus the manager
  decision buttons and the board automations. `components/samantha/EscalateButton.tsx` had zero
  importers and was deleted (Welcome Call / Final Confirm / Subscription keep their own copies in
  their own folders — those are live; masheke's is commented out).
  **A send therefore writes the Escalation column only when an AUTO rule decides one**
  (`samantha/mondayWrite.autoEscalationWrite`): the Auth Outstanding pump-SoS hold → Final, a
  denial → Manager, and an auto rule only ever RAISES. Otherwise the column is left exactly as the
  board has it. Submit Auth has no auto rule at all, so its sends never touch escalation — that is
  what keeps a rep's Propose Stuck at Manager until a manager actually reviews it.
  This replaced a "manual toggle is the floor" rule that read `p.escalated` — which is **hydrated
  FROM the board** (`mondayMapping`, index 0/2), not from any control — and re-wrote it on every
  send. It silently PROMOTED (a pending Submit Auth proposal jumped to Final, skipping the review,
  with no note) and silently CLEARED (a flag raised since the page last polled got overwritten with
  "Done", dropping the patient back into the rep's queue with nobody told).
  **Benefits is the deliberate exception** and still writes unconditionally, "Done" included:
  escalation there is DERIVED from the universal checks (redesign §5), so clearing it by fixing the
  facts and re-sending is the design.
  **A manager who works the patient RESOLVES them** (Josh, 2026-08-03) — the one case besides
  Benefits where a send writes the column with no auto rule. The three Insurance stage pages pass
  `managerResolve: isManager` to `sendPatientToMonday`, so Benefit Check Complete / Auth Submission
  Complete / Auth Review Complete clear the escalation and hand the patient back to the pipeline
  rather than leaving the label that put them in the manager column. It does NOT reintroduce the
  toggle above: this is an explicit act by the person the escalation was raised FOR, keyed off
  `?manager=1`, not a hydrated flag re-written on every send — and the auto rules still run after
  it, so a review that comes back denied re-escalates on the NEW facts.
  `components/samantha/ManagerResolveNote` says so on the page whenever `?manager=1`, because it
  can't be undone from there. Manager Intervention's **Send back to pipeline requires a note** (the
  return clears the escalation and the row vanishes, so the stamped note is the only thing the rep
  ever sees); Final Decisions' return stays optional.
  **The escalation ladder is processor → Manager Intervention → Final Decisions**
  (`stageActions.proposeStuckLevel`, 2026-08-02): Propose Stuck writes one rung UP from wherever
  the patient already is — an existing escalation label OR a click from Manager Intervention
  promotes to Final; otherwise Submit Auth and DVS start at Manager and Benefits / Auth
  Outstanding go straight to Final. It used to key off the STAGE alone, which made a manager's own
  Propose Stuck a no-op at Submit Auth (it rewrote the label the patient already had). The
  drill-down's "Escalate to Final Decisions" button still exists as the other route up.
  **Both DVS bars are escalation-split**: Manager Intervention excludes Final, Final Decisions
  requires it — reversing the 2026-07-29 "status-only" rule, which was correct only while nothing
  ever wrote an escalation onto a DVS patient. **Four board automations now do** (all active
  2026-08-02), one per rose column, each ⇒ Escalation = Manager Escalation Required:
  **7918444697** Trigger Supplies DVS `color_mm26pk1a` ∈ {Failed, Manual Review, MLTC} ·
  **7921430568** Trigger Pump DVS `color_mm578kbd` ∈ {MLTC, Failed, Manual Review, Denied} ·
  **7921431002** S Claims Status `color_mm284z0b` and **7921431140** IP Claims Status
  `color_mm5g8085`, both ∈ {Claims Error, Claims Denied, Payment Incorrect}. Those label sets are
  exactly the `dvs-manual-review` CHART_FILTER's `anyCols` — **keep the four automations and that
  filter in agreement**, or a patient escalates into a chart that can't list them.
  **The board splits claims in two** — `S Claims Status` (supplies) and `IP Claims Status` (pump),
  each with its own paid-amount / paid-date / denial-reason / error columns. The **IP half was
  unread by the entire SPA until 2026-08-02** (no `COL` entry, so a pump claim failure classified
  as nothing); it now flows through `COL.ipClaims*` → `Patient` → both DVS chart filters,
  managerRail and DvsPage's `isManualReview`, and renders as an "Insulin pump claim" block on the
  DVS claims card so the manual-review reason is visible.
  `DvsPage`'s `pumpClaimPaid` ("has the pump claim paid, so supplies may submit?") reads
  `dvsRouting.pumpClaimStatus`, which **prefers `ipClaimsStatus` and falls back to the shared
  `claimsStatus`** while the pump column is blank — every patient today. So it needs no edit when
  the bot starts writing the pump column. Being wrong there is cosmetic by design: it only picks
  the Supplies card's "Waiting on pump" chip, while a pump claim that actually FAILS is caught by
  `isManualReview` + the escalation automation off the raw status columns, which never consult it.
  **Manager Intervention has "Send back to pipeline"** (`returnToQueue`, optional stamped note →
  clears the escalation + re-dates to today) — an escalated patient is invisible to the rep, so
  this is the only way back and it previously existed only in Final Decisions.
  **DVS × Final Decisions additionally gets "Send back to manager"** (`returnToManager` →
  `returnInsuranceToManager`, Final → Manager index 0): the final reviewer fixes the run on the
  board and hands it back to the manager who watches DVS, rather than dropping it to a rep who has
  no DVS actions. That is the only Final→Manager transition; everything else raises or clears.
  Benefits auto-escalation splits by cause: OON / Medicare-not-primary / DME-no → Final, Inactive
  alone → Manager (`universalEscalationLevel`). `lib/oversight/priority.ts` adds
  VIP/priority scoring (localStorage config). The open drill-down `{stage, chart, bucket}` is
  **mirrored to the URL** so Back from a patient's agent page returns to the exact drill-down (see the
  back-nav note in §9). **Keep oversight reads on the gateway:** `oversightApi.ts` must route through
  `MONDAY_API_URL`/`mondayIdentityHeaders` from `shared/mondayEndpoint`, *not* hardcode
  `api.monday.com` (a handoff once regressed this — reads would then bypass token-injection + audit).
  **`BenefitsPatientHeader` is read-only for EVERYONE — including managers (2026-08-02).** A
  manager-only "Edit profile" dialog lived there from 2026-07-30 (Serving · Primary/Secondary
  Insurance · Member ID 1/2, gated to the escalation columns) and was removed, along with
  `lib/samantha/managerIdentityEdit`, `saveManagerIdentityEdits`, samantha's `fetchStatusOptions`
  and `isManagerEscalationView`. **Don't rebuild it without solving the Stedi half** (Josh): those
  five facts are only half a correction — changing the payer means re-verifying eligibility, and
  the Insurance board cannot run a Stedi check. It has **no Run-Stedi trigger column**, **neither
  eligibility input column** (General Insurance `color_mm24ap4j` and the working Member ID
  `text_mm4t8gbq` are Profile-Send-Off-only; Insurance's Primary Insurance is a different column
  with a different vocabulary), and only ~9 of the 33 Stedi result columns — missing both terminal
  signals (Eligibility Active?, Error Description) plus Managed Medicaid / Medicare Advantage /
  Medicaid ID, which drive the banners, `isCoverageActive` and the serving suggestion. The Railway
  `stedi-monday-integration` service is bound to one board's schema (single `ELIG_COL_*` set; its
  board list has no Insurance board), so this is board **and** backend work, not a UI change.
  Corrections go back through Profile Send-Off instead.
- **System Management** (`/system-mgmt`, `lib/systemMgmt/mondayApi.ts`) aggregates counts/pipeline
  across *all* boards (hardcoded board + stage-advancer column IDs); `OperationsTab` + `PipelineChart`
  render burndown and day-bucket distributions.
  ⚠️ **Search reads EVERY group on EVERY patient board — never add a group filter** (2026-08-12).
  `BOARDS[].groupRoutes` is navigation metadata ("clicking this row goes where"), **not** the fetch
  list; `fetchBoardItems` queries `items_page` unfiltered. It *was* the fetch list, and every group
  added to a board afterwards went invisible with no error: Insurance's **DVS** group (the reported
  bug) and its Stuck group, Profile Send Off's **Already In System** + two New Form groups + Stuck,
  and the Stuck group on ME and Welcome Call. Two whole boards were missing too — **DTC Intake**
  and **Secondary Claims** — so ~1,250 patients the app works were unfindable. This is the §5.10
  bug class: a list that must be updated when a board changes will not be. Search is the one place
  in the app with no queue rule, and `searchCoverage.test.ts` asserts the board set.
  A group missing from `groupRoutes` is still searched; it just isn't clickable (`rowRouting`
  returns route `""`). ⚠️ That default used to be **`/`**, which sent a rep to the app's home page
  as if the click had worked. `rowRouting` also lets the **Stage Advancer win over the group**, so a
  stage-DVS patient parked in the Benefits group opens `/dvs` — matching the rule `useRoleCounts`
  already uses (§5.8), rather than the one queue that deliberately excludes them.
  **Search's green completion badges are LINKS into the finished stage** (Aug 2026,
  `lib/systemMgmt/stageCompletion.ts`). A patient is a different item on every board (§6), so
  `buildCompletionMap` — name-keyed, because that's all the boards share — now carries each
  completed item's own **id + board**, and the badge opens THAT item on the page that gathered the
  data (`COMPLETED_STAGE_ROUTES`: Profile → `/profile`, MN → `/evaluate`, Insurance → `/benefits`,
  Welcome Call → `/welcome-call`), via `?patientId=<completed item>&completedStage=<boardId>`.
  Every role hook already injects a deep-linked `?patientId=` that isn't in its queue, so the
  completed record loads with no hook changes. A **completed row opens its own record too**
  (`completedStageForPatient`) — `hasPage` is false for anything in a Completed group, so those
  rows used to dead-end on a "no dedicated page yet" toast. Search rows are **tagged
  COMPLETED (green-tinted row) / ACTIVE**, and a completed row's days-in-stage chip drops the
  urgency colour: it's a frozen number, and a red "30+ Days" inside a finished record reads as
  work nobody is doing.
  ⚠️ **`completedStage` is a WRITE GATE, not just a banner flag.** `useCompletedStageReview`
  (`components/shared/CompletedStageBanner`) drives `reviewMode` on those four pages, which
  disables the stage-advancing send (`EvaluatePanel` `sendBlocked`, `BenefitsPanel`, Welcome
  Call's `SendToMondayButton`, Profile's two send-off routes). Without it a rep reading history
  could re-advance an item that already moved on — the advancer is what board automations key on,
  so it would move a finished patient back into the pipeline. Notes/inline saves are deliberately
  still live (harmless, and sometimes wanted). It is gated on the **selected patient**, not the URL
  alone: `?patientId=` survives a sidebar click, so keying only off the URL left the banner and the
  lock sitting on the next LIVE patient the rep opened.
  **"When was it completed" comes from the ACTIVITY LOG** — no board has a completion date column.
  `completedAtFromLogs` takes the latest of (move into the board's Completed group) and (the
  board's own completion status write — Insurance says `Complete`, Welcome Call/ME `Completed`,
  Profile Send Off exits via `Move to Onboarding` = `Advance to MN`). Both signals are needed:
  a batch move logs no `move_pulse_*` event at all. ⚠️ `created_at` there is **100-ns ticks, 17
  digits** — reading it as ms lands ~50,000 years out, which renders as a plausible date rather
  than an obvious bug. Monday prunes activity by plan retention, so the lookup can come back empty
  and the banner must say "date unavailable" rather than guess.
  **WHO completed it comes from the GATEWAY's audit log, not Monday** (`services/monday-gateway/
  stageActor.mjs` ← `lib/systemMgmt/stageActor.ts`). Every SPA write carries the same Monday API
  token, so the board's activity log names one service account for all of them — `gql_log.actor`
  (the signed-in email, §5.1) is the only place the person exists. `GET /audit/stage-completion
  ?item=&at=&column=` takes the completion instant computed above and picks the mutation that wrote
  the advancer, falling back to the latest attributed write in a −30min/+2min window (a send is a
  transaction, not an instant) flagged `matchedColumn:false`. **No auth gate** — same posture as
  `/gql` and `/send`: auth is enforced once at the website's sign-in gate, and anyone working in
  the Command Center sees who did what like any other fact the app shows them (Josh, 2026-08-12 —
  a per-request 401 was tried and removed; don't re-add one).
  `actor_verified` is **NULL on the /send path**, i.e. on most real
  completions, so the banner shows the email either way and puts the provenance in a tooltip —
  the flag says how the attribution was obtained, not whether it's plausible. Direct (no-gateway)
  builds have no audit log at all: `stageActorConfigured()` is false and the name is simply omitted.
  **The Escalations tab** (`?tab=escalations`) is a filter over the same cross-board fetch as
  Search — **not** a group, and not its own query. Membership is ONE status column per board
  (`BoardDef.escalationColId`): ME + Welcome Call `color_mm1x7997`, Insurance `color_mm2vsh2f`,
  matched by exact label OR — on the two split boards only — raw index 0/2, so a rename can't
  blind it. The other four boards have `escalationColId: null`, so **nothing on DTC Intake,
  Secondary Claims, Subscription or Profile Send Off can ever appear there**. The Monday groups
  literally named "Escalations" are irrelevant to it.
  ⚠️ **The reason lives in the NOTES column, never in an escalation column** (rebuilt 2026-08-14,
  `lib/systemMgmt/escalationDetail.ts` + tests). The tab used to describe an escalation from a
  per-board **Escalation Notes** long_text parsed for a `[ESCALATION FORM]` block
  (`lib/shared/escalation.ts`). Audited against the live boards that column held data for **3 of
  58** escalated patients: the Details modal said "no escalation form data found" for 35 of the 38
  that reached it, and since `parseEscalation` returned null the row colour fell through to its
  `"Medium"` urgency default — **every row in the tab rendered the same yellow, the colour-coding
  had never once fired.** Escalations are raised two ways today and neither writes that column:
  **Propose Stuck** stamps the reason into the stage's notes (`lib/masheke/proposedStuck.ts`), and
  the **auto rules** (attempt 4+, days outstanding, a denial, the four DVS automations) write the
  status and nothing else. So a patient with no stamp is NORMAL, not missing data — their attempt
  log is the explanation, and reporting it as absent is what made the tab useless. Row colour and
  the badge are now the **rung** (`escalationLevel`, orange = index 0 Manager Intervention, red =
  index 2 Final Decisions, `flat` for Welcome Call which never split) — derived from the same
  inputs as the membership flag so the two can't disagree. The legacy form block is still rendered
  when present, so the three patients carrying one lose nothing.
  ⚠️ Its **Remove** button is still the blunt one — Escalation → Done + Next Action Date = today,
  with **no stamped note and no attempt reset**, unlike Oversight's `returnProposedToQueue`
  (§7 above). Known gap, deliberately left; don't assume clearing here leaves the same trail.
  ⚠️ The retired **`EscalationFormModal`** is commented out on the four ME pages but **still live
  on `WelcomeCallPage` + `FinalConfirmPage`**, so those two stages can still write the dead column.
  Left in place (Josh, 2026-08-14) pending a Propose Stuck equivalent for Welcome Call.
- **Patient Questions** (`/patient-questions`) is an inbox merging "patient message" columns from
  the Subscription + Secondary Claims boards. **Mark completed** stamps a "Question Handled At"
  date column (Subscription `date_mm57yzmb`, Claims `date_mm57skrd`); an item shows only while
  its message is **newer** than that stamp (`lib/patientQuestions/handled.ts`), so a new patient
  message automatically reopens it — don't add a status column for this. Phone renders the
  Evaluate-style Call + Text buttons (`masheke/mmKit.tsx` `PatientContact`).
- **Fax Inbox** (`/fax-inbox`) reads inbound faxes from RingCentral.
- **Access admin** (`/access`, managers only) edits `access.json` (auto-saves per mutation).

---

## 8. Deployment reality

- **Frontend:** GitHub Pages. `deploy.yml` sets Vite `--base=/<repo>/`, and `lib/shared/dataRepo.ts`
  derives the data repo from that base path: **test build → `command-center-test` repo, prod build →
  `command-center` repo**. This is why the data repo is computed, not hardcoded — `sync-from-test.yml`
  force-pushes test's code over prod, so a hardcoded name would make prod write into the test repo.
- **Gateway (`services/monday-gateway`)** runs on Railway as **`cmd ctr server`** with Postgres
  **`cmd ctr db`**. Confirmed production config: **Google-auth enforcement ON** (`GOOGLE_CLIENT_ID`
  set → `/send` requires a verified medicallymodern.com token), **`LOG_MODE=all` but
  `LOG_PAYLOAD=false`** (every request audited, **no PHI** stored), audit viewer key-protected at
  `/audit`. `services/monday-gateway/send.mjs` is the durable, idempotent `send_jobs` queue.
  **Every request is kept in Postgres** — `request_log` + `GET /audit/requests.json?key=…`
  (`requestLog.mjs`, added 2026-08-21). Railway's HTTP log returns **at most 500 lines per query,
  ≈13 minutes** of this gateway's traffic, so anything asked about a day later was unanswerable;
  `gql_log` covered `/gql` and nothing else, leaving `/rc/*`, `/messaging/*`, `/send` and `/calls/*`
  — exactly the routes in play when the phone system misbehaves — with no durable record. (The
  2026-08-20 RingCentral incident was diagnosed from a request *rate*, which you can only see if
  you kept the requests.) Metadata only, matching `LOG_PAYLOAD=false`: no bodies, no headers.
  ⚠️ **Query strings are STRIPPED, and that is a security property, not tidiness** —
  `/calls/stream?token=` carries the caller's **Google ID token** (EventSource cannot set headers),
  and `/rc/fetch?url=` / `/calls/history?last4=` carry patient identifiers; `stripQuery` runs
  before anything is stored. Skips `/gql` (already in `gql_log`, in more detail — re-logging would
  duplicate ~130k rows/day to say less), `/health`, and `OPTIONS` preflights. ⚠️ Unlike
  `call_events` (tiny, precious, unpruned) this one **grows** — ~17k rows/day — so it prunes at
  **`REQUEST_LOG_RETENTION_DAYS`, default 180**, on boot and daily. Its schema runs as its OWN
  statement, deliberately not appended to `index.mjs`' `SCHEMA` block, whose trailing
  DROP+CREATE VIEW takes every `CREATE TABLE` with it when it fails.
- **Worker (`worker/`)** deploys via `deploy-worker.yml` / `npx wrangler deploy`.

### Sync from Test Repo (`sync-from-test.yml`) — what carries over, what doesn't
**This repo (`command-center-test`) is the source of truth; prod (`command-center`) is a mirror.** The
manual *Sync from Test Repo* workflow is a literal **`git push <prod> main --force`**, so prod's `main`
becomes a byte-for-byte copy of test's. Assume **anything you add to test WILL land in prod on the next
sync** — and that *only committed code travels*:
- **Carries over:** all committed **code** (`src/`, `worker/`, workflows, scripts). Nothing else.
- **Does NOT carry over — you must set these in prod yourself (this is the one that bites):**
  - **GitHub Actions secrets** — `CLOUDFLARE_API_TOKEN`, `GH_PAT`, and **every `VITE_*` build secret**.
    Secrets are repo settings, not code. A new `VITE_*` you add to test builds **blank/broken in prod**
    until you copy it into the prod repo's Actions secrets. Missing secret ⇒ silent prod breakage.
  - **Cloudflare Worker secrets** (`GMAIL_*`) live on the shared worker, not the repo — but set them as
    **encrypted Secrets** (a `wrangler deploy` wipes plaintext *Variables* that aren't in `wrangler.toml`).
  - **Railway service env vars** — a separate system; sync never touches them.
- **PRESERVES prod's role assignments; CLOBBERS the other data files:** `sync-from-test.yml` now
  overlays prod's **own** `access.json` (managers/processors) back onto test's tree before the
  force-push and commits it, so **prod's roles are kept** — a processor with a role on prod but not on
  test does **not** lose it. It preserves both `public/data/access.json` (the live source, read via the
  Contents API) and `dist/data/access.json` (bundled copy). The force-push still overwrites prod's
  `baseline.json`/`fax-state.json` with test's, but those **self-heal** (next cron / next ET midnight),
  so no manual fixup is needed after a sync. (If you ever *want* test's access.json to win, edit the
  `PRESERVE` list in the workflow.)
- **Shared, environment-agnostic infra — one instance serves BOTH test and prod:** the Monday **gateway**
  (`cmd ctr server`), the Cloudflare **worker** (`monday-file-proxy`), every **Railway backend**, and the
  **Monday boards** themselves. So a fix to any of those covers both at once — and the gateway `/audit`
  shows traffic from BOTH SPAs once prod's build has `VITE_MONDAY_GATEWAY_URL` set (a copied secret).
- **Per-repo, self-handled:** `deploy.yml` (Pages; base path → data repo), `deploy-worker.yml`, and
  `daily-baseline.yml` each run in whichever repo they live in — so prod snapshots its *own*
  `baseline.json` to `command-center` via its own Action (the Railway `baseline-cron` is pinned to the
  **test** repo via `GITHUB_REPO`, so it never touches prod). The bundled `VITE_GITHUB_PAT` / `GH_PAT`
  **must have write access to BOTH repos** or prod's `access.json` + baseline writes silently fail.

### Backend ecosystem (Railway)
This SPA is one of many services. Others you'll hear referenced (all on Railway):
`stedi-monday-integration` (eligibility → Monday), `josh-monday-automations` +
`automate-dvs` / `automate-dvs-insurance` / `automate-dvs-subscriptions` (insurance/financial
automation — the "Trigger DVS" column), `parachute-doctor-lookup` (Parachute clinicals/doctor
lookup), `doctor-sync-webhook` / `auto-doctor-database-search` (Doctor Database sync),
`mm-dtc-api` / `manufacturer-referral-webhook` (intake), `mm-patient-portal` /
`reorder-patient-form` / `coins-form-payment` / `patient-intake-texts-backend` (patient-facing),
`baseline-cron-CMD CTR-T` (burndown baseline). The OOP estimator and DVS columns are owned by
these services; when their math changes, `oopEstimator.ts` must be updated to match.

---

## 9. Conventions & gotchas

- **Always push to `main` in this repo** (Josh's standing instruction, 2026-07). No feature
  branches or PRs unless he explicitly asks — commit, rebase onto `origin/main`, push `main`.
- **Verify before you advance.** Any new write that a Monday automation keys on must go through
  `executeWritesWithVerification` with the trigger column as `stageColumnId`.
- **⚠️ A stage advancer already holding its target value is a SILENT NO-OP — pass `expectedText`.**
  Monday automations fire on a status **CHANGE**, not on a value (7917676280 is literally *"When
  status **changes** to something, create item in board"*). Writing `Advance to MN` onto a column
  that already reads `Advance to MN` returns **200, writes nothing, and does not even record an
  activity-log entry** — so the automation never runs. `executeWritesWithVerification` could not see
  this: it deliberately EXCLUDES the advancer from read-back verification (the advancer is the thing
  being held back) and then fired it blind, returning `[]` — a clean send — while the patient never
  moved. Betty Dillingham (`12895834887`) and Eddie Quintero (`12895852715`), Aug 2026: both
  advanced correctly on 8/26, were dragged back out of **Completed** into Profile Clean-Up on 8/27,
  and from then on every press of Advance to MN was a no-op. Katie pressed it on 8/28 and again on
  8/31; **the 8/31 press produced ZERO activity-log entries** — `updated_at` moved and not one column
  changed. Five days, a green toast every time.
  **`lib/shared/advancerNoop.ts`** is the rule; an advancer task that carries **`expectedText`** is
  now checked against the pre-write snapshot in **Phase 2b** and the send is REFUSED with a message
  the rep sees, rather than firing a mutation that moves nobody. ⚠️ It is a **BEFORE**-the-write
  check on purpose: comparing the advancer *after* writing it cannot tell "unchanged because it was
  already that value" from "unchanged because Monday hasn't indexed it" — the very ambiguity that
  makes Phase 2 poll. ⚠️ **Opt-in by `expectedText`**: an advancer that declares no target keeps the
  old behaviour exactly, because guessing would flag real advances, and a false *"nothing moved"* is
  worse than the silence it replaces. Same check runs server-side in `send.mjs` (via the payload's
  `stageExpect`), and client-path hits POST to the gateway's `/telemetry/advancer-noop` — **grep
  Railway for `ADVANCER_NOOP`** to find every occurrence across both paths.
  ⚠️ **Do NOT "repair" a stuck patient by clearing the advancer.** Blanking it fires nothing, but the
  next press is then a real change → the automation fires → a **duplicate** downstream item. Both
  patients above already had theirs. The repair is to move the item to Completed, where the
  automation already put it.
  ⚠️ **How they got back into the queue** (unfixed, see §10): `advanceToProfileCleanUp` moves an item
  into Clean-Up **without touching Move to Onboarding**, and `UnverifiedReferralsPage` is the ONLY
  intake-family page that never wires `useCompletedStageReview` — `ProfilePage`, `EvaluatePage`,
  `WelcomeCallPage` and `ChaseBenefitsPage` all do. Combined with `useMondayPatients` injecting a
  deep-linked `?patientId=` into the sidebar **regardless of group**, a patient sitting in Completed
  renders on Info Collection with fully live Advance buttons.
- **Column IDs, not titles**, are the contract. Add new ones to `mondayMapping.ts` + the schema docs.
- **Exact label strings** for status/dropdown writes (Evaluate "Option A", coverage paths, etc.) —
  a casing mismatch creates duplicate board labels. Prefer index writes where possible.
- **Monday dates are ET, timezone-naive.** Don't compare with a bare `new Date()` in a non-ET runtime.
- **Notes are stamped `[ET timestamp] <Stage>: <text> —<initials>`** — one implementation,
  `lib/shared/noteStamp.ts` (`appendStampedNote`), used by every role's NotesPanel. The stage label
  is what makes a line traceable when several roles share one column: Benefits / Submit Auth /
  Auth Outstanding / DVS all append to Insurance `long_text_mm2ffsme`. A new NotesPanel must pass
  `notePrefix`, and note-writing paths outside the panels (Benefits call log, Propose Stuck /
  Approve Stuck / Return to Queue stamps, the machine-composed `[Auto-escalated …]` reason) take an
  `initials` arg — pass `userInitials()`. **Every** line that lands in a notes column is now
  attributed; the auto-escalation line is credited to the rep whose send raised it. Bracketed
  stamps keep the initials INSIDE the bracket so
  `extractProposedStuckReason` (Oversight's "Proposed Reason" column) still slices at the first `]`.
- **ISO text doesn't survive Monday's create-item automations.** The workflow engine type-sniffs
  TEXT tokens: `2022-01-01` is parsed as a date and re-rendered `01 January 2022` in the created
  item (confirmed 2026-07; `07/25/2016` passes verbatim). That's why "Stedi Plan Begin Date" text
  mangles at every board hop. The yyyy-mm-dd value rides in DATE columns instead — profile
  `date_mm4wh83f` (written by the SPA in `buildDataTasks`) → masheke `date_mm4w4jrv` → insurance
  `date_mm4wwm2b` → welcome call `date_mm4w5hbc` → subscription `date_mm4wqkk0` — copied
  date→date by the hop automations (date→date copies are verbatim). Never route a
  machine-parsed date through a text column across boards.
- **PHI everywhere.** Patient data is on every board. The gateway logs metadata only
  (`LOG_PAYLOAD=false`); keep it that way. Don't write patient data to logs/artifacts/commits.
- **Optimistic UI** in many panels marks state "saved" before Monday confirms; failures rely on a
  toast. Don't assume a green UI means a durable write (esp. Subscription — see §10).
- **⚠️ Inside `.pf-root`, a shadcn `<Button>` renders UNSTYLED — use the page's `.btn` classes.**
  `redesign.css` resets `.pf-root button { background:none; border:none; color:inherit;
  font:inherit }`. That selector is one class + one type, so it **out-specifies every single-class
  Tailwind utility** the Button carries: `bg-rose-600`, `text-white`, `text-sm` and `font-medium`
  all lose. Measured in a real browser (2026-08-19) the Propose Stuck button in the intake page's
  Escalation card computed to `background: rgba(0,0,0,0)`, near-black text, 16px/400 — plain text
  with a stray drop shadow, which is what "the Propose Stuck button on the right looks funky" was.
  `.pf-root .btn` is two classes, so it wins; `StageActionBar` takes **`skin="page"`** for exactly
  this, and any other shared component dropped inside `.pf-root` needs the same treatment. Don't
  reach for `!important` — the page has a complete button language already.
- **Toasts are TOP-CENTRE (`App.tsx`), and both other corners are ruled out by past bugs.**
  Bottom-right is where every stage page puts its primary action, so a toast landed on the button
  the rep presses next — adding a note on Evaluate popped "Note saved to Monday" over **Completed
  Evaluation** and swallowed the click (Brandon, 2026-08-19). Top-right covered the file preview's
  Close button, which is why it had been moved to the bottom in the first place. Page headers are
  `justify-between` — title left, actions right — so the top centre is the one strip of the
  viewport with nothing clickable under it.
- **Stale-tab chunk 404s self-heal** (`lib/shared/chunkReload.ts` + `components/shared/AppErrorBoundary.tsx`,
  added after the 2026-07-14 white-screen incident): every Pages deploy replaces ALL hashed JS chunks, so a
  tab left open across a code deploy 404s its next lazy page load — and React unmounts the whole app on an
  uncaught render error. `lazyWithReload` + the `vite:preloadError` guard reload the tab ONCE (sessionStorage
  `mm-chunk-reload` breaks loops; a second consecutive failure renders the root error boundary's Reload
  screen instead of a blank page). **New lazy routes in `App.tsx` must use `lazyWithReload`, not bare
  `lazy`** — and note the Vite trap: `preventDefault()` on `vite:preloadError` makes Vite resolve the failed
  import with `undefined`, which must never be treated as a successful load (see chunkReload's comments/tests).
- **Back-navigation is history-first** (`hooks/useBackNavigation.ts`): `goBack()` does `navigate(-1)`
  when there's in-app history, else falls back via `?from=system-mgmt` (→ `/system-mgmt`) or
  `?manager=1`. Manager views deep-link into role pages with `?from=system-mgmt`, so Back returns the
  user to where they were (the oversight drill-down "feels seamless"). Don't swap it for a hardcoded
  home route.

---

## 10. Known risks / open items (don't rediscover these)

- **Secrets in the public bundle (direct mode):** `VITE_MONDAY_API_TOKEN`, `VITE_GITHUB_PAT`, and
  **hardcoded RingCentral client-secret + a long-lived JWT** (`lib/fax/ringcentralApi.ts`) ship in
  the JS bundle. The gateway moves the Monday token server-side, but full secret removal ("Phase 1b")
  also requires the GitHub Pages build to stop bundling the token. **Treat the RingCentral
  credential as exposed** and rotate it; consider proxying RC through a service too.
- **Subscription send (`lib/subscription/mondayWrite.ts`)** writes ~20 columns with retry but **no
  read-back verification** (audit **H6**); confetti fires even on partial failure.
- **Inline write ordering** in SendRequest/ConfirmReceipt/Chase panels and the **Escalation modal**
  (audit H1–H5, M2) can flip a trigger before sibling data is indexed.
- **"Never billed" attestations** can't be un-set from the UI (code only writes when truthy).
- **Split-order duplicate** (Final Confirm) races a Monday "new item created" automation; the code
  re-writes flags "defensively" afterward (audit M6).
- **Monday long-text columns hold 2000 chars and TRUNCATE SILENTLY** (found 2026-08-14 while
  repairing three patients). A `change_column_value` / `change_multiple_column_values` write with a
  longer body returns **success** and stores only the FIRST 2000 characters — no error, nothing in
  the response. Because every notes column here is append-only (history first, newest last), what
  gets dropped is always the note somebody just wrote. ⚠️ The all-or-nothing property of
  `change_multiple_column_values` does NOT help: it guarantees the transaction doesn't half-apply,
  not that the value is stored in full. A scan of the ME board found **9 items already sitting at
  exactly 2000** — every note appended to those is currently being thrown away. ⚠️ **Worst case is
  Doctor Appointments**, where the attempt LINES in MN Workflow Notes *are* the counter
  (`apptAttemptsFromNotes`): truncation drops the newest lines, so the counter freezes, the rep gets
  unlimited retries and the third-attempt escalation never fires. `lib/shared/longText.ts`
  (`assertLongTextFits`) now makes the big-append paths fail LOUDLY instead — the four masheke
  appointment/chase writers, `returnProposedToQueue` (both branches) and `EvaluatePanel`'s re-eval
  rollup. **Still unguarded:** every role's NotesPanel `appendStampedNote`, and the Insurance /
  profile / welcomeCall note writers. Deliberate detect-and-warn only (Josh, 2026-08-14) — trimming
  old history to make room is the same harm, just chosen by us. The escape hatch for a body that
  genuinely no longer fits is a Monday **item update**, which has no limit.
- **Welcome Call + Final Confirm escalation is WRITE-ONLY, and those two stages need a REWRITE —
  don't patch it piecemeal** (Josh, 2026-08-14, from the escalation audit). `mondayMapping`
  hardcodes **`escalated: false`** and `COL.escalation` (`color_mm1x7997`) is **not in the read
  set**, so the column is never read back; `mondayWrite` writes index 0 only `if (p.escalated)` and
  has no `→ Done` branch. Consequences, all live: a rep escalates, the send writes the board, the
  next poll shows them un-escalated — so `sidebarSections` (which keys on `p.escalated`) leaves them
  in the **active** list while `useRoleCounts` reads the BOARD column and drops them from the active
  count, i.e. **the sidebar and the burndown disagree**; the `escalated` filter view is
  **permanently empty** while the role bar reports a non-zero escalated count; there are no
  Oversight charts for these stages; and **nothing in the app can clear the flag**. The board has no
  index 2 either (labels are *Escalation Required · Done*), so it was never wired for the three-rung
  ladder. One patient sits in this state today.
- **Subscription's Escalate button never persists anything** (same audit). The mapping hardcodes
  `escalated: false`, `COL.authEscalation` (`color_mm2n237s`) is defined but **never written by
  `mondayWrite`**, and `toggleEscalate` only touches the local overlay — the button reverts on
  refetch. The board column has a **single label `Escalate` and no `Done`**, so it could not be
  cleared by index even if it were written. 36 items carry it, set outside the SPA. Left as-is
  deliberately.
- **A runaway React component can exhaust the shared RingCentral account** — it did, on
  2026-08-20, at ~1,166 req/sec from ONE browser, taking down texting, the fax count and
  the call log across **both test and prod** (one gateway, one RC app, §8). The gateway now
  has a limiter (`services/monday-gateway/rcLimiter.mjs`, §5.13) so the same shape can't
  reach RingCentral again, but the SPA still has no client-side guard. Full write-up:
  [`INCIDENT_2026-08-20_RINGCENTRAL.md`](INCIDENT_2026-08-20_RINGCENTRAL.md) — read rule 2
  there before putting a hook's return value in a dependency array.
- **A completed patient can still be re-advanced from Patient Intake — KNOWN, deliberately left**
  (Josh, 2026-09-01: detection only for now). `UnverifiedReferralsPage` is the only intake-family
  page with no `useCompletedStageReview` / `reviewMode` gate, and `useMondayPatients` injects a
  deep-linked `?patientId=` into the sidebar **whatever group the item is in** — so an item sitting
  in **Completed** renders with live Advance buttons. `advanceToProfileCleanUp` then moves it into
  Clean-Up **without clearing Move to Onboarding**, so it lands carrying a stale `Advance to MN` and
  its only exit is permanently dead. That is exactly how Betty Dillingham and Eddie Quintero were
  pulled back out of Completed on 2026-08-27 (§9). The no-op check now REFUSES the second advance
  and tells the rep, so the patient can no longer be dragged backwards silently — but the button is
  still offered on a finished patient. Fixing it properly means wiring the completed-stage gate on
  that page, the same way the other four already do.
- **CI's typecheck is a NO-OP.** `deploy.yml` runs `npx tsc --noEmit`, but the root tsconfig
  is solution-style (`"files": []` + project references), which `--noEmit` does not follow —
  it checks zero files and always exits 0. 23 real TS errors sit in the tree. Use `tsc -b`.
- `README.md` points here; keep this file current as the architecture moves.

---

## 11. Where to look first for a given task

| Task | Start here |
|---|---|
| A role's page behaves wrong | `src/pages/<Role>Page.tsx` → `hooks/<role>/useMondayPatients.ts` → `lib/<role>/workflow.ts` |
| A patient's status badge says the wrong thing (or nothing) | §5.18 — `lib/shared/profileStatus.ts` (the rule) → `components/shared/PatientProfileStatus.tsx` (which board adapter that header uses) |
| A rep pressed Advance repeatedly and nothing moved | §9 — the advancer already held its target value, so no automation fired. `lib/shared/advancerNoop.ts`; grep Railway for `ADVANCER_NOOP`. Repair by moving the item to Completed, **never** by clearing the advancer (that duplicates the downstream item) |
| A value isn't saving to Monday | `lib/<role>/mondayWrite.ts` + `lib/shared/verifiedWrite.ts`; cross-check `mondayMapping.ts` column IDs |
| Medical-necessity logic | `lib/masheke/evalState.ts` (+ ipPaths, requestTemplate, mnRequestPdf) |
| A returned patient can't log an attempt (cards greyed, Save disabled) | `lib/masheke/attemptRollup.ts` → `oversightApi.returnProposedToQueue`; the gate is **MN Attempts** `color_mm1wz0vg`, not the attempt columns (§7) |
| Stedi check output / eligibility results | **inline in `src/pages/ProfilePage.tsx`** — NOT `components/profile/StediPanel.tsx` (dead, §5.11) |
| The benefits check filled in a bad-looking address / "not confirmed" flag | §5.19 — `lib/profile/addressFormat.ts`, rendered by `pages/UnverifiedReferralsPage.tsx` |
| A DTC form patient wasn't duplicate-checked / the "Already In System" pill is missing | §5.21 — `lib/profile/dupCheckFlag.ts` reads **Dup Check Result**, never `alreadyInSystem`; the service half is `josh-monday-automations` `automations/duplicate-patient-check.js` |
| A CareCentrix referral arrived half-empty / which intake form should reps use | §5.20 — the **Intake Form on Profile Send Off** (view `246988391`) is lossless; DTC Intake's Manual Patient Intake Form drops 12 fields at the board hop. `"source":"form"` in the item's `create_pulse` tells you which path it took |
| Provided Doctor Name / Clinic Phone empty on a CareCentrix intake | §5.20 — `lib/profile/referralDoctorInfo.ts`; the manual intake form fills the VERIFIED doctor columns, and the fallback is display-only |
| A patient reads "not in network" / Advance is greyed out on an intake patient | §5.20 — `lib/profile/intakeUnlock.ts` `networkAnswer`. `Unknown` is what Original Medicare returns and is **not** a No; the network answer gates nothing |
| A DTC intake patient is in the wrong half of the split / Advance did nothing | §5.20 — `lib/profile/intakeSubStage.ts` (the queue is the GROUP), then `unverifiedWrite.advanceToProfileCleanUp`. Both roles are `UnverifiedReferralsPage` under a `variant` prop |
| A patient got two "here's your link" texts / the insurance step asked for a card they already sent | §5.23 — the once-only stamps are **on the board** (`date_mm6eakae` / `date_mm6eev4b`), and `uploadLink.js` `UPLOAD_KINDS` decides which column a link writes to |
| A patient is parked on "we're waiting for your insurance card" and can't get out | §5.23 — the gate is the FILE column `file_mm5zhy1`, read by `/api/intake/card-on-file/:token`. Nothing else unlocks it, and nothing else needs to |
| "Auto. Texts" reads 0 for somebody we definitely texted | §5.24 — it counts **only** the intake form's 30-minute + 24-hour nudges (`numeric_mm67822b`). A rep's own text and both link families deliberately do not move it |
| Cost estimate wrong | `lib/welcomeCall/oopEstimator.ts` (sync vs Railway financial backend) |
| The intake queue is slow, or a sidebar field reads blank on every row | §5.25 — `LIST_COLUMN_IDS` in `lib/profile/mondayApi.ts`; `listColumns.test.ts` names the missing column. A pane reading blank instead means it is rendering a list row, not `detail` |
| A pump shipped on a supplies-only patient / a Next Order Date came over blank | §5.22 — `lib/shared/servingLines.ts`; gate Pump Qty on `servingSellsPumpDevice`, **never** `servingIncludesPump` |
| An address Cardinal won't accept / "Needs Review" on the orders board | §5.17 — `lib/shared/cardinalAddress.ts` (mirror of `Cardinal-api/src/address.js`), surfaced as C25/C26 in `lib/finalConfirm/checkPack.ts` |
| Who can see what | `lib/accessStore.ts`, `lib/roleView.ts`, `components/AccessProvider.tsx` |
| Files won't load / PDF viewer | `lib/shared/mondayAssets.ts`, `components/shared/FileViewerModal.tsx`, `worker/src/index.js` |
| A booking didn't show up in Scheduled Calls | §5.15 — the mirror joins on the invitee's EMAIL. `lib/scheduledCalls/bookingLink.ts` (the prefill), then dtc-mm-form `server/src/booking.js` |
| Booked-call queue / the 10-min reminder | `lib/scheduledCalls/workflow.ts` + `pages/ScheduledCallsPage.tsx` + `components/scheduledCalls/ScheduledCallHost.tsx` (§5.15) |
| Fax/email send | `components/masheke/SendRequestPanel.tsx`, `worker/src/index.js`, `lib/fax/ringcentralApi.ts` |
| A text was sent but the patient never got it | §5.5 — `lib/shared/smsDelivery.ts` (status decides, code explains), rendered by `components/shared/SmsDeliveryNote.tsx`; the gateway half is `/messaging/conversation` in `services/monday-gateway/messaging.mjs` |
| "Serving ≠ requested" fires on a normal cross-sell | `lib/finalConfirm/checkPack.ts` `droppedProducts` — C13 fires on a DROPPED product only; adding one is a cross-sell and is silent |
| Audit a write that "disappeared" | gateway `/audit` (Postgres `gql_log` / `send_jobs`) |
| "What was the gateway doing at 4:46 last Thursday?" | `GET /audit/requests.json?key=…&hours=…&path=/rc&failed=1` (Postgres `request_log`, §8). NOT Railway logs — they cap at 500 lines ≈ 13 minutes |
| "A call never reached me" / "taking it gave an error" | §5.13 — `GET /calls/history?hours=…&last4=…` (Postgres `call_events` + `call_claims`), NOT Railway logs: those cap at 500 lines ≈ 13 minutes. A `410` from `/calls/claim` is RingCentral saying the party is already gone — the caller hung up or somebody else picked up — never a throttle, which surfaces as `502` |
| Manager pipeline / oversight charts | `components/oversight/OversightTab.tsx` + `lib/oversight/oversightApi.ts` (+ `priority.ts`); reached via `/system-mgmt?tab=oversight` |

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
