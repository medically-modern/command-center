# Diagnosis: status → dropdown (CLAUDE.md §5.40, decided 2026-09-21)

One-off operational scripts for the conversion. All talk to the gateway's `/gql`
(no credentials needed) and the two that write are `--apply`-gated and dry-run by
default. Same shape as `scripts/notes-migration`.

## Why

monday **status** columns cap at **39 labels / label-id 160**. A scan of all 273
status columns in the account found the maximum anywhere is exactly that, and all
three Diagnosis columns the app writes — Medical Evaluation, Insurance, Welcome
Call — were sitting at 39/160 with 39 distinct colours. `create_labels_if_missing`
then has nowhere to put a new ICD-10 code, so monday **drops the write at HTTP 200
with no `errors[]`** (the silent-drop class §5.12 · §5.20 · §5.31c · §5.31d ·
§5.33 · §5.36 record, here from a FULL column rather than a wrong id).

Found 2026-09-21 12:41 ET: `send_job 2255`, Carol Robinson (ME `13095515539`),
Evaluate → Send Request, `Z83.3` (family history of DM — a legitimately new code;
the column held only E-codes plus `O24.111`). 16 of 17 columns landed, Diagnosis
did not, the verify loop timed out and correctly did NOT advance. Nothing was lost.

**Dropdowns have no such ceiling** — Clinic Name is at 324 labels, Stedi Plan Name
at 192, ids sequential — and that is what the app already uses for every other
open vocabulary. ICD-10 has ~70k codes; it never belonged in a 39-slot column.

## Scope

Five boards — the three the app writes, plus the two the hop automations copy INTO
(a hop cannot copy dropdown → status, and both were at 37 labels, i.e. next).

| Board | Old status (retired, not deleted) | New dropdown |
|---|---|---|
| Medical Evaluation `18406060017` | `color_mm1wf7rv` | `dropdown_mm7daf4m` |
| Insurance `18410601299` | `color_mm1wf7rv` | `dropdown_mm7dkdq8` |
| Welcome Call `18410804557` | `color_mm1wf7rv` | `dropdown_mm7dvqts` |
| Subscription `18407459988` | `color_mkxrxv9w` | `dropdown_mm7d2p2h` |
| New Order `18405457690` (Diagnosis Code) | `color_mm189t0b` | `dropdown_mm7dds6y` |

⚠️ **Out of scope, deliberately:** DTC Intake `color_mkxqzqdj` and Secondary
Claims `color_mky2gpz5` also hold a Diagnosis status column. Neither is in the
app's write path and neither is a destination of these hops. Flagged, not touched.

| script | what | writes? |
|---|---|---|
| `boards.mjs` | the from → to map and the shared `gql` (which throws on a 200-with-`errors[]`, §10) | no |
| `createColumns.mjs [--apply]` | creates the five dropdowns beside the status originals; idempotent, matched on title + type; writes `columns.json` | only with `--apply` |
| `migrateDiagnosis.mjs [--apply] [--board ID] [--source-wins]` | copies old status text → new dropdown per item, batched, read back and verified | only with `--apply` |
| `backfillLabels.mjs [--apply]` | tops every dropdown up to the full historic vocabulary — the 43 real ICD-10 codes the ten columns knew between them | only with `--apply` |
| `retireColumns.mjs [--apply]` | retitles the five OLD status columns to "… (retired)" so the automation editor can tell them from the dropdowns; title only, ids unchanged | only with `--apply` |

### migrateDiagnosis rules

- source empty → skip · destination empty → copy · destination === source → skip
- destination differs and is non-empty → **REPORT, do not overwrite** (the
  destination moving ahead is a rep or the app having written the new column;
  clobbering that with a stale status value is worse than leaving it). `--source-wins` forces it.
- Pass 1 writes each distinct label once on its own so two aliased mutations can
  never race into creating the same label twice; pass 2 batches the rest 20 at a time.
- Every batch is read back and compared before the next goes out.

**It is meant to be re-run.** Between the app cutover and the hop automations
being re-pointed, a hop copies the OLD (now frozen) status column, so the
destination board's new dropdown arrives empty. Re-running fills those in — the
same stopgap `backfillMirrors.mjs` was for the notes conversion.

## Verified before touching anything live (2026-09-21)

On a throwaway board: a dropdown accepted `Z83.3`, `E11.65`, `E10.39` and
`SOME.BRAND.NEW.CODE` through `change_multiple_column_values` with
`create_labels_if_missing: true`, creating ids 0–3 sequentially and reading each
back exactly. That is the same mutation shape the gateway's `writeMultiple` sends.

## Outcome

