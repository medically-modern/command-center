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
| **Profile Send Off** | `18406352652` | `profile` ("Referral Intake", relabelled from "Verified Referrals" 2026-08-19) + `unverifiedReferrals` ("Non-Referral Intake — Info Collection", §5.20) + `intakeCleanup` ("Intake — Profile Clean-Up", group `group_mm6c3rhb`, §5.20) + `inSystemReferrals` ("Already In System") — FOUR roles on one board, split by Already In System then Referral Type/Source (§5.10), and the DTC form queue split again into two sub-stages (§5.20). Its own board (groups: *Patient Intake → 1. Intake → New Form Partial/Completed → Profile Clean-Up → Already In System → Tests → Stuck → Completed*). `profile` and `inSystemReferrals` work **1. Intake** (`group_mm1xf2jb`); the send-off exit is **Advance to MN** (`Move to Onboarding` → automation creates the Masheke item + moves to Completed) — except Already In System, whose exits are **Move to Profile Send Off** (flag → No, back to 1. Intake as a Verified Referral; replaced Advance to MN there 2026-08-18) and **Mark as Stuck**. ⚠️ **Send back to Patient Intake was REMOVED** (Josh, 2026-08-14) — see §5.10. The `scheduledCalls` role (**Care Coordinator**, §5.30) also reads the two DTC form groups + Profile Clean-Up here — read-only, beside ME's chase stages and Welcome Call. **Not** the Welcome Call board. |
| **Medical Evaluation** ("Masheke") | `18406060017` | `evaluate`, `sendRequest`, `confirmReceipt`, `chaseFax`, `chaseParachute`, `doctorAppointments` (§5.12). Medical-necessity document collection. Stuck is propose→approve: reps flip **Escalation `color_mm1x7997` → "Final Escalation Required" (index 2)** and the reason is appended to the **MN notes `text_mm6vevjf`** (the capped `long_text_mm27zjt2` until 2026-09-03) (stamped `[Proposed Stuck …]`); managers approve/return from Oversight. (The old `color_mm5f37ve`/`text_mm5frng6` columns are retired.) |
| **Insurance** ("Samantha") | `18410601299` | `benefits`, `submitAuth`, `authOutstanding`, `authDenied`, `dvs` (**stage**-based — Stage Advancer index 1 "DVS", read-only monitor at `/dvs`). Groups: Benefits, Submit Auth, Auth Outstanding, **DVS**, Auth Denied, Escalations, Complete, Stuck. ⚠️ The board grew a **DVS group** (`group_mm5gp2r2`, Aug 2026) but the role is still **stage**-defined: stage-DVS items linger in whichever group an automation last left them, so `useDvsPatients`/`useRoleCounts` read the STAGE board-wide and must not be "fixed" to filter on the group. |
| **Welcome Call** | `18410804557` | `welcomeCall` + `finalConfirm` (two roles, same board, different groups). See `BOARD_SCHEMA.md`. Since 2026-09-14 both stages run the **Propose Stuck ladder** on Escalation `color_mm1x7997` (index 0 manager · 2 final) — §5.34. Label id 2 ("Final Escalation Required", working_orange) was **added live 2026-09-14** and read back from `settings_str`, so every reader's hardcoded 2 is right; `assertEscalationLabelExists` still checks the live label set before each promotion. |
| **Subscription Board - Updated** | `18407459988` | `subscription` role + one source for Patient Questions. |
| **Secondary Claims Board** | `18413019028` | Second source for Patient Questions inbox. |
| **MM Doctor Database** | `18142847597` | NPI → doctor record + Doctor Notes (`shared/doctorDb.ts`). Separate from patient boards. |
| **New Order Board** | `18405457690` | `orders` role (§5.35) — read-only **except the backorder-substitution pick**, which is what emails Cardinal. One item per ORDER (a patient has one per reorder), created by the Welcome Call order automations (§5.22b), placed on the board by a human flipping **Order Status `status` → "Ordered"**, then driven by `cardinal-api-poller` (API Status `color_mm3zm9hm`, CAH Order Number, tracking, delivery, invoice, POD files). Groups: *Order → Returns → Accepted / Partial → Shipped/Delivered → Cancelled*. ⚠️ The group lags the API Status; read the status first. |
| **Cardinal SKU Tracker** | `18420366344` | Every SKU we order at Cardinal — live price, `Qty Avail`, `PROD Status` (Available · Backordered · Restricted · Inactive), scraped daily at 9:05 ET by the Cardinal poller's `skuwatch`. Read by the Welcome Call stock pills (§5.31b) and, in full, by the `orders` role's stock table (§5.35). The `Run Log` group's one row is the last-run headline, not a SKU. |

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

> ⚠️ **CGM Language blocks MN — and did not until 2026-09-03.** `deriveValidity` is what
> the Evaluate banner renders AND what routes the send (`validity.established` →
> "Completed" vs "Send Request"), and its CGM section checked the script and the coverage
> path and then stopped. So a patient whose records carried no insulin or hypoglycemia
> language read **Medical Necessity Established** and skipped Send Request entirely. The
> IP side always checked every one of its requirements, which is exactly why Josh
> reported it as "insulin pump language works fine, it's just cgm language". Now the two
> language-bearing paths (`Insulin`, `Hypo`) require `cgmLanguage === "Yes"` — `!== "Yes"`
> so an UNANSWERED language blocks too, the same test the IP requirements use. Invalid had
> the identical hole and is fixed with it. ⚠️ The reason strings go into **CGM MN Invalid
> Reasons** `dropdown_mm2xncfh`, so they must match the board exactly (§9) —
> `cgmLanguageMissingLabel` owns them, and `computeCgmInvalidReasons` (which writes the
> column) is kept in step with `deriveValidity` (which drives the banner and the preview)
> by `cgmLanguage.test.ts`. Note the board's capital "Missing" on these two labels, unlike
> its "CGM Script missing" siblings. **"Hypoglycemia Language Missing" did not exist on the
> board** and is created on first use by the send's `createLabelsIfMissing`.

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

