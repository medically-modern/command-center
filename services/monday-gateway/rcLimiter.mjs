/**
 * rcLimiter.mjs — the speed limit between this gateway and RingCentral.
 *
 * Split out pure (no express, no fetch) so every rule here is unit-testable —
 * the same split as callRules.mjs, rcAllowlist.mjs and reconcileBackoff.mjs.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * 2026-08-20. A dependency-array bug in ONE React component re-ran an effect on
 * every render, each pass firing `POST /messaging/conversation`. Measured at the
 * gateway: **501 requests in 0.43s from a single browser — ~1,166/sec**, and
 * that route pages the message store up to MAX_PAGES=10 deep, so the fan-out to
 * RingCentral was up to ten times worse again.
 *
 * The gateway forwarded every one of them. RingCentral throttled the whole
 * ACCOUNT, which took down things that had nothing to do with texting: the fax
 * unread count, the call log, and the inbound-call subscription lookups — the
 * last of which paged the team about an outage that was never happening.
 *
 * ⚠️ THE BUG WAS FIXED IN THE COMPONENT. This module exists because that is not
 * enough. The gateway holds credentials to a shared, production PHONE SYSTEM
 * used by both the test and prod SPAs, and it had no ceiling of any kind: any
 * bad loop, in any component, in either deployment — or one stale browser tab
 * nobody can force to reload — could do this again. A shared resource with no
 * limiter is a resource that will be exhausted eventually.
 *
 * ── Three layers, cheapest first ────────────────────────────────────────────
 * 1. COALESCE   identical concurrent reads share one upstream call, and a very
 *               short TTL absorbs bursts. This alone collapses the loop above
 *               from ~1,166 upstream calls/sec to one per TTL — it targets the
 *               actual shape of the failure (the same read, over and over).
 * 2. BUDGET     a hard ceiling on RingCentral calls per window, globally and
 *               per caller. Coalescing handles duplicates; this handles volume
 *               that isn't duplicated.
 * 3. BREAKER    when RingCentral says 429, STOP CALLING THAT GROUP. Knocking
 *               while throttled is what turns a 60-second window into an
 *               afternoon. Honours RingCentral's own Retry-After when it sends
 *               one — up to `maxCooldownMs`, which is a guard against a
 *               malformed header, not an override of RingCentral.
 *
 * ── ⚠️ The breaker is per RingCentral API GROUP (2026-09-29) ─────────────────
 * RingCentral meters by group — `light`, `medium`, `heavy` — and says which one
 * a request is in on every response (`X-Rate-Limit-Group`). The call log and
 * recordings are `heavy`; message-store reads are `light` or `medium`.
 *
 * On 2026-09-28 a job outside this repo (stedi-monday-integration's reorder
 * contact stamping: every 15 minutes, 8am–11pm ET) sent up to 20 call-log
 * reads through the /rc proxy in about ten seconds — twice the heavy group's
 * ~10 a minute. Every run from 19:30 to 23:00 ET ended in a 429, and each one
 * opened the ONE breaker for the whole gateway: for the next minute or so
 * every non-critical RingCentral read was refused, reps' message-store
 * (light) reads and the calls monitor's subscription probe included, while
 * fax-intake's message-store reads on the same account — outside the gateway
 * — succeeded throughout. A heavy-group throttle is now a heavy-group pause.
 *
 * So each request is keyed by its SHAPE (`rcShape`: method + path, ids
 * stripped), the guard learns shape → group from RingCentral's own header, and
 * a 429 opens the breaker for that group only. A success closes that group
 * only — a light read getting through says nothing about the heavy group. A
 * shape whose group is not known yet (first call after a boot, or a 429 with
 * no group header) is held by its own shape, so it knocks at most once.
 *
 * ── ⚠️ Tiers: what must never be shed ───────────────────────────────────────
 * A limiter that blocks everything equally would make a bad afternoon worse.
 * Forwarding a RINGING call is the single most time-critical thing this gateway
 * does — there is no retry, the caller is on the line right now — and sending a
 * text a rep just typed is close behind. Those are `critical`: they skip the
 * budget and the breaker entirely. They are rare, human-initiated, and bounded
 * by how fast a person can click, so they cannot be the source of a flood.
 *
 * What gets shed is `background` — polling reads that run on a timer and will
 * come round again by themselves: the fax count, the subscription status probe.
 * `interactive` sits between: a human asked for it (open a thread, read a call
 * log), so it draws on the budget but is shed before critical work.
 */

/** Call classes, most protected first. See the tier note above. */
export const TIERS = ["critical", "interactive", "background"];

