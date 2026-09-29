# supabase-mirror

Mirrors monday.com boards into Supabase (Postgres). **Read-only on monday**: it only
ever sends GraphQL queries, and `noMondayWrites.test.mjs` fails the build if the word
`mutation` appears in the service. **Off by default**: without `MIRROR_ENABLED=1` it
logs one line and exits 0.

Full design, the column and automation inventory of the first board (Profile Send
Off), and the plan for flipping the app onto the mirror one day:
`docs/claude/5.55-supabase-mirror-profile-send-off.md`.

## What lands in Postgres

Schema `monday_mirror` (`db/0001_monday_mirror.sql`, applied on every boot,
idempotent):

| table | holds |
|---|---|
| `boards` · `groups` · `columns` · `labels` | the board's shape — every column with its settings, every status/dropdown label with monday's own label id |
| `items` | one row per item: name, group, monday's timestamps, and `column_values` — every cell's `text` and parsed `value`, as monday returned them |
| `item_changes` | one row per column that differed between two reads of an item (plus `__name__`, `__group__`, `__state__`) — the history monday's activity log cannot show for the app's own writes |
| `sync_runs` | every pass: kind, counts, monday complexity used, errors |
| `automations` | the board's automations as inventoried (`db/0003_…`), with `port_status` / `port_target` / `port_notes` for tracking the port |
| `profile_send_off` (view, `db/0002_…`) | one typed Postgres column per board column, named after the app's own `COL` keys — generated, never hand-edited |

Row Level Security is on for every table with no policies: Supabase's API roles see
nothing. Only the service role (the connection string below) reads or writes.

## Running it

```
MIRROR_ENABLED=1
MONDAY_API_TOKEN=…            # read scope is enough
SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
MIRROR_BOARD_IDS=18406352652  # default: Profile Send Off
```

Use Supabase's **Session pooler** (port 5432) or direct connection string — not the
transaction pooler on 6543, which does not support the prepared statements `pg`
uses. Optional: `MIRROR_INTERVAL_SECONDS` (120), `MIRROR_PAGE_SIZE` (50),
`MIRROR_PAGE_DELAY_MS` (400), `MIRROR_RECONCILE_HOURS` (24), `MIRROR_FULL=1` (force a
full re-read), `ONCE=1` (one pass, exit), `DRY_RUN=1` (read monday, write nothing).

A pass is: shape → full read (first time only; ~60 requests for Profile Send Off) or
incremental read (items ordered newest-updated first, back to the previous pass's
watermark — one small request in a quiet hour) → a daily reconcile (ids-only scan;
items monday stopped listing become `state = 'missing'`, silent group moves are
re-read). Every answer's `complexity.after` is honoured: under
`MIRROR_COMPLEXITY_FLOOR` the service sleeps out the minute.

## Tests

```
npx vitest run services/supabase-mirror                # pure rules, wiring, schema agreement
MIRROR_TEST_DB_URL=postgres://… npx vitest run services/supabase-mirror   # + the whole pass against a real Postgres (creates and DROPS monday_mirror there)
```

## Regenerating the generated files

```
node scripts/supabase-mirror/gen-view.mjs supabase/snapshots/profile_send_off_board.json src/lib/profile/mondayApi.ts monday_mirror.profile_send_off > services/supabase-mirror/db/0002_profile_send_off_view.sql
node scripts/supabase-mirror/gen-seed.mjs supabase/snapshots/profile_send_off_automations.json > services/supabase-mirror/db/0003_profile_send_off_automations.sql
cp services/supabase-mirror/db/*.sql supabase/migrations/
```

`schemaAgreement.test.mjs` fails when the committed SQL is not what the generators
produce, or when `supabase/migrations/` differs from `db/`.
