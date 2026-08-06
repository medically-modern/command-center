/**
 * ProposeStuckModal — the propose→approve stuck flow (Manager Views).
 * Reps don't write Stuck themselves; they PROPOSE it and a manager decides.
 *
 * On confirm: the reason is APPENDED to the MN workflow notes
 * (long_text_mm27zjt2, stamped "[Proposed Stuck · <date>] …") and Escalation is
 * flipped to "Final Escalation Required" (color_mm1x7997 index 2). The patient
 * leaves this rep's stage queue immediately (useMondayPatients filters index-2
 * patients out) and lands in Pipeline Oversight → Final Decisions, where the
 * manager either Approves Stuck (writes the main Stage Advancer → Stuck) or
 * Returns to Queue (appends an optional note, re-dates, clears the escalation).
 *
 * Deliberately NOT a verified-write transaction (the escalation column isn't an
 * automation trigger), but the writes are SEQUENTIAL, notes first: the status
 * flip is what surfaces the patient in Final Decisions, so the manager must
 * never see a proposal whose reason hasn't landed in the notes yet.
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2 } from "lucide-react";
import { writeStatusIndex, writeLongText, fetchItemColumnTexts, COL } from "@/lib/masheke/mondayApi";
import { ESCALATION_INDEX } from "@/lib/masheke/mondayMapping";
import { stampProposedStuck, appendStampedLine } from "@/lib/masheke/proposedStuck";
import { userInitials } from "@/lib/shared/auth";
import { etToday } from "@/lib/masheke/etDate";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  patientName: string;
  onSuccess: () => void;
  /** Override the write for a board other than Medical Evaluation. Given the
   *  rep's reason, it must stamp the note and flip that board's escalation to
   *  its Final/proposed-stuck index. Omitted = the MN behaviour below. */
  onConfirm?: (reason: string) => Promise<void>;
}

export function ProposeStuckModal({ open, onOpenChange, patientId, patientName, onSuccess, onConfirm }: Props) {
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);

  const handleConfirm = async () => {
    if (!reason.trim()) {
      toast.error("Add a short reason — the manager decides from it.");
      return;
    }
    setSending(true);
    try {
      // Append the reason to the MN notes (stamped), THEN flip Escalation → Final
      // Escalation Required (index 2). Notes first: the status flip is what
      // surfaces the patient in the manager's Final Decisions, so the reason must
      // already be in the notes when they look. Read the notes fresh so a
      // concurrent edit isn't clobbered.
      if (onConfirm) {
        await onConfirm(reason.trim());
      } else {
        const existing = await fetchItemColumnTexts(patientId, [COL.mnEvalNotes]);
        const stamped = stampProposedStuck(reason.trim(), etToday(), userInitials());
        const appended = appendStampedLine(existing[COL.mnEvalNotes], stamped);
        await writeLongText(patientId, COL.mnEvalNotes, appended);
        await writeStatusIndex(patientId, COL.escalation, ESCALATION_INDEX.finalRequired);
      }
      toast.success(`${patientName} proposed as Stuck — sent to the manager for a decision`);
      onOpenChange(false);
      setReason("");
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ProposeStuckModal] Failed to propose stuck:", msg);
      toast.error(`Failed to propose stuck: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Propose Stuck
          </DialogTitle>
          <DialogDescription>
            Propose <strong>{patientName}</strong> as stuck. They leave your queue
            immediately and go to the manager's Final Decisions list — the manager
            either approves (patient moves to Stuck) or returns them to your queue.
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
              placeholder="Why is this patient stuck? e.g. doctor unreachable after 6 attempts, patient not responding since 06/12…"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-amber-600 dark:text-amber-500 mt-1 font-medium">
              NOTE: If you filled out the form but didn't submit it to Monday, that info will NOT be saved — include everything relevant to the stuck reason here.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={sending || !reason.trim()}
              className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
              Propose Stuck
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
