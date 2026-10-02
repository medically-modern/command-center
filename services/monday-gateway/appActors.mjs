/**
 * GET /oversight/app-actors — who made each Command Center write, for the
 * Onboarding Oversight dashboard. The rules (and why) are in appActorsRules.mjs.
 *
 * ⚠️ Behind a verified medicallymodern.com sign-in, the same door as
 * /calls/phone-health and the other routes that name staff. It returns staff
 * emails, item ids and column ids — no patient values (see the rules file).
 * The gateway holds no list of managers; the dashboard page itself is
 * manager-only.
 *
 *   GET /oversight/app-actors?since=<ISO>&boards=<id,id>
 *   → { ok, sinceMs, clamped, truncated, rows: [[itemId, boardId, actor, ms, [colId…]], …] }
 */
import { verifyGoogleIdentity } from "./auth.mjs";
import { buildAppActorsSql, parseAppActorsQuery, shapeAppActorRows } from "./appActorsRules.mjs";

/** One answer per window for a minute — several managers opening the page
 *  at once must not each run the same scan. Keyed on the window rounded to
 *  the minute, which is finer than the dashboard's own refresh. */
const TTL_MS = 60_000;
const cache = new Map();

export function registerAppActors({ app, pool }) {
  app.get("/oversight/app-actors", async (req, res) => {
    const who = await verifyGoogleIdentity(req.headers["x-mm-auth"]);
    if (!who?.email) return res.status(401).json({ ok: false, error: "Sign in required" });
    if (!pool) return res.status(503).json({ ok: false, error: "audit logging disabled" });

    const q = parseAppActorsQuery(req.query);
    if (q.error) return res.status(400).json({ ok: false, error: q.error });

    const key = `${Math.floor(q.sinceMs / 60_000)}|${q.boards.join(",")}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return res.json(hit.body);

    try {
      const { sql, args } = buildAppActorsSql(q);
      const r = await pool.query(sql, args);
      const { rows, truncated } = shapeAppActorRows(r.rows);
      const body = { ok: true, sinceMs: q.sinceMs, clamped: q.clamped, truncated, rows };
      cache.set(key, { at: Date.now(), body });
      for (const [k, v] of cache) if (Date.now() - v.at > TTL_MS) cache.delete(k);
      res.json(body);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}
