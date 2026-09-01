/**
 * Pure decision + wording for "a send job gave up" alerts.
 *
 * Split from send.mjs for the same reason callRules.mjs and errorSummary.mjs
 * were split from their routes: the parts worth testing are the THROTTLE and
 * the PHI discipline, and neither is testable next to pg and fetch.
 *
 * ⚠️ A send job carries patient column values. NOTHING from the payload may
 * reach the alert. What goes out is the board, the attempt count and a
 * REDACTED error — deliberately not the item id, which names one patient's
 * record, and not the actor. Whoever gets paged looks the detail up in /audit,
 * which is key-gated for exactly that reason.
 */

import { redactErrorMessage } from "./errorSummary.mjs";

/** One push per distinct failure shape per window. A gateway that has lost its
 *  Monday token fails EVERY job; without this the phone buzzes once per job and
 *  the alert becomes something people swipe away. */
export const COOLDOWN_MS = 10 * 60_000;

/** ...and a hard ceiling across ALL shapes in that window.
 *  The per-key throttle only collapses failures that redact to the SAME string;
 *  a partial Monday outage produces several different complaints and would page
 *  once per shape. An alert channel that fires twenty times in ten minutes is
 *  one nobody reads, which is the failure mode CLAUDE.md §5.13 documents for the
 *  calls monitor. Anything beyond the cap is counted and reported on the next
 *  alert instead of being lost. */
export const MAX_ALERTS_PER_WINDOW = 3;

/** Throttle state, owned per process by the caller. An explicit shape (rather
 *  than a bare Map) because two things are being limited: per-shape repeats and
 *  the total volume. */
export function createAlertState() {
  return { keys: new Map(), sentAt: [], suppressed: 0 };
}

/** What counts as "the same failure" for throttling: the board it happened on
 *  and the shape of the error. Two different boards failing is two problems. */
export function alertKey({ boardId, message } = {}) {
  return `${boardId ?? "?"}::${redactErrorMessage(message)}`;
}

/**
 * Throttle gate — passed the state rather than owning it so a test can drive the
 * clock without waiting ten minutes. Returns true when this key should page now,
 * and records the send. Everything it declines is counted in `state.suppressed`
 * so the next alert that does go out can say how much it stands for.
 */
export function shouldAlert(state, key, now, opts = {}) {
  const cooldownMs = opts.cooldownMs ?? COOLDOWN_MS;
  const maxPerWindow = opts.maxPerWindow ?? MAX_ALERTS_PER_WINDOW;
  pruneAlertState(state, now, cooldownMs);

  const last = state.keys.get(key);
  if (last !== undefined && now - last < cooldownMs) {
    state.suppressed += 1;
    return false;
  }
  if (state.sentAt.length >= maxPerWindow) {
    state.suppressed += 1;
    return false;
  }
  state.keys.set(key, now);
  state.sentAt.push(now);
  return true;
}

/** How many alerts this window swallowed, and reset the counter — call it when
 *  you are about to send, so the count rides out with the alert instead of
 *  growing unread. */
export function takeSuppressed(state) {
  const n = state.suppressed;
  state.suppressed = 0;
  return n;
}

/** Drop entries older than the window so a long-lived process does not
 *  accumulate one per distinct error string forever. */
export function pruneAlertState(state, now, cooldownMs = COOLDOWN_MS) {
  for (const [k, at] of state.keys) if (now - at >= cooldownMs) state.keys.delete(k);
  state.sentAt = state.sentAt.filter((at) => now - at < cooldownMs);
  return state;
}

/**
 * The message itself. `suppressed` lets a burst say so rather than implying the
 * one job it names was the only casualty.
 */
export function formatSendFailure({ boardId, label, attempts, message, suppressed = 0 } = {}) {
  const safe = redactErrorMessage(message);
  const lines = [
    `Board ${boardId ?? "unknown"} — gave up after ${attempts ?? "?"} attempts.`,
    `Error: ${safe}`,
  ];
  if (label) lines.push(`Send: ${label}`);
  if (suppressed > 0) lines.push(`(+${suppressed} more suppressed this window)`);
  lines.push("The stage was NOT advanced. Detail: /audit on the gateway.");
  return {
    title: "Command Center: Monday write failed",
    body: lines.join("\n"),
    // Data did not reach Monday and a patient is sitting mid-stage — this is
    // the class of thing worth interrupting someone for.
    priority: "high",
    tags: "rotating_light,floppy_disk",
  };
}

