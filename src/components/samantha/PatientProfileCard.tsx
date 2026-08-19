import { useState } from "react";
import type { Patient } from "@/lib/samantha/workflow";
import { PRIMARY_INSURANCE_OPTIONS, SECONDARY_INSURANCE_OPTIONS_SAMANTHA } from "@/lib/samantha/hcpcRules";
import type { PrimaryInsurance } from "@/lib/samantha/hcpcRules";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CalendarDays,
  IdCard,
  User,
  Stethoscope,
  ShieldCheck,
  Activity,
  UserRound,
  ChevronDown,
  ChevronRight,
  Phone,
  Mail,
  Hash,
  Building2,
  Send,
  MapPin,
  Cpu,
  Pencil,
  X,
  Save,
  Loader2,
} from "lucide-react";
import { DoctorNotesPanel } from "@/components/shared/DoctorNotesPanel";
import { InsuranceProfileStatus } from "@/components/shared/PatientProfileStatus";

interface Props {
  patient: Patient;
  /** Stage an edit. Callers hold the draft — see DvsPage. */
  onUpdate?: (patch: Partial<Patient>) => void;
  /**
   * Commit the staged edits. Present ⇒ the header shows Save while editing.
   *
   * The card's inputs fire `onUpdate` on every keystroke, so a caller that
   * writes straight to Monday (rather than into a page overlay flushed by a
   * Send button) MUST take this and batch — otherwise typing a doctor's name
   * is a dozen board writes.
   */
  onSave?: () => Promise<void>;
  /** Whether anything is staged — Save is inert without it. */
  dirty?: boolean;
  /**
   * What the pencil opens. `"doctor"` leaves identity and insurance read-only.
   *
   * DVS uses that: the doctor details on an automated stage are exactly what a
   * rep is there to fix (a dead fax, a missing NPI), while Primary Insurance
   * and the Member IDs are the inputs the whole rail is derived from, and §7
   * keeps them read-only everywhere in Insurance for a reason — changing the
   * payer means re-running eligibility, which this board can't do. Corrections
   * to those go back through Profile Send-Off.
   */
  editScope?: "all" | "doctor";
}

/* ── Read-only field ─────────────────────────────────────────────── */

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

/* ── Editable field ──────────────────────────────────────────────── */

/** Live Clinicals Method labels (§5.9). Blank clears the column. */
const CLINICALS_METHODS = ["Fax", "Parachute", "Email"];

