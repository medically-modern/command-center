/**
 * StageActionBar — the header action buttons for a role page, resolved from
 * `lib/shared/stageActions` per (stage × manager-view origin).
 *
 * Pages render this instead of hardcoding a Propose Stuck button. What appears
 * depends on how the page was opened:
 *  - a rep, or a manager from Processor Overview / Manager Intervention
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
 *
 * ⚠️ **`skin` is not a taste knob — `skin="page"` is REQUIRED inside `.pf-root`**
 * (Brandon, 2026-08-19: "the Propose Stuck button on the right still looks
 * funky"). The intake redesign's reset is `.pf-root button { background:none;
 * border:none; color:inherit; font:inherit }` — one class + one type, so it
 * OUT-SPECIFIES every single-class Tailwind utility the shadcn `Button` carries.
 * `bg-rose-600`, `text-white`, `text-sm` and `font-medium` are all overridden,
 * and the button renders as unstyled dark text with a stray drop shadow. The
 * page's own `.pf-root .btn` rules are two classes, so they win: `skin="page"`
 * renders the same actions in that language instead of fighting the reset with
 * `!important`. Nothing else in the tree needs it — every other caller mounts
 * the bar in a navy page header, outside `.pf-root`.
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
import { AlertTriangle, CornerDownLeft, Flag, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import {
  approveInsuranceStuck,
  returnInsuranceToQueue,
  returnInsuranceToManager,
  approveProposedStuck,
  returnProposedToQueue,
} from "@/lib/oversight/oversightApi";
import { managerOriginFromParams } from "@/lib/shared/managerOrigin";
import {
  proposeIntakeStuck, returnIntakeToPipeline, approveIntakeStuck,
} from "@/lib/profile/unverifiedWrite";
import { actionsFor, proposeStuckLevel, type StageAction, type StageKey } from "@/lib/shared/stageActions";
import { returnAttemptReset } from "@/lib/masheke/attemptRollup";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { ProposeStuckModal } from "@/components/masheke/ProposeStuckModal";
import { ProposeStuckButton } from "@/components/samantha/ProposeStuckButton";

export type StageBoard = "masheke" | "insurance" | "profile";

/** Every board dispatch below is an exhaustive switch, not an if/else. The
 *  previous binary form treated masheke as the `else`, so adding a board would
 *  have silently routed its patients into the masheke escalation columns —
 *  wrong board, no type error, no runtime error. A switch with a `never` guard
 *  turns that same mistake into a compile failure. */
function unhandledBoard(board: never): never {
  throw new Error(`StageActionBar: no write path for board "${String(board)}"`);
}

/**
 * One action button, drawn in whichever language the host page speaks.
 *
 * Same handler, same icon, same label, same disabled state — only the skin
 * differs, so a page can never end up with a button that behaves differently
 * from the header's. See the specificity note at the top for why the "page"
 * variant exists at all.
 */
const TONE_CLASSES: Record<
  "propose" | "approve" | "return" | "demote",
  { header: string; page: string }
> = {
  propose: { header: "bg-rose-600 hover:bg-rose-700 text-white shadow-elevate", page: "btn rose" },
  approve: { header: "bg-red-600 hover:bg-red-700 text-white shadow-elevate",   page: "btn rose" },
  // Teal outline rather than a filled button: on the page this sits beside the
  // decision, and two filled buttons read as two equally-weighted exits.
  return:  { header: "bg-blue-600 hover:bg-blue-700 text-white shadow-elevate", page: "btn secondary" },
  demote:  { header: "bg-amber-500 hover:bg-amber-600 text-white shadow-elevate", page: "btn amber" },
};

