# Architecture

```
Browser (Command Center SPA, existing Google auth)
  /onboarding-oversight (manager-gated) ─ views A-F render a Dashboard model
     metrics/dashboard.ts ◄ metrics/* (pure) ◄ model/ (timelines → holder spans → journeys) ◄ data/
     data/cache.ts: IndexedDB "onboarding-oversight", key = schemaVersion + hash(tracked columns)
        │ read-only GraphQL (mutations refused)          │ GET /comms/sla (existing, read-only)
        ▼                                                ▼
  monday-gateway POST /gql (existing, server token) ──► monday.com API
```

**Fetch order (cold):**
1. Current items: INT in-pipeline groups, MN, INS, WC, and SUB (UID only). This gives the items-only first paint.
2. Column-filtered `activity_logs` per board (stage, escalation, and helper columns), paged by 1000.
3. Group moves: `activity_logs(group_ids: every in-pipeline source group)`, keeping `move_pulse_from_group`. The destination is `data.dest_group.id`, never `data.group_id` (that is the source).
4. FAX board weekly volume (hourly at most), then `/comms/sla`.
Warm refreshes fetch only events since each board's committed cursor (minus 15 minutes). Every query asks for `complexity` and pauses below the floor, to protect the reps who share the token.

**State model (BUILD-SPEC §3.2).** Each item is in exactly one holder state at any moment, by priority:

| Priority | State | Meaning |
|---|---|---|
| 1 | EXITED | Exit label or exit group. Escalation flags left on it are stale (DH-19) |
| 2 | STUCK | Stuck label or Stuck group |
| 3 | FINAL | Escalation 2: "proposed stuck", Final Decisions |
| 4 | MGR | Escalation 0, or the Escalations group: Manager Intervention |
| 5 | QUEUE:<code> | Taxonomy code via `resolveCode` in model/holders.ts (chase split = CC's isParachuteRoleMethod) |

- The current value always wins. When the log disagrees, the open span is synthetic, and its age is an upper bound.
- Loops are revisits in the holder sequence. Bulk-started spans are skipped.

**Why browser-computed:** this matches CC's existing pattern, needs no new server for views A-F, and keeps the metric code pure and testable. Prod's `public/data` is world-readable, so nothing is precomputed there.

## File map (actual)
- `config.ts`, `flags.ts`, `types.ts`; `time/businessTime.ts`, `time/percentile.ts`
- `data/gql.ts` (read-only guard, complexity pause), `data/parseEvent.ts` (+ bulk marking), `data/fetchActivity.ts` (column events and group moves), `data/fetchItems.ts`, `data/fetchFax.ts`, `data/fetchCommsSla.ts`, `data/cache.ts`, `data/loadSnapshot.ts` (injectable fetchers, per-board cursors, reset generation)
- `model/holders.ts` (timelines + holder states + code resolution + merges; spec's timelines.ts and codeResolver.ts live here), `model/journeys.ts`, `model/buildSnapshot.ts`
- `people/owners.ts`; `metrics/context.ts`, `health.ts`, `codeStats.ts`, `loops.ts`, `speed.ts`, `escalations.ts`, `people.ts`, `families.ts`, `dataHealth.ts`, `dashboard.ts`
- UI: `src/pages/OnboardingOversightPage.tsx`, `src/components/onboardingOversight/*` (incl. `Reconcile.tsx`)

## Cache rule
Any change to `parseEvent`, `RawEvent`, or span semantics **must bump `schemaVersion`** in config.ts. That forces every browser to drop its cached history and reload. The group-move window start (`groupHistoryStartMs`) is fixed at the first cold load and kept in the cache.

## Levels 1-3 (CR-10..CR-13)
- `labels.ts`: the single wording map (steps, sub-steps long/short, actions long/short, causes, fixes).
- `metrics/patients.ts`: one row per open patient (§3.17) and `warningFor` (§3.19 states, attempts, ball in court).
- `metrics/minimal.ts` `buildSummary`: level-1 stage rows (late on us, trend, backlog, cause, rank, colour).
- `metrics/operator.ts`: headline numbers, Team (on norms), decider table, click-in problems and fix rules.
- `metrics/bucketDays.ts`: E-07 days outstanding per bucket.
- `data/snapshotMode.ts` + `vite.config.ts` middleware: real-data export replay, dev server only.
- Components: `MinimalOverview.tsx` (level 1), `EarlyWarning.tsx` (level 2), `PatientPage.tsx` (level 3), `FocusView.tsx` (Team and deeper click-ins).
