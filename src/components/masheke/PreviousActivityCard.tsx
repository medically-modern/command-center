/**
 * PreviousActivityCard — the "Attempt #N + Previous activity" context card
 * from the Send Request redesign (June 2026). Shows a bold title plus the
 * cross-stage history (Send Request / Confirm Receipt / Chase Clinicals) so
 * the rep sees how many rounds have happened and what was done, not just a
 * bare attempt counter. Shared by Send Request and Confirm Receipt.
 * Pure presentation — no Monday writes.
 */
import type { Patient } from "@/lib/masheke/workflow";

export function PreviousActivityCard({
  title,
  patient,
}: {
  title: string;
  patient: Patient;
}) {
  const method = patient.clinicalsMethod ?? "Fax";
  // Where the request went — the fax number (or email), shown alongside the method.
  const dest = method === "Email" ? patient.doctorEmail : method === "Fax" ? patient.doctorFax : undefined;
  const sendRequestLine = patient.requestSentAt
    ? `${formatActivityDate(patient.requestSentAt)} · ${method}${dest ? ` · ${dest}` : ""}`
    : null;
  return (
    <div
      className="rounded-2xl border border-l-4 px-6 py-4 shadow-sm"
      style={{ borderColor: "var(--mm-card-border)", borderLeftColor: "var(--mm-green)" }}
    >
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-3 mb-2">
        Previous activity
      </p>
      <div className="space-y-2.5">
        <ActivityRow
          label="Send Request"
          items={sendRequestLine ? [sendRequestLine] : []}
        />
        <ActivityRow
          label="Confirm Receipt"
          items={[patient.confirmAttempt1, patient.confirmAttempt2, patient.confirmAttempt3].filter(Boolean) as string[]}
        />
        <ActivityRow
          label="Chase Clinicals"
          items={[patient.chaseAttempt1, patient.chaseAttempt2, patient.chaseAttempt3].filter(Boolean) as string[]}
        />
      </div>
    </div>
  );
}

/** One cross-stage activity row (Send Request / Confirm Receipt / Chase). */
export function ActivityRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-x-3 gap-y-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:w-32 shrink-0 sm:pt-0.5">
        {label}
      </span>
      {items.length ? (
        <ul className="space-y-0.5">
          {items.map((it, i) => (
            <li key={i} className="text-sm text-muted-foreground flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-muted-foreground/60 shrink-0" />
              {it}
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      )}
    </div>
  );
}

/** "Jun 12, 2026, 4:33 PM ET" from Monday's date+time text (UTC-tagged). */
export function formatActivityDate(iso?: string): string | null {
  if (!iso) return null;
  // Monday's text for a date+time column comes back like "2026-05-01 14:30:00 UTC"
  // — strip a trailing " UTC" so Date can parse the ISO-ish string.
  const cleaned = iso.replace(/\s+UTC$/, "Z").replace(" ", "T");
  const d = new Date(cleaned);
  if (Number.isNaN(d.getTime())) return iso;
  // Always render in Eastern Time and tag the suffix so the rep sees the tz.
  const formatted = d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatted} ET`;
}
