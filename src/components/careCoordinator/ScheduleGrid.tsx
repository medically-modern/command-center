/**
 * The day strip — booked calls laid out HORIZONTALLY by time.
 *
 * Brandon, 2026-09-14: "move the calendar above the lists; it should be
 * horizontal by time, not vertical (time is on the x-axis, and only shows one
 * day at a time) — so the height should be very small and it stretches across
 * the screen."
 *
 * ⚠️ **CALENDLY IS THE SOURCE OF TRUTH** (Josh, 2026-09-16: "it should be
 * pulling directly from calendly with monday as a backup … show exactly what's
 * on calendly on the table"). Both kinds of booking come from the gateway's
 * `/calendly/day`; the monday mirror is read alongside it only to supply the
 * item id a block's "Open" link needs, and to stand in when Calendly cannot be
 * read at all. `scheduleEntries.mergeSchedule` owns that switch and says why.
 *
 * ⚠️ **THE LAYOUT IS A TIMELINE, NOT A ROW OF CHIPS** (Brandon, 2026-09-16).
 * Four rules, and the first two are the whole fix:
 *  1. A block is exactly as wide as the call is long. There is no minimum
 *     that inflates it — the previous `MIN_BLOCK_PCT = 7` made every
 *     10-minute call ~55 minutes wide on a 13-hour strip, which is why chips
 *     ran past the hour they ended on and why genuinely back-to-back calls
 *     were pushed into a second lane.
 *  2. `PX_PER_HOUR` is wide enough for that to be readable: a 10-minute call
 *     is 40px, which fits a stacked name. The strip is therefore wider than
 *     the screen and scrolls horizontally, opening one hour before now.
 *  3. Three lines per block — time, first name, surname — so each line only
 *     has to fit one word.
 *  4. Lanes are for REAL overlaps only. `laneFor` already compares `end <=
 *     start`, so 2:50–3:00 and 3:00–3:10 share a lane; rule 1 is what makes
 *     that visible.
 *
 * The ten-minute warning still lives in `ScheduledCallHost`, app-wide, and is
 * still INTAKE-ONLY and still driven by the monday MIRROR — so a Calendly
 * booking the mirror never caught appears here and raises no reminder. The
 * footnote says so rather than implying one (§5.15: "fix the copy, not the
 * gate").
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";

import {
  callsOn, dayView, displayTime, minutesOfDay, dueForReminder, REMINDER_LEAD_MIN,
  type ScheduledCall,
} from "@/lib/scheduledCalls/workflow";
import {
  bookingLinker, calendlyEntry, emailIndex, eventUriIndex, intakeEntry, mergeSchedule, nameIndex, phoneIndex,
  welcomeNameSuggester, type ScheduleEntry,
} from "@/lib/careCoordinator/scheduleEntries";
import { useCalendlyDay } from "@/hooks/careCoordinator/useCalendlyDay";
import { etToday, addCalendarDaysIso } from "@/lib/masheke/etDate";
import { cn } from "@/lib/utils";
import { COLUMN_ACCENT } from "./PipelineColumn";
import { initialScrollLeft, laneFor, splitName } from "@/lib/careCoordinator/lanes";
import { BookingDetailsDialog } from "./BookingDetailsDialog";

/** The strip's horizontal extent. Bookings outside it still render, clamped. */
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 20;

