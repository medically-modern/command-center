import type { Patient } from "@/lib/finalConfirm/workflow";
import {
  GENDER_OPTIONS,
  PRIMARY_INSURANCE_OPTIONS,
  SECONDARY_INSURANCE_OPTIONS,
  SERVING_OPTIONS,
  PUMP_TYPE_OPTIONS,
  CGM_TYPE_OPTIONS,
  REQUEST_TYPE_OPTIONS,
  CGM_COVERAGE_PATH_OPTIONS,
  IP_COVERAGE_PATH_OPTIONS,
  CLINICALS_METHOD_OPTIONS,
  // REFERRAL_TYPE_OPTIONS, // read-only display, no select needed
  // REFERRAL_SOURCE_OPTIONS,
  SUBSCRIPTION_TYPE_OPTIONS,
  AUTH_RESULT_OPTIONS,
  POS_OPTIONS,
  needsPriorPumpDate,
  needsMonitorPurchaseDate,
  deriveMonitorPurchaseDate,
  formatPhone,
  formatDateMDY,
} from "@/lib/finalConfirm/workflow";
import type { CheckFinding, CheckSeverity } from "@/lib/finalConfirm/checkPack";
// ⚠️ Cross-slice import, deliberate. The CMS state→MAC map is itself already a
// hand-synced copy of claims-ui-tool's (see that module's header), so a third
// copy in the finalConfirm slice is the one thing that must not happen —
// importing the live one is cheaper to keep honest than the §4 slice rule is
// to obey here. Delete this import with the pill.
import {
  isMedicarePrimary,
  medicareJurisdictionForState,
  stateFromAddress,
  MAC_CONTRACTORS,
} from "@/lib/samantha/medicareJurisdiction";
import { hasToken, fetchStatusOptions, BOARD_ID, COL } from "@/lib/finalConfirm/mondayApi";
import { useStatusOptions } from "@/hooks/useStatusOptions";
import { toast } from "sonner";
import { indexForLabel } from "@/lib/shared/statusOptions";
import { AddressAutocomplete, type AddressResult } from "@/components/finalConfirm/AddressAutocomplete";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronsUpDown,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  User,
  Phone,
  Mail,
  MapPin,
  Shield,
  IdCard,
  Stethoscope,
  Activity,
  Hash,
  Building2,
  Send,
  UserRound,
  Package,
  Lightbulb,
  Heart,
  ShieldCheck,
  CalendarDays,
  DollarSign,
} from "lucide-react";
import { DoctorNotesPanel } from "@/components/shared/DoctorNotesPanel";
import { CallHistoryButton } from "@/components/shared/CallHistoryButton";
import { CardinalAddressNote } from "@/components/shared/CardinalAddressNote";
import { WelcomeCallProfileStatus } from "@/components/shared/PatientProfileStatus";
import { pumpQtyApplies } from "@/lib/shared/servingLines";

interface Props {
  patient: Patient;
  onFieldChange: (field: keyof Patient, value: string | number | null) => void;
  /** Check-pack results for this patient, used only to tint the fields they
   *  anchor to. The findings themselves are rendered by FinalCheckPanel — this
   *  card never restates them, so a rule has exactly one voice on the page. */
  findings?: CheckFinding[];
}

/** Worst severity per anchored field, red > amber > info. */
function severityByField(findings: CheckFinding[]): Map<keyof Patient, CheckSeverity> {
  const rank: Record<CheckSeverity, number> = { info: 0, amber: 1, red: 2 };
  const map = new Map<keyof Patient, CheckSeverity>();
  for (const f of findings) {
    if (!f.field) continue;
    const prev = map.get(f.field);
    if (!prev || rank[f.severity] > rank[prev]) map.set(f.field, f.severity);
  }
  return map;
}

/**
 * `emptyTone` picks what a BLANK value looks like (Brandon, 2026-09-02).
 *
 * The field had two states — red, or nothing (`suppressWarning`) — and the
 * benefits row wanted neither: eligibility figures are frequently blank
 * without the profile being wrong, so red overstated it, while suppressing
 * left the row indistinguishable from a field nobody needs to fill. Amber is
 * the pack's own word for "a missing input" (§5.17), so the page borrows it.
 *
 * `suppressWarning` still wins over `emptyTone` — it means "this blank is
 * expected", which is a stronger statement than which colour to paint.
 */
type EmptyTone = "red" | "amber";

function EditableTextField({
  icon,
  label,
  value,
  editedValue,
  placeholder,
  onChange,
  suppressWarning,
  emptyTone = "red",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  editedValue?: string | null;
  placeholder?: string;
  onChange: (v: string) => void;
  suppressWarning?: boolean;
  emptyTone?: EmptyTone;
}) {
  const displayValue = editedValue !== undefined && editedValue !== null ? editedValue : value;
  const isEmpty = !displayValue;
  const showWarning = isEmpty && !suppressWarning;
  const amber = showWarning && emptyTone === "amber";
  const red = showWarning && emptyTone === "red";
  return (
    <div className={cn(
      "flex items-start gap-2 min-w-0 rounded-lg p-1.5 -m-1.5 transition-colors",
      red && "bg-red-50 dark:bg-red-950/20 ring-1 ring-red-200 dark:ring-red-800/40",
      amber && "bg-amber-50 dark:bg-amber-950/20 ring-1 ring-amber-200 dark:ring-amber-800/40",
    )}>
      <div className={cn(
        "h-8 w-8 rounded-md flex items-center justify-center shrink-0",
        red ? "bg-red-100 dark:bg-red-900/30 text-red-500"
          : amber ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600"
          : "bg-muted text-muted-foreground",
      )}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{label}</p>
        <Input
          className={cn(
            "h-8 text-sm",
            red && "border-red-300 dark:border-red-700",
            amber && "border-amber-300 dark:border-amber-700",
          )}
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? `Enter ${label.toLowerCase()}`}
        />
      </div>
    </div>
  );
}

function SelectField({
  label,
  icon,
  options,
  value,
  onChange,
  suppressWarning,
  disabled,
  badge,
}: {
  label: string;
  icon?: React.ReactNode;
  options: { index: number; label: string }[];
  value: string;
  onChange: (index: number, label: string) => void;
  suppressWarning?: boolean;
  disabled?: boolean;
  /** Optional chip rendered beside the label. Only the Medicare MAC
   *  jurisdiction pill uses this today — see its note in the Insurance card. */
  badge?: React.ReactNode;
}) {
  const selectedOpt = options.find((o) => o.label === value);
  const isEmpty = !value && !suppressWarning && !disabled;
  const selectContent = (
    <div className={cn(icon ? "min-w-0 flex-1" : "", disabled && "opacity-40 pointer-events-none")}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 flex items-center gap-1.5 flex-wrap">
        {label}{badge}
      </p>
      <Select
        value={selectedOpt ? String(selectedOpt.index) : ""}
        onValueChange={(v) => {
          const opt = options.find((o) => String(o.index) === v);
          if (opt) onChange(opt.index, opt.label);
        }}
        disabled={disabled}
      >
        <SelectTrigger className={cn("h-8 text-sm", isEmpty && "border-red-300 dark:border-red-700")}>
          <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.index} value={String(opt.index)}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  if (!icon) {
    return (
      <div className={cn("rounded-lg p-1.5 -m-1.5 transition-colors", isEmpty && "bg-red-50 dark:bg-red-950/20 ring-1 ring-red-200 dark:ring-red-800/40")}>
        {selectContent}
      </div>
    );
  }

  return (
    <div className={cn("flex items-start gap-2 min-w-0 rounded-lg p-1.5 -m-1.5 transition-colors", isEmpty && "bg-red-50 dark:bg-red-950/20 ring-1 ring-red-200 dark:ring-red-800/40")}>
      <div className={cn("h-8 w-8 rounded-md flex items-center justify-center shrink-0", isEmpty ? "bg-red-100 dark:bg-red-900/30 text-red-500" : "bg-muted text-muted-foreground")}>
        {icon}
      </div>
      {selectContent}
    </div>
  );
}

