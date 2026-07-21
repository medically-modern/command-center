# Manager Views + Proposed Stuck + DVS — build record (2026-07-21)

Implements [`JOSH_HANDOFF_MANAGER_VIEWS.md`](JOSH_HANDOFF_MANAGER_VIEWS.md) (Phases A+B) and
routes in the DVS stage from [`JOSH_HANDOFF_DVS.md`](JOSH_HANDOFF_DVS.md) (v2, fully
automatic) as a new role. Mockups: `manager-insurance.html`, `manager-medical-evaluation.html`,
`dvs-redesign.html` (received 2026-07-21; the DVS page is built against it). This doc is the
added/removed/uncertain ledger Josh asked for — see the 2026-07-21 follow-up section at the
bottom for the CIN gate, auto-trigger, fake test patients, and the adversarial-review fixes.

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
  the rep's reason and offers **Approve Stuck** (writes the main Stage Advancer
  `color_mm1wyr92` → **Stuck** (index 15), THEN clears the proposal — ordered so a failed
  write never silently returns the patient) and **Return to Queue** (clears the proposal
  only). First-ever action buttons in an Oversight drill-down. (Originally shipped writing
  Advancer 2C like the old StuckModal — changed after checking the live automations; see
  resolved uncertainty #1.)
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

1. ~~**Approve Stuck writes Advancer 2C from ANY stage.**~~ **RESOLVED 2026-07-21** — Josh
   asked "can you check if that's true"; pulled every automation on the Masheke board:
   **zero automations reference Advancer 2C**, so a 2C write would have moved nobody.
   Approve Stuck now writes the **main Stage Advancer `color_mm1wyr92` → Stuck (index
   15)** directly, from any stage, then clears the proposal.
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
7. ~~**`dvs-redesign.html` was not in the uploaded package.**~~ **RESOLVED 2026-07-21** —
   mockup received and committed; the DVS page is rebuilt against it (status banner, CIN
   box, entry-path cards, per-code A4230/A4232 tiles with auth + claim rows, retry-queue
   strip, notes rail, +1d follow-up snooze).
8. **DVS role visibility:** `dvs` is a normal assignable role (bar + route). If it
   should be manager-only like Oversight, say so. The burndown bar shows "not connected"
   until the next baseline snapshot includes the new `dvs` count (self-heals at the next
   9 AM cron / deploy).
9. **Straight-Medicaid pump DVS denied** and the **CGM+Medicaid hybrid** remain
   undecided in the handoff (§ open questions) — the page currently renders whatever the
   bot writes, manual-review path on failure.

---

## 2026-07-21 follow-up — Josh's numbered directives + review fixes

### CIN hard gate (new rule)
A patient only routes to DVS when **Member ID 1 or Member ID 2 is a NY Medicaid CIN:
`XX11111X`** (2 letters · 5 digits · 1 letter, e.g. `KJ51074B`). No CIN → no DVS routing,
even for straight Medicaid — the send falls through to its normal next stage.
`lib/samantha/dvsRouting.ts` `nyMedicaidCin()` (tested); the DVS page shows the matched ID
("DVS runs on this — Medicaid ID … · from Member ID 2") or a red no-valid-ID warning.

### Auto-trigger on landing (Josh: "should automatically flip depending on what we're serving")
Yes — implemented. When a send writes Stage → DVS, the same verified-write transaction also
flips the bot trigger column by serving (`dvsAutoTrigger`): **pump DVSing here → Trigger
Pump DVS** (pump first; supplies chain bot-side after the pump claim pays), **otherwise →
Trigger Supplies DVS**. Both write index 1, the labels today's automate-dvs bots listen to.
When the v2 bot switches to the stage flip itself, delete the trigger task in
`mondayWrite.ts` and `dvsAutoTrigger`.

### Fake test patients (on the live board, Complete group, stage = DVS)
Created so the /dvs UI renders real data without touching any bot trigger, Claims Status,
or IP Auth Result (those fire automations). Both are named `[TEST]` — delete anytime:
- **DVS Test — Supplies Only [TEST]** (item `12593223717`) — straight Medicaid, retry-queue
  state: Retry Count 2, next run 07/22, A4230 claim paid, A4232 claim pended.
- **DVS Test — Managed Dual [TEST]** (item `12593254798`) — Fidelis Medicaid + NY Medicaid
  pump patient, CIN on Member ID 2 (Member ID 1 is deliberately non-CIN).

### Follow-up snooze on /dvs (directive #12)
Same date-only rule as Auth Outstanding: **+1d** button writes Follow Up Date → tomorrow
and hides the patient; a Follow Up section lists snoozed patients until their date arrives,
with an undo. Counted identically in `useRoleCounts` (the dvs count is date-blind today —
the bot owns the queue cadence; the snooze only affects the rep-facing list. If you want
snoozed patients out of the count too, say so and all three counting twins change together).

### Profile Send-Off routing (directive #3) — NOT doable app-side today
The Insurance-board item **does not exist** while the patient sits at Profile Send-Off /
Masheke — it's created by the Masheke→Insurance hop automation. So the app cannot pre-set
Stage = DVS from Profile; the hop automation must either map the status across boards or a
board automation must set it on item-create. Until then, skip patients surface at Benefits
once and the rep's first send routes them to DVS. Status DOES carry through boards only if
the create-item automation copies it — same mechanism as the Stedi date columns (§9 of
CLAUDE.md).

### Adversarial review (wf_96c551f6) — 14 confirmed findings, all fixed 2026-07-21
The big one: **stage-DVS patients never left the Benefits/Submit Auth/Auth Outstanding
queues or counts** (group fetches don't filter by stage; there's no group-move automation
for DVS). Fixed in all four places per the §5.8 contract: samantha `useMondayPatients`
(sidebar/queues), `useRoleCounts` `samActive`, and both baseline `countSamGroup`s now drop
Stage = "DVS" items. Minor fixes: 3 proposed-stuck ChartDefs pointed at the wrong notes
column; dead `dvs-stage` chart entries removed; /dvs list now excludes escalated patients
(matches the count); Final-Decision refetch delayed 12s so Monday's indexing lag can't
resurrect a decided row; ProposeStuckModal writes the reason BEFORE the status flip;
the supplies "Waiting on pump" gate now keys on the pump CLAIM being paid (Claims Status),
not the DVS approval; supplies-only managed duals highlight the "Straight to DVS" path
card; stale comments cleaned; `fetchGroupItems` pagination no longer drops the auth/DVS
columns past item 200 (pre-existing bug).
