/**
 * Patient Questions — read-only detail card.
 * Shows full message with timestamp and patient info.
 */
import { MessageCircle, Phone, Mail, Shield, Calendar, ExternalLink, User } from "lucide-react";
import type { PatientQuestion } from "@/lib/patientQuestions/types";
import { cn } from "@/lib/utils";

interface Props {
  patient: PatientQuestion;
}

function formatTimestamp(iso: string): string {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export function PatientDetailCard({ patient }: Props) {
  const mondayUrl = `https://medicallymodern-force.monday.com/boards/${patient.boardId}/pulses/${patient.id}`;

  return (
    <div className="space-y-5">
      {/* Patient header */}
      <div className="rounded-xl bg-card border shadow-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">{patient.name}</h2>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider",
                    patient.source === "subscription"
                      ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
                      : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                  )}
                >
                  {patient.source === "subscription" ? "Re-order Board" : "Co-Pay Board"}
                </span>
                {patient.status && (
                  <span className="text-xs text-muted-foreground">· {patient.status}</span>
                )}
              </div>
            </div>
          </div>
          <a
            href={mondayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-primary hover:underline shrink-0"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View in Monday
          </a>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <InfoRow icon={Phone} label="Phone" value={patient.phone} />
          <InfoRow icon={Mail} label="Email" value={patient.email} />
          <InfoRow icon={Shield} label="Insurance" value={patient.insurance} />
          <InfoRow icon={Calendar} label="DOB" value={patient.dob} />
        </div>
      </div>

      {/* Message card */}
      <div className="rounded-xl bg-card border shadow-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <MessageCircle className="h-5 w-5 text-primary" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Patient Message
          </h3>
        </div>

        <div className="rounded-lg bg-muted/30 border p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">{patient.name}</span>
            <span className="text-xs text-muted-foreground">
              {formatTimestamp(patient.messageUpdatedAt)}
            </span>
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{patient.message}</p>
        </div>
      </div>
    </div>
  );
}
