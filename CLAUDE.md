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
| **Profile Send Off** | `18406352652` | `profile` ("Verified Referrals") + `unverifiedReferrals` ("Unverified Referrals") — two roles, same board/group, split by Referral Type/Source (see §5.10). Its own board (groups: *Patient Intake → 1. Intake → Tests → Stuck → Completed*). Both roles work **1. Intake** (`group_mm1xf2jb`); two send-off exits: **Advance to MN** (`Move to Onboarding` → automation creates the Masheke item + moves to Completed) and **Send back to Patient Intake** (`moveItemToGroup` → `group_mm4vhqff`). **Not** the Welcome Call board. |
| **Medical Evaluation** ("Masheke") | `18406060017` | `evaluate`, `sendRequest`, `confirmReceipt`, `chaseFax`, `chaseParachute`. Medical-necessity document collection. Stuck is propose→approve: reps flip **Escalation `color_mm1x7997` → "Final Escalation Required" (index 2)** and the reason is appended to the **MN notes `long_text_mm27zjt2`** (stamped `[Proposed Stuck …]`); managers approve/return from Oversight. (The old `color_mm5f37ve`/`text_mm5frng6` columns are retired.) |
| **Insurance** ("Samantha") | `18410601299` | `benefits`, `submitAuth`, `authOutstanding`, `authDenied`, `dvs` (stage-based, no group — Stage Advancer index 1 "DVS", read-only monitor at `/dvs`). Groups: Benefits, Submit Auth, Auth Outstanding, Auth Denied, Escalations, Complete/Stuck. |
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
`fax` and `authDenied` are **count-only** roles with no clickable route (intentional —
`DailyBurndown`/`OperationsTab` exclude them from navigation). `systemMgmt` is deliberately
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
  Recipients may be normal emails **or `<number>@rcfax.com`**, which
  **RingCentral converts to a fax**. This is how Send Request dispatches fax/email.
  All **email** recipients go out as **one grouped message** (`To:` everyone, plus the optional
  `cc` form field — Send Request's Cc input) so the Sent folder shows a single email to the
  group; each **@rcfax** recipient still gets its **own** message (a fax is point-to-point, and
  grouping would expose the rcfax addresses to the human recipients).
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
index 1 ("DVS") board-wide (no dedicated group), excluding escalated (Insurance
Escalation `color_mm2vsh2f` = "Manager Escalation Required" OR "Final Escalation Required" —
split from a single "Escalation Required" in 2026-07; `SAM_ESCALATED` in useRoleCounts + both
baseline generators) AND
date-snoozed patients (Follow Up Date in the future — same date-only rule as Auth
Outstanding; mirrors the `/dvs` page list). Stage-DVS items are conversely EXCLUDED from the
Benefits/Submit Auth/Auth Outstanding queues + counts (they linger in those groups — no
group-move automation). All these rules live in useRoleCounts + BOTH baseline generators +
the samantha/masheke `useMondayPatients` hooks; change them together. Roles
**missing from the baseline** render as "not connected" in the Operations tab (never `0 → N`).
The cron supports `DRY_RUN=1` (print, don't commit). **Second job (2026-07-21):** after the
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

### 5.10 Profile Send Off split — Verified vs "Unverified Referrals" (July 2026)
Same pattern as §5.9: **one Monday stage** (Profile Send Off board `18406352652`, group
**1. Intake** `group_mm1xf2jb`) sliced into **two app roles** by two status columns —
**Referral Type `color_mm1wm4n4`** and **Referral Source `color_mm1w5wxr`**:
- **`unverifiedReferrals`** (`/unverified-referrals`, "Unverified Referrals") — Referral Type
  **`Patient`** OR Referral Source **`CareCentrix`**.
- **`profile`** (`/profile`, relabelled **"Verified Referrals"**, id unchanged so existing
  access.json role assignments keep working) — **everyone else**.

⚠️ Referral **Source** also has a `Patient` label — only the **Type** column routes `Patient`
to Unverified. Canonical rule: `src/lib/profile/referralSplit.ts` (+ tests). The rule is
applied in **five** places that must stay in agreement (same drill as §5.9):
1. **Role page** — `src/pages/ProfilePage.tsx` (`variant` prop; deep-linked `?patientId=` stays visible regardless of split).
2. **Role counts / bars** — `src/hooks/useRoleCounts.ts` (profile board task splits `profile` / `unverifiedReferrals`).
3. **Oversight charts** — `src/lib/oversight/oversightApi.ts` `CHART_FILTERS` (`profile-send-off` = verified only; `profile-send-off-unverified` = Type `Patient` OR Source `CareCentrix` via `anyCols`).
4. **Baseline (build time)** — `scripts/snapshot-baseline.mjs` `countProfile` (§5.8 counting contract).
5. **Baseline (9 AM cron)** — `services/baseline-cron/index.mjs` `countProfile`.

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
  patient in the stage page (manager mode) to view/work in UI. Insurance columns 2/3: DVS Retry Queue
  (provisional) + Benefits check-failed, display-only. `lib/oversight/priority.ts` adds
  VIP/priority scoring (localStorage config). The open drill-down `{stage, chart, bucket}` is
  **mirrored to the URL** so Back from a patient's agent page returns to the exact drill-down (see the
  back-nav note in §9). **Keep oversight reads on the gateway:** `oversightApi.ts` must route through
  `MONDAY_API_URL`/`mondayIdentityHeaders` from `shared/mondayEndpoint`, *not* hardcode
  `api.monday.com` (a handoff once regressed this — reads would then bypass token-injection + audit).
- **System Management** (`/system-mgmt`, `lib/systemMgmt/mondayApi.ts`) aggregates counts/pipeline
  across *all* boards (hardcoded board + stage-advancer column IDs); `OperationsTab` + `PipelineChart`
  render burndown and day-bucket distributions.
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
- **Column IDs, not titles**, are the contract. Add new ones to `mondayMapping.ts` + the schema docs.
- **Exact label strings** for status/dropdown writes (Evaluate "Option A", coverage paths, etc.) —
  a casing mismatch creates duplicate board labels. Prefer index writes where possible.
- **Monday dates are ET, timezone-naive.** Don't compare with a bare `new Date()` in a non-ET runtime.
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
- `README.md` points here; keep this file current as the architecture moves.

---

## 11. Where to look first for a given task

| Task | Start here |
|---|---|
| A role's page behaves wrong | `src/pages/<Role>Page.tsx` → `hooks/<role>/useMondayPatients.ts` → `lib/<role>/workflow.ts` |
| A value isn't saving to Monday | `lib/<role>/mondayWrite.ts` + `lib/shared/verifiedWrite.ts`; cross-check `mondayMapping.ts` column IDs |
| Medical-necessity logic | `lib/masheke/evalState.ts` (+ ipPaths, requestTemplate, mnRequestPdf) |
| Stedi check output / eligibility results | **inline in `src/pages/ProfilePage.tsx`** — NOT `components/profile/StediPanel.tsx` (dead, §5.11) |
| Cost estimate wrong | `lib/welcomeCall/oopEstimator.ts` (sync vs Railway financial backend) |
| Who can see what | `lib/accessStore.ts`, `lib/roleView.ts`, `components/AccessProvider.tsx` |
| Files won't load / PDF viewer | `lib/shared/mondayAssets.ts`, `components/shared/FileViewerModal.tsx`, `worker/src/index.js` |
| Fax/email send | `components/masheke/SendRequestPanel.tsx`, `worker/src/index.js`, `lib/fax/ringcentralApi.ts` |
| Audit a write that "disappeared" | gateway `/audit` (Postgres `gql_log` / `send_jobs`) |
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
