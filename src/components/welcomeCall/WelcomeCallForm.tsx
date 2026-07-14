import { useState, useEffect } from "react";
import type { Patient } from "@/lib/welcomeCall/workflow";
import {
  CGM_TYPE_OPTIONS,
  INFUSION_SET_1_OPTIONS,
  INFUSION_SET_2_OPTIONS,
  SUBSCRIPTION_TYPE_OPTIONS,
  servingIncludesCgm,
  PUMP_TYPE_OPTIONS,
  servingIncludesPump,
  isCrossSell,
  isInfusionSelling,
  isOriginalMedicare,
  expectedSubscriptionType,
} from "@/lib/welcomeCall/workflow";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { AddressAutocomplete, type AddressResult } from "@/components/welcomeCall/AddressAutocomplete";
import { Check, ChevronsUpDown, MessageSquare, Eye, EyeOff, AlertTriangle, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  patient: Patient;
  onFieldChange: (field: keyof Patient, value: string | number | null) => void;
  onSendWelcomeCallText?: () => Promise<void>;
}

function SectionHeading({ number, title }: { number: number; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="flex items-center justify-center h-7 w-7 rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0">
        {number}
      </span>
      <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
    </div>
  );
}

function hasZipCode(address: string): boolean {
  if (!address) return true; // no address = no warning
  return /\b\d{5}(-\d{4})?\b/.test(address);
}

