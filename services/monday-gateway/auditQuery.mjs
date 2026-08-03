/**
 * Audit-view filter building.
 *
 * Extracted from index.mjs for the same reason columns.mjs was: so the part
 * that is easy to get silently wrong can be unit-tested without booting the
 * server or standing up Postgres. Placeholder numbering ($1, $2, …) has to
 * track the params array exactly — an off-by-one there doesn't throw, it
 * returns the WRONG ROWS, which in an audit tool is worse than an error.
 *
 * WHY THESE FILTERS EXIST
 * -----------------------
 * gql_log has recorded everything needed to answer "what exactly did they
 * submit that failed" since 2026-07: `columns` holds the decoded {colId: value}
 * of every mutation (independent of LOG_PAYLOAD, which only gates query_text +
 * variables), `monday_errors` holds Monday's rejection, and `ok` marks it.
 *
 * The viewer could not ask that question. It rendered the newest 1000 rows with
 * no filter and never SELECTed monday_errors, so a failure showed as a red
 * "FAIL" with no reason, buried in thousands of successful writes. Two incidents
 * on 2026-08-03 (a rejected Doctor Email on the Insurance board, a rejected
 * phone on Welcome Call) were both diagnosed from Monday board data instead,
 * because the audit log — which had both answers — could not surface them.
 */

/** Hard ceilings so a stray query string can't ask for the whole table. */
export const MAX_LIMIT = 50000;
export const DEFAULT_LIMIT = 1000;
export const MAX_SINCE_DAYS = 3650;

/**
 * Turn the request's query string into a WHERE clause + ordered params.
 *
 * Returns the resolved filter state too, so the renderer and the SQL can never
 * disagree about what is being shown.
 */
export function buildAuditQuery(q = {}) {
  const limit = Math.min(parseInt(q.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);
  const onlyWrites = q.all !== "1";
  const onlyFailed = q.failed === "1";
  const item = String(q.item ?? "").trim();
  const actor = String(q.actor ?? "").trim();
  const sinceDays = Math.min(parseInt(q.since, 10) || 0, MAX_SINCE_DAYS);

  const conds = [];
  const params = [];
  if (onlyWrites) conds.push("operation = 'mutation'");
  // `ok` is the only reliable failure signal. Monday answers HTTP 200 with an
  // errors[] body when it rejects a column value, so monday_status reads 200 on
  // exactly the failures anyone is looking for.
  if (onlyFailed) conds.push("ok = false");
  if (item) {
    params.push(item);
    conds.push(`item_id = $${params.length}`);
  }
  if (actor) {
    params.push(`%${actor}%`);
    conds.push(`actor ILIKE $${params.length}`);
  }
  if (sinceDays) {
    // Passed as an interval STRING ('7 days') rather than interpolated, so the
    // value stays a bound parameter.
    params.push(`${sinceDays} days`);
    conds.push(`created_at > now() - $${params.length}::interval`);
  }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  // LIMIT is always the LAST param — callers append it to the SQL as
  // `LIMIT $${params.length}`.
  params.push(limit);

  return { where, params, limit, onlyWrites, onlyFailed, item, actor, sinceDays };
}
