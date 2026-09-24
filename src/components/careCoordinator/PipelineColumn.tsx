/**
 * A column of the dashboard — Brandon's 2026-09-14 shape.
 *
 * Header: the stage name in big letters (no subtitle) and the summary as two
 * groupings, Today and Future, each showing Scheduled and Unscheduled counts.
 * The groupings ARE the toggle: click one to show its lists; Today is the
 * default. A plain gray background on both columns (no stage tint), with a
 * small colour dot beside the title that matches the block colour on the
 * schedule grid above, so the two can be read against each other.
 *
 * Sections: "Scheduled" and "Unscheduled", each collapsible with its total,
 * in two shades of the Medically Modern green, no hint text. Long sections
 * grow as the coordinator scrolls (an IntersectionObserver sentinel) rather
 * than behind a "Show N more" button; where the observer does not exist the
 * button is the fallback, so nothing is ever unreachable.
 *
 * Escalated patients render NOWHERE in a column; the footer counts them and
 * says where they are (Oversight's manager columns).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronRight, MessageSquare, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  progressLabel, progressPercent, type LoadProgress,
} from "@/lib/careCoordinator/loadProgress";
import type { ColumnSummary, Horizon } from "@/lib/careCoordinator/workflow";

const PAGE = 12;

/**
 * The two greens (Brandon: "2 diff shaded colors of green (med mod colors)").
 *
 * Scheduled is the SOLID Medically Modern green with white text from
 * 2026-09-16 — it was the 12% tint, which read as barely distinguishable from
 * Unscheduled. Its count chip has to move with it: `bg-foreground/80
 * text-background` is a dark chip on a light bar, and on solid green it came
 * out as a near-black blob.
 */
/**
 * ⚠️ BOTH tones set their own TEXT colour, and that is not decoration.
 * `--mm-mint` is a near-white (`oklch(0.973 …)`) with no `.dark` override, so a
 * bar that lets the label inherit `text-foreground` renders near-white on
 * near-white in dark mode — the word "UNSCHEDULED" simply vanished, measured
 * 2026-09-16 at `rgb(241,245,248)` on that mint. Every other `--mm-mint` user
 * in the app (`FaxStatusChip`, `orders/pills`, `mmKit`) pairs it with
 * `--mm-teal` for exactly this reason; this one had been the exception.
 */
const SECTION_TONE = {
  scheduled: "bg-[color:var(--mm-green)] text-white border-[color:var(--mm-green)]",
  unscheduled: "bg-[color:var(--mm-mint)] text-[color:var(--mm-teal)] border-[color:var(--mm-mint-ring)]",
  // Review Profile — Patient Intake only. ⚠️ Same rule again: a FIXED pair, not
  // `foreground`/`background`, which invert between themes (§5.30d found the
  // Unscheduled bar unreadable in dark mode for exactly that reason).
  review: "bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-500/15 dark:text-sky-100 dark:border-sky-500/40",
} as const;

const COUNT_TONE = {
  scheduled: "bg-white/25 text-white",
  // Same rule: fixed colours, never `foreground`/`background`, which invert.
  unscheduled: "bg-[color:var(--mm-teal)] text-white",
  review: "bg-sky-600 text-white",
} as const;

export function Section({
  title, count, children, defaultOpen = true, tone,
}: {
  title: string;
  count: number;
  children: ReactNode[];
  defaultOpen?: boolean;
  tone: keyof typeof SECTION_TONE;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [shown, setShown] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  const more = Math.max(0, children.length - shown);

  // Auto-expand on scroll: when the sentinel under the list comes into view,
  // show the next page. Guarded for environments without the observer (jsdom,
  // very old browsers), where the button below does the same job.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !open || more <= 0 || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShown((s) => s + PAGE);
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [open, more, shown]);

  return (
    <div className="space-y-2">
      {/* ⚠️ `min-h` is not decoration: the header used to carry a control on
          one horizon and not the other, so switching Today ↔ Future changed
          this bar's height and the two columns stopped lining up (Brandon,
          2026-09-16). The control is gone, and the floor keeps it that way. */}
      <div className={cn("flex min-h-[34px] w-full items-center gap-2 rounded-md border px-2.5 py-1.5", SECTION_TONE[tone])}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          <span className="text-[12px] font-bold uppercase tracking-[0.15em]">{title}</span>
          <span className={cn("rounded-full px-1.5 text-[10px] font-semibold tabular-nums", COUNT_TONE[tone])}>{count}</span>
        </button>
      </div>
      {open && count === 0 && (
        <div className="rounded-lg border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">Nobody here right now.</div>
      )}
      {open && count > 0 && <div className="space-y-2">{children.slice(0, shown)}</div>}
      {open && more > 0 && (
        <div ref={sentinel}>
          <button
            type="button"
            onClick={() => setShown((s) => s + PAGE)}
            className="w-full rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"
          >
            {more} more — keep scrolling
          </button>
        </div>
      )}
    </div>
  );
}

