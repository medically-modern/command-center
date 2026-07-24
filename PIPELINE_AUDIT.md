# Pipeline Functional Audit — Profile Send Off → Medical Evaluation → Insurance

**Date:** 2026-07-24
**Scope:** Every UI→Monday write path, queue/counting rule, and network-failure branch in the
overhauled `profile → masheke → samantha` pipeline.
**Method:** 12 code-reading finders (one per pipeline slice) → dedup → an independent adversarial
verifier per finding that tried to *refute* it against the real code. 37 candidates → 34 survived
(24 CONFIRMED, 10 PLAUSIBLE), 3 rejected as false positives.
**Lens:** functional defects only — patients falling through cracks, bad/slow wifi, missing
branches, data actually landing on Monday, and whether the "sending → sent" UI is truthful. Not
lint/style.

---

## Verdict: **Not ready to ship as-is next week — but every blocker is a small, localized fix.**

The architecture is sound. The verified-write protocol (snapshot → write → verify → advance),
the durable idempotent gateway queue, and the blocking `SaveProgressOverlay` are all real and
mostly correct. The problems are **specific wiring gaps**, not design flaws. There are **5
release-blockers**; fixing them plus the two systemic write-infra items is comfortably a
few-days job. Everything below the blockers is a fast-follow.

| Severity | Count |
|---|---|
| 🔴 Release-blocker | 5 |
| 🟠 High | 3 |
| 🟡 Medium | 9 |
| ⚪ Low | 17 |

---

## 🔴 Release blockers (fix before shipping)

### B1 — Evaluate "Send" bypasses every safety gate (advances patient mid-upload)
`src/components/masheke/EvaluatePanel.tsx:983`
The live **"Completed Evaluation"** button is `disabled={sending}` **only**. The component that
holds the real gate — `ValiditySummary` (`disabled={sending || blocked || filesUploading}`, with
the "Files uploading to Monday — Do NOT advance until upload is confirmed" warning) — **is defined
but never rendered anywhere** (`grep "<ValiditySummary"` = 0 hits). So `filesUploading` (line 169),
`noteAdded`, and `pendingNoteText` are all computed but **dead**.
**Consequence:** rep drops the Final Clinicals file (async upload) and clicks Completed on slow
wifi → `subStage` flips to `Completed` (the automation trigger) and the patient moves to the next
board **while the clinical package is still uploading or has failed**. Also: typed-but-unadded note
text is silently dropped from `mnEvalNotes`.
**Fix:** render `ValiditySummary` (or lift its `blocked/filesUploading/noteBlocked` logic) and set
the live button to `disabled={sending || blocked || filesUploading}`; hard-guard
`handleSendToMonday` on `filesUploading` as defense-in-depth.

### B2 — Stage routing and the written "Medical Necessity" column disagree
`src/lib/masheke/evalState.ts:856` (routing) vs `deriveValidity`/`buildMondayPreview`
`bannerMnEstablished` (drives `nextStage='Completed'`) never checks Diagnosis or Last-Visit;
`deriveValidity` (drives the **written** `medicalNecessity` column) requires `diagnosisValid` +
`mrValid`. They diverge. The blank-field case is guarded, **but** `diagnosis === "Evaluate"` (the
board's placeholder default) slips through: `getMissingRequiredFields` only tests `!state.diagnosis`
(truthy → not flagged), while `deriveValidity` rejects `"Evaluate"` as invalid.
**Consequence:** a patient with Diagnosis left at "Evaluate" (clinicals received, scripts/language
valid) advances to `Completed` with the MN column written **"Not Established"** and "Diagnosis
missing" still in the reasons — a contradiction shipped downstream. The Step-2 banner shows green
while the ValiditySummary banner shows red.
**Fix:** route `nextStage` off `validity.established` (or add `diagnosisValid`/`mrValid` to
`bannerMnEstablished`), and make `getMissingRequiredFields` reject `diagnosis === "Evaluate"`.

### B3 — Escalation-clear on "Confirmed" is unverified and post-advance → escalated patient hidden in Chase
`src/components/masheke/ConfirmReceiptPanel.tsx:266`
A manager confirms an escalated Confirm-Receipt patient. `saveYes(...)` (requireDone) advances
`subStage → Chase Clinicals`, then a **separate raw** `writeStatusIndex(COL.escalation, done)` runs
*after* the await — with no retry and no verification. Two failure modes:
- **(a)** `saveYes` throws `GatewayPendingError` (durably queued but unconfirmed) → jumps to catch
  *before* line 266; the applied patch (line 259) lacks `escalation:Done`.
- **(b)** the raw line-266 write fails on a blip → falls to the catch else-branch and shows
  **"Save failed — nothing was advanced"** even though the advance already committed.
In both, `escalationIndex` stays `0` (still "escalated"), so after refetch the patient sits in
Chase Clinicals but is **filtered out of the normal chaseFax/chaseParachute due-now queue and
counts** — invisible to the rep working that queue (surfaces only in the escalated sub-view).
**Fix:** fold the escalation-clear into `saveYes`'s durable `WriteTask` list (one ordered
transaction), or set `patch.escalation/escalationIndex = done` *before* the awaits and stop showing
"nothing was advanced" once `saveYes` resolved.

