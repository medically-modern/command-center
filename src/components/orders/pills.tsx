/**
 * The status chips the Orders page wears. Colour follows the app's severity
 * language: rose needs a person, amber is a heads-up, sky is in motion,
 * emerald is done, slate is parked, teal is this page's own "to do" tone.
 */
import { cn } from "@/lib/utils";
import type { StockTone, StockVerdict } from "@/lib/welcomeCall/infusionStock";
import { STAGE_LABEL, type CardinalStatus, type OrderStage } from "@/lib/orders/workflow";

import { CARDINAL_TONE, STAGE_TONE, type PillTone } from "./tones";

const TONE: Record<PillTone, string> = {
  teal: "bg-[color:var(--mm-mint)] text-[color:var(--mm-teal)] ring-1 ring-[color:var(--mm-mint-ring)]",
  slate: "bg-slate-100 text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700",
  sky: "bg-sky-100 text-sky-900 ring-1 ring-sky-200 dark:bg-sky-950 dark:text-sky-100 dark:ring-sky-800",
  amber: "bg-amber-100 text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-800",
  emerald: "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-800",
  rose: "bg-rose-100 text-rose-900 ring-1 ring-rose-200 dark:bg-rose-950 dark:text-rose-100 dark:ring-rose-800",
  violet: "bg-violet-100 text-violet-900 ring-1 ring-violet-200 dark:bg-violet-950 dark:text-violet-100 dark:ring-violet-800",
};

export function Pill({
  tone, children, title, size = "md", className,
}: {
  tone: PillTone;
  children: React.ReactNode;
  title?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full font-semibold leading-none whitespace-nowrap",
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StagePill({ stage, size }: { stage: OrderStage; size?: "sm" | "md" }) {
  return <Pill tone={STAGE_TONE[stage]} size={size}>{STAGE_LABEL[stage]}</Pill>;
}

export function CardinalPill({ status, size }: { status: CardinalStatus; size?: "sm" | "md" }) {
  if (status.kind === "none") return null;
  return (
    <Pill tone={CARDINAL_TONE[status.kind]} size={size} title={status.detail || undefined}>
      {status.label}
    </Pill>
  );
}

const STOCK_TONE: Record<StockTone, PillTone> = { green: "emerald", amber: "amber", red: "rose", grey: "slate" };

export function StockPill({ verdict, size = "sm" }: { verdict: StockVerdict; size?: "sm" | "md" }) {
  if (!verdict.label) return null;
  return (
    <Pill tone={STOCK_TONE[verdict.tone]} size={size} title={verdict.detail || undefined}>
      {verdict.label}
    </Pill>
  );
}