/**
 * How wide an hour is.
 *
 * ⚠️ This number is what makes rule 1 above workable, and it is also the only
 * lever on how much of a name fits. **Raised 240 → 380 on 2026-09-17**
 * (Brandon: *"The '...' in the calendar item takes up like half the space —
 * let's find a way to squeeze in more letters of the name. We can also shrink
 * the window a bit more — it's showing like 6.5 hours, I think we can shrink it
 * to like 4 hours at a time (1 back, 3 forward) and that way will allow us to
 * widen the boxes a bit more."*)
 *
 * The two halves of that are the same number: a wider hour is both a wider
 * block and fewer hours on screen. **Measured in a browser at 1500px wide,
 * 2026-09-17**, with the block's real type ramp and seven live-shaped names:
 *
 *   240px/hour → 40px block, **6.3 hours** on screen — `Delgado`, `Charmaine`,
 *                `Mariacamila`, `Augustina` and `Rodriguez` all ellipsed.
 *   380px/hour → 63px block, **3.9 hours** on screen — `Delgado`, `Augustina`
 *                and `Rodriguez` now fit; only the two longest FIRST names
 *                (`Charmaine`, `Mariacamila`) still clip.
 *
 * 3.9 hours is the "4 hours at a time" he asked for, so the two halves of the
 * note land together rather than trading off.
 *
 * ⚠️ It does NOT fit every name and cannot: the 2026-09-16 audit put a median
 * first name at ~306px/hour and the longest live SURNAME at ~850. Going further
 * trades away the part of the day on screen, which is the other thing he
 * values, so the full name stays in the block's `title` — and, from the same
 * day, on the popup, which is what a click is for now.
 */
const PX_PER_HOUR = 380;

/**
 * A floor purely so a degenerate booking stays clickable.
 *
 * ⚠️ NOT the old `MIN_BLOCK_PCT`. At 240px an hour this is six minutes, and
 * nothing Calendly books is shorter than ten — so it never fires on real data
 * and never distorts where a block ends. It exists only so a malformed pair
 * cannot render a zero-width, unclickable appointment.
 */
const MIN_BLOCK_PX = 24;

/** Three lines of text plus padding, with room for the lane gap. */
const LANE_PX = 58;
const BLOCK_PX = 52;

function hourLabel(h: number): string {
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${suffix}`;
}

/** "2:40p" — the compact form, because it shares a 40px block with a name. */
function shortTime(hhmmss: string): string {
  const mins = minutesOfDay(hhmmss);
  if (mins === null) return "";
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")}${h24 >= 12 ? "p" : "a"}`;
}

