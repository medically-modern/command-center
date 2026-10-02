# Metric Dictionary

Copied from BUILD-SPEC v1.0 FROZEN §3 (spec repo medically-modern/onboarding-oversight-spec, tag onboarding-oversight-spec-v1.0). Prototype note: the spec's T4.14 generates this file from a metric registry; the prototype copies the spec text (KNOWN-LIMITATIONS P-1).

## 3. Metric Dictionary

**Metric index.** Each family has an ID prefix:
- S speed, F flow, A aging, M medical necessity, I insurance, Q quality, W workload
- E escalations, L hand-off loops, B byproducts, C coverage, DH data health

Data-health rows (DH) are alarms about data quality. Every other row is an operational metric. When an operational metric's edge case is "counted in DH-x", the excluded items are visible in that DH row and are not silently lost.

Every metric is shown with its **phase** (§7.1): **M** = in the Phase M prototype (roadmap Phases 1-6); **7** or **9** = needs that later phase. In the prototype, the tile reads "Not connected (Phase 7)" or "Not tracked (G5)".

### 3.1 Shared definitions (every metric uses these)
- **Clock.** All times are UTC milliseconds internally. "Now" is the data refresh time (`snapshotAt`), not wall-clock render time, so numbers do not drift between refreshes.
- **Business hours (bh).** `bh(a, b)` is the elapsed milliseconds between a and b minus any part that falls on a Saturday or Sunday (America/New_York calendar days) or on a date in `config.holidays`, divided by 3,600,000.
  - Implementation: `businessHoursBetween(aMs, bMs, holidays)` in `time/businessTime.ts`.
  - **bd** = bh / 24. Durations are business-*elapsed*, not 9-to-5, because work hours are not recorded and processors work queues off-hours.
  - `config.clock = "business" | "calendar"` (default "business"). The default and the holiday list are **NEEDS BRANDON CONFIRMATION**. The proposed holiday list is in Appendix A; it includes Columbus and Veterans Day, so Corey must confirm which days the company is closed.
- **Calendar days (cd)** = elapsed ms / 86,400,000. These are shown beside bd wherever a promise to partners is involved (S-01, A-03), because partners measure in calendar days.
- **Display.**
  - bh < 24 → "N h". Otherwise "N.N bd".
  - Findings text in §2 states calendar days explicitly as "N calendar days".
  - Every tile says which unit it uses. A tooltip on "bd" reads "business days: Mon-Fri, holidays excluded".
- **Period and query.** Every metric function has the signature `(snapshot, config, query)`, where `query = {periodDays: 7|28|90, filters: {referralSource?: string[], expeditedOnly?: boolean}}`. Referral sources are canonical string keys (`tandem`, `betaBionics`, …) from `config.referralSourceLabels`.
  - The period is the `periodDays` calendar days ending at `snapshotAt`. The prior period is the same length immediately before it. The default is 28.
- **Filters** apply to journeys:
  - The **journey's referral source** is color_mm1w5wxr from the earliest of its items (INT, MN, INS, WC) that has a value. This column ID is the same on all four boards. Label indexes are mapped per board in Appendix A, because the boards order labels differently.
  - The journey is **expedited** if any of its items has its board's Expedited column = 2.
  - Journeys with no referral source value are kept in an "Unknown source" bucket. When a filter is on, every tile shows "N of M patients".
- **Percentiles.** Nearest-rank: sort ascending, then p-th = element at index `ceil(p/100 × n) − 1`. When n < `config.health.minSample` (5), the value is null, shown as "—" with the tooltip "n = k; widen the period".
- **Item** identity is `(boardKey, itemId)`. **Patient key** is the trimmed, lower-cased Patient UID. If an item has no UID, its key is `item:<boardId>:<itemId>` (counted in DH-01).
- **Bulk events.** An event is `bulk=true` when either:
  - the same `userId` made the same `(columnId, fromIndex, toIndex)` change on ≥ `config.bulk.minItems` (10) distinct items within `config.bulk.windowSeconds` (**5 s**; VERIFY-2 V2: the 7 real bulk clusters were spread over 1.5-3.2 s, and 60 s also caught paced automation and shared-token runs); **or**
  - the monday event itself carries `is_batch_action: true` (present on move events; honoured on any event that has it); **or**
  - the event falls inside a `config.ignoreEventWindows` window for its board. These are operator-declared bulk edits (RUNBOOK R-1).
  - Bulk events still update state (the state model uses them), but they are excluded from: loop counting (L), escalation volume and resolution (E-03, E-04), and completed-span percentiles that **end** in a bulk event.
  - They are listed in DH-17 with board, time, user, transition, item count, and the rule that flagged them (signature or window). DH-17 also reports the share of each signature cluster's events spread over more than 5 s, which is the organic-hit check.
  - **Bulk spans:** a bulk transition still starts a holder span (`startBulk=true`; spans are maximal constant-state intervals). Spans started by a bulk event are **skipped when building the loop sequence** (§3.15), and the sequence joins the neighbouring non-bulk spans. They **are** included in E-02 continuous hold and L-03.
- **Import cohorts.** Items whose `createdAtMs` falls inside a `config.importWindows` window (Appendix A; from VERIFY-1 V10) are excluded from createdAt-based speed and entry metrics (S-01, S-03, F-01, 1.1.1.x). They still count in WIP and aging. Counted in DH-18.

### 3.2 Item state model (the data model everything computes from)
Inputs:
- normalized events `{eventId, boardId, itemId, columnId, toIndex, fromIndex, atMs, userId}` for each board's columns in `config.activityColumns`
- current items `{boardKey, itemId, groupId, createdAtMs, uid, values}`

**3.2.1 Per-column timelines.**
- **R1 Order.** For each item and column, sort events by `atMs`, then `eventId`. Drop duplicate eventIds.
  - Two events at the same `atMs` on different columns of the same item are applied **stage column first, then escalation column**. This defines the outcome of "approve: stage → Stuck then escalation → Done" written in the same second.
- **R2 Value timeline.** A column's value is piecewise constant. Each event sets it to `toIndex`; null means cleared. **First-event rule (CR-2, adopted D-34):** for MN, INS and WC, if the first stage event has no previous value **and occurs within 60 s of the item's createdAtMs** (`config.firstEventToleranceSeconds`), the value before it is that event's value (automation sets the first stage at creation), and the span starts at createdAtMs. Otherwise the value before the first event stays **unknown**: the opening span starts at createdAtMs, is marked **synthetic** (its age is a bound), and is counted in DH-04. INT always keeps "unknown". Test TL-9: first stage event 30 days after creation with no previous value gives a synthetic opening span. Zero-length spans (two changes at one instant) are dropped. Tests: TL-2, CR-1, CR-5.
  - Before the first event, the value is `fromIndex` of the first event when present. Otherwise it is "unknown before first event".
- **R3 Current value wins.** For every tracked column, the **open** (latest) value is the item's **current** column value from `items_page`, not the last logged value.
  - If they differ, the open span starts at the item's latest event on that column (if any), otherwise at `createdAtMs`. It is flagged `synthetic=true`.
  - The mismatch is counted in **DH-16 (history/current mismatch)**, with the item list.
  - This covers values set before the log started (INT Intake Sub-Stage history starts 2026-08-19 and INT Escalation 2026-08-06; VERIFY-1 V9), writes with no log event, and bulk clears.
