/**
 * The Command Center profile — the far-right pane of the Communications Hub.
 *
 * The point of the whole hub: a rep reading a text or taking a call should see
 * who this patient IS, where they have got to, and what is true right now,
 * without leaving for a role page and coming back. Order, top to bottom
 * (Josh, 2026-09-01):
 *
 *   1. **The path** — which stages they have completed profiles in, in
 *      patient-tracker order, so their history reads at a glance.
 *   2. **The notes** — the main view, and now WRITABLE. The running case
 *      history is what tells a rep what to say next, and the hub is where they
 *      learn the things worth writing down.
 *   2b. **Every OTHER stage's notes**, collapsed, underneath (Josh, 2026-09-02:
 *      *"notes should be ALL notes from all stages ... but welcome call notes
 *      should be the main attraction, the others viewable on scroll"*). What a
 *      patient was told at intake explains what they are asking now, and the
 *      pane already had that text in hand — `stageNoteTrail` just stops
 *      throwing it away. Collapsed rather than inlined because five stages of
 *      running history would push the stage detail off the bottom of the pane;
 *      each header carries the newest line so the list is scannable shut.
 *   3. **Open in <board>** — right under the notes, where a rep looks after
 *      reading them.
 *   4. **The stage detail** — what a rep needs on a call at THIS stage, which
 *      differs completely per board. Rule: `lib/commsHub/stageDetail.ts`.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  ChevronRight,
  Loader2,
  Pause,
  Plus,
  Users,
  StickyNote,
  User,
} from "lucide-react";
import { toast } from "sonner";
import type { DossierItem, PathStep, PatientDossier, StageNotes, StepState } from "@/lib/commsHub/dossier";
import { stageNoteTrail, stagesCompleted } from "@/lib/commsHub/dossier";
import { buildStageDetail, hasStageDetail, type RenderedField } from "@/lib/commsHub/stageDetail";
import { appendNoteToRecord } from "@/lib/commsHub/dossierApi";
import { splitFaxAddress } from "@/lib/shared/faxAddress";
import { fmtPhone } from "@/lib/assignedPatients/format";
import { cn } from "@/lib/utils";

/** How each step of the chain reads. Colour follows the app's existing
 *  language: emerald = done, sky = the live one, amber = parked, and a ghost
 *  outline for a stage they simply haven't reached. */
const STEP_STYLE: Record<StepState, string> = {
  completed:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
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

/** Present a raw Monday value. Everything arrives as text; this only decides
 *  how it reads — a fax stored as `<digits>@rcfax.com` is a number to a rep. */
function fieldValue(f: RenderedField): string {
  if (f.kind === "phone") return fmtPhone(f.value) || f.value;
  if (f.kind === "fax") {
    const { local, suffixed } = splitFaxAddress(f.value);
    return suffixed ? fmtPhone(local) || local : f.value;
  }
  return f.value;
}

function DetailRow({ field }: { field: RenderedField }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="shrink-0 text-[11px] text-muted-foreground">{field.label}</span>
      <span
        className={cn(
          "min-w-0 break-words text-right text-xs",
          field.lead ? "font-semibold" : "font-medium text-foreground/90",
        )}
      >
        {fieldValue(field)}
      </span>
    </div>
  );
}

/** Add a line to the stage's notes without leaving the hub. */
function NoteComposer({
  active,
  onAppended,
  phone,
}: {
  active: DossierItem;
  onAppended: (next: string) => void;
  phone: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  // The stamp names the SUB-STAGE where the board has one — "Chase Clinicals"
  // rather than "Medical Evaluation" — because several roles share one notes
  // column and the label is what makes a line traceable (§9).
  const stage = active.stageAdvancerText || active.boardName;

  async function save() {
    const body = text.trim();
    if (!body || saving) return;
    setSaving(true);
    try {
      const next = await appendNoteToRecord({
        boardId: active.boardId,
        itemId: active.itemId,
        columnId: active.notesColId,
        columnType: active.notesColType,
        text: body,
        stage,
        phone,
      });
      onAppended(next);
      setText("");
      setOpen(false);
      toast.success(`Note added to ${stage}`);
    } catch (e) {
      // Includes the 2000-character refusal, which is the one error a rep must
      // actually read — the alternative is Monday silently eating the note.
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!active.notesColId) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mx-4 mb-3 inline-flex items-center gap-1.5 self-start rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
      >
        <Plus className="h-3.5 w-3.5" /> Add a note
      </button>
    );
  }

  return (
    <div className="mx-4 mb-3">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter for a new line — the convention of every
          // composer in this app.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape") setOpen(false);
        }}
        rows={3}
        placeholder={`Add to ${stage} notes…`}
        className="w-full resize-y rounded-md border border-border bg-background p-2 text-xs outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button
          onClick={() => void save()}
          disabled={!text.trim() || saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Add note
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <span className="ml-auto text-[10px] text-muted-foreground">Stamped with your initials</span>
      </div>
    </div>
  );
}