/** Searchable combobox for infusion set selection */
function InfusionSetCombobox({
  options,
  value,
  onSelect,
  placeholder = "Select option",
}: {
  options: { index: number; label: string }[];
  value: number | null;
  onSelect: (label: string, index: number | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.index === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search infusion sets..." />
          <CommandList>
            <CommandEmpty>No match found.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt.index}
                  value={opt.label}
                  onSelect={() => {
                    onSelect(opt.label, opt.index);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === opt.index ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {opt.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Quantity selector as a dropdown 0-10 */
function QtySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <Select value={value || "0"} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="0" />
      </SelectTrigger>
      <SelectContent>
        {Array.from({ length: 11 }, (_, i) => (
          <SelectItem key={i} value={String(i)}>
            {i}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function WelcomeCallForm({ patient, onFieldChange, onSendWelcomeCallText }: Props) {
  const [sendingWelcomeText, setSendingWelcomeText] = useState(false);
  const handleSelectChange = (field: string, value: string, index: number | null) => {
    onFieldChange(field as keyof Patient, value);
    onFieldChange(`${field}Index` as keyof Patient, index);
  };

  // Section visibility based on serving — with user override toggles
  const effectiveServing = patient.servingEdited ?? patient.serving;
  const defaultShowCgm = servingIncludesCgm(effectiveServing);
  const defaultShowPump = servingIncludesPump(effectiveServing);

  const [cgmOverride, setCgmOverride] = useState<boolean | null>(null);
  const [pumpOverride, setPumpOverride] = useState<boolean | null>(null);

  // Reset overrides when patient changes
  useEffect(() => {
    setCgmOverride(null);
    setPumpOverride(null);
  }, [patient.id]);

  const showCgm = cgmOverride !== null ? cgmOverride : defaultShowCgm;
  const showPump = pumpOverride !== null ? pumpOverride : defaultShowPump;

  // Prior Pump Purchase Date: Original Medicare (Medicare A&B) patients only,
  // and only when Pump Qty is 0 (toggle off / not "1").
  const effectivePrimaryInsurance = patient.primaryInsuranceEdited ?? patient.primaryInsurance;
  const showPriorPumpDate =
    isOriginalMedicare(effectivePrimaryInsurance) && patient.pumpQty !== "1";

  // Clear a stale prior-pump date if the patient stops being eligible (insurance
  // changed away from Medicare A&B, or Pump Qty set to 1). Keeps local state in
  // sync with visibility so the save writes "" and clears the Monday cell rather
  // than persisting a value that no longer applies.
  useEffect(() => {
    if (!showPriorPumpDate && patient.medicarePriorPumpDate) {
      onFieldChange("medicarePriorPumpDate", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, showPriorPumpDate, patient.medicarePriorPumpDate]);

  // Qty Cartridge defaults to 3 (Josh, 2026-07): pre-fill once when blank so
  // an untouched save still writes 3 — but only while the pump section
  // applies, so CGM-only patients never get cartridges stamped on them.
  useEffect(() => {
    if (showPump && !patient.qtyCartridge) onFieldChange("qtyCartridge", "3");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, showPump, patient.qtyCartridge]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="px-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          To Fill In
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Complete these fields based on the welcome call information.
        </p>
      </div>

      {/* ─── Section 1: CGM ─── */}
      {showCgm ? (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <SectionHeading number={1} title="CGM" />
            {!defaultShowCgm && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCgmOverride(false)}
                className="text-muted-foreground text-xs gap-1"
              >
                <EyeOff className="h-3.5 w-3.5" /> Hide
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* CGM Type — editable dropdown */}
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-2">
                CGM Type
              </label>
              <Select
                value={patient.cgmTypeIndex !== null ? String(patient.cgmTypeIndex) : ""}
                onValueChange={(value) => {
                  const option = CGM_TYPE_OPTIONS.find((o) => String(o.index) === value);
                  handleSelectChange("cgmType", option?.label || "", option?.index ?? null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select CGM type" />
                </SelectTrigger>
                <SelectContent>
                  {CGM_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.index} value={String(opt.index)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isCrossSell(patient) && (
                <p className="mt-2 text-xs font-medium text-blue-600">
                  Cross-sell: verify the patient's CGM — Dexcom G7 was used as the default.
                </p>
              )}
            </div>

            {/* Monitor Qty — toggle (0 or 1) */}
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-2">
                Monitor Qty
              </label>
              <div className="flex items-center gap-3 h-10">
                <Switch
                  checked={patient.monitorQty === "1"}
                  onCheckedChange={(checked) =>
                    onFieldChange("monitorQty", checked ? "1" : "0")
                  }
                />
                <span className="text-sm font-medium">
                  {patient.monitorQty === "1" ? "1 — Yes" : "0 — No"}
                </span>
              </div>
              {patient.neverBilledCgm && (
                <div className="mt-2 flex items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 dark:bg-blue-950/30 px-2.5 py-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                  <span className="text-xs font-medium text-blue-700 dark:text-blue-300">Monitor has never been billed</span>
                </div>
              )}
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-4 border-dashed">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold">CGM</span> — hidden (not in serving)
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCgmOverride(true)}
              className="text-muted-foreground text-xs gap-1"
            >
              <Eye className="h-3.5 w-3.5" /> Show
            </Button>
          </div>
        </Card>
      )}

      {/* ─── Section 2: Pump & Infusion Sets ─── */}
      {showPump ? (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <SectionHeading number={2} title="Pump & Infusion Sets" />
            {!defaultShowPump && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPumpOverride(false)}
                className="text-muted-foreground text-xs gap-1"
              >
                <EyeOff className="h-3.5 w-3.5" /> Hide
              </Button>
            )}
          </div>

          {/* Pump Type + Pump Qty (+ Prior Pump Purchase Date for Original Medicare) */}
          <div className={`grid grid-cols-1 ${showPriorPumpDate ? "sm:grid-cols-3" : "sm:grid-cols-2"} gap-6 mb-5`}>
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1">
                Pump Type
              </label>
              <Select
                value={patient.pumpTypeIndex !== null ? String(patient.pumpTypeIndex) : ""}
                onValueChange={(value) => {
                  const option = PUMP_TYPE_OPTIONS.find((o) => String(o.index) === value);
                  handleSelectChange("pumpType", option?.label || "", option?.index ?? null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select pump type" />
                </SelectTrigger>
                <SelectContent>
                  {PUMP_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.index} value={String(opt.index)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1">
                Pump Qty
              </label>
              <div className="flex items-center gap-3 h-10">
                <Switch
                  checked={patient.pumpQty === "1"}
                  onCheckedChange={(checked) =>
                    onFieldChange("pumpQty", checked ? "1" : "0")
                  }
                />
                <span className="text-sm font-medium">
                  {patient.pumpQty === "1" ? "1 — Yes" : "0 — No"}
                </span>
              </div>
              {patient.neverBilledIsCar && (
                <div className="mt-2 flex items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 dark:bg-blue-950/30 px-2.5 py-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                  <span className="text-xs font-medium text-blue-700 dark:text-blue-300">Never billed, add to notes</span>
                </div>
              )}
            </div>

            {/* Prior Pump Purchase Date — Original Medicare + Pump Qty 0 only */}
            {showPriorPumpDate && (
              <div>
                <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1">
                  Prior Pump Purchase Date
                </label>
                <Input
                  className="h-10"
                  value={patient.medicarePriorPumpDate}
                  onChange={(e) => onFieldChange("medicarePriorPumpDate", e.target.value)}
                  placeholder="MM/YYYY"
                />
                <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1.5">
                  <Lightbulb className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    If SoS is completely clear for Insulin Pump and Supplies, ask patient for approximate date they got their pump
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Infusion Set pairs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Infusion Set 1 group */}
            <div className="rounded-lg border border-input bg-muted/20 p-4 space-y-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Infusion Set 1
              </p>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Set Type</label>
                <InfusionSetCombobox
                  options={INFUSION_SET_1_OPTIONS}
                  value={patient.infusionSet1Index}
                  onSelect={(label, index) =>
                    handleSelectChange("infusionSet1", label, index)
                  }
                  placeholder="Search infusion sets..."
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Quantity</label>
                <QtySelect
                  value={patient.qtyInf1}
                  onChange={(val) => onFieldChange("qtyInf1", val)}
                />
                {isInfusionSelling(patient.infusionSet1Index) &&
                  (!patient.qtyInf1 || patient.qtyInf1 === "0") && (
                    <p className="mt-2 text-xs font-medium text-red-600">
                      Infusion set selected — please choose a quantity.
                    </p>
                  )}
              </div>
            </div>

            {/* Infusion Set 2 group */}
            <div className="rounded-lg border border-input bg-muted/20 p-4 space-y-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Infusion Set 2
              </p>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Set Type</label>
                <InfusionSetCombobox
                  options={INFUSION_SET_2_OPTIONS}
                  value={patient.infusionSet2Index}
                  onSelect={(label, index) =>
                    handleSelectChange("infusionSet2", label, index)
                  }
                  placeholder="Search infusion sets..."
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Quantity</label>
                <QtySelect
                  value={patient.qtyInf2}
                  onChange={(val) => onFieldChange("qtyInf2", val)}
                />
                {isInfusionSelling(patient.infusionSet2Index) &&
                  (!patient.qtyInf2 || patient.qtyInf2 === "0") && (
                    <p className="mt-2 text-xs font-medium text-red-600">
                      Infusion set selected — please choose a quantity.
                    </p>
                  )}
              </div>
            </div>
          </div>

          {/* Cartridges */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-5">
            <div className="rounded-lg border border-input bg-muted/20 p-4 space-y-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Cartridges
              </p>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Quantity</label>
                <QtySelect
                  value={patient.qtyCartridge}
                  onChange={(val) => onFieldChange("qtyCartridge", val)}
                />
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-4 border-dashed">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold">Pump & Infusion Sets</span> — hidden (not in serving)
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPumpOverride(true)}
              className="text-muted-foreground text-xs gap-1"
            >
              <Eye className="h-3.5 w-3.5" /> Show
            </Button>
          </div>
        </Card>
      )}

      {/* ─── Section 3: Subscription & Logistics ─── */}
      <Card className="p-6">
        <SectionHeading number={3} title="Subscription & Logistics" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Subscription Type */}
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-2">
              Subscription Type
            </label>
            <Select
              value={patient.subscriptionTypeIndex !== null ? String(patient.subscriptionTypeIndex) : ""}
              onValueChange={(value) => {
                const option = SUBSCRIPTION_TYPE_OPTIONS.find((o) => String(o.index) === value);
                handleSelectChange("subscriptionType", option?.label || "", option?.index ?? null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select option" />
              </SelectTrigger>
              <SelectContent>
                {SUBSCRIPTION_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.index} value={String(opt.index)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(() => {
              const expected = expectedSubscriptionType(patient);
              const selected = patient.subscriptionTypeIndex !== null
                ? SUBSCRIPTION_TYPE_OPTIONS.find((o) => o.index === patient.subscriptionTypeIndex)?.label ?? null
                : null;
              if (expected && selected && expected !== selected) {
                return (
                  <p className="mt-2 text-xs font-medium text-red-600">
                    Mismatch: based on the selections above, expected <span className="font-semibold">{expected}</span> but <span className="font-semibold">{selected}</span> is selected.
                  </p>
                );
              }
              return null;
            })()}
          </div>

        </div>

        {/* Address — full width */}
        <div className="mt-6 space-y-3">
          {/* Current Monday address (read-only) */}
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1">
              Address on File
            </label>
            <p className="text-sm font-medium px-3 py-2 rounded-md bg-muted/50 border border-input min-h-[40px] flex items-center">
              {patient.address || <span className="text-muted-foreground italic">No address on file</span>}
            </p>
            {patient.address && !hasZipCode(patient.address) && (
              <p className="text-xs text-red-600 font-semibold mt-1">Zip code needs to be added!</p>
            )}
          </div>

          {/* Google Places autocomplete for editing */}
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1">
              Update Address
            </label>
            <AddressAutocomplete
              key={patient.id}
              value={patient.addressEdited ?? ""}
              onChange={(result: AddressResult) => {
                onFieldChange("addressEdited", result.address);
                onFieldChange("addressLat" as keyof Patient, result.lat);
                onFieldChange("addressLng" as keyof Patient, result.lng);
              }}
              placeholder="Search for a new address..."
            />
            {patient.addressEdited !== null && patient.addressEdited !== "" && !hasZipCode(patient.addressEdited) && (
              <p className="text-xs text-red-600 font-semibold mt-1">Zip code needs to be added!</p>
            )}
            {patient.addressEdited !== null && patient.addressEdited !== "" && hasZipCode(patient.addressEdited) && patient.addressEdited !== patient.address && (
              <p className="text-xs text-amber-600 mt-1">Address will be updated on sync</p>
            )}
          </div>
        </div>

        {/* Welcome Call Text — button below address */}
        <div className="mt-6">
          <Button
            variant={patient.welcomeCallTextIndex !== null ? "secondary" : "default"}
            disabled={sendingWelcomeText}
            className={cn(
              "gap-2 w-full sm:w-auto",
              patient.welcomeCallTextIndex !== null && "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-300"
            )}
            onClick={async () => {
              // If already queued and the parent hasn't supplied a sender, allow toggle off (legacy behavior)
              if (patient.welcomeCallTextIndex !== null) {
                onFieldChange("welcomeCallText", "");
                onFieldChange("welcomeCallTextIndex" as keyof Patient, null);
                return;
              }
              if (!onSendWelcomeCallText) {
                // Fallback: just flip local state (preview / no-Monday environment)
                onFieldChange("welcomeCallText", "Send");
                onFieldChange("welcomeCallTextIndex" as keyof Patient, 0);
                return;
              }
              try {
                setSendingWelcomeText(true);
                await onSendWelcomeCallText();
              } finally {
                setSendingWelcomeText(false);
              }
            }}
          >
            <MessageSquare className="h-4 w-4" />
            {sendingWelcomeText
              ? "Sending…"
              : patient.welcomeCallTextIndex !== null
                ? "Welcome Call Text: Queued"
                : "Send Welcome Call Text"}
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            Pushes the form data above to Monday, then flips the Welcome Call Text trigger to Send.
          </p>
        </div>
      </Card>

      {/* ─── End-of-call decision: Advance? ─── */}
      <Card className="p-6">
        <SectionHeading number={4} title="End of Call" />
        <p className="text-sm text-muted-foreground mb-4">
          After wrapping up the welcome call, decide whether this patient should
          advance to Order or hold here. Either choice routes the patient back
          for Profile Review on the Monday board.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Button
            type="button"
            variant="outline"
            className={cn(
              "h-auto py-4 justify-start text-left whitespace-normal border",
              "focus-visible:ring-emerald-500 focus-visible:ring-offset-0",
              patient.advanceDecisionIndex === 1
                ? "bg-emerald-600 hover:bg-emerald-700 hover:text-white text-white border-emerald-700 shadow-md"
                : "bg-emerald-50 hover:bg-emerald-600 hover:text-white hover:border-emerald-700 text-emerald-800 border-emerald-300"
            )}
            onClick={() => {
              if (patient.advanceDecisionIndex === 1) {
                onFieldChange("advanceDecision", "");
                onFieldChange("advanceDecisionIndex" as keyof Patient, null);
              } else {
                onFieldChange("advanceDecision", "Advance");
                onFieldChange("advanceDecisionIndex" as keyof Patient, 1);
              }
            }}
          >
            <div>
              <p className="font-semibold text-sm">Advance</p>
              <p className="text-xs opacity-90 font-normal">
                Move forward to Order.
              </p>
            </div>
          </Button>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "h-auto py-4 justify-start text-left whitespace-normal border",
              "focus-visible:ring-rose-500 focus-visible:ring-offset-0",
              patient.advanceDecisionIndex === 2
                ? "bg-rose-600 hover:bg-rose-700 hover:text-white text-white border-rose-700 shadow-md"
                : "bg-rose-50 hover:bg-rose-600 hover:text-white hover:border-rose-700 text-rose-800 border-rose-300"
            )}
            onClick={() => {
              if (patient.advanceDecisionIndex === 2) {
                onFieldChange("advanceDecision", "");
                onFieldChange("advanceDecisionIndex" as keyof Patient, null);
              } else {
                onFieldChange("advanceDecision", "Don't Advance");
                onFieldChange("advanceDecisionIndex" as keyof Patient, 2);
              }
            }}
          >
            <div>
              <p className="font-semibold text-sm">Don&apos;t Advance</p>
              <p className="text-xs opacity-90 font-normal">
                Hold this patient — do not progress to Order.
              </p>
            </div>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Required before pressing Send to Monday. Either choice sets Stage Advancer to <span className="font-semibold">Review Profile</span>.
        </p>
      </Card>
    </div>
  );
}
