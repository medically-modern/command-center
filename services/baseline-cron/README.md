# Baseline Cron

Railway cron service that replaces the GitHub Actions `daily-baseline.yml` workflow.

Runs every weekday at 9:00 AM ET. Queries all Monday.com boards for patient counts and commits `public/data/baseline.json` to this repo via the GitHub Contents API.

## Environment Variables (set in Railway)

- `MONDAY_API_TOKEN` — Monday.com API token
- `GITHUB_PAT` — GitHub PAT with contents:write on this repo
- `GITHUB_REPO` — `medically-modern/command-center-test`

## Railway Config

- **Root Directory:** `services/baseline-cron`
- **Cron Schedule:** `0 13 * * 1-5` (9 AM ET = 13:00 UTC during EDT)
- **Region:** US East