function BarButton({
  skin, tone, onClick, disabled, icon, label,
}: {
  skin: "header" | "page";
  tone: keyof typeof TONE_CLASSES;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  if (skin === "page") {
    return (
      <button type="button" className={TONE_CLASSES[tone].page} onClick={onClick} disabled={disabled}>
        {icon} {label}
      </button>
    );
  }
  return (
    <Button onClick={onClick} disabled={disabled} className={`gap-2 ${TONE_CLASSES[tone].header}`}>
      {icon} {label}
    </Button>
  );
}

interface Props {
  stage: StageKey;
  board: StageBoard;
  patientId: string;
  patientName: string;
  /** The patient's current Insurance Escalation label — decides whether a
   *  Propose Stuck raises to Manager Intervention or promotes to Final
   *  Decisions (`proposeStuckLevel`). Insurance board only. */
  escalationLabel?: string;
  /** Refetch the page's patient list after a write. */
  onDone: () => void;
  /** Runs BEFORE the propose-stuck write — the intake page passes its
   *  save-to-Monday here so a proposal carries the rep's unsaved form edits
   *  instead of losing them with the patient (Josh, 2026-08-18). Also flips
   *  the modal's footnote to say the save happens. */
  beforeProposeStuck?: () => Promise<void>;
  /** Which button language to render in. "header" (default) = the shadcn
   *  `Button`, for the navy page headers every other caller mounts this in.
   *  "page" = the redesign's `.btn` classes, MANDATORY inside `.pf-root` —
   *  see the specificity note at the top of this file. */
  skin?: "header" | "page";
}

export function StageActionBar({
  stage, board, patientId, patientName, escalationLabel, onDone, beforeProposeStuck,
  skin = "header",
}: Props) {
  const [searchParams] = useSearchParams();
  const { goBack } = useBackNavigation();
  const origin = managerOriginFromParams(searchParams);
  const actions = actionsFor(stage, origin);

  const [proposeOpen, setProposeOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveNote, setApproveNote] = useState("");
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnNote, setReturnNote] = useState("");
  const [downOpen, setDownOpen] = useState(false);
  const [downNote, setDownNote] = useState("");
  const [busy, setBusy] = useState<StageAction | null>(null);

  const has = (a: StageAction) => actions.includes(a);

  const runDecision = async (
    action: "approveStuck" | "returnToQueue" | "returnToManager",
    note?: string,
  ) => {
    if (busy) return;
    setBusy(action);
    try {
      if (action === "approveStuck") {
        switch (board) {
          case "insurance": await approveInsuranceStuck(patientId, note); break;
          case "masheke":   await approveProposedStuck(patientId, note); break;
          case "profile":   await approveIntakeStuck(patientId, note ?? ""); break;
          default: unhandledBoard(board);
        }
        toast.success(`${patientName} marked Stuck`);
      } else if (action === "returnToManager") {
        // Only the Insurance board hands a patient DOWN a rung today.
        switch (board) {
          case "insurance": await returnInsuranceToManager(patientId, note); break;
          case "masheke":
          case "profile":
            throw new Error(`"Send back to Manager Intervention" is not wired for the ${board} board`);
          default: unhandledBoard(board);
        }
        toast.success(`${patientName} sent back to Manager Intervention`);
      } else {
        switch (board) {
          case "insurance": await returnInsuranceToQueue(patientId, note); break;
          // Every ME stage whose panel gates on MN Attempts hands the rep a
          // fresh set of outreach attempts on the way back: the spent columns
          // are rolled into the notes and the counter is reset. The scope is
          // per-stage — a Chase return keeps Confirm Receipt's columns
          // (lib/masheke/attemptRollup).
          case "masheke":   await returnProposedToQueue(patientId, note, { resetScope: returnAttemptReset(stage) }); break;
          case "profile":   await returnIntakeToPipeline(patientId, note ?? "Returned by a manager"); break;
          default: unhandledBoard(board);
        }
        toast.success(`${patientName} sent back to the pipeline`);
      }
      setApproveOpen(false);
      setApproveNote("");
      setReturnOpen(false);
      setReturnNote("");
      setDownOpen(false);
      setDownNote("");
      onDone();
      // The patient just left this stage's queue — go back to the drill-down.
      goBack();
    } catch (e) {
      toast.error(
        action === "approveStuck"
          ? "Approve Stuck failed"
          : action === "returnToManager"
            ? "Send back to Manager Intervention failed"
            : "Send back to pipeline failed",
        { description: e instanceof Error ? e.message : String(e) },
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {/* One flex row, always. The buttons used to be bare siblings of the
          fragment, which is fine in a header that already flexes them but left
          them jammed edge-to-edge with no gap wherever a page dropped the bar
          straight into a card. */}
      <div className="flex flex-wrap items-center gap-2">
      {has("proposeStuck") &&
        (board === "insurance" ? (
          // One rung up from wherever the patient already sits — a patient
          // already flagged for a manager, or a proposal made BY a manager,
          // promotes to Final Decisions (lib/shared/stageActions).
          <ProposeStuckButton
            patientId={patientId}
            onDone={onDone}
            escalateTo={proposeStuckLevel(stage, origin, escalationLabel)}
          />
        ) : (
          <>
            <BarButton
              skin={skin}
              tone="propose"
              onClick={() => setProposeOpen(true)}
              icon={<AlertTriangle className="h-4 w-4" />}
              label="Propose Stuck"
            />
            {/* Same modal for both remaining boards — only the write differs,
                so the rep sees identical copy and behaviour either way. */}
            <ProposeStuckModal
              open={proposeOpen}
              onOpenChange={setProposeOpen}
              patientId={patientId}
              patientName={patientName}
              onSuccess={onDone}
              destination={board === "profile" ? proposeStuckLevel(stage, origin, escalationLabel) : "final"}
              savesFormFirst={Boolean(beforeProposeStuck)}
              onConfirm={
                board === "profile"
                  ? async (reason) => {
                      await beforeProposeStuck?.();
                      // Same ladder as Insurance/Medical Evaluation: a rep's
                      // proposal lands in Manager Intervention, a manager's
                      // proposal from there promotes to Final Decisions.
                      const res = await proposeIntakeStuck(
                        patientId, reason,
                        proposeStuckLevel(stage, origin, escalationLabel),
                        // Stamps the Call Log with which rung this came from —
                        // nothing for a processor, named for the two manager
                        // columns.
                        origin === "manager-intervention" ? "manager-intervention"
                        : origin === "final-decisions" ? "final-decisions"
                        : "processor",
                      );
                      if (!res.ok) {
                        throw new Error(res.errors.map((e) => `${e.label}: ${e.error}`).join(" · "));
                      }
                    }
                  : undefined
              }
            />
          </>
        ))}

      {has("approveStuck") && (
        <BarButton
          skin={skin}
          tone="approve"
          onClick={() => {
            setApproveNote("");
            setApproveOpen(true);
          }}
          disabled={busy !== null}
          icon={busy === "approveStuck"
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Flag className="h-4 w-4" />}
          label="Approve Stuck"
        />
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
        <BarButton
          skin={skin}
          tone="return"
          onClick={() => {
            setReturnNote("");
            setReturnOpen(true);
          }}
          disabled={busy !== null}
          icon={busy === "returnToQueue"
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <RotateCcw className="h-4 w-4" />}
          label="Send back to pipeline"
        />
      )}

      {/* Final Decisions → Manager Intervention (DVS only today). Katie fixes
          the run in Monday and hands the patient back to Janelle rather than
          out to a rep, who has no DVS actions. */}
      {has("returnToManager") && (
        <BarButton
          skin={skin}
          tone="demote"
          onClick={() => {
            setDownNote("");
            setDownOpen(true);
          }}
          disabled={busy !== null}
          icon={busy === "returnToManager"
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <CornerDownLeft className="h-4 w-4" />}
          label="Send back to manager"
        />
      )}
      </div>

      {/* Every dialog below portals to document.body, so it renders outside the
          row — and, on the intake page, outside `.pf-root` and its reset. */}
      <Dialog open={downOpen} onOpenChange={(o) => busy === null && setDownOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CornerDownLeft className="h-5 w-5 text-amber-500" />
              Send {patientName} back to Manager Intervention
            </DialogTitle>
            <DialogDescription>
              Drops the escalation from Final Decisions back to Manager Escalation Required, so the
              patient reappears in Manager Intervention. They do NOT go back to the rep.
            </DialogDescription>
          </DialogHeader>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Add a note (optional)
            </label>
            <textarea
              value={downNote}
              onChange={(e) => setDownNote(e.target.value)}
              rows={3}
              placeholder="e.g. Fixed the Medicaid ID on the board — re-run the DVS."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground mt-1">Stamped into the notes.</p>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setDownOpen(false)} disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              onClick={() => runDecision("returnToManager", downNote.trim() || undefined)}
              disabled={busy !== null}
              className="gap-2 bg-amber-500 hover:bg-amber-600 text-white"
            >
              {busy === "returnToManager" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CornerDownLeft className="h-4 w-4" />}
              Send back to manager
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              Send {patientName} back to the pipeline
            </DialogTitle>
            <DialogDescription>
              Clears the escalation and re-dates the patient to today, so they go back into
              the rep's queue and reappear in her sidebar and burndown count.
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
