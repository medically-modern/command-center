/**
 * The pure half of the Calendly day proxy — request normalisation and the
 * short-lived answer cache.
 *
 * Split out for the same reason `callRules.mjs` sits beside `inboundCalls.mjs`
 * and `rcAllowlist.mjs` beside `ringcentral.mjs`: the decisions worth pinning
 * are decidable without express, a network, or a Calendly credential, and a
 * test that needs all three does not get written.
 */

/** The event kinds the upstream knows about. Mirrors `EVENT_KINDS` in
 *  dtc-mm-form's `server/src/calendly.js` — a kind added there and not here is
 *  simply rejected at this door, which is the safe direction. */
export const KNOWN_KINDS = Object.freeze(["intake", "welcome"]);

export function validDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

/**
 * `kinds` as a canonical, deduped, SORTED comma string.
 *
 * ⚠️ Sorting is not tidiness — it is what makes the cache key stable. Without
 * it "intake,welcome" and "welcome,intake" are two entries for one answer, so
 * two coordinators with the same view on screen each pay a full Calendly read.
 *
 * Returns null for anything unusable (empty, or naming a kind we don't know),
 * so the caller answers 400 rather than silently narrowing the request — a
 * request quietly reduced to fewer kinds comes back looking like a quiet day.
 */
export function normalizeKinds(raw, known = KNOWN_KINDS) {
  const parts = [...new Set(String(raw ?? "").split(",").map((k) => k.trim()).filter(Boolean))];
  if (!parts.length) return null;
  if (parts.some((k) => !known.includes(k))) return null;
  return parts.sort().join(",");
}

/** Cache key for one (day, kinds) answer. */
export function cacheKey(date, kinds) {
  return `${date}|${kinds}`;
}

/**
 * A tiny TTL cache with a hard entry cap.
 *
 * Bounded because the key includes a DATE: a client paging through days would
 * otherwise grow this without limit for the life of the process.
 */
export function makeCache({ ttlMs, max, now = () => Date.now() }) {
  const entries = new Map();
  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return null;
      if (now() - hit.at > ttlMs) { entries.delete(key); return null; }
      return hit.body;
    },
    set(key, body) {
      // Refresh insertion order so the cap evicts the least recently WRITTEN.
      entries.delete(key);
      if (entries.size >= max) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(key, { at: now(), body });
    },
    get size() { return entries.size; },
  };
}
