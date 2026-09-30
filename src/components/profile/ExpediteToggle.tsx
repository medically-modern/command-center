/**
 * The Expedited tick (§5.56) — a manager's "work this patient the same day".
 *
 * Mounted at the foot of each intake stage's readiness list, just above the
 * button that hands the patient on: Referral Intake (`ProfilePage`), and Info
 * Collection + Profile Clean-Up (`UnverifiedReferralsPage`). Nowhere else —
 * Josh, 2026-09-30: *"only managers can expedite and only in those intake
 * stages"*.
 *
 * ⚠️ MANAGERS ONLY, read off the SIGNED-IN person (`useAccessContext`), never a
 * borrowed view (§5.39g-h: write guards answer "may I do this").
 * A processor sees the line only once a patient IS expedited, read-only, so
 * the rep working them knows why the next stage will have them due today; a
 * disabled empty box on every patient would be noise for a control they can
 * never use.
 *
 * ⚠️ The press writes the board AT ONCE (`writeExpedited`), not on Save or
 * Advance: the manager who ticks is often not the rep who advances. The page's
 * overlay carries the new value meanwhile, so an Advance pressed straight
 * after still sees it and verifies it before the hop fires
 * (`expeditedAdvanceTask`). Once Monday reads the value back, the overlay key
 * is dropped again — otherwise the tick would light the page's "unsaved
 * edits" marks for a change that is already saved.
 *
 * ⚠️ Every write is addressed to the item id captured at the press, never to
 * "the selected patient" at the time the write returns — a rep can switch
 * patients mid-write, and the page's own `edit`/`onUpdate` follow the
 * selection.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Zap } from "lucide-react";
import { useAccessContext } from "@/components/AccessProvider";
import { EXPEDITED_LABEL, isExpedited } from "@/lib/shared/expedited";
import { writeExpedited } from "@/lib/profile/expedite";
import type { Patient } from "@/lib/profile/workflow";

export interface ExpediteToggleProps {
  patient: Patient;
  /** The hook's `updateLocal` — patch THIS item's overlay. */
  onLocal: (id: string, patch: Partial<Patient>) => void;
  /** Monday has read the value back: drop the `expedited` overlay key for this
   *  item and refetch, so the board value renders unmasked. */
  onSettled: (id: string) => void;
  /** The page is mid-save or mid-advance, or reviewing a completed stage. */
  disabled?: boolean;
}

export function ExpediteToggle({ patient, onLocal, onSettled, disabled }: ExpediteToggleProps) {
  const { access } = useAccessContext();
  const isManager = access.type === "manager";
  const [busy, setBusy] = useState(false);
  const on = isExpedited(patient.expedited);

  // A processor has nothing to do here unless the mark is set.
  if (!isManager && !on) return null;

  const toggle = async (next: boolean) => {
    if (!isManager || busy || disabled) return;
    const id = patient.id;
    const name = patient.name;
    const prev = patient.expedited ?? "";
    setBusy(true);
    onLocal(id, { expedited: next ? EXPEDITED_LABEL : "" });
    try {
      const confirmed = await writeExpedited(id, next);
      if (confirmed) {
        onSettled(id);
      } else {
        // Written (Monday said 200) but not read back yet. Keep the overlay so
        // the screen shows what was asked for; the next save or advance clears
        // it, and the batch there verifies the mark before the hop.
        toast.warning("Saved — Monday hasn't shown it yet", {
          description: "Give it a moment before advancing.",
        });
        return;
      }
      toast.success(
        next
          ? `${name} expedited — due the same day at each next stage`
          : `${name} is no longer expedited`,
      );
    } catch (e) {
      onLocal(id, { expedited: prev });
      onSettled(id);
      toast.error("Couldn't save Expedited", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const readOnly = !isManager;
  return (
    <label
      className={`xp-line${on ? " on" : ""}${readOnly ? " ro" : ""}`}
      title={readOnly ? "Only a manager can change this" : undefined}
    >
      <input
        type="checkbox"
        checked={on}
        disabled={readOnly || busy || disabled}
        onChange={(e) => { void toggle(e.target.checked); }}
        aria-describedby={`xp-note-${patient.id}`}
      />
      <span className="xp-body">
        <span className="xp-title">
          <Zap aria-hidden="true" />
          Expedite
          {busy && <span className="xp-busy">Saving…</span>}
        </span>
        <span className="xp-note" id={`xp-note-${patient.id}`}>
          {readOnly
            ? "A manager expedited this patient — due the same day at each next stage."
            : "Due the same day at each next stage, instead of the next business day. Managers only."}
        </span>
      </span>
    </label>
  );
}
