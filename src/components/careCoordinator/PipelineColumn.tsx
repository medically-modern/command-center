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
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  progressLabel, progressPercent, type LoadProgress,
} from "@/lib/careCoordinator/loadProgress";
import type { ColumnSummary, Horizon } from "@/lib/careCoordinator/workflow";

const PAGE = 12;

/** The two greens (Brandon: "2 diff shaded colors of green (med mod colors)"). */
const SECTION_TONE = {
  scheduled: "bg-[color:var(--mm-green-12)] border-[color:var(--mm-mint-ring)]",
  unscheduled: "bg-[color:var(--mm-mint)] border-[color:var(--mm-mint-ring)]",
} as const;

export function Section({
  title, count, children, defaultOpen = true, tone, extra,
}: {
  title: string;
  count: number;
  children: ReactNode[];
  defaultOpen?: boolean;
  tone: keyof typeof SECTION_TONE;
  /** A control on the header row — the Scheduled section's today/tomorrow+ switch. */
  extra?: ReactNode;
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
      <div className={cn("flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5", SECTION_TONE[tone])}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          <span className="text-[12px] font-bold uppercase tracking-[0.15em]">{title}</span>
          <span className="rounded-full bg-foreground/80 px-1.5 text-[10px] font-semibold text-background tabular-nums">{count}</span>
        </button>
        {extra}
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
  title, accent, summary, horizon, onHorizon, children, footer, progress, notice,
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
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-2xl border bg-muted/50 p-3 sm:p-4 dark:bg-muted/20" aria-label={title}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
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