/** The last line of a notes body — the preview a collapsed stage shows.
 *  Notes columns are append-only with the newest line LAST (§9), so the tail is
 *  the interesting end; anything else would preview a note from months ago. */
function newestLine(notes: string): string {
  const lines = notes.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}

/** One earlier stage's running notes, shut by default. */
function StageNotesBlock({ stage }: { stage: StageNotes }) {
  const [open, setOpen] = useState(false);
  const preview = newestLine(stage.notes);
  return (
    <div className="rounded-md border border-border/70">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-1.5 px-2.5 py-2 text-left hover:bg-muted/40"
      >
        <ChevronRight
          className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="truncate text-[11px] font-semibold">{stage.boardName}</span>
            {/* Whether this is history or a parallel live record changes how a
                rep should read it, so it is on the header rather than hidden
                inside. */}
            {stage.isCompleted && <span className="shrink-0 text-[10px] text-emerald-600">Completed</span>}
            {stage.isStuck && <span className="shrink-0 text-[10px] text-amber-600">Stuck</span>}
          </span>
          {!open && preview && (
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{preview}</span>
          )}
        </span>
      </button>
      {open && (
        <pre className="mx-2.5 mb-2.5 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-2 font-sans text-[11px] leading-relaxed">
          {stage.notes.trim()}
        </pre>
      )}
    </div>
  );
}

