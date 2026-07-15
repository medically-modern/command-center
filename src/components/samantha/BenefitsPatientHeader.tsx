/**
 * BenefitsPatientHeader — READ-ONLY patient header for the redesigned
 * Benefits tab (spec §6, decision D5/S5). No edit mode, no edit toggle:
 * Serving, Primary/Secondary Insurance, Member IDs and everything else
 * are finalized at Profile Send-Off before the patient reaches Benefits.
 *
 * Home Plan / Coverage Type / Medicaid ID from the Stedi 271 do not exist
 * as Insurance-board columns yet — the Stedi strip shows what the board
 * has (Plan Name, Plan Begin, QMB, Coinsurance %, Deductible / OOP Max
 * remaining), payer-aware (QMB renders for Medicare payers only).
 */
import { useState } from "react";
import type { Patient } from "@/lib/samantha/workflow";
import {
  Activity,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Cpu,
  FileText,
  Hash,
  IdCard,
  Mail,
  MapPin,
  Phone,
  Send,
  ShieldCheck,
  Stethoscope,
  User,
  UserRound,
} from "lucide-react";

function formatPhone(raw: string): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}

/** Read-only labelled value. The value is user-select-all for one-click copy. */
function Field({
  icon,
  label,
  value,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`flex items-start gap-2 min-w-0 ${className ?? ""}`}>
      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </p>
        <p
          className="text-sm font-medium truncate select-all"
          title={value || "—"}
        >
          {value || "—"}
        </p>
      </div>
    </div>
  );
}

function StediField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </p>
      <p className="text-sm font-medium truncate select-all" title={value || "—"}>
        {value || "—"}
      </p>
    </div>
  );
}

interface Props {
  patient: Patient;
}

export function BenefitsPatientHeader({ patient }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [mnNotesOpen, setMnNotesOpen] = useState(false);

  const isMedicarePayer = /medicare/i.test(patient.primaryInsurance ?? "");
  const hasPumpOrSupplies = !!(
    patient.serving &&
    (patient.serving.includes("Pump") || patient.serving.includes("Supplies"))
  );

  return (
    <section className="rounded-xl border bg-card shadow-card overflow-hidden border-t-4 border-t-primary">
      <div className="p-5 space-y-4">
        {/* Identity row */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-bold select-all">{patient.name || "—"}</h2>
            <p className="text-xs text-muted-foreground">
              DOB <span className="font-medium text-foreground select-all">{patient.dob || "—"}</span>
              {" · "}
              <span className="font-medium text-foreground select-all">
                {formatPhone(patient.patientPhone ?? "") || "—"}
              </span>
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <ShieldCheck className="h-3 w-3" /> Read-only · fed by Profile Send-Off
          </span>
        </div>

        {/* Core fields */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Field icon={<Send className="h-4 w-4" />} label="Serving" value={patient.serving || ""} />
          <Field icon={<Activity className="h-4 w-4" />} label="Diagnosis" value={patient.diagnosis || ""} />
          <Field icon={<ShieldCheck className="h-4 w-4" />} label="Primary Insurance" value={patient.primaryInsurance || ""} />
          <Field icon={<ShieldCheck className="h-4 w-4" />} label="Secondary Insurance" value={patient.secondaryInsurance || ""} />
          <Field icon={<IdCard className="h-4 w-4" />} label="Member ID 1" value={patient.memberId1 || ""} />
          <Field icon={<IdCard className="h-4 w-4" />} label="Member ID 2" value={patient.memberId2 || ""} />
        </div>

        {/* Stedi strip */}
        <div className="rounded-lg border bg-muted/20 p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Insurance Details · Stedi Check
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StediField label="Plan Name" value={patient.planName ?? ""} />
            <StediField label="Plan Begin" value={patient.stediPlanBegin ?? ""} />
            {isMedicarePayer && <StediField label="QMB?" value={patient.stediQmb ?? ""} />}
            <StediField label="Co-Insurance" value={patient.stediCoinsurance ?? ""} />
            <StediField label="Deductible Remaining" value={patient.deductibleRemaining ?? ""} />
            <StediField label="OOP Max Remaining" value={patient.oopMaxRemaining ?? ""} />
          </div>
        </div>

        {/* Collapsible details */}
        <button
          onClick={() => setDetailsOpen((v) => !v)}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {detailsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {detailsOpen ? "Hide details" : "Show address, devices & doctor info"}
        </button>

        {detailsOpen && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field icon={<MapPin className="h-4 w-4" />} label="Patient Address" value={patient.patientAddress || ""} className="col-span-2" />
              <Field icon={<UserRound className="h-4 w-4" />} label="Referral Source" value={patient.referralSource || ""} />
              {hasPumpOrSupplies && (
                <Field icon={<Cpu className="h-4 w-4" />} label="Pump Type" value={patient.pumpBrand || ""} />
              )}
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                Doctor Info
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field icon={<Stethoscope className="h-4 w-4" />} label="Doctor" value={patient.doctorName || ""} />
                <Field icon={<Phone className="h-4 w-4" />} label="Phone" value={formatPhone(patient.doctorPhone ?? "")} />
                <Field icon={<Hash className="h-4 w-4" />} label="NPI" value={patient.doctorNpi || ""} />
                <Field icon={<Send className="h-4 w-4" />} label="Fax" value={patient.doctorFax || ""} />
                <Field icon={<Mail className="h-4 w-4" />} label="Email" value={patient.doctorEmail || ""} />
                <Field icon={<User className="h-4 w-4" />} label="Clinicals Method" value={patient.clinicalsMethod || ""} />
                <Field icon={<Building2 className="h-4 w-4" />} label="Clinic" value={patient.clinicName || ""} className="col-span-2" />
              </div>
            </div>
          </div>
        )}

        {/* Upstream notes (read-only viewers) */}
        {(patient.profileSendOffNotes || patient.mnWorkflowNotes) && (
          <div className="flex gap-2 flex-wrap">
            {patient.profileSendOffNotes && (
              <button
                onClick={() => setNotesOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                <FileText className="h-3.5 w-3.5" /> Profile Intake Notes
              </button>
            )}
            {patient.mnWorkflowNotes && (
              <button
                onClick={() => setMnNotesOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                <CalendarDays className="h-3.5 w-3.5" /> MN Workflow Notes
              </button>
            )}
          </div>
        )}
        {notesOpen && patient.profileSendOffNotes && (
          <pre className="text-sm whitespace-pre-wrap font-sans rounded-md border bg-background p-3 max-h-[220px] overflow-y-auto">
            {patient.profileSendOffNotes}
          </pre>
        )}
        {mnNotesOpen && patient.mnWorkflowNotes && (
          <pre className="text-sm whitespace-pre-wrap font-sans rounded-md border bg-background p-3 max-h-[220px] overflow-y-auto">
            {patient.mnWorkflowNotes}
          </pre>
        )}
      </div>
    </section>
  );
}
