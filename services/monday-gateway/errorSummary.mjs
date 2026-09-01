/**
 * Pure query builder + redaction for GET /audit/errors.json.
 *
 * Split out of index.mjs for the same reason callHistoryQuery.mjs and
 * callRules.mjs were: that module imports express and pg, so nothing in it can
 * be unit-tested, and the parts worth testing here are the BOUNDS and the
 * REDACTION — the two rules that are silently correct until the day they
 * aren't.
 *
 * ⚠️ THIS ENDPOINT IS UNAUTHENTICATED, deliberately, so a monitor needs no
 * secret (the same posture `/calls/health` already has beside it). That makes
 * the redaction a SECURITY BOUNDARY, not tidiness. `/audit` and `/audit.json`
 * stay key-gated because they return actors, IPs, item ids and column values;
 * this one returns counts, timestamps and a scrubbed error string, and must
 * never grow a field that identifies a patient, a rep or an item.
 *
 * Monday's error text is not a fixed vocabulary — it echoes values we sent
 * ("The label 'St Anne Clinic' does not exist"), so the raw message can carry a
 * clinic or patient name. Grouping happens on the REDACTED form for that
 * reason: the raw text never leaves this process.
 */

/** Longest window a caller may ask for, and the most groups returned. */
export const MAX_HOURS = 24 * 30; // 30 days
export const DEFAULT_HOURS = 24;
export const MAX_GROUPS = 50;
export const MAX_MESSAGE_LEN = 160;

/** Clamp to [lo, hi], falling back to `dflt` for anything non-numeric.
 *  ⚠️ `Number("")` is 0 and `Number(undefined)` is NaN — both must land on the
 *  default, not on the floor, or an absent param would silently mean 1 hour. */
function clamp(raw, dflt, lo, hi) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return dflt;
  return Math.min(Math.max(Math.floor(n), lo), hi);
}

/**
 * Scrub a Monday error message down to its shape.
 *
 * Order matters: quoted runs go first (that is where echoed values live), then
 * bare digit runs (item and board ids, phone numbers), then whitespace, then
 * the length cap. Truncating first would leave a half-quoted value intact.
 */
export function redactErrorMessage(raw) {
  let s = String(raw ?? "");
  s = s.replace(/"[^"]*"/g, '"…"');
  s = s.replace(/'[^']*'/g, "'…'");
  s = s.replace(/\d{4,}/g, "#");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > MAX_MESSAGE_LEN) s = `${s.slice(0, MAX_MESSAGE_LEN - 1)}…`;
  return s || "(empty)";
}

/**
 * Distinct failure messages in the window, most frequent first.
 *
 * Grouped in SQL on the RAW message so one aggregate covers a busy window
 * without shipping a row per failure, then re-grouped in JS on the redacted
 * form (see `summarize`) — distinct raw messages are in the dozens, distinct
 * failures can be in the thousands.
 *
 * `monday_errors` is Monday's errors[] as JSONB, but a single object has been
 * stored there too, so it is normalised to an array before unnesting. Each
 * element is usually {message}, sometimes {error}, sometimes a bare string.
 */
export function buildErrorGroupsQuery({ hours } = {}) {
  const h = clamp(hours, DEFAULT_HOURS, 1, MAX_HOURS);
  const sql = `
    SELECT raw_message,
           COUNT(*)::int   AS n,
           MIN(created_at) AS first_seen,
           MAX(created_at) AS last_seen
    FROM (
      SELECT g.created_at,
             COALESCE(
               e ->> 'message',
               e ->> 'error',
               CASE WHEN jsonb_typeof(e) = 'string' THEN e #>> '{}' ELSE e::text END
             ) AS raw_message
      FROM gql_log g
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(g.monday_errors) = 'array'
             THEN g.monday_errors
             ELSE jsonb_build_array(g.monday_errors) END
      ) AS e
      WHERE g.created_at > now() - ($1 || ' hours')::interval
        AND g.ok IS NOT TRUE
        AND g.monday_errors IS NOT NULL
    ) t
    GROUP BY raw_message
    ORDER BY n DESC
    LIMIT ${MAX_GROUPS}
  `;
  return { sql, args: [String(h)], hours: h };
}

/** Denominators for the same window: how many calls, how many failed. */
export function buildTotalsQuery({ hours } = {}) {
  const h = clamp(hours, DEFAULT_HOURS, 1, MAX_HOURS);
  const sql = `
    SELECT COUNT(*)::int                                         AS requests,
           COUNT(*) FILTER (WHERE ok IS NOT TRUE)::int            AS failures,
           COUNT(*) FILTER (WHERE operation = 'mutation')::int    AS writes,
           -- Split the failures by what they cost. A failed WRITE is a rep's
           -- save going nowhere; a failed READ self-heals on the next poll
           -- (every 15-30s), so the rep saw one stale render at worst. Pooling
           -- them made the number that matters unfindable under the one that
           -- does not -- see failureWatch's alert rule.
           COUNT(*) FILTER (WHERE ok IS NOT TRUE
                              AND operation = 'mutation')::int    AS failed_writes,
           COUNT(*) FILTER (WHERE ok IS NOT TRUE
                              AND operation IS DISTINCT FROM 'mutation')::int
                                                                  AS failed_reads
    FROM gql_log
    WHERE created_at > now() - ($1 || ' hours')::interval
  `;
  return { sql, args: [String(h)], hours: h };
}

/**
 * Redact, then merge rows whose messages collapse to the same shape.
 * Counts add; the window is the union of theirs.
 */
export function summarize(rows = []) {
  const byMessage = new Map();
  for (const r of rows) {
    const message = redactErrorMessage(r.raw_message);
    const prev = byMessage.get(message);
    const first = r.first_seen ?? null;
    const last = r.last_seen ?? null;
    if (!prev) {
      byMessage.set(message, { message, count: Number(r.n) || 0, firstSeen: first, lastSeen: last });
      continue;
    }
    prev.count += Number(r.n) || 0;
    if (first && (!prev.firstSeen || first < prev.firstSeen)) prev.firstSeen = first;
    if (last && (!prev.lastSeen || last > prev.lastSeen)) prev.lastSeen = last;
  }
  return [...byMessage.values()].sort((a, b) => b.count - a.count || a.message.localeCompare(b.message));
}
