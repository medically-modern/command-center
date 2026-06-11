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

**M2. `EscalationFormModal`** (`components/shared/EscalationFormModal.tsx:~77`)
— escalation status + notes in `Promise.all`; status can land without the
reason notes. Should be: notes verified first, then status.

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
