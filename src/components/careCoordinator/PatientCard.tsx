/**
 * One patient on the Care Coordinator dashboard — Brandon's 2026-09-14 box.
 *
 *   ┃ Name                                          [when]
 *   ┃ Doctor: … · Clinic: …
 *   ┃ [pill] [pill] [pill]                     📞 2   💬 1
 *   ┃ ──────────────────────────────────────────────────
 *   ┃ Call · Text · Call Log      notes · Open   [Booking Link]
 *
 * The left edge is ONE of two colours: Medically Modern green once a call
 * has been attempted, gray until then. No status badge, no sub line beyond
 * Doctor / Clinic, every pill neutral gray and hidden when blank. The next
 * scheduled call's box is shaded darker.
 *
 * Kept from the previous card, though not in Brandon's list: "See notes" and
 * "Open". Open is how the coordinator reaches the stage page where the
 * attempt is LOGGED (the dashboard itself still writes nothing), and the
 * notes drawer is the running case history a caller reads before dialling.
 * Both are quiet text links so the row stays uncrowded.
 *
 * ⚠️ Notes are fetched when OPENED, one item at a time (`fetchItemNotes`). The
 * column reads deliberately carry no notes column — see mondayApi.ts.
 */
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CalendarPlus, ChevronDown, ChevronUp, ExternalLink, MessageSquare, NotebookPen, Phone } from "lucide-react";

import { PatientContact } from "@/components/masheke/mmKit";
import { fetchItemNotes } from "@/lib/careCoordinator/mondayApi";
import { cn } from "@/lib/utils";

/** A gray pill. Blank values never reach here — the caller filters them. */
export function Pill({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium leading-tight text-foreground whitespace-nowrap"
    >
      {children}
    </span>
  );
}

/**
 * The notes drawer's state lives in the card so the toggle can sit on the
 * footer row while the panel renders FULL WIDTH beneath it.
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
  name, attempted, nextUp = false, doctor, clinic, when, pills, attempts, texts,
  phone, notes, openHref, openLabel, onBookingLink,
}: {
  name: string;
  /** Has anybody rung them yet? Green edge when true, gray when false. */
  attempted: boolean;
  /** The scheduled call up next — the one box shaded darker. */
  nextUp?: boolean;
  doctor?: string;
  clinic?: string;
  /** The right-hand time or "N days". */
  when: ReactNode;
  /** Already filtered of blanks. */
  pills: string[];
  attempts: number;
  texts: number;
  phone: string;
  /** Which notes column this patient's running history lives in. */
  notes: { itemId: string; columnId: string; label: string };
  /** Deep link into the stage page that WORKS this patient. */
  openHref: string;
  openLabel: string;
  onBookingLink: () => void;
}) {
  const drawer = useNotesDrawer(notes.itemId, notes.columnId);
  const doctorLine = [doctor?.trim() && `Doctor: ${doctor.trim()}`, clinic?.trim() && `Clinic: ${clinic.trim()}`]
    .filter(Boolean).join(" · ");
  return (
    <article
      className={cn(
        "rounded-xl border border-l-4 p-3 shadow-sm",
        attempted ? "border-l-[color:var(--mm-green)]" : "border-l-slate-300 dark:border-l-slate-600",
        nextUp ? "bg-slate-200/80 dark:bg-slate-800/70" : "bg-card",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-[15px] font-semibold leading-tight">{name}</h4>
          {doctorLine && <div className="mt-0.5 text-xs text-muted-foreground">{doctorLine}</div>}
        </div>
        {when}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {pills.map((p, i) => <Pill key={`${i}:${p}`}>{p}</Pill>)}
        <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums">
          <span className="inline-flex items-center gap-1" title="Call attempts">
            <Phone className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">Call attempts</span>
            {attempts}
          </span>
          <span className="inline-flex items-center gap-1" title="Automated texts">
            <MessageSquare className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">Texts</span>
            {texts}
          </span>
        </span>
      </div>

      <div className="mt-3 space-y-2 border-t pt-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <PatientContact phone={phone} textTone="green" callHistoryLabel="Call Log" callHistoryIcon="list" />
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void drawer.toggle()}
              aria-expanded={drawer.open}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <NotebookPen className="h-3.5 w-3.5" aria-hidden />
              {drawer.open ? "Hide notes" : "See notes"}
              {drawer.open ? <ChevronUp className="h-3 w-3" aria-hidden /> : <ChevronDown className="h-3 w-3" aria-hidden />}
            </button>
            <Link to={openHref} title={openLabel} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              Open
            </Link>
            <button
              type="button"
              onClick={onBookingLink}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700"
            >
              <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
              Booking Link
            </button>
          </span>
        </div>
        {drawer.open && <NotesPanel label={notes.label} notes={drawer.notes} loading={drawer.loading} error={drawer.error} />}
      </div>
    </article>
  );
}
