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

function ReadOnlyField({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
        <p className="text-sm font-medium truncate" title={value || "—"}>{value || "—"}</p>
      </div>
    </div>
  );
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
  editedValue: string | null;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const displayValue = editedValue ?? value;
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

export function PatientInfoCard({ patient, onFieldChange }: Props) {
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

      {/* Demographics — editable */}
      <Card className="p-4 space-y-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
          <User className="h-3.5 w-3.5" /> Demographics
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <ReadOnlyField icon={<Stethoscope className="h-4 w-4" />} label="DOB" value={patient.dob} />
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
          <EditableTextField
            icon={<MapPin className="h-4 w-4" />}
            label="Address"
            value={patient.address}
            editedValue={patient.addressEdited}
            onChange={(v) => onFieldChange("addressEdited", v)}
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
      </Card>

      {/* Insurance */}
      <Card className="p-4 space-y-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
          <Shield className="h-3.5 w-3.5" /> Insurance
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <ReadOnlyField icon={<Shield className="h-4 w-4" />} label="Primary Insurance" value={patient.primaryInsurance} />
          <ReadOnlyField icon={<IdCard className="h-4 w-4" />} label="Member ID 1" value={patient.memberId1} />
          {patient.secondaryInsurance ? (
            <ReadOnlyField icon={<Shield className="h-4 w-4" />} label="Secondary Insurance" value={patient.secondaryInsurance} />
          ) : (
            <SelectField
              label="Secondary Insurance"
              options={SECONDARY_INSURANCE_OPTIONS}
              value={patient.secondaryInsuranceEdited ?? ""}
              onChange={(index, label) => {
                onFieldChange("secondaryInsuranceIndex", index);
                onFieldChange("secondaryInsuranceEdited", label);
              }}
            />
          )}
          {patient.memberId2 ? (
            <ReadOnlyField icon={<IdCard className="h-4 w-4" />} label="Member ID 2" value={patient.memberId2} />
          ) : (
            <EditableTextField
              icon={<IdCard className="h-4 w-4" />}
              label="Member ID 2"
              value=""
              editedValue={patient.memberId2Edited}
              placeholder="Enter member ID"
              onChange={(v) => onFieldChange("memberId2Edited", v)}
            />
          )}
          <ReadOnlyField icon={<Activity className="h-4 w-4" />} label="Deductible" value={patient.deductible} />
          <ReadOnlyField icon={<Activity className="h-4 w-4" />} label="Deductible Remaining" value={patient.deductibleRemaining} />
          <ReadOnlyField icon={<Activity className="h-4 w-4" />} label="OOP Max" value={patient.oopMax} />
          <ReadOnlyField icon={<Activity className="h-4 w-4" />} label="OOP Remaining" value={patient.oopMaxRemaining} />
        </div>
      </Card>

      {/* Doctor Info */}
      <Card className="p-4 space-y-4">
        <CollapsibleSection title="Doctor Info" defaultOpen>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <ReadOnlyField icon={<UserRound className="h-4 w-4" />} label="Doctor Name" value={patient.doctorName} />
            <ReadOnlyField icon={<Hash className="h-4 w-4" />} label="NPI" value={patient.doctorNpi} />
            <ReadOnlyField icon={<Phone className="h-4 w-4" />} label="Doctor Phone" value={patient.doctorPhone} />
            <ReadOnlyField icon={<Mail className="h-4 w-4" />} label="Doctor Email" value={patient.doctorEmail} />
            <ReadOnlyField icon={<Send className="h-4 w-4" />} label="Fax" value={patient.doctorFax} />
            <ReadOnlyField icon={<Send className="h-4 w-4" />} label="Clinicals Method" value={patient.clinicalsMethod} />
            <ReadOnlyField icon={<Building2 className="h-4 w-4" />} label="Clinic" value={patient.clinicName} />
          </div>
        </CollapsibleSection>
      </Card>

      {/* Medical Necessity */}
      <Card className="p-4 space-y-4">
        <CollapsibleSection title="Medical Necessity" defaultOpen>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <ReadOnlyField icon={<Heart className="h-4 w-4" />} label="Diagnosis" value={patient.diagnosis} />
            <ReadOnlyField icon={<Activity className="h-4 w-4" />} label="CGM Coverage Path" value={patient.cgmCoveragePath} />
            <ReadOnlyField icon={<Activity className="h-4 w-4" />} label="IP Coverage Path" value={patient.ipCoveragePath} />
            <ReadOnlyField icon={<Stethoscope className="h-4 w-4" />} label="MR Expiry Date" value={patient.mrExpiryDate} />
          </div>
        </CollapsibleSection>
      </Card>

      {/* Product / Order Info — editable */}
      <Card className="p-4 space-y-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
          <Package className="h-3.5 w-3.5" /> Product & Order Info
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <ReadOnlyField icon={<Package className="h-4 w-4" />} label="Serving" value={patient.serving} />
          <ReadOnlyField icon={<Package className="h-4 w-4" />} label="Pump Type" value={patient.pumpType} />
          <ReadOnlyField icon={<Package className="h-4 w-4" />} label="CGM Type" value={patient.cgmType} />
          <ReadOnlyField icon={<Package className="h-4 w-4" />} label="Request Type" value={patient.requestType} />
        </div>
        <div className="h-px bg-border" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
            label="Infusion Set 1"
            options={INFUSION_SET_1_OPTIONS}
            value={patient.infusionSet1}
            onChange={(index) => {
              onFieldChange("infusionSet1Index", index);
              const opt = INFUSION_SET_1_OPTIONS.find((o) => o.index === index);
              if (opt) onFieldChange("infusionSet1", opt.label);
            }}
          />
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Qty Inf. Set 1</p>
            <Input
              className="h-8 text-sm"
              type="number"
              value={patient.qtyInf1}
              onChange={(e) => onFieldChange("qtyInf1", e.target.value)}
              placeholder="0"
            />
          </div>
          <SelectField
            label="Infusion Set 2"
            options={INFUSION_SET_2_OPTIONS}
            value={patient.infusionSet2}
            onChange={(index) => {
              onFieldChange("infusionSet2Index", index);
              const opt = INFUSION_SET_2_OPTIONS.find((o) => o.index === index);
              if (opt) onFieldChange("infusionSet2", opt.label);
            }}
          />
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Qty Inf. Set 2</p>
            <Input
              className="h-8 text-sm"
              type="number"
              value={patient.qtyInf2}
              onChange={(e) => onFieldChange("qtyInf2", e.target.value)}
              placeholder="0"
            />
          </div>
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
      </Card>
    </div>
  );
}
