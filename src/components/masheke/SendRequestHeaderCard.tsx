/**
 * SendRequestHeaderCard — patient header for the Send Request redesign
 * (June 2026 mockups). White card, 4px teal top border, bold name,
 * three info groups, then per-method detail rows:
 *   - Parachute: gender / member id / devices / coverage paths / OOW /
 *     malfunction / patient address / doctor contact / clinic address
 *   - Fax & Email: devices / doctor contact / clinic / clinic address
 * Doctor info (editable) + doctor notes live in the DoctorSection at
 * the bottom of the card.
 */
import type { Patient } from "@/lib/masheke/workflow";
import { DoctorSection } from "@/components/masheke/mmKit";

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
}: {
  patient: Patient;
  onDoctorEdit?: (patch: Partial<Patient>) => void;
}) {
  const method = patient.clinicalsMethod ?? "Fax";
  const isParachute = method === "Parachute";

  return (
    <section
      className="rounded-2xl bg-card border p-6 shadow-sm border-t-4"
      style={{ borderColor: "var(--mm-card-border)", borderTopColor: "var(--mm-teal)" }}
    >
      <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Patient</p>
      <h1 className="text-3xl font-black tracking-tight">{patient.name}</h1>
      <p className="mt-1 text-lg text-muted-foreground">
        DOB {dash(patient.dob)} · {formatPhone(patient.phone)}
      </p>

      {/* three info groups */}
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

      {/* per-method detail rows */}
      {isParachute ? (
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
            <Field label="Patient Address" value={patient.address} span2 />
            <Field label="Patient Phone" value={formatPhone(patient.phone)} />
          </div>
        </>
      ) : (
        <div className="mt-5 border-t pt-5 grid grid-cols-2 lg:grid-cols-4 gap-5" style={{ borderColor: "var(--mm-card-border)" }}>
          <Field label="CGM" value={patient.cgmType} />
          <Field label="Pump" value={patient.pumpType} />
          <Field label="Patient Address" value={patient.address} span2 />
        </div>
      )}

      {/* doctor info + notes — editable, persists on Mark as Complete */}
      <DoctorSection
        patient={patient}
        onDoctorEdit={onDoctorEdit}
        editHint="Edits are saved to Monday when you Mark as Complete (or via the Save button above)."
      />
    </section>
  );
}
