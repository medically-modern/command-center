/**
 * ProposeStuckButton — the propose→approve stuck flow for the Insurance board
 * (Benefits, Submit Auth, Auth Outstanding). Mirrors the Medical Evaluation
 * flow in `masheke/ProposeStuckModal`: reps don't write Stuck themselves, they
 * PROPOSE it with a reason and a manager decides.
 *
 * On confirm: the reason is APPENDED to the Reference Notes
 * (long_text_mm2ffsme, stamped "[Proposed Stuck · <date>] …") and Escalation is
 * flipped. WHERE it lands depends on the stage (`escalateTo`):
 *
 *   - "final" (Benefits, Auth Outstanding — the default): "Final Escalation
 *     Required" (index 2) → Oversight's Final Decisions, where the manager
 *     Approves Stuck or Returns to Queue.
 *   - "manager" (Submit Auth, 2026-07-29): "Manager Escalation Required"
 *     (index 0) → the Manager Intervention "Submit Auth" chart's Propose Stuck
 *     bar FIRST. The manager reviews there and either returns the patient or
 *     explicitly escalates to Final Decisions (a second, manager-authored
 *     note) — a two-step propose → review → final flow.
 *
 * The Stage Advancer is NOT touched either way, so this is a plain status
 * write — no automation keys on it for a stage move.
 *
 * Deliberately NOT a verified-write transaction (the escalation column isn't an
 * automation trigger), but the writes are SEQUENTIAL, notes first: the status
 * flip is what surfaces the patient in Final Decisions, so the manager must
 * never see a proposal whose reason hasn't landed in the notes yet.
 *
 * The stamp format is the contract with the Oversight drill-down's "Proposed
 * Reason" column (ChartDef.reasonColId → extractProposedStuckReason).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Flag, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { writeStatusIndex, writeLongText, readColumnTexts, COL } from "@/lib/samantha/mondayApi";
import { ESCALATION_INDEX } from "@/lib/samantha/mondayMapping";
import { stampProposedStuck, appendStampedLine } from "@/lib/masheke/proposedStuck";
import { userInitials } from "@/lib/shared/auth";
import { etToday } from "@/lib/masheke/etDate";

export function ProposeStuckButton({
  patientId,
  onDone,
  escalateTo = "final",
}: {
  patientId: string;
  onDone?: () => void;
  /** Which escalation the proposal writes — "manager" only at Submit Auth. */
  escalateTo?: "final" | "manager";
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const close = () => {
    setOpen(false);
    setReason("");
  };

  const confirm = async () => {
    if (!reason.trim()) {
      toast.error("Add a short reason — the manager decides from it.");
      return;
    }
    setSaving(true);
    try {
      // Read the notes fresh so a concurrent edit isn't clobbered, append the
      // stamped reason, THEN flip the escalation status.
      const existing = await readColumnTexts(patientId, [COL.callReferenceNotes, COL.escalation]);
      const current = existing.find((c) => c.id === COL.callReferenceNotes)?.text ?? "";
      const stamped = stampProposedStuck(reason.trim(), etToday(), userInitials());
      await writeLongText(patientId, COL.callReferenceNotes, appendStampedLine(current, stamped));
      // Never DOWNGRADE an escalation: a Submit Auth proposal writes Manager,
      // but a patient already at Final Escalation Required stays there — the
      // manager's decision outranks a rep's proposal, and pulling them back
      // out of Final Decisions would silently undo it. The reason stamp still
      // lands either way.
      const currentEsc = existing.find((c) => c.id === COL.escalation)?.text?.trim() ?? "";
      const target =
        escalateTo === "manager" && currentEsc !== "Final Escalation Required"
          ? ESCALATION_INDEX.managerRequired
          : ESCALATION_INDEX.finalRequired;
      await writeStatusIndex(patientId, COL.escalation, target);
      toast.success("Proposed stuck — sent to the manager for a decision");
      close();
      onDone?.();
    } catch (e) {
      toast.error("Failed to propose stuck", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="gap-2 bg-amber-500 text-white hover:bg-amber-600 shadow-elevate"
      >
        <Flag className="h-4 w-4" /> Propose Stuck
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Propose Stuck
            </DialogTitle>
            <DialogDescription>
              {escalateTo === "manager" ? (
                <>
                  This flags the patient as <b>Manager Escalation Required</b> and sends them to
                  the manager's intervention review — the manager either returns them to your
                  queue or escalates to Final Decisions. The stage is unchanged.
                </>
              ) : (
                <>
                  This flags the patient as <b>Final Escalation Required</b> and sends them to the
                  manager's Final Decisions review — the manager either approves (patient moves to
                  Stuck) or returns them to your queue. The stage is unchanged.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Why is this patient stuck? e.g. payer denied twice and won't accept a peer-to-peer, no response from plan since 06/12…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-xs text-amber-600 dark:text-amber-500 mt-1 font-medium">
                NOTE: If you filled out the form but didn't submit it to Monday, that info will NOT be saved — include everything relevant to the stuck reason here.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={close} disabled={saving}>
                Cancel
              </Button>
              <Button
                onClick={confirm}
                disabled={saving || !reason.trim()}
                className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
                Propose Stuck
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