function CollapsibleSection({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="border-t pt-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors font-semibold"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

/** Paired infusion set + quantity in a visual group */
function InfusionSetPair({
  setLabel,
  setOptions,
  setVal,
  qtyVal,
  onSetChange,
  onQtyChange,
  hasError,
  disabled = false,
  hint,
}: {
  setLabel: string;
  setOptions: { index: number; label: string }[];
  setVal: string;
  qtyVal: string;
  onSetChange: (index: number, label: string) => void;
  onQtyChange: (v: string) => void;
  hasError?: boolean;
  /** True while live board options are loading or failed to load. */
  disabled?: boolean;
  hint?: string | null;
}) {
  const selectedOpt = setOptions.find((o) => o.label === setVal);
  return (
    <div className={cn("rounded-lg border border-dashed p-3 space-y-2", hasError ? "border-red-300 bg-red-50 dark:bg-red-950/20 ring-1 ring-red-200 dark:ring-red-800/40" : "border-muted-foreground/30 bg-muted/20")}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{setLabel}</p>
      <Select
        value={selectedOpt ? String(selectedOpt.index) : ""}
        onValueChange={(v) => {
          const opt = setOptions.find((o) => String(o.index) === v);
          if (opt) onSetChange(opt.index, opt.label);
        }}
        disabled={disabled}
      >
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder="Select infusion set" />
        </SelectTrigger>
        <SelectContent>
          {setOptions.map((opt) => (
            <SelectItem key={opt.index} value={String(opt.index)}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">Qty:</span>
        <Input
          className="h-8 text-sm w-20"
          type="number"
          value={qtyVal}
          onChange={(e) => onQtyChange(e.target.value)}
          placeholder="0"
        />
      </div>
    </div>
  );
}

/** Auth detail sub-fields shown under each auth result when data exists */
function AuthDetailBlock({
  authId,
  authStart,
  authEnd,
  authUnits,
}: {
  authId: string;
  authStart: string;
  authEnd: string;
  authUnits: string;
}) {
  if (!authId && !authStart && !authEnd && !authUnits) return null;
  return (
    <div className="mt-2 pl-10 space-y-1.5 text-xs">
      {/* Auth ID row — full width */}
      {authId && (
        <div>
          <span className="text-muted-foreground">Auth ID:</span>{" "}
          <span className="font-semibold font-mono">{authId}</span>
        </div>
      )}
      {/* Start + End side by side */}
      {(authStart || authEnd) && (
        <div className="flex items-center gap-4">
          {authStart && (
            <div>
              <span className="text-muted-foreground">Start:</span>{" "}
              <span className="font-medium">{formatDateMDY(authStart)}</span>
            </div>
          )}
          {authEnd && (
            <div>
              <span className="text-muted-foreground">End:</span>{" "}
              <span className="font-medium">{formatDateMDY(authEnd)}</span>
            </div>
          )}
        </div>
      )}
      {authUnits && (
        <div>
          <span className="text-muted-foreground">Units:</span>{" "}
          <span className="font-medium">{authUnits}</span>
        </div>
      )}
    </div>
  );
}

/** Editable date field — always renders; highlights empty as missing.
 *  Stores value as YYYY-MM-DD internally.
 *
 *  ⚠️ Empty is AMBER, not red (Brandon, 2026-09-02). Used only by the Last Bill
 *  Dates block, whose five fields are empty together on any patient we have not
 *  billed yet — a new patient, or one served on lines this profile does not
 *  carry. That is the ordinary case, not evidence the profile is wrong, so a
 *  wall of five red boxes was the pack's own severity language pointed at
 *  nothing. Amber matches the meaning the panel already assigns it: red = we
 *  believe this is wrong, amber = worth a look. */
function EditableDateField({
  label,
  dateStr,
  onChange,
}: {
  label: string;
  dateStr: string;
  onChange: (v: string) => void;
}) {
  const isEmpty = !dateStr;
  return (
    <div className={cn("rounded-lg p-1.5 -m-1.5 transition-colors", isEmpty && "bg-amber-50 dark:bg-amber-950/20 ring-1 ring-amber-200 dark:ring-amber-800/40")}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{label}</p>
      <Input
        type="date"
        className={cn("h-8 text-sm", isEmpty && "border-amber-300 dark:border-amber-700")}
        value={dateStr}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Editable next-order date — always renders; green if ready (today or past),
 *  red outline if empty and active. Faded when not active (product not being ordered). */
function EditableNextOrderDateField({
  label,
  dateStr,
  onChange,
  active = true,
}: {
  label: string;
  dateStr: string;
  onChange: (v: string) => void;
  active?: boolean;
}) {
  const isEmpty = !dateStr;
  let colorClass = "";
  if (dateStr) {
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      colorClass = d <= today ? "ring-green-300 bg-green-50 dark:bg-green-950/20" : "";
    }
  }
  const showWarning = isEmpty && active;
  return (
    <div className={cn(
      "rounded-lg p-1.5 -m-1.5 transition-colors",
      !active && "opacity-40",
      showWarning && "bg-red-50 dark:bg-red-950/20 ring-1 ring-red-200 dark:ring-red-800/40",
      !isEmpty && colorClass && active && `ring-1 ${colorClass}`,
    )}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{label}</p>
      <Input
        type="date"
        className={cn("h-8 text-sm", showWarning && "border-red-300 dark:border-red-700")}
        value={dateStr}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Diagnosis combobox — fully dynamic from Monday's column settings.
 *  Fetches all labels + indexes live, and lets the user add new ICD-10 codes. */
function DiagnosisCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (label: string, index: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [customCodes, setCustomCodes] = useState<string[]>([]);
  const [mondayOptions, setMondayOptions] = useState<
    { index: number; label: string }[] | null
  >(null);

  // Fetch live diagnosis options (label + index) from Monday on first open
  useEffect(() => {
    if (!open || mondayOptions !== null) return;
    if (!hasToken()) return;
    fetchStatusOptions(COL.diagnosis)
      .then((opts) => setMondayOptions(opts))
      .catch(() => setMondayOptions([]));
  }, [open, mondayOptions]);

  const mondayLabels = useMemo(
    () => (mondayOptions ?? []).map((o) => o.label),
    [mondayOptions],
  );

  const allCodes = useMemo(() => {
    const set = new Set<string>(mondayLabels);
    for (const c of customCodes) set.add(c);
    return [...set].sort();
  }, [mondayLabels, customCodes]);

  const findIndex = (label: string): number | null =>
    mondayOptions?.find((o) => o.label === label)?.index ?? null;

  const handleAddCode = () => {
    const code = newCode.trim().toUpperCase();
    if (!code) return;
    if (!allCodes.includes(code)) setCustomCodes((prev) => [...prev, code]);
    onChange(code, findIndex(code));
    setNewCode("");
    setOpen(false);
  };

  const isEmpty = !value;
  const itemClass =
    "text-xs cursor-pointer text-foreground data-[selected=true]:bg-emerald-100 data-[selected=true]:text-emerald-900 aria-selected:bg-emerald-100 aria-selected:text-emerald-900";

  const renderItem = (code: string) => (
    <CommandItem
      key={code}
      value={code}
      onSelect={() => {
        onChange(code === value ? "" : code, code === value ? null : findIndex(code));
        setOpen(false);
      }}
      className={itemClass}
    >
      <Check className={cn("mr-2 h-3 w-3", value === code ? "opacity-100" : "opacity-0")} />
      {code}
    </CommandItem>
  );

  return (
    <div className={cn("flex items-start gap-2 min-w-0 rounded-lg p-1.5 -m-1.5 transition-colors", isEmpty && "bg-red-50 dark:bg-red-950/20 ring-1 ring-red-200 dark:ring-red-800/40")}>
      <div className={cn("h-8 w-8 rounded-md flex items-center justify-center shrink-0", isEmpty ? "bg-red-100 dark:bg-red-900/30 text-red-500" : "bg-muted text-muted-foreground")}>
        <Heart className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Diagnosis</p>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              /* ⚠️ A FILLED diagnosis gets no colour of its own (Brandon,
                 2026-09-02). It used to render emerald-on-emerald, which made it
                 the one green control on the page — every neighbouring field
                 (Serving, Request Type, both Coverage Paths…) is a plain
                 `SelectField`, neutral when filled and red-ringed when empty. A
                 lone green box reads as a status, and the only status it could
                 have meant — "this one is answered" — is true of every filled
                 field beside it. Empty keeps the red ring the others use. */
              className={cn(
                "w-full h-8 px-3 text-xs font-medium justify-between",
                isEmpty && "border-red-300 dark:border-red-700",
              )}
            >
              {value || "Select diagnosis…"}
              <ChevronsUpDown className="h-3 w-3 opacity-50 shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search ICD-10…" className="h-9" />
              <CommandList>
                <CommandEmpty>
                  <span className="text-xs text-muted-foreground">No matching code — add it below.</span>
                </CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    key="__none__"
                    value="(none)"
                    onSelect={() => { onChange("", null); setOpen(false); }}
                    className={itemClass + " text-muted-foreground italic"}
                  >
                    <X className="mr-2 h-3 w-3" />
                    (none)
                  </CommandItem>
                </CommandGroup>
                <CommandGroup heading="Diagnosis Codes">
                  {allCodes.map(renderItem)}
                </CommandGroup>
              </CommandList>
            </Command>
            <div className="border-t px-2 py-2 flex items-center gap-2">
              <input
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddCode(); } }}
                placeholder="New ICD-10 code…"
                className="flex-1 h-7 px-2 text-xs border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-emerald-400"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs gap-1"
                disabled={!newCode.trim()}
                onClick={handleAddCode}
              >
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

export function PatientInfoCard({ patient, onFieldChange, findings = [] }: Props) {
  const fieldSeverity = useMemo(() => severityByField(findings), [findings]);

  /**
   * Medicare A&B MAC jurisdiction pill, beside Primary Insurance
   * (Brandon, 2026-09-02 — flagged as temporary; delete this block, the
   * `badge` prop and the `medicareJurisdiction` import together).
   *
   * Display only. Writes nothing, gates nothing, and is unrelated to the
   * `stediMedicareJurisdiction` column, which is separate Stedi output.
   *
   * ⚠️ Gated on `isMedicarePrimary`, NOT the `isMedicareABOnly` that the
   * Benefits panel's own pill uses — so this one also shows for a Medicare
   * A&B patient WHO HAS a secondary. That is deliberate and it is the ask
   * ("if it says medicare A&B"): the MAC is decided by Medicare being the
   * primary payer, and a supplement sitting behind it does not move the
   * claim to another jurisdiction. Benefits is stricter because its pill is
   * paired with a no-secondary hazard reminder. Don't "align" them without
   * checking which question each is answering.
   *
   * Address, not the payer label, is the input — and it is the EDITED
   * address when the rep has changed one, matching what the check pack
   * resolves C1/C23 against, so the pill can't disagree with the POS
   * warning sitting a card above it.
   */
  const macPill = useMemo(() => {
    if (!isMedicarePrimary(patient.primaryInsurance)) return null;
    const state = stateFromAddress(patient.addressEdited ?? patient.address ?? "");
    const jurisdiction = medicareJurisdictionForState(state);
    // No pill rather than a guess when the address has no usable state — an
    // unmapped territory, or an address that hasn't been filled in yet.
    if (!jurisdiction) return null;
    return { jurisdiction, state, contractor: MAC_CONTRACTORS[jurisdiction] };
  }, [patient.primaryInsurance, patient.addressEdited, patient.address]);
  // Infusion-set options are read from the LIVE board, never a hardcoded table.
  // Final Confirm and Welcome Call write the SAME two columns, and their
  // hardcoded tables had already drifted apart from each other ("6mm" here vs
  // "6 mm" there) — invisible, because only the index reaches Monday.
  // See `lib/shared/statusOptions.ts`.
  const { options: liveOptions, loading: optionsLoading, error: optionsError, ready: optionsReady } =
    useStatusOptions(BOARD_ID, [COL.infusionSet1, COL.infusionSet2]);
  const infusionSet1Options = liveOptions[COL.infusionSet1] ?? [];
  const infusionSet2Options = liveOptions[COL.infusionSet2] ?? [];
  const infusionDisabled = !optionsReady;
  const infusionHint = optionsError
    ? `Couldn't load infusion sets from Monday: ${optionsError}`
    : optionsLoading
      ? "Loading infusion sets from Monday…"
      : null;

  const handleAddressChange = (result: AddressResult) => {
    onFieldChange("addressEdited", result.address);
    onFieldChange("addressLat", result.lat);
    onFieldChange("addressLng", result.lng);
  };

  const handleClinicAddressChange = (result: AddressResult) => {
    onFieldChange("clinicAddressEdited", result.address);
    onFieldChange("clinicAddressLat", result.lat);
    onFieldChange("clinicAddressLng", result.lng);
  };

  // Subscription-aware helpers for next order date styling
  const subType = patient.subscriptionType;
  const sensorsActive = subType === "Sensors" || subType === "Sensors & Supplies";
  const suppliesActive = subType === "Supplies" || subType === "Sensors & Supplies";

  // Pump Qty applies only when Serving sells an actual insulin pump DEVICE —
  // NOT `servingIncludesPump`, which is also true for `Supplies …` because
  // infusion sets are pump supplies (Bradan French, 2026-08-03; see
  // lib/shared/servingLines.ts). The field goes read-only rather than
  // self-correcting: Serving is editable right here, so the fix is to say what
  // is actually being served. `mondayWrite` coerces the value to 0 on send
  // either way, and C27 states it in the check panel and the send dialog.
  const canSellPump = pumpQtyApplies(patient.serving);

  // Prior Pump Purchase Date: Original Medicare (Medicare A&B) patients only,
  // only when Pump Qty is 0 (not "1"), and only when serving includes pump
  // supplies — a CGM-only patient is never asked for it.
  const showPriorPumpDate = needsPriorPumpDate(patient.primaryInsurance, patient.pumpQty, patient.serving);

  // Clear a stale prior-pump date if the patient stops being eligible (insurance
  // changed away from Medicare A&B, Pump Qty set to 1, or serving changed to
  // CGM-only). Final Confirm always writes this column, so zeroing local state
  // clears the Monday cell on save.
  useEffect(() => {
    if (!showPriorPumpDate && patient.medicarePriorPumpDate) {
      onFieldChange("medicarePriorPumpDate", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, showPriorPumpDate, patient.medicarePriorPumpDate]);

  // Monitor Purchase Date is DERIVED (Brandon, 2026-08-13) — see
  // lib/shared/monitorPurchaseDate.ts. One call both fills and clears: it keeps
  // any value already present, so it can never overwrite what the rep typed,
  // and returns "" once the patient stops being eligible, which is what clears
  // the Monday cell on save (this stage always writes the column).
  const showMonitorPurchaseDate = needsMonitorPurchaseDate(
    patient.primaryInsurance,
    patient.monitorQty,
    patient.serving,
  );
  const derivedMonitorPurchaseDate = deriveMonitorPurchaseDate({
    current: patient.monitorPurchaseDate,
    primaryInsurance: patient.primaryInsurance,
    monitorQty: patient.monitorQty,
    serving: patient.serving,
    sosLastBillMonitor: patient.sosLastBillMonitor,
    sosNeverBilledMonitor: patient.sosNeverBilledMonitor,
  });
  useEffect(() => {
    if (derivedMonitorPurchaseDate !== patient.monitorPurchaseDate) {
      onFieldChange("monitorPurchaseDate", derivedMonitorPurchaseDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, derivedMonitorPurchaseDate, patient.monitorPurchaseDate]);

  // Infusion set validation: if serving requires supplies, infusion set 1 must be selected with qty
  const isCgmOnly = patient.serving === "CGM";
  const servingRequiresInfusion = ["Insulin Pump", "Supplies Only", "Supplies + CGM", "Insulin Pump + CGM"].includes(patient.serving);
  const infSet1Missing = servingRequiresInfusion && !patient.infusionSet1;
  const infQty1Missing = servingRequiresInfusion && (!patient.qtyInf1 || patient.qtyInf1 === "0");

  // Qty Cartridge defaults to 3 (Josh, 2026-07): pre-fill once when blank so
  // an untouched confirm still writes 3. Gated on servingRequiresInfusion —
  // NOT !isCgmOnly — so a split order's sensors side (which deliberately
  // clears the cell) never gets 3 stamped back onto it.
  useEffect(() => {
    if (servingRequiresInfusion && !patient.qtyCartridge) onFieldChange("qtyCartridge", "3");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, servingRequiresInfusion, patient.qtyCartridge]);

  return (
    <div className="space-y-4">
      {/* Patient name + phone header */}
      <Card className="p-4 flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <EditableTextField
            label="Patient Name"
            value={patient.name}
            onChange={(v) => onFieldChange("name", v)}
            icon={<User className="h-4 w-4" />}
          />
          <WelcomeCallProfileStatus patient={patient} size="sm" className="mt-1.5" />
        </div>
        {patient.phone && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Phone</p>
            <div className="flex items-center justify-end gap-1.5">
              <a href={`tel:${patient.phone}`} className="text-lg font-semibold text-primary hover:underline">
                {formatPhone(patient.phoneEdited ?? patient.phone)}
              </a>
              <CallHistoryButton
                phone={patient.phoneEdited ?? patient.phone}
                display={formatPhone(patient.phoneEdited ?? patient.phone)}
              />
            </div>
          </div>
        )}
      </Card>

      {/* Demographics */}
      <Card className="p-4 space-y-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
          <User className="h-3.5 w-3.5" /> Demographics
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <EditableTextField
            icon={<Stethoscope className="h-4 w-4" />}
            label="DOB"
            value={patient.dob}
            onChange={(v) => onFieldChange("dob", v)}
          />
          <EditableTextField
            icon={<Phone className="h-4 w-4" />}
            label="Phone"
            value={patient.phone}
            editedValue={patient.phoneEdited}
            onChange={(v) => onFieldChange("phoneEdited", v)}
          />
          <EditableTextField
            icon={<Mail className="h-4 w-4" />}
            label="Email"
            value={patient.email}
            editedValue={patient.emailEdited}
            onChange={(v) => onFieldChange("emailEdited", v)}
            suppressWarning
          />
          <SelectField
            label="Gender"
            icon={<User className="h-4 w-4" />}
            options={GENDER_OPTIONS}
            value={patient.gender}
            onChange={(index) => {
              onFieldChange("genderIndex", index);
              const opt = GENDER_OPTIONS.find((o) => o.index === index);
              if (opt) onFieldChange("gender", opt.label);
            }}
          />
          {/* Referral fields — read-only display */}
          <div className="flex items-start gap-2 min-w-0 rounded-lg p-1.5 -m-1.5">
            <div className="h-8 w-8 rounded-md flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
              <UserRound className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Referral Type</p>
              <p className="text-sm h-8 flex items-center">{patient.referralType || <span className="text-muted-foreground italic">—</span>}</p>
            </div>
          </div>
          <div className="flex items-start gap-2 min-w-0 rounded-lg p-1.5 -m-1.5">
            <div className="h-8 w-8 rounded-md flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
              <UserRound className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Referral Source</p>
              <p className="text-sm h-8 flex items-center">{patient.referralSource || <span className="text-muted-foreground italic">—</span>}</p>
            </div>
          </div>
        </div>
        {/* Address — full width with Google autocomplete */}
        {(() => {
          const addr = patient.addressEdited ?? patient.address;
          // The ALL-CAPS / missing-zip rules that used to be re-derived here
          // now live in the check pack (C22_*), which owns them for the whole
          // page \u2014 one warning system, one visual language. All that stays
          // local is the ring, driven by whatever the pack anchored to
          // `address` (C23's stale-POS warning included, since address is what
          // drives POS). A blank address still rings on its own: the pack is
          // silent on missing inputs by design.
          const severity = fieldSeverity.get("address");
          const hasError = !addr || severity === "red";
          const hasWarning = !hasError && severity === "amber";
          return (
            <div className={cn(
              "flex items-start gap-2 min-w-0 rounded-lg p-1.5 -m-1.5 transition-colors",
              hasError && "bg-red-50 dark:bg-red-950/20 ring-1 ring-red-200 dark:ring-red-800/40",
              hasWarning && "bg-amber-50 dark:bg-amber-950/20 ring-1 ring-amber-200 dark:ring-amber-800/40",
            )}>
              <div className={cn(
                "h-8 w-8 rounded-md flex items-center justify-center shrink-0",
                hasError
                  ? "bg-red-100 dark:bg-red-900/30 text-red-500"
                  : hasWarning
                    ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600"
                    : "bg-muted text-muted-foreground",
              )}>
                <MapPin className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Address</p>
                <AddressAutocomplete
                  value={addr}
                  onChange={handleAddressChange}
                  placeholder="Start typing address\u2026"
                />
                <CardinalAddressNote address={addr} />
              </div>
            </div>
          );
        })()}

        {/* POS \u2014 computed and written at Welcome Call from Primary Insurance +
            address; shown here so it is visible and overridable at the last
            gate. Nothing recomputes it at this stage: if the rep's value
            contradicts the rule, C23_POS_STALE says so in the panel and the
            send dialog, and the override lands in the audit note. Sits beside
            Address because address state is the rule's sole driver. */}
        {/* ⚠️ A blank POS reads GRAY, not red (Brandon, 2026-09-02). It is
            computed and written at Welcome Call, not typed here, so an empty
            one is a stage that has not run rather than a rep who skipped a
            field — and C23 still speaks up in the panel when the value that
            IS there contradicts the address rule. `suppressWarning` only
            removes the ring; it takes nothing away from the check pack. */}
        <SelectField
          label="POS (Place of Service)"
          icon={<MapPin className="h-4 w-4" />}
          options={POS_OPTIONS}
          value={patient.pos}
          onChange={(index, label) => {
            onFieldChange("posIndex", index);
            onFieldChange("pos", label);
          }}
          suppressWarning
        />
      </Card>

      {/* Insurance */}
      <Card className="p-4 space-y-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
          <Shield className="h-3.5 w-3.5" /> Insurance
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SelectField
            label="Primary Insurance"
            icon={<Shield className="h-4 w-4" />}
            options={PRIMARY_INSURANCE_OPTIONS}
            value={patient.primaryInsurance}
            onChange={(index) => {
              onFieldChange("primaryInsuranceIndex", index);
              const opt = PRIMARY_INSURANCE_OPTIONS.find((o) => o.index === index);
              if (opt) onFieldChange("primaryInsurance", opt.label);
            }}
            badge={macPill && (
              <span
                title={`Medicare A&B MAC jurisdiction for ${macPill.state} — ${macPill.contractor}. Fee schedules and portals differ per jurisdiction.`}
                className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider cursor-help bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-800/40"
              >
                JUR {macPill.jurisdiction} · {macPill.state}
              </span>
            )}
          />
          <EditableTextField
            icon={<IdCard className="h-4 w-4" />}
            label="Member ID 1"
            value={patient.memberId1}
            onChange={(v) => onFieldChange("memberId1", v)}
          />
          <SelectField
            label="Secondary Insurance"
            icon={<Shield className="h-4 w-4" />}
            options={SECONDARY_INSURANCE_OPTIONS}
            value={patient.secondaryInsuranceEdited ?? patient.secondaryInsurance}
            onChange={(index, label) => {
              onFieldChange("secondaryInsuranceIndex", index);
              onFieldChange("secondaryInsuranceEdited", label);
            }}
          />
          <EditableTextField
            icon={<IdCard className="h-4 w-4" />}
            label="Member ID 2"
            value={patient.memberId2}
            editedValue={patient.memberId2Edited}
            placeholder="Enter member ID"
            onChange={(v) => onFieldChange("memberId2Edited", v)}
            suppressWarning={(patient.secondaryInsuranceEdited ?? patient.secondaryInsurance) === "None" || !(patient.secondaryInsuranceEdited ?? patient.secondaryInsurance)}
          />
        </div>
        {/* Plan Name — read-only from Monday dropdown */}
        {patient.planName && (
          <div className="flex items-start gap-2 min-w-0 rounded-lg p-1.5 -m-1.5">
            <div className="h-8 w-8 rounded-md flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
              <Shield className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Plan Name</p>
              <p className="text-sm h-8 flex items-center font-medium">{patient.planName}</p>
            </div>
          </div>
        )}
        <div className="h-px bg-border" />
        {/* ⚠️ All five eligibility figures are AMBER when blank, never red and
            never silent (Brandon, 2026-09-02). They came from Stedi at Profile
            Send Off and are routinely blank for reasons that say nothing about
            this profile — a payer that returns no cost-sharing, or a plan that
            has none — so red overstated it. Co-Ins % had the opposite problem:
            it carried `suppressWarning`, so it was the one figure of the five
            that looked deliberately blank. One tone across the row, because
            the rep reads them as one answer. */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <EditableTextField
            icon={<Activity className="h-4 w-4" />}
            label="Deductible"
            value={patient.deductible}
            onChange={(v) => onFieldChange("deductible", v)}
            emptyTone="amber"
          />
          <EditableTextField
            icon={<Activity className="h-4 w-4" />}
            label="Ded. Remaining"
            value={patient.deductibleRemaining}
            onChange={(v) => onFieldChange("deductibleRemaining", v)}
            emptyTone="amber"
          />
          <EditableTextField
            icon={<Activity className="h-4 w-4" />}
            label="Co-Ins %"
            value={patient.coInsurance}
            onChange={(v) => onFieldChange("coInsurance", v)}
            emptyTone="amber"
          />
          <EditableTextField
            icon={<Activity className="h-4 w-4" />}
            label="OOP Max"
            value={patient.oopMax}
            onChange={(v) => onFieldChange("oopMax", v)}
            emptyTone="amber"
          />
          <EditableTextField
            icon={<Activity className="h-4 w-4" />}
            label="OOP Remaining"
            value={patient.oopMaxRemaining}
            onChange={(v) => onFieldChange("oopMaxRemaining", v)}
            emptyTone="amber"
          />
        </div>
        {patient.referralSource === "CareCentrix" && (
          <>
            <div className="h-px bg-border" />
            <EditableTextField
              icon={<IdCard className="h-4 w-4" />}
              label="Carecentrix Intake I.D."
              value={patient.carecentrixIntakeId}
              onChange={(v) => onFieldChange("carecentrixIntakeId", v)}
              suppressWarning
            />
          </>
        )}
      </Card>

      {/* Doctor Info */}
      <Card className="p-4 space-y-4">
        <CollapsibleSection title="Doctor Info" defaultOpen>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <EditableTextField
              icon={<UserRound className="h-4 w-4" />}
              label="Doctor Name"
              value={patient.doctorName}
              onChange={(v) => onFieldChange("doctorName", v)}
              suppressWarning
            />
            <EditableTextField
              icon={<Hash className="h-4 w-4" />}
              label="NPI"
              value={patient.doctorNpi}
              onChange={(v) => onFieldChange("doctorNpi", v)}
              suppressWarning
            />
            <EditableTextField
              icon={<Phone className="h-4 w-4" />}
              label="Doctor Phone"
              value={patient.doctorPhone}
              onChange={(v) => onFieldChange("doctorPhone", v)}
              suppressWarning
            />
            <EditableTextField
              icon={<Mail className="h-4 w-4" />}
              label="Doctor Email"
              value={patient.doctorEmail}
              onChange={(v) => onFieldChange("doctorEmail", v)}
              suppressWarning
            />
            <EditableTextField
              icon={<Send className="h-4 w-4" />}
              label="Fax"
              value={patient.doctorFax}
              onChange={(v) => onFieldChange("doctorFax", v)}
              suppressWarning
            />
            <SelectField
              label="Clinicals Method"
              icon={<Send className="h-4 w-4" />}
              options={CLINICALS_METHOD_OPTIONS}
              value={patient.clinicalsMethod}
              onChange={(index) => {
                onFieldChange("clinicalsMethodIndex", index);
                const opt = CLINICALS_METHOD_OPTIONS.find((o) => o.index === index);
                if (opt) onFieldChange("clinicalsMethod", opt.label);
              }}
              suppressWarning
            />
            <EditableTextField
              icon={<Building2 className="h-4 w-4" />}
              label="Clinic"
              value={patient.clinicName}
              onChange={(v) => onFieldChange("clinicName", v)}
              suppressWarning
            />
          </div>
          {/* Clinic Address — full width with Google autocomplete.
              Rings and reads exactly like the patient address above, because it
              is the SECOND address Cardinal validates on every order
              (doctorInfo.address) — and the one that fails far more often: 46
              of 1151 rows on the orders board vs 6 patient addresses, audited
              2026-08-18. Before that audit nothing in the app looked at it. */}
          {(() => {
            const clinicAddr = patient.clinicAddressEdited ?? patient.clinicAddress;
            const severity = fieldSeverity.get("clinicAddress");
            const hasError = severity === "red";
            const hasWarning = !hasError && severity === "amber";
            return (
              <div className={cn(
                "flex items-start gap-2 min-w-0 rounded-lg p-1.5 mt-2 transition-colors",
                hasError && "bg-red-50 dark:bg-red-950/20 ring-1 ring-red-200 dark:ring-red-800/40",
                hasWarning && "bg-amber-50 dark:bg-amber-950/20 ring-1 ring-amber-200 dark:ring-amber-800/40",
              )}>
                <div className={cn(
                  "h-8 w-8 rounded-md flex items-center justify-center shrink-0",
                  hasError
                    ? "bg-red-100 dark:bg-red-900/30 text-red-500"
                    : hasWarning
                      ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600"
                      : "bg-muted text-muted-foreground",
                )}>
                  <MapPin className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Clinic Address</p>
                  <AddressAutocomplete
                    value={clinicAddr}
                    onChange={handleClinicAddressChange}
                    placeholder="Start typing clinic address…"
                  />
                  <CardinalAddressNote address={clinicAddr} />
                </div>
              </div>
            );
          })()}
        </CollapsibleSection>

        {/* Doctor-level notes from the Doctor Database */}
        {patient.doctorNpi && (
          <DoctorNotesPanel doctorNpi={patient.doctorNpi} doctorName={patient.doctorName} compact />
        )}
      </Card>

      {/* Medical Necessity */}
      <Card className="p-4 space-y-4">
        <CollapsibleSection title="Medical Necessity" defaultOpen>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DiagnosisCombobox
              value={patient.diagnosis}
              onChange={(label, index) => {
                onFieldChange("diagnosis", label);
                onFieldChange("diagnosisIndex", index);
              }}
            />
            <EditableTextField
              icon={<Stethoscope className="h-4 w-4" />}
              label="MR Expiry Date"
              value={patient.mrExpiryDate}
              onChange={(v) => onFieldChange("mrExpiryDate", v)}
            />
            <SelectField
              label="CGM Coverage Path"
              icon={<Activity className="h-4 w-4" />}
              options={CGM_COVERAGE_PATH_OPTIONS}
              value={patient.cgmCoveragePath}
              onChange={(index) => {
                onFieldChange("cgmCoveragePathIndex", index);
                const opt = CGM_COVERAGE_PATH_OPTIONS.find((o) => o.index === index);
                if (opt) onFieldChange("cgmCoveragePath", opt.label);
              }}
              suppressWarning={patient.subscriptionType === "Supplies"}
            />
            <SelectField
              label="IP Coverage Path"
              icon={<Activity className="h-4 w-4" />}
              options={IP_COVERAGE_PATH_OPTIONS}
              value={patient.ipCoveragePath}
              onChange={(index) => {
                onFieldChange("ipCoveragePathIndex", index);
                const opt = IP_COVERAGE_PATH_OPTIONS.find((o) => o.index === index);
                if (opt) onFieldChange("ipCoveragePath", opt.label);
              }}
            />
          </div>
        </CollapsibleSection>
      </Card>

      {/* Product / Order Info */}
      <Card className="p-4 space-y-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
          <Package className="h-3.5 w-3.5" /> Product & Order Info
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SelectField
            label="Serving"
            icon={<Package className="h-4 w-4" />}
            options={SERVING_OPTIONS}
            value={patient.serving}
            onChange={(index) => {
              onFieldChange("servingIndex", index);
              const opt = SERVING_OPTIONS.find((o) => o.index === index);
              if (opt) onFieldChange("serving", opt.label);
            }}
          />
          <SelectField
            label="Request Type"
            icon={<Package className="h-4 w-4" />}
            options={REQUEST_TYPE_OPTIONS}
            value={patient.requestType}
            onChange={(index) => {
              onFieldChange("requestTypeIndex", index);
              const opt = REQUEST_TYPE_OPTIONS.find((o) => o.index === index);
              if (opt) onFieldChange("requestType", opt.label);
            }}
          />
          <SelectField
            label="CGM Type"
            icon={<Package className="h-4 w-4" />}
            options={CGM_TYPE_OPTIONS}
            value={patient.cgmType}
            onChange={(index) => {
              onFieldChange("cgmTypeIndex", index);
              const opt = CGM_TYPE_OPTIONS.find((o) => o.index === index);
              if (opt) onFieldChange("cgmType", opt.label);
            }}
          />
          <SelectField
            label="Pump Type"
            icon={<Package className="h-4 w-4" />}
            options={PUMP_TYPE_OPTIONS}
            value={patient.pumpType}
            onChange={(index) => {
              onFieldChange("pumpTypeIndex", index);
              const opt = PUMP_TYPE_OPTIONS.find((o) => o.index === index);
              if (opt) onFieldChange("pumpType", opt.label);
            }}
            disabled={patient.serving === "CGM"}
            suppressWarning={patient.serving === "CGM"}
          />
        </div>

        <div className="h-px bg-border" />

        {/* Monitor Qty + Pump Qty (+ the two Original-Medicare purchase dates) */}
        <div
          className={`grid grid-cols-1 ${
            showPriorPumpDate && showMonitorPurchaseDate
              ? "sm:grid-cols-2 lg:grid-cols-4"
              : showPriorPumpDate || showMonitorPurchaseDate
                ? "sm:grid-cols-3"
                : "sm:grid-cols-2"
          } gap-4`}
        >
          <div className="flex items-start gap-2 min-w-0 rounded-lg p-1.5 -m-1.5">
            <div className="h-8 w-8 rounded-md flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
              <Package className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Monitor Qty</p>
              <Input
                className="h-8 text-sm"
                type="number"
                value={patient.monitorQty}
                onChange={(e) => onFieldChange("monitorQty", e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          <div className="flex items-start gap-2 min-w-0 rounded-lg p-1.5 -m-1.5">
            <div className="h-8 w-8 rounded-md flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
              <Package className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Pump Qty</p>
              <Input
                className="h-8 text-sm"
                type="number"
                value={patient.pumpQty}
                onChange={(e) => onFieldChange("pumpQty", e.target.value)}
                placeholder="0"
                disabled={!canSellPump}
              />
              {/* The "Serving is X — no insulin pump. Sent as 0." note was
                  removed here (Brandon, 2026-09-02): the greyed-out, disabled
                  input already says the field is not in play, and the sentence
                  restated it on every CGM-only and supplies-only profile. The
                  BEHAVIOUR is untouched — `coercePumpQty` still zeroes the
                  quantity in all three send paths (§5.22), which is what
                  actually stops a pump shipping to somebody who owns one. */}
            </div>
          </div>

          {/* Prior Pump Purchase Date — Original Medicare + Pump Qty 0 + pump-supplies serving only */}
          {showPriorPumpDate && (
            <div className="flex items-start gap-2 min-w-0 rounded-lg p-1.5 -m-1.5">
              <div className="h-8 w-8 rounded-md flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
                <Package className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Prior Pump Purchase Date</p>
                <Input
                  className="h-8 text-sm"
                  value={patient.medicarePriorPumpDate}
                  onChange={(e) => onFieldChange("medicarePriorPumpDate", e.target.value)}
                  placeholder="MM/YYYY"
                />
                <p className="mt-1 flex items-start gap-1 text-[10px] text-amber-700 dark:text-amber-400 leading-snug">
                  <Lightbulb className="h-3 w-3 shrink-0 mt-0.5" />
                  <span>If SoS is completely clear for Insulin Pump and Supplies, ask patient for approximate date they got their pump</span>
                </p>
              </div>
            </div>
          )}

          {/* Monitor Purchase Date — Original Medicare + Monitor Qty 0 + CGM serving only */}
          {showMonitorPurchaseDate && (
            <div className="flex items-start gap-2 min-w-0 rounded-lg p-1.5 -m-1.5">
              <div className="h-8 w-8 rounded-md flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
                <Package className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Monitor Purchase Date</p>
                <Input
                  className="h-8 text-sm"
                  value={patient.monitorPurchaseDate}
                  onChange={(e) => onFieldChange("monitorPurchaseDate", e.target.value)}
                  placeholder="MM/YYYY"
                />
                <p className="mt-1 flex items-start gap-1 text-[10px] text-amber-700 dark:text-amber-400 leading-snug">
                  <Lightbulb className="h-3 w-3 shrink-0 mt-0.5" />
                  <span>
                    {patient.sosLastBillMonitor
                      ? "Filled from the monitor's SoS last bill date — confirm with the patient if it looks wrong."
                      : patient.sosNeverBilledMonitor
                        ? "Estimated — SoS shows no billing history for the monitor. Replace it if the patient knows when they got it."
                        : "Ask patient for the approximate date they got their current monitor"}
                  </span>
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="h-px bg-border" />

        {/* Subscription Type — centered */}
        <div className="max-w-md mx-auto">
          <SelectField
            label="Subscription Type"
            options={SUBSCRIPTION_TYPE_OPTIONS}
            value={patient.subscriptionType}
            onChange={(index) => {
              onFieldChange("subscriptionTypeIndex", index);
              const opt = SUBSCRIPTION_TYPE_OPTIONS.find((o) => o.index === index);
              if (opt) onFieldChange("subscriptionType", opt.label);
              // When "Sensors" is selected, auto-set infusion sets to "Not Serving".
              // Resolved from the live board, not the old hardcoded 101 — that
              // index is only correct until someone edits the column, and a wrong
              // index writes a blank without erroring.
              //
              // If either can't resolve (options still loading, or the fetch
              // failed) the clear MUST NOT be skipped silently: the patient would
              // keep the pump-side infusion set while being marked sensors-only,
              // and Final Confirm would write that product index onto a sensors
              // record with nothing flagging the contradiction. Say so instead.
              if (opt && opt.label === "Sensors") {
                const ns1 = indexForLabel(infusionSet1Options, "Not Serving");
                const ns2 = indexForLabel(infusionSet2Options, "Not Serving");
                if (ns1 === null || ns2 === null) {
                  toast.error("Infusion sets were NOT cleared", {
                    description:
                      "Options haven't loaded from Monday, so \"Not Serving\" couldn't be resolved. Re-select Sensors once the infusion set dropdowns are enabled, or set them by hand before sending.",
                    duration: 12_000,
                  });
                } else {
                  onFieldChange("infusionSet1Index", ns1);
                  onFieldChange("infusionSet1", "Not Serving");
                  onFieldChange("infusionSet2Index", ns2);
                  onFieldChange("infusionSet2", "Not Serving");
                }
              }
            }}
          />
        </div>

        {!isCgmOnly && (
          <>
            <div className="h-px bg-border" />

            {/* Infusion Sets — visually paired with their quantities */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <InfusionSetPair
                  setLabel="Infusion Set 1"
                  setOptions={infusionSet1Options}
                  disabled={infusionDisabled}
                  hint={infusionHint}
                  setVal={patient.infusionSet1}
                  qtyVal={patient.qtyInf1}
                  onSetChange={(index) => {
                    onFieldChange("infusionSet1Index", index);
                    const opt = infusionSet1Options.find((o) => o.index === index);
                    if (opt) onFieldChange("infusionSet1", opt.label);
                  }}
                  onQtyChange={(v) => onFieldChange("qtyInf1", v)}
                  hasError={infSet1Missing || infQty1Missing}
                />
                {servingRequiresInfusion && (infSet1Missing || infQty1Missing) && (
                  <p className="text-[11px] text-red-500 font-medium">
                    {infSet1Missing ? "Infusion set required for this serving type" : "Quantity required"}
                  </p>
                )}
              </div>
              <InfusionSetPair
                setLabel="Infusion Set 2"
                setOptions={infusionSet2Options}
                disabled={infusionDisabled}
                hint={infusionHint}
                setVal={patient.infusionSet2}
                qtyVal={patient.qtyInf2}
                onSetChange={(index) => {
                  onFieldChange("infusionSet2Index", index);
                  const opt = infusionSet2Options.find((o) => o.index === index);
                  if (opt) onFieldChange("infusionSet2", opt.label);
                }}
                onQtyChange={(v) => onFieldChange("qtyInf2", v)}
              />
              <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-3 space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Cartridges</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">Qty:</span>
                  <Input
                    className="h-8 text-sm w-20"
                    type="number"
                    value={patient.qtyCartridge}
                    onChange={(e) => onFieldChange("qtyCartridge", e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </Card>
      {/* Auth Results + Details */}
      <Card className="p-4 space-y-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5" /> Auth Results
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Left column — CGM side */}
          <div className="space-y-4">
            <div>
              <SelectField
                label="CGM Auth"
                icon={<ShieldCheck className="h-4 w-4" />}
                options={AUTH_RESULT_OPTIONS}
                value={patient.cgmAuthResult}
                onChange={(index) => {
                  onFieldChange("cgmAuthResultIndex", index);
                  const opt = AUTH_RESULT_OPTIONS.find((o) => o.index === index);
                  if (opt) onFieldChange("cgmAuthResult", opt.label);
                }}
              />
              <AuthDetailBlock
                authId={patient.monitorAuthId}
                authStart={patient.monitorAuthStart}
                authEnd={patient.monitorAuthEnd}
                authUnits={patient.monitorAuthUnits}
              />
            </div>
            <div>
              <SelectField
                label="Sensors Auth"
                icon={<ShieldCheck className="h-4 w-4" />}
                options={AUTH_RESULT_OPTIONS}
                value={patient.sensorsAuthResult}
                onChange={(index) => {
                  onFieldChange("sensorsAuthResultIndex", index);
                  const opt = AUTH_RESULT_OPTIONS.find((o) => o.index === index);
                  if (opt) onFieldChange("sensorsAuthResult", opt.label);
                }}
              />
              <AuthDetailBlock
                authId={patient.sensorsAuthId}
                authStart={patient.sensorsAuthStart}
                authEnd={patient.sensorsAuthEnd}
                authUnits={patient.sensorsAuthUnits}
              />
            </div>
          </div>
          {/* Right column — Pump side */}
          <div className="space-y-4">
            <div>
              <SelectField
                label="IP Auth"
                icon={<ShieldCheck className="h-4 w-4" />}
                options={AUTH_RESULT_OPTIONS}
                value={patient.ipAuthResult}
                onChange={(index) => {
                  onFieldChange("ipAuthResultIndex", index);
                  const opt = AUTH_RESULT_OPTIONS.find((o) => o.index === index);
                  if (opt) onFieldChange("ipAuthResult", opt.label);
                }}
              />
              <AuthDetailBlock
                authId={patient.ipAuthId}
                authStart={patient.ipAuthStart}
                authEnd={patient.ipAuthEnd}
                authUnits={patient.ipAuthUnits}
              />
            </div>
            <div>
              <SelectField
                label="Infusion Set Auth"
                icon={<ShieldCheck className="h-4 w-4" />}
                options={AUTH_RESULT_OPTIONS}
                value={patient.infusionSetAuthResult}
                onChange={(index) => {
                  onFieldChange("infusionSetAuthResultIndex", index);
                  const opt = AUTH_RESULT_OPTIONS.find((o) => o.index === index);
                  if (opt) onFieldChange("infusionSetAuthResult", opt.label);
                }}
              />
              <AuthDetailBlock
                authId={patient.infusionSetAuthId}
                authStart={patient.infusionSetAuthStart}
                authEnd={patient.infusionSetAuthEnd}
                authUnits={patient.infusionSetAuthUnits}
              />
            </div>
            <div>
              <SelectField
                label="Cartridge Auth"
                icon={<ShieldCheck className="h-4 w-4" />}
                options={AUTH_RESULT_OPTIONS}
                value={patient.cartridgeAuthResult}
                onChange={(index) => {
                  onFieldChange("cartridgeAuthResultIndex", index);
                  const opt = AUTH_RESULT_OPTIONS.find((o) => o.index === index);
                  if (opt) onFieldChange("cartridgeAuthResult", opt.label);
                }}
              />
              <AuthDetailBlock
                authId={patient.cartridgeAuthId}
                authStart={patient.cartridgeAuthStart}
                authEnd={patient.cartridgeAuthEnd}
                authUnits={patient.cartridgeAuthUnits}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Claim Paid Amounts (read-only — shown when values exist) */}
      {(patient.a4230Claim || patient.a4232Claim) && (
        <Card className="p-4 space-y-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
            <DollarSign className="h-3.5 w-3.5" /> Claim Paid Amounts
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {patient.a4230Claim && (
              <div className="flex items-center gap-3 rounded-lg border px-4 py-3 bg-muted/30">
                <span className="text-xs font-medium text-muted-foreground w-28">A4230 Claim</span>
                <span className="text-sm font-semibold">{patient.a4230Claim}</span>
              </div>
            )}
            {patient.a4232Claim && (
              <div className="flex items-center gap-3 rounded-lg border px-4 py-3 bg-muted/30">
                <span className="text-xs font-medium text-muted-foreground w-28">A4232 Claim</span>
                <span className="text-sm font-semibold">{patient.a4232Claim}</span>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Last Bill Dates — always visible so user knows what needs filling */}
      <Card className="p-4 space-y-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
          <CalendarDays className="h-3.5 w-3.5" /> Last Bill Dates
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Left column — CGM side */}
          <div className="space-y-4">
            <EditableDateField label="CGM Last Bill Date" dateStr={patient.lastBillDateMonitor} onChange={(v) => onFieldChange("lastBillDateMonitor", v)} />
            <EditableDateField label="Sensors Last Bill Date" dateStr={patient.lastBillDateSensors} onChange={(v) => onFieldChange("lastBillDateSensors", v)} />
          </div>
          {/* Right column — Pump side */}
          <div className="space-y-4">
            <EditableDateField label="IP Last Bill Date" dateStr={patient.lastBillDateIp} onChange={(v) => onFieldChange("lastBillDateIp", v)} />
            <EditableDateField label="Infusion Set Last Bill Date" dateStr={patient.lastBillDateInfusionSet} onChange={(v) => onFieldChange("lastBillDateInfusionSet", v)} />
            <EditableDateField label="Cartridge Last Bill Date" dateStr={patient.lastBillDateCartridge} onChange={(v) => onFieldChange("lastBillDateCartridge", v)} />
          </div>
        </div>
      </Card>

      {/* Next Order Dates — always visible, editable, green=ready red=future */}
      <Card className="p-4 space-y-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
          <CalendarDays className="h-3.5 w-3.5" /> Next Order Dates
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <EditableNextOrderDateField label="Sensors Next Order Date" dateStr={patient.nextOrderDateSensors} onChange={(v) => onFieldChange("nextOrderDateSensors", v)} active={sensorsActive} />
          <EditableNextOrderDateField label="IP Next Order Date" dateStr={patient.nextOrderDateIp} onChange={(v) => onFieldChange("nextOrderDateIp", v)} active={patient.pumpQty === "1"} />
          <EditableNextOrderDateField label="Supplies Next Order Date" dateStr={patient.nextOrderDateSupplies} onChange={(v) => onFieldChange("nextOrderDateSupplies", v)} active={suppliesActive} />
        </div>
      </Card>
    </div>
  );
}
