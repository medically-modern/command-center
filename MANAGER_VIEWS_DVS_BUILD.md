# Manager Views + Proposed Stuck + DVS — build record (2026-07-21)

Implements [`JOSH_HANDOFF_MANAGER_VIEWS.md`](JOSH_HANDOFF_MANAGER_VIEWS.md) (Phases A+B) and
routes in the DVS stage from [`JOSH_HANDOFF_DVS.md`](JOSH_HANDOFF_DVS.md) (v2, fully
automatic) as a new role. Mockups: `manager-insurance.html`, `manager-medical-evaluation.html`
(the `dvs-redesign.html` mockup was referenced in Brandon's package but not received — see
Uncertainties). This doc is the added/removed/uncertain ledger Josh asked for.

## New Monday board state (created live, 2026-07-21)

| Board | Column | ID | Notes |
|---|---|---|---|
| Medical Evaluation `18406060017` | **Proposed Stuck** (status) | `color_mm5f37ve` | Single label "Proposed Stuck" = **index 1**. Deliberately NOT an Advancer 2C / Stage Advancer label — proposing fires no automation. |
| Medical Evaluation `18406060017` | **Proposed Stuck Reason** (text) | `text_mm5frng6` | Rep's reason, shown in the Final Decisions drill-down; kept after the decision as audit trail. |
| Insurance `18410601299` | Stage Advancer "**DVS**" label | index **1** on `color_mm1ws96t` | Already existed (Brandon's note was right) — verified live. No column created. |

## ADDED

**Pipeline Oversight — manager views (Phase A).** Medical Evaluation and Insurance now
share the 3-column scheme: **Processor Overview** (gray) / **Manager as Processor**
(amber) / **Final Decisions** (rose), rows aligned via the new `ChartDef.rowOf` field.
- ME column 2: the old Attempt-4+ and 3rd+-Round columns are **merged** into one stacked
  chart per stage (`StackedStageChart`) — amber = Attempt 4+, red = 3rd+ round, legend
  pills, deduped union count. **Dedup rule: 3rd+ wins** (a patient matching both counts
  once, in red). Drill-down tags each row with a synthetic "Escalation Type" pill.
- ME column 3: **Proposed Stuck** — one chart per stage; drill-down shows Days in Stage +
  the rep's reason and offers **Approve Stuck** (writes Advancer 2C = Stuck exactly like
  the old StuckModal, THEN clears the proposal — ordered so a failed write never silently
  returns the patient) and **Return to Queue** (clears the proposal only). First-ever
  action buttons in an Oversight drill-down.
- Insurance columns 2/3: **DVS — Retry Queue** (Submit Auth row, PROVISIONAL — see
  Uncertainties) and **Benefits** check-failed (Benefits row: still at Benefits/SoS +
  Escalation Required + Active/Network "Stuck" or DME "Partial / No"). Display-only per
  the handoff. Column 1 was already live (Benefits → Submit Auth → Auth Outstanding →
  Auth Denial, the latter catching DVS manual reviews automatically).
- ME active + escalation charts now **exclude Proposed Stuck patients** (they moved to
  column 3).

**Propose Stuck flow (Phase B).** `ProposeStuckModal` (reason required) on ALL FOUR
Masheke stage pages — Evaluate, Send Request, Confirm Receipt, Chase Clinicals — next to
Reset in the header. Proposing removes the patient from every rep queue immediately
(masheke `useMondayPatients` filter) and from the role counts (`useRoleCounts` + both
baseline generators — §5.8 counting contract, all changed together).

**DVS role + page.** `dvs` in ROLES (`/dvs`, lazyWithReload route), read-only monitor
per the v2 handoff: automation status banner, entry-path cards (Straight to DVS / via
payer rail), DVS Status by Product matrix (light blue Required → mint Approved; pump
"Auth Valid · via payer"), per-run step chips, retry-queue strip, and **Re-run** buttons
on the manual-review path (they flip the existing Trigger DVS / Trigger Pump DVS
columns the current bots listen to). Reads the COARSE columns that exist today
(Supplies/Pump DVS status, Claims Status, Retry Count `numeric_mm27nexq`) — per-code
detail is blocked on the §10 column contract.

