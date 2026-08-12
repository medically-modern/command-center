/**
 * "Who marked this stage complete?"
 *
 * Monday can't answer it. Every write the SPA makes carries the SAME Monday API
 * token, so a board activity log attributes all of them to one service account
 * — which is exactly why this gateway records `actor` (the signed-in email)
 * against every mutation in the first place. The audit log is the only place
 * the person's name exists.
 *
 * The caller already knows WHEN the stage completed (from Monday's activity
 * log — see src/lib/systemMgmt/stageCompletion.ts), so this is a narrow lookup:
 * which audit row wrote the advancer that finished the stage, and who was
 * signed in when it did.
 *
 * Selection lives here as a pure function, for the same reason columns.mjs and
 * auditQuery.mjs do: naming the WRONG person is worse than naming nobody, and
 * that mistake is invisible in production — the banner would just say a
 * confident, wrong email.
 */

/**
 * How far BEFORE the completion instant an audit row still counts.
 *
 * A "send" is a transaction, not an instant: `executeWritesWithVerification`
 * writes the data columns, polls Monday until each reads back (≤ ~12s), and
 * only then writes the advancer — and the durable /send queue can add more on
 * top. 30 minutes is far wider than any observed send, and the tie-break below
 * (latest row wins) means a generous window costs nothing.
 */
export const LOOKBACK_MS = 30 * 60_000;

/**
 * How far AFTER it. The completion instant is usually the board automation's
 * group move, which fires after the rep's write lands — but on boards where the
 * move isn't logged we fall back to the status write itself, so the row can sit
 * on either side. Kept short: the further past the completion, the more likely a
 * row belongs to somebody else's later edit.
 */
export const GRACE_MS = 2 * 60_000;

/** The [from, to] audit window for a completion at `atIso`. */
export function completionWindow(atIso) {
  const at = new Date(atIso).getTime();
  if (!Number.isFinite(at)) return null;
  return {
    from: new Date(at - LOOKBACK_MS).toISOString(),
    to: new Date(at + GRACE_MS).toISOString(),
  };
}

/**
 * Pick the audit row that completed the stage, from rows already narrowed to
 * one item and the window above. `rows` newest-first, shaped like gql_log:
 * `{ created_at, actor, actor_verified, columns, ok }`.
 *
 * Two passes, and the order matters:
 * 1. A row that actually wrote `columnId` — the stage advancer. This IS the
 *    completion; nothing else in the window is better evidence.
 * 2. Otherwise the latest attributed row in the window. A send writes the
 *    advancer LAST, so whoever wrote anything else immediately before it is the
 *    same person — but this is an inference, so it comes back flagged
 *    (`matchedColumn: false`) and the UI can say so.
 *
 * Returns null rather than a guess when nothing is attributable: the write
 * predates the gateway, or it was made by hand on the Monday board.
 */
export function pickCompletionActor(rows, columnId) {
  const usable = (rows || []).filter((r) => r && r.ok !== false && String(r.actor || "").trim());
  const wroteColumn = columnId
    ? usable.filter((r) => r.columns && Object.prototype.hasOwnProperty.call(r.columns, columnId))
    : [];

  const pick = (list) =>
    list.reduce(
      (best, r) => (!best || new Date(r.created_at) > new Date(best.created_at) ? r : best),
      null,
    );

  const row = pick(wroteColumn) || pick(usable);
  if (!row) return null;
  return {
    actor: String(row.actor).trim(),
    // NULL is the norm, not an anomaly: /send rows carry no verified flag, and
    // /send is the durable path the main flows use. Only TRUE means the email
    // came from a checked Google token (see gql_log's schema comment).
    verified: row.actor_verified === true,
    at: new Date(row.created_at).toISOString(),
    matchedColumn: wroteColumn.includes(row),
  };
}

/**
 * GET /audit/stage-completion?item=&at=&column=
 *   → { actor, verified, at, matchedColumn } | { actor: null, reason }
 *
 * No auth gate, matching /gql and /send: auth is enforced once at the website's
 * Google sign-in gate, not per request (Josh, 2026-08-12). Anyone working in the
 * Command Center sees who did what, the same as every other fact the app shows
 * them — and this route returns one internal email for an item id the caller
 * already has, next to a /gql that will forward arbitrary GraphQL to the whole
 * account.
 */
export function registerStageActor({ app, pool }) {
  app.get("/audit/stage-completion", async (req, res) => {
    if (!pool) return res.status(503).json({ error: "No database configured" });

    const item = String(req.query.item ?? "").trim();
    const at = String(req.query.at ?? "").trim();
    const column = String(req.query.column ?? "").trim() || null;
    if (!item || !at) return res.status(400).json({ error: "item and at are required" });

    const window = completionWindow(at);
    if (!window) return res.status(400).json({ error: "at must be an ISO timestamp" });

    try {
      const r = await pool.query(
        `SELECT created_at, actor, actor_verified, columns, ok
           FROM gql_log
          WHERE item_id = $1
            AND operation = 'mutation'
            AND created_at BETWEEN $2::timestamptz AND $3::timestamptz
          ORDER BY created_at DESC
          LIMIT 200`,
        [item, window.from, window.to],
      );
      const found = pickCompletionActor(r.rows, column);
      if (!found) return res.json({ actor: null, reason: "no-audit-row" });
      res.json(found);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