/**
 * The periodic sweep's message: everything Monday rejected in a window,
 * whatever path it came in on.
 *
 * ⚠️ This exists because the send-job alert above only sees the SEND worker.
 * Inline panel writes — notes, attempt saves, the escalation modal — go through
 * /gql and land in gql_log without ever becoming a send job, so they would
 * otherwise never page. gql_log is the one table both paths reach.
 *
 * `groups` is already redacted by errorSummary.summarize — do not pass raw rows.
 */
/**
 * Reads and writes do not cost the same, so they must not page the same.
 *
 * A failed WRITE is a rep's save going nowhere — the thing this alerting exists
 * for. A failed READ self-heals: every queue hook re-polls on a 15-30s timer, so
 * the rep saw one stale render and the next tick fixed it. Nobody can act on a
 * Monday 503 either way.
 *
 * Pooling them is what paged Josh twice in two hours on 2026-09-01 for two
 * transient Monday blips (8 reads 500ing at 16:07, 2 reads 503ing at 17:55 —
 * 10 failures out of 23,719 requests, zero writes lost). An alert channel that
 * fires on nothing actionable is one people stop reading, which is the failure
 * mode CLAUDE.md §5.13 documents for the calls monitor — and by then it is the
 * alert about a REAL lost write that gets swiped away.
 *
 * ⚠️ The read thresholds are deliberately BOTH a count and a rate. A rate alone
 * pages on 1-of-2 requests at 3am; a count alone pages on a busy afternoon that
 * is actually fine. A genuine Monday outage clears both easily.
 */
export const READ_ALERT_MIN_COUNT = 25;
export const READ_ALERT_MIN_RATIO = 0.02;

/**
 * Does this sweep deserve a push? Pure so the thresholds are testable.
 * Returns the REASON as well, because the wording differs: a lost write names
 * itself, a read outage has to explain that nothing was lost.
 */
export function sweepAlertReason(
  { failedWrites = 0, failedReads = 0, requests = 0 } = {},
  opts = {},
) {
  if (failedWrites > 0) return "writes";
  const minCount = opts.minCount ?? READ_ALERT_MIN_COUNT;
  const minRatio = opts.minRatio ?? READ_ALERT_MIN_RATIO;
  if (failedReads >= minCount && requests > 0 && failedReads / requests >= minRatio) {
    return "reads";
  }
  return null;
}

export function formatFailureSweep({
  groups = [],
  windowMinutes,
  failures = 0,
  writes = 0,
  failedWrites = 0,
  failedReads = 0,
  requests = 0,
  reason = null,
  suppressed = 0,
} = {}) {
  const top = groups.slice(0, 5).map((g) => `  ${g.count}× ${g.message}`);
  // Lead with what was lost, not with a total. "8 failed calls (of 76 writes)"
  // reads as "8 of the 76 writes failed" — it was in fact 8 reads and zero
  // writes, and that misreading cost real incident time on 2026-09-01.
  const headline = reason === "reads"
    ? `${failedReads} failed Monday READS in the last ${windowMinutes} min ` +
      `(of ${requests} calls). No writes lost — reads retry on the next poll.`
    : `${failedWrites} failed Monday ${failedWrites === 1 ? "WRITE" : "WRITES"} in the last ` +
      `${windowMinutes} min${failedReads ? ` (+${failedReads} failed reads)` : ""}. ` +
      `A write that failed is a save that did not land.`;
  const body = [
    headline,
    ...top,
    groups.length > 5 ? `  …and ${groups.length - 5} more shapes` : "",
    suppressed > 0 ? `(+${suppressed} earlier alerts suppressed)` : "",
    "Detail: /audit on the gateway.",
  ].filter(Boolean);
  return {
    title: reason === "reads"
      ? "Command Center: Monday reads failing (no writes lost)"
      : "Command Center: Monday WRITES failing",
    body: body.join("\n"),
    // Lower than a send-job failure: these are individual rejected calls, and
    // the rep usually saw a toast. Worth knowing, not worth waking someone.
    priority: "default",
    tags: "warning",
  };
}
