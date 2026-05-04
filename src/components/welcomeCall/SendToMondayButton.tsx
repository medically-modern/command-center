import { useEffect, useState } from "react";
import { Check, Loader2, Send, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type State = "idle" | "sending" | "success" | "error";

interface Props {
  onSend: () => Promise<void>;
  disabled?: boolean;
  validationErrors?: string[];
}

export function SendToMondayButton({ onSend, disabled, validationErrors = [] }: Props) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);

  // Auto-revert success/error back to idle after a beat
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
    idle: {
      label: "Send to Monday",
      icon: <Send className="h-4 w-4" />,
      className: "bg-emerald-600 hover:bg-emerald-700 text-white",
    },
    sending: {
      label: "Sending to Monday…",
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      className: "bg-amber-500 hover:bg-amber-500 text-white",
    },
    success: {
      label: "Successfully sent to Monday",
      icon: <Check className="h-4 w-4 animate-scale-in" />,
      className: "bg-emerald-600 hover:bg-emerald-600 text-white ring-4 ring-emerald-300/60",
    },
    error: {
      label: "Send failed — click to retry",
      icon: <AlertTriangle className="h-4 w-4" />,
      className: "bg-red-600 hover:bg-red-700 text-white",
    },
  }[state];

  const hasValidationErrors = validationErrors.length > 0;

  const button = (
    <Button
      onClick={handleClick}
      disabled={disabled || state === "sending"}
      title={error ?? config.label}
      size="lg"
      className={cn(
        "gap-2 shadow-elevate rounded-full px-8 h-12 text-base font-semibold transition-all duration-300",
        state === "success" && "animate-fade-in",
        config.className,
      )}
    >
      {config.icon}
      <span>{config.label}</span>
    </Button>
  );

  return (
    <div className="flex flex-col items-center gap-2 pt-2">
      {hasValidationErrors && disabled ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>{button}</span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p className="font-semibold text-xs mb-1">Required before sending:</p>
              <ul className="text-xs space-y-0.5">
                {validationErrors.map((err, i) => (
                  <li key={i}>• {err}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        button
      )}
    </div>
  );
}