- **Columns** created 2026-09-21 ~17:05 UTC. **Copy:** 3,900 items across the five boards.
- **App** re-pointed in the same commit — `src/lib/shared/diagnosisCell.ts` owns the
  read/write shape, `diagnosisColumnIds.test.ts` pins the five ids and scans `src/`
  for any surviving retired id. 4,063 tests pass; zero new type errors.
- **Labels topped up** 2026-09-21 ~20:30 UTC — `migrateDiagnosis` creates a label only
  for a code some item HOLDS, so the dropdowns came out with 26–37 of the 43 real
  ICD-10 codes. `backfillLabels.mjs --apply` minted the union on all five (+64), which
  is what makes the picker unchanged for reps **and** removes the missing-label half
  of the hop risk for every code we have ever used. Five non-codes are deliberately
  not carried over: `10.649`, `10.676767`, `Collect`, `E024.414`, `Evaluate` — none is
  on any row, and the Evaluate picker already filtered two of them out.
- ⚠️ **The cutover window is real and was observed, not theorised.** Maximilian
  Sisalli hopped Welcome Call → Subscription + New Order at 20:15:36Z carrying
  `E10.65` in the RETIRED column only; both new dropdowns arrived blank. A re-run of
  `migrateDiagnosis --apply` copied them (`copied 2 | already done 3901 | diverged 0`).
  That is exactly what step 2 below is for, and every hop that fires before the
  re-point does the same thing.
- ⚠️ **The hop automations are NOT re-pointed** — that is Josh's evening job, and
  the workflow-builder API cannot edit board automations of this vintage (it
  answers "General error"; see the notes-migration README). Until then the hops
  still copy the retired status columns.

## The evening list — the 11 automations that still copy a retired column

Re-verified live 2026-09-22 against all three source boards (32 + 45 + 41
workflows, 54 legacy recipes). **No legacy recipe touches Diagnosis**, so all
eleven are editable workflows — but board automations of this vintage cannot be
changed through the workflow API (it answers "General error", see the
notes-migration README), so this is a person in monday's automation editor.

**Each one has exactly ONE create-item block and exactly ONE live Diagnosis row.**

| Board it lives on | Workflow | Active | Creates in | The one row to change |
|---|---|---|---|---|
| Medical Evaluation | `7918295320` | yes | Insurance | `dropdown_mm7daf4m` → `dropdown_mm7dkdq8` |
| Insurance | `7918324247` | yes | Welcome Call | `dropdown_mm7dkdq8` → `dropdown_mm7dvqts` |
| Welcome Call | `7918317925` | yes | Subscription | `dropdown_mm7dvqts` → `dropdown_mm7d2p2h` |
| Welcome Call | `7918340632` | yes | Subscription | same |
| Welcome Call | `7918343137` | yes | Subscription | same |
| Welcome Call | `7918601476` | yes | Subscription | same |
| Welcome Call | `7919753399` | yes | Subscription | same |
| Welcome Call | `7918340959` | yes | **New Order** | `dropdown_mm7dvqts` → `dropdown_mm7dds6y` |
| Welcome Call | `7918341001` | yes | **New Order** | same |
| Welcome Call | `7918341011` | yes | **New Order** | same |
| Welcome Call | `7921725444` | **no** | **New Order** | same — stays inactive (§5.22b), re-pointed so it is not a trap |

⚠️ **An earlier draft of this table said the last four create into "Subscription
AND New Order" and carry several Diagnosis rows each. Both were wrong**, and the
mistake is worth recording because it is easy to repeat. A create-item block's
`inboundFieldsSourceConfig` keys are DESTINATION columns, and these four carry
keys for `color_mm1wf7rv` and `color_mkxrxv9w` — neither of which exists on New
Order. They are **dead keys** for columns the destination board does not have,
invisible in the editor and copied nowhere. Resolve each block's destination
board from its `boardId` variable and intersect the keys with that board's real
column set before believing a mapping is live; the raw config alone will send you
hunting for rows that are not there.

⚠️ **Profile Send Off has NO Diagnosis column**, so the Profile → ME hop
(`7917676280`) cannot carry one. Nothing is missing upstream — checked, not assumed.

## Then, in this order

0. **Already done — don't redo:** values migrated (3,903 of 3,903, 0 diverged,
   verified twice); every dropdown carries all 43 codes; and the five status
   columns are retitled (below). Nothing needs a re-migration first.

1. ✅ **Retitle the old status columns — DONE 2026-09-22** via
   `retireColumns.mjs --apply`: "Diagnosis (retired)" on four boards,
   "Diagnosis Code (retired)" on New Order, read back on all five.

   **This had to come BEFORE the re-point, not after.** Every board carried two
   columns with the SAME TITLE — the retired status and the new dropdown — and
   monday's automation editor picks a column by title, so the two were
   indistinguishable there and choosing the wrong one looks exactly like a
   finished re-point while the hop goes on copying a frozen column. Safe to do
   first because a rename changes the title only, never the id (CLAUDE.md §3):
   the eleven hops kept working off the old column, and the app reads the
   dropdowns by id.

