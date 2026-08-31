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
