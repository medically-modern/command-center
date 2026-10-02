/**
 * appActorsRules.mjs — the pure half of GET /oversight/app-actors.
 *
 * Josh, 2026-10-02: Brandon's Onboarding Oversight dashboard (/onboarding-oversight)
 * reads monday's activity logs to see who worked a patient. Every write the
 * Command Center makes reaches monday through this gateway on ONE shared token,
 * so in monday's log they all belong to the same user and the dashboard can
 * only call them "Shared Command Center account". The person behind each of
 * those writes is in `gql_log.actor`. This route hands the dashboard just
 * enough to match a shared-token event to its person — the spec's §3.10.1
 * rule 2, "Phase 7" in its docs.
 *
 * ⚠️ WHAT LEAVES THE GATEWAY: item id, board id, who, when, and the column
 * IDS that were written. Never a column VALUE — `gql_log.columns` holds the
 * written values (patient data), so the SQL selects only its keys and the
 * values never leave Postgres.
 */

/** The four onboarding boards the dashboard reads (its config.boards). */
export const OVERSIGHT_BOARDS = ["18406352652", "18406060017", "18410601299", "18410804557"];
export const DEFAULT_DAYS = 28;
export const MAX_DAYS = 60;
export const MAX_ROWS = 100_000;

/**
 * The window and boards a request asks for, clamped. `since` is an ISO time
 * (the dashboard sends its own history start); absent, the last 28 days.
 * Never more than 60 days back, and only the onboarding boards.
 */
export function parseAppActorsQuery(q = {}, now = Date.now()) {
  const floor = now - MAX_DAYS * 864e5;
  let requested = now - DEFAULT_DAYS * 864e5;
  const raw = String(q.since ?? "").trim();
  if (raw) {
    const t = Date.parse(raw);
    if (!Number.isFinite(t)) return { error: "since must be an ISO date-time" };
    requested = t;
  }
  const sinceMs = Math.max(floor, Math.min(requested, now));
  const asked = String(q.boards ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const boards = asked.length ? asked.filter((b) => OVERSIGHT_BOARDS.includes(b)) : OVERSIGHT_BOARDS;
  if (!boards.length) return { error: `boards must be among ${OVERSIGHT_BOARDS.join(", ")}` };
  // Echoed so a caller asking for more than 60 days is TOLD it got less, rather
  // than reading the missing weeks as "nobody did anything".
  return { sinceMs, boards, clamped: sinceMs !== requested };
}

/**
 * The query. Successful writes on an item, by a named actor, on the given
 * boards, since the given time. `jsonb_object_keys` keeps the values inside
 * Postgres — only column ids come back.
 */
export function buildAppActorsSql({ sinceMs, boards }) {
  return {
    sql: `SELECT item_id, board_id, actor, (extract(epoch from created_at) * 1000)::bigint AS ms,
                 COALESCE((SELECT array_agg(k) FROM jsonb_object_keys(columns) AS k), '{}') AS cols
            FROM gql_log
           WHERE operation = 'mutation' AND ok = true
             AND item_id IS NOT NULL AND actor IS NOT NULL AND actor <> ''
             AND columns IS NOT NULL AND jsonb_typeof(columns) = 'object'
             AND board_id = ANY($1::text[])
             AND created_at > to_timestamp($2::double precision / 1000)
           ORDER BY created_at ASC
           LIMIT $3`,
    args: [boards, sinceMs, MAX_ROWS + 1],
  };
}

/** Postgres rows → the compact wire shape [itemId, boardId, actor, ms, cols]. */
export function shapeAppActorRows(rows) {
  const truncated = rows.length > MAX_ROWS;
  const out = [];
  for (const r of truncated ? rows.slice(0, MAX_ROWS) : rows) {
    const cols = Array.isArray(r.cols) ? r.cols.map(String) : [];
    if (!cols.length) continue;
    out.push([String(r.item_id), String(r.board_id), String(r.actor).toLowerCase(), Number(r.ms), cols]);
  }
  return { rows: out, truncated };
}