2. ✅ **Re-point the automations — DONE 2026-09-22 (Josh, in the UI).** All TEN
   active hops verified from a fresh `list_automations` pull of Medical
   Evaluation, Insurance and Welcome Call: each now carries the dropdown pair
   reading the trigger item. `7921725444` was left alone and that is right — it
   is the inactive "monitor = 0" branch CLAUDE.md §5.22b says must stay
   inactive; **whoever ever enables it must re-point its Diagnosis row first.**

   ⚠️⚠️ **Verifying this from the API is a trap.** monday writes the new row as
   a **`multi-dynamic-text`** wrapper variable, so the row's own variable reads
   `sourceKind: "user_config"` with a Lexical document in `config.value` that
   references ANOTHER variable — and only that one carries
   `sourceMetadata.outboundFieldKey`. Read one level deep and a perfectly
   correct mapping looks like a hardcoded literal; the first verification pass
   did exactly that and reported all eleven hops broken. **Follow
   `config.dependencies`.** It also means the value crossing the hop is the
   label TEXT, not label ids.

   ⚠️ The old row was ADDED TO, not replaced: all eleven still copy the retired
   status column too. Harmless, but "retired" is a title, not a frozen state —
   those columns keep filling, so a non-empty one is not evidence a hop was
   missed. Clear those rows when the columns are hidden (step 5).

3. ✅ **A hop DOES create a missing label on the destination dropdown — settled
   2026-09-22.** So a brand-new ICD-10 code entered at Evaluate carries down the
   chain on its own. Measured from production, because the web does not answer it
   (two searches returned only that `create_labels_if_missing` is an *API*
   parameter, plus a third-party claim that cross-board copies go by internal
   label id — which our own boards disprove, §5.33). The natural experiment:
   Insurance's **Stedi Home Plan `dropdown_mm5ex8wx`** is read by the SPA and
   written by nothing in it (`samantha/mondayWrite` names neither `homePlan` nor
   `planName`), and the Railway stedi service does not reach that board — so hop
   7918295320 (`item.dropdown_mm5ex8wx.labels ← item.dropdown_mm5es2yz.labels`)
   is its only writer. It holds 22 labels in arrival order, a strict subset of
   ME's 28; ME's six extras sit on seven items that have not hopped yet.
   ⚠️ True of a **`.labels`** mapping, which every Diagnosis row uses — not of an
   `.ids` one, and `create_automation` emits `.ids` by default. Check the key.
   Since `backfillLabels.mjs` ran, every HISTORIC code exists on every board
   anyway, so this only ever bit a code nobody had used before.

4. ✅ **Cutover window closed — `migrateDiagnosis.mjs --apply`, 2026-09-22.**
   **45 items filled** (Medical Evaluation 1 · Insurance 1 · Welcome Call 2 ·
   Subscription 5 · New Order 36), `already done 3904 | diverged 0 |
   mismatched 0`, every batch read back; a re-run came back `copied 0 | already
   done 3949`. Those 45 are exactly what the hops delivered with an empty
   dropdown between the app deploy and the re-point. Re-run this after any
   future hop edit — it reports `diverged` rather than overwriting anything a
   rep has since set.

5. **Then** hide the five retired columns from the views. Never delete: 4,004
   items still reference them, and they are the rollback.
   ⚠️ **This is a monday UI action — the API cannot do it.** Checked 2026-09-22:
   there is no `hide`/`archive` mutation for a column (`archive_*` covers items,
   groups, boards and objects only), `change_column_metadata` takes title and
   description alone, `update_column` exposes title/description/width/settings
   and a `capabilities` input that is only about calculated columns, and a
   TableBoardView's `settings_str` comes back `{}`. `Column.archived` is
   readable and not settable. So: Josh hides them from each board's views.
   ⚠️ **Safe for prod, which still reads these columns by id.** View visibility
   is not in the data model the API exposes, so it cannot gate a `column_values`
   read — and prod's app is still pointed at `color_mm1wf7rv` / `color_mkxrxv9w`
   / `color_mm189t0b` until the sync.
   ⚠️ **Clear the retired-column rows from the 11 hops at the same time.** Josh's
   re-point ADDED the dropdown row rather than replacing the status one, so all
   eleven still copy the retired column and it goes on filling (§5.46). Harmless
   while it exists, and the same tidy-up §10 records for the notes mirrors. Also
   a UI job: these automations cannot be edited through the workflow API.

## Original scope note

The four numbered steps this section replaced are folded into the tables above.
