# Review checklist (Brandon and Josh)

### 10.1 Review checklist (also docs/onboarding-oversight/REVIEW-CHECKLIST.md)
- **Correctness:**
  - Pick 3 item IDs from ItemList and compare their holder history with monday's item activity log.
  - Run T-REC and T-REC-2.
  - Check S-01's arrivalSource split.
  - Recompute one percentile by hand from the CSV.
  - Check that the F-1 table on live data matches §2.11 within a day's drift.
- **Read-only:** T-RO green; grep the diff for `mutation`; no `public/data` writes; review in gateway mode (§5.7).
- **Performance:** §6.8 rows measured and recorded; route chunk size from `vite build`.
- **Edge cases:** the HS, CR, J, and LP cases above; weekend and holiday spans.
- **Extensibility:** follow one recipe from §10.6 on a scratch branch.
- **UX:** §6.9 protocol; grayscale screenshots; 360 px screenshot shows all five answers.


### 10.2 Risk areas
1. **UID join quality** (blank, duplicate, non-UUID; written by an external automation). Alarms: DH-01, DH-02, DH-09.
2. **monday label drift** (a deleted and re-added label changes its index). Alarms: DH-20, DH-12. RUNBOOK R-2.
3. **Retention:** Pro keeps about 1 year; DH-21; BL-01 by 2027-02-01.
4. **Attribution:** mostly the shared token until Phase 7; W-04 and L-05 are partial.
5. **Current-value metrics** (Auth Result, MN established, snoozes) have no history.
6. **Thresholds** are proposals until Corey confirms them.
7. **Shared monday complexity budget** with the reps: the complexity floor (§5.2).
8. **Group-only moves:** the group-move query plus the byGroup flag; synthetic fallback.

