# Notes columns: long_text → text (CLAUDE.md §10, decided 2026-09-03)

One-off operational scripts for the off-hours conversion. All three talk to the
gateway's `/gql` (no credentials needed), print **counts and lengths only — never a
note body** — and the two that write are `--apply`-gated and dry-run by default.

| script | what | writes? |
|---|---|---|
| `scanNotesLengths.mjs` | how many items sit at / near the 2,000 cap on ME · Insurance · Welcome Call · Subscription | no |
| `hopTest.mjs [--apply]` | proves whether create-item automation 7917676280 carries a >2,000-char **text** value intact (Profile *Tests* group → ME mirror), then deletes both test items | only with `--apply`, only items it created |
| `snapshotNotes.mjs snapshot\|compare <file>` | per-item length + newline count for the six in-scope columns before the flip; `compare` afterwards must report zero diffs | no |
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
