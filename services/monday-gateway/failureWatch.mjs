/**
 * Periodic sweep: page when Monday has been rejecting calls.
 *
 * ── Why this exists on top of the send-job alert ────────────────────────────
 * The send worker's alert (send.mjs) only fires for jobs that reach it. Most
 * writes in this app never do: inline panel actions — notes, attempt saves, the
 * escalation modal, every status flip a rep makes without pressing Send — go
 * straight through /gql. Those land in gql_log and nowhere else, so a Monday
 * problem affecting them was visible only to whoever happened to open /audit.
 * "Item link max locks exceeded", the error this whole line of work started
 * from, is exactly that shape.
 *
 * gql_log is the one table BOTH paths reach (send.mjs mirrors completed and
 * failed jobs into it), so one sweep covers everything.
 *
 * ⚠️ A gateway that is DOWN cannot alert about itself. That gap needs an
 * external watcher — services/calls-monitor is the precedent. This covers the
 * case where the gateway is up and Monday is refusing, which is the silent one.
 *
 * ⚠️ Messages are redacted by errorSummary before they leave the process, so a
 * value Monday echoed back ("the label 'Beverly Danyluk' does not exist")
 * cannot ride out to a phone. Never throws into the interval.
 */

import { buildErrorGroupsQuery, buildTotalsQuery, summarize } from "./errorSummary.mjs";
import { postNtfy, ntfyConfigured } from "./ntfy.mjs";
import { createAlertState, shouldAlert, takeSuppressed, formatFailureSweep, sweepAlertReason } from "./sendAlerts.mjs";

/** How often to look. */
export const SWEEP_MS = 15 * 60_000;

/** How far back each look reaches.
 *  ⚠️ NOT equal to SWEEP_MS, and it cannot be: buildErrorGroupsQuery clamps its
 *  window to whole hours with a floor of 1, so asking for 15 minutes silently
 *  gets you an hour. Rather than widen the query builder's contract for one
 *  caller, the sweep looks back an hour every quarter-hour and leans on the
 *  repeat throttle below to keep the overlap from paging four times. */
export const WINDOW_HOURS = 1;

/** Don't re-page while the SAME set of failure shapes is still the story. A new
 *  shape pages on the next sweep (≤ SWEEP_MS); an ongoing outage repeats hourly,
 *  which is a reminder rather than a storm. */
export const REPEAT_MS = 60 * 60_000;

/**
 * What counts as "the same story" for throttling: which failure shapes are
 * present, not how many of each. Counts climb continuously during an outage, so
 * keying on them would page every sweep; a shape appearing or disappearing is
 * the part somebody needs to hear about again.
 */
export function shapeSignature(groups = []) {
  return groups.map((g) => g.message).sort().join(" | ") || "(none)";
}

/**
 * One sweep, with its dependencies injected so a test can drive the clock and
 * the database without either. Returns what it decided — "sent" · "quiet" ·
 * "throttled" · "error" — which is also what the tests assert on.
 */
export function createFailureSweep({
  pool,
  send = postNtfy,
  now = () => Date.now(),
  windowHours = WINDOW_HOURS,
  repeatMs = REPEAT_MS,
} = {}) {
  const state = createAlertState();
  const windowMinutes = Math.round(windowHours * 60);

  return async function sweep() {
    try {
      const groupsQ = buildErrorGroupsQuery({ hours: windowHours });
      const totalsQ = buildTotalsQuery({ hours: windowHours });
      const [groupRows, totalRows] = await Promise.all([
        pool.query(groupsQ.sql, groupsQ.args),
        pool.query(totalsQ.sql, totalsQ.args),
      ]);

      const totals = totalRows?.rows?.[0] ?? {};
      const failures = Number(totals.failures) || 0;
      if (!failures) return "quiet"; // the normal case — say nothing

      // A failure is not automatically a page. Any failed WRITE is; failed
      // READS have to be sustained, because they retry themselves and paging on
      // a transient Monday blip is how this channel stops being read.
      const failedWrites = Number(totals.failed_writes) || 0;
      const failedReads = Number(totals.failed_reads) || 0;
      const requests = Number(totals.requests) || 0;
      const reason = sweepAlertReason({ failedWrites, failedReads, requests });
      if (!reason) return "quiet";

      const groups = summarize(groupRows?.rows ?? []);
      // Throttle per failure SHAPE and per reason: a read outage that turns
      // into a write outage is new news, even with the same error text.
      if (!shouldAlert(state, `${reason}::${shapeSignature(groups)}`, now(), { cooldownMs: repeatMs })) {
        return "throttled";
      }
      await send(
        formatFailureSweep({
          groups,
          windowMinutes,
          failures,
          writes: Number(totals.writes) || 0,
          failedWrites,
          failedReads,
          requests,
          reason,
          suppressed: takeSuppressed(state),
        }),
      );
      return "sent";
    } catch (e) {
      // An alerting path that can crash the process it watches is worse than no
      // alerting path. Same discipline as recordEvent in inboundCalls.
      console.error("failure watch sweep failed:", e?.message ?? e);
      return "error";
    }
  };
}

/** Wire the sweep to a timer. No-op without a pool or an ntfy topic, so a local
 *  or unconfigured deploy neither crashes nor pretends it is watching. */
export function registerFailureWatch({ pool, sweepMs = SWEEP_MS } = {}) {
  if (!pool) return null;
  if (!ntfyConfigured()) {
    console.log("failure watch disabled (no NTFY_TOPIC)");
    return null;
  }
  const sweep = createFailureSweep({ pool });
  const timer = setInterval(() => void sweep(), sweepMs);
  timer.unref?.(); // never hold the process open on our account
  console.log(`failure watch started (every ${Math.round(sweepMs / 60_000)} min)`);
  return timer;
}
