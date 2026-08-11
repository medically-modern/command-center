/**
 * Patient Intake — Scheduled Calls.
 *
 * Today's booked intake calls as a day grid. This is the first role ordered by
 * TIME OF DAY rather than a Next Action Date, so the page is a calendar rather
 * than a sidebar-and-panel: the rep's question is "what's next and when", which
 * a list of names cannot answer.
 *
 * Clicking a block opens the patient in the DTC intake queue, where everything
 * needed to make the call already lives. Nothing is written from here — the
 * rep works and takes notes on that page, and its note log already stamps
 * every line with the stage.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";

import { fetchScheduledCalls } from "@/lib/scheduledCalls/mondayApi";
import {
  callsOn, dayView, displayTime, minutesOfDay, nowMinutesEt,
  dueForReminder, REMINDER_LEAD_MIN,
  type ScheduledCall,
} from "@/lib/scheduledCalls/workflow";
import { etToday, addCalendarDaysIso } from "@/lib/masheke/etDate";
import BookingLinkDialog from "@/components/scheduledCalls/BookingLinkDialog";
import { cn } from "@/lib/utils";

/** The grid's vertical extent. Bookings outside it still render, clamped. */
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 20;
const PX_PER_MIN = 1.4;
const ASSUMED_DURATION_MIN = 10;

const POLL_MS = 60_000;

function hourLabel(h: number): string {
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${suffix}`;
}

/** Ticks once a minute so "now" and the burndown stay honest without a reload. */
function useNowMinutes(): number {
  const [now, setNow] = useState(() => nowMinutesEt());
  useEffect(() => {
    const id = setInterval(() => setNow(nowMinutesEt()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function ScheduledCallsPage() {
  const navigate = useNavigate();
  const [all, setAll] = useState<ScheduledCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const nowMinutes = useNowMinutes();
  const today = etToday();

  /**
   * The day being looked at. Defaults to today — that is the job — but a rep
   * checking tomorrow's load before they leave, or looking back at what they
   * were meant to have called, both want the same grid pointed elsewhere.
   *
   * The reminder host is deliberately NOT affected: it only ever announces
   * today, whatever this page is showing.
   */
  const [viewDate, setViewDate] = useState(today);
  const isToday = viewDate === today;
  const [linkOpen, setLinkOpen] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setAll(await fetchScheduledCalls());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load bookings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => void load(true), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const todays = useMemo(() => callsOn(all, viewDate), [all, viewDate]);
  // On any day but today, "now" is meaningless — anchor to the start of the
  // day so nothing is greyed out as passed and the count reads as the total.
  const view = useMemo(() => dayView(todays, isToday ? nowMinutes : 0), [todays, nowMinutes, isToday]);

  const openPatient = useCallback((c: ScheduledCall) => {
    // The DTC intake queue defaults to the Completed forms group and injects a
    // deep-linked patient even when the list doesn't contain them, so this one
    // link is the whole hand-off.
    navigate(`/unverified-referrals?patientId=${encodeURIComponent(c.id)}&from=scheduled-calls`);
  }, [navigate]);

  // The ten-minute warning lives in ScheduledCallHost, mounted app-wide and
  // gated to people who hold this role. Firing it here as well would double
  // every reminder for the rep who happens to have the page open — and this
  // page is exactly where they will be.

  const gridHeight = (DAY_END_HOUR - DAY_START_HOUR) * 60 * PX_PER_MIN;
  const topFor = (mins: number) => (mins - DAY_START_HOUR * 60) * PX_PER_MIN;
  const nowTop = topFor(nowMinutes);
  const nowVisible = nowMinutes >= DAY_START_HOUR * 60 && nowMinutes <= DAY_END_HOUR * 60;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <BookingLinkDialog open={linkOpen} onOpenChange={setLinkOpen} />
      <header className="mb-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <CalendarClock className="h-6 w-6 text-sky-500" />
              Scheduled Calls
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {new Date(`${viewDate}T12:00:00`).toLocaleDateString(undefined, {
                weekday: "long", month: "long", day: "numeric",
              })}
              {!isToday && <span className="ml-2 text-xs">(not today)</span>}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setLinkOpen(true)}
              title="Send someone a booking link"
              className="flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
            >
              <Plus className="h-4 w-4" />
              Booking link
            </button>
            <span className="mx-1 h-5 w-px bg-border" />
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
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent",
                isToday && "opacity-50",
              )}
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
            <button
              onClick={() => void load()}
              className="ml-1 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              Refresh
            </button>
          </div>
        </div>

        {/* Burndown. Counts what is still AHEAD of you — it falls by one as each
            appointment's start time passes, so it answers "how much is left
            today" rather than "how many did I make". */}
        <div className="mt-4 rounded-lg border bg-card p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">
              {isToday ? "Calls remaining today" : "Calls booked"}
            </span>
            <span className="text-2xl font-semibold tabular-nums">
              {isToday ? view.remaining : view.total}
              {isToday && (
                <span className="ml-1 text-sm font-normal text-muted-foreground">/ {view.total}</span>
              )}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-sky-500 transition-all duration-500"
              style={{ width: view.total ? `${(view.remaining / view.total) * 100}%` : "0%" }}
            />
          </div>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
        </div>
      )}

      {!loading && !view.total && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {isToday ? "No calls booked for today." : "No calls booked for this day."}
        </div>
      )}

      {view.total > 0 && (
        <div className="relative rounded-lg border bg-card">
          <div className="relative" style={{ height: gridHeight }}>
            {/* Hour rules */}
            {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => {
              const h = DAY_START_HOUR + i;
              return (
                <div
                  key={h}
                  className="absolute left-0 right-0 flex items-start"
                  style={{ top: topFor(h * 60) }}
                >
                  <span className="w-16 shrink-0 -translate-y-1.5 pr-2 text-right text-[11px] tabular-nums text-muted-foreground">
                    {hourLabel(h)}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              );
            })}

            {/* Now line — the anchor that makes the grid readable at a glance */}
            {isToday && nowVisible && (
              <div className="pointer-events-none absolute left-16 right-0 z-20" style={{ top: nowTop }}>
                <div className="relative h-px bg-red-500">
                  <span className="absolute -left-1 -top-[3px] h-[7px] w-[7px] rounded-full bg-red-500" />
                </div>
              </div>
            )}

            {/* Bookings */}
            {todays.map((c) => {
              const at = minutesOfDay(c.callTime);
              if (at === null) return null;
              const past = isToday && at + ASSUMED_DURATION_MIN < nowMinutes;
              const soon = isToday && dueForReminder(c, nowMinutes);
              return (
                <button
                  key={c.id}
                  onClick={() => openPatient(c)}
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
                  style={{
                    top: topFor(at),
                    minHeight: Math.max(ASSUMED_DURATION_MIN * PX_PER_MIN, 34),
                  }}
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

      {/* Bookings with no time can't be placed on the grid, and dropping them
          would lose a real patient. */}
      {todays.some((c) => minutesOfDay(c.callTime) === null) && (
        <div className="mt-4 rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Booked this day, no time on file
          </div>
          {todays.filter((c) => minutesOfDay(c.callTime) === null).map((c) => (
            <button
              key={c.id}
              onClick={() => openPatient(c)}
              className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Times are Eastern. You'll get a reminder {REMINDER_LEAD_MIN} minutes before each call.
      </p>
    </div>
  );
}
