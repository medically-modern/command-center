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

const accentBorder: Record<string, string> = {
  blue: "border-l-blue-400",
  teal: "border-l-teal-400",
  violet: "border-l-violet-400",
  amber: "border-l-amber-400",
  emerald: "border-l-emerald-400",
  slate: "border-l-slate-300",
};

export function CollapsiblePanel({
  title,
  defaultOpen = true,
  children,
  badge,
  accent = "slate",
}: CollapsiblePanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div
      className={cn(
        "rounded-xl border border-sidebar-border bg-card shadow-card overflow-hidden",
        "border-l-4",
        accentBorder[accent],
      )}
    >
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-muted/40 cursor-pointer bg-muted/20 border-b border-sidebar-border"
      >
        <ChevronDown
          className={cn(
            "h-5 w-5 text-muted-foreground transition-transform shrink-0",
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
