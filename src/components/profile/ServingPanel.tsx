import { useEffect } from "react";
import type { Patient } from "@/lib/profile/workflow";
import { canCrossSellCgm, crossSellReason, deriveServing } from "@/lib/profile/workflow";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  REFERRAL_TYPE_INDEX, REFERRAL_SOURCE_INDEX,
  REQUEST_TYPE_INDEX, SERVING_INDEX, PUMP_TYPE_INDEX,
  CGM_TYPE_INDEX, CGM_CROSS_SELL_INDEX,
  INSULIN_PUMP_COVERAGE_PATH_INDEX, CGM_COVERAGE_PATH_INDEX,
} from "@/lib/profile/mondayMapping";
import { AlertTriangle, CheckCircle2, XCircle, Shield, ArrowRight } from "lucide-react";

interface Props {
  patient: Patient;
  onUpdate: (patch: Partial<Patient>) => void;
  onNext?: () => void;
}

interface StatusFieldConfig {
  field: keyof Patient;
  label: string;
  indexMap: Record<string, number>;
}

function StatusSelect({ value, config, onChange, hint, required }: {
  value: string; config: StatusFieldConfig; onChange: (v: string) => void; hint?: string; required?: boolean;
}) {
  const isFilled = !!value && value !== "Select…";
  const borderClass = required
    ? isFilled
      ? "border-green-400 ring-1 ring-green-200"
      : "border-red-400 ring-1 ring-red-200"
    : "";
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        {config.label}
        {required && !isFilled && <span className="text-red-500 text-xs">*</span>}
      </Label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className={borderClass}><SelectValue placeholder="Select…" /></SelectTrigger>
        <SelectContent>
          {Object.keys(config.indexMap).map((l) => (
            <SelectItem key={l} value={l}>{l}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && <p className="text-xs text-blue-600">{hint}</p>}
    </div>
  );
}

/**
 * Build the small blue explanation under the Cross-Sell dropdown based on
 * the auto-evaluated reason. Manual / "Already Serving CGM" → no hint.
 */
function crossSellHint(crossSellStatus: string, primaryIns: string): string | null {
  const reason = crossSellReason(primaryIns);
  if (crossSellStatus === "Cross-Sell" && reason === "eligible") {
    return "Primary insurance is a non-Medicaid plan, so this patient is eligible for CGM cross-sell";
  }
  if (crossSellStatus === "Couldn't Cross-Sell") {
    if (reason === "medicaid") return "Primary insurance is a Medicaid plan";
    if (reason === "united") return "Primary insurance is United, so we choose not to cross-sell United patients";
    if (reason === "cigna") return "Primary insurance is Cigna, so we choose not to cross-sell Cigna patients";
  }
  return null;
}

export function ServingPanel({ patient, onUpdate, onNext }: Props) {
  const crossSellStatus = patient.cgmCrossSell;
  const primaryIns = patient.primaryInsurance;
  const requestType = patient.requestType;

  // Re-derive cross-sell whenever primary insurance changes.
  // Skip the patient if Janelle has manually marked Already Serving CGM —
  // that's a fact about the patient, not insurance-derived, and shouldn't
  // be overwritten on insurance edits.
  useEffect(() => {
    if (!primaryIns) return;
    if (crossSellStatus === "Already Serving CGM") return;

    const eligible = canCrossSellCgm(primaryIns);
    onUpdate({
      cgmCrossSell: eligible ? "Cross-Sell" : "Couldn't Cross-Sell",
      cgmType: eligible ? "Dexcom G7" : "Not Serving",
      cgmCoveragePath: eligible ? "Insulin" : "Not Serving",
    });
  }, [primaryIns]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-derive Serving from cross-sell + request type
  useEffect(() => {
    if (!crossSellStatus || !requestType) return;
    const derived = deriveServing(crossSellStatus, requestType);
    if (derived && derived !== patient.serving) {
      onUpdate({ serving: derived });
    }
  }, [crossSellStatus, requestType]); // eslint-disable-line react-hooks/exhaustive-deps

  const isCrossSellEligible = crossSellStatus === "Cross-Sell";
  const isCrossSellBlocked = crossSellStatus === "Couldn't Cross-Sell";
  const xsellHint = crossSellHint(crossSellStatus, primaryIns);
  const cgmTypeHint = isCrossSellEligible
    ? "All cross-sells default to Dexcom G7"
    : isCrossSellBlocked
      ? "Not cross-selling"
      : undefined;
  const cgmCoveragePathHint = isCrossSellEligible
    ? "All cross-sells are insulin injecting"
    : isCrossSellBlocked
      ? "Not cross-selling"
      : undefined;

  return (
    <div className="space-y-5">
      {/* Primary + Secondary Insurance summary (carried over from Stedi tab) */}
      <Card className="shadow-card border-blue-200 bg-blue-50/40">
        <CardContent className="pt-5 pb-4 space-y-2">
          {/* Primary row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <Shield className="h-4 w-4 text-blue-600 shrink-0" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Primary
            </span>
            <span className="font-semibold text-foreground">
              {patient.primaryInsurance || (
                <span className="text-amber-600">Not selected — set on Stedi tab</span>
              )}
            </span>
            {patient.memberId1 && (
              <span className="text-xs text-muted-foreground">
                · Member ID {patient.memberId1}
              </span>
            )}
          </div>

          {/* Secondary row — only when present */}
          {patient.secondaryInsurance && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm pt-2 border-t border-blue-200/70">
              <Shield className="h-4 w-4 text-blue-600/60 shrink-0" />
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Secondary
              </span>
              <span className="font-semibold text-foreground">
                {patient.secondaryInsurance}
              </span>
              {patient.memberId2 && (
                <span className="text-xs text-muted-foreground">
                  · Member ID {patient.memberId2}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 1: Referral */}
      <Card className="shadow-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Referral</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <StatusSelect
              value={patient.referralType}
              config={{ field: "referralType", label: "Referral Type", indexMap: REFERRAL_TYPE_INDEX }}
              onChange={(v) => onUpdate({ referralType: v })}
            />
            <StatusSelect
              value={patient.referralSource}
              config={{ field: "referralSource", label: "Referral Source", indexMap: REFERRAL_SOURCE_INDEX }}
              onChange={(v) => onUpdate({ referralSource: v })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Section 2: CGM Cross-Sell */}
      <Card className="shadow-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">CGM Cross-Sell</CardTitle>
            {crossSellStatus && (
              <Badge
                variant="outline"
                className={
                  crossSellStatus === "Cross-Sell"
                    ? "border-green-400 bg-green-50 text-green-700"
                    : crossSellStatus === "Couldn't Cross-Sell"
                      ? "border-red-400 bg-red-50 text-red-700"
                      : crossSellStatus === "Already Serving CGM"
                        ? "border-blue-400 bg-blue-50 text-blue-700"
                        : "border-amber-400 bg-amber-50 text-amber-700"
                }
              >
                {crossSellStatus === "Cross-Sell" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                {crossSellStatus === "Couldn't Cross-Sell" && <XCircle className="h-3 w-3 mr-1" />}
                {crossSellStatus === "Evaluate" && <AlertTriangle className="h-3 w-3 mr-1" />}
                {crossSellStatus}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <StatusSelect
            value={patient.cgmCrossSell}
            config={{ field: "cgmCrossSell", label: "Cross-Sell Status", indexMap: CGM_CROSS_SELL_INDEX }}
            onChange={(v) => onUpdate({ cgmCrossSell: v })}
            hint={xsellHint ?? undefined}
            required
          />

          {crossSellStatus === "Evaluate" && !primaryIns && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              Set Primary Insurance on the Stedi tab to auto-evaluate cross-sell eligibility
            </p>
          )}
        </CardContent>
      </Card>

      {/* Section 3: Request & Serving + Pump/CGM Type */}
      <Card className="shadow-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Request &amp; Serving</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <StatusSelect
              value={patient.requestType}
              config={{ field: "requestType", label: "Request Type", indexMap: REQUEST_TYPE_INDEX }}
              onChange={(v) => onUpdate({ requestType: v })}
            />
            <StatusSelect
              value={patient.serving}
              config={{ field: "serving", label: "Serving", indexMap: SERVING_INDEX }}
              onChange={(v) => onUpdate({ serving: v })}
              required
            />
            <StatusSelect
              value={patient.pumpType}
              config={{ field: "pumpType", label: "Pump Type", indexMap: PUMP_TYPE_INDEX }}
              onChange={(v) => onUpdate({ pumpType: v })}
            />
            <StatusSelect
              value={patient.cgmType}
              config={{ field: "cgmType", label: "CGM Type", indexMap: CGM_TYPE_INDEX }}
              onChange={(v) => onUpdate({ cgmType: v })}
              hint={cgmTypeHint}
            />
          </div>
        </CardContent>
      </Card>

      {/* Section 4: Coverage Paths */}
      <Card className="shadow-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Coverage Paths</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <StatusSelect
              value={patient.insulinPumpCoveragePath}
              config={{ field: "insulinPumpCoveragePath", label: "Insulin Pump Coverage Path", indexMap: INSULIN_PUMP_COVERAGE_PATH_INDEX }}
              onChange={(v) => onUpdate({ insulinPumpCoveragePath: v })}
              required
            />
            <StatusSelect
              value={patient.cgmCoveragePath}
              config={{ field: "cgmCoveragePath", label: "CGM Coverage Path", indexMap: CGM_COVERAGE_PATH_INDEX }}
              onChange={(v) => onUpdate({ cgmCoveragePath: v })}
              hint={cgmCoveragePathHint}
              required
            />
          </div>
        </CardContent>
      </Card>

      {/* Next button → Doctor tab */}
      {onNext && (
        <div className="flex justify-end pt-2">
          <Button onClick={onNext} className="gap-2 bg-gradient-primary shadow-elevate">
            Next: Doctor
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
