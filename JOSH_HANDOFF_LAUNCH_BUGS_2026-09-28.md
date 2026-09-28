# Launch bugs handoff — current issues only (for Claude Code)

**Date:** 2026-09-28 (night before launch)  
**Audience:** Claude Code  
**Repo:** `command-center-test` (already synced to prod)  
**Scope:** Accuracy / movement bugs found in a pre-launch review guided by the last few days’ fixes (call direction, method flips, stale sends, cash-pay advance wiring, pendingAdvance).  

**This list is OPEN bugs only.** Do not re-investigate items in [Out of scope](#out-of-scope-already-fixed).

---

## Context (what class of bug)

Josh’s bar: situations like *“inbound call showed as We called”* — the app shows wrong information, or moves a patient the wrong way, under a real rep action. Prefer concrete Situation → What’s wrong → Where → Why.

---

## Critical

### 1. Pending-advance hide follows the item into the *next* same-board stage (15 min)

**Situation:** Rep finishes Evaluate and the patient should appear in Send Request. Same pattern: Benefits → Submit Auth, Welcome Call → Final Confirm, Info Collection → Profile Clean-Up. Same Monday **item id**, new stage/group.

**What’s wrong:** Patient is missing from the next queue (and Care Coord columns that read that board) for up to **15 minutes**. Deep-link / Open tool also refuses to inject a claimed id. Reps “fix” missing patients by clearing advancers → duplicate downstream items (§9).

**Where:**
- `src/lib/shared/pendingAdvance.ts` — `sharedPendingAdvances`, `PENDING_ADVANCE_TTL_MS = 900_000`
- Every role `useMondayPatients` — `applyPendingAdvances(...)` + deep-link skip when `pendingAdvanceRef.current.has(id)`
- `src/pages/CareCoordinatorPage.tsx` — applies the same map to intake / welcome lists
- Callers of `markAdvanced(id)` after a successful advance (e.g. `EvaluatePage` → `onAdvanced`, Insurance pages when `stageLeavesQueue`, Welcome Call send)

**Why we think this:** Sep 25 moved claims from per-hook refs (dropped on unmount, 2 min TTL) into one **module-global** map keyed only by item id. Consecutive stages on one board share that id, so the hide meant for “leave this queue” also hides “arrive in next queue.”

**Fix direction:** Scope the claim by queue/stage (or clear it when the patient’s stage/group no longer matches the page that marked it). Do **not** go back to a 2‑minute TTL alone — Monday index lag was measured ~10 minutes (Keith Dye).

**Verify:** Evaluate → advance → open `/send-request` immediately — patient must be listed. Repeat Benefits → `/submit-auth`, WC → `/final-confirm`, Info Collection → Clean-Up / Care Coord.

---

## High

### 2. Cash Pay picked by mistake, then corrected — still skips to Welcome Call

**Situation:** On Unverified / Profile Clean-Up, rep sets General Insurance = Cash Pay (Primary mirrors to Cash Pay). Then changes General back to a real payer (e.g. Aetna).

**What’s wrong:** Patient still treated as cash pay: section 1 (Primary / verified insurance) stays hidden, Stedi stays off, Advance still writes **Advance to Welcome Call** (label id 6) → insured patient skips MN / Insurance.

**Where:**
- `src/lib/shared/cashPay.ts` — `isCashPayPatient` = General **OR** Primary is Cash Pay
- `src/lib/profile/cashPayIntake.ts` — `primaryInsuranceForGeneral` / `cashPayMirrorEdit` only mirror **into** Cash Pay, never un-mirror
- `src/pages/UnverifiedReferralsPage.tsx` — `verifiedInsuranceStepApplies` / `benefitCheckApplies` hide section 1 + Stedi when `isCashPayPatient`
- `advanceWriteForLive` — still Welcome Call while either column is Cash Pay

**Why we think this:** 32de3c0f correctly wired cash-pay advance to Welcome Call. The correction path was never built: Primary stays Cash Pay and keeps winning the OR.

**Fix direction:** When General leaves Cash Pay, clear or require re-pick of Primary; and/or treat cash pay only when General is Cash Pay (decide with Josh — Primary is what travels downstream).

**Verify:** Cash Pay → change General to Aetna on `/unverified-referrals` — Primary editable, Advance says MN. Happy-path Cash Pay advance still → Welcome Call.

---

### 3. “Open &lt;tool&gt;” on a Completed record — most tools are still writable

**Situation:** Patient screen on a **Completed** ME / Insurance / WC item. Open Send Request, Submit Auth, Confirm Receipt, Doctor Appointments, or Final Confirm (UI implies review mode via `?completedStage=`).

**What’s wrong:** Only Evaluate, Benefits, Welcome Call, and Profile call `useCompletedStageReview`. Other tool pages ignore `completedStage` → Mark Complete / Auth Complete / Receipt Yes / etc. can flip a finished item’s Stage Advancer and re-fire Monday automations (or re-fax).

**Where:**
- `src/lib/patient/patientScreen.ts` — Open links add `?completedStage=`
- `useCompletedStageReview` used only in: `EvaluatePage`, `ChaseBenefitsPage`, `WelcomeCallPage`, `ProfilePage`
- **Missing gate:** `SendRequestPage`, `ConfirmReceiptPage`, `SubmitAuthPage`, `AuthOutstandingPage`, `DoctorAppointmentsPage`, `FinalConfirmPage` (and related panels’ advance actions)

**Why we think this:** Same incomplete gate as intake Completed deep-link (known §10). Patient-screen Open was given the query param; most destinations never read it.

**Fix direction:** Wire `useCompletedStageReview` / `reviewMode` on every stage page that can advance or trigger automations; disable those actions when set.

**Verify:** Open Send Request on a Completed ME item — stage / send actions must be dead.

---

### 4. Inbound ringing → click Call elsewhere → inbound lost to voicemail

**Situation:** Softphone inbound ring. Before Answer, rep hits Call on another patient (patient screen / dial dialog).

**What’s wrong:** Outbound INVITE starts. Ringtone stops. Answer then errors “Finish your current call…”. Inbound goes to voicemail. Shared company line.

**Where:** `src/lib/softphone/softphone.ts` — `doDial` only checks `this.active` (~848); ringing sessions live in `this.rings`. `doAnswer` already blocks a second call when `active` is set (~813).

**Why we think this:** Answer-path guard exists; dial-path never consults `rings`.

**Fix direction:** Refuse `doDial` while any non-ignored ring exists (or auto-decline / require dismiss first).

**Verify:** Let one inbound ring → Call another number without answering — must refuse; inbound still answerable.

---

### 5. Browser pickup / some surfaces still say “We called”

**Situation:** Patient rings in; rep answers in Command Center softphone. Later: Care Coord “We called · They called” counts, or Communications **fallback** Calls list (when Inbox is off / unavailable).

**What’s wrong:** Inbox timeline was fixed (`markBrowserPickups` / inversion). **contact-totals** and **CallHistoryList** (live RC via `toPatientCall`) still treat the pickup as outbound. Docs call this intentional-unfinished (`docs/claude/5.49`, `5.53`).

**Where:**
- Fixed path: `services/monday-gateway/commsInboxRules.mjs` — `markBrowserPickups` / `markInvertedInbound`
- Still wrong: `services/monday-gateway/contactTotals.mjs`, `src/components/shared/CallHistoryList.tsx`, `src/lib/callHistory/callHistory.ts` (`toPatientCall`)

**Related:** Live CallHistoryList also has **no** `isUnfinished` guard (archive does in `callArchiveRules.isUnfinished`). Opening fallback Calls mid-call can flash wrong direction — same family as the 2026-09-27 archive freeze, different surface.

**Fix direction:** Drive counts/labels from archive + pickup/inversion rules where possible; or document as known until redesign. At minimum don’t trust mid-call RC rows in the fallback UI.

**Verify:** Answer inbound in-browser → compare Inbox timeline vs Care Coord counts vs Comms fallback Calls.

---

## Medium

### 6. Numberless “Log attempt” shows Hang up for an unrelated live call

**Situation:** Care Coord Log attempt on a card with **no phone**, while another call is live.

**What’s wrong:** `liveCall.phone.endsWith(patientLast10)` — empty patient digits → `endsWith("")` is always true → Hang up button appears and will hang up the other call.

**Where:** `src/components/careCoordinator/CallPatientDialog.tsx` (~109, Hang up ~188).

**Fix direction:** Require non-empty patient phone before treating a call as “live for this dialog.”

---

### 7. Header search: retype + Enter can open the previous patient

**Situation:** Search “Smith” (results showing). Type “Jones” and press Enter before the new search finishes.

**What’s wrong:** Query change aborts the in-flight request but **does not clear** old `results`. Enter navigates the highlighted old row → wrong patient.

**Where:** `src/hooks/systemMgmt/useLiveSearch.ts` (no clear on retype); `src/components/shell/GlobalSearch.tsx` Enter uses current `rows`.

**Fix direction:** Clear results (and highlight) as soon as the trimmed query changes; ignore Enter while `searching` or while `searchedQuery !== query`.

---

### 8. `comms: false` still Call / Text / resolve on the patient screen

**Situation:** Access ability Patient communication off (e.g. Katie). Communications tab gated. User opens a patient from search.

**What’s wrong:** Ability hint says they cannot start a message. `PatientCommsColumn` still exposes Call / Text / resolve. Only the `/comms` (and similar) route is ability-gated.

**Where:** `src/lib/shell/abilities.ts` (`ABILITY_HINT.comms`); `src/components/patient/PatientCommsColumn.tsx`; `src/App.tsx` `AbilityGate ability="comms"`.

**Fix direction:** Gate Call/Text/resolve on `comms` the same way as the tab — if that’s the intended policy.

---

### 9. Click Call while already on a call → phantom dial attribution

**Situation:** Live call up. Click Call again (patient screen or `DialPatientDialog`).

**What’s wrong:** `reportDial` runs **before** dial; dial no-ops (“finish current call”). Inbox still gets a `comms_dials` row → can label a nearby outbound as that rep and cause `dialedBy` to **skip** `markInvertedInbound` / `markBrowserPickups` repair.

**Where:** `PatientCommsColumn.dialNumber`, `DialPatientDialog` open effect. Contrast: `CommunicationsView.dial` returns early if `call` is set.

**Fix direction:** Same guard as CommunicationsView — no `reportDial` unless dial will proceed.

---

### 10. Final Confirm Split Order — unverified parallel writes race create-item automation

**Situation:** Split mixed serving into Supplies + Sensors.

**What’s wrong:** After `duplicateItem`, Split flag + Stage Advancer (+ date) write via `Promise.all` with **no** `executeWritesWithVerification`. Create-item automation can reset advancer if it runs before Split is indexed. Failures are best-effort / `console.warn`. Duplicate can sit off Review Profile.

**Where:** `src/pages/FinalConfirmPage.tsx` — `handleSplit` (~277–284).

**Fix direction:** Verified write with Split (and/or advancer) ordered like other stage writes; don’t report success until read-back.

---

### 11. Patient-screen stage embed can show a stale board snapshot for the session

**Situation:** Manager opens Evaluate/Chase/etc embed on patient screen, leaves, board updates, re-opens same tool in the same session.

**What’s wrong:** `useStageRecord` on cache hit sets state and **returns without re-reading Monday**. Embed is `inert` (can’t write) but the audit view can be a plausible wrong chart.

**Where:** `src/hooks/patient/useStageRecord.ts` (`if (hit) { setRecord(hit); return; }`).

**Fix direction:** Same pattern as `useSubscriptionRecord` — paint cache, then always re-read on open; don’t cache forever without refresh.

---

### 12. Completed intake deep-link still offers Advance (known §10)

**Situation:** `/unverified-referrals?patientId=` on an item already in Completed.

**What’s wrong:** No `useCompletedStageReview` on that page. Advance / move-to-Clean-Up still look live. Clean-Up path can leave stale Move to Onboarding (Betty Dillingham / Eddie Quintero class). Noop refuse helps on second MN advance but button still offered.

**Where:** `src/pages/UnverifiedReferralsPage.tsx`; `docs/claude/10-known-risks.md`.

**Fix direction:** Same completed-stage gate as other intake-family pages.

---

### 13. Some advancers lack `expectedText` — false green + 15m hide

**Situation:** Re-send / Mark Complete when the Stage Advancer already holds the target value (Welcome Call, Insurance, Send Request Mark Complete).

**What’s wrong:** Without `expectedText`, a no-op status write can look successful; combined with `markAdvanced`, patient disappears for 15 minutes while nothing moved.

**Where:** Profile/Evaluate paths often carry `expectedText`; gaps called out on Welcome Call / Insurance / `SendRequestPanel.handleMarkComplete` advancer tasks. Cross-check against `lib/shared/advancerNoop.ts` / verifiedWrite Phase 2.

**Fix direction:** Add `expectedText` (and refuse) on every advancer write the way Profile cash-pay / MN writers do.

---

### 14. Profile Clean-Up advance: group move fails → “press again” is refused

**Situation:** Info Collection → Advance to Clean-Up; Intake Sub-Stage writes, then `moveItemToGroup` fails.

**What’s wrong:** Error says press Advance again; second press refused because sub-stage already reads Profile Clean-Up. Patient stuck in Info Collection group with Clean-Up sub-stage.

**Where:** `src/lib/profile/unverifiedWrite.ts` — `advanceToProfileCleanUp` (sub-stage then move).

**Fix direction:** Don’t advance sub-stage until move succeeds, or clear/retry move without requiring a no-op sub-stage rewrite.

---

## Smoke-test order (launch morning)

1. **#1** Evaluate → `/send-request` immediately (and other same-board hand-offs)  
2. **#2** Cash Pay → correct General back to real payer  
3. **#3** Open Send Request on a Completed ME item  
4. **#4** Dial while inbound ringing  
5. **#5** Browser pickup: Inbox vs Care Coord counts vs Comms fallback Calls  
6. Cash Pay happy path still → Welcome Call  
7. **#6–#10** as time allows  

---

## Out of scope (already fixed — do not re-litigate)

- Call archive freezing mid-call / never updating `direction` (`isUnfinished` + upsert `direction = EXCLUDED.direction`) — **archive path fixed**; residual is other surfaces (#5).  
- Subscription send flipping Email/Dashboard → Fax (`faxParachute.ts`).  
- Subscription patient-screen send using stale module cache (`readFresh`).  
- Reset writing blanks into overlay (`discardEdits`).  
- Softphone dial/hang-up infinite “Setting up…” / “Hanging up…” deadlines.  
- Cash-pay advance writers still hardcoding Advance to MN (wiring fixed; **correction path** is #2).  
- Viewing-as Open doors ignoring borrowed user’s roles (`displayAccess`).  

---

## Notes for Claude Code

- Prefer **situation repro + failing test** over drive-by refactors.  
- Keep-in-agreement traps: Chase Fax vs Email/Parachute/Dashboard lists; pendingAdvance behavior across all queue hooks + Care Coord; cash-pay rules on both intake pages.  
- Do **not** run Sync from Test Repo.  
- Typecheck: `npx tsc -b --force` (never `tsc --noEmit`).  
