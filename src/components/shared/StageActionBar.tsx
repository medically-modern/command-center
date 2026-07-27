/**
 * StageActionBar — the header action buttons for a role page, resolved from
 * `lib/shared/stageActions` per (stage × manager-view origin).
 *
 * Pages render this instead of hardcoding a Propose Stuck button. What appears
 * depends on how the page was opened:
 *  - a rep, or a manager from Processor Overview / Manager as Processor
 *      → Propose Stuck (unchanged behaviour)
 *  - a manager from Final Decisions (`?mv=final-decisions`)
 *      → Approve Stuck + Return to Queue, and NO Propose Stuck (the patient is
 *        already proposed stuck — proposing again is a no-op)
 *
 * The two boards write different columns, so `board` picks the writer pair; the
 * button set itself is board-agnostic and comes from the config table. Add a
 * cell to OVERRIDES there to give one page one different bar.
 *
 * After a decision lands the patient leaves this stage's queue, so the bar
 * navigates BACK (history-first, so the manager returns to the oversight
 * drill-down they came from) rather than leaving them on a page whose patient
 * has just disappeared.
 */
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
import { AlertTriangle, Flag, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import {
  approveInsuranceStuck,
  returnInsuranceToQueue,
  approveProposedStuck,
  returnProposedToQueue,
} from "@/lib/oversight/oversightApi";
import { managerOriginFromParams } from "@/lib/shared/managerOrigin";
import { actionsFor, type StageAction, type StageKey } from "@/lib/shared/stageActions";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { ProposeStuckModal } from "@/components/masheke/ProposeStuckModal";
import { ProposeStuckButton } from "@/components/samantha/ProposeStuckButton";

export type StageBoard = "masheke" | "insurance";

interface Props {
  stage: StageKey;
  board: StageBoard;
  patientId: string;
  patientName: string;
  /** Refetch the page's patient list after a write. */
  onDone: () => void;
}

export function StageActionBar({ stage, board, patientId, patientName, onDone }: Props) {
  const [searchParams] = useSearchParams();
  const { goBack } = useBackNavigation();
  const origin = managerOriginFromParams(searchParams);
  const actions = actionsFor(stage, origin);

  const [proposeOpen, setProposeOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveNote, setApproveNote] = useState("");
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnNote, setReturnNote] = useState("");
  const [busy, setBusy] = useState<StageAction | null>(null);

  const has = (a: StageAction) => actions.includes(a);

  const runDecision = async (action: "approveStuck" | "returnToQueue", note?: string) => {
    if (busy) return;
    setBusy(action);
    try {
      if (action === "approveStuck") {
        if (board === "insurance") await approveInsuranceStuck(patientId, note);
        else await approveProposedStuck(patientId, note);
        toast.success(`${patientName} marked Stuck`);
      } else {
        if (board === "insurance") await returnInsuranceToQueue(patientId, note);
        else await returnProposedToQueue(patientId, note);
        toast.success(`${patientName} returned to the queue`);
      }
      setApproveOpen(false);
      setApproveNote("");
      setReturnOpen(false);
      setReturnNote("");
      onDone();
      // The patient just left this stage's queue — go back to the drill-down.
      goBack();
    } catch (e) {
      toast.error(action === "approveStuck" ? "Approve Stuck failed" : "Return to Queue failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {has("proposeStuck") &&
        (board === "insurance" ? (
          <ProposeStuckButton patientId={patientId} onDone={onDone} />
        ) : (
          <>
            <Button
              onClick={() => setProposeOpen(true)}
              className="gap-2 bg-amber-600 hover:bg-amber-700 text-white shadow-elevate"
            >
              <AlertTriangle className="h-4 w-4" /> Propose Stuck
            </Button>
            <ProposeStuckModal
              open={proposeOpen}
              onOpenChange={setProposeOpen}
              patientId={patientId}
              patientName={patientName}
              onSuccess={onDone}
            />
          </>
        ))}

      {has("approveStuck") && (
        <Button
          onClick={() => {
            setApproveNote("");
            setApproveOpen(true);
          }}
          disabled={busy !== null}
          className="gap-2 bg-red-600 hover:bg-red-700 text-white shadow-elevate"
        >
          {busy === "approveStuck" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
          Approve Stuck
        </Button>
      )}

      {/* Approve Stuck confirms first. It moves the patient to the Stuck stage
          and takes them out of the pipeline — the most consequential button on
          the page, and unlike Propose Stuck it writes immediately, so a stray
          click on a full-page button must not be enough to fire it. */}
      <Dialog open={approveOpen} onOpenChange={(o) => busy === null && setApproveOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Approve {patientName} as Stuck?
            </DialogTitle>
            <DialogDescription>
              This approves the stuck proposal: the patient moves to the <b>Stuck</b> stage and
              leaves the pipeline. Use <b>Return to Queue</b> instead if they should keep going.
            </DialogDescription>
          </DialogHeader>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Add a note (optional)
            </label>
            <textarea
              value={approveNote}
              onChange={(e) => setApproveNote(e.target.value)}
              rows={3}
              placeholder="e.g. Confirmed with the payer — no path forward, patient notified."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Stamped into the notes — the last thing recorded before the patient leaves the pipeline.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setApproveOpen(false)} disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              onClick={() => runDecision("approveStuck", approveNote.trim() || undefined)}
              disabled={busy !== null}
              className="gap-2 bg-red-600 hover:bg-red-700 text-white"
            >
              {busy === "approveStuck" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
              Yes, mark Stuck
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {has("returnToQueue") && (
        <Button
          onClick={() => {
            setReturnNote("");
            setReturnOpen(true);
          }}
          disabled={busy !== null}
          className="gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-elevate"
        >
          {busy === "returnToQueue" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          Return to Queue
        </Button>
      )}

      {/* Dialog, NOT a hand-rolled fixed overlay. This bar renders inside the
          page header (bg-gradient-navy text-navy-foreground), and an in-tree
          overlay INHERITS that white text — the outline Cancel button sets no
          colour of its own, so it came out white-on-white and invisible.
          Dialog portals to document.body, escaping the inheritance. */}
      <Dialog open={returnOpen} onOpenChange={(o) => busy === null && setReturnOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-blue-500" />
              Return {patientName} to the queue
            </DialogTitle>
            <DialogDescription>
              Clears the escalation and re-dates the patient to today, so they go back into
              the rep's queue.
            </DialogDescription>
          </DialogHeader>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Add a note (optional)
            </label>
            <textarea
              value={returnNote}
              onChange={(e) => setReturnNote(e.target.value)}
              rows={3}
              placeholder="e.g. New clinicals arrived — back to the rep for another attempt."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground mt-1">Stamped into the notes.</p>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setReturnOpen(false)} disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              onClick={() => runDecision("returnToQueue", returnNote.trim() || undefined)}
              disabled={busy !== null}
              className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {busy === "returnToQueue" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Return to Queue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