### B4 — The "returned patient" self-heal is dead code (matches a renamed label)
`src/lib/masheke/evaluateReentry.ts:73`
`hasStaleEvaluateEscalation` gates on `p.escalation !== "Escalation Required"` — a **label-text
match**. The board was renamed 2026-07; index-0's text is now **"Manager Escalation Required"**, so
this predicate **always returns false in production**. The self-heal in `useMondayPatients`
(escalation→Done + Next-Action-Date→today) never fires. `sidebarList.ts:25` literally carries the
warning: *"matching 'Escalation Required' here silently dropped everyone."* Every other consumer was
migrated to index matching; this file was missed.
**Consequence:** a patient escalated at Chase/Confirm and moved back to Evaluate MN for re-review
carries the index-0 flag, is treated as escalated everywhere, and is **dropped from the default rep
queue and the active burndown** — exactly the invisibility this module exists to prevent. (The test
still feeds the stale string, so it stays green.)
**Fix:** `if (p.escalationIndex !== ESCALATION_INDEX.required) return false;` and update the test
fixtures to set `escalationIndex`.

### B5 — "Send back to Patient Intake" swallows failed writes, then shows success + wipes the overlay
`src/lib/profile/mondayWrite.ts:259` → `src/pages/ProfilePage.tsx:415`
`sendBackToPatientIntake` `console.warn`s failed data-column writes but does **not** throw — it
still `moveItemToGroup(...)` and resolves. `handleSendBack` then unconditionally
`toast.success(...)` **and `clearOverlay(selected.id)`** (deletes in-memory *and* localStorage
overlay).
**Consequence:** rep fixes a Member ID / insurance on flaky wifi, the column write fails, the
patient still moves to Patient Intake, and the correction is **gone from Monday and from local
state** — silent partial data loss shown as success. (Contrast the *advance* path, which throws on
failures and correctly skips `clearOverlay`.)
**Fix:** gate `clearOverlay`/`toast.success` on write success — or have `sendBackToPatientIntake`
surface the failures list so the caller keeps the overlay and warns "moved but N fields didn't
save — edits kept locally."

---

## 🟠 High (fix this week; systemic write-infra)

### H1 — Lost gateway ack → double write (defeats server idempotency)
`src/lib/shared/verifiedWrite.ts:184`
If the POST /send reaches the gateway (job persisted) but the ack is lost and all 3 retries fail
response-side *while online*, `submitSend` throws a plain `Error`; the catch swallows it and runs
the **full client-side transaction** — writing all data columns and flipping the stage advancer a
second time. The `idempotencyKey` only dedupes gateway-vs-gateway, not gateway-vs-client-fallback.
Even `requireDone` flows (Confirm Receipt, Chase) are exposed because the no-fallback guard only
protects `submitSend`'s *success* return, not its *throw*.
**Consequence:** two uncoordinated transactions for one action → risk of a duplicate downstream
Masheke item / double advance.
**Fix:** on a `submitSend` throw where the request *may* have reached the server, don't fall back —
look up the job by `idempotencyKey` (GET /send/:id) and surface "queued, do not repeat" like
`GatewayPendingError`.

