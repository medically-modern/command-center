-- monday_mirror — a read-only mirror of monday.com boards in Postgres (Supabase).
--
-- ⚠️ SANDBOXED. Nothing in the Command Center reads these tables yet, and the
-- mirror service never writes to monday. The point is to have every column and
-- every change of the Profile Send Off board sitting in Postgres, shaped so
-- the app could one day read it instead — and to prove the copy is faithful
-- before anybody flips that switch. See docs/claude/5.55-supabase-mirror-profile-send-off.md.
--
-- Idempotent: the mirror service runs this on every boot (IF NOT EXISTS), and
-- supabase/migrations/ carries a byte-identical copy for `supabase db push`.
-- `services/supabase-mirror/schemaAgreement.test.mjs` fails when they drift.
--
-- Row Level Security is ON for every table with NO policies: through
-- Supabase's API (`anon` / `authenticated`) the schema reads as empty. Only the
-- service role — the mirror's connection string — can see it. Keep it so
-- until the app's read path is designed (§5.55).

CREATE SCHEMA IF NOT EXISTS monday_mirror;

-- ── The board's shape ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS monday_mirror.boards (
  board_id                  BIGINT PRIMARY KEY,
  name                      TEXT NOT NULL,
  items_count               INT,
  shape_synced_at           TIMESTAMPTZ,   -- groups + columns + labels last read
  last_full_sync_at         TIMESTAMPTZ,   -- every item, every column
  last_incremental_sync_at  TIMESTAMPTZ,   -- items updated since the previous pass
  last_reconcile_at         TIMESTAMPTZ,   -- id scan: deletions and silent group moves
  first_seen_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monday_mirror.groups (
  board_id    BIGINT NOT NULL REFERENCES monday_mirror.boards (board_id),
  group_id    TEXT   NOT NULL,
  title       TEXT   NOT NULL,
  color       TEXT,
  position    TEXT,          -- monday's own ordering key (a decimal string)
  archived    BOOLEAN NOT NULL DEFAULT false,
  deleted     BOOLEAN NOT NULL DEFAULT false,
  seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, group_id)
);

CREATE TABLE IF NOT EXISTS monday_mirror.columns (
  board_id    BIGINT NOT NULL REFERENCES monday_mirror.boards (board_id),
  column_id   TEXT   NOT NULL,
  title       TEXT   NOT NULL,
  type        TEXT   NOT NULL,   -- monday column type: status, text, date, …
  description TEXT,
  settings    JSONB,             -- the column's settings_str, parsed
  archived    BOOLEAN NOT NULL DEFAULT false,
  position    INT,               -- order in the board's column list
  seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, column_id)
);

-- Status and dropdown labels, one row each. ⚠️ Label ids are monday's own
-- and belong to the column (CLAUDE.md §9): a status cell stores {"index": id},
-- a dropdown cell {"ids": [id, …]}. This table is what turns either back into
-- words, and it is the reference the typed view joins against.
CREATE TABLE IF NOT EXISTS monday_mirror.labels (
  board_id       BIGINT NOT NULL REFERENCES monday_mirror.boards (board_id),
  column_id      TEXT   NOT NULL,
  label_id       INT    NOT NULL,
  label          TEXT   NOT NULL,
  hex            TEXT,
  is_done        BOOLEAN,
  is_deactivated BOOLEAN,
  seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, column_id, label_id)
);

-- ── The items ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS monday_mirror.items (
  item_id           BIGINT PRIMARY KEY,
  board_id          BIGINT NOT NULL REFERENCES monday_mirror.boards (board_id),
  name              TEXT   NOT NULL,
  group_id          TEXT   NOT NULL,
  -- 'active' while monday's items_page returns it. 'missing' once a reconcile
  -- pass stops seeing it: monday does not say whether it was deleted or
  -- archived, so the mirror does not claim to know either.
  state             TEXT   NOT NULL DEFAULT 'active',
  monday_created_at TIMESTAMPTZ,
  monday_updated_at TIMESTAMPTZ,
  -- {column_id: {"text": "…", "value": <parsed JSON or null>}} for EVERY
  -- column the board had when the item was read. The raw record; the typed
  -- view below turns it into columns.
  column_values     JSONB  NOT NULL DEFAULT '{}'::jsonb,
  values_hash       TEXT,          -- sha1 of name+group+column_values; unchanged ⇒ no write
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  missing_since     TIMESTAMPTZ,
  sync_run_id       BIGINT
);
CREATE INDEX IF NOT EXISTS items_board_group_idx   ON monday_mirror.items (board_id, group_id);
CREATE INDEX IF NOT EXISTS items_updated_idx       ON monday_mirror.items (monday_updated_at DESC);
CREATE INDEX IF NOT EXISTS items_state_idx         ON monday_mirror.items (board_id, state);
CREATE INDEX IF NOT EXISTS items_column_values_gin ON monday_mirror.items USING GIN (column_values jsonb_path_ops);

