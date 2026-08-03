/**
 * The one-line contract for a manager working a patient from an oversight view
 * (Josh, 2026-08-03).
 *
 * A manager who opens an escalated patient from Manager Intervention or Final
 * Decisions and fills the stage form is doing the processor's job. Completing it
 * IS the resolution, so the send clears the escalation and hands the patient
 * back to the pipeline (`sendPatientToMonday({ managerResolve: true })`) rather
 * than re-writing the label they arrived with — which is what used to happen,
 * leaving a finished patient sitting in the manager column.
 *
 * Said out loud on the page because it is not reversible from here: once the
 * escalation clears, the patient is back in a rep's queue and off the manager's
 * chart. Auto-rules on the same send still apply — an Auth Outstanding review
 * that comes back DENIED re-escalates on the new facts, not the old label.
 */
import { ShieldCheck } from "lucide-react";

export function ManagerResolveNote({ action }: { action: string }) {
  return (
    <div className="px-3 sm:px-6 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-300 dark:border-amber-800 flex items-start gap-2">
      <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
      <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">
        <span className="font-semibold">Manager view.</span> Completing this form and pressing{" "}
        <span className="font-semibold">{action}</span> clears the escalation and returns the patient
        to the normal pipeline — you are resolving it, not just recording it. A new escalation can
        still be raised by this send's own outcome (for example a denial).
      </p>
    </div>
  );
}
