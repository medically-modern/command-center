# Reliability Audit — 2026-07-13

**Scope:** whole repo — every UI→Monday write path, the Cloudflare worker (email/fax/uploads),
the Railway gateway, slow-network behavior, client state consistency, and CLAUDE.md accuracy.
**Method:** 6 parallel deep-read passes (gateway coverage, inline writes, slow network, worker
sends, doc claims, state consistency), every medium/high finding then independently
adversarially re-verified against source. 73 findings survived verification.
**Status: DOCUMENTATION ONLY.** Per Josh (2026-07-13): no fixes applied to `main` — this file is
the only thing this audit adds here. Companion changes (CLAUDE.md/WRITE_RELIABILITY_AUDIT.md doc
updates plus four no-behavior-change corrections: a missing import in dead code + three stale
comments) sit on branch **`claude/affectionate-carson-mmxm40`** (commits `9788f96`, `e2355a5`),
unmerged. Everything below is an **open item** unless the entry says otherwise.

**How to read this:** IDs are stable — reference them as `A3`, `C2`, etc. Severity reflects
real-world blast radius for a DME ops team: HIGH = patient-facing duplicates, wrong-patient
writes, or silent data loss; MED = degraded reliability/UX that costs rep time or leaves the
board wrong; LOW = latent traps and paper cuts.

Companion docs: `WRITE_RELIABILITY_AUDIT.md` (the 2026-06 write audit this one extends), and —
on the `claude/affectionate-carson-mmxm40` branch — updated CLAUDE.md §5.2/§9/§10 sections plus
a per-finding status table appended to WRITE_RELIABILITY_AUDIT.md.

---

## 0. The two questions that prompted this audit

**"Is everything bundled in the server before being sent to Monday?" — No.**
Reads: yes (100% through gateway `/gql` when configured; zero hardcoded `api.monday.com` in
src/). Writes: **only the masheke flows** (Evaluate, Send Request, Confirm Receipt, Chase
Clinicals) qualify for the durable server-side `/send` transaction — the fast path requires
`boardId` + a raw `value` on every task (`verifiedWrite.ts:154`) and only masheke passes them.
The samantha, welcomeCall, profile, finalConfirm and subscription sends always run as dozens of
individual client-side mutations (audited, but not durable/atomic/idempotent). File uploads,
`/send-message` email/fax, and `access.json` writes never touch the gateway at all.

**"Are we built for slow wifi?" — Only along one corridor.**
Hardened: masheke gateway sends (one quick POST → durable Postgres queue; job survives tab
close), Chase/Confirm block until Monday confirms (`requireDone` + `SaveProgressOverlay` +
beforeunload), value-idempotent retries, Evaluate uploads confirmed by asset id. Not hardened:
almost no fetch has a timeout (§C1), the offline outbox effectively never engages (§C2), email/
fax sends have no idempotency (§A1–A2), and every background poll is an overlapping
`setInterval` (§C4).

---

## A. Duplicate-send risks (email / fax / SMS) — the highest operational severity

- **A1 · HIGH — `/send-message` has no idempotency key, no retry, no timeout.**
  `worker/src/index.js:277-390`; callers `SendRequestPanel.tsx:324`, `ConfirmReceiptPanel.tsx:~407`,
  `ChaseClinicalsPanel.tsx:~337`. An ambiguous network failure (request delivered, response lost
  — exactly what flaky wifi produces) or a partial-failure retry **re-sends the grouped email
  and re-faxes every recipient that already succeeded**. Doctors' offices receive duplicates.

- **A2 · HIGH — partial failure (HTTP 207) is toasted as a total "Send failed."**
  Worker returns 207 with per-recipient `results`; all three panels throw and toast a headline
  "Send failed" (recipient detail only in the description). Nothing tells the rep which
  recipients **succeeded**, and the recipient list is unchanged — the natural retry re-sends to
  everyone. (Note: `res.ok` is TRUE for 207; all three current callers correctly also check
  `data.ok` — any new caller that checks only `res.ok` will silently swallow partial failures.)