export const DEFAULTS = {
  /** Rolling window for the budget. */
  windowMs: 60_000,
  /** Ceiling on RingCentral calls per window across the whole gateway. Well
   *  above any real human load (steady state is single digits per minute) and
   *  far below the rate at which RingCentral starts refusing. */
  maxPerWindow: 90,
  /** Ceiling per caller (signed-in email, else client IP) per window. One
   *  conversation read can page 10 deep, so this is several threads' worth. */
  maxPerCallerPerWindow: 40,
  /** ⚠️ Ceiling per caller per window on RingCentral's `heavy` group (call log,
   *  recordings, sip-provision), for callers that ask for it (`capHeavy`: the
   *  /rc passthrough). RingCentral allows ~10 heavy calls per minute for the
   *  WHOLE account; stedi-monday-integration's 15-minute job sent ~20 call-log
   *  reads in seconds through /rc, every run since 2026-09-28, and each burst
   *  paused the call log, call history and browser-phone sign-in for everyone
   *  for a minute. One caller may now spend at most this many; the rest are
   *  refused HERE (429 + Retry-After), so RingCentral never sees them. */
  maxHeavyPerCallerPerWindow: 4,
  /** Breaker cooldowns while RingCentral keeps saying 429, in order. */
  cooldownsMs: [30_000, 120_000, 300_000],
  /** Never sit out longer than this, even if RingCentral asks for more.
   *  ⚠️ This used to be 15 minutes, which cut short any longer Retry-After.
   *  With the breaker per group, honouring RingCentral in full costs only the
   *  throttled group, so this is now a guard against a malformed header, not
   *  a way to second-guess a real one. RC_MAX_COOLDOWN_MIN overrides it
   *  (ringcentral.mjs). */
  maxCooldownMs: 60 * 60_000,
  /** The longest a background SCAN should sleep on a refused page before it
   *  stops paging and leaves the rest to its next run (`shedWaitMs`). Rides
   *  out a budget shed (the 60s window) and the breaker's first two steps. */
  maxShedWaitMs: 2 * 60_000,
  /** Fraction of the budget above which BACKGROUND polling is refused, leaving
   *  the rest for work a human is waiting on. */
  backgroundFloor: 0.7,
  /** How long a coalesced read stays fresh. Deliberately short: this is a
   *  burst absorber, not a cache with correctness implications. */
  coalesceTtlMs: 5_000,
};

