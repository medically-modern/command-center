# Pipeline Oversight — how patients enter and leave every bar chart

Current as of 2026-07-27. Generated from the live rules in
`src/lib/oversight/oversightApi.ts` (`CHART_FILTERS`, `BOARD_GROUPS`,
`OVERSIGHT_SECTIONS`), not from memory — if you change a filter there, update
this file in the same commit.

Reached at `/system-mgmt?tab=oversight`.

---

## 0. Rules that apply to EVERY chart

These come first because most "why isn't this patient showing?" questions end here.

| # | Rule |
|---|---|
| 0.1 | **Nothing is stored.** Every chart is computed live from Monday on each fetch. There is no app-side state that can go stale or need repairing — if a chart is wrong, a Monday column is wrong. |
| 0.2 | **The group gate.** Only items inside a board's *fetched groups* are loaded at all (`BOARD_GROUPS`). An item in Completed, Stuck, or a board's Escalations group is invisible to every chart, whatever its columns say. |
| 0.3 | **The filter gate.** Within those groups, each chart applies its own rule (§1–§4). A patient can match several charts at once and will appear in all of them. |
| 0.4 | **Refresh cadence.** Fetched on open, then every 60s. The header shows "Syncing with Monday…" whenever a fetch is running, including background polls. Cached data paints immediately on revisit while the refetch runs. |
| 0.5 | **Day buckets** come from *Days Since Stage Started* (`color_mm1wwm05`) on Medical Evaluation / Insurance / Welcome Call, and from *Intake Date* on Profile Send Off. The Insurance **manager columns** instead use **reason buckets** (§3) — one bar per reason, a patient can be in several. |
| 0.6 | **Blank day bucket ⇒ no bar.** A patient with an empty Days column counts in the chart's total (top-right number) but renders in **no** bar. This is why bar counts can add up to less than the total. They still appear in the drill-down. (Reason-bucketed charts have the mirror case: a patient matching several reasons is in several bars, so bars can also sum to MORE than the total.) |
| 0.7 | **Stage moves are Monday's job, not the app's.** The app writes the Stage Advancer; a Monday automation moves the item to the next group/board. So "leaves the chart" almost always means "the Stage Advancer changed, and an automation then moved it". |

---

## 1. Intake — Profile Send Off (board `18406352652`, group `1. Intake` `group_mm1xf2jb`)

Split by two columns: Referral Type `color_mm1wm4n4`, Referral Source `color_mm1w5wxr`.

| Chart | Arrives when | Leaves when | Comes back when |
|---|---|---|---|
| **Profile Send Off — Verified Referrals** | In `1. Intake` AND Type ≠ `Patient` AND Source ≠ `CareCentrix` | Advance to MN (automation creates the Masheke item, moves to Completed), or Send back to Patient Intake (moves to `group_mm4vhqff`) | Item is moved back into `1. Intake` |
| **Profile Send Off — Unverified Referrals** | In `1. Intake` AND (Type = `Patient` **OR** Source = `CareCentrix`) | Same two exits | Same |

> ⚠️ Referral **Source** also has a `Patient` label. Only the **Type** column routes a patient to Unverified. Canonical rule: `src/lib/profile/referralSplit.ts`.

---

## 2. Medical Evaluation (board `18406060017`, group `2. Medical Necessity` `group_mm1xf2jb`)

Columns used throughout:

- **Stage Advancer** `color_mm1wyr92` — `Evaluate MN` · `Send Request` · `Confirm Receipt` · `Chase Clinicals` · `Completed` · `Stuck`
- **Escalation** `color_mm1x7997` — index **0** = `Manager Escalation Required`, **1** = `Done`, **2** = `Final Escalation Required` (*= proposed stuck*)
- **Clinicals Method** `color_mm1xw7y5` — `Fax` · `Parachute` · `Email` · blank
- **MN Attempts** `color_mm1wz0vg` — `Escalate` = attempt 4+
- **Evaluation Count** `numeric_mm4bhjc8`
- **MN notes** `long_text_mm27zjt2` — carries the stamped stuck reason

### Processor Overview