- **A3 · HIGH — Chase/Confirm re-send flows put the post-send Monday write in the SAME
  try/catch as the send itself.** `ChaseClinicalsPanel.tsx:337-373`, `ConfirmReceiptPanel.tsx:~383-430`.
  A Monday verification timeout after a **successful** fax also toasts "Send failed" → invites a
  re-fax. `SendRequestPanel.tsx:350-368` gets this right (nested try → "Sent, but couldn't
  advance the stage") — that's the pattern the other two should copy.

- **A4 · MED — SMS double-text guard covers only the HTTP-5xx branch.**
  `ringcentralApi.ts:123-138`. The 500-but-delivered message-store confirmation
  (`confirmSmsAccepted`) is real, but a **network-level throw** (connection dropped after the
  POST was delivered) bypasses it entirely — rep retries, patient gets two texts. Also the
  confirm window opens 60s **before** the POST and never compares `creationTime`, so an
  identical text sent moments earlier can vouch for a dropped one.

- **A5 · MED — Gmail sends have no retry/timeout; the grouped email is a single point of
  failure.** `worker/src/index.js:360-367`. One transient Gmail 5xx fails ALL email recipients
  at once (one grouped message), flipping the response to 207 → A2's spiral. Faxes fail
  per-recipient in the loop.

- **A6 · MED — no attachment size limit on either side.** Worker buffers every file fully into
  a base64 string in memory (`worker/src/index.js:90-98, 333-336`) and rebuilds the full MIME
  **per fax recipient** (`:384-386`); no caller checks size. Oversized clinical scans can hit
  Gmail's cap or the worker memory limit mid-loop — some recipients sent, some not.

---

## B. Monday write-integrity gaps (unverified writes, ordering, wrong-patient)

- **B1 · HIGH — Subscription send (audit H6) is still the one board-send with zero read-back
  verification.** `lib/subscription/mondayWrite.ts:155-162` — ~25 columns (including
  automation-relevant statuses: Subscription, Ordering Cycle, Auth Statuses) in one raw
  `Promise.all` with retry only. Any automation on those statuses can read stale siblings; a
  partial failure throws (before confetti — that part is fixed) but leaves the board
  half-written with no verification.

- **B2 · HIGH — Subscription send pushes Secondary Insurance TWICE in the same batch.**
  `lib/subscription/mondayWrite.ts:92-93` (from `secondaryInsuranceIndex`) and `:137-139` (from
  `secondaryInsuranceEdited ?? secondaryInsuranceIndex`). When the rep's edit differs from the
  polled value, two racing writes to the same column → **nondeterministic final value**.

- **B3 · HIGH — Welcome Call Text trigger (audit M1) flips a patient-facing automation on
  unverified data.** `lib/welcomeCall/mondayWrite.ts:215-219` — raw un-retried `Promise.all`
  data writes, then immediately the auto-text trigger, no read-back. Monday returns 200 before
  indexing, so the **text automation can read stale order data and text it to the patient**.
  The in-file comment ("fully committed") is wrong — Promise.all proves acceptance, not
  indexing. Highest-priority remaining write-ordering item because it's patient-visible.

- **B4 · HIGH — Escalation modal can write escalation status + notes to the WRONG patient.**
  `EscalationFormModal.tsx:80-83` + live `patientId={selected.id}` binding on
  ChaseBenefits/SubmitAuth/AuthOutstanding/WelcomeCall/FinalConfirm pages. The modal never
  resets its draft and Radix blocks manual clicks — but **poll-driven auto-select** (patient
  absent from two consecutive 30s polls, e.g. moved by an automation or another rep) silently
  swaps the selection under the open modal (~30-60s window). Writes are also parallel and
  unverified (audit M2): status can land while notes fail.

- **B5 · MED — "Never billed" attestations and Trigger DVS can never be un-set from the UI.**
  `lib/samantha/mondayWrite.ts:421-444` — write tasks are pushed only when truthy; unchecking
  writes nothing and the next poll re-checks the box. (Checkboxes ARE seeded from Monday, so
  the wrong value persists indefinitely.)

- **B6 · MED — Final Confirm split (audit M6): post-duplicate writes are best-effort and the
  Split flag is written nowhere else.** `FinalConfirmPage.tsx:~174-196` — after
  `duplicateItem`, flag/stage/date writes race Monday's "new item created" automation inside a
  try whose catch is `console.warn` only. If that write fails, the duplicate's Split flag is
  wrong **permanently** (Submit repairs only Stage Advancer).

- **B7 · MED — notes are optimistic with weak persistence (audit M3).**
  All notes panels update local state before an un-retried `writeLongText`; failure = toast at
  best while the UI looks saved. Worst case: **SendRequest's step-note swallows failures with
  an empty catch** (`SendRequestPanel.tsx:~516-529`) — note renders locally, never lands on
  Monday, zero feedback, input already cleared. (`DoctorNotesPanel` alone was fixed to
  save-first.)

- **B8 · MED — samantha/subscription file uploads have no retry and no asset-id confirmation
  (audit M4).** `FinalClinicalsUpload.tsx:58-73`, `subscription/MnDocsPanel.tsx:153-178`. Only
  masheke's `uploadFileToColumn` returns the created asset id — porting the Evaluate-style
  confirmation requires touching the samantha/subscription API modules, not just panels.

- **B9 · MED — post-advance raw writes produce false "Save failed" toasts and can be silently
  lost.** `ConfirmReceiptPanel.tsx:~256-313` (and analogues): after the verified save + stage
  flip succeed, raw single-shot writes (escalation done, doctor fields) run in the same try —
  a failure there toasts as if the whole save failed, even though the patient already advanced.

- **B10 · MED — masheke's exported-but-unused `sendPatientToMonday` is an unmaintained trap.**
  `lib/masheke/mondayWrite.ts:123`. Nothing calls it (panels use
  `runVerifiedSend`/`recordAndAdvanceVerified`), and it references `YES_NO_MONDAY_OPTS` without
  importing it — a latent ReferenceError the moment anyone wires it up (a one-line import fix
  sits on the `claude/affectionate-carson-mmxm40` branch). Treat as legacy either way.

- **B11 · LOW — generate-script trigger is clear → 250ms sleep → set, unverified (audit M8).**
  `EvaluatePanel.tsx:244-259`, duplicated `SendRequestPanel.tsx:144-151`. Failure mid-sequence
  leaves the trigger column blank.

- **B12 · LOW — single-file delete's re-upload phase is un-retried (audit M7 residual).**
  `lib/masheke/mondayApi.ts:614-628`. Download-all-first guard is in place, but a failure
  after the clear, during re-upload, still drops kept files.

- **B13 · LOW — follow-up / call-attempt inline writes are parallel single-shots, no retry.**
  `welcomeCall/CallAttemptsCounter.tsx:40-43`, `samantha/FollowUpModal` and clones; Welcome
  Call "Stuck" is a raw one-column advancer write (`WelcomeCallPage.tsx:166-181`) — tolerable
  (no sibling data), but un-retried.

---

## C. Slow-network gaps (beyond the hardened masheke corridor)

- **C1 · MED — almost no fetch has a timeout/AbortController.** Every per-role `gql()`, the
  gateway `POST /send` + `pollDone`, all RingCentral calls, and the access.json fetches are
  bare `fetch` — a stalled connection hangs on the browser's multi-minute TCP timeout. Only
  `mondayAssets.fetchWithTimeout` (25s) and `ParachuteLookupPanel` abort.

- **C2 · MED — the localStorage offline outbox only engages when `navigator.onLine === false`.**
  `gatewaySend.ts:114-121`. Flaky-but-connected wifi (the common failure) keeps `onLine` true,
  so the module's headline bad-internet feature effectively never fires; the caller falls back
  to the client path instead. (Caveat for any fix: `postSend` throws on any `!res.ok`, so
  "3 failures" can also mean three real 4xx rejections — parking those would be wrong.)

- **C3 · HIGH — fast-path fallback can run the transaction twice.** If a `POST /send` reaches
  the gateway (job durably queued) but all 3 attempts lose their responses, `submitSend` throws
  a plain error and `verifiedWrite.ts:184-188` falls back to the full client-side transaction —
  client writes now, queued job replays later, **potentially re-imposing old values over edits
  made in between**. `requireDone` (GatewayPendingError, "queued — do not repeat") protects
  only Chase + Confirm Receipt.

- **C4 · MED — every background poll is a bare `setInterval` with no in-flight dedup or
  response-ordering guard.** Patients 30s (sequential 200/page pagination — a fetch can outlive
  the interval), role counts 60s, escalated counts 60s, access.json 10s, oversight 90s, Stedi
  4s during eligibility runs. On slow links, overlapping polls pile up and last-response-wins
  can render an older list (and poison the localStorage patient cache). Edited fields survive
  via the overlay; list membership doesn't. `useFaxStatus` (setTimeout-chained) and
  `useMondayFiles` (`itemIdRef`) are the in-repo correct patterns.

- **C5 · MED — non-`requireDone` gateway sends report success at "accepted."** After the ≤20s
  `pollDone` window, a still-pending job resolves as success (`verifiedWrite.ts:175`); a
  server-side failure after that window is **never surfaced to the rep** (it does land as a
  FAIL row in the gateway audit). Applies to Evaluate send and SendRequest mark-complete.

- **C6 · MED — access-config saves are fire-and-forget with silent revert.**
  `accessStore.ts:146-152` — failure is `console.error` only, no toast/rollback, and the 10s
  poll silently reverts the admin's change on screen. On 409/422 conflict the retry re-PUTs the
  same local snapshot — **last-writer-wins, the other manager's edit is discarded** (the
  refetched data is thrown away, only the SHA is kept).

