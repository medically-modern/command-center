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
  title, subtitle, count, alert, alertTone = "bad", tint, children, footer,
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
      <div className="space-y-4">{children}</div>
      {footer && <div className="mt-4 border-t pt-2 text-[11px] leading-relaxed text-muted-foreground">{footer}</div>}
    </section>
  );
}
