/**
 * The day strip — booked calls laid out HORIZONTALLY by time.
 *
 * Brandon, 2026-09-14: "move the calendar above the lists; it should be
 * horizontal by time, not vertical (time is on the x-axis, and only shows one
 * day at a time) — so the height should be very small and it stretches across
 * the screen. Each event should only have the patient name and should be
 * shaded either of the two colors to match the 2 sections (Intake vs. Welcome
 * call)."
 *
 * Two kinds of booking, always both:
 *  · **Intake calls** come from the monday mirror the dtc-mm-form backend keeps
 *    on Profile Send Off, handed down by the page from its own column read —
 *    no monday call of its own.
 *  · **Welcome calls** come from Calendly through the gateway, because they
 *    have no mirror anywhere: the Welcome Call board has no booking column and
 *    nothing copies the intake one across the board hop (CLAUDE.md §5.15,
 *    §5.26). One read per day viewed, cached, never polled (`useCalendlyDay`).
 *
 * The ten-minute warning still lives in `ScheduledCallHost`, app-wide, and is
 * still INTAKE-ONLY — it reads the monday mirror, which has no welcome-call
 * rows in it. The footnote says so rather than implying a reminder this page
 * cannot deliver (§5.15: "fix the copy, not the gate").
 */
import { useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";

import {
  callsOn, dayView, displayTime, minutesOfDay, dueForReminder, REMINDER_LEAD_MIN,
  type ScheduledCall,
} from "@/lib/scheduledCalls/workflow";
import {
  emailIndex, intakeEntry, welcomeEntry, type ScheduleEntry,
} from "@/lib/careCoordinator/scheduleEntries";
import { useCalendlyDay } from "@/hooks/careCoordinator/useCalendlyDay";
import { etToday, addCalendarDaysIso } from "@/lib/masheke/etDate";
import { cn } from "@/lib/utils";
import { COLUMN_ACCENT } from "./PipelineColumn";
import { laneFor } from "@/lib/careCoordinator/lanes";

/** The strip's horizontal extent. Bookings outside it still render, clamped. */
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 20;
const ASSUMED_DURATION_MIN = 10;
/** A block is never narrower than this, so a name is readable at any width. */
const MIN_BLOCK_PCT = 7;
const LANE_PX = 30;

function hourLabel(h: number): string {
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${suffix}`;
}

export function ScheduleGrid({
  calls, welcomeItems, nowMinutes, onOpen, remindersOn,
}: {
  /** Intake bookings off the monday mirror — the page's own column read. */
  calls: ScheduledCall[];
  /**
   * The Welcome Call queue, for linking a Calendly booking back to a chart.
   * Matched on the invitee's EMAIL, which is the same single join the intake
   * mirror depends on — so a patient who booked with a different address
   * simply doesn't link, and the block renders without an Open.
   */
  welcomeItems: { id: string; email: string }[];
  /** Minutes past ET midnight — the page owns the one ticker. */
  nowMinutes: number;
  /** Given a route. Blocks we can't identify a patient for don't call this. */
  onOpen: (href: string) => void;
  /** Whether THIS viewer gets the ten-minute toast. `ScheduledCallHost` fires
   *  it only for a processor holding the role. */
  remindersOn: boolean;
}) {
  const today = etToday();
  const [viewDate, setViewDate] = useState(today);
  const isToday = viewDate === today;

  const day = useCalendlyDay(viewDate, true);

  const intakeEntries = useMemo(() => calls.map(intakeEntry), [calls]);
  const byEmail = useMemo(() => emailIndex(welcomeItems), [welcomeItems]);
  const welcomeEntries = useMemo(
    () => day.bookings.map((b) => welcomeEntry(b, (e) => byEmail.get((e || "").trim().toLowerCase()) ?? null)),
    [day.bookings, byEmail],
  );
  const entries = useMemo<ScheduleEntry[]>(() => [...intakeEntries, ...welcomeEntries], [intakeEntries, welcomeEntries]);

  const todays = useMemo(() => callsOn(entries, viewDate), [entries, viewDate]);
  // On any day but today, "now" is meaningless — anchor to the start of the
  // day so nothing is greyed out as passed and the count reads as the total.
  const view = useMemo(() => dayView(todays, isToday ? nowMinutes : 0), [todays, nowMinutes, isToday]);

  const startMin = DAY_START_HOUR * 60;
  const spanMin = (DAY_END_HOUR - DAY_START_HOUR) * 60;
  const pctFor = (mins: number) => Math.min(100, Math.max(0, ((mins - startMin) / spanMin) * 100));

  const timed = useMemo(() => laneFor(
    todays.flatMap((c) => {
      const at = minutesOfDay(c.callTime);
      return at === null ? [] : [{ c, start: at, end: at + ASSUMED_DURATION_MIN }];
    }),
  ), [todays]);
  const lanes = Math.max(1, ...timed.map((b) => b.lane + 1));
  const untimed = todays.filter((c) => minutesOfDay(c.callTime) === null);
  const nowVisible = isToday && nowMinutes >= startMin && nowMinutes <= startMin + spanMin;

  /** A failed Calendly read must never render as a quiet day. */
  const welcomeProblem = day.error || !day.available;

  return (
    <section className="rounded-xl border bg-card px-4 py-3" aria-label="My schedule">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-base font-semibold tracking-tight">Schedule</h2>
          <p className="text-xs text-muted-foreground">
            {new Date(`${viewDate}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
            {" · "}
            {isToday
              ? `${view.remaining} of ${view.total} still ahead`
              : `${view.total} booked call${view.total === 1 ? "" : "s"}`}
          </p>
          <span className="flex items-center gap-3 text-[11px] text-muted-foreground" aria-hidden>
            <span className="inline-flex items-center gap-1"><i className={cn("inline-block h-2.5 w-2.5 rounded-sm", COLUMN_ACCENT.intake.dot)} />Intake</span>
            <span className="inline-flex items-center gap-1"><i className={cn("inline-block h-2.5 w-2.5 rounded-sm", COLUMN_ACCENT.welcome.dot)} />Welcome call</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={day.refetch}
            aria-label="Refresh welcome-call bookings"
            title="Refresh welcome-call bookings from Calendly"
            className="rounded-md border p-1.5 hover:bg-accent"
          >
            {day.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
          <button aria-label="Previous day" onClick={() => setViewDate((d) => addCalendarDaysIso(d, -1))} className="rounded-md border p-1.5 hover:bg-accent">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewDate(today)}
            disabled={isToday}
            className={cn("rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent", isToday && "opacity-50")}
          >
            Today
          </button>
          <button aria-label="Next day" onClick={() => setViewDate((d) => addCalendarDaysIso(d, 1))} className="rounded-md border p-1.5 hover:bg-accent">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ⚠️ Said out loud, because the alternative is an empty strip that reads
          as "nothing booked" on a day that may be full. */}
      {welcomeProblem && (
        <p
          role="status"
          className="mt-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {day.available
              ? `Welcome-call bookings couldn't be read from Calendly, so any are missing from this day. ${day.error}`
              : "Welcome-call bookings need the gateway, which isn't configured in this build — only intake calls are shown."}
          </span>
        </p>
      )}

      {/* The strip: hour ticks along the top, blocks in lanes beneath. */}
      <div className="relative mt-2 overflow-hidden rounded-lg border bg-background">
        <div className="relative h-5 border-b bg-muted/40">
          {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => {
            const h = DAY_START_HOUR + i;
            return (
              <span
                key={h}
                className="absolute top-0 -translate-x-1/2 text-[10px] leading-5 tabular-nums text-muted-foreground"
                style={{ left: `${pctFor(h * 60)}%` }}
              >
                {hourLabel(h)}
              </span>
            );
          })}
        </div>
        <div className="relative" style={{ height: lanes * LANE_PX + 6 }}>
          {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => (
            <div key={i} className="absolute inset-y-0 w-px bg-border/70" style={{ left: `${pctFor((DAY_START_HOUR + i) * 60)}%` }} aria-hidden />
          ))}
          {nowVisible && (
            <div className="pointer-events-none absolute inset-y-0 z-20 w-px bg-red-500" style={{ left: `${pctFor(nowMinutes)}%` }} aria-hidden>
              <span className="absolute -left-[3px] -top-[3px] h-[7px] w-[7px] rounded-full bg-red-500" />
            </div>
          )}
          {timed.map(({ c, start, lane }) => {
            const past = isToday && start + ASSUMED_DURATION_MIN < nowMinutes;
            const soon = isToday && dueForReminder(c, nowMinutes);
            const welcome = c.kind === "welcome";
            const left = pctFor(start);
            const width = Math.max(MIN_BLOCK_PCT, (ASSUMED_DURATION_MIN / spanMin) * 100);
            return (
              <Block
                key={c.key}
                href={c.href}
                onOpen={onOpen}
                title={`${displayTime(c.callTime)} · ${c.name} · ${welcome ? "welcome call" : "intake call"}`}
                className={cn(
                  "absolute z-10 truncate rounded-md border px-2 text-xs font-medium leading-6",
                  welcome ? COLUMN_ACCENT.welcome.block : COLUMN_ACCENT.intake.block,
                  past && "opacity-50",
                  soon && "ring-2 ring-amber-400",
                )}
                style={{ left: `min(${left}%, ${100 - width}%)`, width: `${width}%`, top: 3 + lane * LANE_PX }}
              >
                {c.name}
              </Block>
            );
          })}
          {!view.total && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
              {day.loading ? "Loading…" : isToday ? "No calls booked for today." : "No calls booked for this day."}
            </div>
          )}
        </div>
      </div>

      {untimed.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>Booked this day, no time on file:</span>
          {untimed.map((c) => (
            <Block key={c.key} href={c.href} onOpen={onOpen} className={cn("rounded px-1.5 py-0.5 text-xs font-medium", c.kind === "welcome" ? COLUMN_ACCENT.welcome.block : COLUMN_ACCENT.intake.block)}>
              {c.name}
            </Block>
          ))}
        </p>
      )}

      <p className="mt-2 text-[11px] text-muted-foreground">
        Times are Eastern.{" "}
        {remindersOn
          ? `You'll get a reminder ${REMINDER_LEAD_MIN} minutes before each booked intake call, wherever you are in the app.`
          : `The ${REMINDER_LEAD_MIN}-minute reminder before each intake call goes to the person who holds this role.`}
        {" "}Welcome calls are read live from Calendly and don't raise a reminder.
      </p>
    </section>
  );
}

/**
 * A block, clickable only when we know which patient it is.
 *
 * ⚠️ A welcome-call booking whose invitee email matches no Welcome Call row has
 * no chart to open — rendering a button that navigates nowhere (or worse, to a
 * guessed patient) is the failure this avoids. It still renders: the
 * coordinator needs to see the call is happening.
 */
function Block({
  href, onOpen, className, style, title, children,
}: {
  href: string | null;
  onOpen: (href: string) => void;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  children: React.ReactNode;
}) {
  if (!href) {
    return (
      <div
        title={title ? `${title} — not on the Welcome Call queue, so there's no chart to open` : undefined}
        className={cn("cursor-default", className)}
        style={style}
      >
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(href)}
      title={title}
      className={cn("text-left transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500", className)}
      style={style}
    >
      {children}
    </button>
  );
}
