/**
 * EscalateButton — local toggle that flips between "Escalate" and
 * "Escalated".  Does NOT write to Monday on its own — the parent
 * panel checks `escalated` and includes the write in the batched
 * Send-to-Monday / Save-Attempt call.
 */
import { AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  escalated: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export function EscalateButton({ escalated, onToggle, disabled }: Props) {
  return (
    <Button
      onClick={onToggle}
      disabled={disabled}
      size="lg"
      variant="outline"
      className={
        escalated
          ? "gap-2 border-red-500 bg-red-100 text-red-800 hover:bg-red-200 hover:text-black"
          : "gap-2 border-red-400 bg-red-50 text-red-700 hover:bg-red-100 hover:text-black"
      }
    >
      {escalated ? (
        <>
          <Check className="h-4 w-4" />
          Escalated
        </>
      ) : (
        <>
          <AlertTriangle className="h-4 w-4" />
          Escalate
        </>
      )}
    </Button>
  );
}
