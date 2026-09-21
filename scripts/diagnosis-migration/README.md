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
- ⚠️ **The hop automations are NOT re-pointed** — that is Josh's evening job, and
  the workflow-builder API cannot edit board automations of this vintage (it
  answers "General error"; see the notes-migration README). Until then the hops
  still copy the retired status columns.

## The evening list — the 10 automations that still copy a retired column

Found by scanning every workflow on the three source boards for the retired ids
(32 + 45 + 41 workflows, 54 legacy recipes). **No legacy recipe touches Diagnosis**,
so all ten are editable workflows — but board automations of this vintage cannot be
changed through the workflow API (it answers "General error", see the notes-migration
README), so this is a person in monday's automation editor.

| Board | Workflow | Active | Re-point the Diagnosis pair |
|---|---|---|---|
| Medical Evaluation → Insurance | `7918295320` | yes | `dropdown_mm7daf4m` → `dropdown_mm7dkdq8` |
| Insurance → Welcome Call | `7918324247` | yes | `dropdown_mm7dkdq8` → `dropdown_mm7dvqts` |
| Welcome Call → Subscription | `7918317925` | yes | `dropdown_mm7dvqts` → `dropdown_mm7d2p2h` |
| Welcome Call → Subscription | `7918340632` | yes | `dropdown_mm7dvqts` → `dropdown_mm7d2p2h` |
| Welcome Call → Subscription | `7918343137` | yes | `dropdown_mm7dvqts` → `dropdown_mm7d2p2h` |
| Welcome Call → Subscription | `7918601476` | yes | `dropdown_mm7dvqts` → `dropdown_mm7d2p2h` |
| Welcome Call → Subscription | `7919753399` | yes | `dropdown_mm7dvqts` → `dropdown_mm7d2p2h` |
| Welcome Call → Subscription **and** New Order | `7918340959` | yes | `dropdown_mm7dvqts` → `dropdown_mm7d2p2h` **and** `dropdown_mm7dds6y` |
| Welcome Call → Subscription **and** New Order | `7918341001` | yes | same pair |
| Welcome Call → Subscription **and** New Order | `7918341011` | yes | same pair |
| Welcome Call → Subscription **and** New Order | `7921725444` | **no** | same pair — inactive (§5.22b says keep it inactive), but re-point it so it is not a trap if it is ever enabled |

⚠️ The last four reference all three retired ids because they create into BOTH
Subscription and New Order; check every Diagnosis row inside each, not just the first.

## Then, in this order

1. **Test whether a hop CREATES a missing label on the destination dropdown.**
   Unknown, and it matters: if it does not, a brand-new code entered at Evaluate will
   not carry to Insurance on the hop. Both sends write with
   `create_labels_if_missing`, so the next send self-heals either way — but measure
   it, the way `hopTest.mjs` measured the notes hop, rather than assuming.
2. **Re-run `node migrateDiagnosis.mjs --apply`** to close the cutover window (a hop
   that fired between the app deploy and the re-point delivered an empty dropdown).
   It reports `diverged` rather than overwriting anything a rep has since set.
3. **Then** retitle the five status columns "(retired)" and hide them from the views.
   Never delete: 4,004 items still reference them, and they are the rollback.

## Original scope note

The four numbered steps this section replaced are folded into the tables above.