**DVS routing (`lib/samantha/dvsRouting.ts`, tested).** The stage write IS the bot
trigger, so the app's sends now route:
- Benefits send: every served product bills straight Medicaid (or primary = "Medicaid")
  → **stage → DVS** (skips Submit Auth + Auth Outstanding). Failed universal checks
  still win (escalation path unchanged).
- Submit Auth send: all-DVS patient → **DVS** instead of Auth Outstanding.
- Auth Outstanding send: rail finished + patient has Medicaid-routed supplies →
  **DVS** instead of Complete; an all-DVS patient stranded at AO can now be sent to DVS
  (supersedes yesterday's "never advances" guard — that predated the DVS stage).

**Role counts.** `dvs` counted board-wide by Stage Advancer index 1 (no dedicated
group) in `useRoleCounts` + both baseline generators.

## REMOVED

- **`StuckModal.tsx` deleted.** It was already dead — the Stuck button on Confirm
  Receipt was commented out, so no rep could mark Stuck from the app. Its exact write
  (Advancer 2C = index 2) lives on as the manager's **Approve Stuck** action.
  Net effect: **direct rep-side Stuck is gone for good; stuck is now propose→approve.**
- ME Oversight's separate "Escalations · Attempt 4+" and "Escalations · 3rd+ Round"
  columns (merged into Manager as Processor; the underlying chart filters remain as the
  stacked series' data sources, and their drill-downs are reachable via the merged chart).
- Auth Outstanding's "all-DVS patients never advance" server guard (replaced by → DVS).

Nothing else was removed; no Monday columns or labels were deleted.

## UNCERTAINTIES — for Josh to walk through

1. **Approve Stuck writes Advancer 2C from ANY stage.** The handoff says "write what
   StuckModal writes today" (2C = Stuck), and that's implemented. But 2C is the *Confirm
   Receipt* advancer — if the board's 2C→Stuck automation only handles Confirm-Receipt
   patients, approving an Evaluate/Send-Request/Chase proposal may not move the main
   Stage Advancer to Stuck. **Check the automation; if needed, Approve should write the
   main Stage Advancer (`color_mm1wyr92` index 15 "Stuck") instead.** One-line change.
2. **DVS Retry Queue chart is provisional.** Filter = stage DVS + Retry Count ≥ 1, and
   the x-axis is **days in stage, not days in the retry queue** — the bot writes no
   queue-entered date yet (DVS handoff §10). Same for the "cleared via queue" trail
   (§6) and per-code auth/claim/paid-amount detail on the DVS page: all blocked on the
   §10 column contract. **The DVS page reads today's coarse columns and is structured to
   absorb the per-code columns when you define them — send the list and I'll wire it.**
3. **Skip-patient entry is only half-covered.** Supplies-only-Medicaid patients get
   stage → DVS when a rep sends them from Benefits — but the handoff wants them routed
   from **Profile Send-Off**, never touching the Insurance rail pages at all. That's
   hop-automation / Profile-side work on the Masheke→Insurance create automation
   (item arrives with stage DVS). Until then they appear at Benefits first.
4. **No group/automation for the DVS stage on Monday.** Stage = DVS items stay in
   whatever group they were in (queries are stage-based so the app doesn't care). If you
   want a DVS group + move automation for board hygiene, nothing app-side changes.
5. **Re-run buttons use the OLD trigger columns** (Trigger DVS / Trigger Pump DVS) —
   correct for the current bots. The v2 handoff says stage-flip becomes the only
   trigger; when the bot rework lands, re-run semantics may change (§4).
6. **Insurance manager view: no col-2/col-3 Auth Denial charts.** All three would show
   the same population today (no column distinguishes "manager working" vs "awaiting
   decision") — shipped col 1 only, per the earlier gap-analysis recommendation. Needs a
   status definition with Janelle.
7. **`dvs-redesign.html` was not in the uploaded package** (the README references it).
   The DVS page was built from the handoff text; drop the mockup in and I'll reconcile.
8. **DVS role visibility:** `dvs` is a normal assignable role (bar + route). If it
   should be manager-only like Oversight, say so. The burndown bar shows "not connected"
   until the next baseline snapshot includes the new `dvs` count (self-heals at the next
   9 AM cron / deploy).
9. **Straight-Medicaid pump DVS denied** and the **CGM+Medicaid hybrid** remain
   undecided in the handoff (§ open questions) — the page currently renders whatever the
   bot writes, manual-review path on failure.
