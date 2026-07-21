# Auth Outstanding Redesign — gap analysis vs. main (2026-07-21)

Compares [`JOSH_HANDOFF_AUTH_OUTSTANDING.md`](JOSH_HANDOFF_AUTH_OUTSTANDING.md) +
[`auth-outstanding-redesign.html`](auth-outstanding-redesign.html) (the prototype) against
what is on `main` today. Status per handoff section: ✅ built · 🟡 partial · ❌ not built
(remaining redesign scope). The live page is still the OLD layout — what shipped so far is
the **backend plumbing** (new column, partial save, daily-bucket groundwork), not the UI.

## Shipped on main today (2026-07-21)

- **"Days Auth Outstanding" board column** `numeric_mm5f5ars` (Insurance board), created
  live and hand-seeded for all 22 dated items in the Auth Outstanding group.
  `baseline-cron` recalcs it daily after the 9 AM ET baseline (idempotent
  `today − earliest Auth Submission Date`, write-only-on-change; `SKIP_DAYS_RECALC=1`
  disables). Monday has **no native "increment daily" automation** — that's why a cron
  owns it. Frontend twin: `src/lib/samantha/authOutstandingDays.ts` (live compute from
  submission dates, column fallback — counting contract with the cron).
- **"N days outstanding" badge** on the Auth Outstanding page header + sidebar rows
  (amber, red ≥ 14 days; old Days-Since-Stage label kept as fallback).
- **Per-product partial save** `saveNoAuthNeededToMonday` + the **Save No Auth Needed**
  button on the product card: writes ONE product's result → "No Auth Needed" and wipes
  its Auth ID/Start/End/Units via the verified-write protocol with an **empty stage
  list** — Stage Advancer/Escalation untouched, no automation fires, patient stays in
  Auth Outstanding.