/** Parse RingCentral's `Retry-After` (seconds) into ms; 0 when absent or junk. */
export function retryAfterMs(headerValue) {
  if (headerValue == null) return 0;
  const seconds = Number(String(headerValue).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round(seconds * 1000);
}

/**
 * The key a RingCentral request is budgeted and broken under: its method and
 * path, with the query string and every id-shaped segment removed, so one
 * call-log record and the next are the same shape. Absolute media URLs
 * (media.ringcentral.com) key on their path.
 *
 * An id is a segment of digits, or an 8+ character token containing a digit
 * (UUIDs, RingCentral's base64-ish record ids). `v1.0`, `~` and every word
 * segment are kept.
 */
export function rcShape(method = "GET", pathOrUrl = "") {
  let p = String(pathOrUrl || "");
  const abs = /^[a-z][a-z0-9+.-]*:\/\/[^/]+(\/[^?#]*)?/i.exec(p);
  if (abs) p = abs[1] || "/";
  p = p.split(/[?#]/)[0];
  const segs = p.split("/").map((seg) =>
    /^\d+$/.test(seg) || (seg.length >= 8 && /\d/.test(seg) && /^[\w.-]+$/.test(seg)) ? ":id" : seg,
  );
  return `${String(method || "GET").toUpperCase()} ${segs.join("/")}`;
}

/**
 * How long a background scan should wait before retrying a refused page, or
 * `null` to stop paging now.
 *
 * The archive scans retry a refused page to ride out a BUDGET shed, which
 * clears inside the 60s window. A BREAKER refusal now lasts as long as
 * RingCentral asks, and sleeping through that inside a run would hold the
 * run's lock for hours and starve the next scheduled run. Anything longer
 * than `maxWaitMs` ends the scan; the next run re-reads the same window.
 */
export function shedWaitMs(retryAfterHeader, fallbackMs, maxWaitMs = DEFAULTS.maxShedWaitMs) {
  const wait = retryAfterMs(retryAfterHeader) || fallbackMs;
  return wait > maxWaitMs ? null : wait;
}

/**
 * How long to stay off RingCentral after a 429.
 *
 * RingCentral's own number wins when it is longer than our step — a 429 is the
 * service saying how long it wants to be left alone, and ignoring that is how a
 * throttle gets extended instead of cleared. Capped, because the caller still
 * needs to recover eventually.
 */
export function cooldownFor(consecutive429s, retryAfter = 0, cfg = DEFAULTS) {
  const steps = cfg.cooldownsMs;
  const i = Math.min(Math.max(consecutive429s - 1, 0), steps.length - 1);
  const step = steps[i];
  const asked = Number(retryAfter);
  const wait = Number.isFinite(asked) && asked > step ? asked : step;
  return Math.min(wait, cfg.maxCooldownMs);
}

/**
 * The guard itself. `now()` is injectable so the tests don't sleep.
 *
 * Usage at the call site:
 *   const shape = rcShape(method, path);
 *   const verdict = guard.check({ tier, caller, shape });
 *   if (!verdict.ok) → refuse, with verdict.retryAfterMs
 *   ... make the RingCentral call ...
 *   guard.note({ status, retryAfter, shape, group: <X-Rate-Limit-Group> });
 *
 * Called without a shape (the tests, and nothing in production) everything
 * shares one breaker — the pre-2026-09-29 behaviour.
 */
export function createRcGuard(cfg = {}, now = () => Date.now()) {
  const c = { ...DEFAULTS, ...cfg };
  /** Timestamps of recent RingCentral calls, newest last. */
  let calls = [];
  /** caller → timestamps. */
  const byCaller = new Map();
  /** caller → timestamps of their HEAVY-group calls (capHeavy callers only). */
  const heavyByCaller = new Map();
  /** shape → RingCentral rate-limit group, learned from X-Rate-Limit-Group. */
  const groupOf = new Map();
  /** breaker key (`group:heavy`, `shape:GET …`, or ALL) → { openUntil, consecutive429s } */
  const breakers = new Map();
  let shed = 0;

  const ALL = "all";
  const MAX_SHAPES = 500;          // shapes are finite once ids are stripped; this is a backstop
  const learn = (shape, group) => {
    if (!shape || !group) return;
    if (!groupOf.has(shape) && groupOf.size >= MAX_SHAPES) groupOf.delete(groupOf.keys().next().value);
    groupOf.set(shape, String(group).toLowerCase());
  };
  /** Every breaker that can hold this shape back: its group's, and its own. */
  const keysFor = (shape) => {
    if (!shape) return [ALL];
    const g = groupOf.get(shape);
    return g ? [`group:${g}`, `shape:${shape}`] : [`shape:${shape}`];
  };
  /** The one breaker a response for this shape opens or closes. */
  const keyFor = (shape, group) => {
    const g = (group && String(group).toLowerCase()) || (shape ? groupOf.get(shape) : null);
    if (g) return `group:${g}`;
    return shape ? `shape:${shape}` : ALL;
  };

  const prune = (t) => {
    const floor = t - c.windowMs;
    calls = calls.filter((x) => x > floor);
    for (const map of [byCaller, heavyByCaller]) {
      for (const [k, list] of map) {
        const kept = list.filter((x) => x > floor);
        if (kept.length) map.set(k, kept);
        else map.delete(k);
      }
    }
  };

  return {
    /**
     * May this call go to RingCentral right now?
     *
     * ⚠️ `critical` short-circuits before every check — see the tier note. It is
     * still RECORDED, so the budget reflects real load and a flood of critical
     * work is visible in the snapshot rather than invisible.
     */
    check({ tier = "background", caller = "anon", shape = "", capHeavy = false } = {}) {
      const t = now();
      prune(t);

      if (tier === "critical") {
        calls.push(t);
        return { ok: true, tier };
      }

      for (const key of keysFor(shape)) {
        const b = breakers.get(key);
        if (b && t < b.openUntil) {
          shed += 1;
          return {
            ok: false,
            reason: "breaker",
            breaker: key,
            retryAfterMs: b.openUntil - t,
            message: "RingCentral is rate-limiting this kind of request; pausing it to let it recover.",
          };
        }
      }

      if (calls.length >= c.maxPerWindow) {
        shed += 1;
        return {
          ok: false,
          reason: "global",
          retryAfterMs: Math.max(0, calls[0] + c.windowMs - t),
          message: "Too many RingCentral requests from the Command Center right now.",
        };
      }

      // ⚠️ Background work is shed FIRST, at a fraction of the budget, so a
      // burst of polling can never crowd out a human waiting on a thread. This
      // is what makes the tiers mean something beyond the critical bypass.
      if (tier === "background" && calls.length >= c.backgroundFloor * c.maxPerWindow) {
        shed += 1;
        return {
          ok: false,
          reason: "background-shed",
          retryAfterMs: Math.max(0, calls[0] + c.windowMs - t),
          message: "Deferring background RingCentral polling to protect interactive work.",
        };
      }

      const mine = byCaller.get(caller) || [];
      if (mine.length >= c.maxPerCallerPerWindow) {
        shed += 1;
        return {
          ok: false,
          reason: "caller",
          retryAfterMs: Math.max(0, mine[0] + c.windowMs - t),
          message: "Too many RingCentral requests from this session right now.",
        };
      }

      const heavy = capHeavy && shape && groupOf.get(shape) === "heavy";
      const mineHeavy = heavy ? heavyByCaller.get(caller) || [] : null;
      if (heavy && mineHeavy.length >= c.maxHeavyPerCallerPerWindow) {
        shed += 1;
        return {
          ok: false,
          reason: "caller-heavy",
          retryAfterMs: Math.max(0, mineHeavy[0] + c.windowMs - t),
          message: "Too many call-log requests from this caller — RingCentral allows only a few per minute for the whole account.",
        };
      }

      calls.push(t);
      byCaller.set(caller, [...mine, t]);
      if (heavy) heavyByCaller.set(caller, [...mineHeavy, t]);
      return { ok: true, tier };
    },

    /**
     * Record what RingCentral said. A 429 opens the breaker for that request's
     * GROUP; a success closes that group's breaker, because its throttle is
     * over the moment one of its calls gets through. A success in ANOTHER
     * group closes nothing — it says nothing about this one.
     */
    note({ status, retryAfter = 0, shape = "", group = "" } = {}) {
      const t = now();
      learn(shape, group);
      const key = keyFor(shape, group);
      if (status === 429) {
        const b = breakers.get(key) || { openUntil: 0, consecutive429s: 0 };
        b.consecutive429s += 1;
        const wait = cooldownFor(b.consecutive429s, retryAfter, c);
        b.openUntil = Math.max(b.openUntil, t + wait);
        breakers.set(key, b);
        return { open: true, until: b.openUntil, waitMs: wait, consecutive429s: b.consecutive429s, key };
      }
      if (typeof status === "number" && status < 500) {
        breakers.delete(key);
        if (shape) breakers.delete(`shape:${shape}`);
      }
      const b = breakers.get(key);
      return {
        open: !!b && t < b.openUntil,
        until: b ? b.openUntil : 0,
        consecutive429s: b ? b.consecutive429s : 0,
        key,
      };
    },

    /** For /calls/health and the humans reading it. Counts only, no identities.
     *  The top-level breaker fields read "any group" so older readers keep
     *  working; `breakers` names which ones are open. */
    snapshot() {
      const t = now();
      prune(t);
      const open = {};
      let openForMs = 0;
      let worst = 0;
      for (const [key, b] of breakers) {
        const left = Math.max(0, b.openUntil - t);
        worst = Math.max(worst, b.consecutive429s);
        openForMs = Math.max(openForMs, left);
        if (left > 0) open[key] = { openForMs: left, consecutive429s: b.consecutive429s };
      }
      return {
        callsInWindow: calls.length,
        maxPerWindow: c.maxPerWindow,
        callers: byCaller.size,
        breakerOpen: openForMs > 0,
        breakerOpenForMs: openForMs,
        consecutive429s: worst,
        breakers: open,
        shed,
      };
    },

    /** Test seam only. */
    reset() {
      calls = [];
      byCaller.clear();
      groupOf.clear();
      breakers.clear();
      shed = 0;
    },
  };
}

/**
 * Identical concurrent work runs ONCE.
 *
 * This is the layer that actually matches the failure: a render loop asks the
 * same question thousands of times a second, and every answer is identical. The
 * short TTL extends that to bursts that are near-simultaneous rather than
 * strictly overlapping.
 *
 * ⚠️ A rejected call is NOT cached — only the in-flight promise is shared, and
 * it is dropped on settle. Caching a failure would turn one blip into TTL
 * seconds of guaranteed failure for everyone.
 */
export function createCoalescer(ttlMs = DEFAULTS.coalesceTtlMs, now = () => Date.now()) {
  const inflight = new Map();
  const fresh = new Map();

  return {
    async run(key, fn, ttlOverrideMs) {
      const t = now();
      const ttl = Number.isFinite(ttlOverrideMs) && ttlOverrideMs > 0 ? ttlOverrideMs : ttlMs;
      const hit = fresh.get(key);
      if (hit && t - hit.at < ttl) return { value: hit.value, coalesced: true };

      const pending = inflight.get(key);
      if (pending) return { value: await pending, coalesced: true };

      const p = (async () => fn())();
      inflight.set(key, p);
      try {
        const value = await p;
        fresh.set(key, { at: now(), value });
        return { value, coalesced: false };
      } finally {
        inflight.delete(key);
        // Bound the map: this is a burst absorber, not a store.
        if (fresh.size > 200) {
          const cutoff = now() - ttlMs;
          for (const [k, v] of fresh) if (v.at < cutoff) fresh.delete(k);
        }
      }
    },
    size() {
      return { inflight: inflight.size, fresh: fresh.size };
    },
  };
}
