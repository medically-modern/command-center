import { useState } from "react";
import type { Patient } from "@/lib/profile/workflow";
import { computeFirstAndRecurring } from "@/lib/profile/oopEstimate";
import { writeOopEstimate } from "@/lib/profile/mondayWrite";
import {
  suggestPrimary, suggestSecondary, buildSuggestionInputs, isCoverageActive,
} from "@/lib/profile/primaryInsurance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calculator, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface Props {
  patient: Patient;
  onUpdate: (patch: Partial<Patient>) => void;
}

/**
 * Out-of-Pocket estimate card. Button-triggered after Serving is chosen: the
 * SPA computes First-Order + Recurring (lib/profile/oopEstimate) and writes the
 * two board columns (text_mm4tvsk6 / text_mm4ttaa6), then displays them.
 * CareCentrix referrals still get real values plus a "confirm directly" warning.
 */
export function OopCard({ patient, onUpdate }: Props) {
  const [calculating, setCalculating] = useState(false);

  const inputs = buildSuggestionInputs(patient);
  const stediActive = inputs.stediDone && isCoverageActive(inputs.stedi);
  const primary = patient.primaryInsurance || suggestPrimary(inputs)?.value || "";
  const secondary = patient.secondaryInsurance || suggestSecondary(inputs) || "";
  const isCareCentrix = /carecentrix/i.test(patient.referralSource || "");

  const canCalc = stediActive && !!primary && !!patient.serving;

  const handleCalculate = async () => {
    setCalculating(true);
    try {
      const { first, recurring } = computeFirstAndRecurring({
        serving: patient.serving,
        primaryInsurance: primary,
        secondaryInsurance: secondary,
        stediCoinsurance: patient.workingCoinsurance || patient.stediCoinsurance,
        deductibleRemaining: patient.workingDeductibleRemaining || patient.stediIndividualDeductibleRemaining,
        oopMaxRemaining: patient.workingOopMaxRemaining || patient.stediIndividualOopMaxRemaining,
      });
      await writeOopEstimate(patient.id, first.val, recurring.val);
      onUpdate({ oopFirst: first.val, oopRecurring: recurring.val });
      toast.success("OOP estimate calculated & saved to Monday");
    } catch (e) {
      toast.error("Failed to calculate/save OOP estimate", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setCalculating(false);
    }
  };

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base">Out-of-Pocket Estimate</CardTitle>
          <Button
            onClick={handleCalculate}
            disabled={calculating || !canCalc}
            size="sm"
            className="gap-1.5 bg-gradient-primary shadow-elevate"
            title={!canCalc ? "Run an active Stedi check and pick a Primary Insurance + Serving first" : undefined}
          >
            {calculating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calculator className="h-3.5 w-3.5" />}
            Calculate OOP Estimate
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!canCalc && (
          <p className="text-xs text-muted-foreground">
            {!stediActive
              ? "Run an active benefits check first."
              : !patient.serving
                ? "Select what we're serving (above), then Calculate."
                : "No primary insurance resolved yet."}
          </p>
        )}

        {isCareCentrix && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span><b>CareCentrix referral</b> — confirm the final out-of-pocket with CareCentrix directly. The estimate below is for reference.</span>
          </div>
        )}

        {(patient.oopFirst || patient.oopRecurring) && (
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border bg-emerald-50/50 border-emerald-200 p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">First Order</p>
              <p className="text-2xl font-bold text-emerald-800 mt-1">{patient.oopFirst || "—"}</p>
            </div>
            <div className="rounded-lg border bg-emerald-50/50 border-emerald-200 p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Recurring · 90-day supply</p>
              <p className="text-2xl font-bold text-emerald-800 mt-1">{patient.oopRecurring || "—"}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
