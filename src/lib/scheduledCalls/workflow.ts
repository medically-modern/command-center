/**
 * Patient Intake — Scheduled Calls.
 *
 * The day's booked intake calls, as a time-ordered queue. Calendly owns the
 * appointment; the Profile Send Off board carries a mirror (Scheduled Call Time
 * `date_mm63na19`, Booking Status `color_mm5zrbn3`) written by the dtc-mm-form
 * backend and corrected by its Calendly webhook. This role reads that mirror,
 * which is why it needs no Calendly credentials of its own and counts like
 * every other role — an ordinary board query (CLAUDE.md §5.8).
 *
 * ⚠️ This is the first role whose work is ordered by TIME OF DAY rather than by
 * a Next Action Date. "Due" here means the appointment hour has arrived, not
 * that a date bucket rolled over — so the ordinary snooze/follow-up rules do
 * not apply and deliberately are not consulted.
 */

/** Monday hands back date+time columns as naive Eastern wall-clock. */
export interface ScheduledCall {
  id: string;
  name: string;
  phone: string;
  email: string;
  /** YYYY-MM-DD, Eastern. Blank when nothing is booked. */
  callDate: string;
  /** HH:mm:ss, Eastern. Blank when the column carried a date but no time. */
  callTime: string;
  /** Scheduled · Unscheduled · Canceled */
  bookingStatus: string;
  /** Why they got in touch — enough for the rep to open the call. */
  reason: string;
  requestType: string;
  generalInsurance: string;
  state: string;
  calendlyEventUri: string;
}

export type CallState = "upcoming" | "now" | "passed";

/** Minutes either side of the appointment that count as "happening now". */
const NOW_WINDOW_BEFORE_MIN = 5;
const NOW_WINDOW_AFTER_MIN = 10;

/**
 * Minutes past Eastern midnight, or null when unparseable.
 *
 * Everything in this module compares minutes-in-the-day rather than Date
 * objects. The board's values are already Eastern wall-clock, and building a
 * Date from them in a UTC container (Railway, and the baseline cron) reinterprets
 * them in the wrong zone — the exact class of bug that made the old form book
 * patients three hours out.
 */
export function minutesOfDay(hhmmss: string): number | null {
  // Anchored at BOTH ends on purpose. A loose prefix match reads "2:00 PM" as
  // 02:00 — a display string quietly becoming a value twelve hours out, which
  // is the exact failure this whole stage was rebuilt to remove. A 12-hour
  // string is not a wall-clock value and must be rejected, not guessed at.
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec((hhmmss || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** A booking that is actually on today's board and still live. */
export function isLiveBooking(c: ScheduledCall): boolean {
  // A canceled call keeps its row; it must never appear in the day view, or a
  // rep rings somebody who called off. Blank status counts as live — the mirror
  // may not have caught up, and showing a call that isn't there is recoverable
  // in a way that hiding a real one is not.
  return Boolean(c.callDate) && (c.bookingStatus || "").trim().toLowerCase() !== "canceled";
}

/**
 * Where a booking sits relative to the current moment.
 *
 * `nowMinutes` is passed in rather than read, so this stays pure and the
 * tests can walk a day without touching the clock.
 */
export function callState(c: ScheduledCall, nowMinutes: number): CallState {
  const at = minutesOfDay(c.callTime);
  // A booking with a date but no time can't be sequenced. Treat it as still
  // to do rather than silently dropping it off the bottom of the list.
  if (at === null) return "upcoming";
  if (nowMinutes < at - NOW_WINDOW_BEFORE_MIN) return "upcoming";
  if (nowMinutes <= at + NOW_WINDOW_AFTER_MIN) return "now";
  return "passed";
}

/**
 * The burndown number: bookings whose time has not yet passed.
 *
 * Josh, 2026-08-10 — deliberately a CLOCK, not a disposition. Nothing marks a
 * call "done", so this counts what is still ahead of you rather than what has
 * been worked. It therefore reaches zero at the end of the day whether or not
 * anyone made a single call, which is understood and accepted: the number
 * answers "how much is left today", not "how much did we do".
 *
 * ⚠️ If a per-call outcome is ever added, this is the function to change — and
 * `useRoleCounts` plus both baseline generators have to change with it
 * (CLAUDE.md §5.8 counting contract).
 */
export function remainingToday(calls: ScheduledCall[], nowMinutes: number): number {
  return calls.filter((c) => isLiveBooking(c) && callState(c, nowMinutes) !== "passed").length;
}

/** Time order, with unsequenceable bookings last rather than first. */
export function sortByTime(calls: ScheduledCall[]): ScheduledCall[] {
  return [...calls].sort((a, b) => {
    const ma = minutesOfDay(a.callTime);
    const mb = minutesOfDay(b.callTime);
    if (ma === null && mb === null) return a.name.localeCompare(b.name);
    if (ma === null) return 1;
    if (mb === null) return -1;
    return ma - mb || a.name.localeCompare(b.name);
  });
}

/** `14:00:00` → `2:00 PM`. Display only. */
export function displayTime(hhmmss: string): string {
  const mins = minutesOfDay(hhmmss);
  if (mins === null) return "—";
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Current minutes past Eastern midnight — the only impure function here. */
export function nowMinutesEt(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const h = get("hour");
  return (h === 24 ? 0 : h) * 60 + get("minute");
}

/** Today's bookings, in Eastern. `etDate` is passed in to keep this pure. */
export function callsOn(calls: ScheduledCall[], etDate: string): ScheduledCall[] {
  return calls.filter((c) => isLiveBooking(c) && c.callDate === etDate);
}

/** How long before the call the rep gets warned. */
export const REMINDER_LEAD_MIN = 10;

/**
 * Should this call be announced right now?
 *
 * A window, not an instant: the page polls, tabs sleep, and laptops suspend, so
 * a check for "exactly ten minutes out" fires only if a tick happens to land on
 * that minute. Anything from the lead time down to the appointment itself
 * counts, and the caller remembers what it has already shown so the reminder
 * appears once rather than on every tick.
 */
export function dueForReminder(c: ScheduledCall, nowMinutes: number): boolean {
  if (!isLiveBooking(c)) return false;
  const at = minutesOfDay(c.callTime);
  if (at === null) return false;
  const until = at - nowMinutes;
  return until <= REMINDER_LEAD_MIN && until >= 0;
}

/** Minutes until the appointment; negative once it has passed. */
export function minutesUntil(c: ScheduledCall, nowMinutes: number): number | null {
  const at = minutesOfDay(c.callTime);
  return at === null ? null : at - nowMinutes;
}

/**
 * The day view, grouped for rendering.
 *
 * `now` sits between the two lists rather than in its own bucket, so the rep
 * reads the page top-to-bottom as "done / doing / next".
 */
export function dayView(calls: ScheduledCall[], nowMinutes: number) {
  const live = sortByTime(calls.filter(isLiveBooking));
  return {
    passed: live.filter((c) => callState(c, nowMinutes) === "passed"),
    now: live.filter((c) => callState(c, nowMinutes) === "now"),
    upcoming: live.filter((c) => callState(c, nowMinutes) === "upcoming"),
    remaining: remainingToday(live, nowMinutes),
    total: live.length,
  };
}
