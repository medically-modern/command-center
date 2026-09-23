/**
 * The Communications hub's right pane, before there is a profile to draw —
 * nothing open, looking up, failed, and a number on no board with the
 * find-a-patient search. ONE copy, rendered by both panes: the original
 * `PatientDossierPanel` and, with the Inbox on, the embedded patient screen
 * (`HubPatientPane`, CLAUDE.md §5.49), so the two can never say different
 * things about the same moment.
 *
 * Its own module because it is a function that returns markup, not a
 * component: next to components it breaks Fast Refresh for the whole file
 * (`react-refresh/only-export-components`).
 */
import { AlertCircle, Loader2, User } from "lucide-react";
import type { PatientDossier } from "@/lib/commsHub/dossier";
import type { SystemPatient } from "@/lib/systemMgmt/mondayApi";
import { fmtPhone } from "@/lib/assignedPatients/format";
import DossierSearch from "./DossierSearch";

/**
 * The pane's non-profile states — nothing open, looking up, failed, and a
 * number on no board — shared by this pane and the hub's embedded patient
 * screen (`HubPatientPane`), so the two cannot say different things about the
 * same moment. Null when there is a dossier to draw.
 */
export function dossierPaneFallback({
  phone,
  loading,
  error,
  dossier,
  idleHint = "Open a conversation, call or voicemail to see the patient's Command Center profile.",
  onPick,
}: {
  phone: string | null;
  loading: boolean;
  error: string | null;
  dossier: PatientDossier | null;
  idleHint?: string;
  onPick?: (row: SystemPatient) => void;
}): JSX.Element | null {
  if (!phone) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <User className="h-7 w-7 text-muted-foreground/50" />
        <p className="max-w-[26ch] text-xs text-muted-foreground">{idleHint}</p>
      </div>
    );
  }

  // ⚠️ `loading` alone, NOT `loading && !dossier`. Keeping the previous
  // patient's profile up while the next one loads is what Josh reported on
  // 2026-09-02, and it is not just stale UI: the composer below writes to
  // `active.itemId` and the page's `threadPatient` carries `mondayItemId` onto
  // an outbound text, so the window was long enough to file a note or a text
  // against the wrong patient. `useDossier` clears the dossier to match.
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Looking them up…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-start gap-2 p-4 text-sm">
        <span className="flex items-center gap-1.5 font-medium text-destructive">
          <AlertCircle className="h-4 w-4" /> Couldn't load the profile
        </span>
        <span className="break-words text-xs text-muted-foreground">{error}</span>
      </div>
    );
  }

  if (!dossier) {
    return (
      <div className="flex flex-1 flex-col items-center gap-3 p-4 pt-8 text-center">
        <User className="h-7 w-7 text-muted-foreground/50" />
        <p className="text-sm font-medium">{fmtPhone(phone)}</p>
        {/* Not an error: texting a number that is on no board is supported. */}
        <p className="max-w-[30ch] text-xs text-muted-foreground">
          This number isn't on any pipeline board. You can still text and call it.
        </p>
        {/* The usual reason: the patient is calling from a line their record
            doesn't carry (James McDowell, 2026-09-03). Same search as System
            Management, so the rep can pull the right profile up beside the
            call anyway. */}
        {onPick && (
          <div className="mt-2 w-full text-left">
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
              Calling from a different number? Find their profile:
            </p>
            <DossierSearch onPick={onPick} />
          </div>
        )}
      </div>
    );
  }

  return null;
}
