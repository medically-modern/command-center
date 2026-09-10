/**
 * "My Schedule" — the day grid of booked calls.
 *
 * Originally the whole of the Scheduled Calls page, moved here 2026-09-08 when
 * that role became the Care Coordinator dashboard. Eastern times, a red
 * now-line, passed calls greyed, a call inside the reminder lead amber,
 * prev/today/next paging, bookings without a time listed underneath.
 *
 * From 2026-09-10 it shows TWO kinds of booking, behind a toggle:
 *
 *  · **Intake calls** come from the monday mirror the dtc-mm-form backend keeps
 *    on Profile Send Off, handed down by the page from its own column read — so
 *    this makes no monday call of its own, exactly as before.
 *  · **Welcome calls** come from Calendly through the gateway, because they
 *    have no mirror anywhere: the Welcome Call board has no booking column and
 *    nothing copies the intake one across the board hop (CLAUDE.md §5.15,
 *    §5.26). They are fetched only while the toggle is showing them.
 *
 * The ten-minute warning still lives in `ScheduledCallHost`, app-wide, and is
 * still INTAKE-ONLY — it reads the monday mirror, which has no welcome-call
 * rows in it. The footnote below says so rather than implying a reminder this
 * page cannot deliver (§5.15: "fix the copy, not the gate").
 */
import { useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";

import {
  callsOn, dayView, displayTime, minutesOfDay, dueForReminder, REMINDER_LEAD_MIN,
  type ScheduledCall,
} from "@/lib/scheduledCalls/workflow";
import {
  emailIndex, entriesFor, intakeEntry, welcomeEntry,
  type ScheduleEntry, type ScheduleSource,
} from "@/lib/careCoordinator/scheduleEntries";
import { useCalendlyDay } from "@/hooks/careCoordinator/useCalendlyDay";
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

const SOURCES: { id: ScheduleSource; label: string }[] = [
  { id: "both", label: "All calls" },
  { id: "intake", label: "Intake" },
  { id: "welcome", label: "Welcome" },
];

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
  const [source, setSource] = useState<ScheduleSource>("both");
  const isToday = viewDate === today;

  // Only asks Calendly while welcome calls are actually on screen.
  const wantWelcome = source !== "intake";
  const day = useCalendlyDay(viewDate, wantWelcome);

  const intakeEntries = useMemo(() => calls.map(intakeEntry), [calls]);
  const byEmail = useMemo(() => emailIndex(welcomeItems), [welcomeItems]);
  const welcomeEntries = useMemo(
    () => day.bookings.map((b) => welcomeEntry(b, (e) => byEmail.get((e || "").trim().toLowerCase()) ?? null)),
    [day.bookings, byEmail],
  );

  const entries = useMemo(
    () => entriesFor(source, intakeEntries, welcomeEntries),
    [source, intakeEntries, welcomeEntries],
  );

  const todays = useMemo(() => callsOn(entries, viewDate), [entries, viewDate]);
  // On any day but today, "now" is meaningless — anchor to the start of the
  // day so nothing is greyed out as passed and the count reads as the total.
  const view = useMemo(() => dayView(todays, isToday ? nowMinutes : 0), [todays, nowMinutes, isToday]);

  const gridHeight = (DAY_END_HOUR - DAY_START_HOUR) * 60 * PX_PER_MIN;
  const topFor = (mins: number) => (mins - DAY_START_HOUR * 60) * PX_PER_MIN;
  const nowTop = topFor(nowMinutes);
  const nowVisible = nowMinutes >= DAY_START_HOUR * 60 && nowMinutes <= DAY_END_HOUR * 60;

  const untimed = todays.filter((c) => minutesOfDay(c.callTime) === null);
  /** A failed Calendly read must never render as a quiet day. */
  const welcomeProblem = wantWelcome && (day.error || !day.available);

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
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Which bookings to show. Calendly is only asked while "Welcome" or
              "All calls" is selected. */}
          <div className="flex rounded-md border p-0.5" role="group" aria-label="Which calls to show">
            {SOURCES.map((s) => (
              <button
                key={s.id}
                onClick={() => setSource(s.id)}
                aria-pressed={source === s.id}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition",
                  source === s.id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          {wantWelcome && (
            <button
              onClick={day.refetch}
              aria-label="Refresh welcome-call bookings"
              title="Refresh welcome-call bookings from Calendly"
              className="rounded-md border p-1.5 hover:bg-accent"
            >
              {day.loading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <RefreshCw className="h-4 w-4" />}
            </button>
          )}
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

      {/* ⚠️ Said out loud, because the alternative is an empty grid that reads
          as "nothing booked" on a day that may be full. */}
      {welcomeProblem && (
        <p
          role="status"
          className="mt-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {day.available
              ? `Welcome-call bookings couldn't be read from Calendly, so any are missing from this day. ${day.error}`
              : "Welcome-call bookings need the gateway, which isn't configured in this build — only intake calls are shown."}
          </span>
        </p>
      )}

      {!view.total && (
        <div className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {day.loading && wantWelcome
            ? "Loading…"
            : isToday ? "No calls booked for today." : "No calls booked for this day."}
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
              const welcome = c.kind === "welcome";
              return (
                <BlockShell
                  key={c.key}
                  href={c.href}
                  onOpen={onOpen}
                  title={`${displayTime(c.callTime)} · ${c.name}${welcome ? " · welcome call" : ""}`}
                  className={cn(
                    past
                      ? "border-muted bg-muted/50 text-muted-foreground"
                      : soon
                        ? "border-amber-400 bg-amber-50 dark:bg-amber-950/40"
                        : welcome
                          ? "border-teal-300 bg-teal-50 dark:border-teal-800 dark:bg-teal-950/40"
                          : "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40",
                  )}
                  style={{ top: topFor(at), minHeight: Math.max(ASSUMED_DURATION_MIN * PX_PER_MIN, 34) }}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold tabular-nums">{displayTime(c.callTime)}</span>
                    <span className="truncate text-sm font-medium">{c.name}</span>
                    {/* Only when both kinds are on screen — a badge on every row
                        of a single-kind view is noise. */}
                    {source === "both" && (
                      <span className={cn(
                        "shrink-0 rounded px-1 text-[10px] font-bold uppercase tracking-wide",
                        welcome ? "bg-teal-600/15 text-teal-800 dark:text-teal-200" : "bg-sky-600/15 text-sky-800 dark:text-sky-200",
                      )}>
                        {welcome ? "Welcome" : "Intake"}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">{c.detail}</div>
                </BlockShell>
              );
            })}
          </div>
        </div>
      )}

      {untimed.length > 0 && (
        <div className="mt-4 rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Booked this day, no time on file
          </div>
          {untimed.map((c) => (
            <BlockShell key={c.key} href={c.href} onOpen={onOpen} className="block w-full rounded px-2 py-1.5 text-left text-sm">
              {c.name}
            </BlockShell>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Times are Eastern.{" "}
        {remindersOn
          ? `You'll get a reminder ${REMINDER_LEAD_MIN} minutes before each booked INTAKE call, wherever you are in the app.`
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
function BlockShell({
  href, onOpen, className, style, title, children,
}: {
  href: string | null;
  onOpen: (href: string) => void;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  children: React.ReactNode;
}) {
  const shared = "absolute left-16 right-2 z-10 overflow-hidden rounded-md border px-2.5 py-1.5 text-left";
  const positioned = style !== undefined;
  if (!href) {
    return (
      <div
        title={title ? `${title} — not on the Welcome Call queue, so there's no chart to open` : undefined}
        className={cn(positioned && shared, positioned && "cursor-default", className)}
        style={style}
      >
        {children}
      </div>
    );
  }
  return (
    <button
      onClick={() => onOpen(href)}
      title={title}
      className={cn(
        positioned && shared,
        "transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500",
        !positioned && "hover:bg-accent",
        className,
      )}
      style={style}
    >
      {children}
    </button>
  );
}
