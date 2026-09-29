/**
 * SendRequestHeaderCard — patient header for the Send Request redesign
 * (June 2026 mockups). White card, 4px teal top border, bold name,
 * three info groups, then per-method detail rows:
 *   - Parachute: gender / member id / devices / coverage paths / OOW /
 *     malfunction / patient address / doctor contact / clinic address
 *   - Fax & Email: devices / doctor contact / clinic / clinic address
 * Layout unchanged from the mockups — the Edit toggle reveals the
 * doctor edit grid below the rows, and a Doctor Notes cell (Doctor
 * Database, by NPI) sits at the bottom.
 *
 * ⚠️ Provider edits (2026-09-29). Two reps in one morning could not update a
 * provider: the editor sat behind "Show details" AND a small Edit toggle, and
 * what they typed only reached Monday when the stage advanced — never, on
 * Doctor Appointments — so a script regenerated in between still carried the
 * old provider (DocExport reads the board). "Edit provider" now sits beside
 * "Show details", and Save provider writes the touched fields right away.
 */
import { useRef, useState } from "react";
import { ChevronRight, Pencil } from "lucide-react";
import { toast } from "sonner";
import type { Patient } from "@/lib/masheke/workflow";
import { DoctorEditGrid, EditToggle, DaysInStagePill, PatientContact } from "@/components/masheke/mmKit";
import { saveDoctorEdits } from "@/lib/masheke/mondayApi";
import { isDoctorEditField, unsavableDoctorFields, type DoctorDraft } from "@/lib/masheke/doctorEdits";
import { faxEditToColumnValue } from "@/lib/shared/faxAddress";
import { DoctorNotesPanel } from "@/components/shared/DoctorNotesPanel";
import { MashekeProfileStatus } from "@/components/shared/PatientProfileStatus";
import { FaxStatusBadge } from "@/components/shared/FaxStatusBadge";