### H2 — Phase-0 snapshot failure silently disables snapshot-diff verification
`src/lib/shared/verifiedWrite.ts:206-209, 243, 253`
If the pre-write snapshot read throws (the exact bad-wifi case), the code continues in "no-snapshot
mode" with `beforeSnapshot = {}`. Then for any data column **without** `expectedText`, `beforeVal`
defaults to `""`, and a stale still-non-empty read-back (`"X" !== ""`) passes verification on
attempt 1 — so the stage advancer flips while a sibling is still stale. Only `expectedText` columns
stay protected. Profile pushes Name/DOB/Member-IDs/dates/notes as bare tasks → all lose the guard.
**Fix:** on snapshot failure, don't degrade silently — retry/abort the snapshot, or route
snapshot-less columns through the `stableReadsThreshold` path instead of accepting any non-empty
read as "changed."

### H3 — Deep-linked Submit Auth patient reads all per-product auth data blank
`src/hooks/samantha/useMondayPatients.ts:150`
The deep-link injection sets `useAuth = activeGroup === "authOutstanding"` — **false** on the
Submit Auth page — so `fetchItemById` uses base `READ_COLUMN_IDS` instead of
`AUTH_READ_COLUMN_IDS`. `AUTH_GROUP_IDS` includes *both* submitAuth and authOutstanding, and the
group fetch hydrates both correctly; only the injection was left out.
**Consequence:** an Oversight `?patientId=` link (or an escalated Submit-Auth patient not in the
group fetch) shows a **blank auth panel** for a patient who actually has auth data, and validation
may re-demand fields already present → risk of a duplicate/incorrect auth submission.
**Fix:** `const useAuth = activeGroup === "authOutstanding" || activeGroup === "submitAuth";`

---

## 🟡 Medium

| # | File:line | Issue |
|---|---|---|
| M1 | `ProfilePage.tsx:237` | Identical Stedi re-run for a blank-Plan-Name payer (Medicaid) shows a **false "Stedi returned no new results"** after 35s even though valid eligibility/cost-share results are present and rendering. Terminal signal requires a *changed* eligibility, which an identical re-run can't produce. |
| M2 | `SendRequestPanel.tsx:324` / `worker/src/index.js:384` | `/send-message` has **no idempotency**. A lost HTTP response (bad wifi) or a 207 partial makes a retry **re-fax/re-email recipients who already received it**. Fails safe on Monday state (stage not advanced) but duplicates external delivery. |
| M3 | `masheke/mondayWrite.ts:359` | Send-Request advance-verify timeout persists a **future Next Action Date** but never flips Sub-Stage → patient hidden in the "Scheduled" folder, out of today's queue, still in Send Request. Honest error toast fires, but doesn't say the patient just left the queue. |
| M4 | `samantha/mondayWrite.ts:513` | A **denied auth** advances to a stage with **no SPA route, page, or count** (`authDenied` route declared in config but absent from `App.tsx` and `useRoleCounts`). Visible to managers via System Management only. |
| M5 | `dvs/useDvsPatients.ts:46` | **Escalated Stage-DVS patients** are counted in `escalatedCounts.dvs` but shown by no page (`DvsPage` has no escalated toggle; every other sidebar drops non-DVS-text). The bar advertises N patients nobody can open. |
| M6 | `verifiedWrite.ts:175` | Non-`requireDone` gateway send returns success (confetti) on a merely **queued/offline-parked** job. Recovery outbox mitigates, but if that browser never reopens, the write is silently lost while UI claimed success. |
| M7 | `ChaseClinicalsPanel.tsx:237` | Chase completion writes the attempt column off the **lagging `mnAttempts` counter**, not the history-derived slot the UI shows; after a specific mid-transaction failure it can overwrite a prior attempt note and reach the 3rd-attempt escalation one attempt late. *(client/direct mode only)* |
| M8 | `samantha/mondayWrite.ts:561` | **DVS auto-trigger columns** (`triggerPumpDvs`/`triggerDvs`) are written as ungated Phase-1 data tasks, not routed through `stageColumnId` — the DVS bot can fire before sibling insurance/member data indexes. |

## ⚪ Low (fast-follow / hygiene)

