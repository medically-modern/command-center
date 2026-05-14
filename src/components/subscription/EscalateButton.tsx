import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  escalated: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export function EscalateButton({ escalated, onToggle, disabled }: Props) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex items-center gap-3">
        <Button
          onClick={onToggle}
          disabled={disabled}
          variant="outline"
          className={
            escalated
              ? "gap-2 bg-red-100 hover:bg-red-200 !text-red-600 border-red-400 shadow-md hover:animate-shake"
              : "gap-2 border-red-300 !text-red-600 hover:bg-red-50 hover:animate-shake"
          }
        >
          <AlertTriangle className="h-4 w-4" />
          {escalated ? "Escalation Required" : "Escalate"}
        </Button>
      </div>
      {escalated && (
        <p className="text-[11px] text-red-500 pl-1">
          Please include the reason for escalation in the Notes tab.
        </p>
      )}
    </div>
  );
}
