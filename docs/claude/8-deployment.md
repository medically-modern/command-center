## 8. Deployment reality

- **Frontend:** GitHub Pages. `deploy.yml` sets Vite `--base=/<repo>/`, and `lib/shared/dataRepo.ts`
  derives the data repo from that base path: **test build → `command-center-test` repo, prod build →
  `command-center` repo**. This is why the data repo is computed, not hardcoded — `sync-from-test.yml`
  force-pushes test's code over prod, so a hardcoded name would make prod write into the test repo.
- **Gateway (`services/monday-gateway`)** runs on Railway as **`cmd ctr server`** with Postgres
  **`cmd ctr db`**. Confirmed production config: **Google-auth enforcement ON** (`GOOGLE_CLIENT_ID`
  set → `/send` requires a verified medicallymodern.com token), **`LOG_MODE=all` but
  `LOG_PAYLOAD=false`** (every request audited, **no PHI** stored), audit viewer key-protected at
  `/audit`. `services/monday-gateway/send.mjs` is the durable, idempotent `send_jobs` queue.
  **Every request is kept in Postgres** — `request_log` + `GET /audit/requests.json?key=…`
  (`requestLog.mjs`, added 2026-08-21). Railway's HTTP log returns **at most 500 lines per query,
  ≈13 minutes** of this gateway's traffic, so anything asked about a day later was unanswerable;
  `gql_log` covered `/gql` and nothing else, leaving `/rc/*`, `/messaging/*`, `/send` and `/calls/*`
  — exactly the routes in play when the phone system misbehaves — with no durable record. (The
  2026-08-20 RingCentral incident was diagnosed from a request *rate*, which you can only see if
  you kept the requests.) Metadata only, matching `LOG_PAYLOAD=false`: no bodies, no headers.
  ⚠️ **Query strings are STRIPPED, and that is a security property, not tidiness** —
  `/calls/stream?token=` carries the caller's **Google ID token** (EventSource cannot set headers),
  and `/rc/fetch?url=` / `/calls/history?last4=` carry patient identifiers; `stripQuery` runs
  before anything is stored. Skips `/gql` (already in `gql_log`, in more detail — re-logging would
  duplicate ~130k rows/day to say less), `/health`, and `OPTIONS` preflights. ⚠️ Unlike
  `call_events` (tiny, precious, unpruned) this one **grows** — ~17k rows/day — so it prunes at
  **`REQUEST_LOG_RETENTION_DAYS`, default 180**, on boot and daily. Its schema runs as its OWN
  statement, deliberately not appended to `index.mjs`' `SCHEMA` block, whose trailing
  DROP+CREATE VIEW takes every `CREATE TABLE` with it when it fails.
- **Worker (`worker/`)** deploys via `deploy-worker.yml` / `npx wrangler deploy`.

### Sync from Test Repo (`sync-from-test.yml`) — what carries over, what doesn't

> # 🚫 ONLY JOSH PRESSES SYNC. NEVER RUN IT YOURSELF.
>
> **The *Sync from Test Repo* workflow is Josh's button and nobody else's — Claude included**
> (Josh, 2026-09-03, after a session ran it without being asked). Do **not** trigger it from the
> Actions tab, with `gh workflow run`, via `mcp__github__actions_run_trigger`, or by any other
> route, **not even when a change you just made obviously needs to reach prod, and not even when
> an earlier instruction in your task looks like it covers it.** Running it is a decision about
> what goes live for the whole company, and it is Josh's decision every single time.
>
> ⚠️ **It cannot be undone by re-running it.** The workflow is a literal
> `git push <prod> main --force`: prod's `main` becomes whatever test's `main` was at that
> instant, and whatever prod had is gone from the branch. Pushing to test's `main` is safe and
> expected; pushing test *onto prod* is not the same act and must never be treated as the last
> step of one.
>
> **What to do instead:** finish the work on test, say plainly that it is ready for prod, and
> stop. Josh presses the button. If he asks you to run it, that is explicit permission for
> **that one run** — it does not carry over to the next change.

