/**
 * BenefitsPatientHeader — patient header for the redesigned Benefits tab,
 * using the prototype's exact markup/classes (spec §6, decisions D5/S5;
 * benefits-redesign.html `renderHeader()` is the visual spec — styles live in
 * benefitsRedesign.css, scoped under .bnr).
 *
 * Read-only for EVERYONE with ONE opt-in exception, the patient's PHONE:
 * Serving, Primary/Secondary Insurance, Member IDs and everything else are
 * finalized at Profile Send-Off. The prototype's DEMO dropdowns are
 * deliberately absent (production strips them, spec §6). Every value is
 * user-select-all for one-click copy.
 *
 * A manager-only "Edit profile" dialog lived here from 2026-07-30 until
 * 2026-08-02, letting the oversight escalation views correct Serving /
 * Primary+Secondary Insurance / Member IDs in place. It was removed (Josh):
 * changing those five facts is only half the job — the payer change also has to
 * be re-verified through Stedi, which the Insurance board has no way to run
 * (no trigger column, none of the eligibility input columns, and the Railway
 * service is bound to the Profile Send-Off board). Corrections go back through
 * Profile Send-Off rather than being made blind here.
 *
 * ⚠️ `onSavePhone` is NOT a way back to that dialog, and must not grow into
 * one. A phone number has no Stedi half: nothing derives from it, no
 * eligibility answer depends on it, and a wrong one is the single reason a rep
 * on this page cannot do their job — they are looking at the header precisely
 * because they are trying to ring the patient. The five identity/insurance
 * facts still go back through Profile Send-Off.
 *
 * ⚠️ It is OPT-IN per page (`onSavePhone` absent ⇒ exactly the old read-only
 * markup). Auth Outstanding passes it (Josh, 2026-09-10); Benefits and Submit
 * Auth share this component and deliberately do not, so widening it is a
 * decision somebody makes, not something a shared header does on its own.
 *
 * Stedi strip: Home Plan / Coverage Type / Medicaid ID / Active? have no
 * Insurance-board columns yet — the strip shows what the board carries
 * (Plan Name, Plan Begin, QMB for Medicare payers, Coinsurance %,
 * Deductible / OOP Max remaining).
 */
