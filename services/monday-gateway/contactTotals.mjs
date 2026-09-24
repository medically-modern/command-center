/**
 * contactTotals.mjs — POST /messaging/contact-totals.
 *
 * "How many calls and texts have ever passed between us and these numbers?",
 * answered out of `call_archive` and `sms_archive`. The rules — and why the
 * answer never involves RingCentral — are in contactTotalsRules.mjs.
 *
 * Registered from messaging.mjs so it lands on the MESSAGING pool, beside the
 * two archives it reads. It adds no table and no timer: one route, two indexed
 * reads.
 */
import { authEnforced } from "./auth.mjs";
import { phoneHmac, toE164 } from "./phoneHash.mjs";
import {
  MAX_TOTALS_NUMBERS,
  callTotalsSql,
  coverageSql,
  foldTotals,
  isoOrNull,
  presenceSql,
  textTotalsSql,
} from "./contactTotalsRules.mjs";

/** Which archives exist, re-asked at most once a minute. A table appearing
 *  (an archive switched on) is picked up without a redeploy. */
const PRESENCE_TTL_MS = 60_000;
let presence = { at: 0, calls: true, texts: true };
async function archivesPresent(pool) {
  if (Date.now() - presence.at < PRESENCE_TTL_MS) return presence;
  const q = await pool.query(presenceSql());
  const r = q.rows[0] || {};
  presence = { at: Date.now(), calls: r.calls !== false, texts: r.texts !== false };
  return presence;
}

/** Test seam — the presence memo outlives a single test otherwise. */
export function __resetContactTotalsForTest() {
  presence = { at: 0, calls: true, texts: true };
}

export function registerContactTotals({ app, pool, requireCaller }) {
  /**
   * ⚠️ AUTHENTICATED, like `/messaging/can-text` beside it: the numbers come
   * from the caller, so nothing is disclosed they did not already hold, but
   * the ANSWER is a fact about a patient's communications with us.
   *
   * ⚠️ Not rate-floored: it spends no RingCentral budget, and the browser
   * caches every answer for minutes (`useContactTotals`).
   */
  app.post("/messaging/contact-totals", async (req, res) => {
    if (requireCaller) {
      const who = await requireCaller(req, res);
      // requireCaller answers 401 itself only when auth is enforced; a bare
      // null check would hang a build with no Google client id.
      if (who === null && authEnforced()) return;
    }
    const raw = Array.isArray(req.body?.numbers) ? req.body.numbers : [];
    if (raw.length > MAX_TOTALS_NUMBERS) {
      return res.status(400).json({ error: `At most ${MAX_TOTALS_NUMBERS} numbers per request` });
    }
    /* Caller's spelling → E.164 → HMAC, keeping a way back: the response is
       keyed by what the caller sent, so the browser never needs a second copy
       of toE164 that could disagree with this one. */
    const byHmac = new Map();
    for (const n of raw) {
      const e164 = toE164(String(n ?? ""));
      if (!e164) continue; // unreadable identifies nobody — do not guess
      const h = phoneHmac(e164);
      if (!h) continue;
      if (!byHmac.has(h)) byHmac.set(h, []);
      byHmac.get(h).push(String(n));
    }
    // Nothing readable — answer without touching the database, as can-text does.
    if (byHmac.size === 0) return res.json({ ok: true, results: {}, coverage: null });

    try {
      const present = await archivesPresent(pool);
      const hmacs = [...byHmac.keys()];
      const [calls, texts, cover] = await Promise.all([
        present.calls ? pool.query(callTotalsSql(), [hmacs]) : { rows: [] },
        present.texts ? pool.query(textTotalsSql(), [hmacs]) : { rows: [] },
        pool.query(coverageSql(present)),
      ]);
      const totals = foldTotals(hmacs, calls.rows, texts.rows, present);
      const results = {};
      for (const [h, originals] of byHmac) {
        const t = totals.get(h);
        if (!t) continue;
        for (const original of originals) results[original] = t;
      }
      const c = cover.rows[0] || {};
      res.json({
        ok: true,
        results,
        coverage: {
          callsSince: present.calls ? isoOrNull(c.calls_since) : null,
          textsSince: present.texts ? isoOrNull(c.texts_since) : null,
        },
      });
    } catch (e) {
      /* ⚠️ An ERROR, never a 200 with zeros. Zero is an answer the card prints
         as a fact ("nobody has rung this patient"), so a dead database must not
         be able to produce it — the §5.27 silence, one route over. */
      res.status(502).json({ ok: false, error: String((e && e.message) || e) });
    }
  });
}
