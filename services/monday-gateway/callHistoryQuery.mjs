/**
 * Pure query builder for GET /calls/history.
 *
 * Split out of inboundCalls.mjs for the same reason callRules.mjs and
 * rcAllowlist.mjs were: that module imports express and pg, so nothing in it
 * can be unit-tested, and the parts worth testing here are the BOUNDS. An
 * append-only audit table with an unbounded LIMIT or window is how one curious
 * request becomes a slow query for everybody, and a clamp is exactly the kind
 * of rule that is silently correct until the day it isn't.
 *
 * Everything is parameterised — no caller input is ever concatenated into SQL.
 * The only interpolation is `$n` placeholders and a WHERE joined from a fixed
 * set of clauses this file owns.
 */

import { last4 } from "./callRules.mjs";

/** Longest window a caller may ask for, and the biggest page. */
export const MAX_HOURS = 24 * 90; // 90 days
export const MAX_LIMIT = 1000;
export const DEFAULT_HOURS = 24;
export const DEFAULT_LIMIT = 200;

/** Clamp to [lo, hi], falling back to `dflt` for anything non-numeric.
 *  ⚠️ `Number("")` is 0 and `Number(undefined)` is NaN — both must land on the
 *  default, not on the floor, or an absent param would silently mean "1 hour". */
function clamp(raw, dflt, lo, hi) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return dflt;
  return Math.min(Math.max(Math.floor(n), lo), hi);
}

/**
 * Build the events query.
 * Returns { sql, args, hours, limit } — `hours`/`limit` are the CLAMPED values,
 * so the route can echo back what it actually did rather than what was asked.
 */
export function buildHistoryQuery({ session, last4: lastFour, hours, limit } = {}) {
  const h = clamp(hours, DEFAULT_HOURS, 1, MAX_HOURS);
  const lim = clamp(limit, DEFAULT_LIMIT, 1, MAX_LIMIT);

  const where = [`at > now() - ($1 || ' hours')::interval`];
  const args = [String(h)];

  const sess = String(session ?? "").trim();
  if (sess) {
    args.push(sess);
    where.push(`session_id = $${args.length}`);
  }
  // callRules.last4 — the SAME helper that stamped the column on the way in,
  // deliberately not a second copy of the rule: a query that normalises
  // differently from the writer silently matches nothing.
  const four = last4(lastFour);
  if (four) {
    args.push(four);
    where.push(`last4 = $${args.length}`);
  }
  args.push(lim);

  const sql =
    `SELECT at, session_id, kind, state, audience, claimed_by, last4, detail\n` +
    `  FROM call_events\n` +
    ` WHERE ${where.join(" AND ")}\n` +
    ` ORDER BY at DESC\n` +
    ` LIMIT $${args.length}`;

  return { sql, args, hours: h, limit: lim };
}
