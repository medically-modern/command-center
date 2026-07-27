-- monday-gateway audit schema.
-- The server runs this automatically on boot (CREATE ... IF NOT EXISTS), so you
-- normally don't need to apply it by hand. Kept here for reference and for
-- running ad-hoc against the Railway Postgres instance.

CREATE TABLE IF NOT EXISTS gql_log (
  id             BIGSERIAL PRIMARY KEY,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor          TEXT,          -- X-MM-User header (best-effort; unauthenticated today)
  client_ip      TEXT,          -- first hop of X-Forwarded-For
  origin         TEXT,          -- request Origin header
  user_agent     TEXT,
  operation      TEXT,          -- 'query' | 'mutation'
  operation_name TEXT,          -- parsed GraphQL operation name, if any
  board_id       TEXT,          -- best-effort from variables
  item_id        TEXT,          -- best-effort from variables
  query_text     TEXT,          -- only populated when LOG_PAYLOAD=true (PHI)
  variables      JSONB,         -- only populated when LOG_PAYLOAD=true (PHI)
  monday_status  INT,           -- HTTP status returned by Monday
  monday_errors  JSONB,         -- Monday GraphQL errors[], if any
  ok             BOOLEAN,       -- 2xx and no GraphQL errors
  duration_ms    INT
);

-- {colId: value} — what a mutation actually changed. Populated for EVERY write
-- (inline or variable-based) since 2026-07; before that only the handful of
-- inline mutations landed here. Contains patient values = PHI.
ALTER TABLE gql_log ADD COLUMN IF NOT EXISTS columns JSONB;
-- TRUE = actor came from a verified Google Workspace ID token; FALSE = the
-- self-asserted X-MM-User header; NULL = not recorded (rows predating the
-- column, and /send rows). Only TRUE rows are safe to attribute to a person.
ALTER TABLE gql_log ADD COLUMN IF NOT EXISTS actor_verified BOOLEAN;

CREATE INDEX IF NOT EXISTS gql_log_created_at_idx ON gql_log (created_at DESC);
CREATE INDEX IF NOT EXISTS gql_log_operation_idx  ON gql_log (operation);
CREATE INDEX IF NOT EXISTS gql_log_item_idx       ON gql_log (item_id);
CREATE INDEX IF NOT EXISTS gql_log_actor_idx      ON gql_log (actor);

-- Convenience view: the writes people actually audit.
CREATE OR REPLACE VIEW gql_writes AS
  SELECT id, created_at, actor, actor_verified, client_ip, origin, item_id, board_id,
         operation_name, ok, monday_status, monday_errors, duration_ms,
         columns, query_text, variables
  FROM gql_log
  WHERE operation = 'mutation';

-- Example audit queries:
--   Recent writes:        SELECT * FROM gql_writes LIMIT 100;
--   Writes for one item:  SELECT * FROM gql_writes WHERE item_id = '123456789';
--   Failed writes today:  SELECT * FROM gql_writes WHERE ok = false AND created_at > now() - interval '1 day';
--
--   Who changed a given column, and to what:
--     SELECT created_at, actor, item_id, columns->>'text_mm1x2qk2' AS member_id
--     FROM gql_writes WHERE columns ? 'text_mm1x2qk2' ORDER BY created_at DESC;
--
--   Member IDs that look like a name rather than an ID (the Raska failure):
--     SELECT created_at, actor, item_id, columns->>'text_mm1x2qk2' AS member_id
--     FROM gql_writes
--     WHERE columns->>'text_mm1x2qk2' ~ '[A-Za-z]'
--       AND columns->>'text_mm1x2qk2' !~ '[0-9]'
--     ORDER BY created_at DESC;
--
--   Everything one person changed on one day:
--     SELECT created_at, item_id, columns FROM gql_writes
--     WHERE actor = 'someone@medicallymodern.com' AND actor_verified
--       AND created_at::date = DATE '2026-07-24' ORDER BY created_at;
--   Activity by person:   SELECT actor, count(*) FROM gql_writes GROUP BY actor ORDER BY 2 DESC;
