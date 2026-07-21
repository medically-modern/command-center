/**
 * ProposeStuckModal — the propose→approve stuck flow (Manager Views
 * redesign 2026-07, HANDOFF-Josh-Manager-Views.md §3). Replaces the old
 * direct StuckModal: reps no longer write Stuck themselves.
 *
 * On confirm: writes "Proposed Stuck" (Proposed Stuck column, index 1) +
 * the required reason (Proposed Stuck Reason text column). The patient
 * leaves this rep's stage queue immediately (useMondayPatients filters
 * proposed patients out) and lands in Pipeline Oversight → Final
 * Decisions, where the manager either Approves Stuck (writes the real
 * Stuck via Advancer 2C — what the old modal did) or Returns to Queue
 * (clears the proposal).
 *
 * Deliberately NOT a verified-write transaction: neither column is an
 * automation trigger (the new status column has no automations), so the
 * two parallel writes carry no stale-sibling risk.
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
import { writeStatusIndex, writeText, COL } from "@/lib/masheke/mondayApi";
import { PROPOSED_STUCK_INDEX } from "@/lib/masheke/mondayMapping";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  patientName: string;
  onSuccess: () => void;
}

export function ProposeStuckModal({ open, onOpenChange, patientId, patientName, onSuccess }: Props) {
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);

  const handleConfirm = async () => {
    if (!reason.trim()) {
      toast.error("Add a short reason — the manager decides from it.");
      return;
    }
    setSending(true);
    try {
      await Promise.all([
        writeStatusIndex(patientId, COL.proposedStuck, PROPOSED_STUCK_INDEX.proposed),
        writeText(patientId, COL.proposedStuckReason, reason.trim()),
      ]);
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
            <p className="text-xs text-muted-foreground mt-1">
              Shown to the manager in the Oversight drill-down.
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