/** The dot beside the title and the block colour on the grid — one pair. */
export const COLUMN_ACCENT = {
  intake: { dot: "bg-sky-500", block: "border-sky-300 bg-sky-100 text-sky-950 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-100" },
  welcome: { dot: "bg-teal-500", block: "border-teal-300 bg-teal-100 text-teal-950 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-100" },
} as const;

export function PipelineColumn({
  title, accent, summary, horizon, onHorizon, children, footer, progress, notice, controls,
}: {
  title: string;
  accent: keyof typeof COLUMN_ACCENT;
  summary: ColumnSummary;
  horizon: Horizon;
  onHorizon: (h: Horizon) => void;
  children: ReactNode;
  /** Small print at the bottom — the honest "what isn't on this screen". */
  footer?: ReactNode;
  /** The read in flight, or null when nothing is loading (or a background poll
   *  is, which deliberately shows nothing). */
  progress?: LoadProgress | null;
  /** An amber line under the header — a read that could not be completed. */
  notice?: ReactNode;
  /**
   * The Patient Intake column's five-facet filter. Only that column has one.
   *
   * ⚠️⚠️ **IT GETS ITS OWN FIXED-HEIGHT ROW, and riding the legend row is what
   * broke the columns.** The original reasoning (2026-09-16) was sound for the
   * control it was written for — the narrow Partial / Complete / All toggle
   * fitted beside the legend, so one row stayed one row in both columns. The
   * five-facet filter that replaced it on 2026-09-17 (§5.30e) is **454px wide
   * and never wraps internally**, against a 235px legend: measured in a
   * browser 2026-09-18, legend + gap + filter is **701px** while the column is
   * 768 / 688 / 608 / 518 at 1600 / 1440 / 1280 / 1100. So it fitted at 1600
   * and dropped to a second line at every other width, growing this row to
   * 43px in THAT COLUMN ONLY — the section bars sat **17px** out at 1280 and
   * 1100 and **59px** out at 1440. §5.30c's bug for the fourth time, live and
   * unreported because it does not show at the 1600 it was checked at.
   *
   * Its own row with a floor, drawn in BOTH columns (empty on Welcome Call),
   * makes the two heights equal by CONSTRUCTION rather than by fitting — so
   * the next control that is wider than its predecessor cannot do this again.
   */
  controls?: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-2xl border bg-muted/50 p-3 sm:p-4 dark:bg-muted/20" aria-label={title}>
      {/* ⚠️ Stacked by BREAKPOINT, never by content wrap. Side by side the two
          halves need 659px in this column ("Patient Intake" 203 + gap 12 +
          the horizon toggle 444) and 650px in the other one ("Welcome Call" is
          **9px shorter**) — so between roughly 1400 and 1470 the intake header
          wrapped to two lines and the welcome header did not, and every
          section bar below sat **42px** out. Measured 2026-09-18: 87px vs 45px
          at 1440, both 45 at 1500+, both 87 at 1380 and below. A nine-pixel
          difference in two column titles is not something a fitting rule can
          be trusted with, and 1440 is an ordinary laptop width. The explicit
          breakpoint sits above the ~1450 the content needs, so both columns
          are one line together or two lines together — never one each. */}
      <header className="mb-3 flex flex-col gap-3 min-[1500px]:flex-row min-[1500px]:items-start min-[1500px]:justify-between">
        <h3 className="flex items-center gap-2 text-2xl font-bold leading-tight tracking-tight">
          <span className={cn("inline-block h-3 w-3 rounded-full", COLUMN_ACCENT[accent].dot)} aria-hidden />
          {title}
        </h3>
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label={`${title} — Today or Future`}>
          {(["today", "future"] as Horizon[]).map((h) => {
            const s = summary[h];
            const active = horizon === h;
            return (
              <button
                key={h}
                type="button"
                onClick={() => onHorizon(h)}
                aria-pressed={active}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-left transition",
                  active ? "border-foreground bg-background shadow-sm" : "border-transparent bg-background/50 text-muted-foreground hover:bg-background",
                )}
              >
                <div className="text-[10px] font-bold uppercase tracking-[0.15em]">{h === "today" ? "Today" : "Future"}</div>
                <div className="text-xs tabular-nums">
                  Scheduled: <span className="font-semibold">{s.scheduled}</span>
                  <span className="mx-1 opacity-50">·</span>
                  Unscheduled: <span className="font-semibold">{s.unscheduled}</span>
                </div>
              </button>
            );
          })}
        </div>
      </header>
      {/* The legend — the two pieces of state on a card that have no words on
          them. Identical in both columns, so they cannot drift.
          ⚠️ BOTH greens are named. Brandon asked for the edge on 2026-09-14
          and for the counters on 2026-09-17 ("let's have the text and phone
          icon turn a shade of green … and add a legend for that"); the
          counters shipped green with only a tooltip, so a card carried two
          greens meaning different things and the legend explained one. */}
      <div className="mb-2 space-y-0.5 text-[11px] leading-snug text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <i className="inline-block h-3.5 w-1 shrink-0 rounded-sm bg-[color:var(--mm-green)]" aria-hidden />
          Green edge = we have called them
        </p>
        {/* ⚠️ The counters STOPPED being board columns on 2026-09-22, and on
            2026-09-24 they became ALL-TIME counts on ONE line — gray outbound,
            then green inbound, beside the doctor (Brandon: *"bring this up to
            a single line — first have the gray outbound, then next to it have
            the green in-bound"*). So the legend says what each COLOUR counts,
            not which row: there are no rows any more. The arrows still tell
            the two apart, because two identical phone/message pairs side by
            side say nothing on their own. "All time" means since the call and
            text archives began, and each number's hover says since when. */}
        <p className="flex items-center gap-1.5">
          <ArrowUpRight className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
          <Phone className="h-3 w-3 shrink-0" aria-hidden />
          <MessageSquare className="h-3 w-3 shrink-0" aria-hidden />
          Gray = calls and texts we sent, all time
        </p>
        <p className="flex items-center gap-1.5">
          <ArrowDownLeft className="h-3 w-3 shrink-0 text-[color:var(--mm-green)] opacity-70" aria-hidden />
          <Phone className="h-3 w-3 shrink-0 text-[color:var(--mm-green)]" aria-hidden />
          <MessageSquare className="h-3 w-3 shrink-0 text-[color:var(--mm-green)]" aria-hidden />
          Green = calls and texts they sent us
        </p>
      </div>
      {/* Always drawn, floor and all, even with nothing in it — see `controls`. */}
      <div className="mb-3 flex min-h-[30px] w-full min-w-0 items-start">{controls}</div>
      {progress && <LoadBar progress={progress} label={title} />}
      {notice}
      <div className="space-y-4">{children}</div>
      {footer && <div className="mt-4 border-t pt-2 text-[11px] leading-relaxed text-muted-foreground">{footer}</div>}
    </section>
  );
}

