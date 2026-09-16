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
import {
  PILL_GRID_TEMPLATE, PILL_SLOTS, pillTone, shortLabel,
  type PillSlots, type PillTone,
} from "@/lib/careCoordinator/pills";
import { cn } from "@/lib/utils";

const PILL_TONE: Record<PillTone, string> = {
  neutral: "border-border bg-background text-foreground",
  green: "border-[color:var(--mm-green)] bg-[color:var(--mm-green-12)] text-foreground",
  yellow: "border-amber-400 bg-amber-100 text-amber-950 dark:bg-amber-950/50 dark:text-amber-100",
  red: "border-rose-300 bg-rose-100 text-rose-950 dark:bg-rose-950/50 dark:text-rose-100",
};

/** A pill. Blank values never reach here — `PillRow` renders an em dash instead. */
export function Pill({ children, title, tone = "neutral" }: { children: ReactNode; title?: string; tone?: PillTone }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-block max-w-full truncate rounded-full border px-[7px] py-0.5 text-[11px] font-medium leading-tight",
        PILL_TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

/**
 * The pill row — one labelled column per field, in a fixed order.
 *
 * ⚠️ **EVERY SLOT RENDERS, BLANK OR NOT.** That is the whole point: the old row
 * dropped blanks and flex-wrapped what was left, so the pills slid left and no
 * two cards lined up. A slot with no value is a faint em dash under a dimmed
 * caption, which keeps the columns registered card to card AND tells the
 * coordinator the field is empty rather than missing.
 *
 * ⚠️ Welcome Call cards pass no `status`, so column 8 is genuinely empty there
 * — no pill and no "Form" caption. A Welcome Call patient has no web form, so
 * a dash would imply one they never filled in.
 */
export function PillRow({ slots }: { slots: PillSlots }) {
  return (
    <div className="grid items-start gap-x-1" style={{ gridTemplateColumns: PILL_GRID_TEMPLATE }}>
      {PILL_SLOTS.map((slot) => {
        const value = (slots[slot.key] ?? "").trim();
        // A slot the card does not carry at all is left out entirely; a slot it
        // carries but has no value for shows the dash. `undefined` vs `""`.
        if (slots[slot.key] === undefined && slot.key === "status") return null;
        return (
          <div key={slot.key} className="flex min-w-0 flex-col items-start gap-0.5" style={{ gridColumnStart: slot.column }}>
            {value
              ? <Pill title={`${slot.field}: ${value}`} tone={pillTone(slot.key, value)}>{shortLabel(value)}</Pill>
              : <span className="px-2 py-[3px] text-[11px] leading-snug text-muted-foreground/50">—</span>}
            <span className={cn(
              "max-w-full truncate pl-2 text-[9.5px] leading-none uppercase tracking-wide text-muted-foreground",
              !value && "opacity-45",
            )}>{slot.caption}</span>
          </div>
        );
      })}
    </div>
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
  /** One entry per labelled column; a blank string renders the em dash. */
  pills: PillSlots;
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

      {/* ⚠️ The counters take a FIXED width so the pill grid is the same width
          on every card. Left to size themselves, a two-digit attempt count
          would shift every column on that one row. */}
      <div className="mt-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <PillRow slots={pills} />
        </div>
        <span className="flex w-[4.75rem] shrink-0 items-center justify-end gap-3 pt-0.5 text-xs text-muted-foreground tabular-nums">
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
