import type { Patient } from "@/lib/finalConfirm/workflow";
import {
  GENDER_OPTIONS,
  PRIMARY_INSURANCE_OPTIONS,
  SECONDARY_INSURANCE_OPTIONS,
  SERVING_OPTIONS,
  PUMP_TYPE_OPTIONS,
  CGM_TYPE_OPTIONS,
  REQUEST_TYPE_OPTIONS,
  DIAGNOSIS_OPTIONS,
  CGM_COVERAGE_PATH_OPTIONS,
  IP_COVERAGE_PATH_OPTIONS,
  CLINICALS_METHOD_OPTIONS,
  REFERRAL_TYPE_OPTIONS,
  REFERRAL_SOURCE_OPTIONS,
  INFUSION_SET_1_OPTIONS,
  INFUSION_SET_2_OPTIONS,
  SUBSCRIPTION_TYPE_OPTIONS,
  ORDER_HANDLING_OPTIONS,
  AUTH_RESULT_OPTIONS,
  formatPhone,
} from "@/lib/finalConfirm/workflow";
import { AddressAutocomplete, type AddressResult } from "@/components/finalConfirm/AddressAutocomplete";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
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
  Heart,
  ShieldCheck,
  CalendarDays,
} from "lucide-react";

interface Props {
  patient: Patient;
  onFieldChange: (field: keyof Patient, value: string | number | null) => void;
}

function EditableTextField({
  icon,
  label,
  value,
  editedValue,
  placeholder,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  editedValue?: string | null;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const displayValue = editedValue !== undefined && editedValue !== null ? editedValue : value;
  const isEmpty = !displayValue;
  return (
    <div className={cn("flex items-start gap-2 min-w-0 rounded-lg p-1.5 -m-1.5 transition-colors", isEmpty && "bg-red-50 dark:bg-red-950/20 ring-1 ring-red-200 dark:ring-red-800/40")}>
      <div className={cn("h-8 w-8 rounded-md flex items-center justify-center shrink-0", isEmpty ? "bg-red-100 dark:bg-red-900/30 text-red-500" : "bg-muted text-muted-foreground")}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{label}</p>
        <Input
          className={cn("h-8 text-sm", isEmpty && "border-red-300 dark:border-red-700")}
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? `Enter ${label.toLowerCase()}`}
        />
      </div>
    </div>
  );
}

function EditableDateField({
  icon,
  label,
  value,
  placeholder,
  onChange,
  colorCode,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  colorCode?: boolean;
}) {
  // value is YYYY-MM-DD internally, display as MM/DD/YYYY
  const displayVal = (() => {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return value;
    return `${m[2]}/${m[3]}/${m[1]}`;
  })();

  // Parse user input back to YYYY-MM-DD when they type MM/DD/YYYY
  const handleChange = (raw: string) => {
    const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) {
      onChange(`${m[3]}-${m[1]}-${m[2]}`);
    } else {
      onChange(raw);
    }
  };

  const isEmpty = !value;

  // Color coding for next order dates
  let isReady = false;
  if (colorCode && value) {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      const today = new Date(); today.setHours(0,0,0,0);
      isReady = d <= today;
    }
  }

  const iconBg = colorCode && value
    ? (isReady ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600")
    : (isEmpty ? "bg-red-100 dark:bg-red-900/30 text-red-500" : "bg-muted text-muted-foreground");

  const textColor = colorCode && value
    ? (isReady ? "text-green-600" : "text-red-600")
    : "";

  return (
    <div className={cn("flex items-start gap-2 min-w-0 rounded-lg p-1.5 -m-1.5 transition-colors", !colorCode && isEmpty && "bg-red-50 dark:bg-red-950/20 ring-1 ring-red-200 dark:ring-red-800/40")}>
      <div className={cn("h-8 w-8 rounded-md flex items-center justify-center shrink-0", iconBg)}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{label}</p>
        <Input
          className={cn("h-8 text-sm", textColor, !colorCode && isEmpty && "border-red-300 dark:border-red-700")}
          value={displayVal}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder ?? "MM/DD/YYYY"}
        />
      </div>
    </div>
  );
}

