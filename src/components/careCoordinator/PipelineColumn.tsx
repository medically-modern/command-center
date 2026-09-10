/**
 * A column of the dashboard: header, count, an alert pill, and sections.
 *
 * Sections are a plain list with a heading; long ones render a first page and
 * a "Show N more" rather than an inner scroll region, so the schedule grid
 * below the columns stays reachable and the page scrolls like every other
 * page in the app. Closed-by-default sections (the manager's patients, the
 * exhausted shelf) open on click and remember nothing — a reload is a fresh
 * look at the board, which is the posture the whole dashboard takes.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  progressLabel, progressPercent, type LoadProgress,
} from "@/lib/careCoordinator/loadProgress";

const PAGE = 12;

export function Section({
  title, count, children, defaultOpen = true, hint,
}: {
  title: string;
  count: number;
  children: ReactNode[];
  defaultOpen?: boolean;
  /** One line under the heading — what this section is. */
  hint?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [shown, setShown] = useState(PAGE);
  if (count === 0) return null;
  const visible = open ? children.slice(0, shown) : [];
  const more = children.length - visible.length;
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-left"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />}
        <span className="text-[11px] font-bold uppercase tracking-[0.15em]">{title}</span>
        <span className="rounded-full bg-foreground/80 px-1.5 text-[10px] font-semibold text-background">{count}</span>
        {hint && <span className="ml-1 truncate text-[11px] text-muted-foreground">{hint}</span>}
      </button>
      {open && <div className="space-y-2">{visible}</div>}
      {open && more > 0 && (
        <button
          type="button"
          onClick={() => setShown((s) => s + PAGE)}
          className="w-full rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"
        >
          Show {Math.min(more, PAGE)} more · {more} not shown
        </button>
      )}
    </div>
  );
}

export function PipelineColumn({
  title, subtitle, count, alert, alertTone = "bad", tint, children, footer, progress,
}: {
  title: string;
  subtitle: string;
  count: number;
  /** The pill beside the count — "3 overdue", "2 not yet called". Omit for none. */
  alert?: string | null;
  alertTone?: "bad" | "warn";
  /** Column wash, from the mockup: sky · amber · teal. */
  tint: "sky" | "amber" | "teal";
  children: ReactNode;
  /** Small print at the bottom — the honest "what isn't on this screen". */
  footer?: ReactNode;
  /** The read in flight, or null when nothing is loading (or a background poll
   *  is, which deliberately shows nothing). */
  progress?: LoadProgress | null;
}) {
  const wash = {
    sky: "border-sky-200/70 bg-sky-50/40 dark:border-sky-900/50 dark:bg-sky-950/10",
    amber: "border-amber-200/70 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/10",
    teal: "border-teal-200/70 bg-teal-50/40 dark:border-teal-900/50 dark:bg-teal-950/10",
  }[tint];
  return (
    <section className={cn("flex min-w-0 flex-col rounded-2xl border p-3 sm:p-4", wash)} aria-label={title}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-tight">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {alert && (
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                alertTone === "bad"
                  ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
                  : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
              )}
            >
              {alert}
            </span>
          )}
          <span className="rounded-full border bg-background px-2 py-0.5 text-xs font-semibold tabular-nums">{count}</span>
        </div>
      </header>
      {progress && <LoadBar progress={progress} label={title} />}
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
