/**
 * BenefitsPatientHeader — READ-ONLY patient header for the redesigned
 * Benefits tab, using the prototype's exact markup/classes (spec §6,
 * decisions D5/S5; benefits-redesign.html `renderHeader()` is the visual
 * spec — styles live in benefitsRedesign.css, scoped under .bnr).
 *
 * No edit mode, no edit toggle: Serving, Primary/Secondary Insurance,
 * Member IDs and everything else are finalized at Profile Send-Off.
 * The prototype's DEMO dropdowns are deliberately absent (production
 * strips them, spec §6). Every value is user-select-all for one-click copy.
 *
 * Stedi strip: Home Plan / Coverage Type / Medicaid ID / Active? have no
 * Insurance-board columns yet — the strip shows what the board carries
 * (Plan Name, Plan Begin, QMB for Medicare payers, Coinsurance %,
 * Deductible / OOP Max remaining).
 */
import { useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import type { Patient } from "@/lib/samantha/workflow";
import { authHomePlan } from "@/lib/samantha/submitAuthRules";
import "./benefitsRedesign.css";

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
  const [notesOpen, setNotesOpen] = useState(false);
  const [mnNotesOpen, setMnNotesOpen] = useState(false);

  const isMedicarePayer = /medicare/i.test(patient.primaryInsurance ?? "");
  const hasPump = !!(patient.serving && /Pump|Supplies/.test(patient.serving));
  // Stedi Home Plan (dropdown_mm5ex8wx): shown whenever present; tagged
  // "HANDLES AUTHS" when a BCBS-family member's home plan differs from the
  // host plan we bill (Submit Auth redesign §8).
  const homePlanDiffers = authHomePlan(patient);

  return (
    <section className="card header-card">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="ph-name">{patient.name || "—"}</div>
          <div className="ph-dob">
            DOB <span style={{ userSelect: "all" }}>{patient.dob || "—"}</span> ·{" "}
            <span style={{ userSelect: "all" }}>{formatPhone(patient.patientPhone ?? "") || "—"}</span>
          </div>
        </div>
        <span className="step-chip">Read-only · fed by Profile Send-Off</span>
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
          </div>
        </>
      )}

      {/* Upstream notes (read-only viewers) */}
      {(patient.profileSendOffNotes || patient.mnWorkflowNotes) && (
        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {patient.profileSendOffNotes && (
            <button className="tbtn" onClick={() => setNotesOpen((v) => !v)}>
              <FileText size={14} /> Profile Intake Notes
            </button>
          )}
          {patient.mnWorkflowNotes && (
            <button className="tbtn" onClick={() => setMnNotesOpen((v) => !v)}>
              <FileText size={14} /> MN Workflow Notes
            </button>
          )}
        </div>
      )}
      {notesOpen && patient.profileSendOffNotes && (
        <pre
          style={{ marginTop: 10, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: ".85rem", border: "1px solid var(--bnr-border)", borderRadius: 10, padding: 12, maxHeight: 220, overflowY: "auto" }}
        >
          {patient.profileSendOffNotes}
        </pre>
      )}
      {mnNotesOpen && patient.mnWorkflowNotes && (
        <pre
          style={{ marginTop: 10, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: ".85rem", border: "1px solid var(--bnr-border)", borderRadius: 10, padding: 12, maxHeight: 220, overflowY: "auto" }}
        >
          {patient.mnWorkflowNotes}
        </pre>
      )}
    </section>
  );
}