export function PatientDossierPanel({
  dossier,
  people = [],
  selected = 0,
  onSelectPerson,
  loading,
  error,
  phone,
  idleHint = "Open a conversation, call or voicemail to see the patient's Command Center profile.",
}: {
  dossier: PatientDossier | null;
  /** Everyone who shares this number — usually one. */
  people?: PatientDossier[];
  selected?: number;
  onSelectPerson?: (index: number) => void;
  loading: boolean;
  error: string | null;
  phone: string | null;
  idleHint?: string;
}) {
  const notesRef = useRef<HTMLPreElement>(null);
  /** A note added here shows immediately; the cached trail is patched too. */
  const [notesOverride, setNotesOverride] = useState<string | null>(null);
  const activeId = dossier?.active?.itemId ?? "";

  // Drop the local copy when the pane moves to another patient, or it would
  // print the previous one's notes under this one's name.
  useEffect(() => setNotesOverride(null), [activeId]);

  // Notes columns are append-only with the newest line LAST (§9), so the
  // useful end of a long history is the bottom.
  const notes = notesOverride ?? dossier?.active?.notes ?? "";
  useEffect(() => {
    const el = notesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeId, notes]);

  if (!phone) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <User className="h-7 w-7 text-muted-foreground/50" />
        <p className="max-w-[26ch] text-xs text-muted-foreground">{idleHint}</p>
      </div>
    );
  }

  // ⚠️ `loading` alone, NOT `loading && !dossier`. Keeping the previous
  // patient's profile up while the next one loads is what Josh reported on
  // 2026-09-02, and it is not just stale UI: the composer below writes to
  // `active.itemId` and the page's `threadPatient` carries `mondayItemId` onto
  // an outbound text, so the window was long enough to file a note or a text
  // against the wrong patient. `useDossier` clears the dossier to match.
  if (loading) {
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
        <span className="break-words text-xs text-muted-foreground">{error}</span>
      </div>
    );
  }

  if (!dossier) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <User className="h-7 w-7 text-muted-foreground/50" />
        <p className="text-sm font-medium">{fmtPhone(phone)}</p>
        {/* Not an error: texting a number that is on no board is supported. */}
        <p className="max-w-[28ch] text-xs text-muted-foreground">
          This number isn't on any pipeline board. You can still text and call it.
        </p>
      </div>
    );
  }

  const { active, path } = dossier;
  const done = stagesCompleted(path);
  const detail = active ? buildStageDetail(active.boardId, active.cols) : [];
  // Already in hand — every board's notes column rides along with its record.
  const otherNotes = stageNoteTrail(dossier);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* ── Who ─────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <p className="truncate text-sm font-semibold">{dossier.name || fmtPhone(dossier.phone)}</p>
        <p className="text-[11px] text-muted-foreground">
          {fmtPhone(dossier.phone || phone)}
          {active ? ` · ${active.boardName}` : " · no live stage"}
        </p>

        {/* ⚠️ A shared line, and the rep has to be told BEFORE they read the
            notes or type one. 18 of our 3,140 numbers are shared by genuinely
            different patients — households like the Hartleys, and several
            pairs with different surnames. Everything below follows this
            selection, including the note composer and the outbound text's
            patient attribution. */}
        {people.length > 1 && (
          <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950/60">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-900 dark:text-amber-100">
              <Users className="h-3.5 w-3.5 shrink-0" />
              {people.length} patients share this number
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {people.map((p, i) => (
                <button
                  key={`${p.active?.itemId ?? p.name}-${i}`}
                  onClick={() => onSelectPerson?.(i)}
                  aria-pressed={i === selected}
                  title={p.active ? `Working on ${p.active.boardName}` : "No live stage"}
                  className={cn(
                    "max-w-full truncate rounded px-2 py-1 text-[11px] font-medium transition-colors",
                    i === selected
                      ? "bg-amber-500 text-white"
                      : "bg-white text-amber-900 hover:bg-amber-100 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900",
                  )}
                >
                  {p.name || fmtPhone(p.phone)}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-amber-800 dark:text-amber-200">
              {/* Say what the choice CHANGES, or a rep has no reason to make it. */}
              Notes and outbound texts are filed against the patient selected here.
            </p>
          </div>
        )}
      </div>

      {/* ── 1. The path ─────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Profile path
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground">
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
            Also on {dossier.alsoOn.map((i) => i.boardName).join(", ")}
          </p>
        )}
      </div>

      {/* ── 2. Notes — the main view, and writable ──────────── */}
      <div className="flex flex-col border-b border-border">
        <div className="flex shrink-0 items-center gap-1.5 px-4 pb-1.5 pt-3">
          <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {active ? `${active.stageAdvancerText || active.boardName} notes` : "Notes"}
          </span>
        </div>
        <pre
          ref={notesRef}
          className="mx-4 mb-2 max-h-80 min-h-[6rem] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-2.5 font-sans text-[11px] leading-relaxed"
        >
          {notes.trim() || (active ? "No notes on this stage yet." : "No live stage, so no working notes.")}
        </pre>
        {active && <NoteComposer active={active} phone={phone} onAppended={setNotesOverride} />}

        {/* 2b. Every OTHER stage's notes. Shut by default with the newest line
            on the header, so the whole history is one click away without
            pushing the stage detail off the pane. */}
        {otherNotes.length > 0 && (
          <div className="mb-3 space-y-1.5 px-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Notes from other stages ({otherNotes.length})
            </p>
            {otherNotes.map((stage) => (
              <StageNotesBlock key={`${stage.boardId}:${stage.itemId}`} stage={stage} />
            ))}
          </div>
        )}
      </div>

      {/* ── 3. Open in the stage ────────────────────────────── */}
      {active?.route && (
        <div className="border-b border-border px-4 py-3">
          <Link
            to={`${active.route}?patientId=${encodeURIComponent(active.itemId)}&from=system-mgmt`}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            Open on {active.boardName} <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {/* ── 4. What matters at THIS stage ───────────────────── */}
      {active && (
        <div className="px-4 py-3">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {active.boardName} detail
            </span>
            <span className="text-[10px] text-muted-foreground">
              {[active.daysSinceStage, active.nextActionDate && `next ${active.nextActionDate}`]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>

          {detail.map((section) => (
            <section key={section.title} className="mb-2.5 rounded-md border border-border/70 px-2.5 py-2">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                {section.title}
              </p>
              {section.fields.map((f) => (
                <DetailRow key={f.col} field={f} />
              ))}
            </section>
          ))}

          {!detail.length && (
            <p className="text-xs text-muted-foreground">
              {hasStageDetail(active.boardId)
                ? "Nothing filled in on this stage yet."
                : /* DTC Intake and Secondary Claims are not stages a rep calls
                     from, so no detail is mapped for them (stageDetail.ts). */
                  `No call detail is mapped for ${active.boardName}.`}
            </p>
          )}

          {active.groupTitle && (
            <p className="mt-1 text-[10px] text-muted-foreground">In group: {active.groupTitle}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default PatientDossierPanel;