| # | File:line | Issue |
|---|---|---|
| L1 | `ProfilePage.tsx:216` | Start Stedi for patient A, switch to B → A's settle watcher never fires; A's successful run is reported as a **false "timed out"** at 95s (results did land). |
| L2 | `profile/mondayWrite.ts:257` | (Same class as B5, backward exit) send-back swallows write failures + success toast → rep correction lost on bad wifi. |
| L3 | `oversight/oversightApi.ts:1255` | Oversight referral split is **case-sensitive** while the other 4 split sites are case-insensitive → a re-cased board label makes the manager chart disagree with live queues. |
| L4 | `ProfilePage.tsx:404` | No save-lock during Advance; post-save `setSelectedId` can **yank the rep off the patient they switched to** mid-save (no data corruption). |
| L5 | `evalState.ts:887` | Malfunction "Invalid" writes a phantom **"Malfunction invalid"** dropdown label the board doesn't have → `createLabels` silently creates a duplicate. Set `IP_REQ_LABELS.malfunction.invalid = null`. |
| L6 | `ChaseClinicalsPanel.tsx:266` | "confirmed in Monday" toast fires while doctor-field edits are written **fire-and-forget, unverified** after the guaranteed save. |
| L7 | `oversightApi.ts:1198` | A proposed-stuck (index 2) patient at a sub-stage outside the 4 mapped stages matches no Final Decisions chart and is dropped from rep queues. No current code path produces this, but no catch-all guards it. |
| L8 | `ProposeStuckModal.tsx:61` | ProposeStuck writes the stamped notes reason even when the escalation flip fails; retries **duplicate the stamp** (display still correct). |
| L9 | `benefitsDerive.ts:348` | Auto-escalation note hardcodes **"4-yr window"** for Medicare pump SoS whose real window is now 5 years (change 8a85333). Board-note text only. |
| L10 | `BenefitsPanel.tsx:372` | Medicaid insulin-pump auth prefill (`pump always requires auth`) only fires for serving `"Insulin Pump"`, not `"Insulin Pump + CGM"` → a Medicaid pump can pass validation as no-auth-needed. |
| L11 | `samantha/mondayWrite.ts:949` | Every per-product auth submission column is written **twice per send** (byte-identical duplicated loop) → doubles the write + failure surface. Delete the second loop. |
| L12 | `useRoleCounts.ts:409` | DVS is **excluded** from Benefits/SubmitAuth by stage **text** `"DVS"` but **selected** into /dvs by stage **index 1** — an index-preserving label rename double-counts or drops. (Also: untrimmed text compare vs trimmed elsewhere.) Make the exclusion index-based. |
| L13 | `verifiedWrite.ts:263` | Same-value stable-read heuristic can accept a silently-unindexed *different*-value write (documented tradeoff of omitting `expectedText`). |
| L14 | `useRoleCounts.ts:550` | `updateClinicals` is counted live but emitted by neither baseline generator → OperationsTab shows it "not connected" while its twin `subscription` compares. |

---

## Rejected (verified as NOT bugs)
- Insurance Final Decisions filters — checked: they use index-based escalation detection, not the
  renamed-label class that broke masheke.
- "Save No Auth Needed drops SoS recheck facts" — the entered facts are persisted.
- "Gateway fast path advances snapshot-diff columns unverified" — the server-side /send handles
  ordering; the client-only concern doesn't apply to that path.

---

## What's solid (don't re-litigate)
- `executeWritesWithVerification` 4-phase protocol, and its **throw-don't-advance** on verify
  timeout, are correct.
- The durable idempotent gateway `/send` + `GatewayPendingError` "queued, don't repeat" contract is
  correctly implemented on the success path (the gap is only the *lost-ack throw*, H1).
- Confirm-Receipt / Chase blocking `SaveProgressOverlay` + save-time date computation work.
- The referral split (§5.10) and chase fax/parachute/email split (§5.9) agree across the role page,
  counts, and both baseline generators (only the Oversight *chart* diverges on casing — L3).
- Cross-board date-column hops use date→date columns (no ISO-text mangling found).

---

## Suggested sequencing for the week
1. **Day 1–2 (blockers):** B1 (wire the Evaluate gate), B4 (one-line index fix + test), B5 (gate
   clearOverlay), B3 (fold escalation-clear into the verified transaction), B2 (routing/validity
   reconciliation).
2. **Day 2–3 (systemic):** H1 (no client fallback on ambiguous gateway throw), H2 (snapshot-failure
   handling), H3 (one-line auth-columns fix).
3. **Fast-follow:** M-series (esp. M4 denied-auth queue, M2 send idempotency), then the Low table.

Each blocker is localized; none require re-architecting. The audit found **no** case where the core
verified-write engine itself corrupts data on a healthy connection — the failures are all at the
callers' wiring and the bad-network edges.