function formatMDY(raw: string): string {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return raw;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

function SelectField({
  label,
  icon,
  options,
  value,
  onChange,
}: {
  label: string;
  icon?: React.ReactNode;
  options: { index: number; label: string }[];
  value: string;
  onChange: (index: number, label: string) => void;
}) {
  const selectedOpt = options.find((o) => o.label === value);
  const isEmpty = !value;
  const selectContent = (
    <div className={icon ? "min-w-0 flex-1" : ""}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{label}</p>
      <Select
        value={selectedOpt ? String(selectedOpt.index) : ""}
        onValueChange={(v) => {
          const opt = options.find((o) => String(o.index) === v);
          if (opt) onChange(opt.index, opt.label);
        }}
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
}: {
  setLabel: string;
  setOptions: { index: number; label: string }[];
  setVal: string;
  qtyVal: string;
  onSetChange: (index: number, label: string) => void;
  onQtyChange: (v: string) => void;
  hasError?: boolean;
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

export function PatientInfoCard({ patient, onFieldChange }: Props) {
  const handleAddressChange = (result: AddressResult) => {
    onFieldChange("addressEdited", result.address);
    onFieldChange("addressLat", result.lat);
    onFieldChange("addressLng", result.lng);
  };

  // Infusion set validation: if serving requires supplies, infusion set 1 must be selected with qty
  const servingRequiresInfusion = ["Insulin Pump", "Supplies Only", "Supplies + CGM", "Insulin Pump + CGM"].includes(patient.serving);
  const infSet1Missing = servingRequiresInfusion && !patient.infusionSet1;
  const infQty1Missing = servingRequiresInfusion && (!patient.qtyInf1 || patient.qtyInf1 === "0");

  return (
    <div className="space-y-4">
      {/* Patient name + phone header */}
      <Card className="p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Patient Name</p>
          <p className="text-lg font-semibold">{patient.name}</p>
        </div>
        {patient.phone && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Phone</p>
            <a href={`tel:${patient.phone}`} className="text-lg font-semibold text-primary hover:underline">
              {formatPhone(patient.phoneEdited ?? patient.phone)}
            </a>
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
          />
          <SelectField
            label="Gender"
            icon={<User className="h-4 w-4" />}
            options={GENDER_OPTIONS}
            value={patient.gender}
            onChange={(index) => onFieldChange("genderIndex", index)}
          />
        </div>
        {/* Address — full width with Google autocomplete */}
        {(() => {
          const addr = patient.addressEdited ?? patient.address;
          const zipPattern = new RegExp("[0-9]{5}");
          const hasZip = zipPattern.test(addr);
          const isAllCaps = addr.length > 3 && addr === addr.toUpperCase() && addr.match(new RegExp("[A-Z]"));
          const hasError = addr ? (!hasZip || isAllCaps) : !addr;
          const errorMsg = !addr ? null : isAllCaps ? "Address should not be all uppercase" : !hasZip ? "Zip code is missing" : null;
          return (
            <div className={cn("flex items-start gap-2 min-w-0 rounded-lg p-1.5 -m-1.5 transition-colors", hasError && "bg-red-50 dark:bg-red-950/20 ring-1 ring-red-200 dark:ring-red-800/40")}>
              <div className={cn("h-8 w-8 rounded-md flex items-center justify-center shrink-0", hasError ? "bg-red-100 dark:bg-red-900/30 text-red-500" : "bg-muted text-muted-foreground")}>
                <MapPin className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Address</p>
                <AddressAutocomplete
                  value={addr}
                  onChange={handleAddressChange}
                  placeholder="Start typing address\u2026"
                />
                {errorMsg && (
                  <p className="text-[11px] text-red-500 font-medium mt-1">{errorMsg}</p>
                )}
              </div>
            </div>
          );
        })()}
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
          />
        </div>
        <div className="h-px bg-border" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <EditableTextField
            icon={<Activity className="h-4 w-4" />}
            label="Deductible"
            value={patient.deductible}
            onChange={(v) => onFieldChange("deductible", v)}
          />
          <EditableTextField
            icon={<Activity className="h-4 w-4" />}
            label="Ded. Remaining"
            value={patient.deductibleRemaining}
            onChange={(v) => onFieldChange("deductibleRemaining", v)}
          />
          <EditableTextField
            icon={<Activity className="h-4 w-4" />}
            label="OOP Max"
            value={patient.oopMax}
            onChange={(v) => onFieldChange("oopMax", v)}
          />
          <EditableTextField
            icon={<Activity className="h-4 w-4" />}
            label="OOP Remaining"
            value={patient.oopMaxRemaining}
            onChange={(v) => onFieldChange("oopMaxRemaining", v)}
          />
        </div>
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
            />
            <EditableTextField
              icon={<Hash className="h-4 w-4" />}
              label="NPI"
              value={patient.doctorNpi}
              onChange={(v) => onFieldChange("doctorNpi", v)}
            />
            <EditableTextField
              icon={<Phone className="h-4 w-4" />}
              label="Doctor Phone"
              value={patient.doctorPhone}
              onChange={(v) => onFieldChange("doctorPhone", v)}
            />
            <EditableTextField
              icon={<Mail className="h-4 w-4" />}
              label="Doctor Email"
              value={patient.doctorEmail}
              onChange={(v) => onFieldChange("doctorEmail", v)}
            />
            <EditableTextField
              icon={<Send className="h-4 w-4" />}
              label="Fax"
              value={patient.doctorFax}
              onChange={(v) => onFieldChange("doctorFax", v)}
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
            />
            <EditableTextField
              icon={<Building2 className="h-4 w-4" />}
              label="Clinic"
              value={patient.clinicName}
              onChange={(v) => onFieldChange("clinicName", v)}
            />
          </div>
        </CollapsibleSection>
      </Card>

      {/* Medical Necessity */}
      <Card className="p-4 space-y-4">
        <CollapsibleSection title="Medical Necessity" defaultOpen>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SelectField
              label="Diagnosis"
              icon={<Heart className="h-4 w-4" />}
              options={DIAGNOSIS_OPTIONS}
              value={patient.diagnosis}
              onChange={(index) => {
                onFieldChange("diagnosisIndex", index);
                const opt = DIAGNOSIS_OPTIONS.find((o) => o.index === index);
                if (opt) onFieldChange("diagnosis", opt.label);
              }}
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
            <EditableDateField
              icon={<Stethoscope className="h-4 w-4" />}
              label="MR Expiry Date"
              value={patient.mrExpiryDate}
              onChange={(v) => onFieldChange("mrExpiryDate", v)}
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
            label="Pump Type"
            icon={<Package className="h-4 w-4" />}
            options={PUMP_TYPE_OPTIONS}
            value={patient.pumpType}
            onChange={(index) => {
              onFieldChange("pumpTypeIndex", index);
              const opt = PUMP_TYPE_OPTIONS.find((o) => o.index === index);
              if (opt) onFieldChange("pumpType", opt.label);
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
        </div>

        <div className="h-px bg-border" />

        {/* Subscription + Order Handling */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SelectField
            label="Subscription Type"
            options={SUBSCRIPTION_TYPE_OPTIONS}
            value={patient.subscriptionType}
            onChange={(index) => {
              onFieldChange("subscriptionTypeIndex", index);
              const opt = SUBSCRIPTION_TYPE_OPTIONS.find((o) => o.index === index);
              if (opt) onFieldChange("subscriptionType", opt.label);
            }}
          />
          <SelectField
            label="Order Handling"
            options={ORDER_HANDLING_OPTIONS}
            value={patient.orderHandling}
            onChange={(index) => {
              onFieldChange("orderHandlingIndex", index);
              const opt = ORDER_HANDLING_OPTIONS.find((o) => o.index === index);
              if (opt) onFieldChange("orderHandling", opt.label);
            }}
          />
        </div>

        <div className="h-px bg-border" />

        {/* Infusion Sets — visually paired with their quantities */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <InfusionSetPair
              setLabel="Infusion Set 1"
              setOptions={INFUSION_SET_1_OPTIONS}
              setVal={patient.infusionSet1}
              qtyVal={patient.qtyInf1}
              onSetChange={(index) => {
                onFieldChange("infusionSet1Index", index);
                const opt = INFUSION_SET_1_OPTIONS.find((o) => o.index === index);
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
            setOptions={INFUSION_SET_2_OPTIONS}
            setVal={patient.infusionSet2}
            qtyVal={patient.qtyInf2}
            onSetChange={(index) => {
              onFieldChange("infusionSet2Index", index);
              const opt = INFUSION_SET_2_OPTIONS.find((o) => o.index === index);
              if (opt) onFieldChange("infusionSet2", opt.label);
            }}
            onQtyChange={(v) => onFieldChange("qtyInf2", v)}
          />
        </div>

        {/* Monitor + Pump quantities */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Monitor Qty</p>
            <Input
              className="h-8 text-sm"
              type="number"
              value={patient.monitorQty}
              onChange={(e) => onFieldChange("monitorQty", e.target.value)}
              placeholder="0"
            />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Pump Qty</p>
            <Input
              className="h-8 text-sm"
              type="number"
              value={patient.pumpQty}
              onChange={(e) => onFieldChange("pumpQty", e.target.value)}
              placeholder="0"
            />
          </div>
        </div>
      </Card>
      {/* Auth Results */}
      <Card className="p-4 space-y-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5" /> Auth Results
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
        </div>
      </Card>

      {/* Subscription and Logistics — Next Order Dates + Last Bill Date notes */}
      <Card className="p-4 space-y-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
          <CalendarDays className="h-3.5 w-3.5" /> Subscription and Logistics
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1">
            <EditableDateField
              icon={<CalendarDays className="h-4 w-4" />}
              label="IP Next Order Date"
              value={patient.nextOrderDateIp}
              onChange={(v) => onFieldChange("nextOrderDateIp", v)}
              colorCode
            />
            {patient.orderDateIp && (
              <p className="text-[10px] text-muted-foreground pl-10">IP Last Bill: {formatMDY(patient.orderDateIp)}</p>
            )}
          </div>
          <div className="space-y-1">
            <EditableDateField
              icon={<CalendarDays className="h-4 w-4" />}
              label="Sensors Next Order Date"
              value={patient.nextOrderDateSensors}
              onChange={(v) => onFieldChange("nextOrderDateSensors", v)}
              colorCode
            />
            {(patient.orderDateSensors || patient.orderDateMonitor) && (
              <div className="text-[10px] text-muted-foreground pl-10 space-y-0.5">
                {patient.orderDateSensors && <p>Sensors Last Bill: {formatMDY(patient.orderDateSensors)}</p>}
                {patient.orderDateMonitor && <p>CGM Last Bill: {formatMDY(patient.orderDateMonitor)}</p>}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <EditableDateField
              icon={<CalendarDays className="h-4 w-4" />}
              label="Supplies Next Order Date"
              value={patient.nextOrderDateSupplies}
              onChange={(v) => onFieldChange("nextOrderDateSupplies", v)}
              colorCode
            />
            {(patient.orderDateCartridge || patient.orderDateInfusionSet) && (
              <div className="text-[10px] text-muted-foreground pl-10 space-y-0.5">
                {patient.orderDateCartridge && <p>Cartridge Last Bill: {formatMDY(patient.orderDateCartridge)}</p>}
                {patient.orderDateInfusionSet && <p>Infusion Set Last Bill: {formatMDY(patient.orderDateInfusionSet)}</p>}
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
