# Referral Source backfill — Subscription board

Backfills **Subscription "Referral Source" `color_mm6thrwv`** from the patient's own
pipeline record. Run 2026-09-11: **300 items written and verified, 0 mismatches**
(71 → 371 of 834 filled).

```bash
node backfillReferralSource.mjs            # dry run (default)
node backfillReferralSource.mjs --apply    # write, verifying every row
node validateSuppliesRule.mjs              # measure the Supplies Type inference
```

Idempotent — it only ever fills a **blank** cell, so a re-run after a completed pass
writes nothing.

## The two columns that are easy to confuse

Subscription has **two** referral columns, and the app's `COL` map only knows the wrong one:

| column | type | what it holds |
|---|---|---|
| `dropdown_mkwz8zp4` "Referral" | dropdown | rep/partner **names** — Corey, Michelle, Maryalice, Sally Bahnam, AAA DME, NYU Pediatrics (59 labels). `src/lib/subscription/mondayApi.ts` `COL.referral`. **Not** the pipeline's referral source. |
| `color_mm6thrwv` "Referral Source" | status | the pipeline's own vocabulary — the backfill target. **Not in the SPA's `COL` map at all.** |

The pipeline column is **`color_mm1w5wxr` "Referral Source"**, and the *same id* is on
Profile Send Off, Medical Evaluation, Insurance and Welcome Call. Subscription is the one
board where the id differs, which is the whole reason the value looked like it "didn't hop".

## ⚠️ Map by LABEL TEXT, never by index

The two columns carry the same ten labels at **different indices**:

| index | Profile Send Off `color_mm1w5wxr` | Subscription `color_mm6thrwv` |
|---|---|---|
| 6 | Wellstart | **Solace Advocates** |
| 7 | Solace Advocates | **SNJ** |
| 8 | SNJ | **Wellstart** |

Indices 0–4, 9, 10 agree; 6/7/8 are scrambled. An index copy silently mislabels those
three, and a status write to an index a column does not have is **dropped at HTTP 200 with
no error** (CLAUDE.md §5.12 / §5.20 / §5.31c / §5.31d / §5.33). The script reads the
destination's `settings_str` at runtime and **aborts** if a label has no destination index.

The five WC→Subscription automations map it the same way — `item.color_mm6thrwv.label` ←
`item.color_mm1w5wxr.label` — so label-matching is the established contract, not a choice
this script made.

## Layers, most-evidence-first

Each patient is resolved by the first layer that answers. Default: `uid,name,ilet`.

| layer | resolved | what it is |
|---|---|---|
| `uid` | 193 | **Patient UID** match against Welcome Call / Insurance / Medical Evaluation — all three carry both the UID and the referral column. The patient's own record: evidence, not inference. |
| `name` | 90 | Name match, accepted **only** with a second signal (phone or DOB agrees) — `lib/commsHub/dossier.nameMatchAccepted`'s rule. |
| `ilet` | 17 | Supplies Type **iLet → Beta Bionics**. Beta Bionics is the only maker of the iLet; held on 13 of 14 verifiable patients. |
| `supplies` | *off* | Mobi/t:slim → Tandem. **Measured wrong — see below.** |

Left blank on purpose: **4 conflicts** (source boards disagree — never guessed) and
**459 unresolved**, of which 180 are CGM-only ("Not Serving" on supplies) and 278 are
Mobi/t:slim patients the `supplies` layer would have guessed at.

### ⚠️ The Supplies Type rule does not hold

"Every supplies patient was a Tandem or Beta referral; Mobi/t:slim ⇒ Tandem, iLet ⇒ Beta"
is intuitive and gets proposed from the floor periodically. Measured against the 354
Subscription patients whose referral source can be established (`validateSuppliesRule.mjs`,
2026-09-11):

| Supplies Type | rule says | actual | accuracy |
|---|---|---|---|
| Mobi (n=75) | Tandem | Tandem 49, **Doctor 22**, Patient 4 | 65% |
| t:slim (n=108) | Tandem | Tandem 61, **Doctor 33**, Patient 8, CareCentrix 6 | 56% |
| iLet (n=14) | Beta Bionics | Beta Bionics 13, CareCentrix 1 | **93%** |

The pump brand says which manufacturer's pump the patient is **on**, not who referred
them — plenty of t:slim patients came from their own doctor. Enabling `supplies` would
write a referral source the board data contradicts for roughly **112 of 278** patients.
Only the iLet half survived. **Re-run `validateSuppliesRule.mjs` before ever enabling it.**

## ⚠️ A Patient UID is checked against the name

At least one UID on these boards is plain wrong. `8c623d19-…91f28` is *Samira Delacruz* on
Subscription and *josephin yap* on Welcome Call — two different people, same DOB and phone.
Another maps a real patient to a row literally named **`TEST`**. Taking the UID at face
value writes one patient's referral source onto another, silently.

`nameCompatible()` therefore gates every UID hit and **fails closed**: a rejected match
costs one blank cell, an accepted wrong one is a patient record with someone else's data.
It accepts an exact name, an annotated one (`Emilio Crespo (send claim to 2224/5…)`) and a
middle name (`Barbara Hester Anderson` / `Barbara Anderson`); it rejects a shared first name
alone, which is what a bad UID looks like. 3 hits were rejected on the live run; all 3 were
then resolved correctly by the `name` layer via their own records on other boards.

Four Subscription items share a Patient UID with another — all four are genuine duplicate
records of the same patient, so both rows correctly get the same value.

## The forward path is already wired — this is history only

All five WC→Subscription create-item automations (**7918317925 · 7918340632 · 7918343137 ·
7918601476 · 7919753399**, all active, verified 2026-09-11) already carry
`color_mm1w5wxr` → `color_mm6thrwv`. New Subscription items arrive with the value; the 763
blanks were items created before that mapping existed. **No automation change is needed and
none was made.**

## Conventions this script follows

- **Dry run by default** (`--apply` to write) — it is a bulk write against live PHI rows,
  and CLAUDE.md §10 records what an unattended one did on 2026-09-02.
- **Reads `errors[]` and stops.** A Monday write is HTTP 200 *with* `errors[]` on refusal,
  so a bulk job that ignores it reports a clean run having written nothing.
- **Verifies every write** by reading the value back, like `notes-migration/migrateNotes.mjs`.
- **Never overwrites** a cell that already has a value.
- **Prints item ids and counts, never a patient name** (PHI, CLAUDE.md §9).
- 120ms between writes, gentle on the shared complexity budget.
