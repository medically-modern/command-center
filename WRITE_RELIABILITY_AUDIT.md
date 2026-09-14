# Monday Write-Reliability Audit

**Date:** 2026-06-11 · **Scope:** every UI → Monday write path in this repo
**Question:** are writes confirmed before dependent actions (stage advancers, automations), and can data be silently lost?

---

## TL;DR

The codebase already has the right tool — `src/lib/shared/verifiedWrite.ts`
(`executeWritesWithVerification`: snapshot → write data with retry → poll
read-back until indexed → only then flip the stage advancer). The six main
**Send to Monday** flows use it correctly. The risk lives in the **inline
panel actions** (attempt saves, mark-complete, fax-send, escalation modal,
notes, file uploads) that bypass it, plus one whole board (Subscription)
that never adopted it.

| Severity | Count | Theme |
|---|---|---|
| HIGH | 6 | Stage/status advancers written before (or in parallel with) their data columns, unverified |
| MEDIUM | 9 | Single-shot writes with no retry; optimistic UI not rolled back; partial-success file uploads |
| LOW | 3 | Narrow single-column writes with surfaced errors |

---

## What is SOLID today (keep as the template)

| Flow | File | Why it's good |
|---|---|---|
| Evaluate / Send Request / Confirm Receipt / Chase main send | `lib/masheke/mondayWrite.ts` | verified-write; advancers (2A–2D, subStage) deferred to Phase 3 |
| Samantha send (Benefits / Submit Auth / Auth Outstanding) | `lib/samantha/mondayWrite.ts` | verified-write incl. context-dependent stage rules |
| Profile send-off | `lib/profile/mondayWrite.ts` | verified-write; "Move to Onboarding" last; failures logged to Josh Debug |
| Welcome Call main send | `lib/welcomeCall/mondayWrite.ts:31` | verified-write; Stage Advancer last |
| Final Confirm send | `lib/finalConfirm/mondayWrite.ts` | verified-write; Stage Advancer last |
| Evaluate clinical-file uploads | `hooks/masheke/useImmediateFileUpload.ts` | confirmed via mutation asset id (since 2026-06-11); Send blocked while uploads in flight |

---

## HIGH findings — fix first

**H1. `SendRequestPanel.handleMarkComplete`** (`components/masheke/SendRequestPanel.tsx` ~301)
`Promise.allSettled` writes **Stage Advancer (subStage)** in the SAME parallel
batch as Request Sent At, Next Action Date, Escalation, and doctor fields.
The stage automation can fire while sibling writes are unindexed or failed.
Partial failure → patient advanced with missing data. *Fix: route through
`executeWritesWithVerification` with `subStage` as stageColumnId.*

**H2. `SendRequestPanel.handleSend`** (fax/email, ~248)
`sendRequestTrigger` (automation trigger) + `requestSentAt` written raw, no
verification or retry. Trigger can fire before the timestamp is indexed.
*Fix: same wrapper, trigger column last.*

**H3. `ConfirmReceiptPanel.saveYes`** (~575)
Sequential raw writes: name → date → MN Attempts → **subStage advancer** →
Next Action Date. The advancer is written BEFORE the next-action date, with
no retry; a failure after the advancer leaves the patient advanced with
incomplete data. *Fix: wrapper, subStage last.*

**H4. `ConfirmReceiptPanel.saveNo`** (~590)
Attempt text → MN Attempts (+ escalation on attempt 3) raw sequential. The
escalation status (which managers/automations key on) can land while the
attempt reason text is missing/unindexed. *Fix: wrapper with mnAttempts +
escalation as stage columns.*

**H5. `ChaseClinicalsPanel.saveYes` / `saveNo`** (~498 / ~509)
Mirror of H3/H4 on the Chase tab. *Same fix.*

