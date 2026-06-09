import { cn } from "@/lib/utils";

interface StepSectionProps {
  step: number;
  title: string;
  hint?: string;
  complete?: boolean;
  rightAccessory?: React.ReactNode;
  children: React.ReactNode;
  /** Accent color for the step badge and left border. Defaults to primary blue. */
  accent?: "blue" | "teal" | "violet" | "amber" | "emerald" | "rose";
}

const accentMap = {
  blue:    { badge: "bg-blue-100 text-blue-700 border-blue-300",    border: "border-l-blue-400",    headerBg: "bg-blue-50/50" },
  teal:    { badge: "bg-teal-100 text-teal-700 border-teal-300",    border: "border-l-teal-400",    headerBg: "bg-teal-50/50" },
  violet:  { badge: "bg-violet-100 text-violet-700 border-violet-300", border: "border-l-violet-400", headerBg: "bg-violet-50/50" },
  amber:   { badge: "bg-amber-100 text-amber-700 border-amber-300", border: "border-l-amber-400",   headerBg: "bg-amber-50/50" },
  emerald: { badge: "bg-emerald-100 text-emerald-700 border-emerald-300", border: "border-l-emerald-400", headerBg: "bg-emerald-50/50" },
  rose:    { badge: "bg-rose-100 text-rose-700 border-rose-300",    border: "border-l-rose-400",    headerBg: "bg-rose-50/50" },
};

export function StepSection({
  step,
  title,
  hint,
  complete,
  rightAccessory,
  children,
  accent = "blue",
}: StepSectionProps) {
  const colors = accentMap[accent];

  return (
    <div className={cn(
      "rounded-xl border border-border bg-card shadow-card overflow-hidden",
      "border-l-4", colors.border,
    )}>
      {/* ── Header bar ── */}
      <div className={cn("border-b border-border px-6 py-4", colors.headerBg)}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 min-w-0">
            <div
              className={cn(
                "h-10 w-10 rounded-full flex items-center justify-center text-base font-bold shrink-0 border-2",
                complete
                  ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                  : colors.badge,
              )}
            >
              {complete ? "✓" : step}
            </div>
            <div className="min-w-0">
              <h3 className="font-heading text-lg font-bold tracking-tight text-foreground">
                {title}
              </h3>
              {hint && (
                <p className="text-sm text-muted-foreground mt-0.5">{hint}</p>
              )}
            </div>
          </div>
          {rightAccessory}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="px-6 py-5">
        {children}
      </div>
    </div>
  );
}
