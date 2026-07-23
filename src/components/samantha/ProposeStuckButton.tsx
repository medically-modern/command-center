import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Flag, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { writeStatusIndex, COL } from "@/lib/samantha/mondayApi";
import { ESCALATION_INDEX } from "@/lib/samantha/mondayMapping";

/**
 * ProposeStuckButton — Benefits-only manual escalation (2026-07). After a
 * confirmation, flips the Insurance Escalation status to "Final Escalation
 * Required" (index 2), routing the patient to the oversight "Final Decisions"
 * column. It does NOT change the Stage Advancer (stays Benefits / SoS), so it's
 * a plain status write — no automation keys on this status for a stage move.
 */
export function ProposeStuckButton({ patientId, onDone }: { patientId: string; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    setSaving(true);
    try {
      await writeStatusIndex(patientId, COL.escalation, ESCALATION_INDEX.finalRequired);
      toast.success("Proposed stuck — Final Escalation set on Monday");
      setOpen(false);
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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Propose stuck?
            </DialogTitle>
            <DialogDescription>
              This flags the patient as <b>Final Escalation Required</b> and sends them to the
              manager's Final Decisions review. The stage stays at Benefits. Continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={confirm} disabled={saving} className="gap-2 bg-red-600 text-white hover:bg-red-700">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Proposing…
                </>
              ) : (
                "Yes, propose stuck"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