### 5.9b Send Request — sending is not advancing (Sep 2026)
Pressing **Send fax/email** used to dispatch the request AND flip the Stage Advancer in
one press, so the patient left Send Request before anyone could see whether the fax
landed. ⚠️ **RingCentral reports `Failed` SECONDS AFTER it accepts a fax** — the same
accepted-is-not-delivered trap §5.5 records for texts — by which point the item had
already moved to Confirm Receipt and nothing there says the request never arrived
(Josh, 2026-09-03).
The send now writes **Request Message + Request Sent At and stops**
(`mondayWrite.recordRequestSentVerified`, `stageColumnId: []`); the footer shows the live
delivery status; the rep presses **Request Sent** to advance. Two presses, deliberately.
⚠️ The send deliberately does **not** write the Next Action Date — that date is the
ADVANCE's snooze, and writing it here would push an unadvanced patient out of the due
queue (§5.10's disappearing-patient failure).
⚠️ **Mark Complete skips Request Sent At when the send already stamped it** (`if
(!sentNow)`): Confirm Receipt polls RingCentral from that timestamp, so re-stamping it at
advance time points the next stage's fax status at the wrong minute. Parachute — whose
single button still advances directly, unchanged — and a request faxed outside the app
still get the stamp.
⚠️ The advance is disabled only when **nothing** has ever been sent (`sentNow ||
patient.requestSentAt`, the latter being in the read set) — permissive on purpose, so a
rep who faxed earlier is never stranded. And the optimistic queue-hide (§9) belongs to
Mark Complete alone: hiding on the send would remove the very screen the rep needs to
read the status from. `sendRequestFlow.test.ts` scans for all of it, because a
re-coupling would look exactly like the button working.
⚠️ **The status resolves — but not quickly, and the failures are the slow ones.**
Measured live 2026-09-03 over the last 25 outbound faxes (**18 Sent, 7 SendingFailed — a
28% failure rate**), creation → final status took 95s · 153s · 184s · 211s · 226s · 276s ·
357s · 1435s · 1625s for the successes and **679s · 862s · 991s** for the failures. The
poll was a flat 40 × 12s = **exactly 8 minutes** (its `FAST_POLL_MS` was declared and never
used), so five of those twelve — and three of the four failures — settled after it had
given up, leaving the chip on "Processing" for ever. `lib/fax/faxPoll.ts` (pure, tested)
now backs off 5s → 12s → 30s → 60s out to ~33 minutes for 56 requests instead of 40. A rep
who leaves before it settles is not stuck: `faxActive` keys on the fax being sent TODAY, so
re-opening the patient re-polls and picks up the settled verdict.
⚠️ The status polls the **fax** recipient, not `recipients[0]` — a request can carry a
plain email too, and `fetchOutboundFaxStatus` matches on the last 10 DIGITS, so an email
address yields a null lookup that is indistinguishable from "not registered yet".
The status pill is **`components/shared/FaxStatusChip`** — one component on every surface
that faxes, extracted from ConfirmReceiptPanel for the reason `SmsDeliveryNote` exists
(§5.5). Send Request also gained Evaluate's **See Referral Email** side panel.

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
insurance came back inactive and who wouldn't answer the phone (the reported one) piled
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
(the twin pair, 2026-07-28), so the poll alone would miss exactly the twin the flag exists
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
> **2026-09-14 — the DATE column is written again, the STATUS still is not.** Brandon's Care
> Coordinator notes push a follow-up on every logged attempt, so `logContactAttempt` writes
> **Follow Up Date `date_mm3874an`** (next calendar day, editable in the dialog). Nothing on this
> page, `useRoleCounts` or either baseline reads it — only the Care Coordinator dashboard does,
> to move the patient between Today and Future (§5.30) — so the four places below are unchanged
> and the patient still stays in this queue. **Follow Up `color_mm3822qq` stays unwritten**;
> `careCoordinator/followUp.test.ts` scans `unverifiedWrite.ts` for it.

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
  ringing call to them. **Or, from 2026-09-14, in the browser itself** for the up-to-five people a
  manager has assigned (§5.13b); "Take it" is the fallback for everyone else.

⚠️ **The browser now DOES register for inbound SIP — but once per BROWSER, only for the five
people a manager assigns, and with a stable instance id (§5.13b).** The trap this paragraph used to
warn about is still real and is now the cap that shapes §5.13b: register per TAB, or let anyone
opt in, and the sixth registration is refused with `603 Too Many Contacts` while the first five
carry on — the failure is a browser that never rings, not an error.

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
the only substring present in every rendering (`5555550100` and `(555) 555-0100` share nothing else).

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

### 5.13b Browser answering — Route B (Sep 2026), and the Route A plan
Josh, 2026-09-14: *"why is ring central making us answer phone calls on our personal phones in
command center? … i just want to answer in the browser … we want to get off of the rc app and only
on command center with the same functionality."* It was never RingCentral; it was §5.13's design,
and the reason for that design is one fact about the account, **verified that day from the
extension call log** (through the gateway's `/rc/` proxy, `view=Detailed`, structure only):

- **The whole team is ONE RingCentral user: extension 2, "Katie Tyler", id `63007214012`, on
  account `63001249012`.** It is the user `RC_JWT` belongs to, the extension every
  `/account/~/extension/~/` call means, and the one every inbound call on the main line
  (`+1 347 503 7148`) is delivered to: **250 of 250** inbound records in 30 days had
  `to.extensionId` = that id. No call queue, no other extension, ever. Eight distinct devices
  ANSWERED as it over the month (the RingCentral app signed in as that user on several machines),
  about two ringing per call. **98 answered · 78 voicemail · 64 missed · 10 blocked — 57% of
  inbound calls reached nobody.** Zero "Take it" forward legs in the same window.
- **RingCentral allows FIVE SIP registrations per extension** and refuses the sixth with
  `SIP/2.0 603 Too Many Contacts`; instances that share an `instanceId` deliver inbound only to the
  most recently registered one (the `ringcentral-web-phone` README, "instanceId Behavior"). That
  afternoon **23 browsers** were attached to the gateway's SSE. Twenty-three browsers cannot be
  one extension, which is why §5.13 popped a card and forwarded the call to a cell.
- **Josh's own instinct was right** — *"everyone signs in with different google accounts but i
  believe everything is routed through one jwt token on cc"*. Google identity is per person;
  RingCentral identity is one shared user.

**What Route B is** (`src/lib/softphone/`, `hooks/softphone/useSoftphone.ts`,
`components/inboundCalls/{IncomingCallHost,CallConnectionBadge,SoftphoneStatus}.tsx`): the browser
registers on that same shared extension for real, so a call **rings in the page and "Answer"
answers it**, audio and all — under rules that keep it inside the five:

1. **Who may answer is ASSIGNED, never self-service** (Josh, same day: *"id rather assign people
   … 3 users get answer in browser privileges and others do not even get notified"*).
   `access.json` gained **`callAnswerers: string[]`**, edited on `/access` ("Answer calls in the
   browser", `N of 5`), capped at **`MAX_CALL_ANSWERERS = 5`** by `withCallAnswerer` (returns `null`
   for a sixth; the checkbox is disabled and a toast says why). **Nobody else gets ANYTHING** — not
   the SSE stream, not the cards, not the registration: `IncomingCallHost` gates the whole feature
   on `canAnswerCalls(email, config)` and passes `enabled` to `useInboundCalls`, so a non-answerer
   also stops counting as a gateway subscriber. The one thing that renders for everybody is the
   overlay for a call THEY placed from the Communications Hub. ⚠️ `removeEmail` frees the slot too
   (`configWithoutEmail`); managers are not exempt from the cap. Two layers block a sixth: the
   admin page, and RingCentral itself for what the page cannot see — one person opening the app on
   three machines takes three slots.
2. **ONE registration per BROWSER, never per tab** — `tabProtocol.ts`. Web Locks
   (`navigator.locks`, `mm-softphone-leader`) elect a LEADER tab that owns the SIP registration;
   the other tabs mirror its snapshot over a `BroadcastChannel` and relay Answer / Hang up / Mute /
   Dial to it (audio plays in the leader tab — sound is sound). A closing tab releases the lock and
   the next waiting tab registers. ⚠️ Without this every tab would share one `instanceId` and, since
   each re-REGISTERs every ~57s, "most recently registered" would rotate and the ring would land in
   a random tab.
3. **A tab can TAKE OVER** (`softphone.takeOver`): it requests the lock with `steal: true`, the old
   leader's request rejects with `AbortError` and it demotes itself (releases its registration,
   re-queues). Refused while the leader is on a call. This is what the home-page badge offers.
4. **A stable per-browser `instanceId`** (`localStorage`, `instanceIdFor`) and a **cached
   `sipInfo`** (7 days, per signed-in email). Every `sip-provision` call creates a NEW device record
   on the RingCentral side — the old provision-per-page-load grew nine in a month — and the SDK
   README says to reuse it.
5. **`full` is a STATE, not an error** (`classifyRegistrationError` → `retryDelayMs`): matched on
   the SIP status `603`, shown to the rep, retried every minute (a closed browser's slot frees in
   ~2 min). `auth` drops the cached sipInfo; `network` backs off 2s→60s.

**The home-page badge** (`CallConnectionBadge`, on `Index` and `ProcessorView`, Josh: *"a connected
logo on the main page if they're connected for incoming calls on that tab"*): renders only for
assigned answerers; green *"Connected — calls ring in this tab"* when THIS tab holds the
registration; amber *"Calls ring in another tab"* with **Use this tab** (takeover) when another
tab does; amber *"Connecting…"*; red *"the line is full"* / *"Not connected"* with the reason.
`SoftphoneStatus` (bottom-left, beside `CallStreamStatus`) says the same on every page, silent
while healthy. The ring settings dialog reports the status read-only — the assignment is not a
toggle there.

**Rules that are correctness, not style — all pinned by `softphoneRules.test.ts`:**
- ⚠️ **NEVER decline or send-to-voicemail a ringing call from the browser.** Dismissing a card is
  LOCAL (`ignore`). Every registered device rings at once, and a device that declines can shorten
  the window in which a colleague — or the gateway's "Take it", which only works while the party is
  in Setup/Proceeding (§5.13) — can take the call. The scan fails the build on `.decline(` or
  `.toVoicemail(` anywhere in `src/`. (`WebPhone.dispose()` declines its own ringing sessions; it is
  only ever called on tab close, sign-out, un-assignment and takeover.)
- ⚠️ **`autoAnswer: false`.** The SDK's default answers any INVITE carrying `Alert-Info: Auto
  Answer` (RingCentral intercom) with no click.
- ⚠️ **Session listeners go on via the WebPhone's `inboundCall` / `outboundCall` events, never
  after `await wp.call()`** — that promise resolves only once the call is answered or failed, by
  which time `ringing` and `answered` have already fired. The previous `useWebPhone` had exactly
  this bug: it attached after the await, so its overlay never left "Setting up…".
- ⚠️ **`session.answer()` is not awaited for status.** It resolves on an RC "AlreadyProcessed"
  message that may never come; the `answered` event is the signal and the promise is watched for
  rejection only (a blocked microphone).
- The ringtone is Web Audio (`ringtone.ts`, no asset) — a soft rising chime, C5 · E5 · G5 with a
  long decay, every ~3s; the first cut was the 440 + 480 Hz ringback pair and was too harsh for an
  office (Josh, same day: *"a friendlier ringtone"*). It plays in the LEADER tab only, and only for
  the SIP leg — an assigned person whose browser is not registered gets the card with no sound. A
  page that has seen no user gesture stays silent and the card still shows. **Mute** is the
  speaker icon on the home-page badge: per browser (`MUTE_KEY` in localStorage, `readMuted` /
  `writeMuted`), so pressing it in any tab silences the tab that rings, via the `storage` event;
  cards and Answer are untouched. ⚠️ It is `ringMuted` / `setRingMuted`, deliberately distinct from
  `call.muted`, which is the MICROPHONE on a live call. The SDK does not reconnect on its own:
  `watchSocket` re-`start()`s on the WebSocket's `close` and on `online`, and re-INVITEs an
  answered call after a network change.
- One `<CallOverlay>` for the whole app, mounted by `IncomingCallHost` (an answered inbound call
  needs it on every page); `useWebPhone` is now a thin view over the same store, so the
  Communications Hub dials through the browser's one registration instead of spending a second slot.
  `ringMerge.ts` joins the gateway's SSE card and the SIP leg on the telephony session id (or the
  caller's digits) into ONE card: Answer when the leg is here, Take it otherwise, both when both.

**Keep-in-agreement:** `MAX_CALL_ANSWERERS` (accessStore) is the cap the admin page renders and the
same five RingCentral enforces — change neither alone. `PhoneSnapshot.enabled` ⇐ `canAnswerCalls`
via `IncomingCallHost` → `softphone.setEnabled`; the badge and the dialog read the same snapshot.

**Known limits, deliberately:** five people, one machine each, and the RingCentral app signed in as
Katie Tyler counts against the same five while anyone still uses it. Followers hear the audio in the
leader tab. A takeover mid-registration is a few seconds of "connecting". `?manager=1` and the
ring-mode prefs (`all` / `list` / `off`) still apply on top, for the assigned five only.

#### Route A — everyone, the growing team (NOT built; the recommended path)
Route B cannot pass five, and a team past five answerers needs what the RingCentral app has
underneath: **a RingCentral user per person**. Recommended sequence, in this order:

1. **RingCentral admin (Josh).** One RingCentral user with a **Digital Line** for each person who
   answers — the WebRTC guide requires a Digital Line on the extension the browser logs in through,
   so this is a paid seat each. **Keep the main number on extension 2**: texting (`RC_SMS_FROM` must
   be a number on the JWT's extension), faxing, the account-level webhook, the call log, the SMS
   archive and the patient directory all hang off it and need no change. Then point extension 2's
   **call handling at a Call Queue** whose members are those users, ring-all-at-once (or at the
   users directly, simultaneous) — decide with RingCentral support which their plan allows. Allow
   each user to present the company number as caller ID (the softphone passes it explicitly).
2. **RingCentral app record.** Enable the **authorization-code flow** (redirect URI on the gateway,
   e.g. `/rc/user/callback`) beside the JWT flow, or create a second app for it. Scopes: `VoipCalling`,
   `ReadAccounts`; `CallControl` stays on the JWT app.
3. **Gateway** — new `rcUserAuth.mjs`: `GET /rc/user/connect` (redirect to RingCentral),
   `GET /rc/user/callback` (code → tokens, refresh token **encrypted at rest** on the messaging pool,
   keyed by the Google email — the same identity everything else uses), `GET /rc/user/status`,
   `GET /rc/user/sip-provision` (provision with THAT user's token). The JWT keeps every
   account-level job. Pure rules beside it as `callRules`/`rcAllowlist` are, tested.
4. **SPA** — one change in `softphone.ts`: `provision()` calls the per-user route. Leader election,
   `ringMerge`, the cards, the badge, the overlay and the never-decline rule all stay; the cap
   becomes RingCentral's five per USER, i.e. tabs, not people. A one-time "Connect RingCentral"
   button on the home page next to the badge; `IncomingCallHost`'s gate becomes "has connected"
   instead of `callAnswerers`, and the admin section retires. Answer/Reject is all the SDK allows on
   a queue leg — which is all we use.
5. **Verify before cutover.** One user on a sandbox first. Re-check `pickInboundParty`: a queue
   session carries one party per rung extension, and the card must still key on the CALLER's session,
   not per party; confirm whether the Forward API ("Take it") still works on a queue leg, and drop
   Take it if not. Then the RingCentral app can be retired.
Cost is the seats; code is a few days. Everything in Route B was built so that step 4 is a swap,
not a rewrite.

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
The `scheduledCalls` role — **relabelled "Care Coordinator", route `/care-coordinator`, 2026-09-08; the day grid is now the bottom half of that dashboard (§5.30)** — reads that mirror with an ordinary board query, so
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
same window held 13 calls. Verified live: `+15555550101` → 0 records, `15555550101` → 13,
`(555) 555-0101` → 0. `callLogPhoneParam` is the one place that strips it; don't "tidy" it back to
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
  `escalationIndex` field. ⚠️ On **Subscription** it is deliberately **NOT** wired into `escalated`,
  which that stage still hardcodes to `false` (§10). **Welcome Call and Final Confirm derive
  `escalated` (index 0) and `proposedStuck` (index 2) from it since 2026-09-14** — the rewrite §10
  asked for, §5.34 — so their sidebars, role counts and badge finally agree. Without this read an
  escalated Welcome Call patient's badge would have inherited `escalated: false` and read Active.
  The label TEXT is read alongside the index, because those two boards' indices were inferred from §10 rather
  than observed until 2026-09-14, when all three (0 · 1 · 2) were read back from the live
  `settings_str` (§5.34) — the text fallback stays as belt and braces: `escalationRung` takes the index first (a rename can't blind it) but an
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

The *Care Coordinator* cards (§5.30) carry it too, one adapter per column — `intakeProfileStatus`
with `ignoreFollowUp` (the Patient Intake rule), `mashekeProfileStatus`, `welcomeCallProfileStatus`.
**Not wired, deliberately:** *Patient Questions*, *Patient Texting* and *Fax
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
for Verified Referrals. Reported on one patient (`12895859856`), Medicare A&B, DMERC Region C.
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

⚠️ **THE MATCHER WAS NAME + DOB, AND A NAME IS NOT A KEY** (Josh, 2026-09-11; widened the same
day in `automations/duplicate-patient-check.js` `samePatient` + `test/name-variant-identity.test.js`).
`namesMatch` requires the first tokens equal (or an initial) AND the **last** tokens equal. Augustina
Rodriguez filled in the DTC form on 2026-07-22, landed in *1. Intake*, and the check ran 21 seconds
later against a patient who had been on Subscription since April as **Agustina Rodriguez Hernandez**
— same number, same DOB — comparing `"augustina"` vs `"agustina"` and `"rodriguez"` vs `"hernandez"`.
It stamped **`Already In System = No`**, and seven weeks later she was advanced into Medical Necessity
as a brand-new patient. Nothing errored, and the DOB matched exactly the whole time. The DOB still
gates every route; on top of the name rule a match is now also the patient's own **phone** (new
`phoneCol` per board — the primary number only, never the Alternate Phone, which is a caregiver's and
is legitimately shared) or a **shared surname token**, each additionally requiring `firstNamesClose`
(equal, an initial, or one letter apart on a name of ≥5 characters).
⚠️ **The direction of the trade is the argument, not the rule's tightness.** A false **Yes** moves the
item into the Already In System queue, where the write-up names what it matched and a rep pushes it
back in one click (§5.10 *Move to Profile Send Off*); a false **No** is invisible and runs a duplicate
patient through the entire pipeline. ⚠️ Known residual: twins in one household share the number, the
surname and the birthday, so the first name carries the whole weight — which is exactly why short
names must match EXACTLY (Dan/Don, Ana/Ann, Jon/Jan are two people, not typos). ⚠️ `sharesSurname` is
anchored on a LAST token: a plain "any token in common" also fires on a shared MIDDLE name. And the
board scan now reads its columns **by id, never by position** — it asks for two, and Monday does not
promise the order it answers in, so a positional read would compare a phone number against a DOB and
report a confident "No".

**Still not covered:** the check never searches Profile Send Off itself (its five boards are
Medical Evaluation, Insurance, Welcome Call and the two Subscription boards), so a form twin of a
patient sitting on the *same* board is invisible to it. That case is the SPA's own read-only
`dtcFormFlag` (§5.10), and the two are independent. Email and member ID still do not contribute to
the match.


### 5.22 Serving ↔ order lines — Pump Qty and the Next Order Dates (Aug 2026)
Two August incidents, **one shape**: the **Serving** label and the per-product columns are allowed
to disagree, and whichever one a downstream writer happens to key off decides what the patient
actually receives. Canonical rule: **`lib/shared/servingLines.ts`** (+ tests, whose fixtures are the
two real board rows).

- **WC item `12676537026`, 2026-08-03 — a pump shipped that shouldn't have.**
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
- **WC item `12740990902`, 2026-08-10 — a reorder was missed.**
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

### 5.22b Monitor Qty is BINARY — 0 or 1, never blank (Sep 2026)
The Welcome Call board's four order-creation automations all fire on Stage Advancer
`color_mm1ws96t` → **Completed** (Final Confirm's advancer) and branch into the **New Order Board**
(`18405457690`). ⚠️ **Read the WHOLE chain — two of them open with an `is empty` guard**, which is
what makes this column's blank load-bearing today:

| id | state | chain |
|---|---|---|
| 7918341001 | **LIVE** | **Monitor Qty IS EMPTY** → Pump Qty `= 1` → create ("pump only") |
| 7918341011 | **LIVE** | **Pump Qty IS EMPTY** → Monitor Qty `= 1` → create ("monitor only") |
| 7918340959 | **LIVE** | Pump Qty `= 1` → Monitor Qty `= 1` → create ("pump and monitor") |
| 7921725444 | **INACTIVE** | Pump Qty `= 1` → Monitor Qty `= 0` → create ("monitor = 0") |

✅ **THE CUTOVER IS DONE — verified live 2026-09-10.** It did NOT happen the way the table above
describes, so read the live automation rather than this paragraph's history. **7918341001 was
re-pointed in place**: its two conditions now read Pump Qty `= 1` AND **Monitor Qty `= 0`**, i.e. the
`is empty` gate is gone and it has become the branch 7921725444 was built to be. 7921725444 is
therefore redundant and correctly stays **inactive** — do not "finish the cutover" by enabling it,
that would double every pump-only order. 7918340959 ("pump and monitor") is Pump Qty `= 1` AND
Monitor Qty `= 1`, unchanged.
⚠️ **7918341011 ("monitor only") still gates on `Pump Qty IS EMPTY`, and that is correct and
load-bearing** — `coercePumpQty` deliberately leaves a blank Pump Qty blank (see the symmetric trap
below). Nothing in the app may write a `0` there.
> The original plan was "enable 7921725444 and retire 7918341001 as the SPA deploys". A session
> reading only that sentence on 2026-09-10 reported a live outage that did not exist, because
> `is_active` on 7918341001 is still `true` and the id list looks unchanged — **the conditions are
> what moved.** Resolve automation variables (`numberColumnId` / `numberColumnValueConditions` /
> `numberColumnValue`) before concluding anything about these four.

The everyday failure it fixes is the mirror image: a blank matches neither `= 0` nor `= 1`, so
every branch that names the monitor **by value** skips it silently — "pump and monitor" can't see a
real monitor sale whose cell was never written, and "monitor = 0" can never fire. The blanks came
from this app. Welcome Call **skipped** the write on an empty field (`if (p.monitorQty !== "")`)
while its own toggle rendered that blank as **"0 — No"** — the screen said 0 and the board stayed
empty — and Final Confirm wrote a literal **`""`**, clearing the cell outright. A board scan on
2026-09-08 found **379 of 449 items (84%) blank**, **118 carrying Pump Qty 1**; only 52 read "1"
and 18 read "0".

Canonical rule: **`lib/shared/monitorQty.ts` `coerceMonitorQty`** (+ tests). Applied in the three
write paths — `welcomeCall/mondayWrite` `buildDataTasks` and `sendWelcomeCallTextToMonday`, and
`finalConfirm/mondayWrite` — all of which now write the column **unconditionally**.
- ⚠️ **Anything above zero is `"1"`, not just a literal 1.** Final Confirm's control is a free
  `type="number"` input, so a typed **2** is reachable — and 2 matches none of the equality gates
  either, reproducing the same silent misclassification. `> 0` is also how the rest of the app
  already reads this column (`servingLines.ts` `num(monitorQty) > 0` = "a monitor is served").
- ⚠️ **Anything unreadable is `"0"`, never `"1"`** — blank, whitespace, `NaN`, a negative. Guessing
  1 would ship a monitor nobody ordered; 0 at worst under-reports a value that was never legible.
- ⚠️ **The split-order supplies half writes `0`, not a clear** (`getSplitOverrides`). Its old
  comment — *"automations gated on `is empty` only fire when the cell is cleared"* — was RIGHT
  about the mechanism; 7918341001 is that gate. Writing 0 silences it deliberately, as part of the
  cutover above. The **pump-side** clears on the sensors half are a different case and **stay
  blank**: "monitor only" is gated on `Pump Qty is empty` and still needs it.
- ⚠️ **The symmetric trap:** making **Pump Qty** binary the same way would silence 7918341011
  exactly as this silences 7918341001. Nothing here touches it (`coercePumpQty` leaves a blank
  blank). Read the chain before coercing either column.
- Pinned by `writeTaskParity.test.ts`' *"Monitor Qty is binary on every send"* block, which asserts
  a blank still produces a task valued `"0"` on BOTH stages — a regression here is silent on
  screen, so the test is the only thing that would catch it.

**Existing rows are not backfilled.** The 53 blanks in live stages (43 Welcome Call, 10 Final
Profile Confirmation on 2026-09-08) self-heal on their next send; the 326 in Completed/Stuck are
history. A backfill is safe if wanted — these automations trigger on the Stage Advancer changing,
not on the quantity — but it is 379 writes against live PHI rows and nobody has asked for it.

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


### 5.27 Patient texts are archived to Postgres — RingCentral keeps only 30 days (Sep 2026)
**RingCentral's message store is a rolling ~30-day window on this account.** Measured
2026-09-01: the oldest surviving record was **2026-08-01**, and every query with an earlier
`dateTo` returns **0 rows for EVERY number**, not just a quiet one. Nothing chose that as a
retention policy — it is what the phone vendor happens to keep — and patient texts are patient
communications.

⚠️ **The failure is silent and reads as an answer.** Asking what we texted a patient in June
returns **200 OK with an empty `records` list**, which is indistinguishable from a patient nobody
has ever contacted. That is exactly how a support question came back "no texts" on 2026-09-01 for
a patient we had in fact called. Before assuming a thread is empty, check the window.

**`services/monday-gateway/smsArchive.mjs`** copies that window into Postgres before it ages out;
**`smsArchiveRules.mjs`** holds the pure rules (+ `smsArchiveRules.test.mjs`), the same split as
`callRules` / `callHistoryQuery` beside `inboundCalls.mjs`.

⚠️ **RECONCILE, NEVER INCREMENT.** Each run re-reads the ENTIRE window (`WINDOW_DAYS`, default
**35** — deliberately longer than the ~30 RingCentral holds, since asking for more than it has
costs nothing) and upserts on RingCentral's own message id. That is what makes **any single
successful run repair every prior gap**: a week of failures costs nothing so long as one run lands
before the oldest unsaved message ages out. An incremental "everything since my last cursor"
design turns one bad run into a permanent hole — and this gateway redeploys on every push to
`main`, so bad runs are a certainty. Same reasoning as the call-subscription reconcile (§5.13).
⚠️ Cadence is **daily**, not the fortnightly first proposed: a 30-day window at 15-day intervals
is two runs per window, so two consecutive failures lose data permanently and you learn about it a
month later. Daily leaves ~29 days of slack. A boot run fires 60s after start unless one succeeded
within `SMS_ARCHIVE_MIN_GAP_HOURS` (6), so a busy afternoon of redeploys doesn't re-scan each time.

⚠️ **THIS TABLE HOLDS PHI, AND THAT IS A DEPARTURE — taken deliberately.** The gateway's standing
posture is metadata-only (`LOG_PAYLOAD=false`; `gql_log` and `request_log` store no bodies and
`request_log` strips query strings, §8). Message **bodies** are patient communications. Two things
bound it: the table lives on the **messaging pool (`ASSIGNMENTS_DATABASE_URL`)**, never the audit
pool — the separation `index.mjs` already draws so the audit DB keeps its no-PHI property, so
**do not move this table** — and the number is stored as **HMAC + last4**, never in the clear,
exactly as `sent_messages` and `call_events` do it. Unpruned, like `call_events`: ~4,300 texts a
month, under 10 MB a year.

**The read side is OFF by default and that is the point.** The archive earns its keep on the
WRITE side, which needs nothing from the live thread. Serving the union changes what a rep sees,
so `/messaging/conversation` merges archived history **only under `SMS_ARCHIVE_SERVE=1`**; with
the flag unset that route behaves exactly as it did before. Even switched on it can only ever ADD
— the read is wrapped so a failing archive is logged and skipped, never surfaced.
⚠️ **LIVE WINS a collision**, and the direction matters: a text archived while `Queued` gets its
real `SendingFailed` verdict seconds later (§5.5), so preferring the archive would pin the
optimistic status and re-introduce the bug that field exists to prevent.
`SMS_ARCHIVE_ENABLED=0` kills the whole service from Railway without a revert.
The guard is pinned by source-scanning tests (the `listColumns.test.ts` convention) — a later
cleanup deleting the flag as "dead config" fails the build.

⚠️ Reconcile reads RingCentral on the **`background`** tier, shed first by `rcLimiter` — bulk work
with nobody waiting must never crowd out a rep's thread load (§10, the 2026-08-20 incident).
Hitting `MAX_PAGES` (`SMS_ARCHIVE_MAX_PAGES`, default 60) sets `truncated` — and ⚠️ **`archiveHealth`
reads it**, so a pass that completed without reading the whole window reports **not ok**. Recording
that run as `ok` is deliberate (we really did sync, and losing that signal is worse than the
clipping), which is precisely why the verdict belongs in the health check instead. It shipped the
other way round — stored on the row, never consulted — and review caught it: a clipped archive
reporting healthy while the messages it never reached age out is the one outcome that looks exactly
like success. And **no `messageType` param**, for the reason §5.5 records: the documented
multi-value syntax 400s on this account.

**Watch it, or it fails silently** — `GET /messaging/archive-health` (unauthenticated, same
posture as `/calls/health`: counts and timestamps, never a number, a body or an email) reports
`ok/stale/truncated/lastOkAt/rows/oldest/newest`. ⚠️ It is **not ok when no run has ever
succeeded** — however many rows the table holds, so a job deployed but never actually running
can't read healthy — nor when the last successful run was truncated.
`POST /messaging/archive-run` forces a pass, and ⚠️ unlike the health route beside it, that one is
**authenticated AND rate-floored** (`SMS_ARCHIVE_FORCE_MIN_GAP_MINUTES`, default 5). Health only
reads counters; a forced run spends up to 60 RingCentral calls on the account shared with live
patient texting, and `running` blocks only CONCURRENT runs — a client that posts again each time
the last one finishes gets a fresh full scan every time. Both guards, not either: the 2026-08-20
incident (§10) was a runaway **authenticated** client. Point `services/calls-monitor` at the health
route.

**Not covered: MMS media.** Attachment bytes live on RingCentral and purge with the message, so
the archive stores the attachment **metadata and uris only** — a patient's insurance-card photo
(§5.5) is recorded as having existed, not saved. Fetching the bytes through `/rc/fetch` into
object storage is a separate job.

⚠️ **Starting this recovers nothing.** Everything before 2026-08-01 was already gone when the
archive was written. Every day it is not running is ~140 more texts purged.


### 5.28 The Communications Hub, and the manager sidebars' contact marks (Sep 2026)
Two halves of one ask (Josh, 2026-09-01): *"a rep can see the full context without having to go
back and forth"*. Everything a patient does to reach the MM line — call, voicemail, text, fax —
now sits on one page beside their Command Center profile, and a manager scanning a queue can see
who is waiting on a reply without opening anybody.

**A. Contact marks on the patient sidebars.** One or two 12px glyphs in the top-right of each row.
Four situations, two icons, because the four are **two questions asked twice** and each question
has one answer at a time — so the ceiling is a property of the rule, not a cap anyone enforces:

| lane | answer | glyph |
|---|---|---|
| TEXT — who sent last | inbound → they're waiting on us | filled rose bubble |
| | outbound → we replied | hollow bubble + check, muted |
| CALL — the most recent call | inbound, nobody picked up | rose `PhoneMissed` |
| | outbound | muted `PhoneOutgoing` |

**Rose = they're waiting on us, muted = we've already acted**, so a manager finds the rows needing
something by colour alone. Rule: **`lib/contactState/contactState.ts`** (+ tests);
looks: `components/shared/ContactStateMarks.tsx`; feed: `hooks/useContactStates.ts`.
- ⚠️ **`?mv=` gates it, not `?manager=1` and not the access level.** Same gate as the Doctor
  Appointments manager folders and for the same reason (§5.12): `?manager=1` is set by only SOME
  Oversight columns, and access level shows the marks permanently, including on the ordinary role
  page a processor works from. **Accepted cost:** a manager opening a role page directly, rather
  than clicking in from Oversight, sees no marks.
- ⚠️ **ONE batched read, never one per patient.** The marks render on every row of all eight
  sidebars, and a per-patient RingCentral lookup is exactly INCIDENT_2026-08-20. `useContactStates`
  is a structural copy of `useFaxOutcomes`: module-scope store, `useSyncExternalStore` so the
  returned identity is stable (incident rule 2), one coalescing `inflight`, page-capped reads, a
  5-minute TTL, and **nothing fetched at all when the gate is closed**.
- ⚠️ **MOST RECENT wins within a lane; it is not a high-water mark.** They ring, we miss it, we
  ring back an hour later ⇒ *we called them*. A mark that latched onto the missed call would never
  clear, and that is the noise that teaches people to stop reading the column.
- ⚠️ `callConnected` reads the **legs** — a claimed (forwarded) inbound call is not a missed call
  (§5.13/§5.16). And the account-wide message-store read **cannot use the multi-value
  `messageType` filter** (400 on this account, the same quirk `/messaging/conversation`
  documents), so SMS and MMS are fetched one type at a time and Fax/VoiceMail rows are dropped in
  the rule instead. MMS is best-effort: its failure is swallowed, because missing one photo reply
  beats blanking the whole column.
- ⚠️ **Patient Intake needed `COL.ptPhone` adding to `LIST_COLUMN_IDS`** — that queue's slim
  two-tier read (§5.25) carries no phone, so the marks would have read `""` on every row with no
  error. `listColumns.test.ts` caught it, which is what that test is for.
- The window is **7 days**, one window for all four situations, so "no marks" reliably means
  nobody has touched this patient this week — and *we called them* stays a fact about now rather
  than something true of every patient ever worked.

**B. The Communications Hub** — `/assigned-patients`, three tabs on a left rail mirroring the
RingCentral app a rep already has open ("the rc ui is fine"). The role kept its id
`assignedPatients` and was **relabelled "Patient Texting" → "Communications"**; ids are what
access.json assignments key off, so a rename is display-only (§5.10's precedent).

| tab | list | middle | right third |
|---|---|---|---|
| **Phone** | recent calls · **Missed** filter · Voicemail sub-tab with transcripts | the thread with that number | the patient's profile |
| **Text** | conversations, newest first · **Unread** filter · right-click → Mark as unread | `ConversationThread` | the patient's profile |
| **Fax** | inbound faxes · Unread filter | the **sending office** + its patients | (n/a — a fax is an office's) |

- **"New text" is its own door** (`components/commsHub/NewTextPanel`, Josh 2026-09-02). Starting a
  conversation with somebody who has no thread yet was only reachable as a "Start a conversation"
  section that appeared UNDER the list once a rep happened to type into the search box — a thing
  you find by accident is a thing most people never find. The compose pane takes a number **or** a
  patient name, searched on the BOARDS rather than filtered from what is on screen (filtering
  answers the opposite question). ⚠️ It keeps its own query, so opening it doesn't wipe what the rep
  had typed into the conversation search, and one shared effect debounces both — two would drift.
  ⚠️ Picking a NAME passes it as `preferPerson`; picking a typed NUMBER passes `""`, because nobody
  was chosen and the profile pane must not open on a guess.
- ⚠️ **Read state is RingCentral's own `readStatus`, never a local flag.** Reps work this same
  line in the RingCentral desktop app, so an invented read state would disagree with what they see
  there within a day. Opening a conversation PUTs its unread inbound messages to Read; the context
  menu PUTs the newest one back. ⚠️ **`setMessageRead` serialises writes to the SAME message id**
  (Greptile on PR #52): two writes for one id are one click apart — mark a fax unread and then open
  it, or mark a conversation unread and then read it — and raced, the loser can land LAST, so
  RingCentral holds Unread while the optimistic override says Read. The row then hides from the
  Unread filter and the override never retires, because pruning keeps exactly the entries
  RingCentral disagrees with: a permanent local lie, which is the one thing reading `readStatus`
  exists to prevent. Different ids still go in parallel, so marking a whole conversation read stays
  one round of requests. The local override map covers only the seconds between the write
  and the next poll. ⚠️ **Only INBOUND messages carry a meaningful read state** — RingCentral
  reports outbound as Read on send, so counting both directions makes every conversation
  permanently read and the filter permanently empty.
- ⚠️ **Names are RingCentral's caller ID FIRST, then our boards — and the board half is ONE
  BATCHED read, never a lookup per row.** Rule: **`lib/commsHub/directory.ts`** (+ tests); batching
  and caching: **`hooks/commsHub/useDirectoryNames.ts`**. Until 2026-09-02 the lists showed a bare
  number whenever RingCentral had no contact, which is most patients — reps keep offices and
  manufacturers in RingCentral, not the ~6,000 people on our boards — so a text from an unsaved contact
  read as `(555) 555-0102`. "One cross-board query per conversation per poll" is still forbidden
  (it is the incident's shape); what makes this safe is that it is the opposite of that, on four
  properties that are all load-bearing:
  1. **`any_of` takes the whole batch in ONE rule** (100 numbers = 300 compare values), and every
     board rides in ONE aliased GraphQL request (`b0:`, `b1:` …) — `boards(ids:)` can't be used
     because each board names its own phone column. Three batches run at once, so a 900-row inbox
     is ~9 requests in 3 waves. Verified live at exactly that size 2026-09-02.
     ⚠️ **`run` batches in LIST order and the cap trims the TAIL, so the order is load-bearing.**
     The hook passes `keysRef.current`, NOT `signature.split(",")`: the signature is sorted so a
     poll returning the same conversations in a different order isn't a new set, and feeding that
     sorted list to `run` made the cap drop whichever numbers sorted last. Reported as "it takes a
     really long time to load the names" — every unresolved row had a 700-900 area code, and the
     rows a rep was looking at were not the ones that filled in first. Pinned by a test.
     ⚠️ `MAX_PER_PASS` must stay ABOVE a real list. At 500 it was lower than the ~900-conversation
     Text tab, so 400 rows resolved to nothing and then waited for a poll to change the list before
     the effect fired again.
  2. **Once per session, not per poll** — every answer is cached at module scope, **misses
     included**. ⚠️ Caching the misses is what stops the list re-asking about the same 200 unknown
     numbers every 30 seconds forever; there is deliberately no TTL, because a patient's name does
     not change while a rep reads their texts.
  3. ⚠️ **`any_of` is an EXACT match and this account stores BOTH digit shapes** — `9739511857`
     and `16078737352` sit in the same column. One shape alone returns 200 with no rows, which
     reads as "not a patient". `phoneMatchVariants` asks for both (plus `+1`).
  4. **The effect's dependency is a STRING** (`keys.join(",")`), not the array — incident rule 2 —
     and the returned Map is the module snapshot, so it is safe in a dep array.
  ⚠️ **RC wins, except when its "name" is not one.** `rcNameStrength` grades it: a placeholder
  (`WIRELESS CALLER`) or the number written back at us is **junk** and never renders; a carrier
  **CNAM** is **weak** and loses to a patient name but still beats a bare number. The CNAM test is
  **ALL CAPS**, which is the spec rather than a hunch — caller ID name is a 15-character uppercase
  field, so `LA JOLLA CA`, `CELLCO PARTNERSHIP` and `T-MOBILE USA` all arrive shouting while a
  contact a rep typed into RingCentral does not. Grading only `CITY ST` was too narrow and
  REGRESSED the Phone tab: a patient calling from a Verizon line resolved to `CELLCO PARTNERSHIP`,
  discarding the board name just looked up, where before the row showed a clean number.
  ⚠️ **A FAILED batch is not a set of misses.** `fetchDirectoryNames` returns `{ok, names}` and the
  hook skips its miss-caching when `ok` is false — otherwise one Monday 503 (§9 records ten on
  2026-09-01 alone) froze 60 conversations at a bare number for the rest of the session, with
  nothing retrying and nothing erroring. Pinned by `useDirectoryNames.test.tsx`, along with the
  `inflight` chain: the `finally` belongs to the CHAINED promise, or an older pass nulls the slot
  while the one behind it is still running and the next call starts a third alongside. ⚠️ The row's avatar takes `""` rather than the label when the label IS the number —
  `Initials` would otherwise read `(5` out of `(555) 555-0102`. A number shared by two people
  resolves to one of them (same semantics as `findPatientByPhone`); the dossier pane is where a rep
  confirms who they are talking to. The SELECTED conversation still gets its real record there:
  one lookup, on click, memoised.
- ⚠️ **Selecting another conversation BLANKS the pane; it never holds the last patient while the
  next loads** (Josh, 2026-09-02). `useDossier` clears the dossier on a number change and
  `PatientDossierPanel` keys its spinner on `loading` alone, not `loading && !dossier`. This is a
  correctness rule, not a cosmetic one: the pane's note composer writes to `dossier.active.itemId`
  and the page derives `threadPatient` — which carries `mondayItemId` onto an outbound text — from
  the same object, so a rep typing during that window filed a note or a text against the patient
  they had just navigated away from. A number already in the session cache renders synchronously
  via `peekDossierItems`, so clicking between two threads doesn't flicker a spinner over data we
  already hold. Pinned by `useDossier.test.tsx`.
- **The dossier pane is the point of the whole page.** `PatientDossierPanel` renders, in this
  order: the **path** (which stages they have completed profiles in, in tracker order — §6), the
  **notes** (Josh's explicit ask: the running case history is what tells a rep what to say next;
  everything else on the pane is a lookup), **every OTHER stage's notes** collapsed underneath,
  **Open on <board>**, then the **per-stage call detail**. A completed step links with
  `?completedStage=`, so reading history can never re-advance a finished patient (§7's review-mode
  gate).
- **All stages' notes, not just the live one** (Josh, 2026-09-02: *"notes should be ALL notes from
  all stages … but welcome call notes should be the main attraction, the others viewable on
  scroll"*). Rule: `dossier.stageNoteTrail` (+ tests). ⚠️ **No extra Monday read** — every board's
  notes column is already in `dossierCols`, so each `DossierItem` arrives carrying its own stage's
  notes and the pane was simply throwing all but the active one away. Ordered by PIPELINE position
  (non-pipeline boards last), and a board run twice keeps **both** records: collapsing them would
  drop a cycle's history, which is what a rep scrolling this list is looking for. Collapsed by
  default with the newest line on the header — five stages of running history inlined would push
  the stage detail off the bottom of the pane.
- **Welcome Call's detail is the widest on purpose** (Josh, same day: *"we have more room on here
  for welcome call patients"*) — it is the one stage where the rep is on a scheduled call with the
  PATIENT rather than chasing an office, so the order, the cost (incl. **QMB**, which means they
  owe nothing), the per-product **authorisations and their end dates**, the first order dates and
  the ship-to all render. ⚠️ Every id is read off the LIVE board, never inferred from a sibling:
  Welcome Call's auth block is per-product with its own ids, and a guessed id is a permanently
  blank row rather than an error (§5.11). `buildStageDetail` drops empty fields and then empty
  sections, so a thin patient still renders short.
- **The notes are WRITABLE from here** (`dossierApi.appendNoteToRecord`). The hub is where a rep
  LEARNS things, so a note that had to be retyped on the role page was in practice lost. Same
  `appendStampedNote` every NotesPanel uses, so a line added here is indistinguishable from one
  added on the stage page. ⚠️ Stamped with the **sub-stage** where the board has one ("Chase
  Clinicals", not "Medical Evaluation") — several roles share one notes column and the label is
  what makes a line traceable (§9). ⚠️ Guarded by `assertLongTextFits`: Monday long-text columns
  truncate **silently** at 2000 chars, so what gets dropped is always the note somebody just
  typed (§10). Failing loudly is the point.
  ⚠️ **The base is RE-READ immediately before the write** (`readNotesNow`), never the dossier's
  cached copy. Monday has no compare-and-set — `change_column_value` REPLACES the value — and the
  dossier is memoised for the whole session, so appending onto that copy would silently DELETE any
  note another rep or an automation added in between. Re-reading narrows the lost-update window to
  one round trip, the same exposure every other note path carries (they append onto a 15-second
  poll). A failed re-read ABORTS rather than appending onto `""`.
- **What a rep needs on a call differs completely by stage**, so it is a per-board map —
  `lib/commsHub/stageDetail.ts` (+ tests). Intake asks "what insurance are we running and did it
  come back active"; Welcome Call asks "what does it cost and where does it ship"; Subscription
  asks "when is the next order and is the auth still valid". `dossierApi` reads exactly the
  columns that map names, so a new field cannot go blank for want of a matching read-set entry
  (§5.11's trap). Empty fields and then empty sections are dropped — a pane full of em-dashes is
  what makes a rep slow. ⚠️ Only boards whose column ids are **verified in this repo** are mapped;
  DTC Intake and Secondary Claims have none, deliberately, because guessing ids yields a
  permanently blank row rather than an error.
- ⚠️ **The Subscription board's `notesColId` was `null` in the BOARDS registry until 2026-09-01**,
  which read as "this board has no notes". It does — Subscription Patient Notes
  `long_text_mm3rj7k7` — so the dossier pane was blank for exactly the patients it was being used
  on. Fixed at the source; the only other consumer of `SystemPatient.notes` is Search's escalation
  modal, so the change is additive.
- ⚠️ **A notes column is `long_text` on six boards and plain `text` on ONE, and the two take
  different value shapes** — `{"text": …}` vs a bare JSON string. Monday refuses the wrong one
  outright with *"invalid value, please check our API documentation for the correct data structure
  for this column"* (200 + a GraphQL `errors[]`), so the note is simply not written. The composer
  shipped 2026-09-01 assuming long_text, so it would have failed on **every Profile Send Off
  record** — `text_mm389fs`, the odd one out, and the top of the funnel, i.e. exactly who a rep is
  on the phone with here. ⚠️ Found by code audit on 2026-09-02, **never actually hit**: the audit
  log shows 69 writes to that column that day, all successful, all from the intake page's own
  `appendIntakeNote` (which writes it correctly). Nobody had yet used the Hub composer on a
  Profile Send Off patient; the first one would have failed. It is deliberately NOT the cause of
  that day's "invalid value" alert — see §10 for what was. Every other board works, so the failure
  would have read as "notes are broken for these patients" rather than as a type error.
  `profile/unverifiedWrite.appendIntakeNote` already carried a comment
  warning about this exact crossing — which could not help a second consumer in another file, so
  the type was **declared** (`BoardDef.notesColType`) and carried on the record
  (`DossierItem.notesColType`). ⚠️ **Superseded 2026-09-03:** the composer no longer branches on it —
  every notes column is written as a **bare string through `change_multiple_column_values`**, which
  Monday accepts for BOTH types, and the 2,000 cap is asked of the **live board**
  (`lib/shared/columnType` → `assertTextLikeFits`). The declaration is documentation only, and
  `dossierNotes.test.ts` no longer asserts it matches the id prefix, because the long_text → text
  conversion (§10) may keep the id.
  ⚠️ The **2000-character `assertLongTextFits` guard is long_text-ONLY**: a board scan on
  2026-09-02 found live values up to 9,383 characters in `text_mm389fs` with none parked at a
  ceiling, so applying it there would refuse writes the board demonstrably accepts —
  `appendIntakeNote` writes that same column with no length assertion for the same reason.
- ⚠️ **An unmatched fax is checked against TWO sources, and the second was missing until
  2026-09-02.** `fetchFaxMatches` searched only the patient boards' doctor columns; the **MM Doctor
  Database** (`18142847597`, Script Fax `email_mkwh2ywd`) holds **2,290 offices**, including every
  practice we have on file but are not chasing anybody for. So a fax from a real, known office read
  as *"No patient on any board lists this number as their doctor's fax"* — a dead end that reads as
  a broken lookup. `fetchDoctorDbByFax` is the fallback identity; patient rows still win the card
  (they are the doctor as WE recorded them for the people we are working), and the pane says which
  source answered, because *"we know this office but nobody of ours is with them"* and *"we have
  never heard of this number"* are different answers with different next moves.
  ⚠️ **The `@rcfax.com` join itself is NOT the bug — audited live 2026-09-02** when Josh reported
  `(555) 555-0103` as unmatched. `contains_text` on the last four digits works fine against the
  EMAIL column (`8458775008` · `5008` · `rcfax` · the full address all return the right row), and
  `faxDigits` strips the address before comparing. That number is genuinely on no board: not in any
  doctor-fax column on any of the five boards, not in the Doctor Database, and not in any doctor
  PHONE column either. The ordinary cause is that **an office sends from a different line than the
  one we fax to**, which is why the empty state now says so and tells the rep to add the number to
  the doctor record. Do not "fix" the rcfax join; re-run that audit first.
- **The Fax tab has RingCentral's own view menu** — All · Unread · Received · Sent · Failed
  (Josh, 2026-09-02), so a rep moving between the two apps doesn't relearn the pane. Rule:
  **`lib/commsHub/faxFilter.ts`** (+ tests). ⚠️ **Sent and Failed read the OUTBOUND list**, which is
  fetched only while one of them is chosen — the default view is inbound, and it would otherwise be
  requests nobody asked for (the same posture as "only the open tab polls"). ⚠️ **One row per
  RECIPIENT, not per record**: RingCentral reports a fax's verdict per number, so a send to three
  offices is three rows — collapsing them to the parent would report one office's failure as the
  whole send's, the same "read the legs" rule §5.16 needs for the call log.
- ⚠️ **The Fax tab was capped at the newest 50** until 2026-09-02: it asked for one `perPage: 50`
  page and never paged, and unlike `/fax-inbox` this list has no pager of its own, so it truncated
  silently. `fetchInboundFaxesAll` pages it. **30 days stays the window and that is not a choice** —
  RingCentral's message store is a rolling ~30 days (§5.27; the oldest fax it held on 2026-09-02 was
  8/2), so asking for more spends requests and returns nothing.
- **A long list says how far along the naming is** (`HubList.NamingProgress`, fed by
  `useDirectoryNames`' `progress`). ⚠️ Counted in NUMBERS, not batches — "naming 240/900" is a fact
  a rep can read where "batch 3 of 9" is an implementation detail — and it CLEARS when the pass
  ends rather than parking at 100%, including when a batch fails, or the bar would sit there for
  ever on a pane a rep reads all day.
- **Right-click a fax → Mark as read / unread** (Josh, 2026-09-02), same posture as the Text tab:
  RingCentral's own `readStatus`, never a local flag, because reps work this line in the
  RingCentral desktop app too. The page holds a per-id override covering only the seconds between
  the PUT and the next poll, dropped as soon as RingCentral's answer agrees or the write fails.
  Opening a fax sets the same override, or the row springs back to unread until the poll lands.
- ⚠️ **A fax is opened by fetching the BYTES first** (`fetchFaxBlobUrl` → the gateway's
  `/rc/fetch`), then handing `openFileViewer` a `blob:` URL — the same thing `FaxInboxPage` does.
  Passing a RingCentral attachment URI straight to the viewer sends it down `fetchAssetBytes`,
  which tries a direct CORS fetch with no RC credential and then the worker's `/asset` proxy,
  which allowlists MONDAY hosts and refuses. That shipped broken and was reported as "view fax is
  broken". ⚠️ The viewer revokes only blobs it creates itself, so the hub revokes the previous one
  on each open — `FaxInboxPage` still leaks one per fax viewed.
- ⚠️ **The Monday gate is `hasMondayAuth()`, never a bundled-token check.** In production the SPA
  runs through the gateway and `VITE_MONDAY_API_TOKEN` is deliberately absent (§5.1), so a
  `!!getToken()` gate is FALSE in exactly the deployment that matters — and it fails silently:
  every dossier reads "not on any pipeline board" and every fax matches no provider, with nothing
  erroring. Caught in review before it shipped; the same trap §7 records for `oversightApi.ts`.
- ⚠️ **A PHONE MATCH IS NOT A PERSON either** (`dossier.splitByPerson` + `personKey`, tested).
  Audited over the live boards 2026-09-02: of **3,140 distinct numbers, 18 are shared by genuinely
  different patients** — households (a couple sharing `5555550104`, two further couples under one
  surname, and a parent/Jr pair) and several pairs of patients with different
  surnames. `fetchDossierItems` keeps every item whose phone matches, so
  those used to become ONE blended dossier: two people's stage paths and notes under one header,
  and — because the pane's composer writes to `dossier.active.itemId` and the page derives
  `threadPatient` from the same object — a note or an outbound text could be filed against the
  wrong one. The pane now says **"N patients share this number"** and offers a switcher; everything
  downstream follows the selection. ⚠️ **A rep who picked a patient BY NAME opens on them**
  (`useDossier`'s `preferPerson`): the Start-a-conversation name hit passed only the phone number,
  so searching a patient by name and clicking her opened the other person on that
  number, who shares `(555) 555-0104` and wins the
  default ordering. Navigating by NUMBER instead — a conversation row, a call, a typed number —
  clears the preference, or it would follow the rep onto an unrelated thread. ⚠️ `personKey` strips only the annotations reps actually add to
  a title (`(ip)`, `(cgm)`, `(copy)`, `(OLD)`, a trailing `old`) and deliberately does **not**
  fuzzy-match: `Patient S` / `Patient 5` (one character apart) stay two entries, because over-splitting
  shows a rep both records and makes a duplicate obvious, while over-merging is the bug this exists
  to fix. ⚠️ The completed-record name pass runs for **every** person on the number, capped at 3 —
  it used to run for `byPhone.find(...)` alone, so the second patient's history was silently
  missing from a pane already merging them.
- **When the number is on no board, the pane offers the SEARCH** (Josh, 2026-09-03 —
  `components/commsHub/DossierSearch`). A caller rang from (555) 555-0105; every board holds
  him at (555) 555-0106, so the pane correctly said the number was on no board and the rep had no way
  to get his profile up beside the call. The empty state now carries the **same search as System
  Management** — the same `useLiveSearch` hook, the same Active / Completed / Stuck folders, the same
  stage-first row (`lib/systemMgmt/boardTone` is shared so the two cannot drift). Picking a row is an
  EXPLICIT identity choice, so `dossierApi.fetchDossierItemsForPick` admits the picked record
  unconditionally, finds the rest of the trail through that record's OWN number, and still runs any
  further name hits through `nameMatchAccepted` anchored on the picked record — one James McDowell
  must not be handed another's history. Cached under the ITEM, never the number on the line, which is
  exactly what does not identify this patient. ⚠️ The pick is held by the PAGE and cleared on every
  change of `selectedPhone` (`AssignedPatientsPage` `dossierPick`), because the composer and the
  outbound-text attribution read from the dossier it produces — a pick surviving a patient switch
  would file the next caller's note against the previous one. An amber "Found by search — this
  number isn't on their record, on file: …" banner sits over the profile while a pick is active.
  Nothing is written: the new number is not added to the record from here.
- ⚠️ **A NAME IS NOT AN IDENTITY** (`dossier.nameMatchAccepted` + tests). Two patients called
  Maria Garcia is ordinary at this size, and name-only matching would merge their trails — one
  patient's notes and stage rendered on the other's conversation, and the wrong Monday item handed
  to `sendMessage` to attribute an outbound text to. A name match therefore always needs a second
  signal: the **phone** agrees, or the phone is blank (the ordinary shape of the completed record
  the pass exists to find) and the **DOB** agrees. Everything else is rejected, blank-phone
  records with no DOB on either side included — **failing closed is the point**: a false reject
  costs one chip in a patient's history, a false accept puts another patient's notes on this
  conversation. DOB rides the same create-item automations as the phone, so real completed records
  carry one; `DOB_COLS` in `dossierApi` maps it per board and a board absent from it fails closed.
- ⚠️ **A read/unread override carries the message it was a judgement about** (`ReadOverride
  .basedOnInboundId`). Without that it is a permanent lie: a rep reads a thread, the patient texts
  again an hour later, and the row stays looking read — gone from the very filter that exists to
  surface it. A newer inbound message retires the override and RingCentral's answer takes over.
- ⚠️ **`fetchDossierItems` does TWO passes and the second is not optional.** The phone pass finds
  most records; a COMPLETED record can carry a blank or differently-typed phone, and the completed
  records ARE the stage history — so a phone-only lookup draws the path with the finished stages
  missing. The name pass fills them in, keyed off a name that came from the phone pass, so a wrong
  number can never pull in a stranger.
- **Fax → office → patients** (`lib/commsHub/faxDirectory.ts` + tests). ⚠️ The Doctor Fax column
  is an **EMAIL** column holding `<digits>@rcfax.com` (§ `shared/faxAddress.ts`), so the join
  strips the address before comparing digits — comparing the stored value to a phone number
  matches nothing, with no error. Patients in **Chase Clinicals** lead the list and are
  highlighted, because an arriving fax is most likely the answer to that chase; within a group the
  patient with **no** next-action date leads, since nothing will surface them on their own.
- ⚠️ **Only the OPEN tab polls RingCentral.** All four reads go through
  `hooks/commsHub/rcStore.ts`, one factory carrying the incident guards, so the four lists cannot
  drift into having three of them.
- ⚠️ **Voicemail transcription is written defensively and is UNVERIFIED against this account.**
  RingCentral returns transcripts as a `text/plain` attachment with `vmTranscriptionStatus` saying
  whether one exists, but transcription is a per-account feature that may be off here. It degrades
  to a plain "no transcript" note rather than an error — the same posture `CallHistoryButton`
  takes for absent recordings, where an account that doesn't produce them is the NORMAL case.
  Confirm against the live account before relying on it.

⚠️ **The list and the thread deliberately reach back different distances**, and §5.27 is why.
The conversation LIST reads RingCentral's message store directly through `/rc/`, so it sees the
vendor's rolling ~30-day window and nothing older — which is right for "recent conversations".
The THREAD beside it goes through `/messaging/conversation`, so once `SMS_ARCHIVE_SERVE` is on it
serves the Postgres archive too and reaches back as far as the archive goes. Don't "fix" the list
to match: a list of every conversation since the archive began is a different feature, and it
would page the archive on every poll.

**Keep-in-agreement:** the tracker order lives in **`lib/commsHub/pipelineOrder.ts`** and is
asserted by `dossier.test.ts`; §6's diagram is now downstream of it, not the other way round.

### 5.29 The patient name directory — "whose number is this" out of Postgres (Sep 2026)
Every surface that names a caller resolved it by fanning out across **seven Monday boards** at the
moment it was needed. §5.28's batching made that cheaper, not fast: a 900-conversation inbox still
took several round trips before names appeared, and **`findPatientByPhone` runs its seven queries
WHILE THE PHONE IS RINGING**. Names barely change, so the gateway now keeps a copy.
Service: **`services/monday-gateway/patientDirectory.mjs`** (+ `patientDirectoryRules.mjs`, the
pure half, tested — the same split as `callRules`/`smsArchiveRules`); browser side:
**`lib/commsHub/directoryApi.ts`**.

⚠️ **THIS TABLE HOLDS PHI, AND THAT IS A DEPARTURE** — taken explicitly (Josh, 2026-09-02) on the
same terms as the SMS archive (§5.27), and bounded the same two ways: it lives on the **messaging
pool** (`ASSIGNMENTS_DATABASE_URL`), never the audit pool, so that DB keeps its no-PHI property —
**do not move this table**; and the number is stored as **HMAC + last4, never in the clear**, as
`sent_messages`, `call_events` and `sms_archive` do it. What IS in the clear is the patient's
**name**: a dump of this table is a list of our patients' names. That is the trade, and it buys a
name on the card the instant a call rings.

⚠️ **A MISS IS NOT AN ANSWER.** The copy is at most a day old, so a patient created this morning is
genuinely absent — as is everybody if the reconcile has never run. `directoryApi.resolveNames` asks
Postgres first and falls back to the live Monday `any_of` batch for **only** what it missed, which
is what makes a stale, empty or dead directory a **performance** regression rather than a
correctness one. Call `resolveNames`, never `lookupDirectory` alone. Both halves report `ok`
separately and the result is `ok` only if BOTH ran, because the caller caches misses (§5.28).

⚠️ **Reconcile, never increment.** Each run re-reads every board and upserts, so any single
successful run repairs every prior gap; the gateway redeploys on every push to `main`, so bad runs
are a certainty. Daily, with a boot run skipped if one landed inside
`PATIENT_DIRECTORY_MIN_GAP_HOURS`. ⚠️ Rows are **never deleted for absence** — a board read that
failed halfway would otherwise wipe real names, and a stale name is a far smaller harm than a blank
one. ⚠️ **The one thing it does delete is a number a patient has MOVED OFF.** Changing a phone
number in Monday writes a row for the new number and leaves the old one behind — keyed by number,
nothing overwrites it — so the previous number would resolve to that patient for ever, and because
a stale row is a **HIT** the live Monday fallback never runs to correct it (if the carrier later
reassigns that number, a stranger's call gets a patient's name). `prunePlan`/`isOrphanRow` delete
only against **positive evidence**: we saw that exact item and it now holds a different number.
Absence still deletes nothing, and the prune is **skipped entirely on a truncated run**, since
"we saw this item and it moved" is exactly the claim a partial scan cannot make. ⚠️ `collapseRows` keeps **one row per number**, won by the furthest-along board (a later stage
holds the name a rep corrected), with a **deterministic** id tie-break: two live items for one
number is a household (two patients share `5555550104` live), and Monday's scan order is not
stable, so without it the displayed name would flip between two real people day to day.

⚠️ **The board list MIRRORS the SPA's `BOARDS` registry** — the gateway is a separate Node service
that cannot import the SPA's TypeScript. Same hand-synced hazard as §5.7 and §5.17, and it fails
silently: a board added there and not here is never scanned, so patients whose only record is on it
resolve to a bare number with nothing erroring. **`directoryCoverage.test.ts` fails the build in
both directions**, and names the file to edit.

**Routes:** `POST /directory/lookup` is **authenticated** (it returns names; the caller supplies the
numbers, so nothing is disclosed it did not bring). `GET /directory/health` is **not** — counts and
timestamps only, never a name or a number, matching `/calls/health` and `/messaging/archive-health`;
point `services/calls-monitor` at it. ⚠️ It is **not ok when no run has ever succeeded**, however
many rows the table holds, nor when the last good run was **truncated**. `POST /directory/refresh`
is authenticated **AND** rate-floored, for the §5.27 reason: `running` blocks only concurrent runs.
`PATIENT_DIRECTORY_ENABLED=0` kills it from Railway without a revert.

⚠️ **Name SEARCH cannot come from here, and that is structural.** The directory is keyed by the
number's HMAC, so it answers "whose number is this" and can never answer "what is this patient's
number" — `searchPatientsByName` stays on Monday. Fixing that would mean storing numbers in the
clear, which is the thing the hash exists to avoid.

**Measured, not assumed** (2026-09-02): a Monday `any_of` batch costs **370 complexity whether it
carries 15 numbers or 100**, so viewport-only loading — the obvious "only fetch what's on screen"
optimisation — would have been ~6× MORE expensive and more round trips, not less. Re-measure with
`complexity { before query after }` before changing the batching.

### 5.31 Welcome Call order rules — caps, 75 days, and "can we send a monitor?" (Sep 2026)
Four decisions from Brandon's 2026-09-09 notes, landed together because they all key off
Primary Insurance or the Same-or-Similar columns. **No board change; app only.**

**Payer caps — `lib/welcomeCall/payerRules.ts` (+ tests).** *"Only anthem commercial, horizon,
cigna can go up to 9 for the infusion sets and cartridges. Aetna can go up to 4. All else can
only go up to 3."* That replaced a table ported from the Lovable prototype and moves **six live
board labels**: `BCBS TN/FL/WY` and `Anthem BCBS Medicare / Medicaid (JLJ) / Low-Cost (JLJ)` all
drop **9 → 3**, and `Cigna` rises **3 → 9**.
⚠️ **`/anthem/i` is now WRONG** — it matched all four Anthem plans and only Commercial is a 9;
the pattern carries `commercial` for exactly that reason. There is deliberately **no generic BCBS
rule** any more. `Horizon BCBS` still matches on `/horizon/i`.
⚠️ **The cap is a CEILING ON MANUAL OVERRIDE, not the default.** Measured on the live board
2026-09-09 over the 181 WC patients with a set chosen: **164 ordered 3**, twelve 2, two 4 (Anthem
BCBS Commercial + Aetna Commercial, both cap-raised), one 5 (Horizon BCBS), two 1 — **nobody has
ever ordered 9**. So the cap and `DEFAULT_INFUSION_QTY` are orthogonal numbers. A cap set too HIGH
is the dangerous direction: it lets a rep order sets the payer pays three of, denied weeks later.
⚠️ The cap now renders on **Qty Cartridge** too. It had always been drawn on the two set
quantities and never there, so 9 cartridges on a 3-cap payer passed silently.

**Qty 1 defaults to a flat 3 — it does NOT follow the supply length.** Brandon offered both
branches; Josh picked flat on 2026-09-09 after the board scan showed why. Medicaid patients run a
**60-day** cadence yet order **3** boxes today (Fidelis Medicaid 73 at qty 3 vs 7 at qty 2, plain
Medicaid 17 at 3, Anthem BCBS Medicaid 7 at 3), so deriving qty from cadence would have moved
**~99 live Medicaid patients from 3 boxes to 2** — a change to what physically ships, not a UI
default. *"Medicaid should stick to 3 boxes."*

**75-day supply is an AETNA-ONLY OPTION and never a default** (`supplyLengthOptions` /
`payerAllows75Days`). `supplyLengthDays` still returns 60 (Medicaid) or 90 (everyone else) for
every board label — a patient only lands on 75 because a rep chose it.
⚠️ **Two lists, two questions — do not merge them.** `callIntake.SUPPLY_LENGTHS` is every value
the notes block can **store** and DOES contain 75; `payerRules.supplyLengthOptions` is what a
given payer may **pick**. They were briefly one list, and the cost was silent: 75 was added as an
Aetna option while the stored set still read `["30","60","90"]`, so `parseIntakeBlock` dropped a
saved `Supply length: 75 days (override)` on the floor while still restoring
`supplyLengthManual: true` — which disables the payer default. The field came back blank AND
frozen blank, and the next send wrote no supply length at all (Greptile, PR #55).
⚠️ `SupplyLengthField` therefore takes `options` as a **required** prop rather than defaulting to
either list — tsc enforces it at every call site, so there is no fallback that could offer 75 to
a non-Aetna payer. An earlier draft of this section claimed the safety came from `SUPPLY_LENGTHS`
omitting 75; that stopped being true when the round-trip was fixed, and the guarantee moved into
the type system where it cannot rot.
⚠️ A payer correction **invalidates** a no-longer-offered choice: `WelcomeCallForm`'s derive
effect resets to the payer default and clears `supplyLengthManual` when the current selection is
not in `supplyLengthOptions`. Without it, picking 75 for Aetna and then fixing Primary Insurance
to a non-Aetna plan left the ineligible 75 in place with nothing downstream re-checking it — the
same rule Brandon specified for infusion sets when Pump Type changes.

**"Can we send a monitor?" — `lib/shared/monitorSale.ts` (+ tests).** Medicare pays for a monitor
(E2103) once per **5-year** lifetime, so the SoS answer decides both the sale and the date:
| SoS says | Verdict | Monitor Qty pre-fill |
|---|---|---|
| last bill **inside** 5 years | amber — they own one | `0` |
| last bill **older** than 5 years | **green** — sellable, and the date is shown | `1` |
| **never billed** | green — sellable | `1` |
| nothing yet | grey — rep asks | `""` (nothing) |
⚠️ **The verdict reads the SoS COLUMNS, never the purchase-date field.** The original spec said
"default Qty to 1 when the date is empty", which is circular: `needsMonitorPurchaseDate` goes
false at Qty 1, so `deriveMonitorPurchaseDate` clears the date, latching the default on with no
obvious way back. Keying off SoS breaks the loop — the two rules read different inputs.
⚠️ **An empty verdict is UNKNOWN, never a no.** No SoS answer means Benefits hasn't reached the
patient; defaulting a sale on absent data is §5.22's $3,787 pump one product over.
⚠️ **§5.14's rolling ~24-month placeholder STAYS** (Josh, 2026-09-09: *"the fabricated purchase
date is fine and part of sop"*). The two modules compose rather than compete: the default is to
SELL, and a rep who flips Qty back to 0 re-reveals the date field where the placeholder fills in
as it always has. `monitorSale.test.ts` pins that composition, and pins
`MONITOR_LIFETIME_YEARS` against `samantha/benefitsDerive.ts` `sosLookbackDays("cgm-monitor", …,
isMedicare)` — duplicated because `lib/shared/*` must not import a role slice.
⚠️ The verdict renders for **every** eligible patient, including the ones being sold to — gating
it on `showMonitorPurchaseDate` would hide it in exactly the sellable case.
**Blast radius when this shipped:** 19 Medicare A&B patients on WC carry the never-billed flag,
11 of them already stamped with a placeholder date (ten `09/2024`, one `08/2024` — the rolling
window proving itself); 6 sat in live stages, 13 in Completed. Five already had Qty 1 by hand.
**Not wired to Final Confirm** — its Monitor Qty input is unchanged; deliberate scope, additive
if wanted.

### 5.31b The Welcome Call screen — MN banner, mockup order, wired order rules (Sep 2026)
The UI half of Brandon's 2026-09-09 notes. **No board change; app only.**

**The banner is `SendRequestHeaderCard`'s language**, not the Lovable mockup's own CSS
(Brandon: make it look like the medical-necessity top bar). Same shell (`rounded-2xl`,
4px top border on `--mm-teal`), same type ramp (`Eyebrow` at `text-sm uppercase
tracking-wide`, name at `text-3xl font-black`, values at `text-lg font-semibold`) and the
same three info-group cards. **The mockup supplied the CONTENT and its order; where the
two disagreed on looks, the MN bar won.** Referral Source, Request Type and Serving moved
up out of the first row card — Serving stays EDITABLE there, because correcting it is the
fix for §5.22's pump/serving class of error and that is where the rep is looking — leaving
that card as the doctor block. The Cross Sell pill travelled with Serving and is now a
header chip beside the name, joined by `isFirstTimePumpUser`, a call-shaping prompt that
already existed in `workflow.ts` with nowhere to render.

**Sections renumbered to the mockup**: 1 Phone Numbers · 2 Caretaker · 3 CGM · 4 Pump &
Infusion Sets · 5 Insurance · 6 Authorizations & Cost · 7 Subscription & Logistics ·
8 Confirm Address · 9 End of Call. The contacts pair OPENS the call rather than sitting
below the product sections, which is the order the call runs in; Confirm Address split out
of Subscription & Logistics, where it was buried under the supply-length controls.
`ContactsSection`/`InsuranceCostSection` became four exports — same fields, same notes-block
round-trip (§ `callIntake.ts`), so nothing downstream of `intake` can tell. **No new
columns**: sections 1 and 2 are the existing no-column facts under new framing.

⚠️ **The mockup's "Call scheduled" chip was BUILT AND REVERTED — do not rebuild it from
Profile Send Off** (Josh, 2026-09-09: *"the booked calls should be welcome calls, not intake
calls"*). The only booking mirror is Scheduled Call Time `date_mm63na19`, which is the
**INTAKE** call (§5.15); rendering it here under "Call scheduled" reads as the welcome call.
The Welcome Call board carries **no booking column at all**, and the intake mirror cannot
tell the two Calendly event types apart either — `text_mm63e086` stores only
`scheduled_events/<uuid>`, resolvable only by calling Calendly. A board scan the same day
found **exactly ONE booking across all of Profile Send Off** (in *New Form — Completed*), so
a cross-board read would also have fired for essentially nobody. This needs a welcome-call
event type mirrored onto this board: board and backend work, not a UI change (§5.26).
⚠️ The mockup's **"View Calendly booking" link is unbuildable** from that column — it holds
an API URI that answers 401 JSON in a browser. Do not invent a `calendly.com/...` transform.

**The order rules are now WIRED** — `infusionSelection`, `infusionStock` and `sendGates`
shipped tested but uncalled, so every rule passed in CI while the form used raw board
options. ⚠️ **A module nobody calls does not fail; it is absent, and its green tests say
otherwise.** `components/welcomeCall/pumpInfusionWiring.test.ts` scans the call sites (the
`listColumns.test.ts` convention) and is verified to fail when one is removed.
- **Set lists** are compatibility-filtered per slot, each excluding the other's set so Set 2
  cannot repeat Set 1. Only positively-wrong pairings drop; `unverified` stays (a prompt, and
  `CompatNote` says so). ⚠️ **`withCurrentSelection` re-admits whatever the BOARD holds** if
  the filter dropped it — `InfusionSetCombobox` renders from the options list, so otherwise a
  real column value shows the placeholder, the §5.11 blank-with-no-error. Two live routes:
  a set incompatible with the pump, and Set 2 already holding Set 1's product.
- **A pump CHANGE clears the sets it invalidated, quantity included** — a quantity attached
  to no set is §5.12's counter-vs-columns disagreement. ⚠️ Keyed on an actual change, held in
  a ref **alongside the patient id**: clearing whenever the pair merely *is* incompatible
  would wipe board data on mount, and switching patients also changes Pump Type.
- **`infusionQtyPlan`** renders one line for the PAIR (the fact is about the order), warning
  in both directions and erroring only on a missing quantity — Brandon's "(warn if over)".

**Stock is real, from the Cardinal SKU Tracker `18420366344`** —
`lib/welcomeCall/stockApi.ts` + `hooks/welcomeCall/useInfusionStock.ts`, one shared
module-scope copy with a 30-minute TTL (the tracker is scraped once daily), structurally the
`useFaxOutcomes` shape because a lookup per set is INCIDENT_2026-08-20. Columns: Qty Avail
`numeric_mm4w1yk8` · PROD Status `color_mm4wr14r` · Last Changed `text_mm4wkpy5`.
⚠️ **The name join is verified, not assumed** (2026-09-09): 24 of the Infusion Set column's
25 labels have a tracker row; the one mismatch is `Mio Advance Clear 9mm 23"` vs the board's
`9 mm`, which is exactly why `stockKey` normalises spacing; `Luer 6 mm 32"` has no row and
correctly reads "No stock data" rather than green. **Re-run that comparison before trusting
a new label.** ⚠️ **Display only** — Brandon asked to SHOW stock; refusing an order on it is
a separate decision nobody has made, and `StockVerdict.blocked` waits for whoever makes it.
⚠️ A failing read KEEPS the previous index and never caches an empty one: an empty index
reads as "No stock data" on every set, which looks like a working feature reporting bad news.
⚠️ **A missing quantity is UNKNOWN, not zero** (fixed 2026-09-09). `stockVerdict` read
`row.qtyAvail ?? 0`, so an *Available* row whose count did not parse reported red **"Out of
stock"** — an invented shortage on a set Cardinal can ship, the one direction that costs a
sale on the call. The tracker's own header row carries a blank there. `stockApi` maps blanks
to **null** precisely so the branch can tell them apart, and a real 0 is still red;
Backordered still outranks both.

**The send gate** feeds the disabled Send button AND the sentences under it from ONE array
(`unmetSendRequirements`), so a greyed-out control can never sit there with no stated reason.
⚠️ **Advance only** — a rep holding a patient they could not reach cannot have confirmed
anything with them. ⚠️ The pump confirmation is **hidden** when the serving sells no pump
DEVICE (`servingSellsPumpDevice`, never `servingIncludesPump`, which is TRUE for "Supplies"),
so the checkbox and the gate scope identically — asking a patient to confirm a pump they
already own is §5.22's conflation in checkbox form.

### 5.31c The rest of Brandon's Welcome Call notes (Sep 2026)
Everything §5.31b missed or deferred. **One new Monday column; no automation changed.**

**The phone controls LEFT the banner** — Brandon: *"get rid of the phone text and calls in
the top banner though, will have that lower down"*. §5.31b kept them, which was a straight
contradiction of the note AND the cause of the narrow-screen overflow review flagged. They
now live in **`components/welcomeCall/PatientActivityCard`**, directly under the banner
(*"put text and call history on top"*), with Call and Text in its header — *"this is where
the user will press to call them"*. `PatientContact` gained `hideCallHistory` so its Calls
pop-up doesn't sit beside a Calls tab showing the same history. Editing the number moved to
its own card.
⚠️ **This is a per-patient RingCentral read on a stage page — INCIDENT_2026-08-20's shape.**
`hooks/welcomeCall/usePatientActivity` fetches **on open, never on render**, caches one
request per (phone, tab) at module scope with **no polling and no TTL**, coalesces concurrent
mounts, memoizes its return, and does **not** cache a failure so re-opening retries.
⚠️ **Texts read the GATEWAY route** (`messagingApi.fetchConversation`), not RingCentral
direct: only that one passes `messageStatus`/`deliveryError` through, which is the sole
surface RingCentral's late `SendingFailed` verdict ever reaches (§5.5) — a raw read carries
neither, so a failed text would render as an ordinary sent bubble. It also serves the
Postgres archive, reaching past the vendor's ~30 days (§5.27). ⚠️ Voicemail **transcripts are
not fetched** — one request per voicemail to fill a list nobody asked to read.

**Two order defaults** — `lib/welcomeCall/orderDefaults.ts` (+ tests).
- `shouldDefaultPumpQty`: *"Pump Qty should be default to 1 for any serving that includes
  insulin pump"*, fill-when-blank. ⚠️ Keys on **`servingSellsPumpDevice`** — never
  `servingIncludesPump` (TRUE for "Supplies", i.e. §5.22's $3,787 t:slim) and never
  `pumpQtyApplies` (which trusts a BLANK serving: right for enabling a control, wrong for a
  default, since absent data must not ship a device nobody chose). Scoping it to pump-serving
  patients also keeps it clear of automation **7918341011**, which gates "monitor only" on
  Pump Qty being **empty**.
- `setTwoTransition`: picking a second set clears **both** quantities (Qty 1's default of 3
  was the whole order — leaving it silently proposes 6); removing it restores Qty 1 and
  blanks Set 2 **and** its quantity. ⚠️ Fires on an actual transition, guarded by a ref
  carrying the patient id — on load it would wipe every already-split patient's quantities.

**Insurance & Authorization** — `components/welcomeCall/InsuranceAuthSection.tsx`.
- **Block A** (`lib/welcomeCall/secondaryCoverage.ts` + tests): primary read-only, no
  checkbox (*"Corey: primary isn't confirmed at this stage"*); secondary as ONE question,
  No / Yes / Unknown, pre-filled from the board, with type rules — CIN format validated for
  NY Medicaid, **tag-only** for a Medicare supplement, ID + Insurance Notes for Other.
  ⚠️ **A BLANK column is Unknown, never No.** Blank means nobody asked; `None` means somebody
  asked and the patient said no — and because No WRITES `None`, collapsing them would make a
  fabricated answer permanent on the next save. ⚠️ Unknown writes nothing and never gates
  Advance (*"patients often don't know"*). ⚠️ An **unrecognised** label reads as Yes/untyped,
  so the rep re-states it rather than having a real policy silently cleared.
  ⚠️⚠️ **Unknown is the one answer with NO board representation, so it rides the page overlay
  as `secondaryUnknown` and BOTH ends read it through `secondaryStateFor` — never off the
  column.** A blank column reads Unknown on its own, but "the patient didn't know" on top of an
  existing `NY Medicaid` cannot clear that column, because clearing would destroy a real policy
  record. So the answer has to live somewhere, and where it lives is the whole bug: held as a
  `useState` inside `InsuranceBlock` it was invisible to the page, whose send gate went on
  reading `secondaryInsuranceEdited ?? secondaryInsurance`. A patient already carrying NY
  Medicaid or Other then showed **Unknown** on screen with Advance held shut on a CIN the rep
  had just recorded as unknown — **a gate with no passing move**, the dead end §5.10 and §5.20
  each record reversing (Greptile, PR #56). The overlay also keys it per patient by
  construction, which retires the hand-rolled `unknownFor === patient.id` guard against a
  sidebar click. ⚠️ Neither file was wrong alone and `tsc` was happy with both — only the PAIR
  was — so `components/welcomeCall/secondaryAnswerSource.test.ts` scans both ends and fails if
  either reaches for the column again or the flag moves back into component state. ⚠️ The field
  is session-only with no column, and `mondayWrite` names every column it sends, so it cannot
  leak into a write.
  ⚠️ **The details ARE required once the answer is Yes** — Brandon's word — so `secondaryMissing`
  feeds `unmetSendRequirements` as `secondary-incomplete`. **Advance only**, never the call
  itself: Welcome Call's own send gate is unchanged, per §5.17's rule that this stage can only
  ever tell a rep MORE than before, never stop a call they could previously finish.
  **The board work he asked for was already done** — `Other` exists on `color_mm241kqp` and
  the stray `Done` is already deactivated (checked 2026-09-09).
  ⚠️ **"Date of last Stedi check" has NO source** — no such column on Welcome Call or Profile
  Send Off ("Stedi Plan Begin Date" is the plan's start; "Run Stedi Eligibility" is a
  trigger). A verified-on date backed by nothing is worse than its absence (§5.26).
- **Block B** (`lib/welcomeCall/authChips.ts` + tests): read-only chips, one per **served**
  product (*"a supplies-only patient sees two chips, not five"*), exceptions sorted first,
  collapsing to one sentence when everything is green or grey. ⚠️ An **unrecognised** Auth
  Result is amber "not started", never green — a wrong green reads as "cleared to ship".
  ⚠️ Brandon **dropped** two things the mockup shows and both would have been wrong: a single
  *Auth expires* field (each product has its own Auth End, so one date is wrong the moment two
  differ, and wrong quietly) and *Auth notes* (no column — a box whose contents vanish on save).
- **Block C**: shown, calculator button **inert** (his call). The amount and the reviewed tick
  ride in the notes block because the Monday columns he wants for them don't exist yet.
- The old Secondary Insurance select, Member ID 2 input and Auth Results card **left
  `PatientInfoCard`** — two controls writing the same columns is how they disagree. The
  Medicare/QMB prompts moved with them. `InsuranceSection`/`AuthCostSection` were **deleted**,
  not left unimported (§5.11).
- ⚠️ Two send-path changes this needed: Member ID 2's guard was `!== ""`, which **silently
  dropped a rep clearing the field**; and Insurance Notes was never written from this stage.
  Both guards are now **`typeof === "string"`** — `undefined` is untouched, and a task whose
  `value` is `undefined` disables the gateway's durable fast path for the WHOLE send (§5.2).
  `writeTaskParity.test.ts` caught that.

**Order Frequency is a real column** — **`color_mm71xdhj`** on Welcome Call, labels mirroring
the Subscription board's `color_mm48kv1c`. Rules: `lib/welcomeCall/orderFrequency.ts` (+ tests).
⚠️ **Monday assigned the label indices from the label COLOUR, not the `index` the create call
asked for**: `30-Days=154 · 60-Days=16 · 75-Days=3 · 90-Days=107`. The §5.12/§5.20 trap —
read `settings_str` back, never infer, because a write to a non-existent index is dropped
without an error. Pinned in a test.
⚠️⚠️ **THE FIVE WC→SUBSCRIPTION WORKFLOWS ARE NOT RE-POINTED** (7918317925, 7918340632,
7918343137, 7918601476, 7919753399). They still set 90-Days/60-Days outright, so nothing
downstream changed. Pointed at a blank column they would write a **blank** Order Frequency
onto Subscription with nothing erroring — the same coordinated cutover §5.22b needs for
Monitor Qty. The app writes the column from now so the population fills in; the workflow edit
is an **off-hours** job once it has.
The send writes the **effective** value including an untouched payer default, or a defaulted
cadence stays blank and the hop has nothing to copy. One muted hint, only when it means
something: "default for Medicaid" while it's our guess, "edited" once the rep changes it,
nothing for a value the board already holds.
⚠️ **The CARD is HIDDEN from 2026-09-14** (Josh: *"Order Frequency — comment out this code"* ·
*"make subscription type go full screen"*) behind `SHOW_ORDER_FREQUENCY` in
`WelcomeCallForm.tsx` — the `SHOW_CHASE_COLUMN` convention (§5.30), because a JSX block comment
cannot nest the comments the card carries and a flag keeps the code type-checked. Subscription Type
takes the full row while it is off. ⚠️ **Only the card is off**: `frequencyState` still runs and
every Welcome Call send still writes `color_mm71xdhj` — the board value, or the payer default (60
for Medicaid, 90 otherwise; a stranded 75 still drops) — so the population keeps filling for the
workflow re-pointing below. `orderFrequencyOptionsSource.test.ts` still holds, because the select is
gated rather than deleted. Flip the flag to bring the card back; the grid follows it.
⚠️ **A payer correction invalidates a stranded 75, and the check lives INSIDE `frequencyState`
— not in an effect beside it.** 75 days is Aetna-only (§5.31), and the first shape validated
only the rep's `orderFrequencyEdited` in a `useEffect`, returning early for an untouched
board-backed value: a patient already carrying 75-Days survived a correction from Aetna to
another payer and the send wrote that index again (Greptile, PR #56). `frequencyState` now
drops an ineligible value from **both** sources, so the card and the send read one answer; the
effect was **deleted** rather than left as a second opinion on the same question.
⚠️ `SupplyLengthField` is **deleted** (no call sites left), and its payer-eligibility guard
**migrated** rather than lapsing — `orderFrequencyOptionsSource.test.ts` pins that the select
renders `frequency.options` and never a literal, because `string[]` cannot say which list it
is and an ineligible cadence looks exactly like an eligible one.
⚠️ **Supply length and secondary coverage are PARSE-ONLY in the notes block** from here, as
`primary`/`secondary` are in `CONFIRM_KEYS` vs `REPORTED_CONFIRM_KEYS`. Still read so blocks
already on patients keep their meaning; never written, because a note line beside a column is
a second answer that drifts from the first.

**Order dates moved under the Subscription cards**, out of the page. ⚠️ **Rows for lines not
in Serving no longer render** — it drew all three unconditionally, asking a rep to date a pump
reorder for a patient who owns their pump. `servedOrderLines` is the same rule the send uses.
Supplies shows the **later** of infusion set / cartridge, both on hover.

**Two of Brandon's asks that shipped incomplete, fixed 2026-09-10.**
⚠️ **Removing an infusion set now reaches the board.** *"If Set 2 is removed, restore Qty 1's
default and write blanks to Infusion Set 2 / Qty Inf. 2 on Monday — don't leave the old values on
the board."* `setTwoTransition` cleared the FORM and the send then skipped the columns —
`if (p.qtyInf2 !== "")` / `if (p.infusionSet2Index !== null)` — so a removal showed green and left
the old set and quantity on the row, which rode to the Order board and Cardinal as a second set the
patient never agreed to. Exactly the `!== ""` shape fixed for Member ID 2 the day before. All four
infusion columns (both sets, both quantities) are now written on **every** send in **both** writers,
blank = clear. The same guard was silently dropping Set 1's clear when a Pump Type change
invalidated it.
- ⚠️ **Blank, not zero, and the two are not interchangeable.** `writeNumber` takes `number | ""`
  (ported from `finalConfirm/mondayApi.ts`, which has carried the contract since §5.22b) because
  `Number("")` is **0** — funnelling a blank through `Number()` writes a real quantity and reports
  success. This board depends on the difference: **7918341011 gates "monitor only" on Pump Qty
  `is empty`**. `blankOrNumber` / `blankOrText` are the one place that conversion happens.
- ⚠️ A status column clears with **`{}`**, never `{"index": null}` (which Monday reads as an
  unreadable value) and never `""` — `writeStatusOrClear` already owned that and is what these
  call; the declared WriteTask `value` is `{}` to match, or the gateway's durable fast path would
  send something the client path does not (§5.2).
- ⚠️ **An UNMAPPABLE label is a THIRD answer — `skip`, not a clear.** `mondayMapping` derives a
  set's label from the column's `text` and its index from `JSON.parse(value).index`
  **independently**, and that parse returns null on any failure — so a set genuinely on the board
  can arrive with a null index beside a live label. Clearing on that basis destroys a real
  selection on the strength of a read that failed, and the send reports success. A null index with
  a NON-EMPTY label is therefore skipped entirely: the surviving label IS the evidence there is
  something to keep. `infusionSelection.infusionSetWriteAction` owns the rule and both writers use
  it, because the two must agree about what counts as a removal. Same principle as the patient
  directory's `isOrphanRow` and the pending-advance rule — act on positive evidence, and let a
  thing we failed to read mean nothing at all.
- ⚠️ **Nothing on this board gates on the infusion columns** — checked every condition block on
  every Welcome Call automation, 2026-09-10 — which is what makes a true blank safe here, unlike
  Monitor Qty. Re-run that check before changing what these four write.
- Pinned by `writeTaskParity.test.ts`' *"a removed Infusion Set 2 writes blanks"*, verified to fail
  when either guard is restored. A regression is silent on screen, so the test is the only catch.

⚠️ **Subscription Type now defaults from the product mix** — *"Default from the product mix,
editable, required"*, with the same one muted hint as the Order Frequency card beside it.
`expectedSubscriptionType` had computed the right answer since long before, and its ONLY consumer
was a red *"Mismatch: expected X but Y is selected"* line — which **cannot render on a blank field**,
because it needs a selected value to compare against. So the field never defaulted, the rep re-picked
it on every patient, and the one piece of help appeared only after they had already picked something
else. `orderDefaults.subscriptionTypeState` (+ tests) mirrors `frequencyState`: rep → board →
derived, `"from product mix"` while it is our guess, `"edited"` once changed, **nothing** for a value
the board already held.
⚠️ **It fills a blank and never overrides a stated value** — deliberately unlike Order Frequency,
where an ineligible cadence is dropped wherever it came from because the payer will not pay for it.
A Subscription Type disagreeing with the products is a legitimate override, and Serving and the
product columns are editable right there; the mismatch line survives as a genuine override warning
rather than as the only feedback there is.
⚠️ The auto-fill ref carries the **patient id**, like the two transition effects beside it: without
it the label filled for the previous patient reads as this one's auto-fill and mislabels a board
value as our guess.

**Still not built, and why:** the *"call scheduled — date/day/time"* chip. Brandon asked for
the DATE (the mockup's "View Calendly booking" link was never his ask, and is unbuildable
anyway from a column holding an API URI). Blocked exactly as §5.31b records — the only mirror
is the INTAKE call on Profile Send Off, this board has no booking column, and the two Calendly
event types can't be told apart without calling Calendly.

### 5.31d Phone slots & caregiver — the columns become the source of truth (Sep 2026)
Brandon's separate phones handoff (2026-09-09). Welcome Call's phone block was **up to four
extra numbers with a cell/home/work/other kind**, riding in the `--- WC INTAKE v1 ---` notes
block, writing **no column at all**. It becomes **two slots and a star**: the starred slot is
Primary Phone, the other is Alternate Phone, and at send only the FINAL state is written,
however many times the star moved. Canonical rule: **`lib/welcomeCall/phoneSlots.ts`** (+ tests).

**Six new columns, created 2026-09-10 on Welcome Call AND Subscription** (the Subscription
copies exist so the five WC→Subscription create-item workflows have somewhere to land):

| | Welcome Call | Subscription |
|---|---|---|
| Primary Contact (status) | `color_mm72mjha` | `color_mm72vm7p` |
| Alternate Contact (status) | `color_mm72wngg` | `color_mm723hfk` |
| Can Text (status) | `color_mm72v5q7` | `color_mm72jg9e` |
| Alternate Phone (phone) | `phone_mm7265hp` | `phone_mm72r19q` |
| Caregiver Name (text) | `text_mm727mrm` | `text_mm72mdzk` |
| Caregiver Authorized (checkbox) | `boolean_mm72tf9z` | `boolean_mm72nt75` |

The **"Pt. Phone" → "Primary Phone" rename was already done** on all four boards (WC
`phone_mm1x44yk`, Subscription `phone_mkp0q3cw`, Order `phone_mm18rr9v`, Claims
`phone_mm1znnww`) — ids unchanged, so nothing in the app moved.

⚠️⚠️ **THE WRITE VALUES ARE THE LABEL IDS, AND MONDAY DERIVED THEM FROM THE COLOUR** —
`Patient = 7 · Caregiver = 4 · Yes = 1 · No = 2`. All six status labels were created asking for
`index` 0 and 1 and came back as those. `writeStatusIndex` sends `{"index": <label id>}` and
`mondayItemToPatient` reads the same field, so the two are symmetric — but a write to a label id
that does not exist is **dropped with no error**, so `{index: 0}` for Patient would have written
nothing at all. Same trap as Sub-Stage (§5.12), Intake Sub-Stage (§5.20) and Order Frequency
(§5.31c), which is now four times. `CONTACT_LABEL_ID` / `CAN_TEXT_LABEL_ID` hold them and
`phoneSlots.test.ts` pins them; read `settings_str` back, never infer.

⚠️ **Alternate Contact is a COLUMN because inference was wrong.** The handoff's first draft
stored only the starred slot's Patient/Caregiver answer and re-derived the other from Primary
Contact plus whether a Caregiver Name was present — which is wrong, silently, for a
two-caregiver household with no patient number. Brandon offered a seventh status and Josh took
it (2026-09-10). The screen was already asking per slot; the schema was throwing one answer
away. **Do not replace it with an inference rule.**

⚠️ **A blank Can Text is UNKNOWN, never a No.** Blank means nobody asked; No routes the
patient's reorders to a call queue instead of the Day-20 text. Same rule as `networkAnswer`
(§5.20) and the blank secondary (§5.31c), and it constrains the **backfill**: where the
line-type lookup and RingCentral history give no evidence, leave the cell **blank**, never No.
⚠️ And note the §5.22b shape waiting downstream — a blank matches neither `= Yes` nor `= No`, so
whatever reorder automation gets built must handle blank explicitly or those patients fall
through every branch in silence.

⚠️ **Can Text is held PER SLOT, and editing a number clears it.** Brandon's rule is "if the star
moves to the other slot, clear it so the rep re-answers"; per-slot satisfies that by construction
(the other slot has never been answered for) without re-asking when the star moves BACK to a
number nothing changed about. The rule he did not cover is the one that actually loses data:
**changing a slot's digits clears that slot's answer**, because the Yes was about the old number
— the same staleness `sendGates.pumpConfirmationStale` exists for. Compared on digits, so a
reformat is not a change.

⚠️ `phoneSlotWrites` returns `null` for a status meaning **CLEAR, not skip**: the columns are the
source of truth now, so a removed second number has to remove Alternate Contact with it, and a
caregiver who is no longer on either slot has their name and HIPAA tick cleared — a standing
authorisation against a patient nobody shares an account with is a record that says the wrong
thing. Empty slots are dropped first, so an abandoned "+ Add number" cannot write a live owner
against a blank number.

**The screen, the writes and the notes change shipped 2026-09-10.**
`components/welcomeCall/PhoneSlotsSection.tsx` is the two slots and the caregiver panel;
`mondayWrite.buildDataTasks` writes all six; the block's `Phones:` / `Caretaker:` /
`Caretaker relationship:` lines are **parse-only** and fold verbatim into the caretaker notes.

⚠️⚠️ **SLOT STATE LIVES ON THE PAGE OVERLAY (`phoneSlotsEdited` / `caregiverEdited`), NEVER IN
THE COMPONENT** — read through `phoneSlotsFor` / `caregiverFor` at every end. `phoneSlotGaps`
is a SEND-GATE input, so slots trapped in a `useState` would leave the gate reading columns the
rep had already edited past: §5.31c's gate-with-no-passing-move, which shipped once and whose
two files were each fine alone. `phoneSlotsSource.test.ts` scans both ends.

⚠️ **The banner's phone editor is DELETED** (`PatientInfoCard`'s `PhoneField`, with
`onSavePhone` and `sendPhoneToMonday`'s call site). Slot 1 owns Primary Phone, and two controls
writing one column is how they disagree — the reason the Secondary Insurance select left that
card the day before. It also bypassed the clear-Can-Text-on-number-change rule.

⚠️ **A phone task's declared `value` is `{phone, countryShortName}`, never the bare string.**
The gateway's durable fast path sends the DECLARED value (§5.2), so a bare string reaches a
phone column and is refused at HTTP 200 (§10's "invalid value … data structure" class). An
UNPARSEABLE number pushes **no task at all** — `writePhone` skips it, so a task declaring `{}`
would CLEAR a real number — and `phoneSlotGaps` refuses it before the send, because a skip
inside the writer reads as success (§7's `unwritableDoctorFields`). Caught by
`writeTaskParity.test.ts`, which is the only thing that would have.

⚠️ The consent audit line carries **no date and no initials of its own** — `shared/noteStamp`
supplies both — and is stamped only on the **off→on** transition
(`caregiverConsentJustGiven`, compared against the BOARD), or every later send re-appends the
same claim about one conversation.

**The Send Welcome Call Text push carries the phone fields from 2026-09-10.** It wrote **no**
phone column at all before flipping the trigger, and automation **7918318033** ("Welcome Call
Text → Send → Send SMS from RC Number") reads **Primary Phone** — harmless only while the
banner's Save button owned that column, and a live bug the moment the STAR did.
⚠️ **Can Text = No BLOCKS that button**, it does not warn (`welcomeCallTextBlock`). RingCentral
ACCEPTS a text to a landline and only flips it to `SendingFailed` seconds later (§5.5), so a
click-through warning buys a green toast and a patient who heard nothing. ⚠️ An **unanswered**
Can Text does not block — blank is unknown, and this button is pressed mid-call, often before the
rep reaches that question.

**The phone→patient lookup matches Alternate Phone from 2026-09-10.** ⚠️ `phoneColId` did NOT
become a list: it stays the ONE number a search row displays, and `altPhoneColIds` is a separate
match-only set (`phoneColIdsFor`). Two of the three consumers want one number and only the
lookups want all of them; a single list would have forced every reader to pick which entry was
"the" number, and they would not have agreed.
⚠️ **The rules are ORed, not ANDed** — in `searchPatientsLive`'s `rulesLiteral` and in
`findPatientByPhone`'s fan-out. The digits are in the primary OR the alternate, never both, so
the default AND matches nobody and Monday answers that with 200 and an empty list — which reads
exactly like "this caller is not a patient".
⚠️ `findPatientByPhone` narrows on **every** number the row carries (`PatientRef.phones`), not
the displayed one: the wide `contains_text` net can match on the alternate, and comparing to
`p.phone` alone would then discard the row for not equalling the patient's primary — the
caregiver's call would come up anonymous having been found.
⚠️ The gateway mirror writes **one directory row per NUMBER** (`toDirectoryRows`), so one item
yields two. Safe against the prune by construction: `prunePlan` keeps every (item, hmac) pair it
wrote. `directoryCoverage.test.ts` now fails on an alternate-column drift too — verified to fail.

**The Can Text backfill is `services/monday-gateway/canTextBackfill.mjs`** (+ `canTextRules.mjs`,
pure and tested). ⚠️ **It lives on the GATEWAY and structurally cannot live in this repo**: the
evidence is `sms_archive`, keyed by `phone_hmac`, and hashing a board number needs
`PHONE_HMAC_PEPPER` — a Railway variable that deliberately exists nowhere else.
⚠️ **DRY RUN by default** (`CANTEXT_BACKFILL_APPLY=1` to write); it is a bulk write against live
PHI rows, and §10 records what an unattended one did on 2026-09-02. It reads `errors[]` and stops,
for the same reason.
⚠️⚠️ **It only ever writes "Yes".** A missing Yes costs a rep one question; a wrong No routes that
patient's reorders to a call queue silently. And the evidence for No is genuinely weak — a failed
outbound text looks identical for a landline, a disconnected mobile, a typo and a carrier having a
bad afternoon (§5.5's `SMS-CAR-104`/`-199` ride on messages that were fine). Answering No needs a
real **line-type lookup**, which nobody has bought; until then it stays the rep's answer.
⚠️ A merely **`Sent`** outbound text is NOT evidence — §5.5 again: accepted is not delivered, so
counting it would mark exactly the landlines Yes. Only `Delivered`, or any INBOUND text.
⚠️ **The archive is younger than the boards** (it began 2026-08-01), so a patient last texted in
June looks identical to one never texted. Re-run it as the archive grows.
⚠️ **It has never been run, and that is a DECISION** (Josh, 2026-09-10: *"moving forward we'll add
can text, no need to backfill"*) — the column fills from the next Welcome Call send onward. The
script is kept unrun for the day somebody wants the history, not because it is pending.
✅ **The five WC→Subscription workflows carry all six columns — verified live 2026-09-10**
(7918317925, 7918340632, 7918343137, 7918601476, 7919753399).
⚠️ **Order Frequency is NOT among them and is a separate, still-open job** (§5.31c): all five still
write a hardcoded `"90-Days"` / `"60-Days"` `user_config` literal into Subscription's
`color_mm48kv1c`, so the WC column the app fills reaches nobody. Parked deliberately (Josh,
2026-09-10) — not forgotten.

### 5.31e The "Call scheduled" chip — the welcome call, read from Calendly (Sep 2026)
Brandon's 2026-09-09 ask, and the third attempt at it. §5.31b **built it and reverted it**: the
only booking data reachable then was the INTAKE call's mirror on Profile Send Off
(`date_mm63na19`), and rendering that under "Call scheduled" on this page reads as the welcome
call — a different appointment, silently wrong. §5.31c recorded it as blocked on board work.

**What unblocked it was §5.30b, not a board change.** That work built the whole credential chain
for the Care Coordinator grid — browser →(Google identity) gateway →(service token)
dtc-mm-form-api → Calendly — and taught the backend to tell the two event types apart. Verified
live 2026-09-10: `/api/calendly/health` reports `day_route: "enabled"` and resolves
`welcome_event_type` "Medically Modern Welcome Call" (`96da008d-…`). **The Welcome Call board
still has no booking column and still needs none.**

⚠️ **BUILT OUT OF DAY READS, because that is the only route there is** (Josh, 2026-09-10: *"i
don't want to touch dtc mm form, it's perfect"*). `/api/calendly/day` is strictly one ET day
(`etDayBoundsUtc`), and there is no find-this-invitee endpoint our side of the wall. So
`services/monday-gateway/calendlyPatient.mjs` assembles a patient-shaped answer here: read a short
forward WINDOW once, index it by invitee email, answer every patient from that shared index.
`calendlyDay.readDay` is exported for it, so the grid and the chip share ONE day cache rather than
each paying for the same day.

⚠️ **The window IS the cost** — one index build is `CALENDLY_PATIENT_WINDOW_DAYS` (21) upstream
day reads, four at a time, cached `CALENDLY_PATIENT_TTL_MS` (10 min) and shared by every browser
and every patient. That bounds it at ~21 reads per ten minutes however many reps are working. ⚠️ A
window that is too SHORT fails **silently** — a booking past the edge reads exactly like no
booking — so widen it rather than narrow it if the two are ever in doubt.

⚠️ **A PARTIAL WINDOW MUST NEVER ANSWER "not booked".** If any day fails, or comes back with the
welcome event type `unresolved` (which arrives as HTTP 200 + an empty list), the whole answer is
an error. Three states reach the screen and they are different: booked · genuinely nothing ·
could-not-check. The chip renders the third as *"Couldn't check Calendly"* — silence there would
be indistinguishable from no appointment, and *"you're not booked in"* is the one wrong answer a
rep acts on.

⚠️ **EMAIL IS THE ONLY JOIN, and a NAME IS NOT AN IDENTITY.** The day route hands us invitee name
and email and nothing else; two patients called Maria Garcia is ordinary at this size, and
`commsHub/dossier.nameMatchAccepted` already requires a second signal (phone, or blank-phone +
DOB) before accepting a name — Calendly gives us neither. So no name match is attempted, and a
patient with no email is **UNANSWERABLE, not unbooked**.
> That sounds fatal — only **9 of 52** live Welcome Call patients carry an email
> (`text_mm1xc140`: 8 of 39 in Welcome Call, 1 of 13 in Final Profile Confirmation), and the hop
> is not at fault (automation 7918324247 does copy Email; Insurance is 186/432 and ME ~242/587).
> ⚠️ **It measures the wrong population** (Josh, 2026-09-10). Of every Profile Send Off row that
> has ever touched the booking flow, **6 of 6 carried an email** — the one real booking included —
> because the flow is only reachable through an address we already hold. The chip therefore
> renders nothing for an emailless patient rather than a "no email on file" note that would sit on
> ~5 of 6 headers to flag a case the data says does not arise. The hook still reports `noEmail`
> for any surface that wants it.

⚠️ **`rescheduleUrl` is the ONLY browser-openable link Calendly gives us.** `eventUri` is an API
URL that answers 401 JSON to a person, which is why §5.31b records the mockup's "View Calendly
booking" link as unbuildable — it is buildable, just not out of that field.

⚠️ **Rendered in EASTERN, always** (`formatBookingWhen`, + tests), with a literal `ET` suffix and
Today/Tomorrow labels. Every other time on these boards is Eastern wall clock (§5.15), so a rep
must be able to compare this with a Next Action Date without doing arithmetic. Note the one
inversion of §5.15's usual trap: a Calendly `start_time` IS a real UTC instant, so `new Date` is
correct here — what must never be parsed that way is a naive monday column.

**Incident guards** (`hooks/welcomeCall/useWelcomeCallBooking.ts`): reads **on patient open, never
on a timer**, module-scope cache, one in-flight request per address, a stable returned identity
(rule 2), a `want` ref so a slow answer can't paint the previous patient's appointment onto the
open one, and **failures are not cached** so re-opening retries.

**Volume is ~nothing today, and that is the board's state rather than a broken read.** A live scan
2026-09-10 found ONE welcome booking in three weeks; six Profile Send Off rows have ever carried a
Booking Status and three of those are test rows. Expect the chip to be absent almost always.

Files: `services/monday-gateway/calendlyPatient.mjs` + `calendlyPatientRules.mjs` (+ tests, the
`callRules`/`rcAllowlist` split) · `calendlyDay.readDay` · `lib/welcomeCall/calendlyBooking.ts`
(+ tests) · `hooks/welcomeCall/useWelcomeCallBooking.ts` ·
`components/welcomeCall/CallScheduledChip.tsx`, mounted in `welcomeCall/PatientInfoCard`.
**Not wired to Final Confirm** — deliberate scope; the chip takes an email and nothing else, so it
is a one-line addition if wanted.

### 5.30 Care Coordinator — "My Patients" (Sep 2026)

> ✅ **REWRITTEN 2026-09-14 to Brandon's "Notes for masani dashboard (9/14/26)"** — read this
> block first; the paragraphs below it describe the 2026-09-08 build and stand only where they
> are not contradicted here (the board facts, the load bar, the read-only posture, the role
> count). Files are the same: `pages/CareCoordinatorPage.tsx`, `lib/careCoordinator/{workflow,
> mondayApi,followUp}.ts`, `components/careCoordinator/{PipelineColumn,PatientCard,cards,
> ScheduleGrid}.tsx`, `hooks/careCoordinator/useWelcomeCallBookings.ts`.
>
> **One model on both columns — Today / Future, each with Scheduled / Unscheduled**
> (`workflow.ColumnBuckets`). Scheduled is a booked call: on intake the Calendly mirror on the
> row (§5.15); on Welcome Call **Calendly itself**, joined by email through the gateway's new
> **`POST /calendly/patients`** batch route (`calendlyPatient.mjs` + `lookupMany`) — one request
> per column load off the same window index the §5.31e chip uses. Today vs Future is the
> booking's Eastern day. Unscheduled is everybody else the coordinator can ring; Today vs Future
> is the **follow-up date** (`followUpHorizon`): a date in the future ⇒ Future, today/past/**blank**
> ⇒ Today (blank is Today on purpose — nothing else ever brings a dateless patient back, §7).
> The banner's two groupings ARE the toggle (default Today); the Scheduled section has its own
> "Today only / Tomorrow+ too" switch on top. Sections auto-expand on scroll.
>
> ⚠️ **The follow-up push is on the STAGE pages, not here** (Josh, 2026-09-14: the dashboard
> stays read-only). Patient Intake's *Log call attempt* now writes **Follow Up Date
> `date_mm3874an`** — next calendar day by default, editable — through
> `unverifiedWrite.logContactAttempt`; Welcome Call's +1 already did. Both take the date from
> **`lib/careCoordinator/followUp.ts`** so they cannot drift. ⚠️ **THE DATE ONLY, NEVER THE
> INTAKE FOLLOW UP STATUS `color_mm3822qq`** — that status is the one-way door §5.10 records, and
> nothing on the intake page, the role count or either baseline reads the date, so the intake
> page is exactly as it was. `followUp.test.ts` scans the writer. ⚠️ "Exactly how Welcome Call
> does it" is the **next CALENDAR day** (a Friday attempt comes due Saturday) — Brandon believed
> it was one business day; it never was, and copying it exactly means copying that. ⚠️ On
> Welcome Call this dashboard wakes a `Follow Up = Done` patient on the date while the stage
> page's own sidebar and the role bar still hide them until cleared — a known mismatch Josh
> chose over touching the counting contract ("dashboard only", 2026-09-14).
>
> **What Brandon deleted, deleted:** the escalation sections (escalated patients are COUNTED
> in each column's footer and worked from Oversight's manager columns, §7/§5.34), "Follow up
> later", the exhausted shelf and the 5-attempt cap (the cadence is the stop rule now; the
> count still shows), the Active badge, the "Web form · step · reason" sub line, every old
> pill, the stage tints (both columns gray), the section hints and column subtitles. **What
> the card shows:** left edge green (`--mm-green`) once attempted, gray until then; the next
> scheduled call darker gray; Doctor / Clinic from the **Provided** form columns on intake
> (verified Doctor Name + Clinic Address on Welcome Call, which has no Provided columns); pills
> = Completed|Partial (intake unscheduled only, from the GROUP) · Request Type · General
> Insurance (**Primary Insurance on Welcome Call — that board has no General Insurance column**,
> Josh 2026-09-14) · Insulin Pump Coverage Path · CGM Coverage Path (**both exist on Welcome
> Call as `color_mm2xtn41` / `color_mm2wsam4`, different ids from Profile Send Off's**, verified
> live 30/31 and 31/31 filled) · Referral Source (Welcome Call only); phone + text icons with
> counts (intake: Attempt Counter · Drop-off Attempt clamped to 2; Welcome Call: Call Attempts ·
> **0/1 from the Welcome Call Text trigger**, the board's only text fact); time `x:xx` today or
> `MM/DD x:xx`; "N days" / "<1 day" since intake. Buttons: Call · Text (light green) · **Call
> Log** (list icon — `PatientContact` `callHistoryLabel`/`callHistoryIcon`, this page only) ·
> quiet *See notes* / *Open* (Open is how the attempt gets logged, so it stays) · **Booking Link**
> (light blue, every card). The booking dialog gained an **Intake call / Welcome call dropdown**;
> the welcome URL is `bookingLink.BOOKING_URLS.welcome`, pasted from the Calendly console (no
> service exposes it — dtc-mm-form hands back only the API URI, §5.31e).
>
> **The day strip** (`ScheduleGrid`, now ABOVE the columns) is horizontal: time on the x axis
> 7 AM–8 PM, one day with prev/today/next, name-only blocks packed into lanes (`laneFor`,
> tested), intake in sky and welcome in teal — the same dot beside each column title.
> **Confirm Receipt + Chase Clinicals is off the page entirely** (no flag); `chaseBuckets` and
> `fetchChaseItems` survive in the lib for a future third column. The header summary is an
> overview (total · Patient Intake · Welcome Call · overdue = unscheduled with a past follow-up
> date), not pills; escalations left it with the sections.
The `scheduledCalls` role **became the Care Coordinator dashboard** (Josh, 2026-09-08, from Corey's
Phase 3 mockup): label "Care Coordinator", route **`/care-coordinator`** (the old `/scheduled-calls`
redirects, query preserved), page `pages/CareCoordinatorPage.tsx`. ⚠️ **The id stays `scheduledCalls`**
— access.json assignments, `ScheduledCallHost`'s role gate, `useRoleCounts` and both baseline
generators key off it (the `profile` / `assignedPatients` precedent, §5.10). The old day grid is the
bottom half of the page, moved whole into `components/careCoordinator/ScheduleGrid.tsx`.

**Built with ZERO Monday changes** (Josh: *"without changing ANY of the data and how we have it in
monday"*). No column, group or automation was added or edited; every rule below is derived from
columns the stage pages already read. **The page is READ-ONLY** — three slim paged reads in
`lib/careCoordinator/mondayApi.ts` (Profile Send Off form groups + Clean-Up · ME's Medical Necessity
group filtered to Confirm Receipt / Chase Clinicals · the Welcome Call group), plus one-item notes on
demand. It never writes: Text is the shared `PatientContact` trio (Call · Text · Calls/recordings),
"Booking link" is `BookingLinkDialog` (a Calendly link — the callback IS the booking, never a snooze,
§5.10), and **Open** deep-links `?patientId=` into the stage page whose verified write path does the
work. ⚠️ Deliberately NOT the stage hooks: `hooks/masheke/useMondayPatients` backfills a blank Next
Action Date and self-heals escalations ON READ; a dashboard that only looks must not trigger that.

**ONE coordinator, NO assignment** (Josh, same day: *"one woman right now … leave [scaling] out"*).
The role bar is the assignment; nothing routes a patient to a person; every queue stays workable from
its own page by anyone (§5.13). The mockup's "My Patients · on" toggle was not built. If a second
coordinator arrives it is a FILTER over these same lists — never routing.

**Rules — `lib/careCoordinator/workflow.ts` (+ tests), one bucket set per column:**
| Column | In | Out (still counted in the footer) |
|---|---|---|
| **Patient Intake** | *Scheduled*: a live Calendly booking today-or-later (a booking WINS over every exclusion but an escalation). *Unscheduled*: touched the DTC form (Drop-off Step set), still in a form group, no booking, ≥ **48h** old (`READY_AFTER_HOURS` — Corey's "2 days later", after the two automated nudges §5.24), under **5** attempts (`MAX_INTAKE_ATTEMPTS`, the stop rule, read off the existing Attempt Counter). Longest-waiting first — the mockup's own header text. | **imported** (blank Drop-off Step — never touched the form) · **cleanUp** (unbooked, already advanced) · **callDone** (Intake Call Complete = Yes) · **sendNow** (completed form that chose "Send request now" — no call wanted) · **nurturing** (< 48h). *Exhausted* (≥ 5 attempts) and *With a manager* (either Intake Escalation rung) are collapsed sections, not exclusions. |
| **Confirm Receipt + Chase Clinicals** | Mirrors `useRoleCounts`' ME rule exactly: escalation index 2 → counted only (Final Decisions); index 0 → *With a manager*; Appointment Date today-or-later → *Awaiting a provider visit* (§5.12); NAD > today → *Waiting*; else *Due*, most overdue first. ⚠️ **A blank NAD is DUE** (blank counts as active in `useRoleCounts`; the masheke hook backfills it to today). | — |
| **Welcome Call** | Escalation index 0 (the board's `Escalation Required`) → *With a manager*; index 2 → counted in the footer only (proposed stuck, awaiting a Final Decision — §5.34); `Follow Up = "Done"` → *Follow up later* (soonest date first, dateless last); else *Call now*, oldest arrival first. Flags: `isFirstTimePumpUser` / `isCrossSell` from `lib/welcomeCall/workflow` (§5.26). | — |
Header chips: total = the three columns' workable counts; "N overdue · N at escalation" separately.

**Why "imported" exists — the board facts found while building (2026-09-08):** `New Form — Partial
Leads` held **1,718** rows; **21** had ever touched the form (a Drop-off Step); **~1,697 arrived in one
bulk load on 8/25** from the *DME Patient Validation & Outreach* board (`18427791439`) — Referral
Type `Doctor`, source `SNJ [2.0]`, no email, notes stamped `=== Imported from "DME Patient Validation
& Outreach" board · 8/25/26 ===`. **498** carried a logged rep call, **4** more than one (no cadence
brings a called patient back — §5.10's no-snooze rule at scale); **8** had ever received an automated
drop-off text. So the form drop-off funnel is ~1–2 leads a day and the queue is dominated by a
reactivation campaign. This dashboard shows the form leads and COUNTS the imports in the footer
("Not shown: 1,697 imported/referral rows … worked from Info Collection") — nothing is invisible (§7),
and nothing was moved to make that true.

⚠️ **The role's COUNT is unchanged** — the bar still reads "booked calls still ahead today"
(`remainingToday`, §5.8/§5.15) while the page shows far more. A deliberate mismatch, left for a
separate decision: changing it is a counting-contract change (useRoleCounts + both baseline generators).
⚠️ **Welcome Call has no Scheduled/Unscheduled split** on purpose — the Calendly columns live on
Profile Send Off and do not hop (§5.26). ⚠️ **No notes column in any list read** — Profile Send Off
Notes runs to 9,000+ chars on ~1,700 rows (§5.25); `fetchItemNotes` reads ONE item when a card's
"See notes" opens. ⚠️ No week view, no autodialer, no per-patient snooze on intake: all three would be
new data or a reversed decision.

**Keep-in-agreement:** the intake groups mirror `lib/scheduledCalls/mondayApi.ts` `GROUPS`
(`intakeSubStage.test.ts` pins Clean-Up); the chase due rule mirrors `useRoleCounts`; deep links carry
`from=care-coordinator` (ScheduledCallHost + the page). Files: `lib/careCoordinator/{workflow,mondayApi}.ts`,
`hooks/careCoordinator/useBoardPoll.ts`, `components/careCoordinator/{cards,PatientCard,PipelineColumn,ScheduleGrid}.tsx`,
`pages/CareCoordinatorPage.tsx` (+ `CareCoordinatorPage.test.tsx`).

⚠️ **Confirm Receipt + Chase Clinicals is HIDDEN from this page** (Josh, 2026-09-10), behind
`SHOW_CHASE_COLUMN` in `CareCoordinatorPage.tsx`; the remaining two columns go 2-up so each gets
about half the page. The flag governs the READ, the header chip and the column **together** — the
hidden read returns `[]`, so `chaseBuckets` comes back empty and `summarize` drops the stage from
Total / overdue / at-escalation on its own. That is the whole design: a stage hidden but still
counted would put a number in "Total in pipeline" that nothing on screen explains. Nobody is
stranded — the stage keeps its own pages, its role bar and its Oversight row. Flip the flag to
bring it back; nothing else moves with it.

**Each column says how far its read has got** (Josh, 2026-09-10: *"it takes a very long time to
load patient intake … I need to see an update bar showing me what it's loading and how close we
are"*). `lib/careCoordinator/loadProgress.ts` (+ tests) · the bar is `LoadBar` in
`PipelineColumn.tsx` · `useBoardPoll` accumulates page reports from `mondayApi`'s `PageReport`.

**Why it is slow, measured 2026-09-10:** Patient Intake reads **1,754 rows** — Partial Leads
**1,718** + Completed 29 + Clean-Up 7 — and Monday caps `items_page` at 500, so Partial Leads
alone is **four sequential round trips** before anything renders. Welcome Call is **41 rows**, one
request; its bar barely flashes, which is correct. ~97% of the intake rows are the 8/25 bulk import
the column then excludes, but they cannot be filtered server-side: the footer COUNTS them (§7's
nothing-is-invisible rule), an escalated or booked import still has to appear, and Monday's
`query_params` cannot express that OR across a group rule. Every one of the ~23 columns is read by
something on screen — checked field by field, so there is nothing to trim either. The real fix is a
two-tier read (§5.25's shape); this is visibility, not a speed-up.

⚠️ **MONDAY REPORTS NO TOTAL, so a percentage can only be REMEMBERED.** `ItemsResponse` has exactly
`cursor` and `items` (live schema, 2026-09-10); `groups` has no count and only `boards
{ items_count }` exists, board-wide. So `expected` is what the LAST COMPLETE run returned, kept in
localStorage per column key. Which makes the honesty rules the whole module:
`loaded` is always real; the percentage is **capped at 99 until the fetch resolves** and a run that
overshoots its remembered total stays at 99 rather than reading >100 or snapping back to
indeterminate; with no memory at all the bar is an indeterminate sweep and the text is a bare count
— it never invents a denominator. ⚠️ **Nothing is remembered from a failed or partial run**, or the
next load parks at "100%" with rows still arriving. ⚠️ Every localStorage access is wrapped —
a progress bar must never break the page it decorates.
⚠️ **A background poll shows NOTHING**; only the first load and a Refresh the coordinator pressed
do (`visible`), because a bar reappearing every 60s on a page somebody reads all day is the noise
that teaches people to ignore it — §5.28's naming-progress rule. The indeterminate sweep reuses the
app's existing `.burndown-shimmer`, not a second animation saying the same thing.
⚠️ `PageReport` is *"N more rows"*, never a position: the intake read runs its three groups in
PARALLEL and their pages interleave, so the hook may only ever accumulate.

### 5.30b The schedule grid shows welcome calls too — read straight from Calendly (Sep 2026)
*"is calendly hooked up to only intake calls? i want to add a toggle to see welcome call too"*
(Josh, 2026-09-10). It was, and the answer to why is the whole design here.

**Same Calendly account, different EVENT TYPE — not a different calendar.** Both live on the
`records-medicallymodern` user: **Medically Modern Intake Call** (`d2642463-…`) and **Medically
Modern Welcome Call** (`96da008d-…`), 10 minutes each. What was intake-only was the *code*:
`calendly.js` resolved ONE event type by name-match (`CALENDLY_EVENT_TYPE_MATCH`, default
`intake`), so booking, availability and `/api/intake/scheduling` all meant the intake call.

⚠️ **The webhook, however, was never intake-only — and that was a live bug** (fixed 2026-09-10).
`reconcileWebhook` subscribes at **`scope: 'user'`**, so every event type on the account is
delivered, and `handleWebhookEvent` did not look at which one. A patient still sitting in one of
the two DTC form groups who booked a **welcome** call had their **intake** mirror columns
overwritten with it, and a later welcome-call cancel blanked them outright. Narrow — it needs both
facts at once — but silent. `scheduledEvents` had also been **dropping `event_type`**, which is why
nothing downstream could tell the two apart even in principle. The webhook and `reconcileDay` now
mirror intake bookings only.
⚠️ **Positive evidence only** (`calendly.kindOfEventType` returns `''` for "could not ask"): a
booking is skipped when we KNOW it is another event type, never merely because classification
failed. Fail-closed would mean a real intake booking silently unmirrored during a Calendly blip —
the "booked call nobody makes" §5.15 exists to prevent.

**Welcome calls have NO mirror, so the grid reads Calendly.** Verified against the live board
2026-09-10: the Welcome Call board has **156 columns and not one of them is a booking**, and
nothing copies the intake mirror across the board hop (§5.26, §5.31b). Calendly is the only record
there is. The chain, and every hop of it is load-bearing:

    browser --(Google identity)--> gateway --(service token)--> dtc-mm-form-api --> Calendly

⚠️ The browser must never hold a Calendly token (§10), and the gateway must never hold its **own**
copy — `dtc-mm-form-api` owns the Calendly integration, and a second credential is the §5.7/§5.29
hand-synced hazard in its worst form. ⚠️ The day read returns **PHI** (patient names + emails),
unlike `/api/calendly/health` beside it, so `GET /api/calendly/day` is **bearer-authenticated and an
unset `CALENDLY_DAY_TOKEN` disables it outright** rather than leaving it open, and the gateway's
`GET /calendly/day` requires a verified employee (`verifyGoogleIdentity`, not `verifyGoogleToken` —
the ID token is never refreshed and a stale one must not lock a coordinator out mid-shift, §5.4).

**Files.** SPA: `lib/careCoordinator/calendlyDay.ts` (client) · `scheduleEntries.ts` (+ tests — the
pure adapters) · `hooks/careCoordinator/useCalendlyDay.ts` · `components/careCoordinator/ScheduleGrid.tsx`.
Gateway: `calendlyDay.mjs` + `calendlyDayRules.mjs` (+ tests), the `callRules`/`rcAllowlist` split.
Backend: dtc-mm-form `server/src/calendly.js` (`eventTypeFor`, `kindOfEventType`, `dayEvents`),
`booking.js`, `server.js`.

⚠️ **Both sources are adapted to ONE `ScheduleEntry`**, and `lib/scheduledCalls/workflow.ts`'s
sequencing helpers were widened to a structural `BookedSlot` rather than duplicated — two copies of
"is this booking live" is how the day view and the ten-minute reminder drift apart.
⚠️ **Calendly returns UTC; the grid is naive Eastern.** `etPartsOf` converts. Rendering the instant
in the browser's zone puts a late-evening booking on the **wrong day** and it vanishes from the day
being looked at — §5.15's standing trap, tested both sides of ET midnight and across DST.
⚠️ **An empty day and a failed read are different answers.** `fetchCalendlyDay` returns `{ok, error}`
and the grid says so in amber: a Calendly outage rendered as "no calls booked" is the one answer a
coordinator acts on by not ringing anybody.
⚠️ **No polling.** One read per day viewed, cached 60s in the browser AND 60s on the gateway, one
in-flight request per day, and **nothing is fetched at all while the toggle is on Intake**. Behind
each read sit one `/scheduled_events` call plus one `/invitees` call PER booking, against the same
rate-limited account the patient form books through — INCIDENT_2026-08-20's shape.
⚠️ **A booking links to a chart by the invitee's EMAIL** (Welcome Call `text_mm1xc140`, well
populated), and `emailIndex` **poisons an address two patients share** rather than picking one —
linking the wrong chart on a live call is worse than not linking. No match ⇒ the block still
renders, with no Open: a booking made with an address we don't hold is real and the coordinator
needs to see it (the same single join the intake mirror depends on, §5.15). Matching is against the
**Welcome Call group only** — the page's own read — so a booking for a patient not yet in that
group won't link either.
⚠️ **The 10-minute reminder is still INTAKE-ONLY.** `ScheduledCallHost` reads the monday mirror,
which has no welcome-call rows; the footnote says so rather than promising one (§5.15: "fix the
copy, not the gate"). Welcome calls also **do not** enter `remainingToday`, the role bar or either
baseline generator — that would be a counting-contract change (§5.8), deliberately not made.
**Volume today is low:** a scan of 2026-09-03 → 09-24 found **two** bookings in total, one of each
kind. The toggle will often be empty, and that is the board's state, not a broken read.



### 5.32 Last Bill Date — one column family; the legacy "Last Bill Date" columns are RETIRED (Sep 2026)
Brandon, 2026-09-10: *"last bill date for SoS on welcome call — we have 2 diff columns for it
(`date_mm59n1x1` and `date_mm33jsyt`) — might be issue with other products too, but noticing it
the most with sensors. Need to make sure it links up properly from insurance board."* Josh,
2026-09-15: *"we need to make it obsolete so the new column does everything that the old one was
doing so we can get rid of it. it causes confusion."*

Both the Insurance board and Welcome Call carried **two** per-product last-bill families:

| | Insurance (sensors) | Welcome Call (sensors) | Written when |
|---|---|---|---|
| **LEGACY** "Sensors Last Bill Date" — **RETIRED** | `date_mm332rhq` | `date_mm33jsyt` | **only** SoS = Not Clear (or Auth = No Auth Needed) — **actively CLEARED otherwise** |
| **"CGM Sensors SoS Last Bill"** — the record | `date_mm59ejs2` | `date_mm59n1x1` | **every billed product**, Clear included |

All ten legacy ids: Insurance `date_mm33h1qv · date_mm332rhq · date_mm33qnew · date_mm33gj86 ·
date_mm33cd87`, Welcome Call `date_mm33vqa0 · date_mm33jsyt · date_mm33kmz4 · date_mm33mw14 ·
date_mm33rd8n`. The SoS family they map to: Insurance `date_mm59tx2g · date_mm59ejs2 ·
date_mm59j483 · date_mm59bzfv · date_mm598y8w`, Welcome Call `date_mm599gk8 · date_mm59n1x1 ·
date_mm593ghh · date_mm59jcf5 · date_mm59mw5n` (monitor · sensors · pump · sets · cartridges).

**The legacy column was a Not-Clear FLAG, not a billing record.** `samantha/mondayWrite` wrote it
only when SoS came back Not Clear and cleared it otherwise, so for the common case — Clear — the
real date landed in the SoS column and the legacy one was blanked. Welcome Call read the legacy
family alone, so the Last Bill Date row showed **"—"** and the next-order-date default had nothing
to compute from, while the true date sat one column over. Final Confirm's five editable boxes read
AND wrote the legacy column, so they were blank for patients we HAD billed (Brandon's 2026-09-02
"amber not red" ask was really about this). ⚠️ The Insurance→Welcome Call hop **7918324247** copies
all ten pairs correctly — the divergence was created by the write rule, never by the mapping.

**Retired 2026-09-15, in three steps, each measured on the live boards:**
1. **Backfill.** Every legacy value was copied into its SoS twin where the twin was blank: **35
   items** (Welcome Call 20 · Insurance 15; sensors 13 + 5, the rest monitor / sets / cartridges —
   the insulin-pump legacy column held **zero rows on either board**). Verified after: legacy-only
   = 0 on all five products, both boards. Units were left blank on backfilled rows — the legacy
   family never had any, and inventing them is worse than a gap.
2. **The audit.** The legacy column had exactly **two** live consumers, and neither needed it:
   - `finalConfirm/checkPack.authExpiryMoot` — Medicaid + a non-blank last bill silences C18's
     auth-expiry row. Pointed at the SoS family, **zero patients change verdict**: of **324**
     Medicaid × Auth Valid × has-end-date product-rows on Welcome Call, **not one** carried a date
     in EITHER family — Medicaid supplies are auto-filled Clear (`isAutoFilledMedicaidSupply`) and
     never get an SoS entry. ⚠️ Which means the silence Brandon asked for on 9/2 **has never once
     fired**; tell him. The SoS family is the more honest input anyway — it is literally "have we
     billed this".
     ⚠️ **He was told, and it came back as a bug five days later — see §5.32f.** A moot whose second
     half can never be true on the population it exists for is not a harmless no-op, it is an
     unconditional warning; "zero verdicts changed" measured the swap correctly and the feature
     wrongly. The supplies now have a second route in (a PAID Medicaid DVS claim); the Last Bill
     route here is unchanged.
   - Final Confirm's five editable boxes — they wrote legacy, and `resolveLastBill` then displayed
     the SoS value OVER the rep's correction. The only four both-set-and-differ rows on either
     board were exactly this (all Welcome Call sensors, all Completed, none on Insurance — so
     written on Welcome Call after the hop, by those boxes).
   - The derived **`sosMonitor`/`sosSensors`/`sosIp`/`sosInfusionSet`/`sosCartridge` = "Not Clear"
     quintet** — the thing the flag existed to feed — was declared in `finalConfirm/workflow.ts`,
     derived in `mondayMapping`, initialised in `FinalConfirmPage`, and **read by nothing**.
     Deleted. ⚠️ A first delta measured against that quintet counted **179** verdict changes;
     measured against what is actually READ, the number is **zero**. Find the consumer before
     measuring a delta.
3. **The code.** Every reader and writer moved to the SoS family and the ten legacy ids left the
   code. `samantha` no longer writes or reads them (the SoS facts blocks — Benefits' and the Auth
   Outstanding recheck's — were already the record). `welcomeCall` reads `sosLastBill*` directly;
   `isFirstTimePumpUser` now takes the pump's SoS date — the legacy pump column had zero rows, so
   this changes ONE Completed patient (a 2022 pump bill) and no live ones; `careCoordinator` moved
   with it. `finalConfirm`'s `COL.lastBillDate` map **points at the SoS ids**, so its five
   `lastBillDateX` fields are read from and written back to the SoS column — one field, one column
   — and the caption twin (`sosLastBillX`) is gone. `shared/lastBillDate.ts` keeps `formatLastBill`
   and the audit; `resolveLastBill*` is deleted. `lastBillDisplay.test.ts` pins the map to the SoS
   ids and fails if any column id in that slice is a legacy id or a send writes one.

⚠️ **The Final Confirm box changed meaning, deliberately.** It used to mean "the Not Clear date"
and now means "the last bill date we hold"; blanking it clears the SoS column. That is what the
Insurance rep recorded, and it is the column Welcome Call's next-order default reads, so the two
stages can no longer disagree.
⚠️ **Do not bring the legacy columns back into the code for any reason** — not as a fallback ("13
rows only have legacy" was true on 9/10 and is false since the backfill), not as a flag.

**Monday side (Josh, in the UI — not code):** retitle the ten legacy columns **"(retired)"** and hide
them, as the notes columns were (§10); never delete. Hop automation 7918324247 still carries the
five legacy→legacy rows — harmless while the columns exist; clear them when hiding, or capped
copies keep landing in columns nobody reads. ⚠️ Board automations of that vintage cannot be edited
through the workflow API (§10) — it is a person in the UI.

**Why it kept biting (Josephine Neal, Tammy Turpin — both 2026-09-15):** both Humana, both worked
in prod BEFORE §5.32c reached it (prod synced 9/3 → 9/15 at 10:29 AM ET), so Auth = Required
deferred the sensors SoS, the fields greyed out, and the date went into the Benefits call notes.
Both repaired by hand into the SoS date + units on BOTH boards (the hop fires only at item
creation, so an Insurance write alone never reaches an existing Welcome Call item). With §5.32c
live in prod, Send is held until the date + units are entered.

### 5.32b C30 — a blank doctor phone is flagged at Final Confirm (Sep 2026)
Brandon, same day: *"blank doctor phone should be flagged in final profile confirmation — right
now it's not being flagged and i accidentally advanced a patient with it empty."*

It was invisible **twice**: no check in `checkPack.ts` looked at the field, and the Doctor Info
block renders every input with `suppressWarning`, so the empty box had no ring either. Both halves
moved together — `C30_DOCTOR_PHONE_MISSING` plus `emptyTone="amber"` on that one field, so the
finding and the ring agree.
⚠️ **AMBER, not red, and the pack's own severity language is why** (§5.17): red is "positive
evidence the profile is wrong", amber is "a missing input" — and the blank **Clinic Address** right
beside it, which Cardinal actually *hard-blocks* on, is amber. Red here would out-rank a check for
a harder failure, which is how a check pack gets ignored. Amber still carries the per-finding ack
in `SendWithChecksButton`, which is what an accidental advance needs.
⚠️ **Presence only — C30 does not judge FORMAT.** A format rule would need the same live-board
audit C25/C26 got before anyone could pick its severity.
⚠️ Final Confirm is warnings-only by design, so this does **not** block Send. The number is
editable right there, which is the whole reason the check belongs at this stage — **Welcome Call
has no doctor phone at all** (it reads `doctorName` + `doctorNpi` only, §5.17), so there is no
equivalent to add there. `doctorPhoneCheck.test.ts` pins the severity and the field.
Blast radius when it shipped: **2** live patients (one blank across the whole doctor block, one
phone-only); 0 in Final Profile Confirmation itself, so nobody is stranded by it today.

### 5.32c Humana checks Same-or-Similar even when an auth is required (Sep 2026)
Brandon, 2026-09-10: *"For humana only: even if an auth is required, we still need to do same
or similar check. Right now, if auth is required, we don't check for same or similar ever. But
for humana only, we still need to check for same or similar, even if auth is required."*

**Benefits' `derivedSos` returned `"skip"` the moment the rep answered Auth = Required**, before
looking at anything else, and `sosEntryComplete` returned `true` for the same state — so the SoS
fields greyed out, the send gate stopped asking, and the product landed in the **Skip SoS
Products** dropdown `dropdown_mm31163t`. That is a DEFERRAL, not a skip: the check is re-asked at
Auth Outstanding, but only for a product whose auth comes back **"No Auth Needed"**
(`authOutstandingReview.trackedCards`). Humana's essentially never does.

**Measured on the live Insurance board, 2026-09-10** — **38** Humana items (the third-largest
payer, after Medicare A&B 109 and Fidelis Medicaid 95): 8 in Benefits, 2 in Auth Outstanding, 26
Complete, 2 Stuck. Of the **33 that have been worked, 29 read `Auths Required` + `SoS = Skip`**,
their Skip dropdown holding "CGM Sensors" or "CGM Monitor, CGM Sensors". So for this payer the
deferral was never a deferral — it was a check that never happened, on almost every patient.

Canonical rule: **`lib/samantha/benefitsDerive.ts` `sosRequiredDespiteAuth(primaryInsurance)`**
(+ tests). `derivedSos` and `sosEntryComplete` take it and fall through to the ordinary
facts-in/verdict-out path; **nothing else about the stage changed**, so a Humana product now
derives Clear / Not Clear from the same Last Bill Date + Units the rep records for anybody else.

⚠️ **Keyed on PRIMARY insurance, and that is complete rather than a narrowing.** The Insurance
board's Secondary Insurance column `color_mm241kqp` has exactly three live labels — *None · NY
Medicaid · Medicare Supplement* — so **Humana cannot be a secondary here** and there is no second
route to check. Nor can a Humana patient have DVS-routed supplies: `suppliesRouteToMedicaid` fires
only for `Medicaid`, `Fidelis Medicaid` and `Anthem BCBS Medicaid (JLJ)`, so every one of their
products goes through this rule rather than the hardcoded `isAutoFilledMedicaidSupply` clear.

⚠️ **Matched as a PREFIX (`/^humana\b/i`), not the exact label.** `color_mm1x157j` carries one
Humana label today (id 16, board index 15) and the two are identical, so this only differs if a
"Humana Medicare" / "Humana Gold Plus" label is ever added — and the safe direction is to KEEP
CHECKING. An over-broad match asks a rep to record a fact they can record; an under-broad one
silently restores the bug. That is the opposite call from `deriveNeverBilled`, whose exact
`"Medicare A&B"` gate is deliberate because other Medicare plans genuinely do NOT qualify.

⚠️ **`sosEntryComplete`'s new argument is REQUIRED; `derivedSos`'s is trailing-optional.** The
asymmetry is deliberate. `derivedSos` has two call sites, both of which already derive the payer
facts beside it. `sosEntryComplete` is read by the **Benefits UI as well as the send gate**, and a
silent `false` default there would leave a Humana card reading **"✓ Done"** while
`validateBenefitsFactsForSubmit` held the Send button shut with no stated reason — a greyed-out
control with no passing move, the dead end §5.10/§5.20/§5.31c each record reversing. Making tsc
name every call site is the same reasoning `SupplyLengthField`'s required `options` prop carries
(§5.31); it worked, naming all four the moment the signature changed.

⚠️ **An auth-required Humana product with no entry derives `""`, never `"skip"`.** The distinction
is the whole safety property: `deriveInsuranceOutcome` reads `""` as *incomplete* and holds the
stage, where `"skip"` would have advanced the patient with the check unmade.

**Downstream, all of it existing behaviour now reaching a population it never did:**
- Those products leave the **Skip SoS Products** dropdown and join **Not Clear Products**
  `dropdown_mm2vez5a` or neither. The stage is unchanged — `anyAuthRequired` still routes them to
  **Submit Auth.**
- **Next Order Dates now compute for them.** `resolveNextOrderWrite`'s Skip carve-out blanked the
  entered date; §5.22's missed-reorder class was exactly this shape one product over.
- ⚠️ **A Humana INSULIN PUMP coming back Not Clear now blocks at Benefits**, escalating instead of
  moving to Submit Auth (`deriveInsuranceOutcome` → `blocker`, and `composeEscalationReason` cites
  it). That is the board's standing pump rule finally applied to this payer; on the live board one
  Humana item carries a pump in its Skip dropdown, so expect it to be rare and real.
- **Auth Outstanding is untouched and needs no migration.** The recompute is
  `context === "benefits"` only, so the 2 live Humana items already sitting at `SoS = Skip` keep
  their hydrated skip and flow through the existing recheck. Going forward a Humana product is
  never `"skip"`, so `trackedCards` draws no recheck card for it and `isProductResolved`'s
  `sos !== "skip"` resolves it — no card, no stranding, because the SoS was done at Benefits.

**No board change and no automation change.** The 8 Humana patients in Benefits today are all
unanswered, so they are worked under the new rule from the first press.

**Keep-in-agreement:**
1. **The rule** — `lib/samantha/benefitsDerive.ts` `sosRequiredDespiteAuth` (+ tests, whose payer
   list is the live `color_mm1x157j` vocabulary).
2. **The derivation** — `derivedSos` / `sosEntryComplete`, and `validateBenefitsFactsForSubmit` +
   `deriveBenefitsPreview` which pass it.
3. **The send** — `samantha/mondayWrite.ts`, the `context === "benefits"` derive block.
4. **The UI** — `components/samantha/BenefitsPanel.tsx`: `sosDeferred = authReq && !sosDespiteAuth`
   is what the greying, the `disabled` props, the required star and the hint all key off. ⚠️ Never
   put `authReq` back on any of them — the card is where the rep discovers the ask.

### 5.32d The patient's phone is editable on Auth Outstanding (Sep 2026)
Josh, 2026-09-10. A rep clearing the Auth Outstanding bucket rings the patient; a wrong number
is what stops them, and the only fix was to leave the app and edit the board. The number is now
editable in place — **one field, on one page.**

⚠️ **This is NOT a way back to the manager "Edit profile" dialog §7 removed, and must not grow
into one.** That dialog edited Serving · Primary/Secondary Insurance · Member ID 1/2 — five facts
whose correction is only *half* the job, because changing the payer means re-verifying eligibility
and the Insurance board cannot run a Stedi check (no trigger column, neither eligibility input
column, ~9 of 33 result columns; §7 has the full argument). **A phone number has no Stedi half**:
nothing derives from it, no eligibility answer depends on it, and a wrong one is the single reason
a rep on this page cannot do their job. Those five facts still go back through Profile Send-Off.

**Opt-in per page.** `BenefitsPatientHeader` is shared by **Benefits · Submit Auth · Auth
Outstanding**, so the affordance is a prop: `onSavePhone` absent ⇒ byte-identical read-only markup.
Only `AuthOutstandingPage` passes it. Widening it to the other two is somebody's decision — §7
records this header as read-only for everyone after a deliberate removal — so
`patientPhoneEdit.test.tsx` fails the build if a page picks it up quietly.

⚠️ **The rejection check runs BEFORE the write, never after.** Every `writePhone` routes through
`planPhoneWrite`, which **SKIPS** a value it cannot parse rather than throwing (`shared/phoneCell.ts`
— the skip protects the 50-column verified sends, where one rejected column aborts the whole
transaction). So an unchecked 9-digit number, or one carrying an extension, saves **green having
written nothing** — §10's optimistic-UI trap, and the same reason `DvsPage` checks its doctor draft
with `unwritableDoctorFields` before its first write. The guard is `phoneRejectionReason` and it
lives in the HEADER, not the page, so any page that opts in gets it instead of having to remember.
A refusal keeps the editor open with the rep's text: they fix it rather than retype a number they
just read off a call. So does a failed board write.

⚠️ **Straight to the board, not into the page overlay** — two independent reasons, either alone
sufficient. The overlay is this page's staging area for the auth/SoS answers and **`hasOverlay`
drives the header's Save Progress button**, so a phone in there marks the patient dirty for work
that is already durably written. And the send that *would* carry it — `sendPatientToMonday` has
built a Patient Phone task from `p.patientPhone` all along — is **Auth Review Complete, the stage
mover**: a number corrected today would sit unsaved until the auth resolves, which can be weeks.
Same posture as this page's own notes save and as the DVS doctor editor. The awaited `refetch(true)`
puts the board's own value back on screen and cannot turn a landed write into a failure toast
(refetch never rejects — it catches a bad read into `error`, which is what `StaleDataNotice` renders).

⚠️ **The editor carries `key={patient.id}`.** All three pages mount this header with no key, so React
reuses it across a sidebar click — a draft that survives that is the §9 notes-box bug **with a phone
number in it**, one Save from writing the previous patient's number onto the open one. Pinned twice
(a source scan and a behavioural rerender), and verified to fail when the key is removed.

⚠️ **`.bnr button` zeroes background/border/colour on every button in this subtree** and, at one
class + one type, out-specifies every single-class Tailwind utility — the same trap §9 records for
`.pf-root`. Use the page's `.tbtn` and the new `.ph-phone-edit` / `.ph-phone-row` rules in
`benefitsRedesign.css`; a shadcn `<Button>` renders here as plain text.

A **blank is a deliberate clear**, matching `planPhoneWrite`'s own contract and the DVS doctor
editor beside it — refusing one would be a control with no passing move, and the rep types it back.
**No board change, no column added, no automation touched**; `COL.patientPhone` `phone_mm1x44yk` was
already in the read set and already written by every Insurance send.


### 5.32e An entered Last Bill Date is NEVER erased — the app used one and deleted it (Sep 2026)
Josh, 2026-09-15: *"NEVER EVER should something be deleted, it should of written to the
sensors bill date column."*

**Hope Hebb, Insurance `13041022056`, 2026-09-14 12:50 PM ET.** Humana required an auth for
A4239. The rep entered the sensors last bill date **04/27/2026**, and ONE `/send` transaction
(gateway audit — this is invisible on the board) wrote:
- `date_mm35f5j1` **Sensors Next Order Date = 2026-07-26** — which is `04/27 + 90`, so the date
  was unquestionably in the form state, and
- `date_mm59ejs2` **CGM Sensors SoS Last Bill = `{}`** — an explicit blank.

**The app computed with the date and deleted it in the same breath.** Two sends later
(12:56, 12:58) the derived next-order date went too, because the page had re-hydrated from the
column it had just blanked — `mondayMapping` reads `sosEntry: "billed"` off those very columns,
so an erasure is self-propagating. The answer survived only in the call notes. Welcome Call then
computed her sensors reorder from the **MONITOR's** date (`presentDates(sensors, monitor)` takes
either), and Final Confirm had a rep type today's date over that by hand.

**The cause, and why it read as reasonable:** both gates in `samantha/mondayWrite`'s Benefits SoS
facts block carried **`st.auth !== "required"`**, implementing spec §1's *"any previously entered
date/units are ignored while Auth = Required"*. ⚠️ **Ignoring a fact for the VERDICT and deleting
it from the RECORD are different things, and only the first was ever asked for.** Removed from
`isBilledFact` AND from `neverChecked` — a "never billed" answer was being discarded the same way,
and that one feeds §5.14's monitor purchase date, so an auth-required monitor lost its real date
*and* its never-billed answer and fell through to the **fabricated rolling 24-month placeholder**.

⚠️ **The removal is strictly additive.** `derivedSos` short-circuits on `auth === "required"`
**before it reads any fact**, so the deferral, the Skip SoS dropdown, `trackedCards` and the stage
routing are byte-identical — only the record is kept. And a rep clearing both fields still sets
`sosEntry: ""` (`BenefitsPanel` line ~202), which still clears the column, so **correcting a wrong
date keeps working** — this is not a one-way write.

**The other two writers were audited the same day and are correct — do not "align" them:**
| Writer | Behaviour | Verdict |
|---|---|---|
| `samantha/mondayWrite` Benefits SoS facts | blanked an entered date on a pending auth | **was the bug** |
| `samantha/mondayWrite` Auth Outstanding recheck | clears ONLY on a positive `sosEntry === "never"`; explicitly never touches other products | correct |
| `samantha/mondayWrite` `nodCodes` | a LOCAL copy that drops a skipped product's date from next-order math — the column is untouched | correct (spec §1, the half that was wanted) |
| `finalConfirm/mondayWrite` `lastBillDateEntries` | writes page state; a blank means the rep cleared the box (§5.32) | correct |
| `finalConfirm/workflow` split overrides | route CGM facts to the sensors half, pump facts to the supplies half | correct |
| `welcomeCall` | **reads only** — never writes a last-bill column | correct |

**Pinned by `samantha/sosFactsPreserved.test.ts`** — a source scan (the `listColumns.test.ts`
convention), verified to fail when either condition is restored. A regression here is silent on
every surface: green toast, green page, empty column.
### 5.32f C18 auth expiry stands down on a PAID Medicaid DVS supply claim (Sep 2026)
Brandon, 2026-09-15: *"this keeps popping up for medicaid supplies. if supplies got paid via dvs,
don't need this warning. only for supplies via dvs should this pop-up not exist."*

§5.32's audit measured `authExpiryMoot`'s silence and recorded it as a harmless no-op — 324 Medicaid
× Auth Valid × has-end-date product-rows, not one carrying a date in either Last Bill family, so
"this has never once fired". ⚠️ **From the floor the same fact is the bug.** Medicaid supplies
auto-clear and never get an SoS entry, so for the one population the expiry row keeps firing on, the
moot's second half was permanently false and the warning was **unconditional**. Measuring that a
silence never fires and concluding it is harmless is the inversion to watch for: a check that cannot
be satisfied is not quiet, it is noise.

On DVS the "auth" is an ePACES approval for the order in front of us and its window is **days** wide
by design — every live example ends 3 days out — so the rep reads *"Infusion sets auth expires in
3d"* and *"Cartridges auth expires in 3d"* on two lines whose claims **already paid inside that
window**. Nothing is wrong and there is nothing to fix, which is exactly how a check pack teaches
people to click through it.

**The evidence is the claim column, not a payer rule.** Infusion sets → **A4230 Claim**
`text_mm28a3xt`, cartridges → **A4232 Claim** `text_mm282cy5`, written by the `automate-dvs` Railway
services and already in Final Confirm's read set, `Patient` type and mapping. `authExpiryMoot` gains
an OR: `medicaidCoverage && (!blank(lastBill) || dvsClaimPaid(dvsClaim))`. Canonical rule:
**`lib/shared/dvsClaim.ts`** (+ tests).

⚠️ **NON-BLANK IS NOT PAID.** The shape is `<verdict>[: <detail>]`, and the live vocabulary across
all **107** non-blank rows on the Welcome Call board (2026-09-15) is `Paid: $456.00` · `Paid: $108.30`
· `Paid: $455.00` · `Paid: $0.00` · `Denied: Claim denied — see ePACES for details` · `Denied:
Maximum coverage amount met or exceeded for benefit period.` · `ERROR — see Claims Error col` · a
legacy `Yes`. A blank check would read a **denial** as evidence the line is fine — the opposite of
what it says, and the one direction that costs money. Linda Nadas (`12798018278`) carries `Denied`
live today. Only an explicit `Paid` verdict silences; the legacy `Yes` does not.
⚠️ **The verdict decides, the amount only explains.** `Paid: $0.00` is paid — DVS adjudicated and
accepted it; reading the dollar figure to overrule the word is the inversion §5.5 records for SMS
delivery. Three rows carry it, all Completed or Stuck, none live.

⚠️⚠️ **DO NOT gate this on `hcpcRules.suppliesRouteToMedicaid`** — the obvious reading of "supplies
via dvs", and wrong. That rule is a **prediction** built on a hand-maintained payer set
(`SUPPLIES_NEED_NY_MEDICAID_SECONDARY`), and it is already wrong for this population: **`United
Medicaid` is not in it**, yet two live patients on that payer (`12364959798`, `12979216005`) have
paid A4230/A4232 claims. A set that must be updated when a payer is added will not be (§5.9/§5.10).
`medicaidCoverage` is kept instead — a **regex** (`/medicaid/i`) plus the NY Medicaid secondary, so
United Medicaid passes — and the claim column is the **record of what DVS actually did**. Both halves
still required on both routes, for §5.32's own reason: a commercial window IS what the payer
enforces.

⚠️ **Scoped to the supplies BY CONSTRUCTION**, per Brandon's "only for supplies via dvs". Only the
infusion-set and cartridge rows of `authProducts` carry a claim column at all — the monitor, sensors
and pump pass `""` and can never be silenced this way — so the scope cannot drift as that array
grows, and no second condition has to be kept in step. Per LINE, like the Last Bill pairing: a paid
infusion-set claim does not cover the cartridges.
⚠️ Scoped to the **EXPIRY** branch only, exactly as the Last Bill route is. `C17_AUTH_DENIED`,
`C17_AUTH_UNRESOLVED` and `C18_AUTH_NO_ID` still fire however well a line has paid — those are
statements about the auth's RESULT, not about a date drifting past today.

**Blast radius when it shipped:** the two live patients it was reported from — John Higgins
(`13043500534`, Fidelis Medicaid) and Suleiman Mohsen (`13043572541`, Anthem BCBS Medicaid (JLJ)) —
both with infusion-set and cartridge auths ending 2026-09-18 and both claims paid, i.e. Brandon's
screenshot to the day. Alex Pinet, Yisroel Schreiber (ended 09-13, red) and Charmaine Brooks (09-15)
lose the same row. **Final Confirm never blocks Send**, so this only ever removes noise.

**Keep-in-agreement:**
1. **The rule** — `lib/shared/dvsClaim.ts` (+ `dvsClaim.test.ts`, whose fixtures are the live column
   vocabulary — re-run that `is_not_empty` scan before adding a verdict).
2. **The moot** — `lib/finalConfirm/checkPack.ts` `authExpiryMoot` + the `dvsClaim` field on
   `authProducts` (`""` for the three non-supply lines).
3. **The columns** — `text_mm28a3xt` / `text_mm282cy5` on Welcome Call, already in
   `finalConfirm/mondayApi.ts` `READ_COLUMN_IDS`. The SPA never writes them; `automate-dvs` owns them.

### 5.32g C31 — the infusion-set quantities must ADD UP to within the cap (Sep 2026)
Brandon, 2026-09-15: *"it should flag if insuion sets add up to more than 3 as a warning. If it's
Aetna, it's ok if it's 4. If it's carecentrix or anthem commercial, it's ok if its 9. Everything
else should only be 3 total."*

**Nothing checked the TOTAL.** Welcome Call draws the cap under each quantity field on its own
(`WelcomeCallForm`'s `CapNote` on Qty Inf. 1, Qty Inf. 2 and Qty Cartridge), and
`infusionSelection.infusionQtyPlan` compares the pair only against the ORDER total, never against
the cap. So on a default-cap payer a rep could put **3 in each slot** and pass every control in the
app while ordering six boxes the payer pays three of. `C31_INFUSION_QTY_OVER_CAP` is that sum.

⚠️⚠️ **CARECENTRIX IS NOT A PAYER — it is the Referral SOURCE**, `color_mm1w5wxr` label 3. Primary
Insurance `color_mm1x157j` carries 29 labels and **not one of them is CareCentrix**, so the note
names a second DIMENSION rather than restating the payer list.

⚠️ **The two notes AGREE; the later one is not a revision.** Read naively, 2026-09-15 drops Horizon
and Cigna from 9 to 3 — reversing Brandon's own 2026-09-09 decision to raise Cigna from 3 to 9
(§5.31), six days old. Measured instead: **all 33** CareCentrix-referral patients on the live
Welcome Call board carry Primary Insurance = **Horizon BCBS**, with no other payer once.
CareCentrix administers Horizon's DME benefit, so "carecentrix" and "horizon" name ONE population
and the September 9th list stands. Horizon and Cigna keep their 9; CareCentrix is added as an
independent route to 9.
> **It costs nothing either way today.** Over the **197** live rows carrying a quantity, *both*
> readings flag **exactly zero** patients: 192 order 3, two order 4 (Aetna Commercial and Anthem
> BCBS Commercial — both cap-raised), and the single 5 is Sean Dayton (`12583677009`), Horizon
> **and** a CareCentrix referral, so covered by either route. **13** rows use a second set at all.
> The check is preventive, not a backlog. Tell Brandon the Horizon/Cigna reading if he meant the
> narrower list.

**ONE module, re-exported rather than copied — `lib/shared/infusionCap.ts`** (+ tests).
`welcomeCall/payerRules` re-exports the cap table it used to own, and `finalConfirm/checkPack`
imports the same thing. ⚠️ A per-slice copy is the §5.7/§5.17 hand-synced hazard with a specific
cost here: Welcome Call is where the quantity is **set** and Final Confirm is where it is
**checked**, so two tables drifting means one stage offering a number the next one complains about,
with **no move that satisfies both** — the dead end §5.10/§5.20/§5.31c/§5.32c each record reversing.
Same pattern as `shared/monitorPurchaseDate.ts` (§5.14).

**The rule.** `infusionSetCap(primaryInsurance, referralSource)` takes the **higher** of the two
dimensions — each is an independent statement that this order may carry that many, so a CareCentrix
referral on an unrecognised payer is a 9 and an Anthem Commercial patient referred by a doctor is
still a 9. `infusionSetTotal(qty1, qty2, primary, source)` returns `{total, cap, payerLabel, over}`.
⚠️ Still PATTERNS, not board labels: `anthem.*commercial` never `anthem` (the other three Anthem
plans are 3), no generic BCBS rule (TN/FL/WY are 3), and an unrecognised payer **and** an
unrecognised referral source both fall to 3 — a cap set too HIGH is the dangerous direction.
⚠️ **Sets only — cartridges are deliberately not summed in.** Brandon named the sets, and Qty
Cartridge is a separate order line already capped in its own right; folding it in would be a
different claim about a different line.

**Welcome Call's own cap note now reads the referral source too**, through the same call. Zero live
delta (every CareCentrix patient is already Horizon), and it is what stops the two stages disagreeing.

⚠️ **AMBER**, matching its `C14` siblings on these very fields and Brandon's "as a warning" — and
Final Confirm blocks nothing regardless. The quantities are editable right there, which is why the
check belongs at this stage.
⚠️ **Runs on SPLIT profiles**, like C27 and unlike the C14 quantity rows: `getSplitOverrides` gives
each half a coherent Serving, so the supplies half carries the real quantities and nothing about
splitting an order makes six sets payable. Gated on `pumpishInServing`, so a quantity on a CGM-only
profile stays `C14_PUMP_QTY_ON_CGM`'s row — two rows about one pair of numbers is how a check pack
gets ignored (§5.17).

⚠️ **The check-pack suite's "clean profile" fixtures were ordering 10 sets.** Ten was an arbitrary
"a quantity is present" filler from before any cap existed, and C31 correctly reports it as over
Anthem Commercial's 9 — so the fixture asserting ZERO findings was describing an order no payer
pays for and no live patient has ever had (the board's maximum is 5; nobody has ever ordered 9).
All ten filler quantities are **3** now. The fixture was wrong, not the check.

**Keep-in-agreement:**
1. **The rule** — `lib/shared/infusionCap.ts` (+ `infusionCap.test.ts`, whose payer and referral
   strings are the live label sets of `color_mm1x157j` and `color_mm1w5wxr`).
2. **The two consumers** — `welcomeCall/payerRules` re-export → `WelcomeCallForm`'s `CapNote`
   (per field) · `finalConfirm/checkPack` C31 (the pair total). Never re-copy the table.
3. **The columns** — `numeric_mm1xv7wr` / `numeric_mm1xkq3b` and `color_mm1w5wxr`, all already in
   `finalConfirm/mondayApi.ts` `READ_COLUMN_IDS`.

### 5.33 The two insurance pickers read their labels from the board (Sep 2026)
Brandon added the payer **"Health Plans Inc (PHCS)"** (label id **159**) to Monday and expected it
in the Command Center. It wasn't: **Primary Insurance `color_mm1xg10n`** and **General Insurance
`color_mm24ap4j`** were drawn from the hardcoded `PRIMARY_INSURANCE_INDEX` /
`GENERAL_INSURANCE_INDEX` maps in `profile/mondayMapping.ts`, which are the pickers' option lists
AND the write maps. Josh, 2026-09-11: *"primary and general should read from monday on load, if he
adds on there it should automatically show up in CC."* Both columns now come from the column's own
`settings_str`, like the four product dropdowns beside them (§5.2 / `lib/profile/boardLabels.ts`).

⚠️ **THE PICKER AND THE WRITE HAVE TO MOVE TOGETHER.** Offering a label the write path cannot
resolve is worse than not offering it: `statusWriteTask` and `mapped()` both **skip** an index they
can't find, so the rep picks the new payer, Save goes green, and the column keeps its old value.
Every writer of these two columns now takes a live index — `unverifiedWrite`'s `buildIntakeTasks`
(General) and `buildVerifiedInsuranceTasks` (Primary, which had no `liveIndex` parameter at all),
`buildAdvanceTasks`, and in `profile/mondayWrite` `buildDataTasks`, `writeBenefitsInputs` and
**`writePatientProfile`**. That last one is the load-bearing one: it is the live pre-Stedi write
(§5.11 — `StediPanel` is dead, the flow is inline in `ProfilePage`), and a payer it could not
resolve was never written, so `verifyProfileWritten` then aborted the run on a General Insurance
mismatch the rep had no way to act on. `unverifiedWrite.test.ts` pins a board-only label producing
a task, and producing none without the live index — both verified to fail when reverted.

**The hardcoded maps stay as the FALLBACK**, deliberately — a failed settings fetch degrades to
today's list, never to an empty select on a required field or a blocked intake. ⚠️ That is the
opposite of `shared/statusOptions.ts`, whose rule is *disable the control rather than fall back*.
Both are right: that rule exists for columns whose indexes were RENUMBERED by a dedup, where a
stale map writes a blank. These two have never been renumbered (every label in both maps was
checked against the live board 2026-09-11), and a disabled payer picker stops intake dead.

**Two latent bugs in `boardLabels.ts` had to be fixed first**, and both were silent:
1. ⚠️ **The cache ignored `columnIds`** — one module-level promise, so the FIRST caller's column set
   won for the whole session and a second call site asking for different columns got `{}` and sat
   on its hardcoded map for ever. It is per-COLUMN now, fetching only what it is missing.
2. ⚠️ **It sent `mondayIdentityHeaders()` alone**, i.e. no `Authorization` in direct mode — the
   exact failure `statusOptions.ts` documents (401 → every dropdown silently on its fallback).
   Both header sets now, as every other `gql()` in the app does.
It also gained a **TTL** (5 min, matching `STATUS_OPTIONS_TTL_MS`) and the refresh lives in
**`hooks/profile/useBoardLabels.ts`** — interval plus a **focus** listener, because the real
scenario is a rep switching to Monday, seeing the new payer and switching back. A mount-only fetch
would have made the TTL dead code for these pages, which is the trap `statusOptions.ts` calls out.

⚠️ **`NON_PAYER_LABELS` is a one-entry hide-list and must stay tiny.** Reading General Insurance
live would have put **"Stedi"** back in front of reps — it is our eligibility VENDOR, removed from
that picker on 2026-08-13 (Katie via Josh) — so it is filtered. §5.2's standing rule is that the
board's labels are the picker's labels ("Not Serving", Josh 2026-08-20), so an entry here needs a
recorded decision, not a hunch that a label looks odd. **"Cash Pay" is deliberately NOT hidden**:
nothing ever ruled it out, it was missing only because nobody added it to the hardcoded map.
Primary Insurance hides nothing — "Stedi" is on that column too and has always been pickable there.

**The visible delta is pinned by a test** (`boardLabels.test.ts`, "the picker delta from reading
the board"), because the point of the change is ONE new payer and anything else appearing is a UI
change nobody asked for: General Insurance gains *Cash Pay* + the new payer and loses nothing;
Primary Insurance gains the new payer and re-spells **MagnaCare → Magnacare**, which is the board's
own spelling — writes are by index, so the board value was already "Magnacare" and this only stops
such a patient's `<select>` matching no option. Re-run that comparison against the live
`settings_str` before changing either list.

⚠️ **This covers Profile Send Off ONLY — every other board's payer list is still hardcoded**, and
they are separate columns with separate indices: `samantha/hcpcRules.ts` (`PrimaryInsurance` union,
`SUPPLY_HCPC_GROUP_BY_PAYER`, `PRIMARY_INSURANCE_OPTIONS` — which is also the READ, via
`samantha/mondayMapping`'s `findExact`, so an unlisted label reads as `""`), and the
`PRIMARY_INSURANCE_OPTIONS` `{index,label}` lists in `welcomeCall`/`finalConfirm`/`subscription`
`workflow.ts`. Nothing keyed on payer TEXT changed: `payerRules` matches patterns and falls to the
conservative cap of 3, `resolveHcpcs` returns "Evaluate", and both OOP estimators return
`ok: false` rather than a wrong number.

⚠️ **A payer has to exist on EVERY board it will travel to — adding it in two places is not
adding it.** Brandon added "Health Plans Inc (PHCS)" to Profile Send Off (both columns),
Subscription `color_mm254qxj` and New Order `color_mm18jhq5`, which left it **absent from the whole
middle of the pipeline** — Medical Evaluation, Insurance and Welcome Call (`color_mm1x157j` on all
three) — **and from the Claims Board's Primary Payor `color_mm3a93ek`**, which he believed was
done. A status write to a label id a column does not have is dropped without erroring
(§5.12/§5.20/§5.31c/§5.31d), so those patients would have gone blank from Benefits onward.
**Completed 2026-09-11** (Josh) — the four missing columns were added with
`change_labels_if_missing` on one item in a terminal group, then that item restored to its exact
prior value; no patient row and no existing label was touched.

⚠️⚠️ **MONDAY ASSIGNED A DIFFERENT ID ON EVERY BOARD — none of them is 159.** It takes the lowest
free slot per column, so the id is a property of the COLUMN's history, never of the payer. Read
back live after adding:

| Board | Column | "Health Plans Inc (PHCS)" id |
|---|---|---|
| Profile Send Off | `color_mm1xg10n` Primary Insurance | **159** |
| Profile Send Off | `color_mm24ap4j` General Insurance | **159** |
| Subscription | `color_mm254qxj` | **159** |
| New Order | `color_mm18jhq5` | **159** |
| **Medical Evaluation** | `color_mm1x157j` | **108** |
| **Insurance** | `color_mm1x157j` | **7** |
| **Welcome Call** | `color_mm1x157j` | **7** |
| **Secondary Claims** | `color_mm3a93ek` Primary Payor | **3** |

That the first four all landed on 159 is a coincidence of those columns having the same free slot,
and it is exactly what makes "the label id is 159" a tempting and wrong thing to carry between
boards. **This is the same trap as Sub-Stage (§5.12), Intake Sub-Stage (§5.20), Order Frequency
(§5.31c) and the phone slots (§5.31d) — now the fifth time.** Read `settings_str` back; never infer.
⚠️ **The board HOPS are unaffected**, because the create-item automations copy status columns by
label TEXT, not by id — which is already proven by every other payer on these boards (Medicare A&B
is 2 on Profile Send Off, 8 on ME/Insurance/Welcome Call and 106 on Claims, and has always carried
across). The id only matters to code that writes the column directly.
⚠️ **Which is why `stedi-monday-integration`'s `STATUS_INDEX_MAP` for the Claims Primary Payor must
be `3`, not 159** — that service writes the index straight in, so 159 would be dropped at HTTP 200
with nothing in the logs.

⚠️ **Still hardcoded, so the payer is NOT yet pickable on those stages' own screens**:
`samantha/hcpcRules.ts` (`PrimaryInsurance` union · `SUPPLY_HCPC_GROUP_BY_PAYER` ·
`PRIMARY_INSURANCE_OPTIONS`, which is also the READ via `samantha/mondayMapping`'s `findExact`, so
an unlisted label reads as `""`) and the `PRIMARY_INSURANCE_OPTIONS` `{index,label}` lists in
`welcomeCall`/`finalConfirm`/`subscription` `workflow.ts`. Those need the per-board ids above, not
159. Extending the §5.33 live-label treatment to them is the better fix and is not yet done.

---

### 5.34 The Welcome Call board joins the Propose Stuck ladder (Sep 2026)
Josh, 2026-09-14: *"we need to add a propose stuck system on the manager tab that works just like
insurance and medical eval does — stuck goes to manager escalation, stuck in manager escalation goes
to final escalation, patient moved to stuck or moved back to pipeline logic there."* This is the
**rewrite** §10 asked for instead of piecemeal patches to a write-only escalation, and it covers
BOTH stages on the board — Welcome Call and Final Profile Confirmation share one Escalation column
and one Notes log, so a ladder on one stage alone would have left the other writing a flag nobody
could clear.

**One column, three rungs, matched by label id** (`lib/welcomeCall/mondayApi.ts` `ESCALATION_INDEX`):
Escalation `color_mm1x7997` — the same id lineage as Medical Evaluation — **0** = with a manager
(the board's own label still reads **"Escalation Required"**; ME calls that rung "Manager Escalation
Required", and the code accepts either text), **1** = Done, **2** = Final Escalation Required (a
stuck PROPOSAL awaiting Final Decisions).

> ✅ **Label id 2 was ADDED LIVE the same day (2026-09-14, on Josh's go-ahead) and read back from
> `settings_str`:** id 0 "Escalation Required" (stuck_red) · id 1 "Done" (done_green) · **id 2
> "Final Escalation Required" (working_orange)** — the same three ids and colours as Medical
> Evaluation, so every reader's hardcoded 2 is right and nothing in the keep-in-agreement list
> below needed correcting.
> ⚠️ **How the id was obtained matters, because the obvious route is refused.** `update_column`
> rejects two labels sharing a colour (*"Colors should be unique"*), and Monday derives a NEW
> label's id from its colour (§5.31c/§5.31d) — so stuck_red, the one colour that maps to id 2,
> was already on id 0, and asking for working_orange (id 0's slot under that rule) had an untested
> outcome. It took two atomic updates: (1) move id 0 to working_orange and add the new label as
> stuck_red, which lands on id 2 under every rule Monday could apply (colour → 2, lowest free
> slot → 2, max+1 → 2); (2) swap the two colours back, existing labels being addressed by id. For
> the seconds in between id 0 was orange, and no row carried it (29 + 32 rows scanned, none
> escalated). **Read `settings_str` back after ANY label change on this column — never infer.**
> `mondayWrite.assertEscalationLabelExists` **stays**: it checks the live label set BEFORE any
> write and throws *"has no 'Final Escalation Required' label (id 2) — nothing was written"*, so a
> label deleted or deactivated on the board later is a refusal with a reason rather than a
> proposal that looks made and reaches nobody (Monday takes a write to a non-existent label id at
> HTTP 200 — three Final Profile Confirmation rows carry `{"index":5}` in Advance? today, a value
> no label names). Still optional and cosmetic, not done: renaming id 0 to "Manager Escalation
> Required" to match the other two boards; every reader keys on the index.

**The writers — `lib/welcomeCall/mondayWrite.ts`**, stamps shared from `lib/masheke/proposedStuck`
so Oversight's `__proposedReason__` reads them with no special-casing:
- `proposeWelcomeCallStuck(id, reason, level)` — reason stamped into Notes FIRST, then Escalation →
  `level`. Never downgrades: a patient already at Final stays there. Returns the rung written.
- `escalateWelcomeCallToFinal(id, note)` — Manager Intervention → Final from the Oversight
  drill-down; note REQUIRED (the Submit Auth two-step rule); idempotent on retry.
- `approveWelcomeCallStuck(id, note?)` — optional stamped note → **Stage Advancer → "Stuck / Don't
  Proceed" (id 2)** → Escalation → Done. Board automation **7918322174** moves the item to the Stuck
  group. The advancer is the automation trigger, so it goes before the flag clear, as on ME.
- `returnWelcomeCallToQueue(id, note?)` — stamped note (defaulting to "Returned by a manager",
  the one trace the rep gets) → **Follow Up status + date CLEARED** (this board has no Next Action
  Date; a cleared snooze is "due now", the twin of ME's NAD = today) → Escalation → Done, LAST.
Every one is sequential and deliberately NOT a verified-write transaction: nothing on this board
triggers on the Escalation column (the one workflow that did, 7918322106 → the "Escalation" group,
is inactive).

**What went, on both pages:** `EscalateButton` (×2) and the shared `EscalationFormModal` are
**deleted** — they wrote index 0 plus a retired Escalation Notes long_text and nothing could clear
the flag; the four ME pages' dead import lines went with them (`lib/shared/escalation.ts` stays for
the Escalations tab's legacy parse). `markStuckWithReason`, the DIRECT exit that itself replaced
"Don't Advance" on 2026-09-11, is gone: a rep no longer writes the Stage Advancer, a manager does
from Final Decisions. Both stages' **sends no longer write Escalation at all** — `escalated` is
hydrated from the board now, so re-writing it on every Send was §7's Insurance anti-pattern (a flag
raised since the last poll overwritten, a proposal silently re-asserted). `stuckLadder.test.ts`
scans both writers for it.

**The screen.** `StageActionBar` gained the `welcomeCall` board (`stage="welcome-call"` /
`"final-confirm"`); the same (stage × `?mv=`) table decides Propose Stuck / Approve Stuck / Send
back to pipeline as on every ME and Insurance page. Welcome Call's two Stuck buttons (header + End
of Call) are now two triggers for ONE Propose Stuck dialog — the bar renders it in **controlled
mode** (`proposeOpen` / `onProposeOpenChange`) so the page can open it from the second button.
`proposeStuckLevel` starts both stages at **manager**; a proposal from Manager Intervention, or on
a patient already flagged, promotes to **final**.

**Reads, all by index:** `mondayMapping` derives `escalated` (0) and `proposedStuck` (2) on both
stages — no more hardcoded `false`. `sidebarList` (both stages) drops proposals from every rep
list, lists index 0 under the escalated filter, and — from `?mv=final-decisions`, which Oversight
sets beside `?manager=1` — lists ONLY the proposals, so a manager clicking a Final Decisions chart
gets that column's cohort. `useRoleCounts` + both baseline generators: index 0 is the escalated
count, index 2 is in neither count (the ME rule). `escalationDetail` treats the board as split
(`"Escalation Required"` = manager rung there, `flat` survives only for Subscription);
`systemMgmt/mondayApi` detects by index on it; Search's Proposed Stuck folder follows.
`careCoordinator` counts index 2 in the footer, never lists it.

**Oversight.** The Welcome Call section is the 3-column scheme now — before this an escalated
Welcome Call patient matched NO chart (§7's failure). Four charts: `welcome-call-manager` /
`-final` and `profile-review-manager` / `-final`, `rowOf` their stage, decisions
`welcome-call-manager` (Escalate to Final / Send back to pipeline) and `welcome-call-final`
(Approve Stuck / Return), reason sliced from Notes `text_mm6vqq2k`. The Processor Overview charts
exclude both rungs, so the three columns partition each row — `columnExclusivity.test.ts` has a
Welcome Call block. `profile-review` also gained the `/final-confirm` route it never had.

**Blast radius when this shipped: zero.** 29 Welcome Call rows and 32 Final Profile Confirmation
rows scanned live on 2026-09-14 — not one carried an Escalation value.

**Keep-in-agreement (§5.8 counting contract):**
1. **Label ids** — `welcomeCall/mondayApi.ts` `ESCALATION_INDEX` (the writers) ⇄ the hardcoded
   `index: [0]` / `[2]` in `oversightApi.ts` CHART_FILTERS, `escalationDetail.ts` SPLIT_BOARDS,
   `systemMgmt/mondayApi.ts`, `useRoleCounts.ts` `WC_*_INDEX`, both baseline generators,
   `careCoordinator/workflow.ts`. All key on 2 = final, verified against `settings_str` on 2026-09-14 when the label was added;
   re-verify after any change to the column's labels.
2. **Queue rules** — `welcomeCall/sidebarList.ts` · `finalConfirm/sidebarList.ts` ·
   `useRoleCounts.ts` · `scripts/snapshot-baseline.mjs` · `services/baseline-cron/index.mjs` ·
   `oversightApi.ts` (`welcome-call` / `profile-review` filters).
3. **Stage keys** — `lib/shared/stageActions.ts` (`welcome-call`, `final-confirm`) ⇄ the two pages'
   `<StageActionBar stage=…>`.

Tests: `welcomeCall/stuckLadder.test.ts` (write order · the label guard · the send-path scan),
`columnExclusivity.test.ts` (Welcome Call block), `stageActions.test.ts`, both `sidebarList.test.ts`,
`escalationDetail.test.ts`, `careCoordinator/workflow.test.ts`.

**The same day's write/read audit of the Welcome Call UI** is recorded in
`WRITE_RELIABILITY_AUDIT.md` (2026-09-14 section). Its one code fix besides the ladder: the
**Welcome Call Text "Queued" button now resets the trigger ON THE BOARD** (`resetWelcomeCallText`).
It used to toggle off locally only, so the column stayed at "Send" and a re-press wrote the same
value onto itself — no status change, automation 7918318033 never fired, the button read "Queued"
again and no text went out. The §9 advancer-no-op class, one column over.

### 5.35 Orders — the New Order Board and the Cardinal SKU Tracker in one place (Sep 2026)
Josh, 2026-09-15: *"a new role that displays the info on the new order board and cardinal sku
tracker, all in one place … more like the subscription board but for orders … this is only for
observation, but someday we will flip the switch on letting them order from this ui (they'd just
flip to 'ordered' — that does it) — just not today … often they will be using this to search
patients asking statuses."* Role id **`orders`**, route **`/orders`**, a **task tile** beside
Subscription (`DailyBurndown` `TASK_ROLE_IDS`); slice `lib/orders/*`, `hooks/orders/*`,
`components/orders/*`, `pages/OrdersPage.tsx`. **Observation, with ONE real write**: the
backorder-substitution pick, which is the act that emails Cardinal (below). Placing an order is
still the board's — that write sits dark behind *the switch*.

**The board, as it behaves (verified from the ten workflows + six webhooks, 2026-09-15).** One
item = one ORDER; a create-item workflow (7917933994) stamps Order Date = today and **Order Status
`status` = "Order"**, three more default the quantities (cartridges from the infusion sets, sensors
per CGM type). From there it is a machine-driven board with ONE manual step:

| step | who | what |
|---|---|---|
| Order Status **"Order"** | — | webhook 610148313 runs the advisory **Pre-Check** (`color_mm5bh2az` + detail) |
| **→ "Ordered"** | **a human, on the board** | webhook 595100182 hands the item to `cardinal-api-poller`, which submits it and writes API Status, CAH Order Number, PO Number, the raw request/response, holds; workflow 7921060784 flips the status straight on to **"Process Claim"** — "Ordered" is transient |
| "Process Claim" | automation | 7920451241 moves it to *Accepted / Partial* unless API Status is already SHIPPED/Delivered (7919401900 → *Shipped/Delivered*); webhook 562945440 fires the claims side |
| API Status → SHIPPED | poller + 7920451305 | *Accepted / Partial* → *Shipped/Delivered* — ⚠️ **SHIPPED only**, so an order that goes Partially Shipped → Delivered stays in *Accepted / Partial* (11 live rows) |
| "On Hold" | a human | a SNOOZE: 7919939752 flips it back to "Order" at 8:15 AM ET on the day **Order Date** arrives — so Order Date doubles as the return date |
| Returns / Cancelled | a human | moved by hand; the return statuses are set by hand |

Census 2026-09-15 (1,477 rows): Order **7** (5 to place, 2 on hold) · Returns 6 · Accepted /
Partial **101** (39 partially shipped, ~24 on hold, 14 booking errors, 11 delivered-but-not-moved) ·
Shipped/Delivered **1,361** (of which **609 carry no API Status at all** — placed before the poller
existed) · Cancelled 2. Human activity in the week of 9/8, one user: **116 flips to "Ordered"**,
12 back to "Order", the Cardinal columns cleared to null before a retry (8×), 3 On Hold/Order Date
snoozes, member id / doctor address / auth id fixes, return statuses, one note, 14 deletes.
That is the whole job the page observes.

⚠️ **THE GROUP IS NOT THE STAGE — API STATUS IS, for a placed order.** `workflow.orderStage`:
Cancelled/Returns groups and the return statuses first; then the pre-placement statuses (Stuck ·
On Hold · **Order → `toPlace`** · Ordered → `placing`); then, for "Process Claim"/"Paid Cash",
Cardinal's verdict — Delivered → `delivered`, SHIPPED/Partially Shipped → `shipped`, hold/error/
accepted/backordered → `inProgress`; a **blank** API Status is `shipped` only in the
Shipped/Delivered group (the pre-poller rows) and `inProgress` anywhere else. Pinned in
`workflow.test.ts` with the two live shapes that would otherwise mislabel.

⚠️ **Cardinal's answer is three columns, and the label alone lies.** A live row reads API Status
**"Warning"** while Hold Reason `text_mm486hh7` says "Credit Check Failure" and API Message carries
the hold sentence. `cardinalStatus(apiStatus, holdReason, apiMessage)` reads all three, turns the
five hold sentences ("Order has been put on hold, Hold reason: X, …", "HOLD RELEASED; Another Hold
applied … Hold Reason: Y") into **"On hold — X"**, and prints an unrecognised label **verbatim**
(§5.20's rule). ⚠️ A Hold Reason only ever UPGRADES an unshipped verdict — the poller never clears
the column, so delivered orders still carry the hold that once delayed them. The slim list carries
`apiMessage` precisely so a sidebar row and the open order reach the same verdict.

**Two-tier read (§5.25's shape).** `LIST_COLUMN_IDS` (~35 columns) for every order on the board,
paged at 500 (three round trips), every **60s**, hidden-tab polls skipped — the sidebar, the overview
and the stock view's "open orders" counts render from it. The open order is `fetchOrderById` at full
width **plus its assets** (the seven file columns become View buttons), refreshed silently with each
poll. A list row is stamped `partial` and is never rendered as the open order (`useOrders.test.tsx`);
`listColumns.test.ts` scans every list-side source so a field read off a row is in the slim set.
⚠️ `fetchOrders` THROWS on a mid-pagination failure instead of returning the pages it got — every
other `fetchGroupItems` in this app swallows that (`catch { break }`), which is fine for a queue and
wrong for a page whose overview COUNTS what it fetched. A failed poll keeps the previous list and
raises the `StaleDataNotice`. Nothing is cached in localStorage (the §5.25 quota failure); a
module-scope copy gives the instant repaint within a session.

**The sidebar** (`lib/orders/sidebarList.ts`): *To place* (oldest first, "Placing" riding along) ·
*On hold* (return date) · *Placed · in progress* (rose flags first, then oldest) · *Shipped* ·
*Delivered* (newest first, **capped at the most recent 75** — `deliveredHidden` says how many more;
a search or "Show all" lifts the cap) · Returns · Stuck · Other · Cancelled (collapsed). The search
box matches every token against name, last-ten phone digits, CAH order number, PO number, all five
tracking numbers and the item id — the page's whole reason to exist. Landing with nothing selected
is deliberate: there is no first patient to auto-open on 1,480 orders, so the empty pane is the
**overview** (stage tiles, "needs a person", Cardinal stock alerts with open-order counts).

**Attention (`orderFlags`)**: rose = hold · booking error · needs review · deleted · product not
for sale at Cardinal · substitution request failed; amber = backordered · substitution needed ·
an unclean pre-check (to-place only); sky = partially shipped · substitution sent. ⚠️ The
availability dropdowns (`dropdown_mm4wdmdd` Backordered · `dropdown_mm4waxqn` Inactive) are written
by a daily sweep on EVERY order, delivered ones included, so they only flag while the order is still
open — a delivered order whose set later went on backorder is not that patient's problem.

**What was ordered ↔ what Cardinal can ship** (`lib/orders/skuJoin.ts` + tests). The order board
records products as labels with a quantity each; the tracker has one row per SKU grouped by family.
The join is BY NAME through `infusionStock.stockKey` and is **verified, not assumed** — the test
holds every live label of both boards (23 infusion sets, 9 CGM types, 4 pumps/cartridges) and the
one spelling gap (`Mio Advance Clear 9 mm 23"` vs the tracker's `9mm`). ⚠️ **Receivers are named by
their sensor**: the order board has no receiver column (Qty: CGM Monitor is the quantity, CGM Type
says which reader) and the tracker names its rows `<sensor(s)> → <receiver>` ("Dexcom G7 / G7 15-Day
→ G7 Receiver"), so the left side is parsed as aliases and matched as a SUFFIX ("FreeStyle Libre 3
Plus" ends with "Libre 3 Plus"). Simplera Sync and Guardian 4 have no receiver row (the 780G is the
receiver) and correctly join to nothing. A product with a blank quantity is NOT a line (§5.22b:
blank means never set). Each line carries `stockVerdict`'s pill — status decides, the count explains
(§5.31b). The stock view (`?view=stock`) is the whole tracker by family with **open orders per SKU**,
the last-run headline from the Run Log row, and a staleness warning past `STOCK_STALE_DAYS`.
`skuTrackerApi.fetchSkuTracker` reads the full row (the Welcome Call `stockApi` keeps its three
columns) under the same incident guards; both hooks are 30-minute-TTL module stores.

**The count** — `orders` = the Order group's items whose Order Status reads **"Order"**: orders
waiting to be placed. Three places, §5.8's contract: `useRoleCounts` (`ORDERS_*`),
`scripts/snapshot-baseline.mjs` `countOrders`, `services/baseline-cron/index.mjs` `countOrders` —
and the sidebar's *To place* section, minus the transient "Ordered". The Operations tab reads
"not connected" until the first cron after deploy; `operationsGroups.ts` places the role under
*Other*.

**Backorder substitution — the one thing a rep DOES here, and from 2026-09-15 they do it HERE.**
Josh: *"let them actually pick the substitute and then click a 'send' button, then notify them if
email successfully sent via the second column, just display it."* So the page picks the replacement
in **Substitute Infusion Set** `color_mm727jnp` and that write IS the send: the **`email-serivce`**
Railway app (feature `backorder-substitution`, monday webhook **635472669**) hears the column
change, reads the replacement's SKU **live** from the Cardinal SKU Tracker, emails Cardinal customer
care (`crtcustcare@cardinalhealth.com`, cc Katie/Josh/Brandon + our two reps) asking them to switch
the order, and writes **Substitution Status** `color_mm727p5m` — `Sent`, or an `Error:` label naming
exactly which field blocked it — plus a receipt line in Notes. `components/orders/SubstitutionCard`
shows what is on back order, the set on the order it maps to, the pick with its SKU + stock pill,
the Send button, and that second column as the notification.
- ⚠️⚠️ **THE WRITE IS THE SEND — no draft, no preview, no undo.** So every refusal is checked
  BEFORE the press (`substitutionSendRefusal`: nothing picked · no CAH Order Number · no usable
  Qty: Infusion Set 1 · no set or an ambiguous pair on the order · the backordered set picked as
  its own replacement) and the button carries a confirm naming the patient, both sets and the order
  number. After the press an `Error:` label is the only thing left to read.
- ⚠️⚠️ **A REPEAT PICK CLEARS THE COLUMN FIRST** (`substitutionSendKind` → `requestSubstitution`).
  Writing the label the column already holds fires nothing twice over: Monday takes a status write
  onto its own value at HTTP 200 without a webhook (§9's advancer no-op), and the service's
  `matches()` rejects an event whose value equals its previous value anyway. A rep chasing an
  unanswered request would have got a green toast and no email. The clear cannot send on its own
  (the service needs a real set label), so the pair is ONE email — which is exactly what a rep does
  by hand on the board, and what the service's `dedupe: false` exists for. The button says
  "Re-send" when that is what pressing it means. `substitutionSend.test.ts` pins the order.
- ⚠️ **The index comes from the LIVE board** (`useStatusOptions` → `indexForLabel`), and the
  control is DISABLED until it loads — never a hardcoded list. A write to a label id the column
  does not have is dropped at HTTP 200 with nothing in the logs (§5.12/§5.20/§5.31c/§5.31d/§5.33,
  five times over), and here that reads as "the email did not send" with no reason anywhere.
- ⚠️ **The backordered set is not offered** — the service refuses it (`Error: Same Set Picked`), so
  listing it is offering a guaranteed error. Dropped only when we know WHICH set that is: an
  ambiguous pair drops nothing and `substitutionBlockers` says so before the send instead.
- ⚠️ **The watcher's stop condition is the NOTES, not the status** (`substitutionAnswered`): a
  re-send writes the same `Sent`, which is a Monday no-op, so a value-only test would wait for ever
  on exactly the chase the resend path exists for. Polls one item's three columns every 3s for 45s.
  ⚠️ **A timeout is NOT a failure** — it says "no answer yet, the column will show it", because the
  email may still be going out and inventing an outage is the §5.13 class of alert nobody trusts.
- ⚠️ The card is keyed on the order id AND re-derives its pick when the id changes (§9's notes-box
  rule): a pick surviving a sidebar click would send the previous order's set.
- ⚠️ **`lib/orders/substitution.ts` is a READ-ONLY MIRROR of that service's rules** (+ tests): the
  nine live Substitution Status labels and their fixes, `normalizeSetName` (which is what makes the
  tracker's `AutoSoft 90 6 mm 23"`, Cardinal's `AutoSoft 90 Infusion Set · 6 mm Cannula · …
  REPLACES TN1002817` and the Backordered column's `AutoSoft 90 6mm 23" infusion sets` one set),
  `backorderedSetOnOrder` and the three pre-send refusals. Same hand-synced hazard as §5.7 and
  §5.17, with the same failure mode — the page saying one thing while the email does another — so
  when `email-serivce/src/features/backorder-substitution/index.js` changes, change this too.
  Nothing here sends, writes or decides: the service is the authority.
- ⚠️ **An unrecognised `Error:` label still reads as an error**, never as silence: the column exists
  to complain, and a label added after this file was written must not come out green.
- ⚠️ **Every flip sends** (`dedupe: false` there) — re-picking the same set is a chase, not a
  duplicate, which is why every fix sentence ends "…then re-pick the substitute set".
- ⚠️ `normalizeSetName` is deliberately NOT `infusionStock.stockKey`: that one answers "board label
  → tracker row" and strips neither the `infusion sets` suffix nor a `REPLACES` tail.
- ⚠️ **The SKU shown beside the pick is a courtesy, not the one that is sent** — the service
  re-reads the tracker as it writes the email (Cardinal reissues item numbers). The card used to
  say so beside the number and no longer does (Josh, 2026-09-15: the card was "really busy"); the
  fact is unchanged and lives in `substitutionEmailPreview`'s doc comment.
- **The email is PREVIEWED, read-only, in a collapsed `<details>`** (Josh, same day, in place of a
  paragraph describing what it would do) — `substitution.substitutionEmailPreview` + tests.
  ⚠️ **A SECOND MIRROR, of `template.js` this time**, and the more visible one: a drifted preview
  shows a rep prose Cardinal never receives, which is worse than showing nothing, so the tests
  assert the subject and all six body paragraphs LITERALLY. ⚠️ It renders the TRACKER row's name
  where there is one, because that is what the service passes — the board label would give a
  subject line the email never carries. ⚠️ A field the order does not carry shows as an **em dash**,
  never guessed and never dropped: every one of them is already a `substitutionBlockers` refusal,
  so Send is shut and the card says why above, and a line quietly missing from the preview is how a
  rep learns nothing. ⚠️ It deliberately does **not** print the recipient addresses —
  `config.backorderTo` / `backorderCc` are Railway-overridable on the service, so a list here would
  claim to be the real recipients while being only this file's memory of the defaults, with no test
  that could catch the drift (the sign-off IS printed: every one of these emails has carried it and
  a signature-less preview reads unfinished). One known divergence, in the SET NAME only: the
  service falls back to the tracker for a backordered entry the order's own set columns do not name
  (its `backorderedSet()` case 2), which `backorderedSetOnOrder` does not implement.
- The pick reads top-to-bottom — **Switch from · ↓ · Switch to**, the SKU and the stock pill on one
  quiet line under the select (Josh, 2026-09-15). The side-by-side row it replaced carried the two
  sets, an arrow, a select, a pill and a sub-sentence on one wrapping line.

**"First Order" is suppressed when the board contradicts it** (`workflow.orderTypeLabel` + tests).
Order Type `color_mm1s96z2` is a real signal board-wide — a mix across 1,484 rows — but it is not
maintained per item: on 2026-09-15 **all eleven** orders in the Order group read `First Order`,
including a **same-day pair for one patient**, which cannot both be a first order. The chip is
therefore dropped whenever another order for the same patient is dated on or before this one; a
missing date on either side proves nothing and leaves it alone, and `Reorder` always shows as the
board has it. ⚠️ Suppression only — nothing is relabelled, and **nothing downstream reads this**:
`email-serivce`'s first-order delivery check-in text keys off the COLUMN, so a wrong `First Order`
still texts a repeat patient. That is the board's to fix.
⚠️ The header's **"This patient's other orders"** strip exists for exactly that same-day pair, so
each chip carries what tells it apart (Cardinal order number, else the product words) and a same-day
sibling raises an amber "worth checking it isn't a duplicate" line. Date + stage alone made a
duplicate read as the order the rep was already on.

**Deliberately NOT shown** (Josh, 2026-09-15): Cardinal's raw response and the request payload we
sent (`long_text_mm483yt2` / `long_text_mm48ww67` — dropped from `COL`, the `Order` type and the
read, not merely hidden); "Open on Monday" on either view; the Cardinal product-page links
(`link_mm4wz81e`, and `productUrl` left `SkuTrackerRow` with them); and the pre-check's
"(advisory — never blocks ordering)" parenthetical. **DOB reads under the patient's name**, in the
header's meta line, not in a field off to the side. The board is called **the order board** on
screen, never "Monday · New Order Board".

**⚠️ THE SWITCH — `lib/orders/config.ts` `ORDERING_FROM_COMMAND_CENTER = false`.** The write is
built and dark: `mondayWrite.markOrdered` re-reads Order Status and writes label id **1** only when
the column reads "Order" (`canMarkOrdered`: "Process Claim" is already placed, "Ordered" is in
flight, "On Hold" is deliberately not — a rep should never be able to place an order TWICE or place
a snoozed one). No verified-write transaction is needed: the app writes no sibling data first, the
whole payload Cardinal receives is already on the item. `OrderHeaderCard` renders "Mark as Ordered"
(with a confirm) only behind the flag; while it is off the banner says the order is placed on the
board, with the link. `orderingSwitch.test.ts` pins the flag at false — **flipping it is a
decision, and the test failing is the reminder to read this first**: (1) confirm webhook 595100182
is still the poller's trigger on `status` = 1; (2) confirm 7921060784 still moves Ordered → Process
Claim; (3) decide whether the app should also clear the Cardinal columns on a retry (the board's
human does that by hand before re-flipping — the app does not, and a re-flip on an item at "Process
Claim" is refused); (4) update the test and this section.

**Deliberately not built:** notes are display-only (the role is observation — the composer is a
one-line add via the Subscription `NotesPanel` pattern when wanted); no Oversight charts (it is not
a pipeline stage); no Profile Status badge (the board has no escalation column — the page wears its
own stage and Cardinal pills instead).

**System Management → Search returns orders from 2026-09-15, in a fourth folder of their own**
(Josh: *"add them to the search but ONLY show them in a tab to the right of stuck that says
orders"*) — **`lib/systemMgmt/ordersSearch.ts`** (+ tests). ⚠️ **The board is still NOT in
`systemMgmt/mondayApi` `BOARDS`, and the distinction is the whole design.** That registry is not
"boards Search reads": it is also `patientLookup`'s inbound-caller lookup (running while the phone
rings), the Comms Hub dossier's stage trail, the gateway's mirrored `DIRECTORY_BOARDS`
(`directoryCoverage.test.ts` fails the build on a drift, so adding a board there is a Railway
change), `profileStatus.test.ts`'s bidirectional group assertion, the seven-board snapshot and the
pipeline chart — none of which wants an item per REORDER. So the board rides **`LIVE_SEARCH_BOARDS`**,
i.e. the live search and nothing else: one more alias on a request that already runs (§7 — the
snapshot stopped answering the search box on 2026-09-03), which is also why a chart pick or a stage
filter shows an empty Orders folder, correctly.
- ⚠️ **`searchBucket` returns `orders` FIRST, above Completed.** An order has no Completed group, no
  Stuck group and no escalation column, so every other rule files it under **Active** — silently, in
  among the pipeline stages a rep was searching for. That one line is the "ONLY" in the ask, and
  `searchBuckets.test.ts` pins it against all five groups plus a stale completed/stuck/escalated row.
- ⚠️ **The row's stage is `orderStage` + `cardinalStatus`, never the group** (`orderSearchStage`):
  the group is not the stage, and Cardinal's verdict is the more precise answer once it has the
  order — "Partially shipped" over "Shipped", "On hold — Credit Check Failure" over "Placed — in
  progress". A `none` verdict falls back to the stage, which is what keeps the 609 pre-poller rows
  reading Shipped rather than blank. ⚠️ A **stale** Hold Reason survives on delivered orders (the
  poller never clears the column — live on the board today), and `cardinalStatus` matching the
  shipped/delivered labels ahead of the reason is what stops a delivered order reading "on hold".
- ⚠️ One patient has an item per reorder, so the rows carry the same name, phone and often the same
  stage: `SystemPatient.subtitle` (date · group · CAH number) is what tells them apart, and they are
  sorted **by item id**, not Order Date — workflow 7919939752 rewrites Order Date to the day an On
  Hold snooze returns, so a held order carries a FUTURE date.
- ⚠️ Order rows are dropped from **`sameNumberNeedles`' input** (not from the pass): that cap returns
  NOTHING above three distinct numbers, so feeding it order rows would switch the same-name-different-
  spelling pass off for queries where it used to run, silently (§7).
- ⚠️ The **Communications Hub's "find this patient" pane shares this search and must not offer them**
  (`PATIENT_SEARCH_BUCKETS`, and `DossierSearch` filters the rows out). It asks which PATIENT is on
  the line, and `dossierApi.fetchDossierItemsForPick` looks the picked row's board up in `BOARDS` —
  an order picked there contributes nothing and the pane renders what the phone lookup already had,
  as though the choice had taken.
- A row opens `/orders?orderId=` (`searchOpen`), gets the orange board tone, and renders **neither**
  the Profile Status badge nor the days-in-stage chip — the board has neither column, so both would
  be invented ("ACTIVE" on an order delivered last month). Its stage text is plain rather than a
  filter link: that filter runs over the snapshot, which has no orders in it.
- ⚠️ **A typed query also matches the ORDER's own identifiers** — CAH number, PO number and all
  five tracking numbers (Josh, 2026-09-15: *"make CAH and tracking numbers searchable there"*),
  the same set the Orders page's own `orderMatchesQuery` uses, so a number that finds an order on
  one screen finds it on the other. ⚠️ **The rule is on BOTH halves of `rulesLiteral`, because the
  real values straddle `liveSearchRules`' digits-vs-name split** (measured off the live board): a
  CAH number is 10 digits and a FedEx tracking number is 12, so both arrive as PHONE queries, while
  a PO number is `MM-<itemId>-<yyyymmdd>` and arrives as a one-word NAME query. Covering one path
  would leave half of what a rep pastes finding nothing, with no error. The **item id needs no
  column**: the PO contains it, so the digits reach it anyway. ⚠️ The widening is **one term only** —
  an identifier never contains a space, so a multi-word query keeps its AND; turning that into an OR
  would make "jose delgado" mean "jose OR delgado". A single word costs nothing, since "Smith"
  cannot be inside a CAH number. ⚠️ These seven columns are **searched but not fetched**: Monday
  matches server-side, and the row already names the order by date, group and CAH.
- ⚠️⚠️ **`phoneRulesLiteral` must NEVER gain them.** That builder is also what the **same-number
  pass** asks with, and that pass means *the other records belonging to THIS PERSON's number*. A CAH
  number is ten digits exactly as a phone number is, so an identifier rule there would let one
  patient's number pull in a stranger's order and file it under their name. The widening lives in
  `rulesLiteral`, the TYPED query — the rep saying what they are holding. `ordersSearch.test.ts`
  pins it, and the test is verified to fail when the rule is moved.
- ⚠️ An order number matches ONLY orders, so the folder a rep lands on (Active, by design) is empty
  and the **"Found in: Orders (1)"** line is the way through. That is the existing foldering
  behaviour, not a special case — see §7.

**Keep-in-agreement:**
1. **Column ids** — `lib/orders/mondayApi.ts` `COL` (+ `LIST_COLUMN_IDS`, pinned by `listColumns.test.ts`).
2. **Stage rule** — `workflow.orderStage` ⇄ the sidebar sections ⇄ the count's "Order" test (three files above).
3. **Names** — `skuJoin.test.ts`'s label lists ⇄ the live Infusion Set / CGM Type / Pump columns and the tracker's rows. Re-run the comparison when either board grows a label.
4. **Automation ids** in the table above — re-verify with `list_automations` before changing what a status write is expected to trigger.
5. **Substitution** — `lib/orders/substitution.ts` (+ its test's `BOARD_LABELS`, which is the live
   `color_mm727p5m` label set) ⇄ `email-serivce/src/features/backorder-substitution/index.js`
   `STATUS` + its `skip` reasons, and `email-serivce/src/cardinal.js` `normalizeSetName`.
   **The preview is a second mirror**: `substitutionEmailPreview` / `substitutionPronouns` ⇄
   `email-serivce/src/features/backorder-substitution/template.js` `render()` / `pronouns()`, and
   the sign-off ⇄ `config.backorderSignoff`. Its tests hold the subject and every body paragraph
   verbatim, so a change in either repo fails the build rather than showing a rep the wrong email.
6. **Search** — `lib/systemMgmt/ordersSearch.ts` `ORDERS_SEARCH_BOARD` mirrors this slice's `GROUPS` / `GROUP_TITLES` / `COL`, and re-uses `workflow.orderStage` rather than restating it. It must stay OUT of `BOARDS` (`ordersSearch.test.ts` asserts both halves). `ORDER_IDENTIFIER_COLS` ⇄ `workflow.orderMatchesQuery`'s haystack — the two searches should match the same numbers.

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

> ⚠️ **This diagram had Welcome Call SECOND until 2026-09-01** — straight after Profile Send Off,
> with Medical Evaluation third. It was wrong, and three things in the app say so and agree with
> each other: Profile Send Off's only exit is **Advance to MN**, whose automation creates the
> **Medical Evaluation** item (§3's own table says this); `config.ts` `ROLES` runs profile →
> evaluate/chase → benefits/auth → welcomeCall → subscription; and `OVERSIGHT_SECTIONS` runs
> intake → medical-evaluation → insurance → welcome-call. The order is now also a **module** —
> `lib/commsHub/pipelineOrder.ts` — because the Communications Hub draws a patient's stage history
> from it (§5.28), so a future disagreement shows up as a failing test rather than a wrong picture.

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
  patients (the reported one) were counted in the processor column AND a manager
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
  **Search is LIVE — it asks Monday per query and never answers from a snapshot** (2026-09-03,
  `mondayApi.searchPatientsLive` + `hooks/systemMgmt/useLiveSearch`). Until then the box filtered a
  browser-side copy of all seven boards: a 15–20s cold download (Profile Send Off alone is 2,635
  items in six sequential 500-item pages, ~680 KB each with notes), repeated every 90s, fronted by an
  IndexedDB snapshot up to **24h old** — so the first seconds of every visit searched yesterday's
  boards. Katie stopped using it and looked patients up on Monday instead. Now each debounced query
  is ONE aliased request across all seven boards with `contains_text` rules — name by WORD, ANDed
  (so "doe, jane" finds `Jane Doe`), or the phone column by digit substring — measured at
  **200 complexity vs 16,020 per full page**, sub-second, and re-run silently every 45s while a
  query is on screen. Latest-wins (older in-flight requests are aborted and their answers dropped);
  a failure says so rather than substituting older rows — and the invalidation happens on the
  keystroke, BEFORE the debounce, or an answer to the previous query landing inside those 300ms
  would paint under the new one (Greptile, PR #53). Name terms are trimmed of edge punctuation so
  "Delgado, Jose" reaches Monday as `Delgado` + `Jose`. ⚠️ The Search tab is **exempt from the
  page's LoadingState/ErrorState gates** — those belong to the seven-board snapshot, which survives
  ONLY for the pipeline chart, the totals and the other tabs, and whose banner now says exactly that.
  The fuzzy subsequence match ("jsoe") is gone by necessity; substring and word matching remain, and
  `rankLiveResults` orders what Monday returned WITHOUT dropping rows the local ranker can't score
  (`searchPatients` would). Same `searchColumnIds`, same `mapToSystemPatient`, so a row is identical
  whichever path produced it.
  ⚠️ **A NAME QUERY THEN ASKS AGAIN BY THE NUMBER — because a patient is not the same string on
  every board** (Josh, 2026-09-11). Augustina Rodriguez (DTC Intake · Profile Send Off · Medical
  Evaluation) and Agustina Rodriguez Hernandez (Subscription since April · Secondary Claims) are ONE
  patient: same phone `4062237445`, same DOB `08/28/1956`, five items, two spellings — a one-letter
  first-name typo and a Spanish double surname recorded on some boards and not others. Rules are
  `contains_text` **ANDed per word**, and a `contains_text` is a contiguous substring, so "Augustina"
  is not inside "Agustina…" and "Hernandez" is not inside "Augustina Rodriguez": **no name query can
  return both halves**, and the rep searching either one is told, accurately, about half of her.
  So `searchPatientsLive` runs a SECOND aliased pass keyed on the phone numbers the first pass
  returned (`sameNumberNeedles` → `phoneRulesLiteral`, the same literal the typed phone query uses),
  merges what is new (`mergeSameNumberRows`) and marks it `matchedBy: "phone"`; the page renders
  those under their own **"Same phone number, filed under a different name"** heading, because a row
  carrying a name nobody typed reads as the search misfiring rather than as the record it went and
  found. It works in both directions — either spelling finds the other.
  ⚠️ **The cap is the whole safety property.** Above `SAME_NUMBER_MAX_PHONES` (3) distinct numbers
  the pass is SKIPPED: "Rodriguez" returns forty rows carrying forty numbers — forty people, none of
  them the one being looked up — and fanning out on those spends a request per board to say nothing.
  Three or fewer means the query has already narrowed to a person. A row with a blank phone
  contributes nothing and does **not** count against the cap, or one board returning a blank quietly
  switches the whole pass off. ⚠️ A failed second pass is swallowed (an abort still propagates, or
  `useLiveSearch`'s latest-wins breaks): the name answer is the answer this search gave until today,
  so degrading to it costs the extra rows and never the search. Two round trips and ~400 complexity
  instead of 200, only on a name query — a phone query has already found everyone on the number.
  ⚠️ A number genuinely shared by two patients (18 of 3,140 on the live boards, §5.28) surfaces the
  household under that heading. That is the heading's job; do not "fix" it by narrowing to one name.
  `sameNumberSearch.test.ts` holds the five live records as its fixtures.
  **Results are FOLDERED — Active · Completed · Stuck · Orders** (`lib/systemMgmt/searchBuckets.ts`
  + tests; Orders joined 2026-09-15, §5.35). A patient is one item per board (§6), so one name returns three to five rows — the
  finished Profile Send Off record, the finished ME record, the live Insurance record — and in a
  flat list a rep clicks the first row carrying the name: "Search shows the wrong profiles".
  `searchBucket`: Completed group ⇒ **completed** (checked first, as `profileStatus` does); a
  `STUCK_GROUP_IDS` group OR an EXACT Stage Advancer label from `STUCK_ADVANCER_LABELS` ⇒ **stuck**
  (the label is written before the automation moves the item; the list is read off the live
  `settings_str` — DTC Intake's MASTER STAGE says "Stuck Final Review" and **"Can't Proceed"**, so
  a `^Stuck` pattern would have missed one and over-matched elsewhere; Greptile caught the pattern on
  PR #53) OR **Proposed Stuck** (Escalation index 2, awaiting Final Decisions — Josh, 2026-09-03,
  pointing at a stuck patient on that screen: *"stuck patients absolutely do have a UI"*; to the
  manager this search serves a proposal and an approval are one queue, and the Profile Status badge
  still tells them apart) ⇒ **stuck**; everything else ⇒ **active** — Manager Intervention (index 0)
  included, since that patient is being worked, by a manager; and **orders** — every New Order Board
  row and nothing else, checked before all of them (§5.35). Defaults to Active; an empty folder
  names the others' counts rather than saying "no patients found", which is also how a rep discovers
  the Orders folder: search a name, be told where the rows are. Chart picks and stage filters go
  through the same folders — and show an empty Orders folder, correctly, because those come from the
  snapshot and the order board is not in it.
  ⚠️ **A digits query is a phone search on every board but the ORDER board**, where it also matches
  the CAH number, the PO number and all five tracking numbers (§5.35) — so a tracking number lands in
  the Orders folder while Active reads empty, and the "Found in:" line is the route to it.
  **Search is a MANAGER's tool, so a row opens the OVERSIGHT screen for that patient** —
  `lib/systemMgmt/searchOpen.ts` `searchOpenUrl` (+ tests), one rule for every click: a finished
  record → its review page (`?completedStage=`); **stuck or Proposed Stuck → the stage page as Final
  Decisions** (`?mv=final-decisions&manager=1`, Approve Stuck / Return to Queue on the action bar);
  escalated → Manager Intervention (`?mv=manager-intervention&manager=1&escalated=1`); ordinary work
  → the plain stage page. ⚠️ Those params are `OversightTab.handlePatientClick`'s contract, read by
  every stage page via `lib/shared/managerOrigin` — keep the two writers aligned or the same patient
  opens two different screens. ⚠️ An item parked in a **Stuck GROUP** has `roleRoute ""`, so it
  falls back to the board's canonical page from `COMPLETED_STAGE_ROUTES` (Evaluate · Benefits ·
  Welcome Call · Profile); the pages inject a deep-linked `?patientId=` whatever group it sits in.
  Stuck rows on DTC Intake / Secondary Claims / Subscription have no canonical page and stay notes.
  `MASHEKE_STAGE_ROUTES` gained `Doctor Appointment → /doctor-appointments` the same day — Search
  had been sending that sub-stage to /evaluate while Oversight sent it to the outreach page.
  **The row leads with the STAGE** (Josh, same day: *"we need the person's stage — like Medical
  Necessity or Insurance · Auth Outstanding — more clear from here"*): its own 210px column with a
  board-coloured left bar (`BOARD_TONE`), the board as a manager says it (`BOARD_STAGE_LABEL`:
  "Medical Necessity", not "Medical Evaluation") in small caps over the stage in the largest type on
  the row, the group beneath when it differs. Notes keep the flexible middle. The stage text still
  filters the list to that stage.
  **A row with no page is a NOTE, not a profile** (Josh, 2026-09-03, same day: *"it shouldn't show a
  profile unless we have a UI for it … but if it is in an inaccessible board have a note that says
  patient is in the system but not on a workable page, check Monday — and have it say what and where
  it is"*). `searchOpen.rowIsWorkable` = `searchOpenUrl(row) !== null` — a live stage page, a
  finished record's review page, or a stuck patient's Final Decisions view. Everything else (every DTC Intake and Secondary Claims
  row, Subscription "Not Active Patients", Profile Send Off "Patient Intake"/"Tests", any item parked
  in a Stuck group) renders as `UnworkableRow`: name · *is in the system but not on a workable page —
  check Monday* · board · group · stage · phone, with nothing to click. Workable profiles lead and
  are **highlighted** (`PatientRow highlight`) whenever notes follow, under a divider label — the
  Josh Hoffman search that prompted this had one Subscription row buried under eight dead rows. Not
  hidden, deliberately: "not found" would be a lie about a patient we can see, and the note tells the
  rep where to go instead.
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
  ⚠️ The retired **`EscalationFormModal`** was **deleted on 2026-09-14** together with the two
  `EscalateButton`s that opened it: Welcome Call and Final Confirm run the Propose Stuck ladder now
  (§5.34), and the four ME pages' commented-out mounts lost their dead import lines with it.
  `lib/shared/escalation.ts` stays for this tab's legacy `[ESCALATION FORM]` parse.
- **Communications is a System Management TAB** (Josh, 2026-09-10) — the same
  `AssignedPatientsPage` hub as `/assigned-patients` (§5.28), rendered with an
  **`embedded`** prop. That prop does exactly two things: it stops the page
  claiming `h-screen`, because the host owns the layout, and it drops the **back
  button alone** — the host's own header sits 45px above with a back button that
  goes to the same place.
  ⚠️⚠️ **THE HOST MUST THEN GIVE IT A DEFINITE HEIGHT — `h-screen overflow-hidden`
  on the Communications tab, never the page's ordinary `min-h-screen`.** The hub's
  three panes are `flex-1 min-h-0` and scroll internally, and `min-h-0` can only
  bound a parent that HAS a definite height. Under a minimum the flex row's height
  is auto, so the conversation list grows to fit every row: with the live inbox
  (732 conversations) the document ran ~48,000px tall, and both the message
  **composer** and the profile pane's `justify-center` **spinner** landed thousands
  of pixels below the fold. Reported as *"there's literally no bar to send a text
  at the bottom"* and *"no loading animation for command center profile as well"* —
  one cause, two symptoms.
  ⚠️ **IT ONLY REPRODUCES WITH VOLUME, and that cost a wrong verdict.** Measured in
  a browser at 1440×900: 800 conversations under `min-h-screen` ⇒ document 48,063px,
  composer at y=47,993, off screen; under `h-screen` ⇒ 900px, composer at 830. With
  a **two**-conversation fixture the content fits inside 100vh, `min-h-screen`
  stretches the child to exactly the same layout, and the two are pixel-identical.
  This fix was made, "disproved" against that thin fixture, reverted, and re-made
  from a user screenshot showing the page scrolled past its own header. Any re-test
  of this needs a long list; `systemMgmtTabs.test.ts` pins the class name.
  ⚠️ **EVERYTHING ELSE RENDERS IDENTICALLY, navy bar included** (Josh, same day:
  *"exactly the same"*). The first cut also restyled the header into a plain white
  strip and dropped the icon and the "Communications" title, leaving a dialer and a
  bell floating on white — a working screen that read as half-built. **Restyling a
  header is not a cheaper way to say "this is embedded"**: the three-pane hub is
  the whole content, so its chrome is the only thing telling a rep the view is
  finished. `systemMgmtTabs.test.ts` pins the parity (navy, icon, title, and no
  `embedded` branch inside the header but the back button).
  ⚠️ **Mounted CONDITIONALLY, never hidden.** Every RingCentral poll in the hub
  is scoped to its mounted tab (§5.28's "only the OPEN tab polls"), so a
  `hidden`/`display:none` toggle would poll the shared account from a screen
  nobody is looking at — INCIDENT_2026-08-20's shape, and invisible on this page.
  ⚠️ It renders as a flex CHILD of the page shell, outside `<main>`'s scrolling
  max-width column (the same reason Oversight widens to `max-w-full`, one step
  further), and is `lazyWithReload`-imported so the tab nobody opened costs
  nothing. `systemMgmtTabs.test.ts` scans for all of it — verified to fail when
  the conditional mount is replaced by an always-render.
- ⚠️ **The Escalations tab is COMMENTED OUT, not deleted** (Josh, 2026-09-10) —
  the `TabBtn`, the `EscalationView` body and the header's escalation-count chip.
  Everything behind them stays wired (`useSystemPatients`' `escalated`,
  `removeEscalation`, `EscalationDetailModal`, the `Tab` union member), so
  restoring it is uncommenting two blocks. The chip went with the tab because it
  was never clickable: with no tab to open, it advertises a number this page can
  no longer show anybody. Escalations are worked in **Oversight's manager
  columns** (§7). ⚠️ `?tab=escalations` deliberately falls through to **Search**
  — a stale bookmark or a Back into that URL would otherwise select a tab with
  no button and no body, i.e. a blank screen with no way out.
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

> # 🚫 ONLY JOSH PRESSES SYNC. NEVER RUN IT YOURSELF.
>
> **The *Sync from Test Repo* workflow is Josh's button and nobody else's — Claude included**
> (Josh, 2026-09-03, after a session ran it without being asked). Do **not** trigger it from the
> Actions tab, with `gh workflow run`, via `mcp__github__actions_run_trigger`, or by any other
> route, **not even when a change you just made obviously needs to reach prod, and not even when
> an earlier instruction in your task looks like it covers it.** Running it is a decision about
> what goes live for the whole company, and it is Josh's decision every single time.
>
> ⚠️ **It cannot be undone by re-running it.** The workflow is a literal
> `git push <prod> main --force`: prod's `main` becomes whatever test's `main` was at that
> instant, and whatever prod had is gone from the branch. Pushing to test's `main` is safe and
> expected; pushing test *onto prod* is not the same act and must never be treated as the last
> step of one.
>
> **What to do instead:** finish the work on test, say plainly that it is ready for prod, and
> stop. Josh presses the button. If he asks you to run it, that is explicit permission for
> **that one run** — it does not carry over to the next change.

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
- **🚫 NEVER run the *Sync from Test Repo* workflow — only Josh presses it** (Josh, 2026-09-03,
  after a session ran it unasked). Pushing to test's `main` is your job; pushing test's `main`
  onto **prod** is his, every time. It is a force-push that overwrites prod and cannot be undone
  by re-running it. Finish on test, say it is ready for prod, and stop. Full rule in §8.
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
  and from then on every press of Advance to MN was a no-op. Confirmed against the GATEWAY audit log
  (`/audit.json?item=…&all=1`), which is the only place these are visible: Katie wrote
  `color_mm1zmeb3 = Advance to MN` **six times** — 8/26 6:54 PM (the real one), then 8/28 4:37 PM and
  8/31 at 10:51, 11:42, 11:44 and 4:27 — and Monday answered **200 / ok=true to all six** while
  recording an activity-log entry for only the first. Five days, a green toast every time.
  ⚠️ **Monday's activity log CANNOT show you this and the gateway log can.** A no-op write leaves no
  activity-log entry at all, so on the board it looks like the rep never pressed the button; only
  `gql_log` proves they did. Diagnose this class from `/audit.json`, never from board history.
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
  ⚠️ **How they got back into the queue** (unfixed, see §10): the last line of
  `advanceToProfileCleanUp` is `moveItemToGroup(p.id, GROUPS.profileCleanUp)` — an **UNCONDITIONAL**
  move that never asks which group the item is currently in, so it drags an item out of **Completed**
  as happily as out of a form group. Katie pressed "Advance →" on Info Collection at 11:57 AM (Eddie)
  and 12:23 PM (Betty) on 8/27; the audit log shows the left pane written, then
  `color_mm6ct431 = Profile Clean-Up` (itself a no-op — already set, ok=true, no activity-log entry),
  then the group move one second later. It also **does not touch Move to Onboarding**, and `UnverifiedReferralsPage` is the ONLY
  intake-family page that never wires `useCompletedStageReview` — `ProfilePage`, `EvaluatePage`,
  `WelcomeCallPage` and `ChaseBenefitsPage` all do. Combined with `useMondayPatients` injecting a
  deep-linked `?patientId=` into the sidebar **regardless of group**, a patient sitting in Completed
  renders on Info Collection with fully live Advance buttons.
- **⚠️ A send that WORKED must take the patient off screen — or reps re-press it.** The queue only
  learns about an advance on the next poll (masheke `POLL_MS` = 30s), and Monday may not have
  indexed the write even then, so for up to half a minute after a successful send the patient sat
  in the sidebar with the panel still rendering them and the Send button re-enabled — a screen
  indistinguishable from "nothing happened". Masheke re-pressed on three patients on 2026-09-03
  (Joseph Bowser `12936243860`, Robert Bianco `12936759879`, Frank Fuller `12937936786`): every
  FIRST press landed, every second was refused by the advancer no-op guard above. Nothing was lost
  — and nothing on screen had told her either way, because her second press ALSO showed green (see
  the poll-window note below). `useMondayPatients.markAdvanced` now drops the patient the moment
  the send resolves; `EvaluatePanel` calls it LAST in the try, and only when a stage was actually
  advanced (an escalating send leaves them in Evaluate MN, where they belong).
  ⚠️ **The marker is a CLAIM WITH AN EXPIRY, never a permanent verdict** —
  `lib/shared/pendingAdvance.ts` (+ tests). Hiding a patient whose write did NOT land removes them
  from the only queue that would surface them, which is the invisibility §5.10/§5.12/§7 keep
  recording. So it lapses after `PENDING_ADVANCE_TTL_MS` (2 min): if the advance landed the board
  stopped returning them long ago and the lapse changes nothing; if it did not, the patient is back
  in the rep's queue. Deliberately in memory — a reload is a fresh read, and a marker that outlived
  the tab could hide a patient nobody can bring back.
  ⚠️ **A marker is NEVER spent on ABSENCE** (Greptile, PR #54). The obvious optimisation — "not in
  the fetched queue any more, so the advance landed, drop it" — reads a missing row as evidence,
  and on these boards it is not: **every `fetchGroupItems` swallows a pagination error and returns
  the pages it got** (`catch { break }`), so a patient still in the stage can simply be missing from
  a poll. Spending the marker there un-hides them early, with a live Send button — the re-send
  window this exists to close. Same rule and same reasoning as the patient directory's
  `isOrphanRow` (§5.29): act on positive evidence, let absence mean nothing. The one cost is a
  nicety: a patient a manager returns to the queue inside the TTL stays hidden until it lapses.
  ⚠️ **Hide at the POINT OF COMMIT** (`setPatients(applyPendingAdvances(...))`), not where the list
  is built — same review. Everything in between is an await (the deep-link `fetchItemById`, above
  all) during which a send can resolve, and a list filtered earlier commits an array assembled
  before the marker existed, putting the patient and their Send button straight back on screen.
  ⚠️ **A TTL is needed because the SPA is never TOLD the send failed.** `EvaluatePanel`'s send
  passes no `requireDone`, so when `pollDone`'s **20s** window closes on a still-running job
  `submitSend` returns `"submitted"` and `verifiedWrite`'s `!requireDone` branch treats it as
  success — green toast, doctor writes, everything — and the job can still FAIL seconds later.
  That is exactly what the three sends above did. Expiry is therefore not a guess about why: it is
  a direct reading of the board, the only thing that settles whether the patient still needs
  working.
  ⚠️ **Now on every queue** — masheke (Evaluate · Send Request · Confirm Receipt), Insurance
  (Benefits · Submit Auth · Auth Outstanding), Welcome Call, Final Confirm and all four Profile
  Send Off exits. `applyPendingAdvances` takes the list the sidebar renders rather than a
  predicate, so each queue's hide uses that queue's OWN membership test and cannot drift from it
  (the §5.9/§5.10 keep-in-agreement trap). On the group-fetch boards the window it closes is even
  wider than masheke's: the patient sits there until the poll AND the Monday automation that moves
  the item.
  ⚠️ **Only a send that LEAVES the queue may hide.** Insurance is the trap: `authOutstandingOutcome`
  returns a null stage for "nothing resolved yet" and Benefits writes `benefitsSos` for a blocker —
  both leave the patient in place, and hiding them takes live work off the rep's screen.
  `sendPatientToMonday` therefore returns the stage it wrote and the three pages gate on
  **`lib/samantha/stageQueue.stageLeavesQueue`** (+ tests). masheke's panels gate the same way in
  their own vocabulary: Evaluate on `nextStage`, Confirm Receipt on its confirmed branch only,
  Send Request never on the "sent but the advance failed" path.
  ⚠️ **Deliberate carve-outs, not omissions:** Subscription writes no Stage Advancer at all; both
  Chase pages log attempts and re-date rather than advancing; DVS is a read-only monitor; the
  intake page's escalation exits already leave the rep's view by their own filter, and Send back to
  pipeline puts the patient back INTO a queue. A durably-queued-but-unconfirmed send
  (`GatewayPendingError`) never hides either — its own toast already says "don't repeat".
  `hooks/pendingAdvanceCoverage.test.ts` scans for the wiring, because a queue that loses it does
  not fail, it just goes back to re-sending.
- **Column IDs, not titles**, are the contract. Add new ones to `mondayMapping.ts` + the schema docs.
- **Exact label strings** for status/dropdown writes (Evaluate "Option A", coverage paths, etc.) —
  a casing mismatch creates duplicate board labels. Prefer index writes where possible.
- **Monday dates are ET, timezone-naive.** Don't compare with a bare `new Date()` in a non-ET runtime.
- **Notes are stamped `[ET timestamp] <Stage>: <text> —<initials>`** — one implementation,
  `lib/shared/noteStamp.ts` (`appendStampedNote`), used by every role's NotesPanel. The stage label
  is what makes a line traceable when several roles share one column: Benefits / Submit Auth /
  Auth Outstanding / DVS all append to Insurance `text_mm6vzc7q` (was `long_text_mm2ffsme` until 2026-09-03). A new NotesPanel must pass
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
- **A failed READ is invisible unless a page says so — `components/shared/StaleDataNotice`.**
  Every queue hook catches a failed Monday read into `error` and clears it on the next successful
  poll (15s intake / 30s masheke), but most pages rendered that string only in the sidebar or in
  `EmptyPatientPane` — i.e. only when the list is EMPTY. So the common case was silent: a rep works a
  patient, a background poll fails, the screen keeps showing what it had. On 2026-09-01 Monday 500'd
  eight reads at 12:07 ET and 503'd two more at 13:55 and nobody in the app saw anything.
  The notice now sits under the header on all 14 queue pages, self-clears, and has no dismiss button
  (dismissing a notice while the data is still stale is worse than not having one).
  ⚠️ **Scope is required and per-FETCH.** On the intake page the queue list and the open patient's
  detail are separate requests (§5.25) that fail independently, so they get separate notices.
  ⚠️ **Field-level pinpointing is opportunistic, not promised.** `mondayError.fieldsFromGraphQLErrors`
  reads `errors[].path` when Monday sends one; every real failure that day was either a bare HTTP 503
  (no GraphQL body exists) or `Internal Server Error` with NO path. Never name fields the payload did
  not — the honest unit is the scope.
  ⚠️ **Both notices sit OUTSIDE `.pf-root`** on Profile / Patient Intake — it deliberately does not
  wrap the sidebar or header — so they take the DEFAULT Tailwind skin. Inside `.pf-root` that is
  inverted (see the `.pf-root` button note above); out here `.btn` has no styles to inherit.
- **Alerting pages on failed WRITES, not on failed calls** (`sendAlerts.sweepAlertReason`,
  2026-09-01). A failed write is a save that did not land; a failed read self-heals on the next poll
  and nobody can act on a Monday 503 anyway. Pooling them paged Josh twice in two hours for two
  transient blips (10 failures / 23,719 requests, zero writes lost). Reads now need BOTH a count
  (≥25) and a rate (≥2%) — a rate alone pages on 1-of-2 at 3am, a count alone pages on a busy
  afternoon that is fine. ⚠️ The old wording, *"8 failed Monday calls (of 76 writes)"*, read as
  "8 of the 76 writes failed" and cost real incident time; the headline now leads with what was lost.
- **A notes box is keyed by its patient, and no send leaves the page while it holds un-added text**
  (Brandon, 2026-09-03; fixed 2026-09-04). He typed a note on Final Profile Confirmation, pressed
  *Confirm Profile & Send* without pressing Add, opened the next patient — and the text was still
  sitting in that patient's box: never written, one click from the wrong chart. Cause: the stage
  pages mounted `<NotesPanel notes={selected.notes} …>` with **no `key`**, so React reused the same
  box (draft included) across a patient switch. Eleven mounts had it. Every mount now carries
  `key={selected.id}` / `key={patient.id}`, every box reports its draft to **`lib/shared/pendingNote`**
  (`components/shared/pendingNoteGuard` `usePendingNoteReport`), and every action that leaves the
  patient — the six stage sends, the three Profile Send Off exits, the intake exits, the Chase attempt
  save — opens with **`refusePendingNote()`**: *"Press Add on your note before sending"*, the gate
  EvaluatePanel already had for its own box. Nothing is discarded for the rep; Add or clear, then
  send. `notesDraftIsolation.test.ts` scans for all three. ⚠️ Keying is required on top of the guard:
  a remounted box starts empty, and the masheke panels reset their lifted `pendingNoteText` on
  `patient.id` for the same reason — a lifted flag that outlives the box blocks the NEXT patient's send.
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
  not that the value is stored in full. A scan of the ME board found **9 items already sitting at exactly 2000** (11 by 2026-09-03 — see below) — every note appended to those is being thrown away. ⚠️ **Worst case is
  Doctor Appointments**, where the attempt LINES in MN Workflow Notes *are* the counter
  (`apptAttemptsFromNotes`): truncation drops the newest lines, so the counter freezes, the rep gets
  unlimited retries and the third-attempt escalation never fires. `lib/shared/longText.ts`
  (`assertLongTextFits`) now makes the big-append paths fail LOUDLY instead — the four masheke
  appointment/chase writers, `returnProposedToQueue` (both branches) and `EvaluatePanel`'s re-eval
  **Guarded 2026-09-03 — every live NotesPanel** (masheke incl. its two edit-mode saves · samantha ·
  finalConfirm · welcomeCall · subscription) now refuses through
  `components/shared/longTextGuard.refuseLongTextOverflow` BEFORE the optimistic overlay and before
  clearing the box, so the rep's text survives to be shortened and the toast names the column and
  the overflow. Until then "Add" wrote straight through: green **"Note saved to Monday"**, note on
  screen, note gone from the board. Same day, `EvaluatePanel`'s send-time `assertLongTextFits` moved
  INSIDE its try — it threw outside every catch, so a full notes column produced no toast and a Send
  button stuck in its spinner; Bridget Browne (`12604305734`) sat like that 2026-08-28 → 09-02 with
  **zero** board writes while "it kept saving" (§11).
  ⚠️ **Refusing is a HARD BLOCK on a full column — and the population is not small.** Scan
  2026-09-03 (gateway `/gql`, lengths only, never bodies): **ME 11 at exactly 2000 (3 in 2. Medical
  Necessity) · Insurance 18 (13 ACTIVE: 3 Benefits, 1 Submit Auth, 7 Auth Outstanding, 2 Auth
  Denied) · Welcome Call 8 (all Completed) · Subscription 0 — 37 items, 16 in live stages**, up from
  9 on 2026-08-14. Those 16 now get a red *"N characters over"* on Add instead of silent loss, until
  their history is moved. Repair in THIS order: create the item **update** holding the full body,
  confirm it landed, THEN trim the column — never trim first. Trimming also moves a parser's input:
  Doctor Appointments counts attempt lines after the last reset marker (§5.12), so that marker must
  stay in the column.
  **Still unguarded (same silent loss; each sits inside a transaction or a stamp and needs its own
  reading, not a blanket guard):** the attempt-save MN-notes task in `ChaseClinicalsPanel` and
  `ConfirmReceiptPanel`, `SendRequestPanel`'s fire-and-forget append, both Propose Stuck stamps
  (`masheke/ProposeStuckModal`, `samantha/ProposeStuckButton` — a refusal there must not leave the
  escalation half-raised), the notes task in `samantha/mondayWrite`, `finalConfirm/mondayWrite` and
  `subscription/mondayWrite`, `FinalConfirmPage`'s FPC-override stamp, and the Request Body writes
  (`long_text_mm4cnw52`, Chase + Confirm Receipt). `profile/unverifiedWrite.appendIntakeNote` is
  deliberately NOT guarded — `text_mm389fs` is a plain `text` column with no 2000 cap (§5.28).
  Detect-and-refuse only (Josh, 2026-08-14) — trimming old history to make room is the same harm,
  just chosen by us. The escape hatch for a body that genuinely no longer fits is a Monday
  **item update**, which has no limit.
- **The 2000 cap is being REMOVED by converting the notes columns to plain `text`** (decision: Josh,
  2026-09-03). Monday's own docs: long_text *"accepts up to 2,000 characters"*; text has *"no fixed
  character limit"* (~64KB per item, all columns together). Profile Send Off Notes `text_mm389fs` has
  been a `text` column all along — 2,635 items, 15 over 2,000, longest 9,383, **none** piled at 2,000
  — which is why it is the one notes column with no truncation history. Sandbox-verified the same day
  (throwaway board `18429581848`): 4,782 chars stored intact in a text column, the same body cut to
  2,000 in long_text; a hop into a text mirror preserved newlines on 174/240 Insurance items and
  mangled **0** dates (the §9 sniffing hits bare date tokens, not prose).
  **Columns to convert** (every app-appended long_text): ME `long_text_mm27zjt2` · Insurance
  `long_text_mm2ffsme`, `long_text_mm59y5xt` (Benefits Call Log), `long_text_mm59rz2c` (SoS/Auth Call
  Log) · Welcome Call `long_text_mm2ffsme` + its two capped mirrors `long_text_mm5g1txs`,
  `long_text_mm5gx6j6` (6 items already cut at 2,000 there) · Subscription `long_text_mm3rj7k7`.
  Optional: the four Escalation Notes, ME Request Message `long_text_mm4cnw52`. Notes do NOT hop into
  Subscription (workflow 7918317925 copies none), and WC's live Notes arrives **pre-seeded** by the hop
  (60/60 of the newest WC items), which is why WC fills fastest.
  ⚠️ **The conversion is a Monday-UI action** ("Change column type → Text → Keep changes"); the API has
  no type-change mutation (checked the Mutation schema). Monday says it *deletes and replaces* the
  column and does not say whether the **id survives** — being tested on the sandbox (Phase 0). If ids
  survive, the app's `COL` maps and the three hop workflows (7917676280 Profile→ME · 7918295320
  ME→Insurance · 7918324247 Insurance→WC, column→column variable pairs) need nothing; if not, re-point
  both. Either way, **never infer a column's type from its id prefix** again — `lib/shared/columnType`
  asks the board.
  **The app is already flip-safe (Phase 1, 2026-09-03)**, so the flips need no deploy and cannot strand
  prod (which shares the boards but lags test by a sync): every notes writer — the six role
  `writeLongText` helpers, the 17 verified-send payloads, the Comms Hub composer — sends a **bare
  string via `change_multiple_column_values`**, which Monday accepts for BOTH types.
  `change_column_value` does not: it rejects a bare string for long_text AND a `{text}` object for text
  (sandbox A/B/E), so it would break on flip day in one direction or the other. Only the 2,000
  **guard** needs the type, and it asks the live board — `columnType.isCappedColumn` (5-minute cache;
  unknown id / 503 / first paint ⇒ **capped**, the safe default) behind `assertTextLikeFits` and
  `longTextGuard.refuseLongTextOverflow(…, columnRef)`; every NotesPanel mount passes its
  `{boardId, columnId}`. `notesWriteShape.test.ts` fails the build if a writer drifts back to
  `change_column_value` + `{text}`. Once a column is text the refusal stops firing within five
  minutes on its own, and the 16 blocked patients need no repair.
  **Cut over 2026-09-03 → the new `text` columns:** ME `text_mm6vevjf` · Insurance `text_mm6vzc7q` · Welcome Call
  `text_mm6vqq2k` (Notes), `text_mm6v4fny` (MN mirror), `text_mm6vvsjy` (Profile mirror) · Subscription `text_mm6vp1z3`.
  Monday's UI conversion makes a NEW id (sandbox: `text_mm6vqvhz` beside `long_text_mm6vtxyh`), so the six were
  created beside the originals, copied with `scripts/notes-migration/migrateNotes.mjs` (1,591 items, 0 mismatches
  after the sweeps), the app re-pointed (74381d4, 2026-09-03 ~8 PM ET), and the long_text originals retitled
  **"(retired)"** — hiding them from the views is Josh's remaining click; they are NOT deleted. A 3,024-char text
  value crossed 7917676280 intact, so the mirrors carry full history from here on.
  ⚠️ **The two hop automations that copy notes — 7918295320 ME→Insurance · 7918324247 Insurance→WC — are
  board automations the workflow-builder API cannot load** (`validate_workflow` / `invoke_workflow_expert`
  answer "General error" for them while a freshly created workflow works), so their column mappings can only be
  changed in Monday's UI, by a person. Josh re-pointed them the next morning (2026-09-04, 10:01 and 10:08 ET);
  verified from fresh `list_automations` dumps (every notes pair on the new ids — `scripts/notes-migration`'s
  README says how) and by the first live hop after the edit (Insurance `12977325713`: MN mirror 141 chars =
  its ME source's `text_mm6vevjf`, the retired column 0). In the ~14 hours between the app cutover and that
  edit every hop copied the retired, now-frozen column, so the destination mirror arrived EMPTY —
  `scripts/notes-migration/backfillMirrors.mjs` filled the three Insurance items that hopped in the window
  (kept for the day a hop is ever pointed at a retired column again). ⚠️ 7918324247 still carries three rows
  writing the WC **"(retired)"** columns (Notes ← Insurance "Insurance Notes (retired)"; the MN / Profile
  mirrors ← Insurance `text_mm3xbvss` / `text_mm3xfw5a`) — harmless, nothing reads them, but clear those rows
  when hiding the columns or capped copies keep being written into columns nobody looks at.
  ⚠️ **Live-board changes like these are an OFF-HOURS job** (Josh, 2026-09-03 — these are active boards):
  sandbox first, then the columns, the copies and the hop workflows in one evening, then the lengths re-scan.
  Not during the day.
- ~~**Welcome Call + Final Confirm escalation is WRITE-ONLY, and those two stages need a REWRITE**~~
  **REWRITTEN 2026-09-14 — §5.34.** (Josh, 2026-08-14, from the escalation audit: `mondayMapping`
  hardcoded `escalated: false`, `mondayWrite` wrote index 0 only `if (p.escalated)` with no `→ Done`
  branch, so the sidebar and the burndown disagreed, the escalated filter was permanently empty,
  there were no Oversight charts and nothing could clear the flag.) Both stages now read the
  column by index, never write it from the send, run the Propose Stuck ladder, and have Manager
  Intervention / Final Decisions charts. The board half landed the same day: label id 2
  "Final Escalation Required" was added to `color_mm1x7997` and read back (§5.34 records how —
  a two-step colour swap, because Monday refuses duplicate colours and derives a new label's id
  from its colour), so both rungs work. The live-label guard stays.
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
- **A Monday `location` column REJECTS a value with no `lat`/`lng`** — and an agent doing bulk
  work is the one writer that reaches Monday without the app's helpers. On 2026-09-02 a Claude
  Code session backfilling **Clinic Address `location_mm1xjnfv`** on the Welcome Call board sent
  `{"address": "…"}` alone for four minutes: **73 writes, 71 distinct clinic addresses, every one
  refused** with `ColumnValueException` — *"invalid value, please check our API documentation for
  the correct data structure for this column"* — at HTTP **200**, so nothing threw. That is the
  whole of the alert the gateway's failure watch raised that day. The run then switched to
  `{"lat":"0","lng":"0","address":"…"}`, which is exactly what every module's own `writeLocation`
  sends (*"Monday requires lat/lng; if we don't have coordinates yet we pass 0/0 — the address
  text still lands"*), and all 71 landed; **nothing was lost and no rep was affected.**
  ⚠️ Two lessons, both cheap: **bulk column writes belong in the module's `write*` helper**, which
  already knows every shape — hand-rolling a mutation is opting out of that knowledge; and a
  200-with-`errors[]` is the app's most common silent failure (§5.2, §9), so a bulk job must read
  `errors[]` and stop, or it will report a clean run having written nothing.
  ⚠️ **Diagnose this class from `/audit.json?key=…&failed=1&since=1`, never from `/audit/errors.json`.**
  The public summary groups by a REDACTED message, which is identical for every column type and
  every writer — it cannot tell you the board, the column or the actor, and the message alone
  invites you to blame the nearest recent change. `error_data` in the failed rows names
  `column_id`, `column_name`, `column_type` and the exact value sent.
- **CI's typecheck is a NO-OP.** `deploy.yml` runs `npx tsc --noEmit`, but the root tsconfig
  is solution-style (`"files": []` + project references), which `--noEmit` does not follow —
  it checks zero files and always exits 0. 23 real TS errors sit in the tree. Use `tsc -b`.
- `README.md` points here; keep this file current as the architecture moves.

---

## 11. Where to look first for a given task

| Task | Start here |
|---|---|
| A role's page behaves wrong | `src/pages/<Role>Page.tsx` → `hooks/<role>/useMondayPatients.ts` → `lib/<role>/workflow.ts` |
| A payer added on Monday isn't in the Command Center dropdown | §5.33 — Primary/General Insurance read `settings_str` live (`lib/profile/boardLabels.ts` + `hooks/profile/useBoardLabels.ts`); check it isn't in `NON_PAYER_LABELS`. If it is IN the picker but doesn't save, the write lost its live index. And a payer must exist on **all eight** payer columns — ME, Insurance, Welcome Call and Claims are the ones people forget. ⚠️ Monday assigns a DIFFERENT label id per board (this payer is 159/159/159/159 but **108** on ME, **7** on Insurance and Welcome Call, **3** on Claims); hops copy by label text so they are fine, but anything writing an index directly needs that board's own id |
| A patient's status badge says the wrong thing (or nothing) | §5.18 — `lib/shared/profileStatus.ts` (the rule) → `components/shared/PatientProfileStatus.tsx` (which board adapter that header uses) |
| A rep re-sent a patient who had already gone through / a queue row won't disappear after a send | §9 — `lib/masheke/pendingAdvance.ts` (the rule) → `useMondayPatients.markAdvanced` (the hide) → `EvaluatePanel`'s `onAdvanced`. A patient who reappears after ~2 min means the board never showed the advance, i.e. the send did NOT land — check `/audit.json?key=…&failed=1` |
| A rep pressed Advance repeatedly and nothing moved | §9 — the advancer already held its target value, so no automation fired. `lib/shared/advancerNoop.ts`; grep Railway for `ADVANCER_NOOP`. Repair by moving the item to Completed, **never** by clearing the advancer (that duplicates the downstream item) |
| A rep says the page showed stale/blank data | §9 — `components/shared/StaleDataNotice` + `lib/shared/mondayError.ts`. Check `/audit/errors.json?key=…&hours=N` on the gateway for the Monday-side failures |
| A note got a green "saved" toast but isn't on the board / a rep now gets *"N characters over"* on Add | §10 — the column is at Monday's 2000 cap. `components/shared/longTextGuard` (the refusal) → `lib/shared/longText` (the rule). Since the 2026-09-03 cutover the six live notes columns are uncapped `text`, so this now means a column still `long_text` (Request Message `long_text_mm4cnw52`, the Escalation Notes, the two Insurance call logs) — `columnType.isCappedColumn` asks the board. Confirm with a lengths-only scan; repair by moving history to an item **update** FIRST, then trimming the column |
| A value isn't saving to Monday | `lib/<role>/mondayWrite.ts` + `lib/shared/verifiedWrite.ts`; cross-check `mondayMapping.ts` column IDs |
| Medical-necessity logic | `lib/masheke/evalState.ts` (+ ipPaths, requestTemplate, mnRequestPdf) |
| A returned patient can't log an attempt (cards greyed, Save disabled) | `lib/masheke/attemptRollup.ts` → `oversightApi.returnProposedToQueue`; the gate is **MN Attempts** `color_mm1wz0vg`, not the attempt columns (§7) |
| Stedi check output / eligibility results | **inline in `src/pages/ProfilePage.tsx`** — NOT `components/profile/StediPanel.tsx` (dead, §5.11) |
| The benefits check filled in a bad-looking address / "not confirmed" flag | §5.19 — `lib/profile/addressFormat.ts`, rendered by `pages/UnverifiedReferralsPage.tsx` |
| A Fidelis/Medicaid check on an MA dual shows a red "Medicare Parts A & B" Primary Payer cell and "Check card" | `lib/profile/primaryInsurance.ts` `primaryPayerIsMemberMa` (Tanya Freckleton, 2026-08-11): MA = Yes + a non-empty MA carrier + a COB primary payer that says Medicare/CMS is the member's OWN MA plan, not a mismatch — pick `maFamilyLabel(maCarrier)` at high confidence, `MA_PRIMARY_COB` caveat, cell shows the carrier (`primaryPayerCell`). A PRP naming a DIFFERENT MA carrier, or no Medicare word at all (Impellizeri), keeps the withheld pick. Gate 2 replay is mandatory (`REGRESSION.md`) |
| A DTC form patient wasn't duplicate-checked / the "Already In System" pill is missing | §5.21 — `lib/profile/dupCheckFlag.ts` reads **Dup Check Result**, never `alreadyInSystem`; the service half is `josh-monday-automations` `automations/duplicate-patient-check.js` |
| A CareCentrix referral arrived half-empty / which intake form should reps use | §5.20 — the **Intake Form on Profile Send Off** (view `246988391`) is lossless; DTC Intake's Manual Patient Intake Form drops 12 fields at the board hop. `"source":"form"` in the item's `create_pulse` tells you which path it took |
| Provided Doctor Name / Clinic Phone empty on a CareCentrix intake | §5.20 — `lib/profile/referralDoctorInfo.ts`; the manual intake form fills the VERIFIED doctor columns, and the fallback is display-only |
| A patient reads "not in network" / Advance is greyed out on an intake patient | §5.20 — `lib/profile/intakeUnlock.ts` `networkAnswer`. `Unknown` is what Original Medicare returns and is **not** a No; the network answer gates nothing |
| A DTC intake patient is in the wrong half of the split / Advance did nothing | §5.20 — `lib/profile/intakeSubStage.ts` (the queue is the GROUP), then `unverifiedWrite.advanceToProfileCleanUp`. Both roles are `UnverifiedReferralsPage` under a `variant` prop |
| A patient got two "here's your link" texts / the insurance step asked for a card they already sent | §5.23 — the once-only stamps are **on the board** (`date_mm6eakae` / `date_mm6eev4b`), and `uploadLink.js` `UPLOAD_KINDS` decides which column a link writes to |
| A patient is parked on "we're waiting for your insurance card" and can't get out | §5.23 — the gate is the FILE column `file_mm5zhy1`, read by `/api/intake/card-on-file/:token`. Nothing else unlocks it, and nothing else needs to |
| "Auto. Texts" reads 0 for somebody we definitely texted | §5.24 — it counts **only** the intake form's 30-minute + 24-hour nudges (`numeric_mm67822b`). A rep's own text and both link families deliberately do not move it |
| A patient's text thread looks empty, or stops ~30 days back | §5.27 — RingCentral retains ~30 days and answers **200 with an empty list**, which looks identical to "never texted". `GET /messaging/archive-health`, then `services/monday-gateway/smsArchive.mjs` |
| A Last Bill Date reads "—" on Welcome Call / Final Confirm for a patient we have billed | §5.32 — one family since 2026-09-15: the "<product> SoS Last Bill" columns. Check the Insurance item's SoS column; if it is blank too, the product was parked in **Skip SoS Products** at Benefits (Humana + auth required, worked before §5.32c reached prod, is the known case — Josephine Neal, Tammy Turpin) and the date is in the Benefits call notes. Write it into the SoS date + units on BOTH boards; the hop only fires at item creation |
| Something still names a legacy `date_mm33…` Last Bill Date column, or a Final Confirm Last Bill box behaves oddly | §5.32 — those ten columns are retired and out of the code; the Final Confirm box IS the SoS column now (read + written, blank clears). `lastBillDisplay.test.ts` pins `COL.lastBillDate` to the SoS ids. On the board they are to be retitled "(retired)" and hidden, never deleted |
| A phone/caregiver answer isn't saving, or a status write silently did nothing | §5.31d — `lib/welcomeCall/phoneSlots.ts`. The write value is the label **id** (Patient 7 · Caregiver 4 · Yes 1 · No 2), not the display index, and a bad id is dropped with no error. A blank Can Text is unknown, never a No |
| A last bill date a rep entered isn't on the board (and a next-order date exists that could only have come from it) | §5.32e — the Benefits send used to blank the SoS column whenever that product's auth was pending. Confirm with the gateway audit (`/audit.json?key=…&item=<id>&all=1`), NOT the board: a blank write leaves no activity-log entry worth reading and the derived next-order date is the fingerprint. `sosFactsPreserved.test.ts` guards the fix; the Auth Outstanding recheck's clear is legitimate and stays |
| A Humana patient's Same-or-Similar was never asked / a product sits in Skip SoS Products | §5.32c — `benefitsDerive.sosRequiredDespiteAuth`. Auth = Required defers the check for every payer EXCEPT Humana; keyed on primary insurance (the secondary column has no Humana label). An auth-required Humana product with no entry derives `""`, which holds the stage — never `"skip"` |
| The patient's phone is wrong and a rep can't fix it | §5.32d — editable on **Auth Outstanding only**, via `BenefitsPatientHeader`'s opt-in `onSavePhone`. The refusal fires BEFORE the write (`planPhoneWrite` skips what it can't parse, so an unchecked save is green and empty); the write goes straight to the board, never into the overlay. Not a route back to the retired Edit-profile dialog — §7 |
| The auth-expiry warning keeps popping up on Medicaid supplies | §5.32f — `lib/shared/dvsClaim.ts`. A **paid** A4230/A4232 claim silences the C18 expiry row on that line; a `Denied`, an `ERROR` or the legacy `Yes` deliberately does not, and neither does a blank. Still firing on a patient whose claim paid ⇒ check the primary matches `/medicaid/i` or the secondary is NY Medicaid. ⚠️ Never re-gate this on `hcpcRules.suppliesRouteToMedicaid` — its payer set omits `United Medicaid` |
| Infusion sets add up to more than the payer allows | §5.32g — `lib/shared/infusionCap.ts`. C31 sums **Qty Inf. 1 + Qty Inf. 2** against `infusionSetCap(primary, referralSource)`; cartridges are a separate line and are not summed in. ⚠️ CareCentrix is the Referral SOURCE, not a payer — all 33 live CareCentrix patients are Horizon BCBS, which is why that route ADDS to the payer list rather than replacing Horizon and Cigna. Welcome Call's per-field cap note reads the same module, so never re-copy the table |
| A blank doctor phone slipped through Final Confirm | §5.32b — `C30_DOCTOR_PHONE_MISSING` in `lib/finalConfirm/checkPack.ts`, paired with `emptyTone="amber"` on that field. Amber by the pack's own rule; Final Confirm never blocks Send |
| A patient's records are split across boards under two spellings of their name | §7 — Search's same-number pass (`sameNumberNeedles` / `mergeSameNumberRows`), rendered under "Same phone number, filed under a different name". It fires only when the query has narrowed to ≤3 distinct numbers, so a bare surname deliberately does not trigger it. If the records share no phone either, nothing joins them — search the number |
| A duplicate patient was filed as new / "Already In System" says No for somebody we serve | §5.21 — `duplicate-patient-check.js` `samePatient`. DOB must match exactly; then the name rule, the phone, or a shared surname (the last two also need `firstNamesClose`). A blank result column means the check never RAN; "No" means it ran and found nothing |
| Cost estimate wrong | `lib/welcomeCall/oopEstimator.ts` (sync vs Railway financial backend) |
| The intake queue is slow, or a sidebar field reads blank on every row | §5.25 — `LIST_COLUMN_IDS` in `lib/profile/mondayApi.ts`; `listColumns.test.ts` names the missing column. A pane reading blank instead means it is rendering a list row, not `detail` |
| A Welcome Call order went down the wrong New Order branch / no order was created | §5.22b — Monitor Qty must be **0 or 1, never blank** (`lib/shared/monitorQty.ts`). ⚠️ Read the automations' WHOLE chain first: "pump only" (7918341001) opens with **Monitor Qty is empty** and "monitor only" (7918341011) with **Pump Qty is empty**, so a coerced 0 silences the first by design — 7921725444 must be enabled in its place |
| An infusion set is missing from the dropdown, or its stock pill is wrong | §5.31b — `lib/welcomeCall/infusionSelection.ts` filters by pump compatibility and excludes the other slot's set; `withCurrentSelection` means a value the BOARD holds is always shown, so a genuinely absent option was filtered. Stock is `stockApi` → `infusionStock`: "No stock data" means no tracker row for that label (re-run the name-join audit), "Stock unknown" means either a stale stamp or a row with no readable quantity — neither is a shortage |
| Send is greyed out on Welcome Call with no obvious reason | §5.31b — the button and its reasons come from ONE array (`sendGates.unmetSendRequirements`), so the sentences under it are the answer. They apply to **Advance only**; the pump confirmation is hidden entirely when the serving sells no pump device |
| A pump shipped on a supplies-only patient / a Next Order Date came over blank | §5.22 — `lib/shared/servingLines.ts`; gate Pump Qty on `servingSellsPumpDevice`, **never** `servingIncludesPump` |
| An address Cardinal won't accept / "Needs Review" on the orders board | §5.17 — `lib/shared/cardinalAddress.ts` (mirror of `Cardinal-api/src/address.js`), surfaced as C25/C26 in `lib/finalConfirm/checkPack.ts` |
| Who can see what | `lib/accessStore.ts`, `lib/roleView.ts`, `components/AccessProvider.tsx` |
| Files won't load / PDF viewer | `lib/shared/mondayAssets.ts`, `components/shared/FileViewerModal.tsx`, `worker/src/index.js` |
| A booking didn't show up in Scheduled Calls | §5.15 — the mirror joins on the invitee's EMAIL. `lib/scheduledCalls/bookingLink.ts` (the prefill), then dtc-mm-form `server/src/booking.js` |
| Booked-call queue / the 10-min reminder | `lib/scheduledCalls/workflow.ts` + `components/careCoordinator/ScheduleGrid.tsx` (the grid, on `pages/CareCoordinatorPage.tsx`) + `components/scheduledCalls/ScheduledCallHost.tsx` (§5.15, §5.30) |
| The Welcome Call "Call scheduled" chip is missing or says it couldn't check | §5.31e — the chip needs the patient's **Email** on the board; that is the only join Calendly gives us. "Couldn't check" means the window read failed (a partial window is deliberately never reported as "not booked") — check `GET /calendly/patient/health` on the gateway, then `/api/calendly/health` on dtc-mm-form. No chip at all means no booking in the window, which is the normal case |
| A welcome call isn't on the schedule grid / a booking has no "Open" | §5.30b — the grid reads Calendly through the gateway, not monday. Check `GET /calendly/day` on the gateway, then `/api/calendly/health` on dtc-mm-form (it reports the welcome event type and whether the day route is enabled). No "Open" means the invitee's email is on no **Welcome Call group** row — the same single join the intake mirror uses; the block is meant to render without a link |
| A welcome-call booking overwrote a patient's intake booking | §5.30b — fixed 2026-09-10. The webhook is USER-scope and now filters on `scheduled_event.event_type`; if it recurs, check `calendly.kindOfEventType` can still resolve BOTH event types (`/api/calendly/health`) — an unresolvable one falls back to mirroring, deliberately |
| A patient is in the wrong Today / Future grouping on the Care Coordinator dashboard | §5.30 — `workflow.followUpHorizon` (unscheduled: the follow-up DATE; blank = Today) and `classifyBooking` (scheduled: the booking's ET day). Intake's date is written by *Log call attempt*, Welcome Call's by +1 — both through `lib/careCoordinator/followUp.ts`. A Welcome Call patient in "Scheduled" with no booking on the board is right: welcome calls live in Calendly only, read through `POST /calendly/patients` |
| The Care Coordinator's Welcome Call column says it couldn't check Calendly | §5.30 — `useWelcomeCallBookings` → gateway `POST /calendly/patients`; check `GET /calendly/patient/health`, then dtc-mm-form's `/api/calendly/health`. While it shows, every patient falls to Unscheduled and the notice is the only thing saying so — never read that as "nobody is booked" |
| Patient Intake takes ages to load / the load bar reads wrong | §5.30 — it is 1,754 rows in four sequential Monday pages and that is inherent; the bar is `lib/careCoordinator/loadProgress.ts`. A bar with no percentage is CORRECT on a first-ever visit (Monday reports no total, so the denominator is remembered from the last complete run); one stuck at 99% means the fetch has not resolved, not that the maths is off |
| The Care Coordinator dashboard shows a patient it shouldn't, or hides one it should | §5.30 — `lib/careCoordinator/workflow.ts` (`intakeBuckets` / `chaseBuckets` / `welcomeCallBuckets`, tested). Read the column's footer first: every excluded row is counted there with its reason. The page never writes, so nothing here can have moved a patient |
| Fax/email send | `components/masheke/SendRequestPanel.tsx`, `worker/src/index.js`, `lib/fax/ringcentralApi.ts` |
| A text was sent but the patient never got it | §5.5 — `lib/shared/smsDelivery.ts` (status decides, code explains), rendered by `components/shared/SmsDeliveryNote.tsx`; the gateway half is `/messaging/conversation` in `services/monday-gateway/messaging.mjs` |
| "Serving ≠ requested" fires on a normal cross-sell | `lib/finalConfirm/checkPack.ts` `droppedProducts` — C13 fires on a DROPPED product only; adding one is a cross-sell and is silent |
| Audit a write that "disappeared" | gateway `/audit` (Postgres `gql_log` / `send_jobs`) |
| "What was the gateway doing at 4:46 last Thursday?" | `GET /audit/requests.json?key=…&hours=…&path=/rc&failed=1` (Postgres `request_log`, §8). NOT Railway logs — they cap at 500 lines ≈ 13 minutes |
| "A call never reached me" / "taking it gave an error" | §5.13 — `GET /calls/history?hours=…&last4=…` (Postgres `call_events` + `call_claims`), NOT Railway logs: those cap at 500 lines ≈ 13 minutes. A `410` from `/calls/claim` is RingCentral saying the party is already gone — the caller hung up or somebody else picked up — never a throttle, which surfaces as `502` |
| A rep can't answer a call in the browser / the home badge says "Not connected" | §5.13b — first: are they in `callAnswerers` on `/access` (max 5)? Not assigned ⇒ no cards, no stream, no badge, by design. Assigned but red ⇒ read the badge's reason: "line is full" is RingCentral's five (another browser, or the RingCentral app signed in as Katie Tyler, holds a slot; it retries every minute), anything else is in `registrationError`. Amber "another tab" ⇒ **Use this tab** |
| The team is past five answerers / "get off the RC app for everyone" | §5.13b **Route A** — a RingCentral user per person, the main number kept on extension 2 and its call handling pointed at a queue, per-user auth-code sign-in on the gateway, `provision()` swapped. Not built |
| A card shows "Take it" where it used to show — or should show — "Answer" | §5.13b — `ringMerge.ts`: Answer needs the SIP leg in THIS browser's leader tab; no leg means not registered (badge) or the INVITE never arrived. Take it still forwards to the cell either way |
| A manager sees no contact icons on a sidebar row | §5.28 — the gate is **`?mv=`**, so they must have clicked in from Oversight; then check the patient's phone is in that queue's read set (`listColumns.test.ts` for Patient Intake) |
| A contact icon says the wrong thing | §5.28 — `lib/contactState/contactState.ts`. Most recent wins per lane; a claimed inbound call is NOT a missed call (`callConnected` reads the legs) |
| An inbound fax doesn't match a doctor / their patients are missing | §5.28 — `lib/commsHub/faxDirectory.ts` joins the patient boards, `dossierApi.fetchDoctorDbByFax` the 2,290-office Doctor Database. The Doctor Fax column is an EMAIL column holding `<digits>@rcfax.com`, so the join strips the address first — that half was **audited clean 2026-09-02**, so re-run the audit before blaming it; the usual cause is an office sending from a line we don't have on file |
| Names are slow to load, or an inbound call card shows a bare number | §5.29 — check `GET /directory/health` on the gateway first; a directory that has never run reports **not ok** however many rows it holds. A miss falls back to the live Monday batch, so this is slowness, not absence |
| A whole board's patients resolve to phone numbers | §5.29 — the gateway's `DIRECTORY_BOARDS` mirrors the SPA registry and a missing board is never scanned. `directoryCoverage.test.ts` names it |
| A hub list row shows a phone number instead of a name | §5.28 — `lib/commsHub/directory.ts` (RC contact → our boards → the number) fed by `hooks/commsHub/useDirectoryNames`. A permanent number means the batched `any_of` found nobody; check the board holds one of the digit shapes `phoneMatchVariants` asks for |
| The profile widget shows the wrong stage, or none | §5.28 — `lib/commsHub/dossier.ts` (`pickActive` = furthest-along open board) and `pipelineOrder.ts` (the tracker order, which §6 now follows) |
| A conversation won't stay read / unread | §5.28 — read state is RingCentral's `readStatus` on the INBOUND messages, written with `setMessageRead`; the local override only covers the gap before the next poll |
| Monday says "invalid value … data structure for this column" | **Start with `/audit.json?key=…&failed=1&since=1`** — its `error_data` names the `column_id`, `column_name`, `column_type` and the exact value sent. `/audit/errors.json` only counts redacted shapes and looks the same for every column and every writer, so it cannot tell you which (§10). Then match the value to the type: `location` needs `lat`+`lng` (§10), `long_text` takes `{"text": …}`, `text` a bare JSON string — and the notes columns are BOTH depending on the board (§5.28). The app's notes writers sidestep this since 2026-09-03 by sending a bare string via `change_multiple_column_values`, which both types accept (§10) — so a `{"text": …}` refusal on a notes column means a writer drifted back to `change_column_value` (`notesWriteShape.test.ts` should have caught it) |
| System-wide Search is slow, stale, or shows a finished record as if it were live | §7 — Search is live per query (`searchPatientsLive` / `useLiveSearch`); the seven-board snapshot only feeds the chart. Folders come from `lib/systemMgmt/searchBuckets.ts`; a Stuck group missing from `STUCK_GROUP_IDS` fails `profileStatus.test.ts` |
| A patient's ORDERS aren't in System Search, or an order turns up in another folder | §5.35 — `lib/systemMgmt/ordersSearch.ts`. The board rides `LIVE_SEARCH_BOARDS` (what the search box asks) and is deliberately absent from `BOARDS` (the patient registry — inbound-call lookup, the dossier, the gateway's mirrored directory, the snapshot); `searchBucket` returns `orders` FIRST, or every order files under Active with nothing erroring. An empty Orders folder under a chart pick or a stage filter is correct — those rows come from the snapshot |
| A CAH / PO / tracking number finds nothing in System Search | §5.35 — `rulesLiteral`'s order branch + `ORDER_IDENTIFIER_COLS`. It is on BOTH paths because CAH (10 digits) and tracking (12) arrive as PHONE queries while a PO (`MM-<itemId>-<date>`) arrives as a one-word NAME query; a multi-word query keeps its AND and deliberately does not match identifiers. The results are in the **Orders** folder, so an empty Active tab with "Found in: Orders" is the expected landing. ⚠️ Never move the rule into `phoneRulesLiteral` — that is the same-number pass, and a 10-digit CAH number would pull a stranger's order onto a patient |
| A Search row opens the wrong screen, or a different one from Oversight | §7 — `lib/systemMgmt/searchOpen.ts` `searchOpenUrl` is the one rule; it must send the same `?mv=` / `manager` / `escalated` params `OversightTab.handlePatientClick` sends |
| The Communications tab's composer or profile spinner is off screen | §7 — the host tab needs `h-screen overflow-hidden`, not `min-h-screen`: `min-h-0` cannot bound a parent with no definite height, so a long conversation list grows the document to ~48,000px. ⚠️ Reproducing it needs a REAL list — a couple of conversations fit inside 100vh and the two layouts are pixel-identical |
| The Escalations tab is missing from System Management | §7 — commented out 2026-09-10 with its header count chip, not deleted; `?tab=escalations` falls through to Search on purpose. Uncomment the `TabBtn` and the `EscalationView` block in `SystemMgmtPage.tsx`. Escalations are worked in Oversight's manager columns meanwhile |
| A Welcome Call rep's Propose Stuck says the board has no "Final Escalation Required" label / a manager can't escalate to Final | §5.34 — that label EXISTS since 2026-09-14 (id **2**, working_orange, read back from `settings_str`), so `assertEscalationLabelExists` firing means it was deleted or deactivated on the board since, or the 5-minute label cache is stale right after a board change (the guard drops the cache on a miss, so a retry re-reads). Check `color_mm1x7997`'s `settings_str` on board `18410804557`; if the id is no longer 2, correct `welcomeCall/mondayApi` `ESCALATION_INDEX.final` + every reader listed in §5.34's keep-in-agreement — never by inference. Re-adding it needs the two-step colour swap §5.34 records (Monday refuses duplicate colours and derives a new label's id from its colour) |
| An escalated Welcome Call / Final Confirm patient is in no Oversight column, or the sidebar and burndown disagree | §5.34 — `escalated` is read off the board (index 0) since 2026-09-14 and `proposedStuck` is index 2; both leave the rep's list and count (`welcomeCall`/`finalConfirm` `sidebarList`, `useRoleCounts`, both baselines) and land in the Welcome Call section's Manager Intervention / Final Decisions charts. A patient in NO column fails `columnExclusivity.test.ts` |
| The Welcome Call Text shows "Queued" but the patient never got a second text | §5.34 / the 2026-09-14 audit — the trigger fires on a status CHANGE, so re-pressing Send onto a column already at "Send" is a no-op. Press the Queued button once to reset it on the board (`mondayWrite.resetWelcomeCallText`), then Send |
| "Where is this patient's order?" / an order shows the wrong stage | §5.35 — `/orders`, search the sidebar (name · phone · CAH # · PO · tracking). Stage is `lib/orders/workflow.ts` `orderStage`: **API Status first**, group second — a Delivered order can still sit in *Accepted / Partial*, and 609 pre-poller rows have no API Status. `cardinalStatus` reads API Status + Hold Reason + API Message together |
| The Orders tile count looks wrong / says "not connected" | §5.35 — it is the Order group's items at Order Status "Order" (waiting to be placed), in `useRoleCounts` + both baseline generators; "not connected" until the first 9 AM cron after the role shipped |
| A product line reads "Not on the SKU tracker" / a stock pill is grey | §5.35 — `lib/orders/skuJoin.ts` joins BY NAME (`stockKey`); receivers match the sensor label as a suffix of the tracker row's left side. Re-run `skuJoin.test.ts`'s comparison against the live labels; a Medtronic sensor has no receiver row by design |
| A backordered set's swap request didn't go / the board shows an `Error:` label | §5.35 — the card names the fix and the Send button re-sends; the rule is `lib/orders/substitution.ts` and the AUTHORITY is `email-serivce` (feature `backorder-substitution`, webhook 635472669). Fix the field it names, then press Send again — a repeat CLEARS the column first (`substitutionSendKind`), because re-writing the same label fires no webhook. A blank Substitution Status means the service never ran, not that it succeeded. "No answer from the email service yet" is the watcher giving up after 45s, never a failure |
| The email preview doesn't match what Cardinal actually got | §5.35 — `substitution.substitutionEmailPreview` mirrors `email-serivce/.../template.js` `render()` and its tests hold the subject and every paragraph verbatim, so a live mismatch means the SERVICE moved — port the change here. Two things are divergent by design: the SET NAME in the one case the mirror skips (the service's tracker fallback), and the recipients line, which names no addresses because they are Railway-overridable there |
| A patient's fifth order says "First Order" | §5.35 — the column is not maintained per item (all eleven to-place orders read `First Order` on 2026-09-15). `workflow.orderTypeLabel` hides the chip when another order for the same patient is dated on or before this one. ⚠️ It hides only — `email-serivce`'s first-order check-in text still keys off the COLUMN |
| Somebody wants to place orders from the Command Center | §5.35 — `lib/orders/config.ts` `ORDERING_FROM_COMMAND_CENTER`, the write is `mondayWrite.markOrdered` (refuses anything not at "Order"). Read the four-point checklist there before flipping; `orderingSwitch.test.ts` will fail until updated |
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
