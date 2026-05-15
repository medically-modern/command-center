import { useState, useEffect, useRef } from "react";
import type { Patient } from "@/lib/profile/workflow";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { triggerStediRun, writePatientProfile, verifyProfileWritten } from "@/lib/profile/mondayWrite";
import {
  GENERAL_INSURANCE_INDEX,
  PRIMARY_INSURANCE_INDEX,
  SECONDARY_INSURANCE_INDEX,
  groupPrimaryInsuranceLabels,
} from "@/lib/profile/mondayMapping";
import { ClinicalsDownloadButton } from "./ClinicalsDownloadButton";
import { toast } from "sonner";
import { Play, Loader2, AlertTriangle, CheckCircle2, Save, CheckCheck, ArrowRight, ChevronsUpDown, Check } from "lucide-react";

// Stedi reads from Monday, so the four fields it actually consumes —
// Name, DOB, General Insurance, Member ID 1 — must be synced before it
// runs. Other profile fields (phone, email, gender, address, member id 2)
// get written on the final Submit step, so they don't trigger Fix Profile.
type ProfileSnapshot = {
  name: string;
  dob: string;
  generalInsurance: string;
  memberId1: string;
};

function snapshotProfile(p: Patient): ProfileSnapshot {
  return {
    name: p.name,
    dob: p.dob,
    generalInsurance: p.generalInsurance,
    memberId1: p.memberId1,
  };
}

function profilesEqual(a: ProfileSnapshot, b: ProfileSnapshot): boolean {
  return (Object.keys(a) as (keyof ProfileSnapshot)[]).every((k) => a[k] === b[k]);
}

interface Props {
  patient: Patient;
  onRefresh: () => void;
  onUpdate: (patch: Partial<Patient>) => void;
  onNext?: () => void;
  /** Drop specific keys from the patient's local-edit overlay. Used
   *  before triggering a Stedi run so any prior optimistic clears (or
   *  page-side edits) don't mask the values Monday is about to write. */
  onRemoveOverlayKeys?: (keys: (keyof Patient)[]) => void;
}

// Fields always shown after Stedi run. `alwaysShow: true` means render
// the row even when the value is empty (with an em-dash placeholder);
// otherwise the row is suppressed when empty.
const ALWAYS_FIELDS: { key: keyof Patient; label: string; alwaysShow?: boolean }[] = [
  { key: "stediEligibilityActive", label: "Active?" },
  { key: "stediCoverageType", label: "Coverage Type" },
  { key: "stediPayerName", label: "Payer Name" },
  { key: "stediPlanName", label: "Plan Name" },
  { key: "stediGender", label: "Gender", alwaysShow: true },
  { key: "stediInNetwork", label: "In Network?" },
  { key: "stediPriorAuthRequired", label: "Prior Auth Required?" },
  { key: "stediPlanBeginDate", label: "Plan Begin Date" },
  { key: "stediMedicaidId", label: "Medicaid ID" },
  { key: "stediErrorDescription", label: "Error Description" },
];

// Medicare-only fields
const MEDICARE_FIELDS: { key: keyof Patient; label: string }[] = [
  { key: "stediMedicareAdvantage", label: "Medicare Advantage?" },
  { key: "stediMedicareAdvantageCarrier", label: "Medicare Advantage Carrier" },
  { key: "stediMedicareJurisdiction", label: "Medicare Jurisdiction" },
  { key: "stediQmb", label: "QMB?" },
  { key: "stediSecondaryMedicaidId", label: "Medicaid ID" },
];

// Medicaid-only fields
const MEDICAID_FIELDS: { key: keyof Patient; label: string }[] = [
  { key: "stediManagedMedicaid", label: "Managed Medicaid" },
  { key: "stediMedicaidMltc", label: "MLTC" },
  { key: "stediSecondaryMedicaidId", label: "Medicaid ID" },
];

function ResultRow({
  label,
  value,
  isError,
  alwaysShow,
}: {
  label: string;
  value: string;
  isError?: boolean;
  alwaysShow?: boolean;
}) {
  if (!value && !alwaysShow) return null;
  return (
    <div className="flex justify-between py-1.5 border-b border-border/50">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={`text-sm font-medium text-right max-w-[60%] ${
          isError ? "text-red-500" : value ? "" : "text-muted-foreground/60"
        }`}
      >
        {value || "—"}
      </span>
    </div>
  );
}

