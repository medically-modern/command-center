# Decisions

Copied from BUILD-SPEC v1.0 FROZEN §11. Threshold confirmations by Brandon are recorded here with dates.

## 11. Decision log
Format: ID · question · options · decision · why. Change requests after freeze are added as CR-n with what, why, and impact.

| ID | Question | Options | Decision | Why |
|---|---|---|---|---|
| D-01 | Which repo? | command-center, command-center-test, experiments | command-center-test | It is the source of truth; prod is a force-push mirror; experiments is stale (§2.9) |
| D-02 | Where to compute metrics | Browser; gateway precompute; CI JSON in public/data | Browser, pure functions, IndexedDB cache | Matches the existing pattern, needs no new server for A-F, keeps code testable; public/data is world-readable |
| D-03 | Source of stage durations | "Days Since Stage Started" buckets; Date of Stage Start; activity_logs | activity_logs | Exact timestamps, full history, re-entries; buckets are coarse and calendar-based |
| D-04 | Split 1.1.2.4 into Fax and Parachute? | Split; merge | **Split, recommended; needs Brandon's confirmation**. Fax = CC chaseFax queue (not Parachute, Email, or Dashboard; blank = Fax); Parachute = Parachute, Email, Dashboard (CC isParachuteRoleMethod). `splitChaseClinicals=false` merges them, and C-01 then counts 1.1.2.4 as unowned until Fax has a documented owner | The two channels have different live owners (Madeline vs Masheke), and the taxonomy says to split if owners differ. Matching CC's predicate makes dashboard queues equal the queues people work |
| D-05 | Business vs calendar time | business elapsed; 9-5; calendar | Business elapsed (weekends and holidays excluded), plus calendar days shown beside S-01 and A-03. The clock and holidays NEED CEO CONFIRMATION | Weekends would dominate provider and payer waits; partners think in calendar days, so both are shown |
| D-06 | Referral arrival | INT created; MN Date of Intake; Referral Received Date | Precedence §3.3; honest label until G1 | VERIFY-0b: MN Date of Intake = MN creation date, so it is not arrival; INT link is weak |
| D-07 | Stuck time | Separate; under the stage | Counted in stage time (S-03); shown as "of which stuck" | Leadership cares about elapsed time; separation keeps the cause visible |
| D-08 | Owner of record | taxonomy; assignments.json; access.json; observed | Documented = taxonomy; **live = access.json roles + callAnswerers** (assignments.json is legacy and unread); observed = §3.10.1 attribution; mismatches are Findings | VERIFY-1 V5 and V12: access.json is CC's source of truth. Round-1 blockers (architect #2, coo-ops #1) |
| D-09 | Partial Leads (1688) | In pipeline; count only | Count only (DH-08) | Unfinished web forms, not referrals; would swamp WIP |
| D-10 | INS 1.1.3.1 vs 1.1.3.2 | Merge; split by marker column | Split at the first DME Benefits? event, combined row when not separable | Keeps both taxonomy codes visible without asking processors to change anything |
| D-11 | 1.1.3.6 Remediation | Not shown; derived | Derived (re-submit after denial) | No label exists; derivation needs no process change; G8 optional |
| D-12 | New nav ability vs manager gate | New Ability; reuse manager check | Reuse manager check | Same audience as /oversight; avoids touching ability plumbing and lossless tests |
| D-13 | Refresh cadence | 60 s; 5 min | 5 min plus manual | Oversight, not dispatch; reduces API load |
| D-14 | Feature branch vs push to main | CC/CLAUDE.md says push to main | Feature branch plus draft PRs | The brief (Corey) requires review before anything reaches live; Brandon's Phase M confirms |
| D-15 | Patient names in dashboard | Show; IDs only | IDs only in this dashboard; link out to the existing patient screen | Brandon's Phase M rule; keeps CSV exports clean |
| D-16 | Generalized hand-off loops | Hard-code "proposed stuck"; A→B→A only; revisits over holder states | Revisits over holder states (catches 3-cycles), with A→B→A as a sub-measure; recency window; bulk filtering | Brandon's lead; red-team #3, #7, #8 |
| D-17 | Server-side precomputed exec payload for phone cold loads | Build now; items-only first paint now and precompute later | Items-only first paint now; precompute = BL-01 | Keeps the prototype server-free (Phase M); BL-01 is already needed for retention |
| D-18 | Item state model | Segments with parking under owner code (v0.1); exclusive holder states with EXITED first and current value winning | Holder states (§3.2.2) | Round-1 blockers red-team #1 and #2: stale flags on exited items and log/current gaps |
| D-19 | Code health includes parked items? | Include; separate | Separate: code health = active queue work; parked items have holder tiles | coo-ops #8: otherwise every code is red forever and the wrong code is blamed |
| D-20 | Overdue | Age only; age and not snoozed | Age over red and not snoozed (CC queue snooze rules) | coo-ops #9: do not blame processors for deliberate snoozes |
| D-21 | Overload without capacity data | Per-person capacity from attribution; queue days-of-work | Days of work per queue (W-03); a person is overloaded only as sole processor; optional capacityPerWeek | No per-person attribution exists; coo-ops #10 and ux-exec #5 |
| D-22 | Comms response | Wait for Phase 7; use existing /comms/sla | Use /comms/sla now (read-only GET; labelled "all inbound comms"), with CC's 24 h SLA definition | coo-ops #11: no second SLA definition |
| D-23 | Local review mode | npm run dev (direct monday, write-capable token); gateway mode | Gateway mode (`--mode production`) plus fixture mode | VERIFY-1 V3 |
| D-24 | Escalation thresholds | Separate per metric; one set | One `holderThresholds` set used by A-04, E-*, L-03 | architect #9, coo-ops #7 |
| D-25 | Bounce-back definition | All backward moves; exclude designed remediation | Exclude 1.1.3.5 → 1.1.3.6 (`reworkExclusions`); cross-board re-creation is a separate count (Q-01b) | coo-ops #14, architect #7 |

