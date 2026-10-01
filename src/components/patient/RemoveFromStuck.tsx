/**
 * Remove from Stuck — the patient screen's fifth write (§5.57).
 *
 * Brandon, 2026-10-01: *"add a Remove from Stuck button to the patient profile
 * page, which undo's a stuck … It should go next to the stuck warning on top"*.
 * Josh, the same day: *"automatically any one with manager privilege gets that
 * button … with a notif that it sucessfully sent to monday"*.
 *
 * ⚠️⚠️ **MANAGERS ONLY, read off the SIGNED-IN person (`useAccessContext`),
 * never `useDisplayAccess`.** This answers "may I write this", so a manager
 * Viewing as a processor keeps it and a processor can never borrow it
 * (§5.39g-h). It is checked twice, as every write guard is: on the button,
 * and again inside the handler at the moment of the press.
 * ⚠️ There is no Users-page switch for it, on Josh's word — the Manager tick
 * on that page IS the setting. A processor is not shown a dead button: the
 * chip beside it already says a manager moves them back.
 *
 * ⚠️ The button only OPENS the panel; nothing is written until the manager
 * confirms which stage the patient goes back to. The panel preselects the one
 * Monday's activity log names (`readStuckOrigin`) and never guesses one.
 */
import { useEffect, useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useAccessContext } from "@/components/AccessProvider";
import type { DossierItem } from "@/lib/commsHub/dossier";
import {
  canRemoveFromStuck,
  stuckPlanFor,
  type StuckOrigin,
  type StuckPlan,
  type StuckTarget,
} from "@/lib/oversight/removeFromStuck";
import { readStuckOrigin, removeFromStuck } from "@/lib/oversight/removeFromStuckApi";

/** The plan for this record when the SIGNED-IN person may remove it from Stuck. */
export function useRemoveFromStuck(item: DossierItem | null): StuckPlan | null {
  const { access } = useAccessContext();
  if (!item || access.type !== "manager") return null;
  return canRemoveFromStuck(item) ? stuckPlanFor(item.boardId) : null;
}

export function RemoveFromStuckButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`btn xs danger-outline${open ? " on" : ""}`}
      aria-expanded={open}
      onClick={onToggle}
      title="Put this patient back in the stage they were stuck from — managers only"
    >
      <Undo2 style={{ width: 12, height: 12 }} /> Remove from Stuck
    </button>
  );
}

type OriginState =
  | { phase: "reading" }
  | { phase: "read"; origin: StuckOrigin | null; target: StuckTarget | null }
  | { phase: "failed"; message: string };

/** "Welcome Call", or "Welcome Call · Stuck / Don't Proceed" — what the log names. */
function originWords(o: StuckOrigin | null): string {
  return o?.fromGroupTitle || o?.fromAdvancerText || "";
}

export function RemoveFromStuckPanel({
  item,
  plan,
  lookupPhone,
  onClose,
  onDone,
}: {
  item: DossierItem;
  plan: StuckPlan;
  /** The number the dossier was looked up by — the notes writer's cache key. */
  lookupPhone: string;
  onClose: () => void;
  /** After Monday confirms — the host re-reads the record. */
  onDone: () => void;
}) {
  const { access } = useAccessContext();
  const [origin, setOrigin] = useState<OriginState>({ phase: "reading" });
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // ONE read, when the panel opens for this record — never on a timer. The
  // caller keys the panel on the item, so another record is a fresh panel.
  useEffect(() => {
    let cancelled = false;
    readStuckOrigin(plan, item.itemId)
      .then((r) => {
        if (cancelled) return;
        setOrigin({ phase: "read", origin: r.origin, target: r.target });
        if (r.target) setPick((cur) => cur || r.target!.key);
      })
      .catch((e: unknown) => {
        if (!cancelled) setOrigin({ phase: "failed", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [plan, item.itemId]);

  const target = plan.targets.find((t) => t.key === pick) ?? null;

  const confirm = async () => {
    // ⚠️ The handler asks again: the button is what a person sees, this is
    // what stops the write (a demotion mid-session, a stale tab).
    if (access.type !== "manager") {
      toast.error("Only a manager can remove a patient from Stuck");
      return;
    }
    if (!target || busy) return;
    setBusy(true);
    setError("");
    const name = item.name || "This patient";
    try {
      const r = await removeFromStuck({
        plan,
        target,
        itemId: item.itemId,
        notes: { columnId: item.notesColId, columnType: item.notesColType },
        lookupPhone,
      });
      if (r.alreadyOut) {
        toast.info(`${name} is already out of Stuck`, {
          description: `Monday has them in ${r.groupTitle || "another group"} — nothing was changed.`,
        });
      } else {
        toast.success(`${name} removed from Stuck`, {
          description: `Saved to Monday — back in ${r.groupTitle || target.label}.`,
        });
        if (item.notesColId && !r.noteSaved) {
          toast.warning("The “Removed from Stuck” note didn't save", {
            description: "The move did. Add a note from the stage page if the rep needs to know why.",
          });
        }
      }
      onDone();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("Couldn't remove from Stuck", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  let history: string;
  if (origin.phase === "reading") history = "Reading Monday's history for where they were before Stuck…";
  else if (origin.phase === "failed") history = `Couldn't read Monday's history (${origin.message}). Pick the stage.`;
  else if (origin.target) history = `Monday's history: moved to Stuck from ${originWords(origin.origin) || origin.target.label}.`;
  else if (originWords(origin.origin))
    history = `Monday's history: moved to Stuck from “${originWords(origin.origin)}”, which isn't a stage this can return them to. Pick one.`;
  else history = "Monday's history doesn't show where they were before Stuck. Pick the stage.";

  return (
    <div className="unstuck-panel" role="group" aria-label="Remove from Stuck">
      <div className="xs muted">{history}</div>
      <div className="unstuck-row">
        <label className="small" htmlFor={`unstuck-${item.itemId}`}>
          Back to
        </label>
        <select
          id={`unstuck-${item.itemId}`}
          className="input sm"
          value={pick}
          disabled={busy}
          onChange={(e) => setPick(e.target.value)}
        >
          <option value="" disabled>
            Pick a stage on {plan.boardName}…
          </option>
          {plan.targets.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn outline xs" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn xs danger" onClick={() => void confirm()} disabled={!target || busy}>
          {busy ? <Loader2 className="animate-spin" style={{ width: 12, height: 12 }} /> : <Undo2 style={{ width: 12, height: 12 }} />}
          {busy ? "Saving to Monday…" : "Remove from Stuck"}
        </button>
      </div>
      {target?.caveat && <div className="xs muted">{target.caveat}</div>}
      {error && <div className="xs unstuck-err">{error}</div>}
    </div>
  );
}