- **R4 Deleted items.** Events whose item is not in current `items_page` are dropped from WIP and metrics.
  - The count goes to DH-05. Items that were in MGR, FINAL, or STUCK at their last event before disappearing also go to DH-05b (yellow if > 0), so deleting a parked item is visible.

**3.2.2 Holder state.** At every moment, each item is in exactly one **holder state**. It is computed by this priority from the values of its stage column, escalation column, and current group:
| Priority | State | Rule | Meaning |
|---|---|---|---|
| 1 | `EXITED` | Stage value is the board's exit label (INT color_mm1zmeb3 ∈ {1, 6}; MN 14; INS 7; WC 4), **or** an INT terminal label (color_mm1zmeb3 0 Already Serving, 2 Send Back To Referral), **or** (current state only) the current group is in `groups.<board>.exit` (INT group_mm1y57sz; MN group_mm1x5q4e; INS group_mm2vw3c0; WC group_mm1x5s5d), flagged `byGroup=true`. A group-only EXITED span starts at the group-move event whose destination is the exit group when one exists; otherwise at the item's latest event on any tracked column (else `createdAtMs`), synthetic. Counted in DH-12. | Left this board. **Escalation labels on exited items are stale flags** (DH-19), never "parked" |
| 2 | `STUCK` | Stage value is a stuck label (MN 15, INS 2, WC 2), **or** (current state only) the item is in its board's Stuck group (INT, MN, WC group_mm1xyczx; INS group_mm5g7twt). Group-only evidence is flagged `byGroup=true` | Dead lead: an intentional outcome, not an alarm (Brandon CR B) |
| 3 | `FINAL` | Escalation = 2 (Final Escalation Required = "proposed stuck") | Katie's final escalation bucket (Final Decisions) |
| 4 | `MGR` | Escalation = 0 (Manager Escalation Required), **or** (current state only) the item is in its board's Escalations group (MN group_mm33pdpm, INS group_mm2vg9gn, WC group_mm1x5c0) with no escalation label, flagged `byGroup=true` | Janelle's escalated bucket (Manager Intervention) |
| 5 | `QUEUE:<code>` | Otherwise. Code from §3.2.3 | In a rep queue |

- INT has no stuck label. INT STUCK is current-state only (group_mm1xyczx). Its age runs from the item's latest event on any tracked column, else `createdAtMs`.
- **Group moves** (VERIFY-2 V1). `activity_logs(group_ids:[X])` returns moves **out of** X only. Any `column_ids` filter drops move events entirely. The `data` keys are `source_group{id,…}`, `dest_group{id,…}`, `group_id` (= the **source** group), and `is_batch_action`.
  - To learn when an item moved **into** a Stuck, Escalations, or exit group, the fetch queries moves out of their **source** groups: `config.groupMoveSourceGroups[board]` (every in-pipeline group).
  - Each event yields `{fromGroupId: data.source_group.id, toGroupId: data.dest_group.id}`. **`data.group_id` is never used as the destination.**
  - A move whose `toGroupId` is a Stuck, Escalations, or exit group **starts** the byGroup span. A move whose `fromGroupId` is one of them **ends** it.
  - When no such event exists (the item moved before the fetch window, or the move was not logged), the span is synthetic (R3).
  - Window: `from = max(historyStart, refreshStartMs − config.groupMoves.lookbackDays (45))` on cold; incremental on warm. The query returns every event in those groups, so it is kept short and filtered client-side to `move_pulse_from_group`.
  - Its complexity cost is measured in Phase 2 (DoD). `config.groupMoves.enabled = false` turns it off: all byGroup spans are then synthetic, with no other effect.
- **Holder spans** are the maximal intervals of constant holder state, built from the merged timelines.
  - Consecutive identical states are merged.
  - A span shorter than `config.loops.minSpanMinutes` (2) whose neighbours are the **same** state is removed, and the neighbours are merged (accidental double-clicks). Spans between different states are never removed.

**3.2.3 Code resolution for QUEUE spans** (`model/codeResolver.ts`):
- **MN:** 8 → 1.1.2.1; 9 → 1.1.2.2; 10 → 1.1.2.3; 0 Doctor Appointment → `MN-DA`.
  - `MN-DA` is a non-taxonomy queue: CC role doctorAppointments, waiting on the provider. It is shown as its own row under Medical Necessity, marked "not a taxonomy code".
- **MN 11 (chase):** the channel is color_mm1xw7y5 **in effect at span start**. That is the value from the Clinicals Method timeline (R2); if the first Clinicals Method event is after span start, its `fromIndex`; otherwise the current value.
  - Parachute-role channels: {1 Parachute, 2 Email, 3 Dashboard} → **1.1.2.4P**. Everything else, including 0 Fax and blank → **1.1.2.4F**.
  - This is exactly CC's `isParachuteRoleMethod` / chaseFax split (CC/src/lib/masheke/chaseMethods.ts; VERIFY-1 V4), so the dashboard's queues match what Madeline and Masheke work.
  - A blank channel is also counted in DH-14.
  - With `config.splitChaseClinicals = false`, both become `1.1.2.4`.
- **INS:**
  - 1 DVS → 1.1.3.1.
  - 3 Benefits / SoS: before the first color_mm2vt8xg (DME Benefits?) event inside the span → 1.1.3.1; after → 1.1.3.2. A **completed** label-3 span with no such event becomes `1.1.3.1+2` (reported as a combined row, counted once in stage totals). An **open** one stays 1.1.3.1.
  - 4 → 1.1.3.3; 6 → 1.1.3.4; 0 Auth Denied → 1.1.3.5.
  - **Remediation:** a label 4 or 6 span that comes after any label-0 span on the same item → **1.1.3.6**.
- **WC:** 7 → 1.1.4.1; 0 Review Profile → 1.1.5.1.
- **INT** (two columns):
  - **1.1.1.1** from `createdAtMs` until color_mm6ct431 → 1 or EXITED.
  - **1.1.1.2** from color_mm6ct431 → 1 until EXITED.
  - color_mm1zmeb3 = 3 (Need More Info.) keeps the item in its current INT code, with `waitingOn = "patient or referral source"` while the value is 3.
  - For items created before 2026-08-19 (Intake Sub-Stage history start), INT time is code **1.1.1** (unsplit) and is not attributed to 1.1.1.1 or 1.1.1.2 (KL-05).
- **Unmapped label:** a stage index with no rule (none exist today; all indexes are listed in §2.3 and confirmed in VERIFY-1) becomes `UNMAPPED:<board>:<index>`. It is included in stage time and WIP, excluded from code metrics, and listed in DH-20.

**3.2.4 Segments, exits, re-entries, journeys.**
- A **segment** is a QUEUE holder span with its code. Parking spans (STUCK, FINAL, MGR) are **holder spans, not segments**. Code metrics (S-04, A-01, code health) use **segments only**. Stage time (S-03) uses everything between stage entry and stage exit.
- **Stage exit:** the first transition into EXITED via the exit label (INT 1/6, MN 14, INS 7, WC 4).
- **Re-entry (one rule):** a segment is `reentry=true` if its code already occurred in an earlier segment of the same item. Q-03 counts exactly these.
- **Journey (R8):** group items by patient key across INT (only via G1 or Matched UID), MN, INS, WC.
  - Per board, the **primary** item is the earliest `createdAtMs`. Other items with the same key on the same board are **duplicates** (DH-02). They are excluded from speed metrics but kept in WIP.
  - **Release** = the earliest event, on **any** WC item of the patient (primary or duplicate), that sets color_mm1ws96t to 4.

