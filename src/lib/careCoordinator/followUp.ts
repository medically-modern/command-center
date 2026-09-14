/**
 * The follow-up push a logged call attempt makes — one rule for both columns.
 *
 * Brandon, 2026-09-14: "Whenever an attempt is made for unscheduled, let's
 * push the follow-up date (same amount as is currently done for welcome call)
 * — do exactly how it's being done for welcome call … with option to change
 * follow-up date as well."
 *
 * "Exactly how it's being done for welcome call" is the NEXT CALENDAR DAY:
 * `welcomeCall/CallAttemptsCounter`'s +1 writes ET today + 1 with no weekend
 * clamp, so a Friday attempt comes due Saturday. Brandon believed it was one
 * business day; it is not, and copying it exactly means copying that. Both
 * pages now take the date from here so they cannot drift apart.
 *
 * ⚠️ NOT `addCalendarDaysIso` from masheke/etDate — that one weekend-clamps,
 * which is the Chase cadence, not this one.
 */

/** YYYY-MM-DD one calendar day after `today` (YYYY-MM-DD). Date arithmetic
 *  in UTC on purpose: these are date LABELS, and stepping a label through
 *  `Date.UTC` can never be shifted by a zone or a DST boundary. */
export function defaultFollowUpDate(today: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((today ?? "").trim());
  if (!m) return "";
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1)).toISOString().slice(0, 10);
}

/** A date the rep may pick instead: YYYY-MM-DD, today or later. */
export function isValidFollowUpDate(date: string, today: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test((date ?? "").trim()) && date.trim() >= today;
}
