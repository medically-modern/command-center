# Auth Outstanding Redesign — build record (2026-07-21)

Tracks [`JOSH_HANDOFF_AUTH_OUTSTANDING.md`](JOSH_HANDOFF_AUTH_OUTSTANDING.md) +
[`auth-outstanding-redesign.html`](auth-outstanding-redesign.html) (the prototype) against
`main`. **The full redesign is BUILT as of 2026-07-21** — this doc is the record of what
landed where, the deliberate deviations, and the few items intentionally left out.

Domain rules: `src/lib/samantha/authOutstandingReview.ts` (+ tests). UI:
`AuthOutstandingPage.tsx` + `components/samantha/AuthOutstandingPanel.tsx`.

## Status by handoff section

| § | Item | Status | Where / notes |
|---|------|--------|---------------|
| 1 | Daily-check workflow, one card per tracked product | ✅ | `trackedCards()`: board label "Submitted" (non-DVS) + partial-saved "No Auth Needed" still in the Skip SoS dropdown (recheck open). |
| 2 | Left "What Was Submitted" recap · right result entry | ✅ | `SubmissionRecap` (method / date / auth ID / call-fax number / Intake ID · Carecentrix). |
| 2 | Card result zone locked to its tallest state | ✅ | CSS-grid overlay: all three result variants render stacked in one grid cell (inactive `visibility:hidden`), so the zone always sizes to the tallest variant at the current width — no JS measurement needed (improves on the prototype's `equalizeHeights()`). |
| 3 | Auth Valid → ID + Start + End + Units required | ✅ | Client gating (`validateAuthReviewForComplete`); columns unchanged. |
| 3 | Denied → optional denial-reason upload | ✅ | Per-card rose drop-zone → Final Clinicals; single file; never gates. |
| 3 | No Auth Needed → derived SoS recheck (facts only; Clear/Not-Clear never shown; 4 yr / 90 / 60-day Medicaid lookbacks) | ✅ | `derivedRecheckSos` (reuses benefitsDerive cutoffs); rep-facing SoS dropdowns REMOVED from this page. Facts land in the sosLastBill / sosUnits / sosNeverBilled columns (additive — never clears other products' Benefits facts); derived value re-computed at send time (ET-anchored) and written through the existing Not Clear / Skip dropdown + lastBillDate machinery. Next Order Date math unchanged. |
| 4 | Save No Auth Needed (per-product, no stage change) | ✅ | `saveNoAuthNeededToMonday` — verified write, empty stage list. The recheck STAYS OPEN across reloads: the card remains tracked while the product sits in the Skip SoS dropdown, and hydration backfills the result from the board label (`effectiveResult`). Legacy patients without a Skip-dropdown entry degrade to pre-redesign behavior (resolve on reload). |
| 5 | ALL uploads → Final Clinicals `file_mm25m8c1`; per-card surfaces; topbar button gone | ✅ | `FinalClinicalsUpload` grew tones ("amber" auth-docs on Call/Fax cards when Valid/NAN; "rose" denial). Topbar "Upload Final Clinicals" removed from this page. |
| 6 | Auth Review Complete = only stage-mover, client + server gating | ✅ | Client: gated button + "Needed before" list (incl. a line for never-submitted Required products). Server: unchanged rules — any Denied → Auth Denied + Escalation Required; all resolved → Complete; partial → stage untouched. A NAN partial save awaiting its recheck now counts as UNRESOLVED server-side too. |
| 6/11 | Manual Escalate button removed (denial-driven only) | ✅ | `EscalateButton` + `EscalationFormModal` no longer render here (still used by Benefits / Submit Auth). Escalation clears to "Done" on a non-denied send unless the hydrated toggle was on. |
| 7 | NOTHING DVS on this page | ✅ | `DvsClaimsVisual`, Trigger Supplies/Pump DVS, "Claims Paid — Mark Supplies Complete" all removed. Matrix shows a gray "DVS Required" pill only. Server guard: a patient whose products are ALL DVS-routed can never reach Complete from this page (`nonDvsEntries` rule in mondayWrite) and the button stays disabled. **The DVS view that inherits this UI does not exist yet.** |
| 8 | Matrix color language | ✅ | Submitted = light blue; Required = amber; DVS gray (darker than Not Serving); resolved gray; Not Serving most faded; no green. E-paces pill gone. |
| 9 | BCBS home-plan banner | ✅ | Reuses `submitAuthRules.authHomePlan`. No payer phone yet (same as Submit Auth — the directory effort is still open). |
| 10 | Demo scaffolding | n/a | Not ported (correct). The Monday Board Output drawer was NOT built — writes are covered by unit tests + the existing console diagnostics instead of a throwaway drawer. |
| 11 | Follow Up modal removed | ✅ | Superseded by "Auth Still Outstanding". |
| 12 | Bucket = Follow Up Date ≤ today (date-only, status ignored) | ✅ | `isSnoozedAuthOutstanding` — blank date counts as DUE (legacy items never fall out). Applied in ALL FOUR counting-contract twins in one commit: `sidebarList.ts`, `useRoleCounts.ts` (`samActive` dateOnlyBucket), `scripts/snapshot-baseline.mjs`, `services/baseline-cron/index.mjs`. Benefits/Submit Auth keep the status rule. |
| 12 | "Auth Still Outstanding" button (one write: date → tomorrow) | ✅ | Patient-view header row, amber, right-aligned. Writes ONLY `date_mm34m2dz`; shows "Cleared — returns …" while snoozed. |
| 12 | Group-by-payer default; days on rows; Days Auth Outstanding column | ✅ | Sidebar defaults to group-by-insurance on this stage (toggle still works); rows + header badge show days outstanding (live compute → column fallback); column `numeric_mm5f5ars` recalced daily by baseline-cron. |

## Deliberate deviations (flag to Brandon)

1. **Reference-notes rail:** the prototype shows notes in a sticky right rail; the build
   keeps the existing `NotesPanel` at the bottom of the panel (same Call Reference Notes
   column, same behavior). The SPA's page shell (navy header + single column) doesn't
   match the prototype's three-column layout, and §12 already establishes the mockup's
   chrome is not the visual spec. Easy to revisit.
2. **Sidebar +1d button** (`PushToTomorrowButton`, shared across the three Samantha
   stages) still writes Follow Up STATUS + date. On Auth Outstanding the status is now
   ignored by the bucket, so the button still works — it just also sets a status the
   stage no longer reads. Left alone to avoid changing Benefits/Submit Auth behavior.
3. **Old data-shape note:** hydrated cards whose auth result was recorded before this
   build (label already Auth Valid / Denied) show as resolved-gray in the matrix and get
   no card — matching "no action on this view". Only "Submitted" (and recheck-pending
   NAN) products get cards.

## Still open (next phases)

- **The dedicated DVS view** — E-paces tracker, DVS/Claims chips, "Mark Supplies Auth
  Valid" flow. Removed from Auth Outstanding per §7; nothing renders them now, so build
  the DVS view before Medicaid-supplies patients need day-to-day handling. (The
  underlying columns and the mondayWrite Trigger-DVS plumbing are untouched.)
- **Payer phone directory** for the home-plan banner (Janelle/Sam effort, §9).
- **Auto-escalate at N days** — now buildable as a native Monday automation on
  "Days Auth Outstanding" (`numeric_mm5f5ars`) once ops picks a threshold.