function formatPhone(raw?: string): string {
  if (!raw) return "—";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === "1") {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

const dash = (v?: string) => (v && v.trim() ? v : "—");

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

function Field({ label, value, span2 }: { label: string; value?: string; span2?: boolean }) {
  return (
    <div className={span2 ? "col-span-2" : undefined}>
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1 text-lg font-semibold break-words">{dash(value)}</div>
    </div>
  );
}

export function SendRequestHeaderCard({
  patient,
  onDoctorEdit,
  editHint = "Save provider writes these to Monday now — do it before regenerating a script, which reads the provider from Monday. Anything unsaved is written when you press Request Sent.",
  fullDetails = false,
  showClinicalsMethod = false,
}: {
  patient: Patient;
  onDoctorEdit?: (patch: Partial<Patient>) => void;
  /** Footnote under the doctor edit grid describing when edits persist.
   *  Confirm Receipt passes its own ("Save Attempt") wording. ⚠️ The page's
   *  Save button keeps edits in THIS browser only (`saveOverlay`); a hint
   *  that says it saves to Monday is how a correction gets lost. */
  editHint?: string;
  /** Always render the comprehensive detail rows (gender, member id, coverage
   *  paths, OOW, malfunction, patient address, clinic) regardless of method.
   *  Confirm Receipt uses this so its drawer matches Send Request's. */
  fullDetails?: boolean;
  /** Surface the doctor's Clinicals Method (Fax/Email/Parachute) as a detail
   *  field in the drawer. The Chase "Email & Parachute" role passes this so the
   *  rep can see which channel this doctor uses (Email vs Parachute). */
  showClinicalsMethod?: boolean;
}) {
  const method = patient.clinicalsMethod ?? "Fax";
  const isParachute = method === "Parachute";
  const showFull = isParachute || fullDetails;
  const isEmail = method === "Email";
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // What the rep changed and hasn't saved, KEYED by the patient it was typed
  // on. The pages don't key this card, so a bare draft would ride along to the
  // next patient and Save would write it onto them (§9).
  const [drafts, setDrafts] = useState<Record<string, DoctorDraft>>({});
  const draft = drafts[patient.id] ?? {};
  const dirty = Object.keys(draft).length > 0;
  const [savingId, setSavingId] = useState<string | null>(null);
  const saving = savingId === patient.id;
  // The patient on screen NOW — a save outlives a patient switch, and must not
  // touch the overlay of whoever is open when it lands.
  const current = useRef(patient);
  current.current = patient;

  const editProvider = (patch: Partial<Patient>) => {
    onDoctorEdit?.(patch);
    const touched: DoctorDraft = {};
    for (const [k, v] of Object.entries(patch)) {
      if (isDoctorEditField(k)) touched[k] = String(v ?? "");
    }
    setDrafts((d) => ({ ...d, [patient.id]: { ...d[patient.id], ...touched } }));
  };

  const saveProvider = async () => {
    const id = patient.id;
    const pending = draft;
    if (!Object.keys(pending).length) return;
    const bad = unsavableDoctorFields(pending);
    if (bad.length) {
      toast.error("Fix these before saving", { description: bad.join(" · ") });
      return;
    }
    setSavingId(id);
    try {
      await saveDoctorEdits(id, pending);
      // Drop only what was saved AS SAVED — a field typed into during the save
      // stays pending.
      setDrafts((d) => {
        const left: DoctorDraft = { ...d[id] };
        for (const [k, v] of Object.entries(pending)) {
          if (isDoctorEditField(k) && left[k] === v) delete left[k];
        }
        return { ...d, [id]: left };
      });
      // Show the fax the way the board now holds it (<digits>@rcfax.com), but
      // only on the same patient and only if the box hasn't changed since.
      if (
        pending.doctorFax !== undefined &&
        current.current.id === id &&
        current.current.doctorFax === pending.doctorFax
      ) {
        const stored = faxEditToColumnValue(pending.doctorFax);
        if (stored !== pending.doctorFax) onDoctorEdit?.({ doctorFax: stored });
      }
      toast.success("Provider details saved to Monday");
    } catch (e) {
      toast.error("Couldn't save provider details", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSavingId((s) => (s === id ? null : s));
    }
  };

  return (
    <section
      className="rounded-2xl bg-card border p-6 shadow-sm border-t-4"
      style={{ borderColor: "var(--mm-card-border)", borderTopColor: "var(--mm-teal)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Patient</p>
        <div className="flex items-center gap-4">
          {/* The provider editor used to be two clicks deep (Show details, then
              a small Edit toggle) and reps could not find it. This opens both. */}
          {onDoctorEdit && !(expanded && editing) && (
            <button
              type="button"
              onClick={() => {
                setExpanded(true);
                setEditing(true);
              }}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--mm-teal)] hover:underline"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit provider
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`} />
            {expanded ? "Hide details" : "Show details"}
          </button>
        </div>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <h1 className="text-3xl font-black tracking-tight">{patient.name}</h1>
          <MashekeProfileStatus patient={patient} />
          {/* Silent unless the last fax to this doctor actually failed — see
              FaxStatusBadge. Sits beside the status chip so "is this patient
              workable" and "did our fax land" read in one glance. */}
          <FaxStatusBadge doctorFax={patient.doctorFax} />
        </div>
        <DaysInStagePill value={patient.daysSinceStageStart} />
      </div>
      <div className="mt-2 flex items-center gap-3 flex-wrap">
        <span className="text-lg text-muted-foreground">DOB {dash(patient.dob)}</span>
        <PatientContact phone={patient.phone} patientName={patient.name} mondayItemId={patient.id} />
      </div>

      {/* three info groups — always visible (outside the drawer) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
        <div className="border rounded-xl bg-muted/30 p-4" style={{ borderColor: "var(--mm-card-border)" }}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Eyebrow>Request</Eyebrow>
              <div className="mt-1 text-lg font-semibold">{dash(patient.requestType)}</div>
            </div>
            <div>
              <Eyebrow>Serving</Eyebrow>
              <div className="mt-1 text-lg font-semibold">{dash(patient.serving)}</div>
            </div>
          </div>
        </div>
        <div className="border rounded-xl bg-muted/30 p-4" style={{ borderColor: "var(--mm-card-border)" }}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Eyebrow>Referral Type</Eyebrow>
              <div className="mt-1 text-lg font-semibold">{dash(patient.referralType)}</div>
            </div>
            <div>
              <Eyebrow>Referral Source</Eyebrow>
              <div className="mt-1 text-lg font-semibold">{dash(patient.referralSource)}</div>
            </div>
          </div>
        </div>
        <div className="border rounded-xl bg-muted/30 p-4" style={{ borderColor: "var(--mm-card-border)" }}>
          <Eyebrow>Primary Insurance</Eyebrow>
          <div className="mt-1 text-lg font-semibold">{dash(patient.primaryInsurance)}</div>
        </div>
      </div>

      {expanded && (
        <>
          {onDoctorEdit && (
            <div className="flex justify-end mt-4">
              <EditToggle editing={editing} onToggle={() => setEditing((e) => !e)} />
            </div>
          )}

      {/* Clinicals Method — the doctor's send channel (Email vs Parachute),
          surfaced for the Chase "Email & Parachute" role. Own row so it reads as
          an explicit callout and keeps the doctor-contact group contiguous. */}
      {showClinicalsMethod && (
        <div className="mt-5 border-t pt-5 grid grid-cols-2 lg:grid-cols-4 gap-5" style={{ borderColor: "var(--mm-card-border)" }}>
          <Field label="Clinicals Method" value={patient.clinicalsMethod} />
        </div>
      )}

      {/* per-method detail rows */}
      {showFull ? (
        <>
          <div className="mt-5 border-t pt-5 grid grid-cols-2 lg:grid-cols-4 gap-5" style={{ borderColor: "var(--mm-card-border)" }}>
            <Field label="Gender" value={patient.gender} />
            <Field label="Member ID" value={patient.memberId1} />
            <Field label="CGM" value={patient.cgmType} />
            <Field label="Pump" value={patient.pumpType} />
          </div>
          <div className="mt-5 border-t pt-5 grid grid-cols-2 lg:grid-cols-4 gap-5" style={{ borderColor: "var(--mm-card-border)" }}>
            <Field label="CGM Coverage Path" value={patient.cgmCoveragePath} />
            <Field label="Insulin Pump Coverage Path" value={patient.ipCoveragePath} />
            <Field label="OOW Date" value={patient.oowDate} />
            <Field label="Malfunction Reason" value={patient.malfunction} />
          </div>
          <div className="mt-5 border-t pt-5 grid grid-cols-2 lg:grid-cols-4 gap-5" style={{ borderColor: "var(--mm-card-border)" }}>
            <Field label="Patient Address" value={patient.address} />
            <Field label="Doctor Phone" value={formatPhone(patient.doctorPhone)} />
            <Field label="Doctor Fax" value={patient.doctorFax} />
            <Field label="Clinic Address" value={patient.clinicAddress} />
          </div>
        </>
      ) : (
        <>
          <div className="mt-5 border-t pt-5 grid grid-cols-2 lg:grid-cols-4 gap-5" style={{ borderColor: "var(--mm-card-border)" }}>
            <Field label="CGM" value={patient.cgmType} />
            <Field label="Pump" value={patient.pumpType} />
            <Field label="Doctor Phone" value={formatPhone(patient.doctorPhone)} />
            {isEmail ? (
              <Field label="Doctor Email" value={patient.doctorEmail} />
            ) : (
              <Field label="Doctor Fax" value={patient.doctorFax} />
            )}
          </div>
          <div className="mt-5 border-t pt-5 grid grid-cols-2 lg:grid-cols-4 gap-5" style={{ borderColor: "var(--mm-card-border)" }}>
            <Field label="Clinic" value={patient.clinicName} span2 />
            <Field label="Clinic Address" value={patient.clinicAddress} span2 />
          </div>
        </>
      )}

      {/* the one addition — doctor notes from the Doctor Database */}
      {patient.doctorNpi && (
        <div className="mt-5 border-t pt-5 grid grid-cols-2 lg:grid-cols-4 gap-5" style={{ borderColor: "var(--mm-card-border)" }}>
          <div className="min-w-0 col-span-2">
            <DoctorNotesPanel
              doctorNpi={patient.doctorNpi}
              doctorName={patient.doctorName}
              compact
              flush
            />
          </div>
        </div>
      )}

      {/* edit grid — revealed by the Edit toggle, display rows untouched */}
      {onDoctorEdit && editing && (
        <DoctorEditGrid
          patient={patient}
          onDoctorEdit={editProvider}
          editHint={editHint}
          onSave={() => void saveProvider()}
          saving={saving}
          dirty={dirty}
        />
      )}
        </>
      )}
    </section>
  );
}
