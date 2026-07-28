import { Inbox } from "lucide-react";

/**
 * The message shown in a role page's main pane when no patient is open.
 *
 * Three states, and the distinction matters: an EMPTY QUEUE is not the same as
 * "you haven't clicked anyone yet". Reps used to see a patient's full profile
 * while the sidebar showed nothing — the last-worked patient stayed on screen
 * after being completed/snoozed off the visible list, which reads as a real
 * assignment (see useAutoSelectPatient, which now clears the selection so this
 * pane can take over).
 *
 * Drops INSIDE each page's existing placeholder card, so every role keeps its
 * own layout and only the copy is shared.
 */
export function EmptyPatientPane({
  loading,
  error,
  queueEmpty,
  /** Role-specific second line, e.g. "Nothing is due at Benefits today." */
  hint,
  /** Overrides the default "Select a patient…" line (Patient Questions reads
   *  "…to view their message"). */
  selectPrompt,
}: {
  loading?: boolean;
  error?: string | null;
  queueEmpty: boolean;
  hint?: string;
  selectPrompt?: string;
}) {
  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading patients from Monday…</p>;
  }
  if (error) {
    return <p className="text-sm text-muted-foreground">{error}</p>;
  }
  if (!queueEmpty) {
    return (
      <p className="text-sm text-muted-foreground">
        {selectPrompt ?? "Select a patient from the sidebar to begin."}
      </p>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="h-11 w-11 rounded-full bg-muted flex items-center justify-center">
        <Inbox className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-base font-semibold text-foreground">No patients in queue</p>
      <p className="text-sm text-muted-foreground max-w-sm">
        {hint ?? "Nothing to work in this view right now."}
      </p>
    </div>
  );
}
