/**
 * An unmatched item's right pane, once the rep has found the patient
 * (COMMS_INBOX_PLAN.md §6):
 *
 *   Add (555) 222-3333 to Jane Doe?
 *   [Add as alternate phone] (replaces (555) 000-9999) · Use as primary phone instead · Pick someone else
 *
 * The profile underneath is the hub's own `PatientDossierPanel`, under its
 * "Found by search" banner — so the rep sees exactly who they are about to
 * write to before anything is written. Nothing is written until a button is
 * pressed, and the rule of every button is `lib/commsInbox/addNumber.ts`.
 *
 * ⚠️ Gated on Edit profile — on the button AND inside the handler (§5.39h):
 * the button is what a rep sees, the handler is what stops the write. Without
 * it the rep can still LINK the number, which is the inbox's own state.
 */
import { useState } from "react";
import { Link2, Loader2, Phone } from "lucide-react";
import { toast } from "sonner";
import { AbilityLockNote, useAbility } from "@/components/shell/AbilityLock";
import { addNumberOptions, addNumberToPatient, type AddAs } from "@/lib/commsInbox/addNumber";
import { linkNumber } from "@/lib/commsInbox/api";
import { updatePatientContact } from "@/lib/commsHub/dossierApi";
import { forgetDirectoryName } from "@/hooks/commsHub/useDirectoryNames";
import { invalidateInbox } from "@/hooks/commsInbox/useInbox";
import type { PatientDossier } from "@/lib/commsHub/dossier";
import { contactTarget } from "@/lib/patient/contactEdit";
import { fmtPhone } from "@/lib/assignedPatients/format";

export default function AddNumberCard({
  itemKey,
  number,
  dossier,
  onLinked,
  onPickAgain,
}: {
  itemKey: string;
  /** The unmatched item's full number (E.164). */
  number: string;
  /** The picked patient. */
  dossier: PatientDossier;
  /** The item lives under the patient's key now — open it there. */
  onLinked: (key: string) => void;
  onPickAgain: () => void;
}) {
  const canEdit = useAbility("editProfile");
  const target = contactTarget(dossier);
  const opts = addNumberOptions(target, canEdit);
  const [busy, setBusy] = useState<AddAs | null>(null);
  const name = dossier.name || "this patient";

  const run = async (as: AddAs) => {
    if (busy || !target) return;
    // ⚠️ The handler re-checks what the button already hid — a stale tab or a
    // revoked ability reaches here and not the render.
    if (as !== "link" && (!canEdit || !opts.primary)) return;
    if (as === "alternate" && !opts.alternate) return;
    setBusy(as);
    try {
      const out = await addNumberToPatient(
        as,
        { key: itemKey, number, target, name: dossier.name },
        { updatePatientContact, linkNumber, forgetDirectoryName },
      );
      toast.success(
        as === "alternate"
          ? `Added ${fmtPhone(number)} to ${name} as their alternate phone.`
          : as === "primary"
            ? `${fmtPhone(number)} is now ${name}'s primary phone.`
            : `Linked ${fmtPhone(number)} to ${name}.`,
      );
      invalidateInbox();
      onLinked(out.key);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-4 mt-3 flex shrink-0 flex-col gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-sm dark:border-emerald-800 dark:bg-emerald-950/40">
      <p className="text-xs">
        Add <b>{fmtPhone(number)}</b> to <b>{name}</b>?
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        {opts.alternate && (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => void run("alternate")}
              disabled={!!busy}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy === "alternate" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Phone className="h-3 w-3" />}
              Add as alternate phone
            </button>
            {opts.alternate.replaces && (
              <span className="text-[11px] text-muted-foreground">(replaces {opts.alternate.replaces})</span>
            )}
          </span>
        )}
        {opts.primary && (
          <button
            onClick={() => void run("primary")}
            disabled={!!busy}
            className="inline-flex items-center gap-1 font-semibold underline hover:no-underline disabled:opacity-50"
          >
            {busy === "primary" && <Loader2 className="h-3 w-3 animate-spin" />}
            Use as primary phone instead
          </button>
        )}
        {/* Always offered where the alternate is not: the history moves to
            the patient in the inbox and nothing is written to Monday. */}
        {!opts.alternate && (
          <button
            onClick={() => void run("link")}
            disabled={!!busy}
            className="inline-flex items-center gap-1 font-semibold underline hover:no-underline disabled:opacity-50"
          >
            {busy === "link" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
            Link to {name}
          </button>
        )}
        <button onClick={onPickAgain} disabled={!!busy} className="text-muted-foreground underline hover:text-foreground">
          Pick someone else
        </button>
      </div>
      {/* The lock note names the switch; a record that can't be written at all
          (completed) says that instead — one sentence, not two. */}
      {!canEdit && target && !target.refusal ? (
        <AbilityLockNote ability="editProfile" className="self-start" />
      ) : (
        opts.writeRefusal && <p className="text-[11px] text-muted-foreground">{opts.writeRefusal}</p>
      )}
    </div>
  );
}
