# Notes columns: long_text → text (CLAUDE.md §10, decided 2026-09-03)

One-off operational scripts for the off-hours conversion. All three talk to the
gateway's `/gql` (no credentials needed), print **counts and lengths only — never a
note body** — and the two that write are `--apply`-gated and dry-run by default.

| script | what | writes? |
|---|---|---|
| `scanNotesLengths.mjs` | how many items sit at / near the 2,000 cap on ME · Insurance · Welcome Call · Subscription | no |
| `hopTest.mjs [--apply]` | proves whether create-item automation 7917676280 carries a >2,000-char **text** value intact (Profile *Tests* group → ME mirror), then deletes both test items | only with `--apply`, only items it created |
| `migrateNotes.mjs <board> <fromCol> <toCol> [--apply]` | ONLY if the UI conversion did **not** keep the column id: copy old long_text → new text per item, read back, verify | only with `--apply` |

Order for the evening: sandbox Phase 0 (does "Change column type" keep the id?) →
`hopTest --apply` → convert the eight columns in the Monday UI → re-point the three hop
workflows if ids changed → `scanNotesLengths` should then show 0 at 2,000 everywhere.