**This repo (`command-center-test`) is the source of truth; prod (`command-center`) is a mirror.** The
manual *Sync from Test Repo* workflow is a literal **`git push <prod> main --force`**, so prod's `main`
becomes a byte-for-byte copy of test's. Assume **anything you add to test WILL land in prod on the next
sync** — and that *only committed code travels*:
- **Carries over:** all committed **code** (`src/`, `worker/`, workflows, scripts). Nothing else.
- **Does NOT carry over — you must set these in prod yourself (this is the one that bites):**
  - **GitHub Actions secrets** — `CLOUDFLARE_API_TOKEN`, `GH_PAT`, and **every `VITE_*` build secret**.
    Secrets are repo settings, not code. A new `VITE_*` you add to test builds **blank/broken in prod**
    until you copy it into the prod repo's Actions secrets. Missing secret ⇒ silent prod breakage.
  - **Cloudflare Worker secrets** (`GMAIL_*`) live on the shared worker, not the repo — but set them as
    **encrypted Secrets** (a `wrangler deploy` wipes plaintext *Variables* that aren't in `wrangler.toml`).
  - **Railway service env vars** — a separate system; sync never touches them.
- **PRESERVES prod's role assignments; CLOBBERS the other data files:** `sync-from-test.yml` now
  overlays prod's **own** `access.json` (managers/processors) back onto test's tree before the
  force-push and commits it, so **prod's roles are kept** — a processor with a role on prod but not on
  test does **not** lose it. It preserves both `public/data/access.json` (the live source, read via the
  Contents API) and `dist/data/access.json` (bundled copy). The force-push still overwrites prod's
  `baseline.json`/`fax-state.json` with test's, but those **self-heal** (next cron / next ET midnight),
  so no manual fixup is needed after a sync. (If you ever *want* test's access.json to win, edit the
  `PRESERVE` list in the workflow.)
- **Shared, environment-agnostic infra — one instance serves BOTH test and prod:** the Monday **gateway**
  (`cmd ctr server`), the Cloudflare **worker** (`monday-file-proxy`), every **Railway backend**, and the
  **Monday boards** themselves. So a fix to any of those covers both at once — and the gateway `/audit`
  shows traffic from BOTH SPAs once prod's build has `VITE_MONDAY_GATEWAY_URL` set (a copied secret).
- **Per-repo, self-handled:** `deploy.yml` (Pages; base path → data repo), `deploy-worker.yml`, and
  `daily-baseline.yml` each run in whichever repo they live in — so prod snapshots its *own*
  `baseline.json` to `command-center` via its own Action (the Railway `baseline-cron` is pinned to the
  **test** repo via `GITHUB_REPO`, so it never touches prod). The bundled `VITE_GITHUB_PAT` / `GH_PAT`
  **must have write access to BOTH repos** or prod's `access.json` + baseline writes silently fail.

### Backend ecosystem (Railway)
This SPA is one of many services. Others you'll hear referenced (all on Railway):
`stedi-monday-integration` (eligibility → Monday), `josh-monday-automations` +
`automate-dvs` / `automate-dvs-insurance` / `automate-dvs-subscriptions` (insurance/financial
automation — the "Trigger DVS" column), `parachute-doctor-lookup` (Parachute clinicals/doctor
lookup), `doctor-sync-webhook` / `auto-doctor-database-search` (Doctor Database sync),
`mm-dtc-api` / `manufacturer-referral-webhook` (intake), `mm-patient-portal` /
`reorder-patient-form` / `coins-form-payment` / `patient-intake-texts-backend` (patient-facing),
`baseline-cron-CMD CTR-T` (burndown baseline), and `supabase-mirror` (§5.55: monday → Supabase,
read-only on monday, new patients only, live since 2026-09-29; the gateway reads it for
`/supabase-board` through its own `SUPABASE_DB_URL` reference). The OOP estimator and DVS columns are owned by
these services; when their math changes, `oopEstimator.ts` must be updated to match.

---