export function ScheduleGrid({
  calls, welcomeItems, nowMinutes, onOpen, onLogAttempt, remindersOn,
}: {
  /**
   * The monday mirror's intake bookings — the BACKUP source, and the join that
   * gives a Calendly intake booking its monday item id.
   */
  calls: ScheduledCall[];
  /**
   * The Welcome Call queue, for linking a Calendly welcome booking back to a
   * chart. Matched on the invitee's EMAIL, then the PHONE the booking page
   * collected (§5.30l) — a booking neither key finds simply doesn't link, and
   * the block renders without an Open.
   */
  welcomeItems: { id: string; email: string; name?: string; phone?: string; groupId?: string }[];
  /** Minutes past ET midnight — the page owns the one ticker. */
  nowMinutes: number;
  /** Given a route. Blocks we can't identify a patient for don't call this. */
  onOpen: (href: string) => void;
  /** The page's attempt form, for the booking popup's during- and post-call
   *  Log call attempt (Josh, 2026-09-25). Blocks that resolved to no board
   *  item never call this — see `BookingDetailsDialog`. */
  onLogAttempt?: (entry: ScheduleEntry) => void;
  /** Whether THIS viewer gets the ten-minute toast. `ScheduledCallHost` fires
   *  it only for a processor holding the role. */
  remindersOn: boolean;
}) {
  const today = etToday();
  const [viewDate, setViewDate] = useState(today);
  const isToday = viewDate === today;

  const day = useCalendlyDay(viewDate, true);

  /**
   * Calendly booking → monday item, by event URI first, then email and phone.
   * The URI join is exact, so it survives a patient who books under a second
   * address; email is the fallback for a mirror row whose URI never landed,
   * and the phone (§5.30l) for a patient whose email the board doesn't hold —
   * most Welcome Call patients.
   */
  const linker = useMemo(() => bookingLinker({
    intakeByUri: eventUriIndex(calls),
    intakeByEmail: emailIndex(calls),
    welcomeByEmail: emailIndex(welcomeItems),
    intakeByPhone: phoneIndex(calls),
    welcomeByPhone: phoneIndex(welcomeItems),
  }), [calls, welcomeItems]);

  /** An unmatched welcome booking's "possible match" by name — a hint in the
   *  popup, never a link (`ScheduleEntry.suggested`). */
  const suggester = useMemo(
    () => welcomeNameSuggester(nameIndex(welcomeItems.map((w) => ({ ...w, name: w.name ?? "" })))),
    [welcomeItems],
  );

  const fromCalendly = useMemo(
    () => day.bookings.map((b) => calendlyEntry(b, linker, suggester)),
    [day.bookings, linker, suggester],
  );
  const fromMirror = useMemo(() => calls.map(intakeEntry), [calls]);

  // ⚠️ `loaded` is required here: before the first answer, `bookings` is `[]`
  // with no error, which is indistinguishable from an empty day. Without it
  // the strip would blink empty on every load instead of showing the mirror.
  const calendlyOk = day.available && !day.error && day.loaded;
  const merged = useMemo(
    () => mergeSchedule({ calendly: fromCalendly, mirror: fromMirror, calendlyOk }),
    [fromCalendly, fromMirror, calendlyOk],
  );

  const todays = useMemo(() => callsOn(merged.entries, viewDate), [merged.entries, viewDate]);
  // On any day but today, "now" is meaningless — anchor to the start of the
  // day so nothing is greyed out as passed and the count reads as the total.
  const view = useMemo(() => dayView(todays, isToday ? nowMinutes : 0), [todays, nowMinutes, isToday]);

  const startMin = DAY_START_HOUR * 60;
  const spanMin = (DAY_END_HOUR - DAY_START_HOUR) * 60;
  const stripPx = (spanMin / 60) * PX_PER_HOUR;
  const pxFor = (mins: number) => Math.min(stripPx, Math.max(0, ((mins - startMin) / 60) * PX_PER_HOUR));

  const timed = useMemo(() => laneFor(
    todays.flatMap((c) => {
      const at = minutesOfDay(c.callTime);
      return at === null ? [] : [{ c, start: at, end: at + c.durationMin }];
    }),
  ), [todays]);
  const lanes = Math.max(1, ...timed.map((b) => b.lane + 1));
  const untimed = todays.filter((c) => minutesOfDay(c.callTime) === null);
  const nowVisible = isToday && nowMinutes >= startMin && nowMinutes <= startMin + spanMin;

  /**
   * The block whose popup is open (Brandon, 2026-09-17).
   *
   * ⚠️ Held as the ENTRY, not as a key into `todays`. The strip re-derives that
   * list on every poll and every clock tick, so a key would have to be
   * re-resolved on each one, and a booking that vanished mid-read (a cancel
   * landing between polls) would silently blank an open popup instead of
   * leaving the coordinator reading what they clicked.
   */
  const [openBooking, setOpenBooking] = useState<ScheduleEntry | null>(null);

  const scroller = useRef<HTMLDivElement>(null);

  /**
   * `nowMinutes` for the anchor, without making the anchor a dependency.
   *
   * The page re-renders every 30s as the clock ticks. Re-anchoring on that
   * would yank the strip out from under a coordinator who had scrolled
   * somewhere else, so the anchor reads the CURRENT minute through a ref and
   * only ever fires on load, on a day change, and on "Today".
   */
  const nowRef = useRef(nowMinutes);
  nowRef.current = nowMinutes;

  /**
   * Put the red now-line on screen, an hour in from the left edge.
   *
   * ⚠️ **VERIFIED, not fired and forgotten.** The browser clamps `scrollLeft`
   * to `scrollWidth - clientWidth`, so a value set before the container has
   * been laid out — `clientWidth` is 0 on a cold load until the first layout
   * pass — lands short and NOTHING ever puts it right: the strip opens at
   * 7 AM and the coordinator has to go hunting for the line. So this reads
   * back what actually took and retries on the next frame while it is still
   * short of what the element can do. Bounded at three attempts; a target
   * beyond the scrollable width (an evening past the strip's 8 PM end) is
   * satisfied by the clamp itself and stops immediately.
   */
  const anchorOnNow = useCallback(() => {
    const target = initialScrollLeft(nowRef.current, startMin, PX_PER_HOUR);
    const apply = (left: number) => {
      const el = scroller.current;
      if (!el) return;
      el.scrollLeft = target;
      const reachable = Math.min(target, Math.max(0, el.scrollWidth - el.clientWidth));
      if (left > 0 && el.scrollLeft < reachable - 1) {
        requestAnimationFrame(() => apply(left - 1));
      }
    };
    apply(3);
  }, [startMin]);

  /**
   * Open on the hour before now.
   *
   * `useLayoutEffect` so the jump happens before paint — scrolling visibly
   * from 7 AM to lunchtime on every load reads as the page being broken.
   */
  useLayoutEffect(() => {
    if (isToday) anchorOnNow();
    else if (scroller.current) scroller.current.scrollLeft = 0;
  }, [viewDate, isToday, anchorOnNow]);

  /** Nothing from Calendly — either it could not be read, or there is no gateway. */
  const calendlyProblem = day.available ? Boolean(day.error) : true;

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
            aria-label="Refresh bookings from Calendly"
            title="Refresh bookings from Calendly"
            className="rounded-md border p-1.5 hover:bg-accent"
          >
            {day.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
          <button aria-label="Previous day" onClick={() => setViewDate((d) => addCalendarDaysIso(d, -1))} className="rounded-md border p-1.5 hover:bg-accent">
            <ChevronLeft className="h-4 w-4" />
          </button>
          {/* ⚠️ NOT disabled on today. It used to be, which left a coordinator
              who had scrolled off to the morning with no way back to the red
              line short of reloading — and "jump back to now" is the whole
              job this button does once the strip scrolls (Brandon, 2026-09-16:
              "when the page loads, or when you click Today"). */}
          <button
            onClick={() => { setViewDate(today); anchorOnNow(); }}
            title={isToday ? "Jump back to now" : "Go to today"}
            className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent"
          >
            Today
          </button>
          <button aria-label="Next day" onClick={() => setViewDate((d) => addCalendarDaysIso(d, 1))} className="rounded-md border p-1.5 hover:bg-accent">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ⚠️ Said out loud, because the alternative is a strip that reads as
          "nothing booked" on a day that may be full. Calendly is the record
          now, so losing it means losing every welcome call and any intake
          booking the monday mirror never caught. */}
      {calendlyProblem && (
        <p
          role="status"
          className="mt-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {day.available
              ? `Couldn't read Calendly, so this day is showing only the intake calls mirrored onto monday — welcome calls, and any booking the mirror missed, are not here. ${day.error}`
              : "Calendly needs the gateway, which isn't configured in this build — this day is showing only the intake calls mirrored onto monday."}
          </span>
        </p>
      )}

      {/* The strip: one scrolling timeline, hour ticks and blocks together so
          they can never slide out of register. */}
      <div ref={scroller} className="relative mt-2 overflow-x-auto overflow-y-hidden rounded-lg border bg-background">
        <div className="relative" style={{ width: stripPx }}>
          <div className="relative h-5 border-b bg-muted/40">
            {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => {
              const h = DAY_START_HOUR + i;
              return (
                <span
                  key={h}
                  className="absolute top-0 -translate-x-1/2 text-[10px] leading-5 tabular-nums text-muted-foreground"
                  style={{ left: pxFor(h * 60) }}
                >
                  {hourLabel(h)}
                </span>
              );
            })}
          </div>
          <div className="relative" style={{ height: lanes * LANE_PX + 6 }}>
            {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => (
              <div key={i} className="absolute inset-y-0 w-px bg-border/70" style={{ left: pxFor((DAY_START_HOUR + i) * 60) }} aria-hidden />
            ))}
            {nowVisible && (
              <div className="pointer-events-none absolute inset-y-0 z-20 w-px bg-red-500" style={{ left: pxFor(nowMinutes) }} aria-hidden>
                <span className="absolute -left-[3px] -top-[3px] h-[7px] w-[7px] rounded-full bg-red-500" />
              </div>
            )}
            {timed.map(({ c, start, end, lane }) => {
              const past = isToday && end < nowMinutes;
              const soon = isToday && dueForReminder(c, nowMinutes);
              const welcome = c.kind === "welcome";
              const left = pxFor(start);
              // ⚠️ Width is the CALL'S LENGTH, full stop. It is not widened to
              // fit the name — the name truncates instead and the tooltip has
              // it in full.
              const width = Math.max(MIN_BLOCK_PX, (c.durationMin / 60) * PX_PER_HOUR);
              const { first, last } = splitName(c.name);
              return (
                <Block
                  key={c.key}
                  onClick={() => setOpenBooking(c)}
                  title={`${displayTime(c.callTime)}–${displayTime(minutesToHhmm(end))} · ${c.name} · ${welcome ? "welcome call" : "intake call"}`}
                  className={cn(
                    "absolute z-10 flex flex-col items-start justify-start overflow-hidden rounded-md border px-1 py-0.5 text-left",
                    welcome ? COLUMN_ACCENT.welcome.block : COLUMN_ACCENT.intake.block,
                    past && "opacity-50",
                    soon && "ring-2 ring-amber-400",
                  )}
                  style={{ left: Math.min(left, stripPx - width), width, top: 3 + lane * LANE_PX, height: BLOCK_PX }}
                >
                  <span className="w-full truncate text-[9px] font-medium leading-[11px] tabular-nums opacity-70">{shortTime(c.callTime)}</span>
                  <span className="w-full truncate text-[11px] font-semibold leading-[13px]">{first}</span>
                  {last && <span className="w-full truncate text-[11px] leading-[13px]">{last}</span>}
                </Block>
              );
            })}
          </div>
        </div>
      </div>

      {/* Outside the scroller on purpose: a message pinned inside a 3,120px
          timeline is off screen for most of the day's scroll positions. */}
      {!view.total && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          {day.loading ? "Loading…" : isToday ? "No calls booked for today." : "No calls booked for this day."}
        </p>
      )}

      {untimed.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>Booked this day, no time on file:</span>
          {untimed.map((c) => (
            <Block key={c.key} onClick={() => setOpenBooking(c)} className={cn("rounded px-1.5 py-0.5 text-xs font-medium", c.kind === "welcome" ? COLUMN_ACCENT.welcome.block : COLUMN_ACCENT.intake.block)}>
              {c.name}
            </Block>
          ))}
        </p>
      )}

      {/* ⚠️ THE FOOTNOTE IS GONE (Brandon, 2026-09-17: "Delete 'Times are
          Eastern, read live from Calendly. The 10-minute reminder goes to the
          person who holds this role. Welcome calls, and any booking made under
          an address the board doesn't hold, don't raise one.'").
          What it said was true and is still true — the reminder
          (`ScheduledCallHost`) reads the monday MIRROR and is intake-only, so a
          welcome call, or an intake booking made under an address the board
          doesn't hold, appears on this strip and raises nothing. §5.15's rule
          for that gap is "fix the copy, not the gate", and this deletes the
          copy. It is his screen and he reads it every day; the gap is recorded
          in CLAUDE.md §5.30c instead of on the page. Do not re-add it without
          asking him. */}

      <BookingDetailsDialog
        entry={openBooking}
        onOpenChange={(v) => { if (!v) setOpenBooking(null); }}
        onOpenProfile={(href) => { setOpenBooking(null); onOpen(href); }}
        /* Closed on the way through, like Open profile: the attempt form the
           page raises replaces this popup rather than stacking on it. */
        onLogAttempt={onLogAttempt ? (e) => { setOpenBooking(null); onLogAttempt(e); } : undefined}
      />
    </section>
  );
}

/** Minutes past midnight back to the HH:mm `displayTime` reads. */
function minutesToHhmm(mins: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(mins)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * A block. ALWAYS clickable from 2026-09-17, because clicking now opens the
 * popup rather than navigating.
 *
 * ⚠️ That is the change: it used to render as an inert `<span>` whenever the
 * booking matched no board row, since there was no chart to send anybody to and
 * guessing one is worse than not linking (§5.15). Under a popup the unmatched
 * case is the one most worth opening — it is where the coordinator finds the
 * name and email to work out who booked and under what address — so the block
 * opens and the popup's own button is what greys out.
 */
function Block({
  onClick, className, style, title, children,
}: {
  onClick: () => void;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className={cn(className, "hover:brightness-95")} style={style} title={title}>
      {children}
    </button>
  );
}
