# Manager Views — Backend Handoff Notes (for Josh)

Covers the two Pipeline Oversight redesigns (2026-07-20): the **new Insurance manager view**
(`manager-insurance.html`) and the **reworked Medical Evaluation manager view**
(`manager-medical-evaluation.html`). Both mockups reuse the existing Oversight design — same
chart cards, same day buckets and colors as `src/lib/oversight/oversightApi.ts`
(`DAY_BUCKET_LABELS` / `DAY_BUCKET_COLORS`) — so this should mostly be new chart definitions +
one new status flow, not new components. Companion doc: `HANDOFF-Josh-DVS.md` (where the retry
queue and Auth Denial patients come from).

Both views share the same 3-column scheme, and **rows are horizontally aligned across columns**
(a column-2/3 card sits on the same row as the column-1 chart it relates to):

1. **PROCESSOR OVERVIEW** — the rep's stage charts, top to bottom (monitoring the processor).
2. **MANAGER AS PROCESSOR** — work the manager owns directly.
3. **FINAL DECISIONS** — items waiting on a manager decision.

---

## 1. Insurance manager view (NEW)

**Column 1 · Processor Overview** — four charts, top to bottom:
**Benefits → Submit Auth → Auth Outstanding → Auth Denial.**
Auth Denial **includes DVS manual reviews** — a non-retryable DVS failure writes Stage → Auth
Denied (see DVS handoff §4/§7) and therefore shows up in this chart automatically. Same
day-bucket histogram + drill-down behavior as the existing Medical Evaluation charts.

**Column 2 · Manager Intervention** — two charts:

- **DVS — Retry Queue**, on the **Submit Auth** row. Patients whose DVS failed retryably; they
  re-run once a day and either clear themselves or escalate to manual review (→ Auth Denial).
  No rep owns this — the manager (Janelle) monitors it. X-axis = **days in the retry queue**
  (needs the queue-entered date from the DVS board data).
- **Auth Denial**, on the **Auth Denial** row — the Auth Denial patients the manager is
  actively working as processor.

**Column 3 · Final Decisions** — two charts:

- **Benefits** (titled just "Benefits"), on the **Benefits** row. Patients where any of the 3
  universal checks came back No (Out-of-Network / Medicare not Primary / Not Active / Not
  Covered) — i.e. the Benefits page's failed-check submit (Escalation Required with step 2
  skipped; see the Benefits Medicare-not-Primary handoff).
- **Auth Denial** (titled just "Auth Denial"), on the **Auth Denial** row. Auth Denial patients
  waiting on a manager decision.

**Both display only for now** — no decision buttons; actions TBD with Janelle.

Feed: same pattern as the existing oversight fetch — per-stage patient lists off the insurance
boards, bucketed by days in stage.

## 2. Medical Evaluation manager view (REWORK)

Same charts, new column scheme:

- **Column 1 · Processor Overview** — the current ACTIVE column, unchanged (Evaluate, Send
  Request, Confirm Receipt, Chase Clinicals — Fax, …).
- **Column 2 · Manager Intervention** — the current columns 2 AND 3 **merged**: one escalation
  chart per stage combining **Attempt 4+** and **3rd+ Round** patients. The two populations stay
  distinguishable in the chart itself: bars are **stacked by series — amber = Attempt 4+, red =
  3rd+ Round** (not the day-bucket colors; age is already the x-axis), with matching color-dot
  legend pills ("● Attempt 4+: N · ● 3rd+ round: M") and the combined count top-right.
- **Column 3 · Final Decisions** — a **general bucket column**: everything waiting on a manager
  decision lands here. **Proposed Stuck** (§3) is the first decision type, rendered as **one
  chart per stage, aligned to that stage's row**: Evaluate (Proposed Stuck), Send Request
  (Proposed Stuck), Confirm Receipt (Proposed Stuck), Chase Clinicals — Fax (Proposed Stuck)…
  Masheke can propose from ANY of her stages and the proposal shows in that stage's chart. Other
  decision types get their own charts here as they're defined.

## 3. NEW flow: Proposed Stuck (replaces direct-stuck for Masheke)

Current state (verified in the repo): Masheke's stage pages have a Stuck button + `StuckModal`
that writes **Stuck directly to Advancer 2C** (`ADVANCER_2C_INDEX.stuck`) — immediate, no
approval step, and Oversight has no stuck controls at all.

New flow:

- Her stage pages' button becomes **"Propose Stuck"** → writes a **new "Proposed Stuck" status**
  (new value on Advancer 2C or a dedicated column — Josh's call; it must NOT equal Stuck).
- **The patient leaves her view immediately** on propose — the sidebar/stage queues must filter
  out Proposed Stuck patients just like Stuck ones.
- The proposal lands in the manager view's **Final Decisions** column, in the **Proposed Stuck
  chart for the stage it was proposed from** (day-bucketed like every other chart, one chart per
  stage on that stage's row). The **drill-down** shows patient name, days in stage, and the
  rep's reason note (capture a short free-text reason at propose time — the modal should ask
  for it).
- Manager decides from the drill-down: **Approve Stuck** → write the real Stuck value (what
  `StuckModal` writes today). **Return to Queue** → clear the proposed status → patient
  reappears in Masheke's view at the same stage.

## 4. Build notes

- Reuse the existing `OversightTab` chart component + drill-down; these are new `ChartDef`s and
  a new pipeline option in the picker ("Insurance" / "Medical Evaluation").
- Row alignment matters to Brandon: DVS Retry Queue ↔ Submit Auth row; Benefits Check Failed ↔
  Benefits row; per-stage escalation cards ↔ their stage's row.
- Column headers: Processor Overview (gray), Manager Intervention (orange), Final Decisions
  (red) — uppercase letter-spaced like the current ACTIVE / ESCALATIONS headers.
- The mockups use demo data; counts and drill-down columns should come from the same board
  queries the current oversight uses.

## Open questions

- Insurance Final Decisions actions (Can't Serve / retry benefits / stuck) — deliberately
  deferred; display-only ships first.
- Where the "days in retry queue" date lives on the board (DVS handoff §10 column-ID list).
- Whether Proposed Stuck needs its own column vs a new Advancer 2C value (dealer's choice, but
  the stage queues and the manager view both need to filter on it).
