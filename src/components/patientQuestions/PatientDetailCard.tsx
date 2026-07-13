/**
 * Patient Questions — detail card.
 * Mimics the Subscription PatientInfoCard layout.
 * Message is the hero element at the top, with a "Mark completed" action;
 * phone renders as the Evaluate-style Call + Text (RingCentral) buttons.
 */
import { useState } from "react";
import { CheckCircle2, Loader2, MessageCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PatientContact } from "@/components/masheke/mmKit";
import type { PatientQuestion } from "@/lib/patientQuestions/types";
import { cn } from "@/lib/utils";

interface Props {
  patient: PatientQuestion;
  /** Marks the question handled (page owns the Monday write + list update). */
  onMarkCompleted?: (patient: PatientQuestion) => Promise<void>;
}

// ── Helpers ──

function formatTimestamp(iso: string): string {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1") return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return raw;
}

function formatDateMDY(d: string): string {
  if (!d) return "";
  const parts = d.split("-");
  if (parts.length !== 3) return d;
  return `${parts[1]}/${parts[2]}/${parts[0]}`;
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

function AuthStatusField({ label, status }: { label: string; status: string }) {
  if (!status) return null;
  const isGood = status === "Auth Valid" || status === "No Auth Needed";
  const isBad = status === "Auth. Expired" || status === "Denied";
  const isWarning = status === "Auth. Expiring" || status === "Required" || status === "Evaluate" || status === "Submitted";
  const color = isGood ? "text-green-600" : isBad ? "text-red-600" : isWarning ? "text-amber-600" : "";
  return <Field label={label} value={status} className={color} />;
}

function DaysToOrderField({ value }: { value: string }) {
  if (!value) return null;
  const isUrgent = value === "Today" || value === "1 Week" || value === "Order Day Passed" || value === "Very Late";
  const isSoon = value === "10 Days" || value === "20 Days";
  const color = isUrgent ? "text-red-600 font-bold" : isSoon ? "text-amber-600" : "text-green-600";
  return <Field label="Days To Order" value={value} className={color} />;
}

// ── Main component ──

export function PatientDetailCard({ patient, onMarkCompleted }: Props) {
  const [completing, setCompleting] = useState(false);

  const markCompleted = async () => {
    if (!onMarkCompleted || completing) return;
    setCompleting(true);
    try {
      await onMarkCompleted(patient);
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ═══ HERO: Patient Message ═══ */}
      <Card className="p-5 border-l-4 border-l-sky-500 bg-sky-50/50 dark:bg-sky-950/20">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-sky-600" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-300">
              Patient Message
            </h3>
            <span className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider",
              patient.source === "subscription"
                ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
                : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
            )}>
              {patient.source === "subscription" ? "Re-order" : "Co-Pay"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {formatTimestamp(patient.messageUpdatedAt)}
            </span>
            {onMarkCompleted && (
              <button
                type="button"
                onClick={() => void markCompleted()}
                disabled={completing}
                title="Removes this question from the inbox. It comes back automatically if the patient writes again."
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60 bg-emerald-600"
              >
                {completing
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  : <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                Mark completed
              </button>
            )}
          </div>
        </div>
        <div className="rounded-lg bg-white dark:bg-card border p-4">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{patient.message}</p>
        </div>
      </Card>

      {/* ═══ Top row: Name + DOB + Phone ═══ */}
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
        {patient.phone && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Phone</p>
            {/* Same Call + Text (RingCentral thread) buttons as Evaluate */}
            <PatientContact phone={patient.phone} />
          </div>
        )}
      </Card>

      {/* ═══ Subscription-source detail ═══ */}
      {patient.source === "subscription" && (
        <>
          {/* Subscription Status */}
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
              </div>
              <DaysToOrderField value={patient.daysToOrder} />
              <Field label="Ordering Cycle" value={patient.orderingCycle} />
              <Field label="Next Order" value={patient.nextOrder ? formatDateMDY(patient.nextOrder) : ""} />
              <Field label="Subscription" value={patient.subscription} />
              <Field label="Order Type" value={patient.orderType} />
            </div>
          </Card>

          {/* Reorder Response Info */}
          {(patient.patientOrderResponse || patient.patientInsuranceResponse) && (
            <Card className="p-4 border-l-4 border-l-amber-500">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Reorder Response</p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Order Response" value={patient.patientOrderResponse} />
                <Field label="Insurance Response" value={patient.patientInsuranceResponse} />
              </div>
            </Card>
          )}

          {/* Demographics + Insurance + Medical Necessity */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Demographics</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Gender" value={patient.gender} />
                <Field label="Address" value={patient.address} />
                <Field label="Order Count" value={patient.orderCount} />
              </div>
            </Card>

            <Card className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Insurance</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Primary Insurance" value={patient.primaryInsurance} />
                <Field label="Member ID 1" value={patient.memberId1} />
                <Field label="Secondary Insurance" value={patient.secondaryInsurance} />
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

            <Card className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Medical Necessity & Auth</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Medical Records" value={patient.mr} className={patient.mr === "MR Valid" ? "text-green-600" : patient.mr === "MR Expired" || patient.mr === "MR Invalid" ? "text-red-600" : "text-amber-600"} />
                {patient.mnExpiry && <Field label="MN Expiry" value={formatDateMDY(patient.mnExpiry)} />}
                <Field label="Diagnosis" value={patient.diagnosis} />
                <Field label="CGM Coverage" value={patient.cgmCoverage} />
                <AuthStatusField label="Sensors Auth" status={patient.sensorsAuthStatus} />
                <AuthStatusField label="Supplies Auth" status={patient.suppliesAuthStatus} />
              </div>
              {(patient.sensorsAuthId || patient.sensorsStartAuth) && (
                <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-2">
                  <Field label="Sensors Auth ID" value={patient.sensorsAuthId} />
                  <Field label="Sensors Units" value={patient.sensorsUnits} />
                  {patient.sensorsStartAuth && <Field label="Auth Start" value={formatDateMDY(patient.sensorsStartAuth)} />}
                  {patient.sensorsEndAuth && <Field label="Auth End" value={formatDateMDY(patient.sensorsEndAuth)} />}
                </div>
              )}
            </Card>
          </div>

          {/* Order Details + Doctor + Financials */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Order Details</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Sensors Type" value={patient.sensorsType} />
                <Field label="Supplies Type" value={patient.suppliesType} />
                <Field label="Infusion Set 1" value={patient.infusionSet1} />
                <Field label="Inf. Qty 1" value={patient.infQty1} />
                <Field label="Infusion Set 2" value={patient.infusionSet2} />
                <Field label="Inf. Qty 2" value={patient.infQty2} />
              </div>
            </Card>

            <Card className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Doctor Info</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Doctor" value={patient.doctor} />
                <Field label="NPI" value={patient.npi} />
                <div className="col-span-2"><Field label="Doctor Address" value={patient.doctorAddress} /></div>
                <Field label="Doctor Phone" value={patient.doctorPhone ? formatPhone(patient.doctorPhone) : ""} />
                <Field label="Doctor Fax" value={patient.doctorFax} />
              </div>
            </Card>

            <Card className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Financials</p>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Total Revenue" value={patient.totalRevenue ? `$${patient.totalRevenue}` : ""} />
                <Field label="Total Cost" value={patient.totalCost ? `$${patient.totalCost}` : ""} />
                <Field label="Total GP" value={patient.totalGP ? `$${patient.totalGP}` : ""} />
                <Field label="ARR" value={patient.arr ? `$${patient.arr}` : ""} />
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
        </>
      )}

      {/* ═══ Claims-source detail ═══ */}
      {patient.source === "claims" && (
        <>
          {/* Claims overview */}
          <Card className="p-4 border-l-4 border-l-blue-500">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Claim Overview</p>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <Field label="Secondary Status" value={patient.secondaryStatus} />
              <Field label="Claim Type" value={patient.claimType} />
              <Field label="DOS" value={patient.dos ? formatDateMDY(patient.dos) : ""} />
              <Field label="Claim Sent" value={patient.claimSentDate ? formatDateMDY(patient.claimSentDate) : ""} />
              <Field label="Days Outstanding" value={patient.daysOutstanding} className={
                patient.daysOutstanding === "90+" || patient.daysOutstanding === "60-90" ? "text-red-600 font-bold" :
                patient.daysOutstanding === "30-60" ? "text-amber-600" : ""
              } />
              <Field label="Claim ID" value={patient.claimId} />
            </div>
          </Card>

          {/* Insurance + Payments + Doctor */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Insurance</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Primary Payor" value={patient.primaryPayor} />
                <Field label="Primary Member ID" value={patient.primaryMemberId} />
                <Field label="Secondary Payer" value={patient.secondaryPayer} />
                <Field label="Secondary Member ID" value={patient.secondaryMemberId} />
                <Field label="Gender" value={patient.gender} />
                <Field label="Address" value={patient.address} />
              </div>
            </Card>

            <Card className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Payment Info</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Est. Pay" value={patient.estPay ? `$${patient.estPay}` : ""} />
                <Field label="Secondary Paid" value={patient.secondaryPaid ? `$${patient.secondaryPaid}` : ""} />
                <Field label="Secondary Paid Date" value={patient.secondaryPaidDate ? formatDateMDY(patient.secondaryPaidDate) : ""} />
                <Field label="Primary Paid Amount" value={patient.primaryPaidAmount ? `$${patient.primaryPaidAmount}` : ""} />
                <Field label="Primary PR Amount" value={patient.primaryPRAmount ? `$${patient.primaryPRAmount}` : ""} />
              </div>
            </Card>

            <Card className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Doctor & Medical</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Doctor" value={patient.doctor} />
                <Field label="NPI" value={patient.npi} />
                <Field label="Doctor Address" value={patient.doctorAddress} />
                <Field label="Doctor Phone" value={patient.doctorPhone ? formatPhone(patient.doctorPhone) : ""} />
                <Field label="CGM Coverage" value={patient.cgmCoverage} />
                <Field label="Diagnosis" value={patient.diagnosis} />
              </div>
            </Card>
          </div>

          {/* Action Context + Denial + Notes */}
          {(patient.actionContext || patient.denialAction || patient.notesActivity) && (
            <Card className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Action & Notes</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <Field label="Action Context" value={patient.actionContext} />
                <Field label="Denial Action" value={patient.denialAction} />
              </div>
              {patient.notesActivity && (
                <div className="rounded-lg bg-muted/30 border p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Notes & Activity</p>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{patient.notesActivity}</p>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