- **C7 · LOW — favorable, for the record:** verifiedWrite's read-back budget counts *attempts*,
  not wall time (`verifiedWrite.ts:234-288`) — slow links stretch the window in Monday's
  favor, and the timeout message correctly says "retry the send" (client-path retries are
  value-idempotent).

---

## D. Security / auth surface

- **D1 · HIGH — worker `/gh-state` PUT is completely unauthenticated.**
  `worker/src/index.js:257-274` — no `verifyIdToken` call (unlike `/send-message`). Anyone who
  learns the worker URL can overwrite `access.json` (e.g. grant themselves manager) via the
  server-side `GITHUB_PAT`. Strictly better than the old bundled-PAT world, but the gate that
  `/send-message` has is missing here.

- **D2 · HIGH (deliberate, but document-worthy) — gateway `/send` and `/rc/*` never 401.**
  `send.mjs:148-186`, `ringcentral.mjs:62-68`. Tokens are verified only when present, for
  audit attribution; a stale/absent token falls back to the self-asserted `X-MM-User` header.
  Protection = path allowlist + method allowlist + CORS — none of which bind a non-browser
  caller. `/send` writes arbitrary Monday columns with the server token; `/rc` reads/sends
  fax + SMS (PHI). This is what keeps saves working hours into a shift (no token refresh
  exists), so any fix must verify signatures while ignoring expiry (like the worker does) —
  the gateway's `verifyGoogleToken` currently enforces expiry, which is why it can't block.

