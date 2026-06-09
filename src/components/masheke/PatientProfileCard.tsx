import { useState } from "react";
import type { Patient } from "@/lib/masheke/workflow";
import {
  IdCard,
  Stethoscope,
  ShieldCheck,
  UserRound,
  Phone,
  Mail,
  Hash,
  Building2,
  MapPin,
  Send,
  Pencil,
  Check,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { DoctorNotesPanel } from "@/components/shared/DoctorNotesPanel";
import { CollapsiblePanel } from "@/components/shared/CollapsiblePanel";
import { cn } from "@/lib/utils";

interface Props {
  patient: Patient;
  /** When true, the Doctor Info panel is expanded by default. */
  defaultDoctorOpen?: boolean;
  /** When true, Doctor Info is always shown — no toggle, no collapse. */
  lockDoctorOpen?: boolean;
  /** Called when the user edits a doctor field via the pencil-edit UI.
   *  Updates local overlay only — Monday write happens on Send to Monday.
   *  Omit to hide the pencil icon entirely (read-only). */
  onDoctorEdit?: (patch: Partial<Patient>) => void;
}

/* ── Serving color config ─────────────────────────────────── */

type ServingKey = "cgm" | "ip" | "ipcgm" | "supplies" | "supplcgm" | "default";

interface ServingColors {
  iconBg: string;
  iconBorder: string;
  tagBg: string;
  tagText: string;
  fieldBg: string;
  fieldBorder: string;
  fieldVal: string;
  fieldLbl: string;
  label: string;
}

const SERVING_COLORS: Record<ServingKey, ServingColors> = {
  cgm: {
    iconBg: "bg-emerald-100", iconBorder: "border-emerald-300",
    tagBg: "bg-emerald-200", tagText: "text-emerald-900",
    fieldBg: "bg-emerald-50", fieldBorder: "border-emerald-300",
    fieldVal: "text-emerald-900", fieldLbl: "text-emerald-700",
    label: "CGM",
  },
  ip: {
    iconBg: "bg-blue-100", iconBorder: "border-blue-300",
    tagBg: "bg-blue-200", tagText: "text-blue-900",
    fieldBg: "bg-blue-50", fieldBorder: "border-blue-300",
    fieldVal: "text-blue-900", fieldLbl: "text-blue-700",
    label: "Insulin pump",
  },
  ipcgm: {
    iconBg: "bg-violet-100", iconBorder: "border-violet-300",
    tagBg: "bg-violet-200", tagText: "text-violet-900",
    fieldBg: "bg-violet-50", fieldBorder: "border-violet-300",
    fieldVal: "text-violet-900", fieldLbl: "text-violet-700",
    label: "Pump + CGM",
  },
  supplies: {
    iconBg: "bg-amber-100", iconBorder: "border-amber-300",
    tagBg: "bg-amber-200", tagText: "text-amber-900",
    fieldBg: "bg-amber-50", fieldBorder: "border-amber-300",
    fieldVal: "text-amber-900", fieldLbl: "text-amber-700",
    label: "Supplies only",
  },
  supplcgm: {
    iconBg: "bg-rose-100", iconBorder: "border-rose-300",
    tagBg: "bg-rose-200", tagText: "text-rose-900",
    fieldBg: "bg-rose-50", fieldBorder: "border-rose-300",
    fieldVal: "text-rose-900", fieldLbl: "text-rose-700",
    label: "Supplies + CGM",
  },
  default: {
    iconBg: "bg-muted", iconBorder: "border-border",
    tagBg: "bg-muted", tagText: "text-foreground",
    fieldBg: "bg-muted/50", fieldBorder: "border-border",
    fieldVal: "text-foreground", fieldLbl: "text-muted-foreground",
    label: "",
  },
};

function getServingKey(serving?: string | null): ServingKey {
  switch (serving) {
    case "CGM": return "cgm";
    case "Insulin Pump": return "ip";
    case "Insulin Pump + CGM": return "ipcgm";
    case "Supplies Only": return "supplies";
    case "Supplies + CGM": return "supplcgm";
    default: return "default";
  }
}

/** Map serving type → accent colors for the two CollapsiblePanels */
type PanelAccent = "blue" | "teal" | "violet" | "amber" | "emerald" | "rose" | "purple" | "slate";
const PANEL_ACCENTS: Record<ServingKey, { details: PanelAccent; doctor: PanelAccent }> = {
  cgm:      { details: "emerald", doctor: "purple" },
  ip:       { details: "blue",    doctor: "purple" },
  ipcgm:    { details: "violet",  doctor: "purple" },
  supplies: { details: "amber",   doctor: "purple" },
  supplcgm: { details: "rose",    doctor: "purple" },
  default:  { details: "slate",   doctor: "purple" },
};

/* ── SVG icons per serving type ───────────────────────────── */

function CgmIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 36" fill="none" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="18" r="7" stroke="currentColor" />
      <path d="M18 11v-3M18 28v-3M11 18h-3M28 18h-3" stroke="currentColor" />
      <circle cx="18" cy="18" r="2.5" fill="currentColor" />
    </svg>
  );
}

function PumpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 36" fill="none" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="10" y="10" rx="3" width="16" height="20" stroke="currentColor" />
      <line x1="14" y1="15" x2="22" y2="15" stroke="currentColor" />
      <circle cx="18" cy="22" r="2" stroke="currentColor" />
      <path d="M18 10v-4M18 6h6" stroke="currentColor" />
    </svg>
  );
}

function PumpCgmIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 36" fill="none" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <g className="text-violet-600">
        <rect x="6" y="12" rx="2" width="12" height="16" stroke="currentColor" />
        <line x1="9" y1="16" x2="15" y2="16" stroke="currentColor" />
        <circle cx="12" cy="22" r="1.5" stroke="currentColor" />
        <path d="M12 12v-3h4" stroke="currentColor" />
      </g>
      <g className="text-violet-400">
        <circle cx="26" cy="20" r="5" stroke="currentColor" />
        <circle cx="26" cy="20" r="1.5" fill="currentColor" />
        <path d="M26 15v-2M26 27v-2M21 20h-1M32 20h-1" stroke="currentColor" />
      </g>
    </svg>
  );
}

function SuppliesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 36" fill="none" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 14l12-6 12 6-12 6z" stroke="currentColor" />
      <path d="M6 14v10l12 6 12-6V14" stroke="currentColor" />
      <path d="M18 20v10" stroke="currentColor" />
    </svg>
  );
}

function SuppliesCgmIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 36" fill="none" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <g className="text-rose-600">
        <path d="M4 16l8-4 8 4-8 4z" stroke="currentColor" />
        <path d="M4 16v7l8 4 8-4v-7" stroke="currentColor" />
        <path d="M12 20v7" stroke="currentColor" />
      </g>
      <g className="text-rose-400">
        <circle cx="28" cy="18" r="4.5" stroke="currentColor" />
        <circle cx="28" cy="18" r="1.5" fill="currentColor" />
        <path d="M28 13.5v-1.5M28 24v-1.5" stroke="currentColor" />
      </g>
    </svg>
  );
}

function DefaultServingIcon({ className }: { className?: string }) {
  return <Stethoscope className={className} />;
}

function ServingIcon({ serving, className }: { serving?: string | null; className?: string }) {
  switch (serving) {
    case "CGM": return <CgmIcon className={className} />;
    case "Insulin Pump": return <PumpIcon className={className} />;
    case "Insulin Pump + CGM": return <PumpCgmIcon className={className} />;
    case "Supplies Only": return <SuppliesIcon className={className} />;
    case "Supplies + CGM": return <SuppliesCgmIcon className={className} />;
    default: return <DefaultServingIcon className={className} />;
  }
}

/* ── Sub-components ───────────────────────────────────────── */

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
        <p className="text-sm font-medium truncate" title={value || "—"}>
          {value || "—"}
        </p>
      </div>
    </div>
  );
}

