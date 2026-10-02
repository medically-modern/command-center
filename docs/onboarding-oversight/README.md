# Onboarding Oversight dashboard (prototype)

**What it is.** A read-only, manager-only Command Center screen at `/onboarding-oversight`: a summary dashboard of onboarding pipeline health (Intake → Medical Necessity → Insurance → Welcome Call → release to the Subscription board). It answers where the bottleneck is, how bad, why (whose move), and whether it is getting better or worse. The north star is the spec repo's `project/DESIGN-INTENT.md` (Brandon's words).
Three levels:
1. **Overview** (Head of Operations): four numbers (Late on us, Due soon, Decisions overdue, Released) and one row per stage (waiting, late on us, 6-week trend with arrow, 7-day backlog, why). Only #1 is red.
2. **Early warning** (managers, one click): every open patient against its step's normal time and attempts (on track / due soon / late), with whose move it is (us / payer / provider / patient). Default: due soon + new late, on us. Sortable and filterable.
3. **Patient page** (one more click): stepper, time in step vs normal, history with gaps and back-and-forth highlighted.

**Status.** Prototype for **BUILD-SPEC v1.0** (see the spec repo tag `onboarding-oversight-spec-v1.0`). Normal times, attempt norms and cadences are proposals (spec ASSUMPTIONS AS-15/16) until Brandon confirms them. Janelle (Manager Intervention) and Katie (Final Decisions) must decide within 2 business days (Brandon's rule). Stuck means dead lead: an outcome, not an alarm. The route is hidden from navigation (`OO_FLAGS.showInNav = false`).

**Read-only.** All monday access goes through `src/lib/onboardingOversight/data/gql.ts`. It refuses any mutation before a network call (test T-RO). The dashboard never writes to `public/data`.

## Run it
- **Fixture mode** (synthetic data, no network, no sign-in): `VITE_OO_FIXTURE=1 npm run dev`, then open `http://localhost:8080/onboarding-oversight`.
- **Live data, gateway mode** (read-only through the gateway with Google sign-in): `npm run dev -- --mode production`, then open `http://localhost:8080/onboarding-oversight`.
  - This needs the gateway's `ALLOWED_ORIGINS` and the Google OAuth client to allow `http://localhost:8080`. The owner is Josh.
  - Do not review with plain `npm run dev`. It talks to monday directly with a write-capable token.
- **Snapshot mode** (real data from a read-only export, no network): `OO_SNAPSHOT_DIR=/path/to/project/snapshot/real VITE_OO_SNAPSHOT=1 npx vite`. The export lives outside this repo (the spec repo's `project/snapshot/real/`, gitignored). It is served only by the dev server (`vite.config.ts` middleware, `apply: "serve"`), so no build contains it.
- **Tests:** `npx vitest run src/lib/onboardingOversight src/components/onboardingOversight`. Typecheck: `npx tsc -b --force`.

## Where things are
- `src/lib/onboardingOversight/config.ts`: every board, column, and label ID, threshold, and owner mapping (BUILD-SPEC Appendix A).
- `data/`: fetch (read-only), the IndexedDB cache, and the loader. Per-board cursors only advance when every page of that board succeeded.
- `model/`: the item state model (holder states EXITED / STUCK / FINAL / MGR / QUEUE:<code>), journeys, and owners.
- `metrics/`: metric families and `dashboard.ts`, which builds every tile. The UI only renders that model.
- `src/components/onboardingOversight/`: the views. `src/pages/OnboardingOversightPage.tsx`: the route.

## How to read it
- "d" = business days (Mon-Fri, holidays excluded). "6.2/6d" = 6.2 days in this step against a 6-day normal. "+0.2" means late by that much; "−0.8" means 0.8 days left.
- ◔ due soon, ● new late (crossed in the last 2 business days), ■ late, ○ on track.
- Whose move: **Us** unless we acted within cadence (provider 3, payer 5, patient 2 business days) or a bounded follow-up date is set. Evidence is monday only until Command Center call/text/fax logs are connected.
- All wording comes from `src/lib/onboardingOversight/labels.ts` (one swappable file).

## How to extend
See BUILD-SPEC §10.6. In short:
- Persons and thresholds are config-only.
- A new label on an existing stage column is config-only.
- A new board needs config, plus `model/journeys.ts`, plus `metrics/speed.ts`, plus tests.

Other docs here: ARCHITECTURE.md, METRICS.md, DECISIONS.md, KNOWN-LIMITATIONS.md, RUNBOOK.md, REVIEW-CHECKLIST.md.
