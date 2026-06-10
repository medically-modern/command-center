import { useState } from "react";
import type { Patient } from "@/lib/masheke/workflow";
import {
  Stethoscope,
  Phone,
  Pencil,
  Check,
  ChevronDown,
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
      <circle cx="18" cy="18" r="8" stroke="currentColor" />
      <circle cx="18" cy="18" r="3" fill="currentColor" />
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
        <circle cx="26" cy="20" r="1.8" fill="currentColor" />
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
      </g>
    </svg>
  );
}

function IconInsurance({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2L3 5v4c0 5 3 8.5 7 10 4-1.5 7-5 7-10V5L10 2z" stroke="currentColor" />
      <path d="M7 10l2 2 4-4" stroke="currentColor" />
    </svg>
  );
}

function IconServing({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="8" r="6" stroke="currentColor" />
      <path d="M10 5v3l2 1.5" stroke="currentColor" />
      <path d="M6 16h8" stroke="currentColor" />
      <path d="M7 18h6" stroke="currentColor" />
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

/* ── Field-level inline SVG icons ────────────────────────── */

function IconAddress({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2C6.7 2 4 4.5 4 7.6c0 4.4 6 10.4 6 10.4s6-6 6-10.4C16 4.5 13.3 2 10 2z" stroke="currentColor" />
      <circle cx="10" cy="7.5" r="2" stroke="currentColor" />
    </svg>
  );
}

function IconMemberId({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" />
      <rect x="4.5" y="7" width="4" height="3" rx="0.8" stroke="currentColor" />
      <line x1="11" y1="8" x2="15.5" y2="8" stroke="currentColor" />
      <line x1="11" y1="10.5" x2="14" y2="10.5" stroke="currentColor" />
      <line x1="4.5" y1="13" x2="10" y2="13" stroke="currentColor" />
    </svg>
  );
}

function IconReferralType({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10h8" stroke="currentColor" />
      <path d="M12 6l4 4-4 4" stroke="currentColor" />
      <path d="M4 4v2a4 4 0 004 4" stroke="currentColor" />
      <path d="M4 16v-2a4 4 0 014-4" stroke="currentColor" />
    </svg>
  );
}

function IconReferralSource({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="10" height="12" rx="1.5" stroke="currentColor" />
      <path d="M6 5V3.5a1.5 1.5 0 011.5-1.5h1A1.5 1.5 0 0110 3.5V5" stroke="currentColor" />
      <line x1="6" y1="8.5" x2="10" y2="8.5" stroke="currentColor" />
      <line x1="6" y1="11" x2="10" y2="11" stroke="currentColor" />
      <line x1="6" y1="13.5" x2="9" y2="13.5" stroke="currentColor" />
      <path d="M14 10l3 3-3 3" stroke="currentColor" />
      <path d="M13 13h4" stroke="currentColor" />
    </svg>
  );
}

function IconRequestType({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="2" width="14" height="16" rx="2" stroke="currentColor" />
      <path d="M7 7l2 2 4-4" stroke="currentColor" />
      <line x1="7" y1="12" x2="13" y2="12" stroke="currentColor" />
      <line x1="7" y1="15" x2="11" y2="15" stroke="currentColor" />
    </svg>
  );
}

function IconCgmType({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="6" stroke="currentColor" />
      <circle cx="10" cy="10" r="2" fill="currentColor" />
    </svg>
  );
}

function IconPumpType({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="5" rx="2" width="10" height="13" stroke="currentColor" />
      <line x1="8" y1="9" x2="12" y2="9" stroke="currentColor" />
      <circle cx="10" cy="13" r="1.5" stroke="currentColor" />
      <path d="M10 5v-3M10 2h4" stroke="currentColor" />
    </svg>
  );
}

function IconOowDate({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="12" rx="2" stroke="currentColor" />
      <line x1="2" y1="7" x2="14" y2="7" stroke="currentColor" />
      <line x1="6" y1="1" x2="6" y2="4" stroke="currentColor" />
      <line x1="10" y1="1" x2="10" y2="4" stroke="currentColor" />
      <circle cx="14.5" cy="14.5" r="4" stroke="currentColor" />
      <path d="M14.5 12.5v2l1.5 1" stroke="currentColor" />
    </svg>
  );
}

function IconMalfunction({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2L1 18h18L10 2z" stroke="currentColor" />
      <line x1="10" y1="8" x2="10" y2="12" stroke="currentColor" />
      <circle cx="10" cy="14.5" r="0.8" fill="currentColor" />
    </svg>
  );
}

function IconDoctorName({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="5.5" r="3" stroke="currentColor" />
      <path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" />
      <path d="M7 11.5c-1.5.5-2 1.5-2 2.5" stroke="currentColor" />
      <path d="M13 11.5c1.5.5 2 1.5 2 2.5" stroke="currentColor" />
      <path d="M7 11.5c0 2 1.2 3 3 3s3-1 3-3" stroke="currentColor" />
      <circle cx="10" cy="15.5" r="1" fill="currentColor" />
    </svg>
  );
}

function IconClinicalsMethod({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="14" height="11" rx="2" stroke="currentColor" />
      <path d="M3 6l3-3h8l3 3" stroke="currentColor" />
      <path d="M10 6v4" stroke="currentColor" />
      <circle cx="10" cy="10" r="0.8" fill="currentColor" />
      <line x1="3" y1="13" x2="17" y2="13" stroke="currentColor" />
    </svg>
  );
}

function IconNpi({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="14" height="14" rx="3" stroke="currentColor" />
      <path d="M7 13V7l3 6V7" stroke="currentColor" />
      <circle cx="13" cy="10" r="0.8" fill="currentColor" />
    </svg>
  );
}

function IconPhone({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 3a1 1 0 011-1h2.5a1 1 0 01.9.6L9.5 5a1 1 0 01-.3 1.1L7.8 7.3a10 10 0 004.9 4.9l1.2-1.4a1 1 0 011.1-.3l2.4 1.1a1 1 0 01.6.9V15a1 1 0 01-1 1C9 16 4 11 4 3z" stroke="currentColor" />
    </svg>
  );
}

function IconFax({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="8" width="16" height="9" rx="1.5" stroke="currentColor" />
      <path d="M5 8V3h7l3 3v2" stroke="currentColor" />
      <path d="M12 3v3h3" stroke="currentColor" />
      <line x1="5" y1="12" x2="9" y2="12" stroke="currentColor" />
      <line x1="5" y1="14.5" x2="8" y2="14.5" stroke="currentColor" />
      <circle cx="14" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

function IconEmail({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" />
      <path d="M2 4l8 6 8-6" stroke="currentColor" />
    </svg>
  );
}

function IconClinic({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="14" height="12" rx="1.5" stroke="currentColor" />
      <path d="M10 2v4M8 4h4" stroke="currentColor" />
      <rect x="5.5" y="9" width="3" height="3" rx="0.5" stroke="currentColor" />
      <rect x="11.5" y="9" width="3" height="3" rx="0.5" stroke="currentColor" />
      <rect x="8" y="14" width="4" height="4" rx="0.5" stroke="currentColor" />
    </svg>
  );
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
    <div className={`flex items-start gap-3 min-w-0 ${className ?? ""}`}>
      <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </p>
        <p className="text-[15px] font-heading font-medium tracking-tight truncate" title={value || "—"}>
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
    <div className={`flex items-start gap-3 min-w-0 ${className ?? ""}`}>
      <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">
          {label}
        </p>
        <Input
          className="h-8 text-[15px] font-heading tracking-tight"
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

  const [detailsOpen, setDetailsOpen] = useState(defaultDoctorOpen || lockDoctorOpen);
  const showDetails = lockDoctorOpen || detailsOpen;

  return (
    <div
      className="rounded-2xl bg-card border shadow-card p-6"
      style={{ borderTopWidth: 4, borderTopColor: "var(--mm-teal)" }}
    >
      {/* ── Eyebrow + name + DOB · phone (prototype header) ── */}
      <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Patient</p>
      <h1 className="text-3xl font-black tracking-tight mt-0.5 truncate" title={patient.name}>
        {patient.name}
      </h1>
      <p className="mt-1 text-lg text-muted-foreground">
        DOB {patient.dob || "—"}
        {patient.gender ? ` · ${patient.gender}` : ""}
        {patient.phone ? ` · ${formatPhone(patient.phone)}` : ""}
      </p>

      {/* ── Three grouped boxes — all gray, no serving colors ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
        <div className="rounded-xl border bg-muted/30 p-4">
          <div className="grid grid-cols-2 gap-3">
            <HVal label="Request" value={patient.requestType ?? ""} />
            <HVal label="Serving" value={patient.serving ?? ""} />
          </div>
        </div>
        <div className="rounded-xl border bg-muted/30 p-4">
          <div className="grid grid-cols-2 gap-3">
            <HVal label="Referral Type" value={patient.referralType ?? ""} />
            <HVal label="Referral Source" value={patient.referralSource ?? ""} />
          </div>
        </div>
        <div className="rounded-xl border bg-muted/30 p-4">
          <HVal label="Primary Insurance" value={patient.primaryInsurance ?? ""} />
        </div>
      </div>

      {/* ── Single inline toggle (no nested drawers) ── */}
      {!lockDoctorOpen && (
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          aria-expanded={showDetails}
          className="mt-5 inline-flex items-center gap-1.5 text-lg font-semibold text-[color:var(--mm-teal)] hover:opacity-80 transition-opacity"
        >
          <ChevronDown
            className={cn("h-5 w-5 transition-transform", showDetails && "rotate-180")}
          />
          {showDetails ? "Hide details" : "Show member info, address, devices & doctor"}
        </button>
      )}

      {showDetails && (
        <div className="mt-5 border-t pt-5 space-y-5">
          {/* Member info, address, devices */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-4">
            <HVal label="Member ID" value={patient.memberId1 ?? ""} />
            <HVal label="Address" value={patient.address ?? ""} className="col-span-2" />
            {patient.memberId2 ? (
              <HVal label="Member ID 2" value={patient.memberId2} />
            ) : (
              <span className="hidden lg:block" />
            )}
            <HVal label="CGM" value={patient.cgmType ?? ""} />
            <HVal label="Pump" value={patient.pumpType ?? ""} />
            {patient.oowDate && <HVal label="OOW Date" value={patient.oowDate} />}
            {patient.malfunction && <HVal label="Malfunction" value={patient.malfunction} />}
          </div>

          {/* Doctor block — part of the SAME drawer (no nested drawer) */}
          <div className="border-t pt-5">
            {editButton && <div className="flex justify-end -mt-2 mb-1">{editButton}</div>}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-4">
              <EditableHVal
                label="Doctor"
                value={patient.doctorName ?? ""}
                editing={editingDoctor}
                onChange={(v) => onDoctorEdit?.({ doctorName: v })}
              />
              <EditableHVal
                label="Phone"
                value={patient.doctorPhone ?? ""}
                editing={editingDoctor}
                onChange={(v) => onDoctorEdit?.({ doctorPhone: v })}
              />
              <EditableHVal
                label="NPI"
                value={patient.doctorNpi ?? ""}
                editing={editingDoctor}
                onChange={(v) => onDoctorEdit?.({ doctorNpi: v })}
              />
              <HVal label="Method" value={patient.clinicalsMethod ?? ""} />
              <EditableHVal
                label="Fax"
                value={patient.doctorFax ?? ""}
                editing={editingDoctor}
                onChange={(v) => onDoctorEdit?.({ doctorFax: v })}
              />
              <EditableHVal
                label="Email"
                value={patient.doctorEmail ?? ""}
                editing={editingDoctor}
                onChange={(v) => onDoctorEdit?.({ doctorEmail: v })}
              />
              <EditableHVal
                label="Clinic"
                value={patient.clinicName ?? ""}
                editing={editingDoctor}
                onChange={(v) => onDoctorEdit?.({ clinicName: v })}
              />
              {/* Doctor-level notes from the Doctor Database — a grid cell
                  like the other fields. Collapsed = notes preview; expanding
                  reveals the editor + Add button. */}
              {patient.doctorNpi && (
                <div className="min-w-0">
                  <DoctorNotesPanel
                    doctorNpi={patient.doctorNpi}
                    doctorName={patient.doctorName}
                    compact
                    flush
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Prototype-style header value (eyebrow label + value, no icon) ── */

function HVal({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold truncate" title={value || "—"}>
        {value || "—"}
      </p>
    </div>
  );
}

function EditableHVal({
  label,
  value,
  editing,
  onChange,
  className,
}: {
  label: string;
  value: string;
  editing: boolean;
  onChange?: (v: string) => void;
  className?: string;
}) {
  if (!editing) return <HVal label={label} value={value} className={className} />;
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-0.5">{label}</p>
      <Input
        className="h-8 text-[15px]"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={`Enter ${label.toLowerCase()}`}
      />
    </div>
  );
}