- Docs: `monday-integration-spec.md` (column + partial-save semantics), CLAUDE.md §5.8
  (cron's second job).
- Earlier prerequisite already on main: Submit Auth stamps **Follow Up Date = same-day**
  on submission (`mondayWrite.ts` submitAuth branch) — the §12 bucket feeder.

## Gap table (by handoff section)

| § | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Partial saves as a first-class daily workflow | 🟡 | The No-Auth-Needed partial save exists. The page itself is still the old one-shot layout; "check each patient daily" framing (one step, result cards) is redesign UI scope. |
| 2 | Card layout: left "What Was Submitted" recap · right result entry | 🟡 | Old panel already splits read-only Submit Auth info vs. entry fields, but not in the redesign's card design. Phone/Fax number + Intake ID display exist; styling/structure ❌. |
| 2 | Card height locked to tallest state (`equalizeHeights()`) | ❌ | Prototype-only. Runtime measurement per card/viewport — port with the UI rebuild. |
| 3 | Auth Valid → require ID + Start + End + Units, write per-product columns | 🟡 | Fields + columns (incl. Units `numeric_mm2w*`) exist and write on send. **Required-ness is not enforced** — see §6 gating gap. |
| 3 | Denied → optional denial-reason upload → Final Clinicals | ❌ | No per-card upload surface. Escalation on denial ✅ (server rule, unchanged). |
| 3 | No Auth Needed → wipe auth fields | ✅ | Both in the full send and the new partial save. |
| 3 | SoS recheck = **derived** (Last Bill Date + Units OR No Billing History; Clear/Not-Clear never shown; 4 yr pump/monitor, 90/60-day others) | ❌ | The old rep-facing Clear/Not-Clear/Skip dropdowns are still on this page. The derived model + lookback math already exist for Benefits (`benefitsDerive.ts`) — reuse when rebuilding. Next Order Date math ✅ (existing). |
| 4 | Save No Auth Needed (no stage change) | ✅ | Shipped. **Known divergence:** handoff wants the recheck to STAY OPEN after the save. Today a fresh reload hydrates "No Auth Needed" → resolved (`AUTH_RESULT_TEXT_MAP` maps it to auth "not-required", sos "clear"), so the saved product leaves the entry list. The redesign build must keep label="No Auth Needed" + incomplete-recheck cards visible (tracked filter change) — flagged in `monday-integration-spec.md`. |
| 5 | ALL uploads → Final Clinicals `file_mm25m8c1` | 🟡 | Column is already the target of the existing topbar `FinalClinicalsUpload`. The redesign's per-card surfaces (auth-docs drag-drop on Call/Fax submissions when Valid/NAN; denial upload on Denied) ❌; topbar button removal ❌ (it must go when the per-card surfaces land). |
| 6 | "Auth Review Complete" as the only stage-mover, client+server gating | 🟡 | Server rules ✅ and identical (any denied → Auth Denied + Escalation Required; all resolved → Complete; partial → stage untouched — `mondayWrite.ts` authOutstanding branch). **Client-side gating ❌**: today's Send to Monday button never disables; the prototype's `validateForSubmit()` "Needed before" list is not built. |
| 6 | Manual Escalate button removed (denial-driven only) | ❌ | `EscalateButton` + `EscalationFormModal` still render on the page. |
| 7 | NOTHING DVS on this view | ❌ | `DvsClaimsVisual`, Trigger Supplies/Pump DVS buttons, and "Claims Paid — Mark Supplies Complete" still render. They move to the future dedicated DVS view; matrix keeps only a gray "DVS Required" pill. All-DVS patients should see the empty state and never advance from this page. |
| 8 | Matrix color semantics (Submitted = light blue; resolved/DVS = gray; Required = amber; no green) | 🟡 | Matrix exists, read-only from Monday ✅, but with the old colors (Submitted = emerald, No Auth Needed = green) and the "E-paces DVS" pill the redesign drops. |
| 9 | BCBS home-plan banner | ❌ | Built on Submit Auth, not on this page. `COL.homePlan` (`dropdown_mm5ex8wx`) is already read — the banner render + payer-phone lookup need porting. |
| 10 | Demo scaffolding (serving/insurance dropdowns, Monday Output drawer, scenario bar) | n/a | Prototype-only; strip on build. The "Auth Review Complete + Needed-before card survives the drawer" note applies to the real build. |
| 11 | Follow Up modal removed, superseded by "Auth Still Outstanding" | ❌ | Modal still present. See §12. |
| 12 | Bucket filter: list = Follow Up Date (`date_mm34m2dz`) **≤ today** | ❌ | Today's sidebar shows ALL non-snoozed patients; snoozing still requires the Follow Up STATUS label (`isSnoozedFollowUp`). The redesign inverts this into a pure date bucket (no status). Feeder ✅ (Submit Auth stamps same-day). Counting contract alert: changing the bucket rule touches `sidebarList.ts`, `useRoleCounts.ts`, `snapshot-baseline.mjs`, `baseline-cron` (§5.8). |
| 12 | "Auth Still Outstanding" button — ONE write: Follow Up Date → tomorrow (no status, no stage) | 🟡 | Closest existing: the sidebar "+1d" `PushToTomorrowButton`, which writes date=tomorrow **and the Follow Up status** — different semantics (status-based snooze). The redesign's button lives in the patient header and writes the date only. |
| 12 | Group-by-payer as the default sidebar mode for this stage | 🟡 | Group-by-insurance exists as a manual toggle; not default. |
| 12 | Days outstanding on rows + header, real board column | ✅ | Shipped (column + cron + badge + sidebar rows). Future automation ("auto-escalate at N days") is now buildable natively in Monday: "When Days Auth Outstanding changes, and only if > 14 → set Escalation". |
| — | Straight-Medicaid patients | ✅ answered | They do NOT hit this stage (Josh, 2026-07-21). Shared assumption with Submit Auth / DVS-view design. |
| — | Reference-notes rail (sticky right column) | ❌ | Current page keeps `NotesPanel` at the bottom (same Call Reference Notes column ✅). Layout is redesign scope. |
| — | HCPC modifier chips on result cards | ❌ | Prototype shows Submit-Auth's modifier tables on each card (useful when calling the payer). Port with the UI rebuild. |

## Suggested build order for the remaining scope

1. **Page rebuild behind the same route** — new card layout (§2), matrix recolor (§8),
   DVS removal (§7), Escalate/Follow-Up-modal removal (§6/§11), notes rail. Pure UI.
2. **Derived SoS recheck** (§3) — reuse `benefitsDerive.ts`; keep the partial-save
   visibility fix (§4 divergence) in the tracked filter.
3. **Client-side gating + "Needed before" list** (§6).
4. **Per-card uploads** (§5) + retire the topbar button.
5. **Daily bucket flip** (§12) — date-only rule + "Auth Still Outstanding" header button;
   update ALL counting-contract twins in the same commit.
6. **BCBS banner** (§9) — port from Submit Auth.