| Chart | Arrives when | Leaves when |
|---|---|---|
| **Evaluate** | Stage = `Evaluate MN` AND Escalation ≠ index 2 | Stage changes, or someone proposes stuck (→ index 2) |
| **Send Request** | Stage = `Send Request` AND Escalation ≠ index 2 | Same |
| **Confirm Receipt** | Stage = `Confirm Receipt` AND Escalation ≠ index 2 | Same |
| **Chase Clinicals — Fax** | Stage = `Chase Clinicals` AND Escalation ≠ index 2 AND Method **not** in (`Email`, `Parachute`) — *blank counts as Fax* | Same, or Method changes to Email/Parachute |
| **Chase Clinicals — Email & Parachute** | Stage = `Chase Clinicals` AND Escalation ≠ index 2 AND Method in (`Email`, `Parachute`) | Same, or Method changes to Fax/blank |

> **Only proposed-stuck (index 2) is excluded here.** A patient escalated to a manager (index 0) still appears in Processor Overview *and* Manager Intervention — deliberately, because a rep is still working them.

### Manager Intervention

Each is a **stacked chart of two source pools**; a patient matching both is counted once, in the red series.

| Chart | Series **Attempt 4+** (amber) | Series **3rd+ round** (red) |
|---|---|---|
| **Evaluate (Escalated)** | *(none — no Attempt 4+ series)* | Stage = `Evaluate MN` AND Escalation = index 0 AND Evaluation Count ≥ 3 |
| **Send Request (Escalated)** | *(none)* | Stage = `Send Request` AND Escalation = index 0 AND Count ≥ 3 |
| **Confirm Receipt (Escalated)** | Stage = `Confirm Receipt` AND Esc ≠ 2 AND MN Attempts = `Escalate` | Stage = `Confirm Receipt` AND Esc = 0 AND Count ≥ 3 |
| **Chase — Fax (Escalated)** | Stage = `Chase Clinicals` AND Esc ≠ 2 AND Method not Email/Parachute AND MN Attempts = `Escalate` | Same stage/method AND Esc = 0 AND Count ≥ 3 |
| **Chase — Email & Parachute (Escalated)** | Stage = `Chase Clinicals` AND Esc ≠ 2 AND Method in (Email, Parachute) AND MN Attempts = `Escalate` | Same stage/method AND Esc = 0 AND Count ≥ 3 |