function EditableField({
  icon,
  label,
  value,
  editing,
  onChange,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  editing: boolean;
  onChange?: (v: string) => void;
  className?: string;
}) {
  if (!editing) return <Field icon={icon} label={label} value={value} className={className} />;
  return (
    <div className={`flex items-start gap-2 min-w-0 ${className ?? ""}`}>
      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">
          {label}
        </p>
        <Input
          className="h-7 text-sm"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={`Enter ${label.toLowerCase()}`}
        />
      </div>
    </div>
  );
}

/** Format raw phone digits into (555)555-5555 or +1 (555)555-5555 */
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)})${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

/* ── Accent field (colored) ───────────────────────────────── */

function AccentField({
  icon,
  label,
  value,
  colors,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  colors: ServingColors;
}) {
  return (
    <div className={cn("rounded-lg border-[1.5px] p-3.5", colors.fieldBg, colors.fieldBorder)}>
      <p className={cn("text-xs flex items-center gap-1.5 mb-1", colors.fieldLbl)}>
        {icon}
        {label}
      </p>
      <p className={cn("text-[17px] font-medium truncate", colors.fieldVal)} title={value || "—"}>
        {value || "—"}
      </p>
    </div>
  );
}

/* ── Main component ───────────────────────────────────────── */

export function PatientProfileCard({
  patient,
  defaultDoctorOpen = false,
  lockDoctorOpen = false,
  onDoctorEdit,
}: Props) {
  const [editingDoctor, setEditingDoctor] = useState(false);
  const canEdit = !!onDoctorEdit;

  const sk = getServingKey(patient.serving);
  const colors = SERVING_COLORS[sk];
  const panelAccents = PANEL_ACCENTS[sk];

  const editButton = canEdit ? (
    <button
      onClick={() => setEditingDoctor((e) => !e)}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted"
      title={editingDoctor ? "Done editing" : "Edit doctor info"}
    >
      {editingDoctor ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
      <span>{editingDoctor ? "Done" : "Edit"}</span>
    </button>
  ) : null;

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
    <div className="rounded-xl bg-card border shadow-card overflow-hidden">
      {/* ── Hero row: icon + name + intake notes ── */}
      <div className="flex items-center gap-5 px-6 py-5">
        {/* Serving icon */}
        <div
          className={cn(
            "w-20 h-20 rounded-xl border-[1.5px] flex items-center justify-center shrink-0",
            colors.iconBg,
            colors.iconBorder,
          )}
        >
          <ServingIcon serving={patient.serving} className="h-12 w-12" />
        </div>

        {/* Name + subtitle */}
        <div className="flex-1 min-w-0">
          <p className="text-[22px] font-medium leading-tight truncate">{patient.name}</p>
          <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
            <span
              className={cn(
                "text-[13px] font-medium px-3.5 py-1 rounded-full",
                colors.tagBg,
                colors.tagText,
              )}
            >
              {patient.serving ?? "Unknown"}
            </span>
            <span className="text-sm text-muted-foreground">{patient.gender ?? ""}</span>
            <span className="text-[10px] text-muted-foreground/50">&middot;</span>
            <span className="text-sm text-muted-foreground">{patient.dob}</span>
            {patient.phone && (
              <>
                <span className="text-[10px] text-muted-foreground/50">&middot;</span>
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" />
                  {formatPhone(patient.phone)}
                </span>
              </>
            )}
          </div>
        </div>


      </div>

      {/* ── Accent fields row: Insurance, Member ID, Serving ── */}
      <div className="grid grid-cols-3 gap-2 px-6 pb-5">
        <AccentField
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Insurance"
          value={patient.primaryInsurance ?? ""}
          colors={colors}
        />
        <AccentField
          icon={<IdCard className="h-4 w-4" />}
          label="Member ID"
          value={patient.memberId1 ?? ""}
          colors={colors}
        />
        <AccentField
          icon={<Stethoscope className="h-4 w-4" />}
          label="Serving"
          value={patient.serving ?? ""}
          colors={colors}
        />
      </div>

      {/* ── More Details collapsible ── */}
      <div className="px-6 pb-5">
        <CollapsiblePanel accent={panelAccents.details} title="More Details" defaultOpen={defaultDoctorOpen || lockDoctorOpen}>
          <div className="space-y-4">
            {/* Address + Member ID 2 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field
                icon={<MapPin className="h-4 w-4" />}
                label="Address"
                value={patient.address ?? ""}
                className="sm:col-span-2"
              />
              {patient.memberId2 && (
                <Field
                  icon={<IdCard className="h-4 w-4" />}
                  label="Member ID 2"
                  value={patient.memberId2}
                />
              )}
            </div>

            <div className="h-px bg-border" />

            {/* Referral + Request + Equipment */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Field
                icon={<Stethoscope className="h-4 w-4" />}
                label="Referral Type"
                value={patient.referralType ?? ""}
              />
              <Field
                icon={<Stethoscope className="h-4 w-4" />}
                label="Referral Source"
                value={patient.referralSource ?? ""}
              />
              <Field
                icon={<Send className="h-4 w-4" />}
                label="Request Type"
                value={patient.requestType ?? ""}
              />
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

            {/* OOW Date + Malfunction */}
            {(patient.oowDate || patient.malfunction) && (
              <>
                <div className="h-px bg-border" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {patient.oowDate && (
                    <Field
                      icon={<Clock className="h-4 w-4" />}
                      label="OOW Date"
                      value={patient.oowDate}
                    />
                  )}
                  {patient.malfunction && (
                    <Field
                      icon={<AlertTriangle className="h-4 w-4" />}
                      label="Malfunction Reason"
                      value={patient.malfunction}
                    />
                  )}
                </div>
              </>
            )}

            {/* Doctor Info — nested collapsible */}
            <CollapsiblePanel accent={panelAccents.doctor} title="Doctor Info" defaultOpen={defaultDoctorOpen || lockDoctorOpen}>
              <div className="space-y-3">
                {editButton && (
                  <div className="flex justify-end">{editButton}</div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <EditableField
                    icon={<UserRound className="h-4 w-4" />}
                    label="Doctor Name"
                    value={patient.doctorName ?? ""}
                    editing={editingDoctor}
                    onChange={(v) => onDoctorEdit?.({ doctorName: v })}
                  />
                  <Field
                    icon={<Send className="h-4 w-4" />}
                    label="Clinicals Method"
                    value={patient.clinicalsMethod ?? ""}
                  />
                  <EditableField
                    icon={<Hash className="h-4 w-4" />}
                    label="NPI"
                    value={patient.doctorNpi ?? ""}
                    editing={editingDoctor}
                    onChange={(v) => onDoctorEdit?.({ doctorNpi: v })}
                  />
                  <EditableField
                    icon={<Phone className="h-4 w-4" />}
                    label="Phone"
                    value={patient.doctorPhone ?? ""}
                    editing={editingDoctor}
                    onChange={(v) => onDoctorEdit?.({ doctorPhone: v })}
                  />
                  <EditableField
                    icon={<Mail className="h-4 w-4" />}
                    label="Fax"
                    value={patient.doctorFax ?? ""}
                    editing={editingDoctor}
                    onChange={(v) => onDoctorEdit?.({ doctorFax: v })}
                  />
                  <EditableField
                    icon={<Mail className="h-4 w-4" />}
                    label="Email"
                    value={patient.doctorEmail ?? ""}
                    editing={editingDoctor}
                    onChange={(v) => onDoctorEdit?.({ doctorEmail: v })}
                  />
                  <EditableField
                    icon={<Building2 className="h-4 w-4" />}
                    label="Clinic"
                    value={patient.clinicName ?? ""}
                    editing={editingDoctor}
                    onChange={(v) => onDoctorEdit?.({ clinicName: v })}
                    className="sm:col-span-2"
                  />
                </div>

                {/* Doctor-level notes from the Doctor Database */}
                {patient.doctorNpi && (
                  <DoctorNotesPanel doctorNpi={patient.doctorNpi} doctorName={patient.doctorName} compact />
                )}
              </div>
            </CollapsiblePanel>
          </div>
        </CollapsiblePanel>
      </div>


    </div>
  );
}
