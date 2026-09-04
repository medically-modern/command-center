# Notes columns: long_text → text (CLAUDE.md §10, decided 2026-09-03)

One-off operational scripts for the off-hours conversion. All three talk to the
gateway's `/gql` (no credentials needed), print **counts and lengths only — never a
note body** — and the two that write are `--apply`-gated and dry-run by default.

| script | what | writes? |
|---|---|---|
| `scanNotesLengths.mjs` | how many items sit at / near the 2,000 cap on ME · Insurance · Welcome Call · Subscription | no |
| `hopTest.mjs [--apply]` | proves whether create-item automation 7917676280 carries a >2,000-char **text** value intact (Profile *Tests* group → ME mirror), then deletes both test items | only with `--apply`, only items it created |
| `snapshotNotes.mjs snapshot\|compare <file>` | per-item length + newline count for the six in-scope columns before the flip; `compare` afterwards must report zero diffs | no |
| `backfillMirrors.mjs [--apply]` | stopgap for the window between the app cutover and the hop automations being re-pointed: fills a notes MIRROR a hop left empty (it copied the retired, frozen column) from the source board's NEW column, joined by Patient UID; idempotent | only with `--apply` |
| `migrateNotes.mjs <board> <fromCol> <toCol> [--apply]` | copy old long_text → new text per item, read back, verify. Safe to re-run: copies only when the destination is empty or a prefix of the source; leaves a destination that has moved ahead; reports a two-sided divergence instead of overwriting | only with `--apply` |

Scope is the SIX notes columns in active use (the two Insurance call-log long_text columns are defined in the app but have had zero writes in 30 days, so they stay as they are).

Phase 0 result (2026-09-03): Monday's "Change column type" creates a NEW column with a new id and deletes the old one — so we do NOT convert live columns in place. Order for the evening: `snapshotNotes snapshot` →
`hopTest --apply` → convert the eight columns in the Monday UI → re-point the three hop
workflows if ids changed → `scanNotesLengths` should then show 0 at 2,000 everywhere.

## The columns (created 2026-09-03 15:xx ET; copy started the same afternoon)

| Board | Old (long_text, capped) | New (text) | Title |
|---|---|---|---|
| Medical Evaluation 18406060017 | `long_text_mm27zjt2` | `text_mm6vevjf` | MN Workflow Notes |
| Insurance 18410601299 | `long_text_mm2ffsme` | `text_mm6vzc7q` | Insurance Notes |
| Welcome Call 18410804557 | `long_text_mm2ffsme` | `text_mm6vqq2k` | Notes |
| Welcome Call 18410804557 | `long_text_mm5gx6j6` | `text_mm6v4fny` | MN Workflow Notes (mirror ← Insurance `text_mm3xbvss`) |
| Welcome Call 18410804557 | `long_text_mm5g1txs` | `text_mm6vvsjy` | Profile Send-Off Notes (mirror ← Insurance `text_mm3xfw5a`) |
| Subscription 18407459988 | `long_text_mm3rj7k7` | `text_mm6vp1z3` | Subscription Patient Notes |

Hop test 2026-09-03: a 3,024-char text value crossed 7917676280 (Profile → ME) **intact**.
The evening sweep, run BEFORE the cutover, is `migrateNotes … --apply --source-wins`; after the
cutover, plain `--apply` (prefix rule) only.

## Outcome (2026-09-03 evening → 2026-09-04 morning)

- **Copies:** six `migrateNotes.mjs … --apply` runs + sweeps — 1,591 items, 0 mismatches. Old columns retitled
  **"(retired)"**, not deleted (hiding them from the views is still Josh's click).
- **App:** re-pointed at the new ids in 74381d4 (test `main`, 2026-09-03 ~8 PM ET). `src/lib/shared/notesColumnIds.test.ts`
  pins the ids; `notesWriteShape.test.ts` pins the bare-string write shape.
- **Hop automations are UI-only.** The workflow-builder API (`validate_workflow`, `invoke_workflow_expert`,
  `get_run_once_trigger_entities`) answers "General error" for 7918295320 and 7918324247 while a fresh workflow
  works, so their column mappings can only be edited by a person in Monday's automation editor. Josh did it
  2026-09-04 (7918295320 at 10:01 ET, 7918324247 at 10:08 ET). 7917676280 (Profile → ME) was text → text all along.
- **Verified** with `mcp list_automations` dumps of the ME and Insurance boards (the MCP saves the JSON to a file)
  fed to `verifyHopsDump.mjs <dump> <workflowId>` (session scratchpad; it walks each destination `item.<col>` →
  `workflowVariableKey` → dynamic-text `config.dependencies` → `node_results` `sourceMetadata.outboundFieldKey`):
  every notes pair on the new ids. First live hop after the edit confirmed it end to end — Insurance item
  `12977325713` (created 10:08:41 ET) carries a 141-char MN mirror equal to its ME source's `text_mm6vevjf`,
  while that source's retired column is empty.
- **The window:** between the app cutover and the 10:08 edit, 3 Insurance items hopped with an empty MN mirror.
  `backfillMirrors.mjs --apply` filled all three (each re-read after the write); every run since reports 0 pending.
- **Leftover in 7918324247:** three rows still write the Welcome Call "(retired)" columns — Notes (retired) ←
  Insurance "Insurance Notes (retired)", and the two "(retired)" mirrors ← Insurance `text_mm3xbvss` /
  `text_mm3xfw5a`. Harmless (nothing reads them); clear them when the retired columns are hidden.