### 3.3 Referral arrival (start of the end-to-end clock)
The first available source, in order, gives `arrivalSource`:
1. `int_link`: the INT item linked by G1 ("Intake Item ID"; inactive until G1 ships).
2. `int_uid`: the INT in-pipeline item whose text_mm65xbm0 equals the UID (the earliest if several).
3. `mn_created`: MN primary `createdAtMs`. VERIFY-0b: MN Date of Intake and Referral Received Date equal the MN creation date, so they add nothing.
4. `wc_date_of_intake`: no MN item (H1b skip path). Uses WC date_mm1wf43j at 00:00 ET. H1b copies this from INT (VERIFY-1 V8).
5. `first_item`: anything else.

`first_item` patients are **excluded** from S-01 and A-03 percentiles (their clock would start mid-pipeline) and counted in DH-07b.

Until G1 ships, S-01 for most patients measures **MN entry → release**. The tile states this, shows the S-03 Intake p50 next to it, and shows the share by arrivalSource.

### 3.4 Speed metrics
| ID | Ph | Name | Plain meaning | Formula | Source | Edge cases | Matters to |
|---|---|---|---|---|---|---|---|
| S-01 | M | Referral-to-release time | How long released patients took | For each patient with release in the period and arrivalSource ≠ first_item: `bh(arrival, release)`. Report p50, p90, n, and the same in cd | §3.3; WC color_mm1ws96t | Duplicates excluded (R8); import-cohort patients excluded (DH-18); arrival > release excluded (DH-07) | Corey, Brandon, Katie |
| S-02 | M | Speed trend | Is S-01 getting better? | p50 and p90 of S-01 in period minus prior period, each with both n; plus weekly p50 for 12 weeks (weeks end Sunday ET) | as S-01 | Either n < minSample → "—" | Leadership |
| S-03 | M | Stage time | Time spent in each stage | Per primary item with stage exit in period: 1.1.1 = `bh(INT createdAt, INT exit)`; 1.1.2 = `bh(MN createdAt, MN exit)`; 1.1.3 = INS likewise; 1.1.4 = `bh(WC createdAt, first WC → 0 or → 4)`; 1.1.5 = `bh(first WC → 0, first WC → 4)`. p50, p90, n, and prior-period deltas | Items, stage timelines | Includes parked time (STUCK/MGR/FINAL); the breakdown shows "of which parked" | Managers, leadership |
| S-04 | M | Code time | Time in each code (active queue work) | Per item per code: the sum of its completed segment durations for that code, counted in the period where the code's last segment ended. p50, p90, n, prior-period deltas | Segments | Parking spans excluded by definition; 1.1.3.1+2 as combined row | Managers |
| S-05 | M | Hand-off lag | Gap between a board exit and the next board's item creation | `bh(exit on board k, createdAt of next board's primary item for the UID)` | UID join | Expected < 0.1 bh; > 1 bh feeds DH-09 | Brandon, Josh |
| S-06 | M | Waiting-on breakdown | Where elapsed time goes | Sum of bh of all spans (completed and open) overlapping the period, clipped to the period, grouped by `waitingOn(span)` (§3.14.2) | Holder spans | — | Leadership |

### 3.5 Flow metrics
| ID | Ph | Name | Meaning | Formula | Source | Edge cases | Threshold | Matters to |
|---|---|---|---|---|---|---|---|---|
| F-01 | M | Entered | Patients entering each stage or code | Stage: primary items created in the period. Code: segments starting in the period, re-entries excluded | Items, segments | Import cohorts excluded | — | Managers |
| F-02 | M | Exited (throughput) | Patients completing each stage or code | Stage: stage exits in the period. Code: last segment of a code on an item ending in the period with transition to a later code or EXITED. Per day and per week | Segments | A transition into STUCK/MGR/FINAL is not an exit | — | Leadership, managers |
| F-03 | M | WIP | Patients in each code now | Count of items whose current holder state is `QUEUE:<code>`; plus per board the counts in STUCK, MGR, FINAL | Holder state (current) | Equals monday counts (T-REC) | — | All |
| F-04 | M | Net flow | Is the queue growing? | `net = F-01 − F-02` for the period; `ratio = net / max(1, WIP at period start)` (WIP at period start is from the state model at that instant) | | | Yellow ratio > +0.20; red > +0.40 (NEEDS BRANDON CONFIRMATION) | Managers |
| F-05 | M | Releases | Patients released | Count of release events (§3.2.4) in the period, per week | WC | Duplicates excluded | — | Brandon |

### 3.6 Aging and stuck-work metrics
| ID | Ph | Name | Meaning | Formula | Source | Edge cases | Matters to |
|---|---|---|---|---|---|---|---|
| A-01 | M | Over-threshold queue items | Open queue items past yellow or red | For current QUEUE items: `age = bh(open segment start, snapshotAt)`, compared to `thresholds[code]`. **Overdue** = over red **and not snoozed** | Segments, snooze columns | **Snoozed** (by stage label, = CC queue rules, VERIFY-1 V13; `today` = ET date): MN: date_mm1wadgs > today. INS labels 1 (DVS) and 6 (Auth Outstanding, including remediation spans at 6): date_mm34m2dz > today (date only). INS labels 3 and 4 (including remediation at 4): color_mm34jz1x = 1 (Follow Up; index per BOARDS.md) **and** (date_mm34m2dz blank or > today). INS label 0: never snoozed. WC label 7: date_mm38a7k7 > today; WC label 0: never. **A-01b snoozed count** = the number of current QUEUE items that are snoozed, per code (shown as "snoozed N" in Pipeline rows and person cards). Overdue, W-01, and W-02 exclude snoozed items; they are never in a denominator | All |
| A-02 | M | Oldest items | 10 oldest per code, per holder state, and overall | Sort by age descending | Holder spans | Shows item ID, board, state/code, age (bd and cd), waiting-on, owner(s) | Managers |
| A-03 | M | Open time in onboarding | How long current open patients have been in onboarding | For open journeys (not released, not EXITED on the last board reached, arrivalSource ≠ first_item): `bh(arrival, snapshotAt)`. p50, p90, share over the S-01 red, and the same in cd | §3.3 | Import cohorts excluded | Leadership |
| A-04 | M | Dead leads (Stuck) | Leads closed as Stuck: an intentional outcome, not an alarm | Current count; new this period; change vs prior period; weekly trend; **dead leads as % of new referrals** (new MN items) this period; **how they arrived**: share of new dead leads that came straight from a queue vs via an escalation (MGR/FINAL); **moved by bulk** (count of new dead leads whose STUCK span started with a bulk event); **revivals** (STUCK → QUEUE/MGR/FINAL in the period); **spike marker** (info) when last week's new dead leads are ≥ 5 **and** greater than 2 × both the trailing 4-week weekly median and the trailing 4-week weekly mean. No thresholds and no colour | Holder state | byGroup items flagged. **INT Stuck** (group only; 146 today) is a separate line, "INT Stuck (by group; age approximate)"; its ages show as "up to N bd". Dead leads are never "need action" and never colour X4, the banner, or any tile (Brandon CR B) | All |
| A-05 | M | Waiting-on (open) | Who we are waiting on for open items | Count of current items by `waitingOn` | §3.14.2 | — | Leadership |

### 3.7 Medical necessity metrics
| ID | Ph | Name | Meaning | Formula | Source | Edge cases | Matters to |
|---|---|---|---|---|---|---|---|
| M-01 | M | Request-to-receipt | From request sent until the provider confirms receipt | Per MN item with a completed `metricLabels.MN.confirmReceipt` (10) segment: `bh(start, end)` of its first such segment | MN stage | Items going Send Request → Chase directly are excluded from n (counted in M-05) | Janelle |
| M-02 | M | Chase attempts | Attempts per patient | Per MN item that had a chase segment: the highest attempt reached on color_mm1wz0vg **from events only** (index → attempt via `metricLabels.MN.attempts`: 2 → 1, 3 → 2, 1 → 3, 0 → escalated), plus the count of non-empty chase attempt text fields | MN | Current values ignored (default-filled) | Janelle |
| M-03 | M | Chase age | How long open chases have run | Open 1.1.2.4F/P segment ages; p50 and oldest per channel | Segments | | Janelle, Masheke, Madeline |
| M-04 | M | Clinicals received rate | Chased patients who got clinicals | Of MN items whose first chase segment started in the window `[periodStart − clinicalsWindowBd, periodEnd − clinicalsWindowBd]`: share with color_mm1y8rv8 → `metricLabels.MN.mrReceived` (1) or an MN stage exit within `clinicalsWindowBd` (10 bd) of chase start | MN | Window shifted so every item had the full 10 bd | Janelle |
| M-05 | M | Path mix | How MN items move | Share of MN exits in the period whose segment codes include: only 1.1.2.1/1.1.2.2; 1.1.2.3; 1.1.2.4F/P; MN-DA (multi-select, so shares can sum over 100%) | Segments | | Janelle |
| M-06 | M | MN established rate | Share established | Current color_mm1y6qrf = 1 among items with an MN exit in the period | MN | Current value (KL-04) | Janelle |

### 3.8 Insurance metrics
| ID | Ph | Name | Meaning | Formula | Source | Edge cases | Matters to |
|---|---|---|---|---|---|---|---|
| I-01 | M | Auth decision time | Payer turnaround | For each completed 1.1.3.4 segment (first one per item) ending into `INS.approved` (7) or `INS.denied` (0): `bh(start, end)`. p50, p90 | INS stage | Exits to STUCK, MGR, or other labels are excluded from n | Janelle, Samantha |
| I-02 | M | Approval rate | Share of first decisions that are approvals | count(first 1.1.3.4 → 7) / count(first 1.1.3.4 → 7 or → 0) for decisions in the period | INS | | Leadership |
| I-03 | M | Denial rate | 1 − I-02 | | | | Leadership |
| I-04 | M | Remediation success | Denied patients eventually approved | Of items whose first 1.1.3.5 segment started 90 to 30 days before snapshotAt: share later EXITED via 7 | INS | Window lets remediation finish | Janelle |
| I-05 | M | Outstanding auths by age | Open payer waits | Current 1.1.3.4 and 1.1.3.6-in-label-6 QUEUE items by age bucket 0-2, 3-5, 6-10, > 10 bd | INS | | Janelle, Samantha |
| I-06 | M | Denials by product | Which product auths are denied | Count of INS items (in-pipeline groups) whose current Auth Result column = 2, per column (CGM color_mm1wgjd1, Sensors color_mm1x5c99, IP color_mm1xnzmn, Infusion Set color_mm1xr2j1, Cartridge color_mm1xybvt) | INS | Current values (KL-04). Free-text Denial Reason is never read | Janelle |
| I-07 | 8 | Denial reasons | Why auths are denied | Count by Denial Reason Category (G3) for items entering 1.1.3.5 in the period | INS (after G3) | Until G3: "Not captured yet (G3)" | Leadership |
| I-08 | M | Benefits and SoS time | Benefits check duration | S-04 for 1.1.3.1, 1.1.3.2, 1.1.3.1+2 | INS | | Samantha |

### 3.9 Quality and rework metrics
| ID | Ph | Name | Meaning | Formula | Source | Edge cases | Matters to |
|---|---|---|---|---|---|---|---|
| Q-01 | M | Bounce-backs | Sent back to an earlier step | Count of segment-to-segment transitions within an item where `codeOrder[to] < codeOrder[from]`, excluding pairs in `config.reworkExclusions` (default: 1.1.3.5 → 1.1.3.6, the designed remediation path); plus INT color_mm1zmeb3 → 2 or → 3 events | Segments | Transitions via STUCK/MGR/FINAL compare the segments on either side | Managers |
| Q-01b | M | Re-created on an earlier board | A patient re-entered an earlier board | Count of items on board k created after the patient's first item on board k+1 (by createdAt), where the UID is a valid UUID and not in DH-02 | UID join | Reported separately; never added to loops | Brandon, managers |
| Q-02 | M | Profile clean-up volume | Intake profiles needing clean-up | Count of INT color_mm6ct431 → 1 events in the period; and the share of INT exits that had a 1.1.1.2 segment | INT | History from 2026-08-19 | Emily |
| Q-03 | M | Re-entries | Patients returning to a step | Count of segments with `reentry=true` starting in the period | Segments | | Managers |
| Q-04 | M | Final confirmation failures | Profiles failing the last check | WC transitions in the period: 0 → 7, 0 → 2, and 4 → 0 (after release); plus releases with no 1.1.5.1 segment | WC | 4 → 0 after release = already copied to SUB | Emily, Brandon |

### 3.10 Workload and ownership metrics
**Owner sources** (decided in D-08, v0.2):
- **Live owner** of a code = the people whose access.json `processors[<key>].roles` include a role mapped to that code by `config.roleToCodes` (Appendix A).
  - For 1.2.2, the access.json `callAnswerers` list.
  - access.json is CC's single source of truth for roles. assignments.json is legacy and is never read (CC/docs/claude/5.3-access-control.md:10; VERIFY-1 V5).
  - People flagged `excludeFromOwnership` (Josh: engineering account that holds every role for testing) are ignored.
  - Each person's **tier** comes from `config.people` (taxonomy: processor, manager, leadership; plus Madeline = processor outside the taxonomy).
  - The live-owner table as of 2026-10-01 is in §2.8 and is a test fixture (WL-0).
- **Documented owner** = TAXONOMY.md §3 (`config.documentedOwners`).
- **Observed actor** = the person who made a transition (§3.10.1).

**3.10.1 Attribution order** for a transition (used by W-04, L-05, C-04):
1. monday `userId`, when it maps to a person in `config.people[].mondayUserIds` and is not a `sharedToken` account (Josh 100161122) and not -4. These are direct monday edits; Corey, Brandon, Janelle, Masheke, and Katie all appear.
2. Otherwise (Phase 7) the gql_log row matched per §5.5.
3. Otherwise "automation" (userId -4) or "unattributed".

Rules 1 and 2 are both active (rule 2 since 2026-10-02). Rule 2 is the gateway's `GET /oversight/app-actors` (signed-in only; returns item id, board id, actor email, time and the column IDS written — never a value), matched in memory by `model/appAttribution.ts`: same item and board, the event's column among those written, within `attributionMatchSeconds`, nearest first. Patient lists show the person after the last action's date; the header shows "N% of Command Center actions named". Since 2026-10-02 (Josh) two numbers depend on it:
- **Escalation "being worked"** (`escWorking`) needs a logged action **named to an escalation owner** — the owners of the ESC steps in Normal times (Janelle, Katie) — after the escalation. A processor's edit, or a shared-account write the gateway log does not match, no longer counts; such escalations read "untouched".
- **By Employee "Worked/day"** is credited to **the person who made the change** (under the step table's name for them, so Samantha's work counts for "Sam"), not to the step's owner. Anyone who worked steps they do not own gets a row (their worked steps only); work no one can be named for goes to a "Not named" row. "New/day" and the patient queue stay with the step's owner.
- **System changes are not staff work** (Josh, 2026-10-02). The shared token is also used directly — not through the gateway — by the intake web form, Stedi and the DVS services. Measured on Profile Send Off, Sep 14 – Oct 2: of 6,057 shared-token changes, 56% were Command Center writes; the rest were mostly the form (Last Form Activity, Drop-off Step, the doctor and insurance fields, around the clock). A shared-token change with no matching gateway write, inside the period the gateway log covers, is marked `system` and treated as automation: it is no longer a "touch", "worked" or a last action. Not when the log answer was truncated; not before its first row; never on a file column (staff uploads go through the Cloudflare worker, not the gateway); never when the gateway has an unnamed actor for it.
- **Matching window.** A durable `/send` job logs its gql_log row when it FINISHES; an attempt whose read-back timed out has already changed monday, and the row lands minutes later (measured 2–60 min). The gateway therefore returns each send row's job queue time (`send_jobs.created_at`) and an event matches anywhere from queue time to log time, ± `attributionMatchSeconds`. Direct `/gql` writes log at once (± 120 s).
- The header no longer shows a coverage %; it says "staff names unavailable" only when the gateway log could not be read (then nothing is named and system changes count as before).

| ID | Ph | Name | Meaning | Formula | Source | Edge cases | Threshold | Matters to |
|---|---|---|---|---|---|---|---|---|
| W-01 | M | Queue items per person | Each person's share of open queue work | For each code C: `Q(C)` = current QUEUE items in C that are not snoozed. Let `P(C)` = the processor-tier live owners of C; if empty, all live owners of C, tagged "covered by leadership or managers". Each person in P(C) gets `Q(C) / |P(C)|`. W-01(person) = the sum over codes, rounded to the nearest whole item for display, halves rounded up (`Math.round`), with the unrounded value in the tooltip | access.json, holder state | No live roles → 0 with "no live roles" (Masani has only call answering) | — | Managers |
| W-02 | M | Overdue per person | Each person's share of overdue items | As W-01, using only overdue items (A-01: over red, not snoozed) | | | Shown red when the person is the **sole** processor on a code with ≥ 1 overdue item older than 2 × red; otherwise informational | Managers |
| W-03 | M | Days of work in queue | Is a queue (and its sole owner) overloaded? | For each code: `Q(C) / max(0.5, weekly exits of C averaged over the last 4 weeks) × 5` bd. A person is "overloaded" only if they are the sole processor on a code with W-03 over red. Shared queues show "shared queue (equal split)" | F-02, F-03 | When `capacityPerWeek[person]` is set (optional), load = W-01 inflow share / capacity is shown as well | Yellow > 5 bd; red > 10 bd of work (NEEDS BRANDON CONFIRMATION; judgment: two business weeks of backlog) | Leadership |
| W-04 | M partial / 7 full | Work done per person | Who actually moved items | Count of stage and escalation transitions in the period attributed per §3.10.1, per person per code; plus the share unattributed | activity log; gql_log (7) | Bulk events excluded | DH-10: attribution coverage | Leadership |
| W-05 | M | Owner mismatch | Where documented, live, and observed owners disagree | Per code: documented set, live set, observed set (≥ 10% of the code's attributed transitions in the last 28 days; empty when coverage < 50%) | config, access.json | | Difference = "Finding" badge | Corey, Brandon |

### 3.11 Escalation metrics
All escalation metrics use only items whose holder state is MGR or FINAL. Stale flags on EXITED items are DH-19, never escalations.
| ID | Ph | Name | Meaning | Formula | Source | Edge cases | Matters to |
|---|---|---|---|---|---|---|---|
| E-01 | M | Open escalations and limbo | Escalated items per owner bucket | Current counts of MGR (**Janelle's bucket**, "Manager Intervention") and FINAL (**Katie's bucket**, "Final Decisions") per board and in total, with: **limbo count** = items whose **continuous escalation hold** (E-02) is > `holderThresholds.r` (2 bd) and is **known** (non-synthetic); the 1-2 bd count; **unknown-age count** (synthetic hold, shown as "+k age unknown" beside the limbo count, never silently dropped); the oldest known hold; and a **by originating code** breakdown (the last QUEUE code before the escalation run; codes in C-02 are tagged "no live processor"). Loop age is **not** part of limbo (D-35): items whose loop age > 2 bd but whose current hold is ≤ 2 bd are counted as **bouncing** (E-06/L-01a) | Holder state | INT counts only in-pipeline groups. Escalation flags on INT non-pipeline items (264 today, VERIFY-1 V1) are shown as "+N flagged outside the pipeline" (DH-08) | Janelle, Katie, Brandon |
| E-02 | M | Continuous hold age | How long each open escalation has been away from a queue | For each current MGR/FINAL item: **continuous escalation hold** = `bh(start of the earliest span in the unbroken run of MGR and FINAL spans ending now, snapshotAt)`. Moving MGR → FINAL → MGR does not reset it. A move to STUCK resolves the escalation (dead lead), so STUCK is not part of the run. For STUCK items, the separate **dead-lead age** is shown without thresholds. **Loop age** (defined on the §3.15 loop sequence h, which skips bulk spans; h[n] is the current open span): loop age is **null unless h[n] is a revisit**. Let m be the smallest index such that h[m..n] are all revisits (the **current run**). Loop start = the start of the earliest non-QUEUE span in h[m−1..n]; if there is none (a pure queue regression), the start of h[m−1]. Loop age = `bh(loop start, snapshotAt)`. If that span is synthetic, loop age is an upper bound ("up to") and never drives status. Worked example: h = QUEUE (t0), FINAL (t1), QUEUE (t2), FINAL (t3, open) → the run is h[2..3], so m = 2 → earliest non-QUEUE in h[1..3] = FINAL at t1 → loop age = bh(t1, now). An old loop followed by forward progress resets it. The holder tile's "oldest" figure is the E-02 continuous hold; a loop-age-driven Red shows "N bd in loop" beside it | Holder spans | **Synthetic starts (R3) are upper bounds:** the true start is at or after the computed start, so ages show "up to N bd". Synthetic ages never drive a tile's status or its "oldest" figure; those use non-synthetic spans, and the synthetic ones are shown as "+k of unknown age" | Managers |
| E-03 | M | Escalation outcome and time | How escalations end and how long they take | For each completed run of MGR/FINAL spans ending in the period, classify the outcome by the transition out: **dead lead** (next state STUCK), **returned to queue** (next state QUEUE, from either bucket), or **exited**. Hand-downs (FINAL → MGR inside a run) are a **within-run counter**, not an outcome; the limbo clock keeps running. Per Brandon, only "dead lead" and "returned to queue" are resolutions. Each run is marked on time (≤ 2 bd) or late. Report counts, p50 and p90 of run length per outcome, the on-time share, and the share of dead-lead outcomes still STUCK today. **Ended by bulk:** runs ended by a bulk event are counted per outcome, with the oldest hold they ended, and shown beside the on-time share ("{b} ended by bulk, oldest {x} bd"). They are kept out of timing but never out of the display | Holder spans | Bulk-ended runs excluded from timing; shown as "ended by bulk" and in DH-17 (yellow) | Janelle, Katie, Brandon |
| E-04 | M | Escalation volume | Escalations raised | Count of transitions into MGR or FINAL per week per board | | Bulk excluded | Leadership |
| E-05 | M | Escalation owner | Who owns each bucket | `config.holderOwners`: MGR → Janelle, FINAL → Katie (Brandon CR B; AS-04), shown on every escalation tile and row | config | — | Brandon |
| E-06 | M | Escalation bounces | How often items bounce between escalation and queue | Computed on the §3.15 loop sequence (bulk-started spans skipped, minSpan merged). A **re-escalation** is a QUEUE → MGR/FINAL transition that follows an earlier return MGR/FINAL → QUEUE **or** a revival STUCK → QUEUE on the same item, **or** a direct STUCK → MGR/FINAL transition (a revival straight back into escalation). An item re-escalated straight out of STUCK is flagged "re-escalated after dead lead" and counted as **bouncing** (yellow) whatever its loop age, with its prior escalation hold shown. **Revival detection (STUCK → QUEUE or STUCK → MGR/FINAL) uses the unfiltered span list**, so a STUCK span started by a bulk event still counts as a dead-lead predecessor for revivals, re-escalations, and the "re-escalated after dead lead" flag. Only the QUEUE ⇄ escalation return detection uses the bulk-filtered loop sequence. It is credited to the bucket **entered** and anchored to the re-escalation time. Report: re-escalations in the period per bucket; items with ≥ 2 re-escalations; and **bouncing** items (loop age > 2 bd with current hold ≤ 2 bd, yellow) | Holder spans | Bulk excluded | Brandon, Janelle, Katie |

### 3.12 Byproduct and coverage metrics
| ID | Ph | Code | Name | Formula | Source | Edge cases | Threshold | Matters to |
|---|---|---|---|---|---|---|---|---|
| B-01 | M | 1.2.1 | Patient texts | (M) count of WC color_mm1xtqvv → 0 (Send) events per week. (7) `sent_messages` per week and per sender for pipeline items | WC; gateway | Prototype tile labelled "welcome texts only" | — | Leadership |
| B-02 | M via /comms/sla | 1.2.1, 1.2.2 | Inbound patient comms response | Read `GET <gateway>/comms/sla?days=<periodDays>` (existing, Google-authenticated, read-only; VERIFY-0b §3). Show `medianMs` (as bh), `withinPct` (≤ 24 counted weekday hours), `open`, `over`, and `reps[]` (resolver, resolved, withinPct) | gateway /comms/sla | Covers **all** inbound comms, not onboarding only; labelled so. Unavailable in direct-monday dev mode → "Not connected" | CC's existing SLA: within 24 counted hours. Green withinPct ≥ 90%, yellow ≥ 75%, red < 75% (NEEDS BRANDON CONFIRMATION) | Leadership |
| B-03 | M | 1.2.2 | Patient calls | (M) count of WC items with non-empty text_mm322fg9; `/comms/sla` byHow.called. (7) comms_dials and answered call_events per week and per person | WC; gateway | | — | Leadership |
| B-04 | 9 | 1.2.3 | Provider emails | NOT TRACKED until G5; then provider_email_log rows per week and per sender | gateway (G5) | | — | Leadership |
| B-05 | M proxy | 1.2.4 | Provider calls | (M) count of MN items with non-empty text in each of text_mm2yd068, text_mm2y9h4a, text_mm2ymtsk, text_mm2yhpjt, text_mm2yb3rv, text_mm2ybk06 (attempts recorded). (9) provider-tagged calls after G6 | MN; gateway | Proxy: attempts recorded, not calls made | — | Leadership |
| B-06 | M | 1.2.5 | Inbound clinicals | Count of MN color_mm1y8rv8 → 1 (MR Received) events per week; lag = `bh(→ 1, next MN stage event)` p50. **Backlog: NOT TRACKED** (no "reviewed" signal exists) | MN | | — | Masheke |
| B-07 | M | 1.2.2 / 1.2.4 / 1.2.5 | Inbound volume by channel | FAX board items created per week per group (Faxes, Calls, Text Messages, Miss Voicemails), and the current "never closed" count per group (status 0) labelled "status unreliable: 94% never closed" | FAX 18398061249 | Includes non-onboarding traffic. No owner. A zero week raises DH-15 | — | Leadership |

| ID | Ph | Name | Formula | Source | Status rule | Matters to |
|---|---|---|---|---|---|---|
| C-01 | M | Codes with no documented processor | Count of the 20 codes with no processor in `documentedOwners` (8 today). In merged-chase mode, 1.1.2.4 is "partially owned" and counts as unowned until Fax has a documented owner | config | **Finding** state (not red): structural, changes only when the org changes | Brandon |
| C-02 | M | Codes with no live processor | Count of codes whose live owners (§3.10) include no processor-tier person (7 today: 1.1.3.5, 1.1.3.6, 1.1.4.1, 1.1.5.1, 1.2.1, 1.2.3, 1.2.4), with each code's live handlers by tier | access.json | Finding state | Brandon |
| C-03 | M | Unowned work aging | Current QUEUE WIP, oldest, and p50 age in C-02 codes; **plus**, as a count (not a status), how many items whose originating code (E-01) is a C-02 code are held in an escalation bucket. Example: "1.1.3.5 Auth Denial: 0 in queue, 25 held in Janelle's bucket". Escalation buckets are owned by Janelle and Katie; dead leads are an outcome | holder state | **Red** if any C-02 item is over its red threshold; yellow if over yellow | Brandon, managers |
| C-04 | M partial / 7 | Who works unowned codes | W-04 restricted to C-02 codes and to escalation transitions, by tier (processor, manager, leadership, automation, unattributed) | §3.10.1 | — | Brandon |
| C-05 | M | Byproducts without manager or staff | Byproduct codes with no `stageManagers` entry (5 of 5) and with no live processor (1.2.1, 1.2.3, 1.2.4) or not tracked (1.2.3) | config | Finding state | Brandon |

### 3.13 Data health
| ID | Name | Formula | Threshold | Affects views |
|---|---|---|---|---|
| DH-01 | Missing UID | Share of MN, INS, WC in-pipeline items with a blank UID | Yellow > 2%; red > 10% | Exec (S-01), Pipeline, Patient |
| DH-02 | Duplicate UIDs | UIDs with > 1 item on the same board | Yellow > 0 | Exec, Patient |
| DH-03 | Non-UUID UIDs | Count | Info | Patient |
| DH-04 | Synthetic spans | Share of current items whose open span is synthetic (R3) | Yellow > 5% | All |
| DH-05 / 05b | Deleted items | Deleted items with events / deleted while parked | Info / yellow > 0 | Exec |
| DH-06 | Bucket mismatch | Open items whose color_mm1wwm05 bucket ≠ the computed calendar-day bucket | Yellow > 5% | Pipeline |
| DH-07 / 07b | Arrival problems | Arrival > release / arrivalSource first_item | Yellow > 0 / info | Exec |
| DH-08 | Excluded INT items | Items in INT non-pipeline groups, and how many carry an escalation flag | Info; yellow if flagged > 0 | Exec, Managers |
| DH-09 | Hand-off gaps | Exits with no next-board item for the UID within 1 bh | Yellow > 0; red > 5 | Pipeline |
| DH-10 | Attribution coverage | Share of non-automation transitions with an attributed person | **Prototype:** informational (no color), showing the observed share. VERIFY-2 V3 measured 0-8% (INS 7-8%, WC 5%, MN 2%, INT < 1%, escalations on MN/WC 0%), so prototype person metrics are labelled "too little attribution to rank people" when coverage < 50%. **Phase 7:** yellow < 80%, red < 50% (judgment: below 80% person-level metrics are directional) | People, Managers |
| DH-11 | Stale queue items | Current **QUEUE** items (parked items have their own tiles) with no tracked-column event for 7 / 14 / 30 bd | Yellow if any 14; red if any 30 | Pipeline |
| DH-12 | Group/label mismatch | Current items whose group is not in `expectedGroups[board][stage label]`, and escalation 0/2 items not in an allowed group (Appendix A) | Yellow > 2% | Pipeline |
| DH-13 | Freshness | Age of snapshotAt | Yellow > 10 min; red > 60 min | All |
| DH-14 | Missing key fields | Blank MN color_mm1xw7y5; blank MN and WC date_mm1wf43j | Yellow > 5% | Pipeline |
| DH-15 | Inbound feed gap | A full week in the last 12 with 0 FAX items | Yellow if any; red if the latest full week is 0 | Byproducts |
| DH-16 | History/current mismatch | Items whose current stage or escalation value ≠ the last logged value (R3) | Yellow > 2%; red > 10% (PROPOSED) | Exec, Pipeline, Managers, Patient |
| DH-16e | Escalation history mismatch | Current MGR/FINAL items whose escalation value ≠ the last logged value, or which have no escalation event (the escalation start is unknown) | Yellow > 0; red > 2 items | Exec, Managers |
| DH-17 | Bulk changes | Bulk events in the period (time, user, transition, items) | **Yellow** if any bulk event in the period moved items **out of** MGR/FINAL (to QUEUE, STUCK, or EXITED) or **into** STUCK. Otherwise Info (always listed) | Exec, Managers |
| DH-18 | Import cohorts | Items inside import windows | Info | Exec |
| DH-19 | Stale escalation flags | EXITED items with escalation 0 or 2 (MN 3, INS 33 today) | Yellow > 0 | Managers |
| DH-20 | Unmapped labels | UNMAPPED segments | Yellow > 0 | Pipeline |
| DH-22 | Board history freshness | Per board: age of the committed event cursor and the count of `fetchErrors` this refresh | Yellow if any board's cursor is older than 2 × refreshMs; red if older than 60 min. When set, that board's loop, escalation, and speed tiles carry the caveat "history stale for <board>" | All |
| DH-21 | History horizon | Age of the oldest event needed by a 90-day period plus open items, vs Pro retention (365 days; VERIFY-1 V2) | Yellow > 300 days; red > 350 | All |

**Baseline acceptance.** `config.dataHealthBaseline` holds `{id, acceptedValue, acceptedOn, note}`. A DH row at or below its accepted value shows "Known (accepted <date>)" in grey and does not color the chip. It colors only when it worsens past the accepted value.

### 3.14 Health rule, thresholds, waiting-on, and the Brandon confirmation list
**3.14.1 Health status (one rule).**
- **Code and stage health** use **active queue work only** (QUEUE segments). Escalated items (MGR, FINAL) and dead leads (STUCK) never enter code or stage health. Escalation buckets have their own tiles (E-01, E-02, E-06) with `holderThresholds`. Dead leads (A-04) have a neutral count-and-trend tile with no alarm.
- For a code with yellow and red thresholds:
  - **NO-DATA** (grey "—", the word "No data"): completed n < minSample **and** queue WIP = 0, or the source is not connected.
  - **RED** ("Breaking", ✕): p50 of segments completed in the period > red; **or** the share of current non-snoozed queue items over red ≥ 15%; **or** any non-snoozed queue item > 2 × red.
  - **YELLOW** ("At risk", !): not red; p50 > yellow, or the share over yellow ≥ 25%.
  - **GREEN** ("Healthy", ✓): otherwise.
- **Unknown-age guard (escalation buckets only):** for the MGR and FINAL tiles, L-03 rows for MGR and FINAL, the escalations panel, and Held items groups 1-2, **any** open item with a synthetic hold caps the status at **! At risk** ("age unknown for k of n"), unless the known items already give Red. `config.health.maxUnknownShare` is 0.25 for queue codes; for escalation buckets, `config.health.maxUnknownShareEscalation` is 0. STUCK never uses the guard: synthetic dead-lead ages show as "up to N bd" with the neutral Outcome status.
- **Stage** status = worst of its codes.
- **Escalation bucket tiles** (MGR = Janelle, FINAL = Katie; known holds only, subject to the unknown-age guard). Per item, age = the **continuous escalation hold** (E-02); loop age is shown as an annotation ("N bd in loop") and feeds E-06 and L-01a, never limbo (D-35):
  - **Red** if any open item is over 2 bd (**in limbo**).
  - **Yellow** if any item is over 1 bd.
  - **Green** otherwise.
  - Each tile shows the limbo count, the oldest item, the change vs prior period, and "new this period".
- **Dead leads (STUCK)** show the status word **"Outcome"** (◇, neutral): never red or yellow, and never counted as "need action".
- **Finding** state (◆ "Finding", neutral outline): structural facts (C-01, C-02, C-05, W-05). Never red or green.
- **Proposed tag:** every threshold has `confirmed: false` until Brandon confirms. Any status computed from an unconfirmed threshold shows a small "proposed" tag (icon plus word) next to its status word. The exec header shows "Targets are proposals: N of M awaiting CEO confirmation".

**3.14.2 Waiting-on** (S-06, A-05), computed from the holder state first:
- MGR or FINAL → **"us: manager decision"**
- STUCK → **"dead lead (closed)"**: shown as its own bar; it is an outcome, not waiting. G11 (Stuck Category) is optional, to record why leads died.
- QUEUE → `config.waitingOn[code]`, from {"us: processor", "provider", "payer", "patient", "patient or referral source"}.
- INT color_mm1zmeb3 = 3 → "patient or referral source".
- All mappings are proposals. Rows marked † need Janelle or Emily to confirm.

**3.14.3 Threshold table** (bd; all NEEDS BRANDON CONFIRMATION). Observed medians are from TIMESTAMPS.md (activity log, all history) and PINGPONG.md. "Judgment" means no measured basis.
| Key | Yellow | Red | Waiting on | Observed basis | Reasoning |
|---|---|---|---|---|---|
| 1.1.1.1 Information Collection | 1 | 3 | us: processor† | none measured | Judgment: next-day handling; red allows for referral back-and-forth |
| 1.1.1.2 Profile Clean-Up | 1 | 2 | us: processor | none | Judgment: internal fix-up |
| 1.1.1 (unsplit, pre-2026-08-19) | 2 | 4 | us: processor | none | Sum of the above |
| 1.1.2.1 Evaluate MN | 0.5 | 1 | us: processor | median 3.0 h (Evaluate → Send, n = 728) | Yellow is ~4× median (same-day work); red is one full business day |
| 1.1.2.2 Send Request | 0.5 | 1 | us: processor | median 5.2 h / 3.5 h (Send → Confirm / Chase) | Same as above |
| 1.1.2.3 Confirm Receipt (Fax) | 1 | 3 | provider | none for the exit | Judgment: one day for the office to confirm, three before escalation |
| 1.1.2.4F/P Chase Clinicals | 5 | 10 | provider | none | Judgment: provider record turnaround is typically 1-2 weeks |
| MN-DA Doctor Appointment | 10 | 20 | provider | none | Judgment: appointment lead times |
| 1.1.3.1 Benefits Check | 0.5 | 1 | us: processor | Benefits/SoS → Submit median 1.4 h (n = 362) | Same-day work |
| 1.1.3.2 Auth Check / SoS | 0.5 | 1 | us: processor | included above | Same-day work |
| 1.1.3.1+2 (combined) | 1 | 2 | us: processor | 1.4 h | Sum |
| 1.1.3.3 Submit Auth | 0.5 | 1 | us: processor | none | Same-day work |
| 1.1.3.4 Auths Outstanding | 5 | 10 | payer | median 43.2 h ≈ 1.8 bd (n = 212) | Yellow ~3× median; red is two business weeks |
| 1.1.3.5 Auth Denial | 1 | 3 | us: processor† | none | Judgment: decide on remediation quickly |
| 1.1.3.6 Auth Remediation | 5 | 10 | payer† | none | Same as auths outstanding |
| 1.1.4.1 Welcome Call | 2 | 4 | patient | median 25.8 h ≈ 1.1 bd (n = 449) | ~2× and ~4× median |
| 1.1.5.1 Final Profile Confirmation | 0.5 | 1 | us: processor | median 7.4 h (n = 361) | Same-day check |
| Holder STUCK (dead leads) | — | — | dead lead (closed) | open median ≈ 1158 h (≈ 48 cd) | Not an alarm (Brandon CR B): count and trend only |
| Holder MGR (Janelle's bucket) | 1 | 2 | us: manager decision | completed median 277 h (MN), 477 h (INS) | **Brandon-set, confirmed**: resolve within 1-2 bd; over 2 bd = limbo |
| Holder FINAL (Katie's bucket) | 1 | 2 | us: manager decision | MN completed median 101 h | **Brandon-set, confirmed**: resolve within 1-2 bd; over 2 bd = limbo |
| Stage 1.1.1 Intake | 2 | 4 | | | Stage medians do not add up to the end-to-end target, because time-in-stage includes parked time and percentiles are not additive. Stage thresholds are set independently |
| Stage 1.1.2 Medical Necessity | 5 | 10 | | | |
| Stage 1.1.3 Insurance | 5 | 10 | | | |
| Stage 1.1.4 Welcome Call | 2 | 4 | | | |
| Stage 1.1.5 Final Confirmation | 0.5 | 1 | | | |
| S-01 end-to-end p50 / p90 | 10 / 20 | 15 / 30 | | Not yet measured (needs G1 for a true start) | Judgment pending Brandon's confirmation of the promise to partners |
| F-04 net-flow ratio | +0.20 | +0.40 | | | Judgment |
| W-03 days of work in queue | 5 | 10 | | | Two business weeks |
| B-02 withinPct | < 90% | < 75% | | CC's 24 h SLA | Reuses CC's SLA definition |
| L-01 open items in loops | ≥ 1 | ≥ 10, or any item with revisits ≥ 5 | | 56 items with ≥ 2 A→B→A today (PINGPONG) | Judgment |
| Holidays | — | — | | — | Proposed list in Appendix A; Brandon confirms which days the company is closed |
Health shares: yellowShare 25%, redShare 15%, minSample 5.

**3.14.4 Brandon confirmation list** (shown in the app under "Targets" and in HANDOFF). It is in two parts: **(a) judgment-only** rows (Observed basis = "none" or "judgment"): 1.1.1.1, 1.1.1.2, 1.1.1, 1.1.2.3, 1.1.2.4F/P, MN-DA, 1.1.3.3, 1.1.3.5, 1.1.3.6, all stage rows, S-01, F-04, W-03, L-01; **(b) observed-basis** rows: 1.1.2.1, 1.1.2.2, 1.1.3.1, 1.1.3.2, 1.1.3.1+2, 1.1.3.4, 1.1.4.1, 1.1.5.1, B-02. Also: plus `clock`, `holidays`, the D-04 split recommendation, the `waitingOn` mappings marked †, `capacityPerWeek` (optional). Already confirmed by Brandon (CR B): escalation holder thresholds (1/2 bd) and `holderOwners` (Janelle, Katie). Current defaults for everything else are in project/ASSUMPTIONS.md.

### 3.15 Hand-off loops (generic; covers Finding F-1 and any other loop)
**Loop basis.** Each item has a sequence of holder states h0, h1, …, hn: its holder spans after merging, **excluding spans with `startBulk=true`** (the neighbouring non-bulk spans are joined, so QUEUE → [bulk MGR] → QUEUE is one QUEUE visit).
- **Revisit:** index i is a revisit if h[i] appeared anywhere in h[0..i−2]. This catches A→B→A, 3-cycles (QUEUE → MGR → FINAL → QUEUE → MGR), and longer cycles.
- Forward progress (QUEUE:1.1.2.1 → FINAL → QUEUE:1.1.2.2) is **not** a revisit, because QUEUE:1.1.2.2 is new.
- **A→B→A count (ping-pong):** indexes with h[i] = h[i−2]. This is a sub-measure that reconciles to the scout's figure (56 items with ≥ 2 on 2026-10-01) within the documented differences: QUEUE is per code here, versus NORMAL there.
- **Loop pattern key** for grouping (L-04): the holder **type** plus board ("QUEUE:MN ⇄ FINAL:MN"). The codes involved are listed inside the row, so one loop is not split into many.
- **Loops are between workflow states, not people.** monday has no per-item assignee and 99% of escalation writes come from the shared token. Person-level loops come from L-05 (prototype: direct monday edits only; full in Phase 7). Every loop panel shows this sentence.

| ID | Ph | Name | Meaning | Formula | Source | Edge cases | Matters to |
|---|---|---|---|---|---|---|---|
| L-01a | M | Open items in loops | Items circling now | Current non-EXITED, non-STUCK items with revisits ≥ `config.loops.minRevisits` (2, NEEDS BRANDON CONFIRMATION) where at least one revisit happened in the last `config.loops.windowBd` (28) bd, or the item is currently MGR or FINAL after a revisit. Dead leads that once looped are shown as a neutral separate count ("{n} dead leads had looped"), never in L-01a | Holder spans | Bulk excluded; minSpan merge rule (§3.2.2) | Brandon, managers |
| L-01b | M | Items that started looping in period | Trend | Count of items whose revisit count reached minRevisits in the period | | | Brandon |
| L-02 | M | Revisits per item | How many times an item came back | Revisits (and the A→B→A count) per item and per journey | | Cross-board re-creation is Q-01b, not L-02 | All |
| L-03 | M | Time with each holder | How long items sit with each holder: Janelle's bucket, Katie's bucket, queues, dead leads | Per holder type and board: open count, oldest **continuous hold** (E-02 rule), p50 open age, plus total hold time per journey (sum of all MGR, FINAL, and STUCK spans); completed-span p50 and p90 are secondary | Holder spans | Status per §3.14.1 holder rule | Brandon, managers |
| L-04 | M | Loop patterns | Which loops happen most | Group revisit transitions by pattern key: items, revisits, p50 dwell on each side | | Top 5 shown on exec | Brandon |
| L-05 | M partial / 7 | Who pushes and who returns | Per person: proposals (→ FINAL), escalations (→ MGR), returns (FINAL → QUEUE), approvals (FINAL → STUCK), hand-downs (FINAL → MGR), clears (→ null) | Transitions attributed per §3.10.1. INS approve and return write the escalation as null (clear) and are told apart by the next holder state (STUCK = approve) within ±120 s on the same item (VERIFY-0c write semantics) | activity log; gql_log | Shared-token rows show as "unattributed" | Brandon (who pushes and returns) |
