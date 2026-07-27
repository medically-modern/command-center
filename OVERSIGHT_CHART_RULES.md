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
| 0.5 | **Day buckets** come from *Days Since Stage Started* (`color_mm1wwm05`) on Medical Evaluation / Insurance / Welcome Call, and from *Intake Date* on Profile Send Off. |
| 0.6 | **Blank day bucket ⇒ no bar.** A patient with an empty Days column counts in the chart's total (top-right number) but renders in **no** bar. This is why bar counts can add up to less than the total. They still appear in the drill-down. |
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

### Column 1 · Processor Overview

| Chart | Arrives when | Leaves when |
|---|---|---|
| **Evaluate** | Stage = `Evaluate MN` AND Escalation ≠ index 2 | Stage changes, or someone proposes stuck (→ index 2) |
| **Send Request** | Stage = `Send Request` AND Escalation ≠ index 2 | Same |
| **Confirm Receipt** | Stage = `Confirm Receipt` AND Escalation ≠ index 2 | Same |
| **Chase Clinicals — Fax** | Stage = `Chase Clinicals` AND Escalation ≠ index 2 AND Method **not** in (`Email`, `Parachute`) — *blank counts as Fax* | Same, or Method changes to Email/Parachute |
| **Chase Clinicals — Email & Parachute** | Stage = `Chase Clinicals` AND Escalation ≠ index 2 AND Method in (`Email`, `Parachute`) | Same, or Method changes to Fax/blank |

> **Only proposed-stuck (index 2) is excluded here.** A patient escalated to a manager (index 0) still appears in column 1 *and* column 2 — deliberately, because a rep is still working them.

### Column 2 · Manager Intervention

Each is a **stacked chart of two source pools**; a patient matching both is counted once, in the red series.

| Chart | Series **Attempt 4+** (amber) | Series **3rd+ round** (red) |
|---|---|---|
| **Evaluate (Escalated)** | *(none — no Attempt 4+ series)* | Stage = `Evaluate MN` AND Escalation = index 0 AND Evaluation Count ≥ 3 |
| **Send Request (Escalated)** | *(none)* | Stage = `Send Request` AND Escalation = index 0 AND Count ≥ 3 |
| **Confirm Receipt (Escalated)** | Stage = `Confirm Receipt` AND Esc ≠ 2 AND MN Attempts = `Escalate` | Stage = `Confirm Receipt` AND Esc = 0 AND Count ≥ 3 |
| **Chase — Fax (Escalated)** | Stage = `Chase Clinicals` AND Esc ≠ 2 AND Method not Email/Parachute AND MN Attempts = `Escalate` | Same stage/method AND Esc = 0 AND Count ≥ 3 |
| **Chase — Email & Parachute (Escalated)** | Stage = `Chase Clinicals` AND Esc ≠ 2 AND Method in (Email, Parachute) AND MN Attempts = `Escalate` | Same stage/method AND Esc = 0 AND Count ≥ 3 |

