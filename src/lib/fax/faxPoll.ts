/**
 * How long to wait before re-asking RingCentral about an outbound fax.
 *
 * ⚠️ **A fax can take far longer than eight minutes to settle**, and the slow
 * ones are disproportionately the FAILURES — which are the whole reason the
 * status is on screen. Measured against the live account 2026-09-03, the last
 * 25 outbound faxes (18 Sent, 7 SendingFailed — a 28% failure rate) took, from
 * creation to final status:
 *
 *   Sent:          95s · 153s · 184s · 211s · 226s · 276s · 357s · 1435s · 1625s
 *   SendingFailed: 679s · 862s · 991s
 *
 * The old schedule was a flat 40 polls × 12s = **exactly 8 minutes** (its
 * `FAST_POLL_MS` was declared and never used), so five of those twelve — and
 * three of the four failures — settled after the poll had already given up. The
 * chip sat on "Processing" for ever, which is the one thing it must not do now
 * that Send Request asks a rep to read it before advancing.
 *
 * So: fast while RC is still registering the fax, then progressively slower out
 * to roughly half an hour. That covers every observed settle time at 56
 * requests instead of 40 — a longer horizon for barely more load, which matters
 * because this polls a shared RingCentral account (INCIDENT_2026-08-20).
 */

interface Step {
  /** Poll number this step applies through (1-based, inclusive). */
  through: number;
  everyMs: number;
}

/** Fast for the first ~30s (the registration gap), then 12s, 30s, 60s. */
const SCHEDULE: Step[] = [
  { through: 6, everyMs: 5_000 },    // → 30s
  { through: 16, everyMs: 12_000 },  // → ~2.5 min
  { through: 36, everyMs: 30_000 },  // → ~12.5 min
  { through: 56, everyMs: 60_000 },  // → ~32.5 min
];

/** Total polls before giving up. Exported so the horizon is assertable. */
export const FAX_MAX_POLLS = SCHEDULE[SCHEDULE.length - 1].through;

/**
 * Delay before poll number `pollsDone + 1`, or `null` to stop.
 *
 * @param pollsDone how many polls have already been made (0 before the first).
 */
export function faxPollDelayMs(pollsDone: number): number | null {
  if (pollsDone >= FAX_MAX_POLLS) return null;
  const next = pollsDone + 1;
  for (const step of SCHEDULE) {
    if (next <= step.through) return step.everyMs;
  }
  return null;
}

/** Wall-clock the schedule covers, for the tests and the comment above. */
export function faxPollHorizonMs(): number {
  let total = 0;
  for (let i = 0; i < FAX_MAX_POLLS; i++) {
    total += faxPollDelayMs(i) ?? 0;
  }
  return total;
}