**H6. Subscription board `sendPatientToMonday`** (`lib/subscription/mondayWrite.ts:155`)
~20+ columns (including status columns like Subscription, Ordering Cycle,
Auth Statuses) in one raw `Promise.all(tasks.map(executeWithRetry))`. Has
per-column retry but NO read-back verification and NO ordering — any board
automation on those statuses can read stale siblings; partial success is
reported as thrown error but the board is left half-written. *Fix: adopt
`executeWritesWithVerification`; designate the automation-relevant status
column(s) as stage columns.*

---

## MEDIUM findings

**M1. Welcome Call text trigger** (`lib/welcomeCall/mondayWrite.ts:120`) —
two-phase (data `Promise.all`, then "Welcome Call Text" trigger) but no
read-back between phases; the auto-text automation can read stale fields.

**M2. `EscalationFormModal`** — ~~escalation status + notes in `Promise.all`;
status can land without the reason notes~~ **RESOLVED 2026-09-14**: the modal is
deleted. Welcome Call and Final Profile Confirmation run the Propose Stuck
ladder now (`lib/welcomeCall/mondayWrite.ts`), notes first, status second,
sequential — CLAUDE.md §5.34.

**M3. Notes panels (all boards)** — single `writeLongText`, no retry;
local notes state keeps the appended note even when the write failed (toast
shows error, but the UI looks saved; a later "Edit→Done" can also silently
diverge). Same for **Doctor Notes** (`shared/DoctorNotesPanel.tsx` →
`shared/doctorDb.ts`, separate board, no retry).

