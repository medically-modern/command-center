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
 * 3. BREAKER    when RingCentral says 429, STOP CALLING IT. Knocking while
 *               throttled is what turns a 60-second window into an afternoon.
 *               Honours RingCentral's own Retry-After when it sends one.
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
  /** Breaker cooldowns while RingCentral keeps saying 429, in order. */
  cooldownsMs: [30_000, 120_000, 300_000],
  /** Never sit out longer than this, even if RingCentral asks for more. */
  maxCooldownMs: 15 * 60_000,
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
 *   const verdict = guard.check({ tier, caller });
 *   if (!verdict.ok) → refuse, with verdict.retryAfterMs
 *   ... make the RingCentral call ...
 *   guard.note({ status, retryAfter });
 */
export function createRcGuard(cfg = {}, now = () => Date.now()) {
  const c = { ...DEFAULTS, ...cfg };
  /** Timestamps of recent RingCentral calls, newest last. */
  let calls = [];
  /** caller → timestamps. */
  const byCaller = new Map();
  let openUntil = 0;
  let consecutive429s = 0;
  let shed = 0;

  const prune = (t) => {
    const floor = t - c.windowMs;
    calls = calls.filter((x) => x > floor);
    for (const [k, list] of byCaller) {
      const kept = list.filter((x) => x > floor);
      if (kept.length) byCaller.set(k, kept);
      else byCaller.delete(k);
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
    check({ tier = "background", caller = "anon" } = {}) {
      const t = now();
      prune(t);

      if (tier === "critical") {
        calls.push(t);
        return { ok: true, tier };
      }

      if (t < openUntil) {
        shed += 1;
        return {
          ok: false,
          reason: "breaker",
          retryAfterMs: openUntil - t,
          message: "RingCentral is rate-limiting this account; pausing calls to let it recover.",
        };
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

      calls.push(t);
      byCaller.set(caller, [...mine, t]);
      return { ok: true, tier };
    },

    /**
     * Record what RingCentral said. A 429 opens the breaker; any success closes
     * it, because the throttle is over the moment a call gets through.
     */
    note({ status, retryAfter = 0 } = {}) {
      const t = now();
      if (status === 429) {
        consecutive429s += 1;
        const wait = cooldownFor(consecutive429s, retryAfter, c);
        openUntil = Math.max(openUntil, t + wait);
        return { open: true, until: openUntil, waitMs: wait, consecutive429s };
      }
      if (typeof status === "number" && status < 500) {
        consecutive429s = 0;
        openUntil = 0;
      }
      return { open: t < openUntil, until: openUntil, consecutive429s };
    },

    /** For /calls/health and the humans reading it. Counts only, no identities. */
    snapshot() {
      const t = now();
      prune(t);
      return {
        callsInWindow: calls.length,
        maxPerWindow: c.maxPerWindow,
        callers: byCaller.size,
        breakerOpen: t < openUntil,
        breakerOpenForMs: Math.max(0, openUntil - t),
        consecutive429s,
        shed,
      };
    },

    /** Test seam only. */
    reset() {
      calls = [];
      byCaller.clear();
      openUntil = 0;
      consecutive429s = 0;
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
