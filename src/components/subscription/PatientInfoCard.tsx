import { useState } from "react";
import type { Patient } from "@/lib/subscription/workflow";
import { formatPhone, formatDateMDY } from "@/lib/subscription/workflow";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
            <Field label="Address" value={patient.address} />
            <Field label="Referral" value={patient.referral} />
            <Field label="Order Count" value={patient.orderCount} />
          </div>
        </Card>

        {/* Insurance */}
        <Card className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Insurance</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Primary Insurance" value={patient.primaryInsurance} />
            <Field label="Member ID 1" value={patient.memberId1} />
            <Field label="Secondary Insurance" value={patient.secondaryInsurance || "None"} />
            <Field label="Member ID 2" value={patient.memberId2} />
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
            <Field label="Doctor" value={patient.doctor} />
            <Field label="NPI" value={patient.npi} />
            <Field label="Doctor Address" value={patient.doctorAddress} />
            <Field label="Doctor Phone" value={patient.doctorPhone ? formatPhone(patient.doctorPhone) : ""} />
            <Field label="Doctor Fax" value={patient.doctorFax} />
            <Field label="Fax / Parachute" value={patient.faxParachute} />
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
