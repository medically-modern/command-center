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
  /** When true, the Referral card is hidden (rendered separately). */
  hideReferral?: boolean;
  /** When true, ONLY the Referral card is rendered (nothing else). */
  referralOnly?: boolean;
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

export function ServingPanel({ patient, onUpdate, onNext, hideReferral, referralOnly }: Props) {
  const crossSellStatus = patient.cgmCrossSell;
  const primaryIns = patient.primaryInsurance;
  const requestType = patient.requestType;

  // Re-derive cross-sell whenever primary insurance OR request type changes.
  // When request type is "Supplies Only" or "Insulin Pump" and insurance
  // is eligible, auto-set cross-sell, CGM type, and CGM coverage path.
  // Skip if Janelle has manually marked Already Serving CGM.
  useEffect(() => {
    if (!primaryIns) return;
    if (crossSellStatus === "Already Serving CGM") return;

    const eligible = canCrossSellCgm(primaryIns);
    const isSuppliesOrPump = requestType === "Supplies Only" || requestType === "Insulin Pump";

    if (eligible && isSuppliesOrPump) {
      // Auto cross-sell: set everything
      onUpdate({
        cgmCrossSell: "Cross-Sell",
        cgmType: "Dexcom G7",
        cgmCoveragePath: "Insulin",
      });
    } else if (eligible) {
      onUpdate({
        cgmCrossSell: "Cross-Sell",
        cgmType: "Dexcom G7",
        cgmCoveragePath: "Insulin",
      });
    } else {
      onUpdate({
        cgmCrossSell: "Couldn't Cross-Sell",
        cgmType: "Not Serving",
        cgmCoveragePath: "Not Serving",
      });
    }
  }, [primaryIns, requestType]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Referral-only mode: just render the Referral card and bail.
  if (referralOnly) {
    return (
      <Card className="shadow-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-bold text-emerald-700">Referral Backdrop</CardTitle>
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
    );
  }

  return (
    <div className="space-y-5">
      {/* Insurance summary */}
      <Card className="shadow-card border-blue-200 bg-blue-50/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-bold text-emerald-700">Insurance Information</CardTitle>
        </CardHeader>
        <CardContent className="pt-2 pb-4 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <Shield className="h-4 w-4 text-blue-600 shrink-0" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Primary</span>
            <span className="font-semibold text-foreground">
              {patient.primaryInsurance || <span className="text-amber-600">Not selected — set on Stedi tab</span>}
            </span>
            {patient.memberId1 && <span className="text-xs text-muted-foreground">· Member ID {patient.memberId1}</span>}
          </div>
          {patient.secondaryInsurance && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm pt-2 border-t border-blue-200/70">
              <Shield className="h-4 w-4 text-blue-600/60 shrink-0" />
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Secondary</span>
              <span className="font-semibold text-foreground">{patient.secondaryInsurance}</span>
              {patient.memberId2 && <span className="text-xs text-muted-foreground">· Member ID {patient.memberId2}</span>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Referral — hidden when rendered separately in ProfilePage */}
      {!hideReferral && (
        <Card className="shadow-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-bold text-emerald-700">Referral Backdrop</CardTitle>
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
      )}

      {/* Initial Request, Cross-Sell & Serving — merged into one card */}
      <Card className="shadow-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-bold text-emerald-700">Initial Request, Cross-Sell &amp; Serving</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {/* Request & Serving */}
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
              required
            />
            <StatusSelect
              value={patient.cgmType}
              config={{ field: "cgmType", label: "CGM Type", indexMap: CGM_TYPE_INDEX }}
              onChange={(v) => onUpdate({ cgmType: v })}
              hint={cgmTypeHint}
              required
            />
          </div>

          {/* Cross-Sell subsection */}
          <div className="mt-5 pt-4 border-t border-border space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-muted-foreground">CGM Cross-Sell</p>
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
          </div>

          {/* Coverage Paths subsection */}
          <div className="mt-5 pt-4 border-t border-border">
            <p className="text-sm font-semibold text-muted-foreground mb-3">Coverage Paths</p>
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
