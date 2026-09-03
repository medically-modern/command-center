/**
 * BenefitsPatientHeader — READ-ONLY patient header for the redesigned
 * Benefits tab, using the prototype's exact markup/classes (spec §6,
 * decisions D5/S5; benefits-redesign.html `renderHeader()` is the visual
 * spec — styles live in benefitsRedesign.css, scoped under .bnr).
 *
 * Read-only for EVERYONE: Serving, Primary/Secondary Insurance, Member IDs and
 * everything else are finalized at Profile Send-Off. The prototype's DEMO
 * dropdowns are deliberately absent (production strips them, spec §6). Every
 * value is user-select-all for one-click copy.
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
 * Stedi strip: Home Plan / Coverage Type / Medicaid ID / Active? have no
 * Insurance-board columns yet — the strip shows what the board carries
 * (Plan Name, Plan Begin, QMB for Medicare payers, Coinsurance %,
 * Deductible / OOP Max remaining).
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
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

interface Props {
  patient: Patient;
}

export function BenefitsPatientHeader({ patient }: Props) {
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
          <span style={{ userSelect: "all" }}>{formatPhone(patient.patientPhone ?? "") || "—"}</span>
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