-- Every change the mirror observed between two reads of an item: one row per
-- column that differed, plus the pseudo-columns __name__, __group__ and
-- __state__. This is the history monday's activity log cannot show for the
-- app's own writes (CLAUDE.md §9), and it is what a ported automation would
-- key on ("when status changes to …").
CREATE TABLE IF NOT EXISTS monday_mirror.item_changes (
  id           BIGSERIAL PRIMARY KEY,
  board_id     BIGINT NOT NULL,
  item_id      BIGINT NOT NULL,
  column_id    TEXT   NOT NULL,
  observed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- monday's own updated_at on the item when the new value was read; the
  -- closest thing to "when it changed" a poll can know.
  monday_updated_at TIMESTAMPTZ,
  old_text     TEXT,
  new_text     TEXT,
  old_value    JSONB,
  new_value    JSONB,
  sync_run_id  BIGINT
);
CREATE INDEX IF NOT EXISTS item_changes_item_idx   ON monday_mirror.item_changes (item_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS item_changes_column_idx ON monday_mirror.item_changes (board_id, column_id, observed_at DESC);

-- ── Bookkeeping ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS monday_mirror.sync_runs (
  id               BIGSERIAL PRIMARY KEY,
  board_id         BIGINT NOT NULL,
  kind             TEXT   NOT NULL,   -- 'shape' | 'full' | 'incremental' | 'reconcile'
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ,
  ok               BOOLEAN,
  since            TIMESTAMPTZ,       -- incremental: the watermark it read from
  pages            INT DEFAULT 0,
  items_seen       INT DEFAULT 0,
  items_upserted   INT DEFAULT 0,
  items_unchanged  INT DEFAULT 0,
  items_missing    INT DEFAULT 0,
  changes          INT DEFAULT 0,
  complexity_used  BIGINT DEFAULT 0,  -- monday's own cost figure, summed
  dry_run          BOOLEAN NOT NULL DEFAULT false,
  error            TEXT
);
CREATE INDEX IF NOT EXISTS sync_runs_board_idx ON monday_mirror.sync_runs (board_id, started_at DESC);

-- The board's automations, as inventoried (monday's public API cannot list
-- them; the rows are seeded from supabase/snapshots/*_automations.json). The
-- port_* columns are where the Supabase version of each one is tracked.
CREATE TABLE IF NOT EXISTS monday_mirror.automations (
  board_id          BIGINT NOT NULL,
  automation_id     BIGINT NOT NULL,
  kind              TEXT   NOT NULL,   -- 'workflow' | 'legacy_recipe'
  active            BOOLEAN NOT NULL,
  title             TEXT,
  sentence          TEXT,              -- legacy: the recipe sentence
  trigger           JSONB,
  conditions        JSONB,
  actions           JSONB,
  config            JSONB,             -- legacy: the recipe's configured column / group / label
  monday_created_at TIMESTAMPTZ,
  monday_updated_at TIMESTAMPTZ,
  snapshot_taken    DATE,
  port_status       TEXT NOT NULL DEFAULT 'not_started', -- not_started | designed | built | live | retired
  port_target       TEXT,              -- 'trigger' | 'service' | 'app' | 'none'
  port_notes        TEXT,
  PRIMARY KEY (board_id, automation_id)
);

-- ── Reading a cell ───────────────────────────────────────────────────────
-- Each takes the item's column_values and a column id. All IMMUTABLE so the
-- typed view can be indexed on them later.

CREATE OR REPLACE FUNCTION monday_mirror.cv_text(cv JSONB, col TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(cv -> col ->> 'text', '')
$$;

CREATE OR REPLACE FUNCTION monday_mirror.cv_value(cv JSONB, col TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof(cv -> col -> 'value') = 'null' THEN NULL ELSE cv -> col -> 'value' END
$$;

-- A status cell's label id ({"index": n}). NULL when blank.
CREATE OR REPLACE FUNCTION monday_mirror.cv_status_id(cv JSONB, col TEXT)
RETURNS INT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (cv -> col -> 'value' ->> 'index')::INT
$$;

-- When a status cell was last set, from the cell itself ({"changed_at": …}).
CREATE OR REPLACE FUNCTION monday_mirror.cv_changed_at(cv JSONB, col TEXT)
RETURNS TIMESTAMPTZ LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (cv -> col -> 'value' ->> 'changed_at')::TIMESTAMPTZ
$$;

-- A date cell ({"date": "YYYY-MM-DD", "time": "HH:MM:SS"?}). ⚠️ monday dates
-- are Eastern wall-clock with no zone (CLAUDE.md §9); kept as DATE + TIME.
CREATE OR REPLACE FUNCTION monday_mirror.cv_date(cv JSONB, col TEXT)
RETURNS DATE LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(cv -> col -> 'value' ->> 'date', '')::DATE
$$;

CREATE OR REPLACE FUNCTION monday_mirror.cv_time(cv JSONB, col TEXT)
RETURNS TIME LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(cv -> col -> 'value' ->> 'time', '')::TIME
$$;

-- A numbers cell: monday stores the number as text in both text and value.
CREATE OR REPLACE FUNCTION monday_mirror.cv_number(cv JSONB, col TEXT)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN NULLIF(cv -> col ->> 'text', '') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (cv -> col ->> 'text')::NUMERIC
    ELSE NULL
  END
$$;

-- A phone cell ({"phone": "16464674333", "countryShortName": "US"}).
CREATE OR REPLACE FUNCTION monday_mirror.cv_phone(cv JSONB, col TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(NULLIF(cv -> col -> 'value' ->> 'phone', ''), NULLIF(cv -> col ->> 'text', ''))
$$;

-- An email cell ({"email": …, "text": …}).
CREATE OR REPLACE FUNCTION monday_mirror.cv_email(cv JSONB, col TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(NULLIF(cv -> col -> 'value' ->> 'email', ''), NULLIF(cv -> col ->> 'text', ''))
$$;

-- A location cell ({"address": …, "lat": "…", "lng": "…"}).
CREATE OR REPLACE FUNCTION monday_mirror.cv_address(cv JSONB, col TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(NULLIF(cv -> col -> 'value' ->> 'address', ''), NULLIF(cv -> col ->> 'text', ''))
$$;

CREATE OR REPLACE FUNCTION monday_mirror.cv_lat(cv JSONB, col TEXT)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN (cv -> col -> 'value' ->> 'lat') ~ '^-?[0-9.]+$' THEN (cv -> col -> 'value' ->> 'lat')::NUMERIC END
$$;

CREATE OR REPLACE FUNCTION monday_mirror.cv_lng(cv JSONB, col TEXT)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN (cv -> col -> 'value' ->> 'lng') ~ '^-?[0-9.]+$' THEN (cv -> col -> 'value' ->> 'lng')::NUMERIC END
$$;

-- A dropdown cell's label ids ({"ids": [n, …]}).
CREATE OR REPLACE FUNCTION monday_mirror.cv_dropdown_ids(cv JSONB, col TEXT)
RETURNS INT[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN jsonb_typeof(cv -> col -> 'value' -> 'ids') = 'array'
    THEN ARRAY(SELECT (x)::INT FROM jsonb_array_elements_text(cv -> col -> 'value' -> 'ids') AS t(x))
    ELSE NULL
  END
$$;

-- A file cell's files ([{assetId, name, fileType, …}]). ⚠️ The asset URL is
-- not in the cell; monday hands out a signed one on request (CLAUDE.md §9).
CREATE OR REPLACE FUNCTION monday_mirror.cv_files(cv JSONB, col TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof(cv -> col -> 'value' -> 'files') = 'array' THEN cv -> col -> 'value' -> 'files' END
$$;

-- ── Sandboxing ───────────────────────────────────────────────────────────

ALTER TABLE monday_mirror.boards       ENABLE ROW LEVEL SECURITY;
ALTER TABLE monday_mirror.groups       ENABLE ROW LEVEL SECURITY;
ALTER TABLE monday_mirror.columns      ENABLE ROW LEVEL SECURITY;
ALTER TABLE monday_mirror.labels       ENABLE ROW LEVEL SECURITY;
ALTER TABLE monday_mirror.items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE monday_mirror.item_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE monday_mirror.sync_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE monday_mirror.automations  ENABLE ROW LEVEL SECURITY;

-- On Supabase the API roles exist; on a plain Postgres they do not. Either
-- way the schema is not granted to them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA monday_mirror FROM anon';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA monday_mirror FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA monday_mirror FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA monday_mirror FROM authenticated';
  END IF;
END $$;
