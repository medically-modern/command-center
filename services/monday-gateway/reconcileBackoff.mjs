/**
 * reconcileBackoff.mjs — how long to wait before retrying a FAILED
 * subscription reconcile.
 *
 * Split out of inboundCalls.mjs so the rule is unit-testable without that
 * module's express / pg / google-auth-library imports — the same split as
 * callRules.mjs (which party, who gets rung) and rcAllowlist.mjs (the proxy's
 * security boundary).
 *
 * ── Why a ladder at all ─────────────────────────────────────────────────────
 * The reconcile pass ran on boot and then hourly, with nothing in between. A
 * failure therefore cost a full hour of the gateway not knowing its own
 * subscription — and on 2026-08-20 that is exactly what happened: a redeploy
 * landed while RingCentral was rate-limiting the subscription API, the boot
 * reconcile took a 429, and the gateway sat with `subscriptionState.id === null`
 * for the next hour. RingCentral kept delivering webhooks to that same
 * container the whole time (the subscription was never touched — only our
 * memory of it was empty), but /calls/health reported no subscription, so the
 * monitor paged every 10 minutes with "no calls will arrive" while calls were
 * arriving. One transient 429, six false alarms.
 *
 * A short ladder closes it: the gateway is back in sync in under a minute
 * instead of under an hour, so a blip produces at most one alert.
 *
 * ⚠️ The ladder is BOUNDED, and deliberately. What is being recovered from is
 * usually a throttle, and the one thing that must not happen is a retry loop
 * that keeps a rate limit alive. Five attempts spanning ~15 minutes, then the
 * hourly pass takes over — worst case six subscription lookups an hour rather
 * than one, which is bounded, and the hourly failure re-arms the ladder so a
 * long outage still gets retried regularly.
 */

/** The ladder, in order. Roughly doubling: 30s · 1m · 2m · 4m · 8m. */
export const RETRY_STEPS_MS = [30_000, 60_000, 120_000, 240_000, 480_000];

/**
 * Never wait longer than this, whatever RingCentral asks for. The hourly pass
 * is the backstop, so a Retry-After measured in hours would just be a worse
 * version of doing nothing.
 */
export const MAX_RETRY_MS = 15 * 60_000;

/**
 * How long to wait before retry number `attempt` (0-based), or **null** when
 * the ladder is spent and the caller should fall back to the hourly pass.
 *
 * `retryAfterMs` is RingCentral's own instruction (see retryAfterMs below) and
 * WINS when it is longer than our step: a 429 is the service telling us how
 * long it wants to be left alone, and ignoring that is how a throttle gets
 * extended rather than cleared. It never shortens the wait.
 */
export function retryDelayMs(attempt, retryAfterMs = 0) {
  if (!Number.isInteger(attempt) || attempt < 0) return null;
  if (attempt >= RETRY_STEPS_MS.length) return null;
  const step = RETRY_STEPS_MS[attempt];
  const asked = Number(retryAfterMs);
  const wait = Number.isFinite(asked) && asked > step ? asked : step;
  return Math.min(wait, MAX_RETRY_MS);
}

/**
 * A `Retry-After` header as milliseconds, or 0 when there isn't a usable one.
 *
 * RingCentral sends this as a count of SECONDS. The HTTP spec also allows an
 * HTTP-date, which RingCentral does not use — an unparseable value returns 0
 * rather than a guess, so the ladder's own step decides. A missing header is
 * the normal case (most failures here are not throttles at all).
 */
export function retryAfterMs(headerValue) {
  if (headerValue == null) return 0;
  const seconds = Number(String(headerValue).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round(seconds * 1000);
}