**Leaves when:** Escalation is cleared off index 0, MN Attempts moves off `Escalate`, the Evaluation Count drops below 3 (it doesn't, in practice), the stage changes, or the patient is proposed stuck (index 2 — which also removes them from column 1 and moves them to column 3).

### Column 3 · Final Decisions (Proposed Stuck)

| Chart | Arrives when | Leaves when |
|---|---|---|
| **Evaluate / Send Request / Confirm Receipt / Chase-Fax / Chase-Email&Parachute (Proposed Stuck)** | Same stage + method rules as column 1, AND Escalation = index **2** (`Final Escalation Required`) | A manager decides — see §5 |

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
- **Reference Notes** `long_text_mm2ffsme` — carries the stamped stuck reason *and* the manager's decision note
- **Follow Up Date** `date_mm34m2dz`
- **Trigger Supplies DVS** `color_mm26pk1a` · **Trigger Pump DVS** `color_mm578kbd` · **Claims Status** `color_mm284z0b`

### Column 1 · Processor Overview

| Chart | Arrives when | Leaves when |
|---|---|---|
| **Benefits** | Stage = `Benefits / SoS` | Stage changes |
| **Submit Auth** | Stage = `Submit Auth.` | Stage changes |
| **Auth Outstanding** | Stage = `Auth. Outstanding` | Stage changes |
| **Auth Denial** | Item is in the `Auth Denied` group (group-based, not stage-based) | Moved out of that group |

> **Unlike Medical Evaluation, escalation does NOT remove a patient from column 1.** An Insurance patient who is escalated *or* proposed stuck still appears in their stage chart. The stages are mutually exclusive by construction (one Stage Advancer value), so a DVS-stage patient never shows under Benefits/Submit Auth/Auth Outstanding.

### Column 2 · Manager Intervention

| Chart | Arrives when | Leaves when |
|---|---|---|
| **Benefits** | Stage = `Benefits / SoS` AND Escalation = `Manager Escalation Required` | Escalation cleared or changed, or stage changes |
| **DVS — Retry Queue** | Stage = `DVS` AND (Supplies DVS **or** Pump DVS = `Retry Queued`) | The bot moves that status off `Retry Queued` |
| **DVS — Manual Review** | Stage = `DVS` AND **any** of: Escalation = `Manager Escalation Required`; Supplies DVS in (`MLTC`, `Failed`, `Manual Review`); Pump DVS in (`MLTC`, `Failed`, `Manual Review`, `Denied`); Claims Status in (`Claims Error`, `Claims Denied`, `Payment Incorrect`) | Every one of those clears |

> Retry Queue and Manual Review are **disjoint** — a lingering retry *count* no longer counts as queued; only the literal `Retry Queued` status does.

### Column 3 · Final Decisions

| Chart | Arrives when | Leaves when |
|---|---|---|
| **Benefits** | Stage = `Benefits / SoS` AND Escalation = `Final Escalation Required` | A manager decides — §5 |
| **Submit Auth** | Stage = `Submit Auth.` AND Escalation = `Final Escalation Required` | Same |
| **Auth Outstanding** | Stage = `Auth. Outstanding` AND Escalation = `Final Escalation Required` | Same |

Getting here: **Propose Stuck** on the Benefits / Submit Auth / Auth Outstanding
page — appends the reason to Reference Notes (stamped), then sets Escalation →
`Final Escalation Required`. It does **not** touch the Stage Advancer, so the
patient stays in their stage and also remains visible in column 1.

Auto-arrival: a failed universal check can set the same label, so a patient can
land here without anyone clicking Propose Stuck. Those show a blank Proposed Reason.

---

## 4. Welcome Call (board `18410804557`)

| Chart | Arrives when | Leaves when |
|---|---|---|
| **Welcome Call** | Item is in `group_mm1wvq8p` | Moved out of the group |
| **Profile Review** | Item is in `group_mm2x8jtj` | Moved out of the group |

---

## 5. The stuck lifecycle — the one loop that moves patients between columns

```
   rep, on the stage page                    manager, from Final Decisions
   ──────────────────────                    ────────────────────────────
   Propose Stuck                             Approve Stuck ──► Stage = Stuck
     │  1. stamp reason into notes             │  1. optional note, stamped
     │  2. Escalation → Final Esc Required     │  2. Stage Advancer → Stuck
     ▼                                         │  3. Escalation cleared
   Column 3 · Final Decisions ─────────────────┤
                                               │
                                             Return to Queue ──► back to the rep
                                                1. optional note, stamped
                                                2. Follow Up / Next Action = today
                                                3. Escalation cleared
```

**Ordering is deliberate everywhere:** the note is always written *before* the
status or stage flip, because the flip is what moves the patient. A manager must
never see a proposal whose reason hasn't landed yet.

**After Approve Stuck** the Stage Advancer reads `Stuck` (ME) or
`Stuck / Don't Proceed` (Insurance). A Monday automation then moves the item to
the Stuck group — which is **not** a fetched group, so the patient disappears
from *every* chart. That is the only true exit from oversight short of Complete.

**After Return to Queue** the escalation is cleared and the date is set to today,
so the patient is due now and reappears in column 1 (and column 2 if they still
match an escalation rule). Both notes stay in the history: a re-proposal appends
a second `[Proposed Stuck …]` line, and the drill-down's *Proposed Reason* column
always shows the **most recent** one.

### Where the decision buttons live

| Where | Buttons |
|---|---|
| Oversight drill-down (Final Decisions rows) | Approve Stuck · Return to Queue — both take an optional note |
| Stage page opened *from* Final Decisions (`?mv=final-decisions`) | Approve Stuck · Return to Queue — Propose Stuck is hidden, since the patient is already proposed |
| Stage page opened any other way | Propose Stuck |

---

## 6. Gotchas worth knowing

1. **Totals don't have to equal the bars.** Blank *Days Since Stage Started* ⇒ counted in the total, drawn in no bar (§0.6).
2. **Medical Evaluation hides proposed-stuck from column 1; Insurance does not.** Not a bug — the two boards were specified differently.
3. **Manager-escalated (index 0) patients appear in columns 1 and 2 at once** on Medical Evaluation. Column 2 is a manager's working view, not a hand-off.
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
