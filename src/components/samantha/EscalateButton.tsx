/**
 * Escalate toggle — local-only state. Reflects whether the agent has
 * marked this patient as needing escalation. The flag is written to
 * Monday's Escalation column when the agent clicks "Send to Monday";
 * toggling the button does NOT write anything by itself.
 *
 * Used by Benefits, Submit Auth, and Auth Outstanding pages. Renders
 * centered, just above SendToMondayButton.
 */
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  escalated: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export function EscalateButton({ escalated, onToggle, disabled }: Props) {
  return (
    <div className="flex flex-col items-center gap-1.5">
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
      {escalated && (
        <p className="text-[11px] text-red-500">
          Please include the reason for escalation in the Notes tab.
        </p>
      )}
    </div>
  );
}
