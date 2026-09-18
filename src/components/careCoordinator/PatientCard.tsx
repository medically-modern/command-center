/**
 * One patient on the Care Coordinator dashboard — Brandon's 2026-09-14 box,
 * reworked to his 2026-09-17 notes.
 *
 *   ┃ Name (a link)                                 [when]
 *   ┃ Doctor: … · Clinic: …
 *   ┃ [pill] [pill] [pill]                     📞 2   💬 1
 *   ┃ ──────────────────────────────────────────────────
 *   ┃ Call · Text · Call Log (3)          [Booking Link]
 *   ┃ Notes: the newest line, click to expand
 *
 * The left edge is ONE of two colours: Medically Modern green once a call
 * has been attempted, gray until then. No status badge, no sub line beyond
 * Doctor / Clinic, and the next scheduled call's box is shaded darker.
 *
 * ## What 2026-09-17 changed, and why each one is not just a tidy-up
 *
 * **The NAME is the way in.** "See notes" and "Open" are both gone (Brandon:
 * *"Click patient name in the unscheduled/scheduled boxes should take to
 * profile too … then back button takes you directly back to the same page you
 * came from"*, and *"Let's get rid of open button too, that will be done by
 * clicking patient name now (so now getting rid of see notes and open)"*).
 * Two quiet text links plus a name that looked inert is three things competing
 * to be the obvious click; the name is what a coordinator reaches for anyway.
 *
 * **Notes are OPEN, clamped to one line.** They were behind a toggle because
 * they cost a Monday read each; `useCardNotes` batches the rendered cards into
 * one request, so the cost of showing them is no longer per card. One line is
 * the compromise that keeps a column of cards scannable — the running history
 * on these patients runs to thousands of characters.
 *
 * **The two counter icons go green once we have actually got through**
 * (Brandon: *"let's have the text and phone icon turn a shade of green if
 * they've responded to a text or picked up (and add a legend for that)"*).
 * ⚠️ The ICONS, not the Call and Text buttons: those are already teal and light
 * green, so recolouring them would have meant a green that reads as "reached"
 * sitting next to a green that reads as "this is a button". These two glyphs
 * had no state of their own and sit directly beside the counts they qualify.
 */
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarPlus, ChevronDown, ChevronUp, MessageSquare, Phone } from "lucide-react";

