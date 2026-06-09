import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface CollapsiblePanelProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  badge?: string | number;
  accent?: "blue" | "teal" | "violet" | "amber" | "emerald" | "slate";
}

const accentStyles: Record<string, { border: string; headerBg: string; chevron: string }> = {
  blue:    { border: "border-l-blue-400",    headerBg: "bg-blue-50/50",    chevron: "text-blue-400" },
  teal:    { border: "border-l-teal-400",    headerBg: "bg-teal-50/50",    chevron: "text-teal-400" },
  violet:  { border: "border-l-violet-400",  headerBg: "bg-violet-50/50",  chevron: "text-violet-400" },
  amber:   { border: "border-l-amber-400",   headerBg: "bg-amber-50/50",   chevron: "text-amber-400" },
  emerald: { border: "border-l-emerald-400", headerBg: "bg-emerald-50/50", chevron: "text-emerald-400" },
  slate:   { border: "border-l-slate-300",   headerBg: "bg-muted/20",      chevron: "text-muted-foreground" },
};

export function CollapsiblePanel({
  title,
  defaultOpen = true,
  children,
  badge,
  accent = "slate",
}: CollapsiblePanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const styles = accentStyles[accent];

  return (
    <div
      className={cn(
        "rounded-xl border border-sidebar-border bg-card shadow-card overflow-hidden",
        "border-l-4",
        styles.border,
      )}
    >
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className={cn(
          "w-full flex items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-muted/40 cursor-pointer",
          styles.headerBg,
          isOpen && "border-b border-sidebar-border",
        )}
      >
        <ChevronDown
          className={cn(
            "h-5 w-5 transition-transform shrink-0",
            styles.chevron,
            !isOpen && "-rotate-90",
          )}
        />
        <span className="font-heading text-base font-bold tracking-tight text-foreground flex-1">
          {title}
        </span>
        {badge !== undefined && (
          <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-primary/10 text-primary">
            {badge}
          </span>
        )}
      </button>
      {isOpen && <div className="px-6 py-5">{children}</div>}
    </div>
  );
}
