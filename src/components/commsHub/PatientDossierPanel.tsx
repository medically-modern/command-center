/**
 * The Command Center profile widget — the far-right third of the hub.
 *
 * The point of the whole hub: a rep reading a text should see who this patient
 * IS and where they have got to, without leaving for a role page and coming
 * back. So this pane answers, in this order (Josh, 2026-09-01):
 *
 *   1. **The path** — which stages they have completed profiles in, drawn in
 *      patient-tracker order, so their history reads at a glance.
 *   2. **The notes** — deliberately the FIRST section under the path, because
 *      the running case history is what tells a rep what to say next. Every
 *      other fact on this pane is a lookup; the notes are the story.
 *   3. Everything else — stage, next action, the record's own numbers.
 *
 * The chain is `lib/commsHub/pipelineOrder.ts`; the state of each step is
 * `lib/commsHub/dossier.ts`. This file is only how it looks.
 */
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowUpRight, Check, Loader2, Pause, StickyNote, User } from "lucide-react";
import type { PathStep, PatientDossier, StepState } from "@/lib/commsHub/dossier";
import { stagesCompleted } from "@/lib/commsHub/dossier";
import { fmtPhone } from "@/lib/assignedPatients/format";
import { cn } from "@/lib/utils";

/** How each step of the chain reads. Colour follows the app's existing
 *  language: emerald = done, sky = the live one, amber = parked, and a ghost
 *  outline for a stage they simply haven't reached. */
const STEP_STYLE: Record<StepState, string> = {
  completed: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
  active: "border-sky-400 bg-sky-500 text-white shadow-sm dark:border-sky-500 dark:bg-sky-600",
  parked: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  notReached: "border-dashed border-border bg-transparent text-muted-foreground",
};

const STEP_HINT: Record<StepState, string> = {
  completed: "Completed",
  active: "Working here now",
  parked: "On the board, not being worked",
  notReached: "Not reached yet",
};

/** Where a step chip navigates. A completed record opens in review mode, the
 *  same URL Search's completion badges build (§7) — banner on, advance off, so
 *  reading history can never re-advance a finished patient. */
function stepHref(step: PathStep): string | null {
  const { item, board, state } = step;
  if (!item || !board.route) return null;
  const params = new URLSearchParams({ patientId: item.itemId, from: "system-mgmt" });
  if (state === "completed") params.set("completedStage", String(board.boardId));
  return `${board.route}?${params.toString()}`;
}

function StepChip({ step }: { step: PathStep }) {
  const href = stepHref(step);
  const body = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium leading-none transition-colors",
        STEP_STYLE[step.state],
        href && "hover:brightness-95",
      )}
      title={`${step.board.label} — ${STEP_HINT[step.state]}`}
    >
      {step.state === "completed" && <Check className="h-3 w-3 shrink-0" />}
      {step.state === "parked" && <Pause className="h-3 w-3 shrink-0" />}
      {step.board.short}
    </span>
  );
  return href ? (
    <Link to={href} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  ) : (
    body
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs text-right font-medium truncate">{value}</span>
    </div>
  );
}

export function PatientDossierPanel({
  dossier,
  loading,
  error,
  phone,
  /** Shown while nothing is selected — the pane should say what it is for. */
  idleHint = "Open a conversation, call or voicemail to see the patient's Command Center profile.",
}: {
  dossier: PatientDossier | null;
  loading: boolean;
  error: string | null;
  phone: string | null;
  idleHint?: string;
}) {
  const notesRef = useRef<HTMLPreElement>(null);

  // Notes columns are append-only with the newest line LAST (§9), so the
  // useful end of a long history is the bottom. Land there rather than making
  // a rep scroll past months of it.
  useEffect(() => {
    const el = notesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [dossier?.active?.itemId, dossier?.active?.notes]);

  if (!phone) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <User className="h-7 w-7 text-muted-foreground/50" />
        <p className="max-w-[24ch] text-xs text-muted-foreground">{idleHint}</p>
      </div>
    );
  }

  if (loading && !dossier) {
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
        <span className="text-xs text-muted-foreground break-words">{error}</span>
      </div>
    );
  }

  if (!dossier) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <User className="h-7 w-7 text-muted-foreground/50" />
        <p className="text-sm font-medium">{fmtPhone(phone)}</p>
        {/* Not an error: texting a number that is on no board is a supported
            thing to do (§ AssignedPatientsPage header). */}
        <p className="max-w-[26ch] text-xs text-muted-foreground">
          This number isn't on any pipeline board. You can still text and call it.
        </p>
      </div>
    );
  }

  const { active, path } = dossier;
  const done = stagesCompleted(path);

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-y-auto">
      {/* ── Who ─────────────────────────────────────────────── */}
      <div className="border-b border-border px-4 py-3 shrink-0">
        <p className="text-sm font-semibold truncate">{dossier.name || fmtPhone(dossier.phone)}</p>
        <p className="text-[11px] text-muted-foreground">
          {fmtPhone(dossier.phone || phone)}
          {active ? ` · ${active.boardName}` : " · no live stage"}
        </p>
      </div>

      {/* ── 1. The path, at the top ─────────────────────────── */}
      <div className="border-b border-border px-4 py-3 shrink-0">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Profile path
          </span>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {done} of {path.length} complete
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {path.map((s) => (
            <StepChip key={s.board.boardId} step={s} />
          ))}
        </div>
        {dossier.alsoOn.length > 0 && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            {/* Not a stage — a parallel reconciliation board, so it is named
                rather than drawn into the chain. */}
            Also on {dossier.alsoOn.map((i) => i.boardName).join(", ")}
          </p>
        )}
      </div>

      {/* ── 2. Notes FIRST — the running case history ────────── */}
      <div className="flex min-h-0 flex-col border-b border-border">
        <div className="flex items-center gap-1.5 px-4 pt-3 pb-1.5 shrink-0">
          <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {active ? `${active.boardName} notes` : "Notes"}
          </span>
        </div>
        <pre
          ref={notesRef}
          className="mx-4 mb-3 max-h-72 min-h-[5rem] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-2.5 font-sans text-[11px] leading-relaxed"
        >
          {active?.notes?.trim() ||
            (active ? "No notes on this stage yet." : "No live stage, so no working notes.")}
        </pre>
      </div>

      {/* ── 3. Everything else ──────────────────────────────── */}
      {active && (
        <div className="px-4 py-3">
          <Field label="Stage" value={active.stageAdvancerText || active.groupTitle} />
          <Field label="Group" value={active.groupTitle} />
          <Field label="Days in stage" value={active.daysSinceStage} />
          <Field label="Next action" value={active.nextActionDate} />
          {active.route && (
            <Link
              to={`${active.route}?patientId=${encodeURIComponent(active.itemId)}&from=system-mgmt`}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              Open in {active.boardName} <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

export default PatientDossierPanel;
