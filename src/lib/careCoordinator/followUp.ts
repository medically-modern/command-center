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

/* ── Morning / afternoon attempts (Josh, 2026-09-29) ─────────────────────── */

/**
 * Josh, 2026-09-29, on the AM/PM proposal in §5.30k: *"for the morning
 * afternoon thing this is fine, moved off her list, comes back in the
 * afternoon using timestamp"* — and option (b), no board change: *"all
 * attempts are logged in monday"*.
 *
 * So: an attempt logged BEFORE NOON ET leaves the Follow Up Date on today (the
 * patient is still today's work) and the dashboard rests the card until
 * 12 PM, read off the stamp of the newest "Call attempt" note. An attempt
 * logged after noon behaves as it always has — tomorrow.
 *
 * ⚠️ The stamp is the app's own (`lib/shared/noteStamp`, ET): every attempt
 * logged from the dashboard or the intake page writes
 * `[Sep 29, 2026, 10:12 AM] <Stage>: Call attempt N — …`. A counter bumped
 * with no such line (the Welcome Call page's own +1 writes none) rests
 * nobody — it also pushes the date to tomorrow, so nothing is lost.
 * ⚠️ Dashboard only (§5.30's two-screens rule): the stage pages' own queues
 * and the role counts are untouched, because a morning attempt now writes
 * TODAY, which those queues already read as due.
 */
export const NOON_ET_MINUTES = 12 * 60;

export type AttemptSlot = "morning" | "afternoon";

/** Before 12:00 PM ET is the morning. */
export function attemptSlot(nowMinutes: number): AttemptSlot {
  return nowMinutes < NOON_ET_MINUTES ? "morning" : "afternoon";
}

/**
 * The attempt dialog's default: today in the morning (the card rests until
 * noon and comes back), the next calendar day in the afternoon.
 */
export function defaultFollowUpDateFor(today: string, nowMinutes: number): string {
  return attemptSlot(nowMinutes) === "morning" ? (/^\d{4}-\d{2}-\d{2}$/.test(today) ? today : "") : defaultFollowUpDate(today);
}

export interface CallAttemptStamp {
  /** YYYY-MM-DD, ET — the stamp's own day. */
  date: string;
  /** Minutes past ET midnight. */
  minutes: number;
  attempt: number;
}

const MONTHS: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
// `[Sep 29, 2026, 10:12 AM] Patient Intake: Call attempt 3 — no answer —MT`
const STAMP = /^\[([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}) (AM|PM)\] [^:\n]*: Call attempt (\d+)\b/;

/** The newest stamped "Call attempt" line in a notes column, or null. */
export function newestCallAttemptStamp(notes: string | null | undefined): CallAttemptStamp | null {
  let best: CallAttemptStamp | null = null;
  for (const line of (notes ?? "").split(/\r?\n/)) {
    const m = line.trim().match(STAMP);
    if (!m) continue;
    const month = MONTHS[m[1]];
    if (!month) continue;
    const hour12 = Number(m[4]) % 12;
    const minutes = (m[6] === "PM" ? hour12 + 12 : hour12) * 60 + Number(m[5]);
    const stamp = { date: `${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`, minutes, attempt: Number(m[7]) };
    if (!best || stamp.date > best.date || (stamp.date === best.date && stamp.minutes >= best.minutes)) best = stamp;
  }
  return best;
}

/**
 * Should the card sit out until noon? Only while it IS morning, and only when
 * the newest attempt was logged this morning. Notes not read yet ⇒ false: a
 * card the coordinator can see is the safe failure (§7).
 */
export function restsUntilNoon(notes: string | null | undefined, today: string, nowMinutes: number): boolean {
  if (attemptSlot(nowMinutes) !== "morning") return false;
  const s = newestCallAttemptStamp(notes);
  return !!s && s.date === today && s.minutes < NOON_ET_MINUTES;
}

/** What a resting card says where its wait would be. */
export const BACK_AT_LABEL = "Back at 12 PM";