import { PatientContact } from "@/components/masheke/mmKit";
import {
  PILL_GRID_TEMPLATE, PILL_SLOTS, pillTone, shortLabel,
  type PillSlotKey, type PillSlots, type PillTone, type PillVariant,
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
 * ⚠️ The two columns carry DIFFERENT fifth slots — Form on intake, Referral
 * source on welcome (Brandon, 2026-09-17) — so the variant picks the slot list
 * and the colour rule together. Both live in `pills.ts`; nothing here decides
 * either.
 */
/** A pressable pill, per slot. See `PatientCard`'s `pillActions`. */
export type PillActions = Partial<Record<PillSlotKey, { onClick: () => void; title: string }>>;

export function PillRow({ slots, variant, actions }: {
  slots: PillSlots; variant: PillVariant; actions?: PillActions;
}) {
  return (
    <div className="grid items-start gap-x-1" style={{ gridTemplateColumns: PILL_GRID_TEMPLATE }}>
      {PILL_SLOTS[variant].map((slot) => {
        const raw = slots[slot.key];
        // A slot this card does not carry at all is left out entirely; a slot
        // it carries but has no value for shows the dash. `undefined` vs `""`.
        if (raw === undefined) return null;
        const value = raw.trim();
        return (
          <div key={slot.key} className="flex min-w-0 flex-col items-start gap-0.5" style={{ gridColumnStart: slot.column }}>
            {value
              ? (() => {
                  const action = actions?.[slot.key];
                  const pill = (
                    <Pill title={action ? action.title : `${slot.field}: ${value}`} tone={pillTone(slot.key, value, variant)}>
                      {shortLabel(value)}
                    </Pill>
                  );
                  // ⚠️ The button wraps the pill rather than the pill becoming
                  // one: `Pill` is shared with the Welcome Call column, which
                  // has no actions, and a <button> there would announce itself
                  // to a screen reader as pressable when nothing happens.
                  return action
                    ? (
                      <button
                        type="button"
                        onClick={action.onClick}
                        title={action.title}
                        className="max-w-full rounded-full underline decoration-dotted underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {pill}
                      </button>
                    )
                    : pill;
                })()
              : <span className="px-2 py-[3px] text-[11px] leading-snug text-muted-foreground/50">—</span>}
            {/* `data-pill-caption` marks the caption row as a structure, not
                a style: the card carries other small-caps labels (the notes
                line's), so "every uppercase span" is not the pill row. */}
            <span
              data-pill-caption
              className={cn(
                "max-w-full truncate pl-2 text-[9.5px] leading-none uppercase tracking-wide text-muted-foreground",
                !value && "opacity-45",
              )}
            >{slot.caption}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The running case history, on the card.
 *
 * ⚠️ **ONE LINE UNTIL ASKED** (Brandon, 2026-09-17: *"default that profile send
 * off notes is open — but if it's more than 1 line, user has to click to expand
 * it"*). These columns hold a stamped append-only log that runs to thousands of
 * characters on a worked patient (§10 — they were capped at 2,000 until the
 * September cutover and some sat at the cap), so "open" cannot mean "all of
 * it": a dozen cards each showing a full history is a column nobody can scan.
 *
 * ⚠️ The NEWEST line is the one shown, not the first. The log appends, so the
 * top of the column is the oldest thing that ever happened to this patient and
 * the bottom is what somebody found out on the last call — which is the line
 * that changes what this call opens with.
 */
function NotesLine({ label, notes }: { label: string; notes: string | undefined }) {
  const [open, setOpen] = useState(false);
  // `undefined` = the batch hasn't answered yet. Deliberately silent rather
  // than a spinner per card: a dozen spinners on first paint is worse than the
  // line arriving a moment later.
  if (notes === undefined) return null;

  const body = notes.trim();
  if (!body) {
    return <p className="mt-2 border-t pt-2 text-xs italic text-muted-foreground/70">{label}: none yet</p>;
  }
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const newest = lines[lines.length - 1] ?? body;
  const expandable = lines.length > 1 || newest.length > 110;

  return (
    <div className="mt-2 border-t pt-2">
      <div className="flex items-start gap-1.5">
        <span className="shrink-0 text-[10px] font-semibold uppercase leading-[18px] tracking-wide text-muted-foreground">
          {label}
        </span>
        {open ? (
          <pre className="max-h-64 flex-1 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed">{body}</pre>
        ) : (
          <p className="min-w-0 flex-1 truncate text-xs leading-[18px] text-muted-foreground" title={newest}>{newest}</p>
        )}
        {expandable && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="shrink-0 rounded px-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
            <span className="sr-only">{open ? "Collapse notes" : "Expand notes"}</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function PatientCard({
  name, attempted, nextUp = false, doctor, clinic, when, pills, pillActions, variant, attempts, texts,
  phone, notes, notesLabel, openHref, openLabel, onBookingLink, reached, callCount, blocker,
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
  /** Slots whose pill is a BUTTON rather than a label. Today that is the
   *  Insurance pill on a patient who uploaded a card photo — it opens the
   *  photo. A slot with an action but no VALUE stays the em dash: there is
   *  nothing to press on a pill that says nothing. */
  pillActions?: PillActions;
  /** Which column this card is in — picks the slot list and the pill colours. */
  variant: PillVariant;
  attempts: number;
  texts: number;
  phone: string;
  /** This patient's running history, already fetched in the column's batch.
   *  `undefined` while the batch is still out. */
  notes: string | undefined;
  notesLabel: string;
  /** Deep link into the stage page that WORKS this patient. */
  openHref: string;
  openLabel: string;
  onBookingLink: () => void;
  /**
   * Have we actually got through to this patient in the last week?
   *
   * ⚠️ Undefined when the shared RingCentral read hasn't landed (or can't be
   * made at all in a build with no gateway). Both glyphs then stay neutral,
   * which is what they looked like before this existed — a missing signal must
   * never read as "we have not reached them", because that is a claim.
   */
  reached?: { byText: boolean; byCall: boolean };
  /** Calls with this number in the same window, or undefined when we can't
   *  stand behind a number (see `CallHistoryButton`'s own `count` note). */
  callCount?: number;
  /**
   * The advance-unlock condition this patient fails, from
   * `workflow.intakeBlocker` — Review Profile cards only.
   *
   * ⚠️ Blank prints NOTHING, and must never print "ready to advance": this
   * dashboard's read is narrower than the profile page's checklist and can
   * miss a coverage-path condition (see `intakeBlocker`). An absent line means
   * "nothing we can see", which is a different claim.
   */
  blocker?: string;
}) {
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
          {/* The name IS the link (Brandon, 2026-09-17). Underlined on hover so
              it advertises itself; `title` carries the destination, because the
              two columns lead to different stage pages. */}
          <h4 className="truncate text-[15px] font-semibold leading-tight">
            <Link to={openHref} title={openLabel} className="rounded hover:underline focus-visible:underline focus-visible:outline-none">
              {name}
            </Link>
          </h4>
          {doctorLine && <div className="mt-0.5 text-xs text-muted-foreground">{doctorLine}</div>}
        </div>
        {when}
      </div>

      {/* ⚠️ Amber, not rose: every one of these is an ORDINARY next step a rep
          takes on the profile page (re-run the check, ring about the plan,
          pick a path), not evidence anything is wrong — §5.17's severity rule.
          Rose here would out-rank the escalations that are somebody's problem. */}
      {blocker?.trim() && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11.5px] leading-snug text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0">{blocker.trim()}</span>
        </div>
      )}

      {/* ⚠️ The counters take a FIXED width so the pill grid is the same width
          on every card. Left to size themselves, a two-digit attempt count
          would shift every column on that one row. */}
      <div className="mt-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <PillRow slots={pills} variant={variant} actions={pillActions} />
        </div>
        <span className="flex w-[4.75rem] shrink-0 items-center justify-end gap-3 pt-0.5 text-xs tabular-nums">
          <span
            className={cn("inline-flex items-center gap-1", reached?.byCall ? "font-semibold text-[color:var(--mm-green)]" : "text-muted-foreground")}
            title={reached?.byCall
              ? "Call attempts — a call with this number connected in the last week"
              : "Call attempts logged by reps"}
          >
            <Phone className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">Call attempts{reached?.byCall ? ", reached" : ""}</span>
            {attempts}
          </span>
          <span
            className={cn("inline-flex items-center gap-1", reached?.byText ? "font-semibold text-[color:var(--mm-green)]" : "text-muted-foreground")}
            title={reached?.byText
              ? "Automated texts — this patient has texted us back in the last week"
              : "Automated texts sent to this patient"}
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">Texts{reached?.byText ? ", they replied" : ""}</span>
            {texts}
          </span>
        </span>
      </div>

      <div className="mt-3 border-t pt-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <PatientContact
            phone={phone}
            patientName={name}
            textTone="green"
            callHistoryLabel="Call Log"
            callHistoryIcon="list"
            callHistoryCount={callCount}
          />
          <button
            type="button"
            onClick={onBookingLink}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700"
          >
            <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
            Booking Link
          </button>
        </div>
        <NotesLine label={notesLabel} notes={notes} />
      </div>
    </article>
  );
}
