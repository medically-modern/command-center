/**
 * One patient on the Care Coordinator dashboard.
 *
 * A shell with slots — name, a right-hand "when", a sub line, a chip row, a
 * body, and a footer — plus the two things every card shares: the stage's
 * Call · Text · Calls trio (`PatientContact`, the same buttons every stage
 * header carries, so texting and call history behave identically here) and an
 * on-demand Notes drawer.
 *
 * ⚠️ Notes are fetched when OPENED, one item at a time (`fetchItemNotes`). The
 * column reads deliberately carry no notes column — see mondayApi.ts.
 *
 * Nothing on the card writes to Monday. "Open" hands the patient to the stage
 * page, whose own write path does the work.
 */
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp, ExternalLink, NotebookPen } from "lucide-react";

import { PatientContact } from "@/components/masheke/mmKit";
import { fetchItemNotes } from "@/lib/careCoordinator/mondayApi";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "info" | "good" | "warn" | "bad" | "muted";

const CHIP_TONE: Record<Tone, string> = {
  neutral: "border-border bg-background text-foreground",
  info: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100",
  good: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100",
  warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
  bad: "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100",
  muted: "border-border bg-muted text-muted-foreground",
};

export function Chip({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight whitespace-nowrap", CHIP_TONE[tone])}
    >
      {children}
    </span>
  );
}

/** The card's right-hand "when" — a time, a wait, an overdue count. */
export function When({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  const colour: Record<Tone, string> = {
    neutral: "text-foreground",
    info: "text-sky-700 dark:text-sky-300",
    good: "text-emerald-700 dark:text-emerald-300",
    warn: "text-amber-700 dark:text-amber-300",
    bad: "text-rose-700 dark:text-rose-300",
    muted: "text-muted-foreground",
  };
  return <span className={cn("shrink-0 text-sm font-semibold tabular-nums", colour[tone])}>{children}</span>;
}

/**
 * The notes drawer's state lives in the card so the toggle can sit on the
 * footer row while the panel renders FULL WIDTH beneath it — inline in the row
 * it squeezed against the Open link and, on the narrower columns, drew under it.
 */
function useNotesDrawer(itemId: string, columnId: string) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || notes !== null || loading) return;
    setLoading(true);
    setError(null);
    try {
      setNotes(await fetchItemNotes(itemId, columnId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  return { open, notes, loading, error, toggle };
}

function NotesToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
    >
      <NotebookPen className="h-3.5 w-3.5" aria-hidden />
      {open ? "Hide notes" : "See notes"}
      {open ? <ChevronUp className="h-3 w-3" aria-hidden /> : <ChevronDown className="h-3 w-3" aria-hidden />}
    </button>
  );
}

function NotesPanel({ label, notes, loading, error }: { label: string; notes: string | null; loading: boolean; error: string | null }) {
  return (
    <div className="rounded-md border bg-muted/40 p-2.5 text-xs">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      {loading && <p className="text-muted-foreground">Loading…</p>}
      {error && <p className="text-rose-700 dark:text-rose-300">Couldn't load notes: {error}</p>}
      {!loading && !error && notes !== null && (
        notes.trim()
          ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans leading-relaxed">{notes}</pre>
          : <p className="text-muted-foreground">No notes yet.</p>
      )}
    </div>
  );
}

export function PatientCard({
  name, when, sub, badge, chips, body, phone, notes, openHref, openLabel, tone = "neutral", extraActions,
}: {
  name: string;
  when?: ReactNode;
  sub?: ReactNode;
  /** The Profile Status badge, or nothing. */
  badge?: ReactNode;
  chips?: ReactNode;
  body?: ReactNode;
  phone: string;
  /** Which notes column this patient's running history lives in. */
  notes: { itemId: string; columnId: string; label: string };
  /** Deep link into the stage page that WORKS this patient. */
  openHref: string;
  openLabel: string;
  /** Left-edge accent. */
  tone?: Tone;
  extraActions?: ReactNode;
}) {
  const edge: Record<Tone, string> = {
    neutral: "border-l-border",
    info: "border-l-sky-400",
    good: "border-l-emerald-400",
    warn: "border-l-amber-400",
    bad: "border-l-rose-400",
    muted: "border-l-border",
  };
  const drawer = useNotesDrawer(notes.itemId, notes.columnId);
  return (
    <article className={cn("rounded-xl border border-l-4 bg-card p-3 shadow-sm", edge[tone])}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-[15px] font-semibold leading-tight">{name}</h4>
            {badge}
          </div>
          {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
        </div>
        {when}
      </div>

      {chips && <div className="mt-2 flex flex-wrap gap-1.5">{chips}</div>}
      {body && <div className="mt-2 text-xs leading-relaxed">{body}</div>}

      {/* Two rows on purpose: the Call · Text · Calls trio (plus any extra
          action) on the first, notes and Open on the second. One flex row let
          the two collide in the narrower columns. */}
      <div className="mt-3 space-y-2 border-t pt-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <PatientContact phone={phone} />
          {extraActions}
        </div>
        <div className="flex items-center justify-between gap-2">
          <NotesToggle open={drawer.open} onToggle={() => void drawer.toggle()} />
          <Link
            to={openHref}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
            title={openLabel}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Open
          </Link>
        </div>
        {drawer.open && <NotesPanel label={notes.label} notes={drawer.notes} loading={drawer.loading} error={drawer.error} />}
      </div>
    </article>
  );
}
