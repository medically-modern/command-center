/**
 * MethodBar — the minimal "method badge + doctor · NPI" bar from the Send
 * Request redesign. Shared so Send Request and Confirm Receipt render an
 * identical bar. Pure presentation.
 */
import { Mail, Printer, Globe } from "lucide-react";
import type { Patient } from "@/lib/masheke/workflow";

/** Method badge (Fax / Email / Parachute). Parachute links out. */
export function MethodBadge({ method }: { method: string }) {
  const isFax = method === "Fax";
  const isEmail = method === "Email";
  const isParachute = method === "Parachute";
  const known = isFax || isEmail || isParachute;
  const cls = `inline-flex items-center gap-2 rounded-xl px-5 py-3.5 text-xl font-extrabold tracking-tight shrink-0 ${
    known ? "text-white" : "bg-muted text-muted-foreground"
  }`;
  const style = known ? { background: isParachute ? "var(--mm-green)" : "var(--mm-teal)" } : undefined;
  const inner = (
    <>
      {isEmail ? <Mail className="h-[22px] w-[22px]" /> : isFax ? <Printer className="h-[22px] w-[22px]" /> : isParachute ? <Globe className="h-[22px] w-[22px]" /> : null}
      {method}
    </>
  );
  if (isParachute) {
    return (
      <a
        href="https://www.parachutehealth.com/"
        target="_blank"
        rel="noopener noreferrer"
        className={`${cls} hover:opacity-90 transition-opacity`}
        style={style}
        title="Open Parachute Health"
      >
        {inner}
      </a>
    );
  }
  return (
    <span className={cls} style={style}>
      {inner}
    </span>
  );
}

/** Minimal top bar — method badge + doctor name · NPI, with an optional
 *  right-aligned slot (Confirm Receipt uses it for the call number). */
export function MethodBar({
  patient,
  method,
  right,
}: {
  patient: Patient;
  method: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-4 rounded-2xl border border-l-4 p-5"
      style={{ borderColor: "var(--mm-card-border)", borderLeftColor: "var(--mm-green)" }}
    >
      <MethodBadge method={method} />
      <p className="text-xl font-bold tracking-tight min-w-0 truncate">
        {patient.doctorName || "—"}
        {patient.doctorNpi && (
          <span className="font-medium text-muted-foreground"> · NPI {patient.doctorNpi}</span>
        )}
      </p>
      {right && <div className="ml-auto shrink-0">{right}</div>}
    </div>
  );
}
