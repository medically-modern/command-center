/**
 * requestLog.mjs — every request this gateway serves, kept in Postgres.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 * Railway's HTTP log returns at most 500 lines per query. On this gateway that
 * is roughly THIRTEEN MINUTES. Answering "what happened at 4:46 on the 20th"
 * meant paging that window by hand before it aged out, and a question asked a
 * week later could not be answered at all (ticket MM-1090, 2026-08-20).
 *
 * gql_log already covers /gql in far more detail. What had no durable record
 * was everything else: /rc/* (the RingCentral proxy), /messaging/*, /send,
 * /calls/*, /audit. Those are exactly the routes involved when the phone system
 * misbehaves — and the RingCentral incident of 2026-08-20 was diagnosed from a
 * request RATE, which is a thing you can only see if you kept the requests.
 *
 * ── What is deliberately NOT stored ─────────────────────────────────────────
 * No bodies, no headers, no response payloads. Metadata only, matching the
 * gateway's standing posture (LOG_PAYLOAD=false, CLAUDE.md §8/§9: the gateway
 * audits requests and stores no PHI).
 *
 * ⚠️ AND NO QUERY STRINGS. This is a security property, not tidiness:
 *   · /calls/stream?token=<Google ID token> — EventSource cannot set headers,
 *     so the caller's credential rides in the URL. Logging it would put live
 *     bearer tokens in Postgres.
 *   · /calls/history?last4=… and /rc/fetch?url=… carry patient identifiers.
 * stripQuery() is what keeps both out, and it runs before anything is stored.
 */

/** Routes that are logged somewhere better, or are pure noise. */
export const SKIP_EXACT = new Set([
  // Already in gql_log, with the operation, the columns written and Monday's
  // errors. Re-logging it here would duplicate ~130k rows a day to say less.
  "/gql",
  // Railway's liveness probe. Its verdict is already in the deployment status,
  // and at one poll per 30s it would be a large share of this table saying
  // "still up" over and over.
  "/health",
]);

/**
 * Should this request get a row?
 *
 * ⚠️ OPTIONS is skipped: every cross-origin POST is preceded by one, so
 * including them roughly doubles the table to record a 204 that carries no
 * information the POST beside it doesn't.
 */
export function shouldLogRequest(method, path) {
  if (String(method || "").toUpperCase() === "OPTIONS") return false;
  return !SKIP_EXACT.has(stripQuery(path));
}

/** Path with the query string removed — see the header note. Never store a raw URL. */
export function stripQuery(url) {
  const s = String(url ?? "");
  const cut = s.indexOf("?");
  const path = cut === -1 ? s : s.slice(0, cut);
  // Also drop a fragment, which express won't send but a hand-built call might.
  const hash = path.indexOf("#");
  return hash === -1 ? path : path.slice(0, hash);
}

/** Columns are TEXT; a runaway UA or path must not become a runaway row. */
export function clip(value, max) {
  if (value == null) return null;
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}

export const MAX_LIMIT = 5000;
export const DEFAULT_LIMIT = 500;
export const MAX_HOURS = 24 * 365;
export const DEFAULT_HOURS = 24;

function clamp(raw, dflt, lo, hi) {
  const n = Number(raw);
  // ⚠️ `Number("")` is 0 and `Number(undefined)` is NaN — both mean "not asked",
  // which must land on the default window, never on the floor.
  if (!Number.isFinite(n) || n <= 0) return dflt;
  return Math.min(Math.max(Math.floor(n), lo), hi);
}

/**
 * Build the read query for GET /audit/requests.json.
 *
 * Everything is parameterised; the only interpolation is `$n` placeholders and
 * a WHERE joined from clauses this file owns. Placeholder numbering has to
 * track the args array exactly — an off-by-one there doesn't throw, it returns
 * the wrong rows, which in an audit tool is worse than an error.
 */
