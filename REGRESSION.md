# Regression policy — command-center (Benefits Check / Stedi)

No change to the Benefits Check flow ships without passing these gates.
The eligibility pipeline quotes benefits and routes billing — a silent
regression here misbills real patients. (Policy set by Brandon,
2026-07-29, after the Jack Omilanowicz D-SNP work.)

## Gate 1 — automatic (CI, blocks the Pages deploy)

`.github/workflows/deploy.yml` runs on every push to main:

1. `npx tsc --noEmit` — typecheck
2. `npx vitest run` — full unit suite (550+ tests, including the
   suggestion-engine acceptance tests built from real patients)

If either fails, the build job fails and nothing deploys.

## Gate 2 — corpus replay (manual, REQUIRED for suggestion-engine changes)

Any semantic change to `src/lib/profile/primaryInsurance.ts` must be
replayed against the full Stedi check history before pushing:

1. In the backend repo (`stedi-monday-integration`), export the engine
   corpus (snapshots of every historical 271 as engine inputs):

       STEDI_API_KEY=... python3 scripts/export_engine_corpus.py \
           --out engine_corpus.json

2. In this repo, diff the old engine (any git ref) against the working
   tree over that corpus:

       node scripts/replay-suggestions.mjs \
           --corpus engine_corpus.json --old-ref origin/main

3. Review every diff. The bar: **zero unexplained per-check diffs**.
   Board-state (dual-simulation) diffs must each be an intended change,
   named in the commit message.

Display-only JSX changes (banners, tiles) don't need Gate 2 — but they
do need Gate 1, which CI enforces automatically.

## History

- 2026-07-29: policy created. Same-day catches by the replay: the
  facility-flags Medicare gate would have dropped 4 real Aetna
  Hospital/SNF flags (backend replay); the D-SNP plan-text classifier
  gap (Aetna/Wellcare/Healthfirst) was found by auditing 8 "suspicious"
  QMB suppressions.