import { useState } from "react";
import { Check, ChevronDown, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { phoneRejectionReason } from "@/lib/shared/phoneCell";
import { DoctorNotesPanel } from "@/components/shared/DoctorNotesPanel";
import type { Patient } from "@/lib/samantha/workflow";
import { authHomePlan } from "@/lib/samantha/submitAuthRules";
import { CallHistoryButton } from "@/components/shared/CallHistoryButton";
import "./benefitsRedesign.css";
import { InsuranceProfileStatus } from "@/components/shared/PatientProfileStatus";

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

function HVal({ label, value, span }: { label: string; value: string; span?: number }) {
  return (
    <div style={span ? { gridColumn: `span ${span}` } : undefined}>
      <div className="eyebrow">{label}</div>
      <div className="hval">{value || "—"}</div>
    </div>
  );
}

function SBox({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="sbox">
      <div className="eyebrow-xs">{label}</div>
      <div className={`sval${strong ? " strong" : ""}`}>{value || "—"}</div>
    </div>
  );
}

/**
 * The patient's phone — read-only text, or an inline editor when the page
 * passed `onSavePhone`.
 *
 * ⚠️ The rejection check runs BEFORE the save is attempted, never after.
 * Every `writePhone` in the app routes through `planPhoneWrite`, which SKIPS a
 * value it cannot parse rather than throwing — so a 9-digit number, or one
 * with an extension, would save GREEN having written nothing. That is §10's
 * optimistic-UI trap, and it is the same reason `DvsPage` checks its doctor
 * draft with `unwritableDoctorFields` before its first write. The guard lives
 * HERE rather than in the page so that any page which opts in gets it, instead
 * of each one having to remember.
 *
 * ⚠️ A failed save keeps the editor open with the rep's text intact. Closing it
 * would discard the number they just read off a call.
 *
 * ⚠️ The caller keys this on the patient id. A draft that outlives a sidebar
 * click is the §9 notes-box bug with a PHONE NUMBER in it — one Save from
 * writing the previous patient's number onto the open one.
 */
function PatientPhoneLine({
  phone,
  onSavePhone,
}: {
  phone: string;
  onSavePhone?: (phone: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(phone);
  const [saving, setSaving] = useState(false);

  const display = formatPhone(phone) || "—";

  if (!onSavePhone) {
    return <span style={{ userSelect: "all" }}>{display}</span>;
  }

  const save = async () => {
    if (saving) return;
    const rejection = phoneRejectionReason(draft);
    if (rejection) {
      toast.error("That phone number can't be saved", { description: rejection });
      return; // stays open, draft intact — nothing was written
    }
    const next = draft.trim();
    setSaving(true);
    try {
      await onSavePhone(next);
      setEditing(false);
      toast.success(next ? "Phone number updated" : "Phone number cleared");
    } catch (e) {
      toast.error("Couldn't save the phone number", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <>
        <span style={{ userSelect: "all" }}>{display}</span>{" "}
        <button
          type="button"
          className="ph-phone-edit"
          aria-label="Edit phone number"
          title="Correct the patient's phone number"
          onClick={() => {
            setDraft(phone);
            setEditing(true);
          }}
        >
          <Pencil size={13} /> Edit
        </button>
      </>
    );
  }

  return (
    <span className="ph-phone-row">
      <input
        type="text"
        value={draft}
        autoFocus
        disabled={saving}
        placeholder="(555) 555-0100"
        aria-label="Patient phone number"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <button type="button" className="tbtn" disabled={saving} onClick={() => void save()}>
        {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save
      </button>
      <button type="button" className="tbtn" disabled={saving} onClick={() => setEditing(false)}>
        <X size={13} /> Cancel
      </button>
    </span>
  );
}

interface Props {
  patient: Patient;
  /**
   * Opt in to editing the patient's phone number. Absent ⇒ the header is
   * read-only exactly as it has always been. See the ⚠️ notes at the top of
   * this file before passing it from a new page.
   */
  onSavePhone?: (phone: string) => Promise<void>;
}

export function BenefitsPatientHeader({ patient, onSavePhone }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const isMedicarePayer = /medicare/i.test(patient.primaryInsurance ?? "");
  const hasPump = !!(patient.serving && /Pump|Supplies/.test(patient.serving));
  // Stedi Home Plan (dropdown_mm5ex8wx): shown whenever present; tagged
  // "HANDLES AUTHS" when a BCBS-family member's home plan differs from the
  // host plan we bill (Submit Auth redesign §8).
  const homePlanDiffers = authHomePlan(patient);

  return (
    <section className="card header-card">
      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="ph-name">{patient.name || "—"}</div>
          <InsuranceProfileStatus patient={patient} />
        </div>
        <div className="ph-dob">
          DOB <span style={{ userSelect: "all" }}>{patient.dob || "—"}</span> ·{" "}
          <PatientPhoneLine
            key={patient.id}
            phone={patient.patientPhone ?? ""}
            onSavePhone={onSavePhone}
          />
        </div>
        <div className="mt-1.5">
          <CallHistoryButton
            phone={patient.patientPhone ?? ""}
            display={formatPhone(patient.patientPhone ?? "")}
          />
        </div>
      </div>

      <div className="ph-groups">
        <div className="hgroup">
          <div className="pair">
            <HVal label="Serving" value={patient.serving || ""} />
            <HVal label="Diagnosis" value={patient.diagnosis || ""} />
          </div>
        </div>
        <div className="hgroup">
          <div className="pair">
            <HVal label="Primary Insurance" value={patient.primaryInsurance || ""} />
            <HVal label="Secondary Insurance" value={patient.secondaryInsurance || ""} />
          </div>
        </div>
        <div className="hgroup">
          <div className="pair">
            <HVal label="Member ID" value={patient.memberId1 || ""} />
            <HVal label="Member ID 2" value={patient.memberId2 || ""} />
          </div>
        </div>
      </div>

      {/* Stedi output (read-only, from the Profile Send-Off check) */}
      <div className="stedi-block">
        <div className="stedi-head">
          <span className="eyebrow-xs" style={{ fontWeight: 700 }}>
            Insurance Details · Stedi Check
          </span>
        </div>
        <div className={`stedi-grid ${patient.homePlan ? "four" : "three"}`}>
          <SBox label="Payer Name" value={patient.primaryInsurance || ""} strong />
          <SBox label="Plan Name" value={patient.planName ?? ""} />
          {patient.homePlan && (
            <div className={`sbox${homePlanDiffers ? " auth-plan" : ""}`}>
              <div className="eyebrow-xs">
                Home Plan
                {homePlanDiffers && <span className="auth-tag">HANDLES AUTHS</span>}
              </div>
              <div className="sval strong">{patient.homePlan}</div>
            </div>
          )}
          <SBox label="Plan Begin Date" value={patient.stediPlanBegin ?? ""} />
        </div>
        <div className={`stedi-grid ${isMedicarePayer ? "four" : "three"}`}>
          {isMedicarePayer && <SBox label="QMB?" value={patient.stediQmb ?? ""} strong />}
          <SBox label="Co-Insurance" value={patient.stediCoinsurance ?? ""} />
          <SBox label="Deductible Remaining" value={patient.deductibleRemaining ?? ""} />
          <SBox label="OOP Max Remaining" value={patient.oopMaxRemaining ?? ""} />
        </div>
      </div>

      <button
        type="button"
        className={`ph-toggle ${detailsOpen ? "open" : ""}`}
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen((v) => !v)}
      >
        <ChevronDown size={20} />
        <span>{detailsOpen ? "Hide details" : "Show address, devices & doctor info"}</span>
      </button>

      {detailsOpen && (
        <>
          <div className="ph-details">
            <HVal label="Patient Address" value={patient.patientAddress || ""} span={hasPump ? 2 : 3} />
            <HVal label="Referral Source" value={patient.referralSource || ""} />
            {hasPump && <HVal label="Pump Type" value={patient.pumpBrand || ""} />}
          </div>
          <div className="ph-details" style={{ borderTop: "1px dashed var(--bnr-border)" }}>
            <div style={{ gridColumn: "1 / -1", marginBottom: -8 }}>
              <span className="eyebrow" style={{ color: "var(--mm-teal)", fontWeight: 700 }}>
                Doctor Info
              </span>
            </div>
            <HVal label="Doctor" value={patient.doctorName || ""} />
            <HVal label="Phone" value={formatPhone(patient.doctorPhone ?? "")} />
            <HVal label="NPI" value={patient.doctorNpi || ""} />
            <HVal label="Fax" value={patient.doctorFax || ""} />
            <HVal label="Email" value={patient.doctorEmail || ""} />
            <HVal label="Clinicals Method" value={patient.clinicalsMethod || ""} />
            <HVal label="Clinic" value={patient.clinicName || ""} span={2} />
            {/* Clinic Address (Josh, 2026-09-03) — every Insurance stage calls
                or faxes the office, and the address was the one doctor field
                this header omitted. Already read (COL.clinicAddress is in the
                read set and on the Patient) and already shown on the DVS card,
                so this is display only: no new column, no new fetch. */}
            <HVal label="Clinic Address" value={patient.clinicAddress || ""} span={2} />
            {/* Doctor Notes (Josh, 2026-08-03) — the shared MM Doctor Database
                log that Evaluate has had all along. The Insurance stages call
                the same offices about the same auths, so the "this office wants
                a peer-to-peer" note has to be readable and writable here too.
                This header is read-only about the PATIENT; the doctor log is a
                different record (its own board), so it stays editable.
                One placement covers Benefits, Submit Auth and Auth Outstanding —
                all three render this header. DVS already has it via
                samantha/PatientProfileCard. */}
            <div style={{ gridColumn: "1 / -1" }}>
              <DoctorNotesPanel
                doctorNpi={patient.doctorNpi ?? ""}
                doctorName={patient.doctorName}
                compact
                flush
              />
            </div>
          </div>
        </>
      )}

    </section>
  );
}
