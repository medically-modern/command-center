import { useState } from "react";
import type { Patient } from "@/lib/subscription/workflow";
import {
  formatPhone, formatDateMDY,
  PRIMARY_INSURANCE_OPTIONS, SECONDARY_INSURANCE_OPTIONS, FAX_PARACHUTE_OPTIONS,
} from "@/lib/subscription/workflow";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Pencil } from "lucide-react";

interface Props {
  patient: Patient;
  onFieldChange?: (field: keyof Patient, value: string | number | null) => void;
}

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className={`text-sm font-medium ${className ?? ""}`} title={value}>{value}</p>
    </div>
  );
}

function PhoneField({
  phone,
  phoneEdited,
  onFieldChange,
}: {
  phone: string;
  phoneEdited: string | null;
  onFieldChange?: (field: keyof Patient, value: string | number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const displayPhone = phoneEdited ?? phone;
  if (!phone && !phoneEdited) return null;

  return (
    <div className="text-right">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Phone</p>
      {editing ? (
        <Input
          className="h-9 text-sm font-semibold w-44 ml-auto"
          value={phoneEdited ?? phone}
          onChange={(e) => onFieldChange?.("phoneEdited", e.target.value)}
          onBlur={() => setEditing(false)}
          autoFocus
          placeholder="(555) 555-5555"
        />
      ) : (
        <div className="flex items-center justify-end gap-1.5">
          <a href={`tel:${displayPhone}`} className="text-lg font-semibold text-primary hover:underline">
            {formatPhone(displayPhone)}
          </a>
          <button onClick={() => setEditing(true)} className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors" title="Edit phone number">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {phoneEdited !== null && phoneEdited !== phone && <p className="text-[10px] text-amber-600 mt-0.5">edited</p>}
    </div>
  );
}

/** Inline-editable text field */
function EditableField({
  label,
  value,
  editedValue,
  editedField,
  onFieldChange,
  placeholder,
}: {
  label: string;
  value: string;
  editedValue: string | null;
  editedField: keyof Patient;
  onFieldChange?: (field: keyof Patient, value: string | number | null) => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const display = editedValue ?? value;

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{label}</p>
      {editing ? (
        <Input
          className="h-8 text-sm"
          value={editedValue ?? value}
          onChange={(e) => onFieldChange?.(editedField, e.target.value)}
          onBlur={() => setEditing(false)}
          autoFocus
          placeholder={placeholder ?? label}
        />
      ) : (
        <div className="flex items-center gap-1.5 group">
          <p className="text-sm font-medium truncate" title={display}>{display || "—"}</p>
          {onFieldChange && (
            <button onClick={() => { onFieldChange?.(editedField, editedValue ?? value); setEditing(true); }} className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-all" title={`Edit ${label}`}>
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
      {editedValue !== null && editedValue !== value && <p className="text-[10px] text-amber-600 mt-0.5">edited</p>}
    </div>
  );
}

/** Inline-editable select for status-index fields */
function EditableStatusSelect({
  label,
  options,
  currentLabel,
  editedIndex,
  editedField,
  onFieldChange,
}: {
  label: string;
  options: { index: number; label: string }[];
  currentLabel: string;
  editedIndex: number | null;
  editedField: keyof Patient;
  onFieldChange?: (field: keyof Patient, value: string | number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const displayLabel = editedIndex !== null ? (options.find((o) => o.index === editedIndex)?.label ?? currentLabel) : currentLabel;

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{label}</p>
      {editing ? (
        <Select
          value={editedIndex !== null ? String(editedIndex) : ""}
          onValueChange={(v) => { onFieldChange?.(editedField, Number(v)); setEditing(false); }}
        >
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={`Select ${label}`} /></SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.index} value={String(opt.index)}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="flex items-center gap-1.5 group">
          <p className="text-sm font-medium">{displayLabel || "—"}</p>
          {onFieldChange && (
            <button onClick={() => setEditing(true)} className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-all" title={`Edit ${label}`}>
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
      {editedIndex !== null && <p className="text-[10px] text-amber-600 mt-0.5">edited</p>}
    </div>
  );
}

/** Color-coded MR status */
function MrField({ mr, expiry }: { mr: string; expiry: string }) {
  if (!mr) return null;
  const isValid = mr === "MR Valid";
  const isExpired = mr === "MR Expired" || mr === "MR Invalid";
  const color = isValid ? "text-green-600" : isExpired ? "text-red-600" : "text-amber-600";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Medical Records</p>
      <p className={`text-sm font-medium ${color}`}>{mr}</p>
      {expiry && <p className="text-[10px] text-muted-foreground">Expires: {formatDateMDY(expiry)}</p>}
    </div>
  );
}

/** Color-coded auth status */
function AuthStatusField({ label, status }: { label: string; status: string }) {
  if (!status) return null;
  const isGood = status === "Auth Valid" || status === "No Auth Needed";
  const isBad = status === "Auth. Expired" || status === "Denied";
  const isWarning = status === "Auth. Expiring" || status === "Required" || status === "Evaluate" || status === "Submitted";
  const color = isGood ? "text-green-600" : isBad ? "text-red-600" : isWarning ? "text-amber-600" : "";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className={`text-sm font-medium ${color}`}>{status}</p>
    </div>
  );
}

/** Days-to-order with color coding */
function DaysToOrderField({ value }: { value: string }) {
  if (!value) return null;
  const isUrgent = value === "Today" || value === "1 Week" || value === "Order Day Passed" || value === "Very Late";
  const isSoon = value === "10 Days" || value === "20 Days";
  const color = isUrgent ? "text-red-600 font-bold" : isSoon ? "text-amber-600" : "text-green-600";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Days To Order</p>
      <p className={`text-sm font-medium ${color}`}>{value}</p>
    </div>
  );
}

export function PatientInfoCard({ patient, onFieldChange }: Props) {
  return (
    <div className="space-y-4">
      {/* Top row: Name + DOB + Status + Phone */}
      <Card className="p-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Patient Name</p>
          <p className="text-lg font-semibold">{patient.name}</p>
        </div>
        {patient.dob && (
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">DOB</p>
            <p className="text-lg font-semibold">{patient.dob}</p>
          </div>
        )}
        {patient.email && (
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Email</p>
            <a href={`mailto:${patient.email}`} className="text-sm font-medium text-primary hover:underline">{patient.email}</a>
          </div>
        )}
        <PhoneField phone={patient.phone} phoneEdited={patient.phoneEdited} onFieldChange={onFieldChange} />
      </Card>

      {/* Subscription Status Row */}
      <Card className="p-4 border-l-4 border-l-blue-500">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Subscription Overview</p>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Status</p>
            <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${
              patient.status === "Active" ? "text-green-600" : patient.status === "Paused" ? "text-amber-600" : patient.status === "Dead" ? "text-red-600" : ""
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                patient.status === "Active" ? "bg-green-500" : patient.status === "Paused" ? "bg-amber-500" : patient.status === "Dead" ? "bg-red-500" : "bg-gray-400"
              }`} />
              {patient.status || "—"}
            </span>
            {patient.pauseReason && <p className="text-[10px] text-amber-600 mt-0.5">Reason: {patient.pauseReason}</p>}
            {patient.deadReason && <p className="text-[10px] text-red-600 mt-0.5">Reason: {patient.deadReason}</p>}
          </div>
          <DaysToOrderField value={patient.daysToOrder} />
          <Field label="Ordering Cycle" value={patient.orderingCycle} />
          <Field label="Next Order" value={patient.nextOrder ? formatDateMDY(patient.nextOrder) : ""} />
          <Field label="Subscription" value={patient.subscription} />
          <Field label="Order Type" value={patient.orderType} />
        </div>
      </Card>

      {/* Demographics + Insurance + Address */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Demographics */}
        <Card className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Demographics</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Gender" value={patient.gender} />
            <EditableField
              label="Address"
              value={patient.address}
              editedValue={patient.addressEdited}
              editedField="addressEdited"
              onFieldChange={onFieldChange}
              placeholder="123 Main St, City, ST 12345"
            />
            <Field label="Referral" value={patient.referral} />
            {patient.carecentrixIntakeId && (
              <Field label="Carecentrix Intake I.D." value={patient.carecentrixIntakeId} />
            )}
            <Field label="Order Count" value={patient.orderCount} />
          </div>
        </Card>

        {/* Insurance */}
        <Card className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Insurance</p>
          <div className="grid grid-cols-2 gap-3">
            <EditableStatusSelect
              label="Primary Insurance"
              options={PRIMARY_INSURANCE_OPTIONS}
              currentLabel={patient.primaryInsurance}
              editedIndex={patient.primaryInsuranceEdited}
              editedField="primaryInsuranceEdited"
              onFieldChange={onFieldChange}
            />
            <EditableField
              label="Member ID 1"
              value={patient.memberId1}
              editedValue={patient.memberId1Edited}
              editedField="memberId1Edited"
              onFieldChange={onFieldChange}
            />
            <EditableStatusSelect
              label="Secondary Insurance"
              options={SECONDARY_INSURANCE_OPTIONS}
              currentLabel={patient.secondaryInsurance || "None"}
              editedIndex={patient.secondaryInsuranceEdited}
              editedField="secondaryInsuranceEdited"
              onFieldChange={onFieldChange}
            />
            <EditableField
              label="Member ID 2"
              value={patient.memberId2}
              editedValue={patient.memberId2Edited}
              editedField="memberId2Edited"
              onFieldChange={onFieldChange}
            />
          </div>
          {patient.stediActive && (
            <div className="mt-3 pt-3 border-t">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Stedi Eligibility</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Active?" value={patient.stediActive} className={patient.stediActive === "Active" ? "text-green-600" : patient.stediActive === "Inactive" ? "text-red-600" : ""} />
                <Field label="Ded. Remaining" value={patient.stediDedRemaining} />
                <Field label="Insurance Change?" value={patient.insuranceChange} className={patient.insuranceChange === "Yes" ? "text-red-600 font-bold" : ""} />
                <Field label="Prior Auth Req?" value={patient.priorAuthReq} />
                <Field label="Primary Claim Paid?" value={patient.primaryClaimPaid} className={patient.primaryClaimPaid === "No" ? "text-red-600" : ""} />
              </div>
            </div>
          )}
        </Card>

        {/* Medical Necessity + Auth */}
        <Card className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Medical Necessity & Auth</p>
          <div className="grid grid-cols-2 gap-3">
            <MrField mr={patient.mr} expiry={patient.mnExpiry} />
            <Field label="Diagnosis" value={patient.diagnosis} />
            <Field label="CGM Coverage" value={patient.cgmCoverage} />
            <AuthStatusField label="Sensors Auth" status={patient.sensorsAuthStatus} />
            <AuthStatusField label="Supplies Auth" status={patient.suppliesAuthStatus} />
          </div>
          {/* Auth detail (IDs + dates) */}
          {(patient.sensorsAuthId || patient.sensorsStartAuth || patient.suppliesStartAuth || patient.infusionSetAuthId) && (
            <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-2">
              {patient.sensorsAuthId && <Field label="Sensors Auth ID" value={patient.sensorsAuthId} />}
              {patient.sensorsUnits && <Field label="Sensors Units" value={patient.sensorsUnits} />}
              {patient.sensorsStartAuth && <Field label="Sensors Auth Start" value={formatDateMDY(patient.sensorsStartAuth)} />}
              {patient.sensorsEndAuth && <Field label="Sensors Auth End" value={formatDateMDY(patient.sensorsEndAuth)} />}
              {patient.sensorsId2 && <Field label="Sensors ID 2" value={patient.sensorsId2} />}
              {patient.infusionSetAuthId && <Field label="Infusion Set Auth ID" value={patient.infusionSetAuthId} />}
              {patient.cartridgeAuthId && <Field label="Cartridge Auth ID" value={patient.cartridgeAuthId} />}
              {patient.suppliesUnits && <Field label="Supplies Units" value={patient.suppliesUnits} />}
              {patient.suppliesStartAuth && <Field label="Supplies Auth Start" value={formatDateMDY(patient.suppliesStartAuth)} />}
              {patient.suppliesEndAuth && <Field label="Supplies Auth End" value={formatDateMDY(patient.suppliesEndAuth)} />}
            </div>
          )}
        </Card>
      </div>

      {/* Order Details + Doctor + Financials */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Order Details */}
        <Card className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Order Details</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sensors Type" value={patient.sensorsType} />
            <Field label="Supplies Type (Pump)" value={patient.suppliesType} />
            <Field label="Infusion Set 1" value={patient.infusionSet1} />
            <Field label="Inf. Qty 1" value={patient.infQty1} />
            <Field label="Infusion Set 2" value={patient.infusionSet2} />
            <Field label="Inf. Qty 2" value={patient.infQty2} />
          </div>
        </Card>

        {/* Doctor Info */}
        <Card className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Doctor Info</p>
          <div className="grid grid-cols-2 gap-3">
            <EditableField
              label="Doctor"
              value={patient.doctor}
              editedValue={patient.doctorEdited}
              editedField="doctorEdited"
              onFieldChange={onFieldChange}
            />
            <EditableField
              label="NPI"
              value={patient.npi}
              editedValue={patient.npiEdited}
              editedField="npiEdited"
              onFieldChange={onFieldChange}
            />
            <EditableField
              label="Doctor Address"
              value={patient.doctorAddress}
              editedValue={patient.doctorAddressEdited}
              editedField="doctorAddressEdited"
              onFieldChange={onFieldChange}
              placeholder="123 Medical Dr, City, ST 12345"
            />
            <EditableField
              label="Doctor Phone"
              value={patient.doctorPhone ? formatPhone(patient.doctorPhone) : ""}
              editedValue={patient.doctorPhoneEdited}
              editedField="doctorPhoneEdited"
              onFieldChange={onFieldChange}
              placeholder="(555) 555-5555"
            />
            <EditableField
              label="Doctor Fax"
              value={patient.doctorFax}
              editedValue={patient.doctorFaxEdited}
              editedField="doctorFaxEdited"
              onFieldChange={onFieldChange}
              placeholder="(555) 555-5555"
            />
            {(() => {
              const faxDisplay = patient.faxParachuteEdited ?? patient.faxParachute;
              const faxEditedIdx = patient.faxParachuteEdited !== null
                ? FAX_PARACHUTE_OPTIONS.find((o) => o.label === patient.faxParachuteEdited)?.index ?? null
                : null;
              return (
                <EditableStatusSelect
                  label="Fax / Parachute"
                  options={FAX_PARACHUTE_OPTIONS}
                  currentLabel={faxDisplay || "—"}
                  editedIndex={faxEditedIdx}
                  editedField="faxParachuteEdited"
                  onFieldChange={(field, value) => {
                    const label = FAX_PARACHUTE_OPTIONS.find((o) => o.index === Number(value))?.label ?? "";
                    onFieldChange?.(field, label);
                  }}
                />
              );
            })()}
          </div>
        </Card>

        {/* Financials */}
        <Card className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Financials</p>
          <div className="space-y-3">
            {(patient.sensorsRevenue || patient.sensorsCost) && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-blue-500 font-semibold mb-1">Sensors</p>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Revenue" value={patient.sensorsRevenue ? `$${patient.sensorsRevenue}` : ""} />
                  <Field label="Cost" value={patient.sensorsCost ? `$${patient.sensorsCost}` : ""} />
                  <Field label="GP" value={patient.sensorsGP ? `$${patient.sensorsGP}` : ""} />
                </div>
              </div>
            )}
            {(patient.suppliesRevenue || patient.suppliesCost) && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-blue-500 font-semibold mb-1">Supplies</p>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Revenue" value={patient.suppliesRevenue ? `$${patient.suppliesRevenue}` : ""} />
                  <Field label="Cost" value={patient.suppliesCost ? `$${patient.suppliesCost}` : ""} />
                  <Field label="GP" value={patient.suppliesGP ? `$${patient.suppliesGP}` : ""} />
                </div>
              </div>
            )}
            <div className="pt-2 border-t">
              <div className="grid grid-cols-3 gap-2">
                <Field label="Total Revenue" value={patient.totalRevenue ? `$${patient.totalRevenue}` : ""} />
                <Field label="Total Cost" value={patient.totalCost ? `$${patient.totalCost}` : ""} />
                <Field label="Total GP" value={patient.totalGP ? `$${patient.totalGP}` : ""} />
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <Field label="Shipping" value={patient.shippingCost ? `$${patient.shippingCost}` : ""} />
                <Field label="ARR" value={patient.arr ? `$${patient.arr}` : ""} />
                <Field label="ARP" value={patient.arp ? `$${patient.arp}` : ""} />
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Claims + Denial */}
      {(patient.claimsStatus || patient.denialReason) && (
        <Card className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Claims & Denial Info</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Claims Status" value={patient.claimsStatus} className={
              patient.claimsStatus === "Claims Paid" ? "text-green-600" :
              patient.claimsStatus === "Claims Denied" || patient.claimsStatus === "Claims Error" ? "text-red-600" :
              patient.claimsStatus === "Claims Running" || patient.claimsStatus === "Submit Claims" ? "text-amber-600" : ""
            } />
            {patient.denialReason && <Field label="Denial Reason" value={patient.denialReason} />}
          </div>
        </Card>
      )}
    </div>
  );
}
