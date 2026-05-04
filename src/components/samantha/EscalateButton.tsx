/**
 * Manual Escalate button — flags the Insurance board's Escalation column
 * to "Escalation Required". Used by Benefits, Submit Auth, and Auth
 * Outstanding pages. Renders centered, just above SendToMondayButton.
 */
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { escalatePatient } from "@/lib/samantha/mondayWrite";

interface Props {
  itemId: string | undefined;
  disabled?: boolean;
}

export function EscalateButton({ itemId, disabled }: Props) {
  const [escalating, setEscalating] = useState(false);

  const onClick = async () => {
    if (!itemId || escalating) return;
    setEscalating(true);
    try {
      await escalatePatient(itemId);
      toast.success("Escalation flagged on Monday");
    } catch (e) {
      toast.error("Could not flag escalation", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setEscalating(false);
    }
  };

  return (
    <div className="flex justify-center">
      <Button
        onClick={onClick}
        disabled={!itemId || disabled || escalating}
        variant="outline"
        className="gap-2 border-red-300 !text-red-600 hover:bg-red-50 hover:animate-shake"
      >
        <AlertTriangle className="h-4 w-4" />
        {escalating ? "Escalating…" : "Escalate"}
      </Button>
    </div>
  );
}
