# Known limitations

### 10.4 Known limitations (KNOWN-LIMITATIONS.md)
- KL-01: End-to-end time starts at MN entry until G1 (§3.3).
- KL-02: Per-person attribution: rule 1 (direct monday edits) and, since 2026-10-02, rule 2 (Command Center writes named from the gateway's write log via `GET /oversight/app-actors`, `model/appAttribution.ts`). The header shows the share of Command Center actions named. Group moves made by the app carry no column and stay unattributed. Loops are still between workflow states, not people.
- KL-03: Chase channel uses the Clinicals Method value at span start, from events or `fromIndex`, else the current value.
- KL-04: Current-value metrics (I-06, M-06, snoozes) do not reflect history.
- KL-05: INT Intake Sub-Stage history starts 2026-08-19 and Escalation 2026-08-06; earlier INT time is "1.1.1 unsplit"; earlier flags are synthetic.
- KL-06: Group-only moves are detected for Stuck and Escalations groups only. Whether moves *into* a filtered group are returned is unverified; the synthetic fallback applies.
- KL-07: Provider emails (1.2.3) are not tracked until G5. Provider calls (1.2.4) are a proxy until G6.
- KL-08: FAX board volume includes non-onboarding traffic, and its status is unreliable.
- KL-09: B-02 (/comms/sla) covers all inbound comms, not onboarding only.
- KL-10: Thresholds and the holiday list are proposals.
- KL-11: Activity retention is about 1 year (Pro); BL-01 needed before 2027-02-01.
- KL-12: Snoozed state is known only for the present, not historically.
- KL-13: The limbo headline counts only escalations with a known start. Escalation history starts 2026-08-06 on INT, so many INT escalations are "age unknown" and are shown as "+k age unknown" beside the headline until their starts are known.


## Prototype-specific (Phase M branch)
- P-1: METRICS.md is copied from the spec, not generated from a metric registry (spec T4.14).
- P-2: Lineage is shown as metric IDs and footnotes, not a per-number popover (spec §6.0 LineagePopover).
- P-3: Charts are a simple CSS trend strip, not recharts; no "view as table" toggle beyond the tables shown.
- P-4: Load budgets (§6.8) and the ten-second usability protocol (§6.9) were not measured; screenshots are from fixture mode.
- P-5: Phases 7-9 (gateway attribution and comms endpoints, monday gap fixes, provider comms logging) are not built; their tiles say so.
- P-7: Not built in the prototype (tiles are absent rather than wrong): metric registry and per-number lineage popover; config.schema.ts (zod) and config tests CF-1..6; M-02 attempt levels; A-02 top-10 list (the Held items panel and item lists cover it); W-04 per-person ranking (blocked by attribution coverage 0-8%); I-07 (needs gap G3); B-04 (needs G5); full data-layer test set (FA-1..5, FI-1..6, GQ-2..4, J-1..10). Built and tested: FA-4 cursor safety, CA-4 reset safety, HS-13, label/group lag, text-label parsing.
- P-9: E-03 shows p50 per outcome (no p90); E-04 is a period total, not per week per board.
- P-10: Post-freeze change requests CR-3..CR-7 (spec §11) are implemented in the prototype and need Brandon's acceptance.
- P-8: Reconcile panel compares raw label counts with the dashboard's holder classification inside the app; comparing with monday's own board filter is a manual step (T-REC).
- P-6: On a 360 px phone, Command Center's global header (search box) is wider than the viewport; that is pre-existing CC behaviour, outside this change.

## Round 8 (levels 1-3)
- **KL-R8-1** Evidence of our actions is monday only until Command Center call/text/fax logs are joined (Phase 7, T7.3): a chase done only in CC reads as "no chase", so "on us" can be overstated.
- **KL-R8-2** Days in step reset when a patient moves to another queue step; repeats show on the patient page (⟲, collapsed loops) and escalation trips in the decider table.
- **KL-R8-3** The 6-week trend uses today's norms; bulk closes or moves to Stuck lower the share late. Ball in court is not rebuilt for past weeks.
- **KL-R8-4** ~~Shared queues are split evenly between role holders~~ Since 2026-10-02 "Worked" is credited to the named person (rules 1-2); unnamed work shows as "Not named". "New/day" is still credited to the step's owner.
- **KL-R8-5** Normal times come from finished visits (survivorship); open medians are listed beside them in the spec's AS-15.
- **KL-R8-6** Clean-up patients (open on an earlier board after moving on, released, or duplicated) are never late; a wrong duplicate can hide a late patient. They are listed under the header ⚠.
- **KL-R8-7** Command Center's global header is not phone-width; on this route only its search box is hidden under 600 px.
