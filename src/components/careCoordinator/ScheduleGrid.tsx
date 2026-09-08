/**
 * "My Schedule" — the day grid of booked intake calls.
 *
 * Moved verbatim from the old ScheduledCallsPage (2026-09-08) when that role
 * became the Care Coordinator dashboard; the grid is now the bottom half of
 * that page rather than the whole of it. Behaviour is unchanged: Eastern
 * times, a red now-line, passed calls greyed, a call inside the reminder lead
 * amber, prev/today/next paging, bookings without a time listed underneath.
 *
 * Fed with `ScheduledCall[]` by the page (derived from the intake column's own
 * read — `workflow.toScheduledCall`), so it makes no Monday call of its own.
 * The ten-minute warning still lives in `ScheduledCallHost`, app-wide; firing
 * it here too would double every reminder for the one person who always has
 * this page open.
 */
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  callsOn, dayView, displayTime, minutesOfDay, dueForReminder, REMINDER_LEAD_MIN,
  type ScheduledCall,
} from "@/lib/scheduledCalls/workflow";
import { etToday, addCalendarDaysIso } from "@/lib/masheke/etDate";
import { cn } from "@/lib/utils";

/** The grid's vertical extent. Bookings outside it still render, clamped. */
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 20;
const PX_PER_MIN = 1.4;
const ASSUMED_DURATION_MIN = 10;

function hourLabel(h: number): string {
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${suffix}`;
}

export function ScheduleGrid({
  calls, nowMinutes, onOpen, remindersOn,
}: {
  calls: ScheduledCall[];
  /** Minutes past ET midnight — the page owns the one ticker. */
  nowMinutes: number;
  onOpen: (c: ScheduledCall) => void;
  /** Whether THIS viewer gets the ten-minute toast. `ScheduledCallHost` fires
   *  it only for a processor holding the role, so the old page's blanket
   *  "you'll get a reminder" was a promise it didn't keep for managers (§5.15:
   *  "fix the copy, not the gate"). */
  remindersOn: boolean;
}) {
  const today = etToday();
  /**
   * The day being looked at. Defaults to today — that is the job — but a rep
   * checking tomorrow's load before they leave, or looking back at what they
   * were meant to have called, both want the same grid pointed elsewhere.
   */
  const [viewDate, setViewDate] = useState(today);
  const isToday = viewDate === today;

  const todays = useMemo(() => callsOn(calls, viewDate), [calls, viewDate]);
  // On any day but today, "now" is meaningless — anchor to the start of the
  // day so nothing is greyed out as passed and the count reads as the total.
  const view = useMemo(() => dayView(todays, isToday ? nowMinutes : 0), [todays, nowMinutes, isToday]);

  const gridHeight = (DAY_END_HOUR - DAY_START_HOUR) * 60 * PX_PER_MIN;
  const topFor = (mins: number) => (mins - DAY_START_HOUR * 60) * PX_PER_MIN;
  const nowTop = topFor(nowMinutes);
  const nowVisible = nowMinutes >= DAY_START_HOUR * 60 && nowMinutes <= DAY_END_HOUR * 60;

  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5" aria-label="My schedule">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">My Schedule</h2>
          <p className="text-xs text-muted-foreground">
            {new Date(`${viewDate}T12:00:00`).toLocaleDateString(undefined, {
              weekday: "long", month: "short", day: "numeric",
            })}
            {" · "}
            {isToday
              ? `${view.remaining} of ${view.total} booked call${view.total === 1 ? "" : "s"} still ahead`
              : `${view.total} booked call${view.total === 1 ? "" : "s"}`}
            {!isToday && <span className="ml-1">(not today)</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            aria-label="Previous day"
            onClick={() => setViewDate((d) => addCalendarDaysIso(d, -1))}
            className="rounded-md border p-1.5 hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewDate(today)}
            disabled={isToday}
            className={cn("rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent", isToday && "opacity-50")}
          >
            Today
          </button>
          <button
            aria-label="Next day"
            onClick={() => setViewDate((d) => addCalendarDaysIso(d, 1))}
            className="rounded-md border p-1.5 hover:bg-accent"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!view.total && (
        <div className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {isToday ? "No calls booked for today." : "No calls booked for this day."}
        </div>
      )}

      {view.total > 0 && (
        <div className="relative mt-4 rounded-lg border bg-background">
          <div className="relative" style={{ height: gridHeight }}>
            {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => {
              const h = DAY_START_HOUR + i;
              return (
                <div key={h} className="absolute left-0 right-0 flex items-start" style={{ top: topFor(h * 60) }}>
                  <span className="w-16 shrink-0 -translate-y-1.5 pr-2 text-right text-[11px] tabular-nums text-muted-foreground">
                    {hourLabel(h)}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              );
            })}

            {isToday && nowVisible && (
              <div className="pointer-events-none absolute left-16 right-0 z-20" style={{ top: nowTop }}>
                <div className="relative h-px bg-red-500">
                  <span className="absolute -left-1 -top-[3px] h-[7px] w-[7px] rounded-full bg-red-500" />
                </div>
              </div>
            )}

            {todays.map((c) => {
              const at = minutesOfDay(c.callTime);
              if (at === null) return null;
              const past = isToday && at + ASSUMED_DURATION_MIN < nowMinutes;
              const soon = isToday && dueForReminder(c, nowMinutes);
              return (
                <button
                  key={c.id}
                  onClick={() => onOpen(c)}
                  title={`${displayTime(c.callTime)} · ${c.name}`}
                  className={cn(
                    "absolute left-16 right-2 z-10 overflow-hidden rounded-md border px-2.5 py-1.5 text-left transition",
                    "hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500",
                    past
                      ? "border-muted bg-muted/50 text-muted-foreground"
                      : soon
                        ? "border-amber-400 bg-amber-50 dark:bg-amber-950/40"
                        : "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40",
                  )}
                  style={{ top: topFor(at), minHeight: Math.max(ASSUMED_DURATION_MIN * PX_PER_MIN, 34) }}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold tabular-nums">{displayTime(c.callTime)}</span>
                    <span className="truncate text-sm font-medium">{c.name}</span>
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {[c.requestType, c.reason].filter(Boolean).join(" · ") || "Intake call"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {todays.some((c) => minutesOfDay(c.callTime) === null) && (
        <div className="mt-4 rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Booked this day, no time on file
          </div>
          {todays.filter((c) => minutesOfDay(c.callTime) === null).map((c) => (
            <button key={c.id} onClick={() => onOpen(c)} className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent">
              {c.name}
            </button>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Times are Eastern.{" "}
        {remindersOn
          ? `You'll get a reminder ${REMINDER_LEAD_MIN} minutes before each booked call, wherever you are in the app.`
          : `The ${REMINDER_LEAD_MIN}-minute reminder before each call goes to the person who holds this role.`}
      </p>
    </section>
  );
}