**M4. Subscription/UpdateClinicals + Samantha file uploads**
(`subscription/MnDocsPanel.tsx`, `samantha/FinalClinicalsUpload.tsx`) — loop
uploads with no per-file retry and no asset-id confirmation (the Evaluate
hook got this fix; these didn't). Partial success reported as aggregate
count.

**M5. SendRequest MN-letter upload** (`SendRequestPanel.tsx:~184`) — uses raw
`uploadFileToColumn` + refetch; doesn't use the returned asset id to confirm
before the letter becomes send-able.

**M6. Final Confirm split** (`pages/FinalConfirmPage.tsx:~164`) — after
`duplicateItem`, the split-flag/stage/date writes are best-effort; on failure
the duplicate exists with wrong stage flags and only a console warning.
Should fail loudly and ideally delete the orphan duplicate.

**M7. Per-file delete (all boards)** — download-keep → clear → re-upload is
inherently non-transactional (Monday offers no single-file delete). The
download-all-first guard (2026-06-11) means a failed download aborts safely,
but a failure during RE-UPLOAD can still drop kept files. Server-side
mitigation belongs in the worker (see below).

**M8. `triggerGenerate` script columns** (`SendRequestPanel.tsx:~104`) —
clear-then-set without verification; can be left cleared.

**M9. Optimistic `onUpdate` patches** across panels mark local state as
saved before Monday confirms; failures rely on the user noticing a toast.

---

## LOW findings

Visit-date save on Update Clinicals (single column, error surfaced); doctor
field edits batched into verified flows; misc single-status writes with
toasts.

---

## Cross-cutting risks (bigger than any one flow)

1. **The Monday API token ships in the public JS bundle.** The site is a
   public GitHub Pages app; `VITE_MONDAY_API_TOKEN` is baked in at build.
   Anyone can extract it and read/write every board the token can touch.
   This is the single largest data-integrity risk in the system.
2. **No durable write queue.** Closing the tab mid-send abandons the
   remaining writes silently. All retry state lives in the page.
3. **No audit trail.** When a write is lost there is no server log to
   reconstruct what was attempted (Josh Debug column helps but only where
   wired, and only on failures the client survives to report).
4. **Shared rate-limit budget.** Every open dashboard polls and writes with
   the same token; Monday complexity throttling appears as random slowness
   (e.g. count fetches) and failed writes under load.

---

## Should there be a server between Monday and the UI? — YES (incremental)

A thin write-gateway is justified by the cross-cutting risks alone, and you
already operate two pieces of server infrastructure to build on (the
`monday-file-proxy` Cloudflare Worker, already in the file path, and the
Railway doctor-sync service). Recommended path, cheapest first:

**Phase 1 — proxy everything, move the secret (1–2 days of work).**
Point every `gql()` at the worker instead of `api.monday.com`; the token
becomes a Cloudflare secret and leaves the public bundle. Add structured
request logging (Workers Logs or D1): instant audit trail of every write.
UI logic unchanged — it's a one-line endpoint swap per board lib + CI env
change.

**Phase 2 — server-side transactional send.**
Move `executeWritesWithVerification` into the worker as
`POST /send { itemId, tasks[], stageColumnIds[], idempotencyKey }`.
The worker performs snapshot → writes → read-back verify → advancer, with
Cloudflare Queues for durable retries. The browser fires ONE request and
can close immediately — sends survive tab closes, flaky Wi-Fi, laptop lids.
Idempotency keys make retries safe. This single change eliminates the H1–H6
class of bug permanently, because ordering is enforced in one place instead
of re-implemented per panel.

**Phase 3 (optional) — Monday webhooks → worker → cached reads.**
Counts and sidebars read from a worker-maintained cache (D1/KV) updated by
Monday webhooks; dashboards get sub-second loads and the polling traffic
(and its rate-limit pressure) disappears.

**Alternative considered:** a full Node service on Railway (like
doctor-sync). Works, but the worker is already deployed, cheaper, has no
cold-start/ops burden, and Queues/D1 cover the needs. Railway makes sense
only if you want long-running jobs or cron-heavy logic later.

**Interim quick wins (no server needed, ~1 day):** wrap H1–H6 in the
existing `executeWritesWithVerification`; add retry + asset-id confirmation
to the M4/M5 uploads; sequence the escalation modal (notes → verify →
status); add retry to notes/doctor-notes writes.

---

*Method: two independent code sweeps (masheke+samantha; all other boards +
shared) followed by manual verification of every HIGH finding against
source. Live-site behavior spot-checked where relevant.*

---

## 2026-09-14 — Welcome Call backend audit (Josh: "every field where it's implied you're writing to Monday actually writes")

Scope: `src/pages/WelcomeCallPage.tsx`, `components/welcomeCall/*`, `lib/welcomeCall/*` as of
commit 4d8f861, checked against the LIVE board `18410804557` (156 columns, 41 workflows + 20
legacy automations, 61 rows in the two active groups).

### A. Write path — every control that implies a write, and where it lands

| Control | Writes | Path | Verdict |
|---|---|---|---|
| Serving (banner select) | `color_mm1w1cm9` | Send (verified) | ✅ |
| Phone slots · owners · Can Text · caregiver name/relationship/HIPAA | 6 columns + Primary Phone | Send (verified), `phoneSlotWrites` | ✅ null = clear, unparseable = refused by the gate |
| Caregiver notes · OOP amount · reviewed tick · pump/address confirms | Notes (intake block) | Send | ✅ |
| CGM Type · Monitor Qty · Monitor Purchase Date | 3 columns | Send | ✅ Monitor Qty always "0"/"1" |
| Pump Type · Pump Qty · Prior Pump Date | 3 columns | Send | ✅ Pump Qty blank deliberately not written (7918341011) |
| Infusion Set 1/2 + quantities · Cartridges | 5 columns | Send | ✅ blanks clear (§5.31c); cartridge blank never written (cannot be produced by the UI) |
| Secondary coverage No / Yes+type / Member ID 2 / Insurance Notes | 3 columns | Send | ✅ Unknown writes nothing BY DESIGN (§5.31c) |
| Subscription Type (incl. auto-fill) · Order Frequency (effective value) | 2 columns | Send | ✅ Order Frequency's CARD is hidden behind `SHOW_ORDER_FREQUENCY` from 2026-09-14 (Josh); the column is still written — board value or payer default (§5.31c) |
| Next Order Dates ×3 | 3 date columns | Send | ✅ clears go through `{}` |
| Update Address | `location_mm1xhw17` (+ POS derived) | Send | ✅ |
| Advance | `color_mm301cpp` = 1, then Stage Advancer = Review Profile | Send (advancer last) | ✅ |
| Send Welcome Call Text | product/phone columns, then `color_mm1xtqvv` = Send | immediate, two-phase | ✅ fires; ⚠️ **M1 stands** (no read-back between phases) |
| Welcome Call Text "Queued" (second press) | **nothing** — local toggle only | — | ❌ **FIXED**: the board stayed at "Send", so a re-press wrote 0 onto 0 and the automation never fired. Now `resetWelcomeCallText` clears the column (§5.34) |
| Call Attempts +1 | `text_mm322fg9` + Follow Up = Done + Follow Up Date = tomorrow | immediate | ✅ |
| Follow Up modal · sidebar "Active" (clear) | Follow Up + date | immediate | ✅ |
| Notes Add / Edit→Done | `text_mm6vqq2k` | immediate | ✅ (uncapped `text` column since 2026-09-03) |
| Escalate button + form | `color_mm1x7997` = 0 + `long_text_mm3jgh1y` | immediate | ❌ **FIXED**: write-only — `escalated` was hardcoded `false` on read, "toggle off" never wrote, and nothing could clear the flag (§10). Replaced by the ladder (§5.34) |
| Stuck (header + End of Call) | Notes stamp + Stage Advancer = Stuck | immediate | ↻ **REPLACED** by Propose Stuck (§5.34) — reps propose, managers approve |
| Save (header) | localStorage overlay only | — | ✅ honest ("Progress saved — you can leave and come back") |
| Reset | overlay cleared + refetch | — | ✅ |

Never-written model fields, harmless: `memberId1Edited`, `primaryInsuranceIndexEdited`,
`phoneEdited` (their controls were deleted in the September redesign; the send's guarded branches
for them are dead but correct).

### B. Read path

- **Every column id the Welcome Call code references exists on the live board** (97 ids diffed
  against the board's 156; the three misses are the Cardinal SKU Tracker's, a different board).
- **Every hardcoded label id the UI writes matches the live `settings_str`**: Serving, Pump Type,
  CGM Type (incl. Simplera Sync = 10), Subscription Type, Secondary Insurance (Other = 4, Done = 3
  deactivated), Order Frequency (154/16/3/107), Primary/Alternate Contact (7/4), Can Text (1/2),
  POS (0/1), Advance? (1/2), Stage Advancer (0 Review Profile · 2 Stuck · 4 Completed · 7 Welcome
  Call), Follow Up Done = 1, Welcome Call Text Send = 0, Order Handling 0/1/2.
- `PRIMARY_INSURANCE_OPTIONS` (welcomeCall/workflow) lacks **Health Plans Inc (PHCS)** (board id 7)
  and spells id 3 "MagnaCare" where the board says "Magnacare". No effect on this page — Primary
  Insurance is read-only here and rendered from the board's text — but the list is the §5.33
  "still hardcoded" one and should follow that fix.
- **Board-side anomaly, not the app's:** three Final Profile Confirmation rows (Roque Bueno,
  Jacqueline Loville, Chester Saharceski Jr) carry `{"index":5}` in Advance? `color_mm301cpp`, an id
  no label has. The SPA writes only 1 and 2; no workflow writes that column. They read as "not
  Advance" — the fail-safe direction — but whoever wrote 5 wrote a dead label.
- `escalated` was hardcoded `false` on read — fixed (§5.34). `escalationNotes` is read and never
  mapped (dead read, kept for the Escalations tab's legacy parse).
- Escalated items stay in their group (the only workflow that moved them, 7918322106 → the
  "Escalation" group, is inactive), so the group-scoped reads see them. The "Escalation" group is
  empty and read by nothing.
- `PatientActivityCard` / `IntakeMessages` read `patient.phone` (the board's primary), not the
  starred slot the rep may have just changed — correct until Send lands, worth knowing.