/**
 * What is loading, and how close we are.
 *
 * The Patient Intake column is four sequential Monday pages over ~1,754 rows,
 * so it can sit for many seconds looking identical to a broken screen. This
 * says which column is working and how far it has got.
 *
 * ⚠️ **A percentage is only drawn when one can be justified.** Monday reports no
 * total, so the denominator is what the LAST complete run returned; with no
 * memory of one — a first-ever visit, a private window, a cleared store — the
 * bar is an indeterminate sweep and the text is a plain row count. It never
 * invents a number, and it never reads 100% while rows are still arriving
 * (`progressPercent` caps at 99 until the fetch resolves).
 */
function LoadBar({ progress, label }: { progress: LoadProgress; label: string }) {
  const pct = progressPercent(progress);
  const text = progressLabel(progress);
  return (
    <div
      className="mb-3"
      role="progressbar"
      aria-label={`Loading ${label}`}
      // Omitted entirely when indeterminate — that is what the ARIA state for
      // "busy, position unknown" IS, and reporting a made-up 0 would be read
      // aloud as no progress on a load that is running fine.
      aria-valuenow={pct ?? undefined}
      aria-valuemin={pct === null ? undefined : 0}
      aria-valuemax={pct === null ? undefined : 100}
      aria-valuetext={text || undefined}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">Loading {label.toLowerCase()}…</span>
        <span className="shrink-0 tabular-nums">
          {text}
          {pct !== null && <span className="ml-1.5 font-semibold">{pct}%</span>}
        </span>
      </div>
      <div className="relative h-1 overflow-hidden rounded-full bg-foreground/10">
        {pct === null ? (
          // Indeterminate: the app's existing sweep (`burndown-shimmer`, the
          // one DailyBurndown uses while live counts load) rather than a second
          // animation saying the same thing. Visibly WORKING, without claiming
          // a position it does not have.
          <div
            className="burndown-shimmer absolute inset-y-0 w-1/3"
            style={{ background: "linear-gradient(90deg, transparent, hsl(var(--primary)), transparent)" }}
          />
        ) : (
          <div
            className="h-full rounded-full bg-sky-500 transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}