**Leaves when:** Escalation is cleared off index 0, MN Attempts moves off `Escalate`, the Evaluation Count drops below 3 (it doesn't, in practice), the stage changes, or the patient is proposed stuck (index 2 — which also removes them from Processor Overview and moves them to Final Decisions).

### Final Decisions (Proposed Stuck)

| Chart | Arrives when | Leaves when |
|---|---|---|
| **Evaluate / Send Request / Confirm Receipt / Chase-Fax / Chase-Email&Parachute (Proposed Stuck)** | Same stage + method rules as Processor Overview, AND Escalation = index **2** (`Final Escalation Required`) | A manager decides — see §5 |

Getting here: a rep clicks **Propose Stuck** on the stage page. That appends the
reason to the MN notes (stamped `[Proposed Stuck · date]`) and *then* sets
Escalation → index 2. The patient leaves the rep's queue immediately.

---

## 3. Insurance (board `18410601299`)

Fetched groups: Benefits `group_mm1xr3q3` · Submit Auth `group_mm1x1416` ·
Auth Outstanding `group_mm2v6d1z` · DVS `group_mm5gp2r2` · Auth Denied `group_mm316hg2`.

Columns:

- **Stage Advancer** `color_mm1ws96t` — `Benefits / SoS` · `Submit Auth.` · `Auth. Outstanding` · `DVS` · `Auth Denied` · `Stuck / Don't Proceed` · `Complete`
- **Escalation** `color_mm2vsh2f` — **0** = `Manager Escalation Required`, **1** = `Done`, **2** = `Final Escalation Required`
- **In-Network?** `color_mm2vhwan` — `In-Network` · `Out-of-Network` · `Medicare not Primary` (key 11) · **Active?** `color_mm5q9y3` — `Active` · `Inactive` · **DME Benefits?** `color_mm2vt8xg` — `Yes` · `Partial / No`
- **Days in Stage** `color_mm1wwm05` — bucket labels; indices 2,3,4,6,7,8 = `6–8 Days` and beyond (>5 days)
- **Not Clear Products** `dropdown_mm2vez5a` — comma-joined product labels
- **Reference Notes** `long_text_mm2ffsme` — carries the stamped stuck reason *and* the manager's decision note
- **Follow Up Date** `date_mm34m2dz`
- **Trigger Supplies DVS** `color_mm26pk1a` · **Trigger Pump DVS** `color_mm578kbd` · **Claims Status** `color_mm284z0b`

> **Reason-bucketed charts (2026-07-29).** The Insurance manager columns no
> longer bucket by days-in-stage: each bar is a REASON, defined by its own
> filter rule below. A patient can match several bars and counts in each —
> the card's headline number stays **distinct patients**, so bars can sum past
> it (the card footnotes "N patients in multiple bars"). Clicking a bar
> filters the drill-down to that reason; the drill-down's **Reason** column
> shows every bar a row matches, from the same rule evaluation
> (`reasonBucketsFor`) the bars use.

### Processor Overview

| Chart | Arrives when | Leaves when |
|---|---|---|
| **Benefits** | Stage = `Benefits / SoS` | Stage changes |
| **Submit Auth** | Stage = `Submit Auth.` | Stage changes |
| **Auth Outstanding** | Stage = `Auth. Outstanding` | Stage changes |
| **Auth Denial** | Item is in the `Auth Denied` group (group-based, not stage-based) | Moved out of that group |

> **Unlike Medical Evaluation, escalation does NOT remove a patient from Processor Overview.** An Insurance patient who is escalated *or* proposed stuck still appears in their stage chart. The stages are mutually exclusive by construction (one Stage Advancer value), so a DVS-stage patient never shows under Benefits/Submit Auth/Auth Outstanding.

### Manager Intervention

**Benefits** (chart `benefits-manager-escalation`) — reason bars; the chart's
population is the UNION of the bars (there is no separate population rule).
Every bar is a **board fact**, not the Escalation label, so a patient shows the
moment the fact lands:

| Bar | Arrives when | Leaves when |
|---|---|---|
| **Inactive insurance** | Stage = `Benefits / SoS` AND Active? = `Inactive` (index 2) | Rep confirms coverage and re-sends (Active? ≠ Inactive), or stage changes |
| **Pump SoS** | Stage = `Benefits / SoS` AND Not Clear Products contains `Insulin Pump` | The pump SoS resolves off Not Clear, or stage changes |
| **Check outstanding >5d** | Stage = `Benefits / SoS` AND Escalation = `Manager Escalation Required` AND Days in Stage at `6–8 Days` or beyond | Escalation cleared (manager Return to Queue, or a rep send that de-escalates), or stage changes |

> The >5d bar's escalation label is written by **board automation 7921298383**
> (active, verified live 2026-07-29): *when Days Since Stage Started changes to
> `6–8 Days` AND Stage Advancer is `Benefits / SoS` → Escalation → Manager
> Escalation Required*. Because it fires on the CHANGE to 6–8, patients already
> past that bucket before the automation existed were never flipped and won't
> show; and a patient whose escalation a manager clears drops off the bar for
> good even as the days keep climbing (the automation doesn't re-fire). Note
> the label also parks the patient in the rep sidebar's Escalated section
> (SAM_ESCALATED) and removes them from the Benefits active count.

**Submit Auth** (chart `submit-auth-manager`, 2026-07-29 — the old *DVS — Retry
Queue* and *DVS — Manual Review* charts merged into it, so the manager sees the
total outstanding-auth workload in one card). Union population, three bars:

| Bar | Arrives when | Leaves when |
|---|---|---|
| **DVS Retry** | Stage = `DVS` AND (Supplies DVS **or** Pump DVS = `Retry Queued`) | The bot moves that status off `Retry Queued` |
| **DVS Manual Review** | Stage = `DVS` AND **any** of: Supplies DVS in (`MLTC`, `Failed`, `Manual Review`); Pump DVS in (`MLTC`, `Failed`, `Manual Review`, `Denied`); Claims Status in (`Claims Error`, `Claims Denied`, `Payment Incorrect`) — **STATUS-ONLY**: the Escalation column is deliberately not a condition (2026-07-29; no automation flips DVS patients to a manager escalation, and a label carried in from an earlier stage must not classify a patient) | Every one of those clears |
| **Propose Stuck** | Stage = `Submit Auth.` AND Escalation = `Manager Escalation Required` AND Reference Notes contain a `[Proposed Stuck` stamp | The manager decides (below), or a rep-side send clears the escalation |

> The stamp condition on the Propose Stuck bar is what keeps a Submit Auth
> send's **manual escalate toggle** (which also writes `Manager Escalation
> Required`) out of the bar.

**Drill-down actions (the first Manager Intervention buttons):** a Propose
Stuck row offers **Escalate to Final Decisions** — the manager's note is
**required** (stamped `[Escalated to Final · date · initials]` into Reference
Notes first, idempotent on retry), then Escalation → `Final Escalation
Required` — and **Return to Queue** (optional note; clears the escalation and
re-dates Follow Up to today). The DVS rows get no buttons (bot states —
nothing to decide).

> **Resolved 2026-07-29 (Josh):** escalated DVS patients now belong in the
> `/dvs` working queue — `useDvsPatients`, the dvs role count, and both
> baseline `countDvs` all stopped excluding them (§5.8 contract, changed
> together), and both the chart's Manual Review bar and the page's rail
> classify by DVS/Claims **status only**. The bar and the rail therefore list
> the same patients again.

### Final Decisions

**Benefits** (chart `benefits-final-escalation`) — population unchanged
(Stage = `Benefits / SoS` AND Escalation = `Final Escalation Required`), but the
bars are now the two ARRIVAL PATHS instead of day buckets:

| Bar | Arrives when |
|---|---|
| **Propose Stuck** | …AND Reference Notes contain a `[Proposed Stuck` stamp (the rep's required reason — also shown in the Proposed Reason column) |
| **Universal Check** | …AND the failed check is on the board: In-Network? in (`Out-of-Network`, `Medicare not Primary`) OR DME Benefits? = `Partial / No` |

A patient can match both (proposed once, check failed too — the stamp is a
permanent audit trail); a legacy patient matching neither still counts in the
headline number and shows under "all". **Inactive is deliberately NOT a
Universal Check reason** — an inactive-only patient escalates to *Manager
Intervention* instead (2026-07-29: the patient probably has other coverage, so
the manager watches while the rep keeps working them).

| Chart | Arrives when | Leaves when |
|---|---|---|
| **Submit Auth** | Stage = `Submit Auth.` AND Escalation = `Final Escalation Required` — reached ONLY via the manager's **Escalate to Final Decisions** (two-step review; a rep's Propose Stuck lands in Manager Intervention first) | A manager decides — §5 |
| **Auth Outstanding** | Stage = `Auth. Outstanding` AND Escalation = `Final Escalation Required` | Same |

Getting here: **Propose Stuck** on the Benefits / Auth Outstanding page —
appends the reason to Reference Notes (stamped), then sets Escalation →
`Final Escalation Required`. On the **Submit Auth** page the same button sets
`Manager Escalation Required` instead (the two-step flow above). It does
**not** touch the Stage Advancer, so the patient stays in their stage and also
remains visible in Processor Overview.

Auto-arrival (Benefits): Out-of-Network, Medicare not Primary, or DME
Partial/No on send sets `Final Escalation Required` automatically; an
**Inactive-only** send sets `Manager Escalation Required`
(`universalEscalationLevel` in `benefitsDerive.ts` owns the precedence —
final-level failures win when combined). Auto-arrivals show a blank Proposed
Reason but carry the machine-composed `[Auto-escalated …]` note line.

---

## 4. Welcome Call (board `18410804557`)

| Chart | Arrives when | Leaves when |
|---|---|---|
| **Welcome Call** | Item is in `group_mm1wvq8p` | Moved out of the group |
| **Profile Review** | Item is in `group_mm2x8jtj` | Moved out of the group |

---

## 5. The stuck lifecycle — the one loop that moves patients between the three views

```
  REP · on the stage page            MANAGER · from Final Decisions
  ───────────────────────            ─────────────────────────────
  Propose Stuck                      Approve Stuck
   1. stamp reason into notes         1. optional note, stamped
   2. Escalation → Final Esc Req      2. Stage Advancer → Stuck
                                      3. Escalation cleared
            │                         ⇒ gone from EVERY chart
            ▼
      Final Decisions  ─────────►    Return to Queue
                                      1. optional note, stamped
                                      2. Follow Up / Next Action = today
                                      3. Escalation cleared
                                      ⇒ back to Processor Overview
```

**Ordering is deliberate everywhere:** the note is always written *before* the
status or stage flip, because the flip is what moves the patient. A manager must
never see a proposal whose reason hasn't landed yet.

**After Approve Stuck** the Stage Advancer reads `Stuck` (ME) or
`Stuck / Don't Proceed` (Insurance). A Monday automation then moves the item to
the Stuck group — which is **not** a fetched group, so the patient disappears
from *every* chart. That is the only true exit from oversight short of Complete.

**After Return to Queue** the escalation is cleared and the date is set to today,
so the patient is due now and reappears in Processor Overview (and Manager Intervention if they still
match an escalation rule). Both notes stay in the history: a re-proposal appends
a second `[Proposed Stuck …]` line, and the drill-down's *Proposed Reason* column
always shows the **most recent** one.

### Where the decision buttons live

| Where | Buttons |
|---|---|
| Oversight drill-down (Final Decisions rows) | Approve Stuck · Return to Queue — both take an optional note |
| Oversight drill-down (Manager Intervention **Submit Auth**, Propose Stuck rows only) | Escalate to Final Decisions (note **required**) · Return to Queue (optional note; clears the escalation + re-dates Follow Up) — the two outcomes the rep's Propose Stuck dialog promises. A patient already at Final is never DOWNGRADED by a re-proposal (ProposeStuckButton preserves Final). |
| Stage page opened *from* Final Decisions (`?mv=final-decisions`) | Approve Stuck · Return to Queue — Propose Stuck is hidden, since the patient is already proposed |
| Stage page opened any other way | Propose Stuck (at Submit Auth it flags `Manager Escalation Required`; Benefits / Auth Outstanding flag `Final Escalation Required`) |

---

## 6. Gotchas worth knowing

1. **Totals don't have to equal the bars.** Blank *Days Since Stage Started* ⇒ counted in the total, drawn in no bar (§0.6).
2. **Medical Evaluation hides proposed-stuck from Processor Overview; Insurance does not.** Not a bug — the two boards were specified differently.
3. **Manager-escalated (index 0) patients appear in Processor Overview and Manager Intervention at once** on Medical Evaluation. Manager Intervention is a manager's working view, not a hand-off.
4. **Chase Fax swallows blanks.** A missing Clinicals Method counts as Fax, so nobody falls through the cracks.
5. **Auth Outstanding is a pure date bucket.** A future Follow Up Date snoozes a patient out of the rep's queue; the Follow Up *status* is ignored for that stage. That's why Return to Queue re-dates.
6. **A patient in the Escalations, Completed or Stuck group is invisible** regardless of columns (§0.2).
7. **Auto-escalations look like proposals.** A failed universal check sets the same Insurance label as Propose Stuck, so Final Decisions can contain patients with no stamped reason.

---

## What is verified, and what isn't

The **arrival** rules are read straight out of `CHART_FILTERS` and are exact.

The **exit** rules describe what the app writes plus what the Monday automations
are documented to do in `CLAUDE.md` §6. The app-side writes are verified in code;
the automation behaviour that follows a Stage Advancer change (item moved to the
next group/board) is **not** something I audited in Monday's automation list. If
a patient lingers in a chart after a stage change, suspect the automation rather
than the filter.
