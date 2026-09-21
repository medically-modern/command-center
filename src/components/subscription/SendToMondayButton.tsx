import { useEffect, useState } from "react";
import { Check, Loader2, Send, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type State = "idle" | "sending" | "success" | "error";

interface Props {
  onSend: () => Promise<void>;
  disabled?: boolean;
  validationErrors?: string[];
  /**
   * ⚠️ **Opt-in, and the existing caller is byte-identical without it.** The
   * patient screen (§5.45b) carries this button inside a one-line dirty bar
   * rather than at the foot of a page, where a 48px pill would be the tallest
   * thing in the row. Every STATE is unchanged — idle · sending · success ·
   * retry-on-error — and so is the validation list, because a greyed-out
   * control with no stated reason is the dead end this codebase records
   * reversing (§5.31b). Only the size moves.
   */
  compact?: boolean;
}

export function SendToMondayButton({ onSend, disabled, validationErrors = [], compact = false }: Props) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state === "success" || state === "error") {
      const t = setTimeout(() => setState("idle"), 2200);
      return () => clearTimeout(t);
    }
  }, [state]);

  const handleClick = async () => {
    if (state === "sending") return;
    setState("sending");
    setError(null);
    try {
      await onSend();
      setState("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  };

  const config = {
    idle: { label: "Send to Monday", icon: <Send className="h-4 w-4" />, className: "bg-emerald-600 hover:bg-emerald-700 text-white" },
    sending: { label: "Sending to Monday…", icon: <Loader2 className="h-4 w-4 animate-spin" />, className: "bg-amber-500 hover:bg-amber-500 text-white" },
    success: { label: "Successfully sent to Monday", icon: <Check className="h-4 w-4 animate-scale-in" />, className: "bg-emerald-600 hover:bg-emerald-600 text-white ring-4 ring-emerald-300/60" },
    error: { label: "Send failed — click to retry", icon: <AlertTriangle className="h-4 w-4" />, className: "bg-red-600 hover:bg-red-700 text-white" },
  }[state];

  const hasValidationErrors = validationErrors.length > 0;

  return (
    <div className={cn("flex flex-col gap-2", compact ? "items-start" : "items-center pt-2")}>
      <Button
        onClick={handleClick}
        disabled={disabled || state === "sending"}
        title={error ?? config.label}
        size={compact ? "sm" : "lg"}
        className={cn(
          "gap-2 shadow-elevate font-semibold transition-all duration-300",
          compact ? "rounded-md px-3 h-8 text-xs" : "rounded-full px-8 h-12 text-base",
          state === "success" && "animate-fade-in",
          config.className,
        )}
      >
        {config.icon}
        <span>{config.label}</span>
      </Button>
      {hasValidationErrors && disabled && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 max-w-md text-center">
          <p className="font-semibold text-xs text-red-700 dark:text-red-400 mb-1">Required before sending:</p>
          <ul className="text-xs text-red-600 dark:text-red-400 space-y-0.5">
            {validationErrors.map((err, i) => <li key={i}>• {err}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
