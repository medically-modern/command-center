import type { Patient } from "@/lib/finalConfirm/workflow";
import {
  GENDER_OPTIONS,
  SECONDARY_INSURANCE_OPTIONS,
  INFUSION_SET_1_OPTIONS,
  INFUSION_SET_2_OPTIONS,
  SUBSCRIPTION_TYPE_OPTIONS,
  ORDER_HANDLING_OPTIONS,
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
  return (
    <div className="flex items-start gap-2 min-w-0">
      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{label}</p>
        <Input
          className="h-8 text-sm"
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
  options,
  value,
  onChange,
}: {
  label: string;
  options: { index: number; label: string }[];
  value: string;
  onChange: (index: number, label: string) => void;
}) {
  const selectedOpt = options.find((o) => o.label === value);
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{label}</p>
      <Select
        value={selectedOpt ? String(selectedOpt.index) : ""}
        onValueChange={(v) => {
          const opt = options.find((o) => String(o.index) === v);
          if (opt) onChange(opt.index, opt.label);
        }}
      >
        <SelectTrigger className="h-8 text-sm">
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
}: {
  setLabel: string;
  setOptions: { index: number; label: string }[];
  setVal: string;
  qtyVal: string;
  onSetChange: (index: number, label: string) => void;
  onQtyChange: (v: string) => void;
}) {
  const selectedOpt = setOptions.find((o) => o.label === setVal);
  return (
    <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-3 space-y-2">
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
          <div>
            <SelectField
              label="Gender"
              options={GENDER_OPTIONS}
              value={patient.gender}
              onChange={(index) => onFieldChange("genderIndex", index)}
            />
          </div>
        </div>
        {/* Address — full width with Google autocomplete */}
        <div className="flex items-start gap-2 min-w-0">
          <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0">
            <MapPin className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Address</p>
            <AddressAutocomplete
              value={patient.addressEdited ?? patient.address}
              onChange={handleAddressChange}
              placeholder="Start typing address…"
            />
          </div>
        </div>
      </Card>

      {/* Insurance */}
      <Card className="p-4 space-y-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
          <Shield className="h-3.5 w-3.5" /> Insurance
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <EditableTextField
            icon={<Shield className="h-4 w-4" />}
            label="Primary Insurance"
            value={patient.primaryInsurance}
            onChange={(v) => onFieldChange("primaryInsurance", v)}
          />
          <EditableTextField
            icon={<IdCard className="h-4 w-4" />}
            label="Member ID 1"
            value={patient.memberId1}
            onChange={(v) => onFieldChange("memberId1", v)}
          />
          <SelectField
            label="Secondary Insurance"
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
            <EditableTextField
              icon={<Send className="h-4 w-4" />}
              label="Clinicals Method"
              value={patient.clinicalsMethod}
              onChange={(v) => onFieldChange("clinicalsMethod", v)}
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
            <EditableTextField
              icon={<Heart className="h-4 w-4" />}
              label="Diagnosis"
              value={patient.diagnosis}
              onChange={(v) => onFieldChange("diagnosis", v)}
            />
            <EditableTextField
              icon={<Activity className="h-4 w-4" />}
              label="CGM Coverage Path"
              value={patient.cgmCoveragePath}
              onChange={(v) => onFieldChange("cgmCoveragePath", v)}
            />
            <EditableTextField
              icon={<Activity className="h-4 w-4" />}
              label="IP Coverage Path"
              value={patient.ipCoveragePath}
              onChange={(v) => onFieldChange("ipCoveragePath", v)}
            />
            <EditableTextField
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
          <EditableTextField
            icon={<Package className="h-4 w-4" />}
            label="Serving"
            value={patient.serving}
            onChange={(v) => onFieldChange("serving", v)}
          />
          <EditableTextField
            icon={<Package className="h-4 w-4" />}
            label="Pump Type"
            value={patient.pumpType}
            onChange={(v) => onFieldChange("pumpType", v)}
          />
          <EditableTextField
            icon={<Package className="h-4 w-4" />}
            label="CGM Type"
            value={patient.cgmType}
            onChange={(v) => onFieldChange("cgmType", v)}
          />
          <EditableTextField
            icon={<Package className="h-4 w-4" />}
            label="Request Type"
            value={patient.requestType}
            onChange={(v) => onFieldChange("requestType", v)}
          />
        </div>

        <div className="h-px bg-border" />

        {/* Subscription + Order Handling row */}
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
          />
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
    </div>
  );
}