function EditableChoice({
  icon,
  label,
  value,
  options,
  onChange,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={`flex items-start gap-2 min-w-0 ${className ?? ""}`}>
      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0 mt-1">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </p>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-0.5 h-7 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">—</option>
          {/* A value the board has but this list doesn't still shows, so an
              unrelated edit can't silently blank it. */}
          {(options.includes(value) || !value ? options : [value, ...options]).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function EditableField({
  icon,
  label,
  value,
  onChange,
  className,
  placeholder,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <div className={`flex items-start gap-2 min-w-0 ${className ?? ""}`}>
      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0 mt-1">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </p>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? label}
          className="h-7 text-sm mt-0.5"
        />
      </div>
    </div>
  );
}

/* ── Phone formatter ─────────────────────────────────────────────── */

function formatPhone(raw: string): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw; // fallback — return as-is
}

/* ── Main component ──────────────────────────────────────────────── */

export function PatientProfileCard({ patient, onUpdate, onSave, dirty, editScope = "all" }: Props) {
  const hasMember2 = !!patient.memberId2 && patient.memberId2.trim().length > 0;
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const canEdit = !!onUpdate;
  const hasPumpOrSupplies = !!(
    patient.serving &&
    (patient.serving.includes("Pump") || patient.serving.includes("Supplies"))
  );

  const toggleEdit = () => {
    if (editing) {
      // closing edit mode — force doctor section open stays as-is
    }
    setEditing((e) => !e);
    // When entering edit mode, expand doctor info so all fields are visible
    if (!editing) setDoctorOpen(true);
  };

  const patch = (p: Partial<Patient>) => onUpdate?.(p);
  /** Identity + insurance rows: only when the caller allows that scope. */
  const editingProfile = editing && editScope === "all";

  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (!onSave || saving) return;
    setSaving(true);
    try {
      await onSave();
      setEditing(false);
    } catch {
      // The caller surfaced the reason (a toast). Stay in edit mode with the
      // draft intact so the rep can fix the field rather than retype it.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl bg-card border shadow-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Patient Profile
          </p>
          <InsuranceProfileStatus patient={patient} size="sm" />
        </div>
        <div className="flex items-center gap-2">
        {canEdit && editing && onSave && (
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="h-7 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? "Saving…" : "Save"}
          </Button>
        )}
        {canEdit && (
          <button
            onClick={toggleEdit}
            className={`p-1.5 rounded-md transition-colors ${
              editing
                ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            title={editing ? "Stop editing" : editScope === "doctor" ? "Edit doctor details" : "Edit profile"}
          >
            {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          </button>
        )}
        </div>
      </div>

      {/* Row 1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {editingProfile ? (
          <EditableField
            icon={<User className="h-4 w-4" />}
            label="Name"
            value={patient.name}
            onChange={(v) => patch({ name: v })}
          />
        ) : (
          <Field icon={<User className="h-4 w-4" />} label="Name" value={patient.name} />
        )}

        {editingProfile ? (
          <EditableField
            icon={<CalendarDays className="h-4 w-4" />}
            label="Date of Birth"
            value={patient.dob}
            onChange={(v) => patch({ dob: v })}
          />
        ) : (
          <Field icon={<CalendarDays className="h-4 w-4" />} label="Date of Birth" value={patient.dob} />
        )}

        {/* Serving — always read-only */}
        <Field
          icon={<Stethoscope className="h-4 w-4" />}
          label="Serving"
          value={patient.serving ?? ""}
        />
      </div>

      {/* Row 1b — Patient Phone, Address, Pump Brand */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {editingProfile ? (
          <EditableField
            icon={<Phone className="h-4 w-4" />}
            label="Patient Phone"
            value={patient.patientPhone ?? ""}
            onChange={(v) => patch({ patientPhone: v })}
            placeholder="(xxx) xxx-xxxx"
          />
        ) : (
          <Field
            icon={<Phone className="h-4 w-4" />}
            label="Patient Phone"
            value={formatPhone(patient.patientPhone ?? "")}
          />
        )}
        {editingProfile ? (
          <EditableField
            icon={<MapPin className="h-4 w-4" />}
            label="Patient Address"
            value={patient.patientAddress ?? ""}
            onChange={(v) => patch({ patientAddress: v })}
            className="sm:col-span-2"
          />
        ) : (
          <Field
            icon={<MapPin className="h-4 w-4" />}
            label="Patient Address"
            value={patient.patientAddress ?? ""}
            className="sm:col-span-2"
          />
        )}
      </div>

      {/* Row 1c — Pump Type (visible when serving includes Pump or Supplies) */}
      {hasPumpOrSupplies && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field
            icon={<Cpu className="h-4 w-4" />}
            label="Pump Type"
            value={patient.pumpBrand ?? ""}
          />
        </div>
      )}

      {/* Divider */}
      <div className="h-px bg-border" />

      {/* Row 2 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Primary Insurance — editable via pencil toggle */}
        {editingProfile ? (
          <div className="flex items-start gap-2 min-w-0">
            <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0 mt-1">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Primary Insurance
              </p>
              <Select
                value={patient.primaryInsurance ?? ""}
                onValueChange={(v) => patch({ primaryInsurance: v as PrimaryInsurance })}
              >
                <SelectTrigger className="h-7 text-sm mt-0.5">
                  <SelectValue placeholder="Select insurance" />
                </SelectTrigger>
                <SelectContent>
                  {PRIMARY_INSURANCE_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <Field icon={<ShieldCheck className="h-4 w-4" />} label="Primary Insurance" value={patient.primaryInsurance ?? ""} />
        )}

        {editingProfile ? (
          <EditableField
            icon={<IdCard className="h-4 w-4" />}
            label="Member ID"
            value={patient.memberId1 ?? ""}
            onChange={(v) => patch({ memberId1: v })}
          />
        ) : (
          <Field icon={<IdCard className="h-4 w-4" />} label="Member ID" value={patient.memberId1 ?? ""} />
        )}

        {editingProfile ? (
          <EditableField
            icon={<Activity className="h-4 w-4" />}
            label="Diagnosis"
            value={patient.diagnosis ?? ""}
            onChange={(v) => patch({ diagnosis: v })}
          />
        ) : (
          <Field icon={<Activity className="h-4 w-4" />} label="Diagnosis" value={patient.diagnosis ?? ""} />
        )}

        {/* Secondary Insurance — read-only by default, editable via the pencil */}
        {editingProfile ? (
          <div className="flex items-start gap-2 min-w-0">
            <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0 mt-1">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Secondary Insurance
              </p>
              <Select
                value={patient.secondaryInsurance ?? ""}
                onValueChange={(v) => patch({ secondaryInsurance: v })}
              >
                <SelectTrigger className="h-7 text-sm mt-0.5">
                  <SelectValue placeholder="Select insurance" />
                </SelectTrigger>
                <SelectContent>
                  {SECONDARY_INSURANCE_OPTIONS_SAMANTHA.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <Field icon={<ShieldCheck className="h-4 w-4" />} label="Secondary Insurance" value={patient.secondaryInsurance ?? ""} />
        )}

        {/* Member ID 2 — read-only by default, editable via the pencil */}
        {editingProfile ? (
          <EditableField
            icon={<IdCard className="h-4 w-4" />}
            label="Member ID 2"
            value={patient.memberId2 ?? ""}
            onChange={(v) => patch({ memberId2: v })}
          />
        ) : (
          <Field icon={<IdCard className="h-4 w-4" />} label="Member ID 2" value={patient.memberId2 ?? ""} />
        )}

        <Field
          icon={<Stethoscope className="h-4 w-4" />}
          label="Referral Source"
          value={patient.referralSource ?? ""}
        />

        {patient.referralSource === "CareCentrix" && (() => {
          const isEmpty = !patient.carecentrixIntakeId;
          return (
            <div className={`flex items-start gap-2 min-w-0 rounded-lg p-1.5 -m-1.5 transition-colors ${isEmpty ? "bg-red-50 dark:bg-red-950/20 ring-1 ring-red-200 dark:ring-red-800/40" : ""}`}>
              <div className={`h-8 w-8 rounded-md flex items-center justify-center shrink-0 mt-1 ${isEmpty ? "bg-red-100 dark:bg-red-900/30 text-red-500" : "bg-muted text-muted-foreground"}`}>
                <IdCard className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Carecentrix Intake I.D.
                </p>
                <Input
                  value={patient.carecentrixIntakeId ?? ""}
                  onChange={(e) => patch({ carecentrixIntakeId: e.target.value })}
                  placeholder="Enter Carecentrix Intake I.D."
                  className={`h-7 text-sm mt-0.5 ${isEmpty ? "border-red-300 dark:border-red-700" : ""}`}
                />
              </div>
            </div>
          );
        })()}
      </div>

      {/* Doctor info — collapsible */}
      <div className="border-t pt-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setDoctorOpen((o) => !o)}
            className="flex-1 flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors gap-3"
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
                  <span className="truncate">{patient.doctorName || "—"}</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <Send className="h-3 w-3 shrink-0" />
                  <span>{patient.clinicalsMethod || "—"}</span>
                </span>
              </span>
            )}
          </button>
        </div>

        {doctorOpen && !editing && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Field icon={<UserRound className="h-4 w-4" />} label="Doctor Name" value={patient.doctorName ?? ""} />
            <Field icon={<Send className="h-4 w-4" />} label="Clinicals Method" value={patient.clinicalsMethod ?? ""} />
            <Field icon={<Hash className="h-4 w-4" />} label="NPI" value={patient.doctorNpi ?? ""} />
            <Field icon={<Phone className="h-4 w-4" />} label="Phone" value={patient.doctorPhone ?? ""} />
            <Field icon={<Mail className="h-4 w-4" />} label="Fax" value={patient.doctorFax ?? ""} />
            <Field icon={<Mail className="h-4 w-4" />} label="Email" value={patient.doctorEmail ?? ""} />
            <Field
              icon={<Building2 className="h-4 w-4" />}
              label="Clinic"
              value={patient.clinicName ?? ""}
              className="sm:col-span-2"
            />
            <Field
              icon={<MapPin className="h-4 w-4" />}
              label="Clinic Address"
              value={patient.clinicAddress ?? ""}
              className="sm:col-span-2"
            />
          </div>
        )}

        {doctorOpen && editing && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <EditableField
              icon={<UserRound className="h-4 w-4" />}
              label="Doctor Name"
              value={patient.doctorName ?? ""}
              onChange={(v) => patch({ doctorName: v })}
            />
            {/* A status column, so it picks from the board's labels rather
                than taking free text: a typo'd label doesn't fail, it creates
                a duplicate on the board (§9) — and Clinicals Method is the
                column that splits the two Chase roles (§5.9). */}
            <EditableChoice
              icon={<Send className="h-4 w-4" />}
              label="Clinicals Method"
              value={patient.clinicalsMethod ?? ""}
              options={CLINICALS_METHODS}
              onChange={(v) => patch({ clinicalsMethod: v })}
            />
            <EditableField
              icon={<Hash className="h-4 w-4" />}
              label="NPI"
              value={patient.doctorNpi ?? ""}
              onChange={(v) => patch({ doctorNpi: v })}
            />
            <EditableField
              icon={<Phone className="h-4 w-4" />}
              label="Phone"
              value={patient.doctorPhone ?? ""}
              onChange={(v) => patch({ doctorPhone: v })}
            />
            <EditableField
              icon={<Mail className="h-4 w-4" />}
              label="Fax"
              value={patient.doctorFax ?? ""}
              onChange={(v) => patch({ doctorFax: v })}
            />
            <EditableField
              icon={<Mail className="h-4 w-4" />}
              label="Email"
              value={patient.doctorEmail ?? ""}
              onChange={(v) => patch({ doctorEmail: v })}
            />
            <EditableField
              icon={<Building2 className="h-4 w-4" />}
              label="Clinic"
              value={patient.clinicName ?? ""}
              onChange={(v) => patch({ clinicName: v })}
              className="sm:col-span-2"
            />
            <EditableField
              icon={<MapPin className="h-4 w-4" />}
              label="Clinic Address"
              value={patient.clinicAddress ?? ""}
              onChange={(v) => patch({ clinicAddress: v })}
              className="sm:col-span-2"
            />
          </div>
        )}

        {/* Doctor-level notes from the Doctor Database */}
        {doctorOpen && patient.doctorNpi && (
          <div className="mt-3">
            <DoctorNotesPanel doctorNpi={patient.doctorNpi} doctorName={patient.doctorName} compact />
          </div>
        )}
      </div>

    </div>
  );
}
