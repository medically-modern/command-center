/**
 * EscalateButton — sets the Escalation column on Monday to
 * "Escalation Required" (index 0) for the given patient.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { writeStatusIndex, COL } from "@/lib/masheke/mondayApi";
import { toast } from "sonner";

type State = "idle" | "sending" | "success" | "error";

interface Props {
  patientId: string;
  patientName: string;
  disabled?: boolean;
}

export function EscalateButton({ patientId, patientName, disabled }: Props) {
  const [state, setState] = useState<State>("idle");

  useEffect(() => {
    if (state === "success" || state === "error") {
      const t = setTimeout(() => setState("idle"), 2500);
      return () => clearTimeout(t);
    }
  }, [state]);

  const handleClick = async () => {
    if (state === "sending") return;
    setState("sending");
    try {
      await writeStatusIndex(patientId, COL.escalation, 0);
      setState("success");
      toast.success(`${patientName} flagged as Escalation Required`);
    } catch (e) {
      console.error("[EscalateButton] write failed:", e);
      setState("error");
      toast.error("Failed to set escalation — click to retry");
    }
  };

  return (
    <Button
      onClick={handleClick}
      disabled={disabled || state === "sending"}
      size="lg"
      variant="outline"
      className={
        state === "success"
          ? "gap-2 border-emerald-400 text-emerald-700 bg-emerald-50 hover:bg-emerald-50"
          : state === "error"
            ? "gap-2 border-red-400 text-red-700 bg-red-50 hover:bg-red-100"
            : "gap-2 border-orange-400 text-orange-700 bg-orange-50 hover:bg-orange-100"
      }
    >
      {state === "sending" ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Escalating…
        </>
      ) : state === "success" ? (
        <>
          <Check className="h-4 w-4" />
          Escalated
        </>
      ) : state === "error" ? (
        <>
          <AlertTriangle className="h-4 w-4" />
          Retry Escalate
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
