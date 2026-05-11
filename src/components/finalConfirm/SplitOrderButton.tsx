import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Split, AlertCircle } from "lucide-react";
import type { Patient } from "@/lib/finalConfirm/workflow";
import {
  isSplitEligible,
  describeSplitEligibility,
  determineOriginalSide,
} from "@/lib/finalConfirm/workflow";

interface Props {
  patient: Patient;
  /**
   * Runs the split: duplicate the Monday item, apply opposite "Not Serving"
   * overrides to each half, and surface the new item in the sidebar.
   * Returns once both sides are in local state and ready to review.
   */
  onSplit: () => Promise<void>;
  disabled?: boolean;
}

export function SplitOrderButton({ patient, onSplit, disabled }: Props) {
  const [splitting, setSplitting] = useState(false);
  const eligible = isSplitEligible(patient);
  const hint = describeSplitEligibility(patient);
  const originalSide = determineOriginalSide(patient);

  const handleClick = async () => {
    if (!eligible || splitting) return;
    setSplitting(true);
    try {
      await onSplit();
    } finally {
      setSplitting(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        onClick={handleClick}
        disabled={disabled || splitting || !eligible}
        variant="outline"
        className="w-full gap-2 h-11 text-sm font-semibold border-2 border-amber-300 bg-amber-50/60 hover:bg-amber-50 text-amber-900 disabled:opacity-60"
      >
        {splitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Splitting order…
          </>
        ) : (
          <>
            <Split className="h-4 w-4" /> Split Order into Two Profiles
          </>
        )}
      </Button>

      <p
        className={
          "text-[11px] leading-snug px-1 flex items-start gap-1.5 " +
          (eligible ? "text-amber-700" : "text-muted-foreground")
        }
      >
        <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
        <span>
          {hint}
          {eligible && (
            <>
              {" "}
              <span className="font-semibold">
                This item will become the {originalSide === "supplies" ? "Supplies" : "Sensors"} profile;
                a new {originalSide === "supplies" ? "Sensors" : "Supplies"} profile will be created.
              </span>
            </>
          )}
        </span>
      </p>
    </div>
  );
}
