import type { Patient } from "@/lib/profile/workflow";
import {
  suggestPrimary, suggestSecondary, buildSuggestionInputs,
} from "@/lib/profile/primaryInsurance";
import { PRIMARY_INSURANCE_INDEX, SECONDARY_INSURANCE_INDEX } from "@/lib/profile/mondayMapping";
import { Button } from "@/components/ui/button";
import { Lightbulb, AlertTriangle, Check } from "lucide-react";

interface Props {
  patient: Patient;
  onUpdate: (patch: Partial<Patient>) => void;
}

/**
 * Advisory Primary/Secondary suggestion card. Reads the Stedi output, runs the
 * suggestion engine, and lets the rep apply a suggested value with one click.
 * The rep's confirmed choice (the dropdowns below) is what actually writes to
 * Monday — this only proposes. Renders nothing until Stedi has returned.
 */
export function InsuranceSuggestions({ patient, onUpdate }: Props) {
  const inputs = buildSuggestionInputs(patient);
  const primary = suggestPrimary(inputs);
  if (!primary) return null; // Stedi not done yet

  const secondary = suggestSecondary(inputs);
  const primaryIsApplicable = !!primary.value && primary.value in PRIMARY_INSURANCE_INDEX;
  const secondaryIsApplicable = !!secondary && secondary in SECONDARY_INSURANCE_INDEX;
  const primaryMatches = !!primary.value && patient.primaryInsurance === primary.value;
  const secondaryMatches = !!secondary && patient.secondaryInsurance === secondary;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 space-y-3">
      <div className="flex items-center gap-2 text-amber-800">
        <Lightbulb className="h-4 w-4" />
        <span className="text-xs font-semibold uppercase tracking-wider">Suggested from Stedi</span>
        <span className="text-[10px] text-amber-600/80">advisory — confirm below</span>
      </div>

      {/* Primary suggestion */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">Primary:</span>
        {primary.value ? (
          <>
            <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-800 px-3 py-1 text-sm font-semibold">
              {primary.value}
            </span>
            {primaryIsApplicable && !primaryMatches && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                onClick={() => onUpdate({ primaryInsurance: primary.value! })}
              >
                <Check className="h-3.5 w-3.5" /> Use
              </Button>
            )}
            {primaryMatches && <span className="text-xs text-emerald-600 font-medium">✓ selected</span>}
            {!primaryIsApplicable && (
              <span className="text-xs text-muted-foreground">— pick the matching option below</span>
            )}
          </>
        ) : (
          <span className="text-sm text-muted-foreground">{primary.reason || "Check the card"}</span>
        )}
        {primary.reason && primary.value && (
          <span className="text-xs text-muted-foreground">· {primary.reason}</span>
        )}
      </div>

      {/* Secondary suggestion */}
      {secondary && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">Secondary:</span>
          <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-800 px-3 py-1 text-sm font-semibold">
            {secondary}
          </span>
          {secondaryIsApplicable && !secondaryMatches && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              onClick={() => onUpdate({ secondaryInsurance: secondary })}
            >
              <Check className="h-3.5 w-3.5" /> Use
            </Button>
          )}
          {secondaryMatches && <span className="text-xs text-emerald-600 font-medium">✓ selected</span>}
        </div>
      )}

      {/* Warnings */}
      {primary.warnings.length > 0 && (
        <div className="space-y-1">
          {primary.warnings
            .filter((w) => !["POS_11", "OUT_OF_STATE", "ADDRESS_UNRESOLVED"].includes(w.code))
            .map((w) => (
              <div key={w.code} className="flex items-start gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{w.message}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