- **D3 · MED — only `VITE_MONDAY_API_TOKEN` still ships in the public bundle.** (VITE_GITHUB_PAT
  and RC creds are gone — moved server-side.) "Phase 1b" removal is NOT a one-line change:
  every module's `gql()`/`hasToken()` hard-requires the token string even in gateway mode, and
  the upload path still forwards it. If the old RC credential from past public builds was never
  rotated, rotate it — old bundles are archived on Pages.

- **D4 · LOW — gateway audit attribution silently degrades after ~1h.** The gateway enforces
  token expiry (worker doesn't), and the SPA never refreshes the 1h Google token — so after an
  hour every `/gql`/`/send` is attributed from the spoofable `X-MM-User` header.

- **D5 · LOW — with the worker var `GOOGLE_CLIENT_ID` unset, `/send-message` accepts a signed
  medicallymodern.com token minted for ANY Google OAuth app** (aud unchecked,
  `worker/src/index.js:230`). Set the var to pin the audience.

- **D6 · LOW — attachment filename is interpolated unescaped into MIME headers.**
  `worker/src/index.js:162-164` — a quote or CRLF in a Monday file name corrupts (or injects
  into) the outbound email's headers. Addresses and Subject are sanitized; filenames aren't.

---

## E. State consistency (overlays, drafts, selection)

- **E1 · MED — persisted per-patient overlays have no TTL and are baked into later sends.**
  Saved via the header Save button to localStorage, re-applied over fresh Monday data on every
  poll until send/Reset (`hooks/*/useMondayPatients.ts`). A weeks-old draft on a forgotten
  browser can overwrite newer Monday data through a fully "verified" write. Per-browser only.

- **E2 · MED — un-sent Evaluate answers are discarded on the next load of that patient.**
  Monday-wins runs on every load (`evalState.ts:163-177` deletes every Monday-backed field the
  board has blank) — including involuntary auto-select jumps. The draft survives switch-AWAY
  (localStorage) but dies on switch-BACK/refresh. Also keyed by Monday item id, so drafts never
  follow a patient across board hops.

- **E3 · MED — only Chase + Confirm Receipt block mid-save interaction.** Every other
  multi-write send (Benefits, Submit Auth, Auth Outstanding, Welcome Call, Final Confirm,
  Subscription, Profile, Evaluate) leaves the sidebar live during multi-second transactions.
  In-flight transactions are closure-safe (they write to the patient captured at click), but a
  sent patient lingers ~60-90s (automation + poll + two-miss auto-select), enabling
  double-submits; combined with B4 it's the wrong-patient window.

- **E4 · LOW — finalConfirm's deep-link injection skips the overlay merge** that every other
  hook applies (`finalConfirm/useMondayPatients.ts:100-106`) — a deep-linked patient renders
  without their saved local edits.

- **E5 · LOW — profile's `removeOverlayKeys` never updates the persisted copy**
  (`profile/useMondayPatients.ts:165-176`) — removed keys resurrect from localStorage on
  reload.

- **E6 · LOW — the masheke read path writes:** every poll auto-stamps Next Action Date = today
  on new arrivals missing one (`masheke/useMondayPatients.ts:123-144`), guarded per-session —
  two open tabs each stamp once (same value, so benign, but it's a write from a "read" path).

---

## F. Smaller correctness / cosmetic items

- **F1 · LOW — `welcomeCall/mondayWrite.ts:143` references `COL.joshDebug`, which doesn't exist
  in that board's COL map** — the failure-path debug write targets an undefined column id.
  (Symptom of F2.)
- **F2 · LOW — the build never type-checks and CI never runs tsc.** ~a dozen real errors exist
  under `npx tsc -p tsconfig.app.json --noEmit` (this is how F1, B10's missing import, and a
  duplicate `GENERAL_INSURANCE_INDEX` import binding in `profile/mondayWrite.ts:14+19` shipped).
- **F3 · LOW — `systemMgmt` `removeEscalation` stamps "today" in the browser's LOCAL timezone**
  (`systemMgmt/mondayApi.ts:465`) — a manager outside ET late in the day writes the wrong Next
  Action Date. Violates the "Monday dates are ET" convention.
- **F4 · LOW — re-send success toast says "sent via RingCentral" for plain-email recipients**
  (`ConfirmReceiptPanel.tsx:429`, `ChaseClinicalsPanel.tsx:368`) — email goes out via Gmail;
  RingCentral is only the fax leg.
- **F5 · LOW — masheke Escalate button claims "Escalation form submitted" but the form modal is
  commented out on every masheke page** (`EscalateButton.tsx:53-56`; e.g.
  `ChaseClinicalsPage.tsx` render block) — the button opens nothing there. Re-enabling the
  commented Blocked/Stuck/FollowUp/Escalation modals would also resurrect their unverified
  parallel writes (they still compile).
- **F6 · LOW — `fetchOutboundFaxStatus` ignores its `sinceIso` parameter** (`ringcentralApi.ts:66`,
  fixed 12h lookback + last-10-digit match) — a fax re-sent to the same number within 12h
  reports the newest attempt's status, not the requested one.
- **F7 · LOW — `deploy.yml:46-52` still passes dead `VITE_RC_CLIENT_ID/SECRET/JWT` secrets**
  with a comment claiming a bundled fallback that no longer exists (only `VITE_RC_SMS_FROM` is
  read). Cleanup candidate.
- **F8 · LOW — `public/data/assignments.json` is dead** (nothing reads it; CLAUDE.md's
  "safe to delete" verified).
- **F9 · LOW — every RingCentral feature breaks SILENTLY when `VITE_MONDAY_GATEWAY_URL` is
  unset** (`ringcentralApi.ts:14-16` — `rcFetch` targets a relative `/rc/...` path on the Pages
  origin; fax count, Fax Inbox, fax status and SMS all 404 with no dedicated error). By-design
  consequence of the 2026-07 server-side move, but there's no guard or user-facing message.

---

## G. Documentation drift — corrections written 2026-07-13, on the unmerged branch

These are places CLAUDE.md (and two code comments) contradicted the code. Corrections exist on
branch **`claude/affectionate-carson-mmxm40`**; until that merges, `main`'s CLAUDE.md still
carries every stale claim below — trust the code (and this list), not those sections:

- access.json is read/written via the worker **`/gh-state`** proxy (server-side `GITHUB_PAT`) —
  `VITE_GITHUB_PAT` no longer exists in the bundle (§5.3, §8, §10).
- RingCentral creds/JWT moved to the gateway **`/rc`** proxy (Railway env); fax/SMS features now
  REQUIRE gateway mode (§5.5, §10).
- The worker has **four** routes, not three (§5.5).
- Gateway `/send`/`/rc` **auth is deliberately non-blocking** — the old "enforcement ON" claim
  was stale (§8, §10/D2).
- `daily-baseline.yml` no longer exists — prod's baseline is a build artifact from `deploy.yml`'s
  7:00 UTC schedule; the committed baseline comes only from the Railway cron pinned to test (§8).
- `VITE_MONDAY_GATEWAY_URL` / `VITE_GOOGLE_CLIENT_ID` / `VITE_AUTH_DOMAIN` ride in the committed
  `.env.production` (carry over on sync) — not copied secrets (§8).
- FAX bar IS clickable (opens `/fax-inbox`); authDenied's registry route is a dead link (§4).
- The `updateClinicals` role existed undocumented; DailyBurndown renders it + subscription as
  "Ad-hoc tasks" tiles (§4).
- H1–H5 of the 2026-06 write audit are FIXED in the code (masheke `runVerifiedSend`); the audit
  doc's "confetti on partial failure" claim was stale (the branch appends a per-finding status
  table to WRITE_RELIABILITY_AUDIT.md).
- Three stale code comments (auth.ts references the removed SessionKeeper; evalState.ts claims
  the board lacks the "Malfunction invalid" label its own code and tests use; accessStore.ts
  describes bootstrap as "no managers, no processors" when only managers count) — corrected on
  the branch, still stale on main.

---

## H. Verified intact (checked, no action needed — don't re-audit these on a hunch)

- All eight §3 board IDs match the constants in `lib/*/mondayApi.ts`.
- The verifiedWrite protocol matches its documentation exactly (8×1500ms, 3 stable reads,
  throws without advancing, requireDone semantics).
- All **five** chase-split call sites agree (Email rides with Parachute); NAD bump is +3
  business days for every method.
- The three burndown counters (`useRoleCounts`, build-time snapshot, 9 AM cron) are currently
  in exact agreement.
- Oversight reads route through the gateway (`MONDAY_API_URL` + identity headers) — the old
  regression is fixed; no hardcoded `api.monday.com` anywhere in src/.
- Worker `/send-message` grouped-email/per-fax behavior, address validation-before-send,
  To+Cc dedupe, and rcfax-in-Cc rerouting all work as documented; `/asset` rejects XML/HTML
  error bodies with an anchored MIME check (Office files pass).
- `fetchUnreadFaxCount` and `fetchInboundFaxes` both pass the explicit 180-day `dateFrom`.
- sendSms's 5xx message-store confirmation is implemented (see A4 for its two gaps).
- NYSHIP is in both zero-OOP sets (`oopEstimator.ts`, `profile/oopEstimate.ts`).
- Evaluate uploads: confirmed by asset id (or column read-back poll) before Send unblocks.
- The Option-A label round-trip (`IP_REQ_LABELS`) matches the tests, including the
  "Malfunction invalid" label added after the original comment was written.
- Patient Questions' handled-stamp is a deliberate raw write (no automation keys on the
  column — documented in `patientQuestions/mondayApi.ts:10-12`) — not a B-class gap.
- Retried writes are value-idempotent (retry re-sends the same pre-composed value; append-log
  columns compose read+append once before the task is created — no double-append on retry).