export function StediPanel({ patient, onRefresh, onUpdate, onNext, onRemoveOverlayKeys }: Props) {
  const [running, setRunning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [costSharingMode, setCostSharingMode] = useState<"individual" | "family">("individual");
  const [primaryOpen, setPrimaryOpen] = useState(false);
  const [pollingForStedi, setPollingForStedi] = useState(false);
  // Snapshot of completion-signal fields at the moment Run is clicked.
  // Used by the spinner watcher to ignore stale-read polls.
  const valuesAtRunClickRef = useRef<{ planName: string; errorDescription: string; eligibilityActive: string }>({
    planName: "",
    errorDescription: "",
    eligibilityActive: "",
  });

  // Snapshot of what we believe is currently in Monday for the profile fields.
  // We track patient.id alongside it so we can re-baseline synchronously
  // during render whenever the user switches patients — this avoids a one-
  // frame flicker where the button briefly says "Fix Profile" before the
  // useEffect would have run.
  const syncedRef = useRef<{ id: string; snapshot: ProfileSnapshot }>({
    id: patient.id,
    snapshot: snapshotProfile(patient),
  });
  if (syncedRef.current.id !== patient.id) {
    syncedRef.current = { id: patient.id, snapshot: snapshotProfile(patient) };
  }

  const generalIns = patient.generalInsurance;
  const isMedicare = generalIns === "Medicare A&B";
  const isMedicaid = generalIns === "Medicaid";

  // Has the user edited any profile field since the last successful sync?
  const profileDirty = !profilesEqual(snapshotProfile(patient), syncedRef.current.snapshot);

  // Prerequisites for Run Stedi button
  const prereqsFilled = !!(
    patient.name.trim() &&
    patient.dob.trim() &&
    patient.generalInsurance &&
    patient.memberId1.trim()
  );
  const canRunStedi = prereqsFilled && !profileDirty;

  // Stedi populates fields one at a time across a few polls. Treat the
  // response as "complete" once ANY terminal signal lands: plan name
  // (success), error description (failure), OR eligibility active
  // (Stedi answered but may have omitted the plan name — e.g. when the
  // member is not eligible, Stedi often returns coverage details but no
  // plan name and no error description).
  const stediIsComplete =
    !!patient.stediPlanName ||
    !!patient.stediErrorDescription ||
    !!patient.stediEligibilityActive;
  const isStediFailed = !!patient.stediErrorDescription && !patient.stediPlanName;
  const hasStediData = stediIsComplete && !isStediFailed;

  const handleFixProfile = async () => {
    setSyncing(true);
    try {
      await writePatientProfile(patient);
      // Give Monday a beat to commit before we read back
      await new Promise((r) => setTimeout(r, 1500));
      const result = await verifyProfileWritten(patient.id, {
        name: patient.name,
        dob: patient.dob,
        generalInsurance: patient.generalInsurance,
        memberId1: patient.memberId1,
      });
      if (result.ok) {
        // Mark these values as the new "known in Monday" baseline
        syncedRef.current = { id: patient.id, snapshot: snapshotProfile(patient) };
        onRefresh();
        toast.success("Profile saved to Monday — ready to run Stedi");
      } else {
        toast.error("Profile didn't fully sync to Monday", {
          description: result.mismatches.join(" · "),
        });
      }
    } catch (e) {
      toast.error("Failed to save profile to Monday", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleRunStedi = async () => {
    // Snapshot the values that exist on Monday RIGHT NOW. The watcher
    // below only clears the spinner once it sees a value that differs
    // from this snapshot — so a stale-read poll (Monday's read replica
    // returning the previous run's errorDescription before our clear
    // has propagated) won't prematurely flip stediIsComplete to true.
    valuesAtRunClickRef.current = {
      planName: patient.stediPlanName ?? "",
      errorDescription: patient.stediErrorDescription ?? "",
      eligibilityActive: patient.stediEligibilityActive ?? "",
    };
    setRunning(true);
    setPollingForStedi(true);
    // Two-step trick to keep the loading spinner up until *new* results
    // land:
    //   1. updateLocal clears the three completion-signal fields so
    //      stediIsComplete becomes false immediately (otherwise the
    //      stale prior result would satisfy it and the watcher effect
    //      would kill the spinner the moment Run is clicked).
    //   2. removeOverlayKeys deletes those same keys from the overlay
    //      so the next refetch can render Monday's freshly-written
    //      values without being masked by the empty strings we just
    //      put into local state. setPatients on refetch overwrites
    //      state directly; the overlay is what would have persisted.
    onUpdate({ stediPlanName: "", stediErrorDescription: "", stediEligibilityActive: "" });
    onRemoveOverlayKeys?.([
      "stediPlanName",
      "stediErrorDescription",
      "stediEligibilityActive",
      "stediCoverageType",
      "stediPayerName",
      "stediMedicareAdvantage",
      "stediMedicareAdvantageCarrier",
      "stediMedicareAdvantageMemberId",
      "stediQmb",
      "stediMedicareJurisdiction",
      "stediMedicaidMltc",
      "stediManagedMedicaid",
      "stediInNetwork",
      "stediPriorAuthRequired",
      "stediCoinsurance",
      "stediCopay",
      "stediIndividualDeductible",
      "stediIndividualDeductibleRemaining",
      "stediFamilyDeductible",
      "stediFamilyDeductibleRemaining",
      "stediIndividualOopMax",
      "stediIndividualOopMaxRemaining",
      "stediFamilyOopMax",
      "stediFamilyOopMaxRemaining",
      "stediPlanBeginDate",
      "stediSecondaryMedicaidId",
      "stediGender",
      "stediMedicaidId",
    ]);
    try {
      await triggerStediRun(patient.id);
      toast.success("Stedi eligibility check triggered");
      // Poll for results — the watcher effect below clears
      // pollingForStedi as soon as a terminal signal arrives.
      setTimeout(onRefresh, 3000);
      setTimeout(onRefresh, 8000);
      setTimeout(onRefresh, 15000);
      setTimeout(onRefresh, 25000);
      setTimeout(onRefresh, 40000);
      setTimeout(onRefresh, 55000);
      // Hard timeout at 65s — never spin forever.
      setTimeout(() => {
        setPollingForStedi((current) => {
          if (current) {
            toast.error("Stedi check timed out", {
              description: "No results received after 60 seconds. Check Monday for details.",
            });
          }
          return false;
        });
      }, 65000);
    } catch (e) {
      setPollingForStedi(false);
      toast.error("Failed to trigger Stedi run", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRunning(false);
    }
  };

  // Clear the spinner once we see Monday return ANY completion signal
  // that's NEW (different from what was there at Run-click time).
  // A stale-read poll that returns the previous run's value would
  // otherwise satisfy stediIsComplete and kill the spinner before the
  // actual fresh result arrives.
  useEffect(() => {
    if (!pollingForStedi || !stediIsComplete) return;
    const currentPlanName = patient.stediPlanName ?? "";
    const currentErrorDescription = patient.stediErrorDescription ?? "";
    const currentEligibilityActive = patient.stediEligibilityActive ?? "";
    const planNameIsNew = currentPlanName !== valuesAtRunClickRef.current.planName;
    const errorDescriptionIsNew =
      currentErrorDescription !== valuesAtRunClickRef.current.errorDescription;
    const eligibilityActiveIsNew =
      currentEligibilityActive !== valuesAtRunClickRef.current.eligibilityActive;
    console.log("[Stedi watcher]", {
      planName: currentPlanName || "(empty)",
      errorDescription: currentErrorDescription || "(empty)",
      eligibilityActive: currentEligibilityActive || "(empty)",
      atClick: valuesAtRunClickRef.current,
      planNameIsNew,
      errorDescriptionIsNew,
      eligibilityActiveIsNew,
      willClearSpinner: planNameIsNew || errorDescriptionIsNew || eligibilityActiveIsNew,
    });
    if (planNameIsNew || errorDescriptionIsNew || eligibilityActiveIsNew) {
      setPollingForStedi(false);
    }
  }, [pollingForStedi, stediIsComplete, patient.stediPlanName, patient.stediErrorDescription, patient.stediEligibilityActive]);

  const isActive = patient.stediEligibilityActive?.toLowerCase() === "yes";

  return (
    <div className="space-y-5">
      {/* Step A: Insurance Input + Run Stedi */}
      <Card className="shadow-card">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">Step 1</p>
              <CardTitle className="text-lg">Run Stedi Check</CardTitle>
            </div>
            <ClinicalsDownloadButton itemId={patient.id} />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* General Insurance + Member IDs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="space-y-1.5">
              <Label>General Insurance <span className="text-red-400">*</span></Label>
              <Select
                value={patient.generalInsurance || undefined}
                onValueChange={(v) => onUpdate({ generalInsurance: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select insurance…" />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(GENERAL_INSURANCE_INDEX).map((label) => (
                    <SelectItem key={label} value={label}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Member ID 1 <span className="text-red-400">*</span></Label>
              <Input
                value={patient.memberId1}
                onChange={(e) => onUpdate({ memberId1: e.target.value })}
                placeholder="Enter member ID…"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Member ID 2</Label>
              <Input
                value={patient.memberId2}
                onChange={(e) => onUpdate({ memberId2: e.target.value })}
                placeholder="Enter member ID…"
              />
            </div>
          </div>

          {/* Primary + Secondary Insurance (was Step 3 — always visible) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <Label>Primary Insurance</Label>
              <Popover open={primaryOpen} onOpenChange={setPrimaryOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={primaryOpen}
                    className="w-full justify-between font-normal"
                  >
                    {patient.primaryInsurance || <span className="text-muted-foreground">Select insurance…</span>}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)] max-h-[420px]" align="start">
                  <Command>
                    <CommandInput placeholder="Search insurance…" />
                    <CommandList>
                      <CommandEmpty>No insurance matches.</CommandEmpty>
                      {groupPrimaryInsuranceLabels().map(({ group, labels }) => (
                        <CommandGroup key={group} heading={group}>
                          {labels.map((label) => (
                            <CommandItem
                              key={label}
                              value={label}
                              onSelect={(v) => {
                                onUpdate({ primaryInsurance: v });
                                setPrimaryOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  patient.primaryInsurance === label ? "opacity-100" : "opacity-0",
                                )}
                              />
                              {label}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <Label>Secondary Insurance</Label>
              <Select
                value={patient.secondaryInsurance || undefined}
                onValueChange={(v) => onUpdate({ secondaryInsurance: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(SECONDARY_INSURANCE_INDEX).map((label) => (
                    <SelectItem key={label} value={label}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Fix Profile + Run Stedi buttons */}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={handleFixProfile}
              disabled={syncing || !profileDirty}
              variant={profileDirty ? "default" : "outline"}
              className={
                profileDirty
                  ? "gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-elevate"
                  : "gap-2 opacity-70"
              }
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : profileDirty ? (
                <Save className="h-4 w-4" />
              ) : (
                <CheckCheck className="h-4 w-4 text-green-600" />
              )}
              {syncing
                ? "Saving…"
                : profileDirty
                ? "Fix Profile Before Stedi Check"
                : "Profile Synced"}
            </Button>

            <Button
              onClick={handleRunStedi}
              disabled={running || !canRunStedi}
              className="gap-2 bg-gradient-primary shadow-elevate"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? "Running…" : "Run Stedi Check"}
            </Button>

            {profileDirty && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                Save profile changes before running Stedi
              </p>
            )}
            {!profileDirty && !prereqsFilled && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                Fill in Name, DOB, General Insurance, and Member ID 1 first
              </p>
            )}
            {isStediFailed && (
              <Badge variant="destructive">Eligibility Check Failed</Badge>
            )}
            {hasStediData && patient.stediEligibilityActive && (
              <Badge variant={isActive ? "default" : "destructive"} className={isActive ? "bg-green-600" : ""}>
                {isActive ? "Active" : patient.stediEligibilityActive}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* While Stedi is still populating, show a single waiting card so
          eligibility results never appear field-by-field. */}
      {pollingForStedi && !stediIsComplete && (
        <Card className="shadow-card border-blue-200 bg-blue-50/40">
          <CardContent className="pt-5 pb-4 flex items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <div>
              <p className="text-sm font-medium text-foreground">Running eligibility check…</p>
              <p className="text-xs text-muted-foreground">
                Results will appear here once Stedi finishes (usually 5–15 seconds).
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stedi failure — shown instead of Step 2 / Step 3 when Stedi errored. */}
      {isStediFailed && (
        <Card className="shadow-card border-red-300">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base text-red-700 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Eligibility Check Failed
              </CardTitle>
              <Badge variant="destructive">Failed</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              Reason from Stedi
            </p>
            <p className="text-sm text-red-700">{patient.stediErrorDescription}</p>
            <p className="text-xs text-muted-foreground mt-3">
              Fix the underlying input (often Name, DOB, or Member ID 1), click Fix Profile Before Stedi Check,
              then Run Stedi Check again.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Eligibility Results — always visible (empty state when no Stedi data) */}
      <Card className="shadow-card">
        {!stediIsComplete && (
          <CardContent className="pt-5 pb-4">
            <p className="text-sm text-muted-foreground text-center py-4">
              Run a Stedi check above to see eligibility results
            </p>
          </CardContent>
        )}
        {stediIsComplete && (
          <>
          {/* Always-show results */}
          <Card className="shadow-none border-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                {isStediFailed ? (
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                )}
                Eligibility Results
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                {ALWAYS_FIELDS.map(({ key, label, alwaysShow }) => (
                  <ResultRow
                    key={key}
                    label={label}
                    value={patient[key] as string}
                    isError={key === "stediErrorDescription"}
                    alwaysShow={alwaysShow}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Medicare-only fields */}
          {isMedicare && (
            <Card className="shadow-card border-blue-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Medicare Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                  {MEDICARE_FIELDS.map(({ key, label }) => (
                    <ResultRow key={key} label={label} value={patient[key] as string} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Medicaid-only fields */}
          {isMedicaid && (
            <Card className="shadow-card border-purple-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Medicaid Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                  {MEDICAID_FIELDS.map(({ key, label }) => (
                    <ResultRow key={key} label={label} value={patient[key] as string} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Cost Sharing section */}
          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">Step 2</p>
                  <CardTitle className="text-base">Verify Cost Sharing Info</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Defaults pulled from {costSharingMode === "family" ? "family" : "individual"} amounts. All values are editable.
                  </p>
                </div>
                <ToggleGroup
                  type="single"
                  value={costSharingMode}
                  onValueChange={(v) => v && setCostSharingMode(v as "individual" | "family")}
                  size="sm"
                  variant="outline"
                  className="self-start"
                >
                  <ToggleGroupItem value="individual" className="h-8 px-3 text-xs">Use Individual</ToggleGroupItem>
                  <ToggleGroupItem value="family" className="h-8 px-3 text-xs">Use Family</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Editable working values — default source switches with the toggle */}
              {(() => {
                const isFamily = costSharingMode === "family";
                const defaultDeductible = isFamily ? patient.stediFamilyDeductible : patient.stediIndividualDeductible;
                const defaultDeductibleRem = isFamily ? patient.stediFamilyDeductibleRemaining : patient.stediIndividualDeductibleRemaining;
                const defaultOopMax = isFamily ? patient.stediFamilyOopMax : patient.stediIndividualOopMax;
                const defaultOopMaxRem = isFamily ? patient.stediFamilyOopMaxRemaining : patient.stediIndividualOopMaxRemaining;
                return (
                  <div className="space-y-5">
                    {/* Pair 1: Co-insurance + Co-pay */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>Co-insurance</Label>
                        <PercentInput
                          value={patient.workingCoinsurance || patient.stediCoinsurance}
                          onChange={(v) => onUpdate({ workingCoinsurance: v })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Co-pay</Label>
                        <CurrencyInput
                          value={patient.stediCopay}
                          onChange={(v) => onUpdate({ stediCopay: v })}
                        />
                      </div>
                    </div>

                    {/* Pair 2: Deductible + Deductible Remaining */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>Deductible</Label>
                        <CurrencyInput
                          value={patient.workingDeductible || defaultDeductible}
                          onChange={(v) => onUpdate({ workingDeductible: v })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Deductible Remaining</Label>
                        <CurrencyInput
                          value={patient.workingDeductibleRemaining || defaultDeductibleRem}
                          onChange={(v) => onUpdate({ workingDeductibleRemaining: v })}
                        />
                      </div>
                    </div>

                    {/* Pair 3: OOP Max + OOP Max Remaining */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>OOP Max</Label>
                        <CurrencyInput
                          value={patient.workingOopMax || defaultOopMax}
                          onChange={(v) => onUpdate({ workingOopMax: v })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>OOP Max Remaining</Label>
                        <CurrencyInput
                          value={patient.workingOopMaxRemaining || defaultOopMaxRem}
                          onChange={(v) => onUpdate({ workingOopMaxRemaining: v })}
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Reference: Individual vs Family (read-only) */}
              <details className="group">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                  Show individual &amp; family breakdown
                </summary>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 text-sm">
                  <div className="font-medium text-xs uppercase tracking-wider text-muted-foreground pt-2 col-span-full">Individual</div>
                  <ResultRow label="Deductible" value={fmtCurrency(patient.stediIndividualDeductible)} />
                  <ResultRow label="Deductible Remaining" value={fmtCurrency(patient.stediIndividualDeductibleRemaining)} />
                  <ResultRow label="OOP Max" value={fmtCurrency(patient.stediIndividualOopMax)} />
                  <ResultRow label="OOP Max Remaining" value={fmtCurrency(patient.stediIndividualOopMaxRemaining)} />

                  <div className="font-medium text-xs uppercase tracking-wider text-muted-foreground pt-2 col-span-full">Family</div>
                  <ResultRow label="Deductible" value={fmtCurrency(patient.stediFamilyDeductible)} />
                  <ResultRow label="Deductible Remaining" value={fmtCurrency(patient.stediFamilyDeductibleRemaining)} />
                  <ResultRow label="OOP Max" value={fmtCurrency(patient.stediFamilyOopMax)} />
                  <ResultRow label="OOP Max Remaining" value={fmtCurrency(patient.stediFamilyOopMaxRemaining)} />
                </div>
              </details>
            </CardContent>
          </Card>
          </>
        )}
      </Card>

      {/* Next button → Serving tab */}
      {onNext && (
        <div className="flex justify-end pt-2">
          <Button onClick={onNext} className="gap-2 bg-gradient-primary shadow-elevate">
            Next: Serving
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ───────── Cost-sharing input helpers ─────────

/** Format a numeric string as currency: "1250" → "$1,250", "2370.24" → "$2,370.24". */
function fmtCurrency(raw: string): string {
  if (!raw) return "";
  const cleaned = raw.replace(/[^\d.\-]/g, "");
  if (!cleaned || isNaN(Number(cleaned))) return raw;
  const n = Number(cleaned);
  // Show 2 decimals only if the value actually has fractional part
  const opts: Intl.NumberFormatOptions = n % 1 === 0
    ? { maximumFractionDigits: 0 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return "$" + n.toLocaleString("en-US", opts);
}

/** Currency input with $ prefix + thousands-separator on blur. */
function CurrencyInput({
  value, onChange, readOnly,
}: { value: string; onChange?: (v: string) => void; readOnly?: boolean }) {
  const [focused, setFocused] = useState(false);
  const cleaned = (value ?? "").replace(/[^\d.\-]/g, "");
  const display = focused
    ? cleaned
    : cleaned && !isNaN(Number(cleaned))
      ? Number(cleaned).toLocaleString("en-US", {
          minimumFractionDigits: cleaned.includes(".") ? 2 : 0,
          maximumFractionDigits: 2,
        })
      : "";
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
      <Input
        className={`pl-7 ${readOnly ? "bg-muted/50" : ""}`}
        value={display}
        onChange={(e) => onChange?.(e.target.value.replace(/[$,\s]/g, ""))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="—"
        readOnly={readOnly}
      />
    </div>
  );
}

/** Percent input with % suffix. Decimal values (≤1) are displayed as ×100. */
function PercentInput({
  value, onChange,
}: { value: string; onChange?: (v: string) => void }) {
  const [focused, setFocused] = useState(false);
  const cleaned = (value ?? "").replace(/[^\d.\-]/g, "");
  const num = cleaned ? Number(cleaned) : NaN;
  // Stedi often returns coinsurance as a decimal (0.5 = 50%); normalize for display.
  const normalized = !isNaN(num) && num > 0 && num <= 1 ? num * 100 : num;
  const display = focused
    ? cleaned
    : isNaN(normalized) ? "" :
        Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(1);
  return (
    <div className="relative">
      <Input
        className="pr-8"
        value={display}
        onChange={(e) => onChange?.(e.target.value.replace(/[%\s]/g, ""))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="—"
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">%</span>
    </div>
  );
}