### Change requests raised by the Phase M prototype (adopted in D-34)
| CR | What | Why | Impact |
|---|---|---|---|
| CR-1 | Test LP-19's expected result is wrong: the C1 loop-age formula gives a **small** loop age that starts at the new FINAL visit, not null. The current open FINAL is itself a revisit of the item's earlier FINAL. Proposed text: "loop age = bh(start of the new FINAL); below the FINAL red, so the tile is not red from loop age". | The formula and the test disagreed; the prototype follows the formula (it is consult C1's intent). | Test text only; behaviour as C1 designed. |
| CR-2 | R2 refinement: for MN, INS, and WC, when the first stage event has no previous value, the value before it is taken to be that event's value. Otherwise there is a phantom zero-length span of the board's first code, because automation sets the first stage at item creation. Zero-length spans are dropped. | Found by tests TL-2, CR-1, and CR-5 on realistic event shapes (first set has previous_value = null in 35-97% of events, TIMESTAMPS). | No metric definition changes; it removes spurious re-entries and phantom codes. |

### Brandon CR B applied (v0.5)
| ID | Question | Decision | Why |
|---|---|---|---|
| D-30 | What is "Stuck"? | Stuck = dead lead: an intentional outcome, shown as a count and trend, never an alarm or "need action" | Brandon CR B |
| D-31 | Who owns escalations, and what is the target? | Escalation idx 0 = Janelle's bucket (Manager Intervention), idx 2 = Katie's (Final Decisions). Resolve within 1-2 bd to Stuck or the queue; over 2 bd = limbo (red), over 1 bd = yellow. Thresholds confirmed by Brandon | Brandon CR B; verified against CC chart columns (AS-04) |
| D-32 | Escalation hold clock | The continuous escalation hold runs over MGR/FINAL only; a move to STUCK ends it (a resolution) | Follows D-30 |
| D-34 | Prototype change requests CR-1 and CR-2 | Adopted: LP-19 expects a small loop age from the current revisit run; R2 first-event rule plus zero-length span drop | architect R4-5 |
| D-35 | What counts as limbo | Only the known continuous escalation hold (> 2 bd). Loop age is an annotation feeding "bouncing" (E-06, yellow). Unknown ages are shown beside limbo, never dropped | architect R4-2, red-team R4-3, coo-ops R4-2: Brandon's rule is about the current escalation; churn has its own metric |
| D-36 | Can dead leads hide limbo? | A-04 shows how dead leads arrived (via escalation vs straight from queue), bulk moves, revivals, and spikes; still no colour | red-team R4-1 |
| D-37 | Bulk and dead-lead reset paths | DH-17 yellow on bulk moves out of escalation or into STUCK; E-03 "ended by bulk"; STUCK → MGR/FINAL counts as a revival and re-escalation (bouncing); R2 inference only when the first event is at creation (60 s), else synthetic | red-team R5-1..4 |
| D-38 | Revivals after a bulk dead lead | Revival detection uses unfiltered spans; LIM-7b | red-team R6-1 |
| D-33 | Escalation bounce metric | New E-06: returns from escalation that were later re-escalated | Brandon CR B ("how often items bounce between escalation and queue") |

### Round 3 resolution (v0.4); Brandon CR (v0.5)
- Round 3 (final) on v0.3: **APPROVE** from architect, coo-ops, ux-exec, and coverage-auditor; **APPROVE WITH CHANGES** from red-team (3 IMPORTANT). All round-2 issues were ACCEPTED and CLOSED.
- The Quarterback accepts all three red-team issues and fixed them in v0.4:
  - R3-red-team-1: banner Healthy requires DH-13, DH-16, and DH-22 not red; EX-15.
  - R3-red-team-2: unknown-age guard `maxUnknownShare`; LP-17.
  - R3-red-team-3: loop-age formula with a worked example; LP-18.
- Editorial backlog notes also applied: R3-architect-1/2/3 (§2.4 group-move sentence; EXITED start; groupMoves lookback 45 days for cost) and R3-coo-ops-2 (footnote).
- Brandon's change request (2026-10-01) removed the round cap and the escalation path; rounds continue until unanimity. ESCALATION.md was deleted and its open decisions became project/ASSUMPTIONS.md (AS-01..AS-09).
- D-29 Unknown-age guard: a holder tile with > 25% open synthetic ages cannot be Green. Why: red-team R3-2.
- **Consult C1 (deep-thinker, trigger 4):** the v0.4 fixes had three defects, now patched: DH-16 had no red threshold (added, PROPOSED 10%); the guard wording; loop age anchored to the first-ever revisit (false red, plus an undefined all-queue case; now anchored to the current revisit run). Recommendation adopted: ask Corey for one scoped red-team confirmation pass (not a unanimity waiver); Phase M proceeds under the DRAFT banner.

### Round 2 resolution (v0.3)
- All round-1 issues were ACCEPTED by their raisers and are CLOSED.
- 22 new round-2 issues (1 BLOCKER, 21 IMPORTANT) are all fixed in v0.3. Facts were settled by VERIFY-2 (snapshot/VERIFY-2.md): group-move data shape and filter direction, bulk calibration (5 s), attribution share (0-8%), INT Stuck split, FAX aggregate shape.
- Architect's backlog notes were also applied: referralSource string keys, the §2.1 FAX scope line, FAX fallback fetches status, `to` pinned per refresh, test IDs DT-n, T3.5 depends on T3.6.
| ID | Question | Decision | Why |
|---|---|---|---|
| D-26 | Bulk window | 5 s, or `is_batch_action`, or an operator window | VERIFY-2 V2: 60 s also caught paced automation and shared-token runs |
| D-27 | Group-move source | Query every in-pipeline source group; use `dest_group`/`source_group` | VERIFY-2 V1: the filter returns moves out of a group only, and `group_id` is the source |
| D-28 | Synthetic ages | Upper bounds; never drive status | red-team R2-1 |

### Round 1 resolution (v0.2)
All 8 BLOCKER and 65 IMPORTANT round-1 issues were triaged. Each ledger row (project/LEDGER.md) gives the resolution. None was rejected outright. Partial acceptances: ux-exec #3 (server-side precompute deferred to BL-01; D-17) and coo-ops #10 (per-person capacity replaced by queue days-of-work; D-21). Factual doubts were resolved by scout VERIFY-1 (snapshot/VERIFY-1.md).

### Self-review log (Phase 2, v0.1)
Checked against BRIEF §8 and §9 Phase 2 questions and REVIEWER-RULES:
- **Every taxonomy code appears?** Yes. §2.7 maps all 20 rows; §3 metrics cover every code; the Pipeline view lists 15 pipeline rows and the Byproducts view 5.
- **Every metric has a data source?** Yes, or it is explicitly NOT TRACKED with a gap ID (B-04 → G5).
- **8 unowned codes handled?** C-01 (documented), C-02 (live), C-03 (aging), C-04 (who works them, Phase 7), the UNOWNED pill in Pipeline, the exec tile.
- **Roadmap executable?** Each task has files, inputs, done-means, dependencies, effort, and tests.
Fixes made in self-review:
1. FAX fetch defined (date-rule query, no column values, hourly).
2. W-01 counts only rep-queue items, processor-tier first, with the Maddie alias.
3. Added missing config keys (columns, expectedGroups, ignoreEventWindows, aliases, holderOwners, loops, holderThresholds, faxRefreshMs).
4. L-05 added to T7.2.
5. E-01 INT scope clarified.
6. T-REC labels made exact.
7. Phase M scope stated (Phases 1-6).
8. B-02 resolver reuse.
9. Known-limitations list added (§10.4).
10. Chase channel uses the channel at segment start (consistent with CR-7 and G10).
11. Naming normalized (1.1.3.1+2).
12. BT-2 expected value corrected (16 bh).
13. Arrival precedence rewritten after VERIFY-0b.
14. Finding F-1 and §3.15 added (Brandon lead).
15. FAX board added (Brandon scope change).

## CR-8 to CR-13 (2026-10-01 evening; see the spec decision log D-39 to D-55)
- D-39/D-48/D-49/D-50/D-52: three levels; the Overview is a handful of numbers and one row per stage; DESIGN-INTENT.md wins over earlier CRs.
- D-45/D-46: manager list and patient page in the spirit of the referral-partner tracker; all wording in labels.ts.
- D-51: normal time and attempt norms per step (real dwell, anchored to Brandon's examples); ball in court from waiting-on party plus our last action against a cadence.
- D-53: #1 = most late patients on us; "Late, on us" counts queues, "Decisions overdue" counts Janelle/Katie, so they never overlap.
- D-54: one definition per level (spec §3.19); norms govern levels 1-3 and Team.
- D-55: no grace: late = shown days (0.1) > normal for every step.