export function buildRequestLogQuery(q = {}) {
  const hours = clamp(q.hours, DEFAULT_HOURS, 1, MAX_HOURS);
  const limit = clamp(q.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);

  const where = [`at > now() - ($1 || ' hours')::interval`];
  const args = [String(hours)];

  const path = String(q.path ?? "").trim();
  if (path) {
    args.push(`${path}%`); // prefix match: "/rc" finds the whole proxy surface
    where.push(`path LIKE $${args.length}`);
  }
  const actor = String(q.actor ?? "").trim();
  if (actor) {
    args.push(`%${actor}%`);
    where.push(`actor ILIKE $${args.length}`);
  }
  const method = String(q.method ?? "").trim().toUpperCase();
  if (method) {
    args.push(method);
    where.push(`method = $${args.length}`);
  }
  // `failed=1` is the question actually asked of an audit log, and it has to
  // mean 4xx/5xx rather than "not 200": a 204 preflight or a 304 is a success.
  if (String(q.failed ?? "") === "1") where.push(`status >= 400`);
  const status = Number(q.status);
  if (Number.isFinite(status) && status > 0) {
    args.push(Math.floor(status));
    where.push(`status = $${args.length}`);
  }
  args.push(limit);

  const sql =
    `SELECT at, method, path, status, duration_ms, actor, client_ip, user_agent, origin\n` +
    `  FROM request_log\n` +
    ` WHERE ${where.join(" AND ")}\n` +
    ` ORDER BY at DESC\n` +
    ` LIMIT $${args.length}`;

  return { sql, args, hours, limit };
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS request_log (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  method      TEXT,
  -- ⚠️ QUERY STRING STRIPPED. /calls/stream carries a Google ID token here and
  -- /rc/fetch carries patient identifiers; see stripQuery in requestLog.mjs.
  path        TEXT,
  status      INT,
  duration_ms INT,
  actor       TEXT,
  client_ip   TEXT,
  user_agent  TEXT,
  origin      TEXT
);
CREATE INDEX IF NOT EXISTS request_log_at_idx     ON request_log (at DESC);
CREATE INDEX IF NOT EXISTS request_log_path_idx   ON request_log (path);
CREATE INDEX IF NOT EXISTS request_log_status_idx ON request_log (status);
CREATE INDEX IF NOT EXISTS request_log_actor_idx  ON request_log (actor);
`;

/**
 * Days of history kept. Unlike call_events (tiny, precious, unpruned), this one
 * DOES grow: ~17k rows/day today, so a year is ~6M. Six months is well past the
 * point where anyone is still asking about an incident, and the horizon is an
 * env var so it can be raised without a code change.
 */
export const RETENTION_DAYS = Math.max(Number(process.env.REQUEST_LOG_RETENTION_DAYS) || 180, 1);

/**
 * Express middleware. Registered BEFORE the routes so `res.on("finish")` is
 * attached in time, and it never touches the response.
 *
 * ⚠️ Fire-and-forget, always. A logging write must not add latency to a request
 * or fail one: this gateway serves a webhook endpoint RingCentral will
 * blacklist if it is slow, and forwards calls that are ringing right now.
 * Losing an audit row is a strictly smaller failure than either.
 */
export function requestLogger({ pool, clientIp }) {
  return function requestLogMiddleware(req, res, next) {
    if (!pool || !shouldLogRequest(req.method, req.originalUrl || req.url)) return next();
    const started = Date.now();
    res.on("finish", () => {
      const path = stripQuery(req.originalUrl || req.url);
      pool
        .query(
          `INSERT INTO request_log
             (method, path, status, duration_ms, actor, client_ip, user_agent, origin)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            clip(req.method, 10),
            clip(path, 512),
            res.statusCode,
            Date.now() - started,
            // Self-asserted, exactly like gql_log.actor: this middleware runs
            // before any route verifies a token, so it is a hint for filtering
            // and never proof of who did something. /calls/* rows are the
            // trustworthy ones — those routes verify identity themselves.
            clip(req.headers["x-mm-user"] || null, 254),
            clip(clientIp(req), 64),
            clip(req.headers["user-agent"] || null, 512),
            clip(req.headers.origin || null, 254),
          ],
        )
        .catch((e) => console.error("request_log insert failed:", e.message));
    });
    next();
  };
}

/** Drop rows past the horizon. Safe to call repeatedly; logs what it removed. */
export async function pruneRequestLog(pool, days = RETENTION_DAYS) {
  if (!pool) return 0;
  try {
    const r = await pool.query(
      `DELETE FROM request_log WHERE at < now() - ($1 || ' days')::interval`,
      [String(days)],
    );
    if (r.rowCount) console.log(`request_log: pruned ${r.rowCount} rows older than ${days}d`);
    return r.rowCount || 0;
  } catch (e) {
    console.error("request_log prune failed:", e.message);
    return 0;
  }
}
