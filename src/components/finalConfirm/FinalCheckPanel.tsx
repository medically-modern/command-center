/**
 * Final Profile Confirmation — findings panel.
 *
 * Renders the check-pack results above the patient card. Purely advisory:
 * nothing here gates anything. Zero findings collapses to a slim green
 * "all checks passed" strip.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { CheckFinding, CheckSeverity } from "@/lib/finalConfirm/checkPack";
import { countFindings } from "@/lib/finalConfirm/checkPack";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Info,
  ShieldAlert,
} from "lucide-react";

const SEVERITY_STYLE: Record<
  CheckSeverity,
  { row: string; icon: string; badge: string; label: string }
> = {
  red: {
    row: "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800/40",
    icon: "text-red-600",
    badge: "bg-red-600 text-white",
    label: "Review",
  },
  amber: {
    row: "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40",
    icon: "text-amber-600",
    badge: "bg-amber-500 text-white",
    label: "Verify",
  },
  info: {
    row: "bg-blue-50/60 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800/40",
    icon: "text-blue-600",
    badge: "bg-blue-500 text-white",
    label: "FYI",
  },
};

function SeverityIcon({ severity, className }: { severity: CheckSeverity; className?: string }) {
  if (severity === "red") return <AlertOctagon className={className} />;
  if (severity === "amber") return <AlertTriangle className={className} />;
  return <Info className={className} />;
}

interface Props {
  findings: CheckFinding[];
}

export function FinalCheckPanel({ findings }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const counts = countFindings(findings);
  const actionable = counts.red + counts.amber;

  if (findings.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-950/20 px-4 py-3 flex items-center gap-2.5">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
        <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
          All profile checks passed — nothing flagged.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card shadow-card overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full px-4 py-3 flex items-center gap-2.5 text-left hover:bg-muted/40 transition-colors"
      >
        <ShieldAlert className={cn("h-5 w-5 shrink-0", actionable > 0 ? "text-amber-600" : "text-blue-600")} />
        <span className="text-sm font-semibold flex-1">
          Profile checks — {findings.length} finding{findings.length === 1 ? "" : "s"}
        </span>
        <span className="flex items-center gap-1.5">
          {counts.red > 0 && (
            <span className={cn("text-[11px] font-bold rounded-full px-2 py-0.5", SEVERITY_STYLE.red.badge)}>
              {counts.red}
            </span>
          )}
          {counts.amber > 0 && (
            <span className={cn("text-[11px] font-bold rounded-full px-2 py-0.5", SEVERITY_STYLE.amber.badge)}>
              {counts.amber}
            </span>
          )}
          {counts.info > 0 && (
            <span className={cn("text-[11px] font-bold rounded-full px-2 py-0.5", SEVERITY_STYLE.info.badge)}>
              {counts.info}
            </span>
          )}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", collapsed && "-rotate-90")} />
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-1.5">
          {findings.map((f, i) => {
            const s = SEVERITY_STYLE[f.severity];
            return (
              <div
                key={`${f.id}-${i}`}
                className={cn("rounded-lg border px-3 py-2 flex items-start gap-2.5", s.row)}
              >
                <SeverityIcon severity={f.severity} className={cn("h-4 w-4 shrink-0 mt-0.5", s.icon)} />
                <div className="min-w-0">
                  <p className="text-xs font-bold leading-tight">
                    {f.title}
                    <span className="ml-2 font-normal text-[10px] uppercase tracking-wider opacity-60">
                      {s.label} · {f.id.split("_")[0]}
                    </span>
                  </p>
                  <p className="text-xs mt-0.5 opacity-90">{f.detail}</p>
                </div>
              </div>
            );
          })}
          <p className="text-[11px] text-muted-foreground pt-1 px-1">
            Advisory only — these never block sending. Red/amber items ask for a quick
            confirm at Send; overrides are noted in the patient's Notes.
          </p>
        </div>
      )}
    </div>
  );
}
