import { useState } from "react";
import type { Patient } from "@/lib/mesheke/workflow";
import {
  CalendarDays,
  IdCard,
  User,
  Stethoscope,
  ShieldCheck,
  UserRound,
  ChevronDown,
  ChevronRight,
  Phone,
  Mail,
  Hash,
  Building2,
  Send,
} from "lucide-react";

interface Props {
  patient: Patient;
  /** When true, the Doctor Info panel is expanded by default. */
  defaultDoctorOpen?: boolean;
  /** When true, Doctor Info is always shown — no toggle, no collapse. */
  lockDoctorOpen?: boolean;
}

function Field({
  icon,
  label,
  value,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  /** Tailwind classes added to the outer wrapper — useful for grid
   *  spans on long values like clinic names. */
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
        <p className="text-sm font-medium truncate" title={value || "—"}>
          {value || "—"}
        </p>
      </div>
    </div>
  );
}

export function PatientProfileCard({
  patient,
  defaultDoctorOpen = false,
  lockDoctorOpen = false,
}: Props) {
  const [doctorOpen, setDoctorOpen] = useState(defaultDoctorOpen || lockDoctorOpen);

  return (
    <div className="rounded-xl bg-card border shadow-card p-4 space-y-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">Patient Profile</p>

      {/* Row 1: identity + insurance */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Field icon={<User className="h-4 w-4" />} label="Name" value={patient.name} />
        <Field icon={<CalendarDays className="h-4 w-4" />} label="DOB" value={patient.dob} />
        <Field
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Primary Insurance"
          value={patient.primaryInsurance ?? ""}
        />
        <Field
          icon={<IdCard className="h-4 w-4" />}
          label="Member ID"
          value={patient.memberId1 ?? ""}
        />
      </div>

      <div className="h-px bg-border" />

      {/* Workflow context + equipment.
         CGM Type shows only when serving CGM. Pump Type shows when serving
         Insulin Pump or Supplies Only. If there's only one type to show, the
         result is 4 fields and fits in one row; if both, we render a second
         row (3 + 2 layout). */}
      {(() => {
        const showCgmType =
          patient.serving === "CGM" ||
          patient.serving === "Insulin Pump + CGM" ||
          patient.serving === "Supplies + CGM";
        const showPumpType =
          patient.serving === "Insulin Pump" ||
          patient.serving === "Insulin Pump + CGM" ||
          patient.serving === "Supplies Only" ||
          patient.serving === "Supplies + CGM";
        const both = showCgmType && showPumpType;

        return (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Field
                icon={<Stethoscope className="h-4 w-4" />}
                label="Referral Type"
                value={patient.referralType ?? ""}
              />
              <Field
                icon={<Send className="h-4 w-4" />}
                label="Request Type"
                value={patient.requestType ?? ""}
              />
              <Field
                icon={<Stethoscope className="h-4 w-4" />}
                label="Serving"
                value={patient.serving ?? ""}
              />
              {/* If only ONE type to show, slot it into the 4th column to keep one row */}
              {!both && showCgmType && (
                <Field
                  icon={<Stethoscope className="h-4 w-4" />}
                  label="CGM Type"
                  value={patient.cgmType ?? ""}
                />
              )}
              {!both && showPumpType && (
                <Field
                  icon={<Stethoscope className="h-4 w-4" />}
                  label="Pump Type"
                  value={patient.pumpType ?? ""}
                />
              )}
            </div>
            {/* If BOTH types apply, second row holds them */}
            {both && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Field
                  icon={<Stethoscope className="h-4 w-4" />}
                  label="CGM Type"
                  value={patient.cgmType ?? ""}
                />
                <Field
                  icon={<Stethoscope className="h-4 w-4" />}
                  label="Pump Type"
                  value={patient.pumpType ?? ""}
                />
              </div>
            )}
          </>
        );
      })()}

      {/* Doctor info — collapsible by default, but locked open when
         the calling tab needs the contact details always visible
         (e.g. Chase Clinicals where the agent is dialing every visit). */}
      <div className="border-t pt-3">
        {lockDoctorOpen ? (
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Doctor Info
          </p>
        ) : (
          <button
            onClick={() => setDoctorOpen((o) => !o)}
            className="w-full flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors gap-3"
          >
            <span className="flex items-center gap-2">
              {doctorOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Doctor Info
            </span>
            {!doctorOpen && (
              <span className="flex items-center gap-3 text-[11px] normal-case text-foreground/70 truncate">
                <span className="inline-flex items-center gap-1 truncate">
                  <UserRound className="h-3 w-3 shrink-0" />
                  <span className="truncate">{patient.doctorName ?? "—"}</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <Send className="h-3 w-3 shrink-0" />
                  <span>{patient.clinicalsMethod ?? "—"}</span>
                </span>
              </span>
            )}
          </button>
        )}

        {(doctorOpen || lockDoctorOpen) && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Field
              icon={<UserRound className="h-4 w-4" />}
              label="Doctor Name"
              value={patient.doctorName ?? ""}
            />
            <Field
              icon={<Send className="h-4 w-4" />}
              label="Clinicals Method"
              value={patient.clinicalsMethod ?? ""}
            />
            <Field
              icon={<Hash className="h-4 w-4" />}
              label="NPI"
              value={patient.doctorNpi ?? ""}
            />
            <Field
              icon={<Phone className="h-4 w-4" />}
              label="Phone"
              value={patient.doctorPhone ?? ""}
            />
            <Field
              icon={<Mail className="h-4 w-4" />}
              label="Fax"
              value={patient.doctorFax ?? ""}
            />
            <Field
              icon={<Mail className="h-4 w-4" />}
              label="Email"
              value={patient.doctorEmail ?? ""}
            />
            <Field
              icon={<Building2 className="h-4 w-4" />}
              label="Clinic"
              value={patient.clinicName ?? ""}
              // Clinic names tend to be long — let it span the empty
              // 4th column on lg + the empty 2nd column on sm so the
              // value doesn't truncate.
              className="sm:col-span-2"
            />
          </div>
        )}
      </div>
    </div>
  );
}
