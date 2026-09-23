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
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, CalendarPlus, ChevronDown, ChevronUp,
  MessageSquare, Phone,
} from "lucide-react";

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
export function Pill({ children, title, tone = "neutral", iconPad = false }: {
  children: ReactNode; title?: string; tone?: PillTone;
  /** Reserve room at the right edge for a corner glyph. ⚠️ Padding only —
   *  never a height change, or this slot's caption drops below every other
   *  slot's and Brandon's alignment fix comes straight back. */
  iconPad?: boolean;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-block max-w-full truncate rounded-full border px-[7px] py-0.5 text-[11px] font-medium leading-tight",
        iconPad && "pr-[15px]",
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
export type PillActions = Partial<Record<PillSlotKey, {
  onClick: () => void;
  title: string;
  /**
   * A glyph in the pill's top-right corner (Brandon, 2026-09-22: *"with a
   * little photo icon in top right of the pill to designate that it was
   * assigned based on a photo upload"*).
   *
   * ⚠️ It is positioned OVER the pill's corner and paired with `iconPad`, so
   * it can never cover the label. Rendering it inline would be truncated away
   * by the pill's own `truncate` on exactly the long carrier names — the ones
   * most likely to have come off a photo.
   */
  icon?: ReactNode;
}>>;

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
                    <Pill
                      title={action ? action.title : `${slot.field}: ${value}`}
                      tone={pillTone(slot.key, value, variant)}
                      iconPad={!!action?.icon}
                    >
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
                        /* ⚠️ `inline-flex`, not the default inline-block, and
                           it is the alignment fix Brandon reported (2026-09-22:
                           "whenever there's a photoupload pill, the insurance
                           sub-text drops lower than the others"). A button
                           establishes a line box, and that box's strut is sized
                           from the BUTTON's inherited font — the card's ~14px —
                           while the `Pill` inside it is 11px. The extra leading
                           sits under the pill and pushes this slot's caption
                           below every other slot's. A flex container has no
                           strut, so the button is exactly as tall as the pill
                           and the caption row re-registers. */
                        className="relative inline-flex max-w-full rounded-full underline decoration-dotted underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {pill}
                        {action.icon && (
                          <span
                            aria-hidden
                            className="pointer-events-none absolute right-[3px] top-[2px] leading-none text-current opacity-70"
                          >
                            {action.icon}
                          </span>
                        )}
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

/**
 * One direction's pair of counts.
 *
 * ⚠️ A clipped window prints an em dash, never the number it has. The
 * account-wide read is page-capped, so a busy week comes back short and the
 * count would be quietly low — and a coordinator reads a number on a card as
 * fact. Withholding is §5.30e's rule for `Call Log (N)`, applied to the same
 * data. Calls and texts are clipped independently: two reads, two ceilings.
 */
function ContactCountRow({ dir, calls, texts, callsClipped, textsClipped, highlight = null }: {
  dir: "out" | "in";
  calls: number;
  texts: number;
  callsClipped?: boolean;
  textsClipped?: boolean;
  highlight?: "call" | null;
}) {
  const inbound = dir === "in";
  const Arrow = inbound ? ArrowDownLeft : ArrowUpRight;
  const what = inbound ? "from this patient" : "to this patient";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        inbound ? "font-semibold text-[color:var(--mm-green)]" : "text-muted-foreground",
      )}
    >
      <Arrow className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
      <span className="sr-only">{inbound ? "Inbound" : "Outbound"}:</span>
      <span
        className={cn("inline-flex items-center gap-0.5", highlight === "call" && "font-semibold text-[color:var(--mm-green)]")}
        title={
          callsClipped
            ? `Too many calls on the line this week to count ${what} reliably`
            : highlight === "call"
              ? `${calls} call${calls === 1 ? "" : "s"} ${what} — and they answered one`
              : `${calls} call${calls === 1 ? "" : "s"} ${what}`
        }
      >
        <Phone className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">calls</span>
        {callsClipped ? "—" : calls}
      </span>
      <span
        className="inline-flex items-center gap-0.5"
        title={
          textsClipped
            ? `Too many texts on the line this week to count ${what} reliably`
            : `${texts} text${texts === 1 ? "" : "s"} ${what}`
        }
      >
        <MessageSquare className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">texts</span>
        {textsClipped ? "—" : texts}
      </span>
    </span>
  );
}

export function PatientCard({
  name, attempted, nextUp = false, doctor, clinic, network, when, pills, pillActions, variant, contact,
  phone, notes, notesLabel, openHref, openLabel, onBookingLink, onCall, reached, callCount, blocker,
  blockerDetail, inSystem = false,
}: {
  name: string;
  /** Has anybody rung them yet? Green edge when true, gray when false. */
  attempted: boolean;
  /** The scheduled call up next — the one box shaded darker. */
  nextUp?: boolean;
  doctor?: string;
  clinic?: string;
  /**
   * What the eligibility check said about the network, printed VERBATIM.
   *
   * ⚠️ **VERBATIM IS THE SPECIFICATION** (Josh, 2026-09-22: *"we should
   * display whatever stedi came back with"*). The board's own `Unknown` is a
   * real answer — Original Medicare has no network, so fee-for-service
   * patients come back exactly that — and substituting our own word for it
   * loses what the payer actually said AND hides the day the column grows a
   * new vocabulary (§5.20's `networkLabel`, same rule, same reason).
   *
   * ⚠️ It blocks nothing, here or anywhere. It was a gate once, on a condition
   * that could never pass for a whole population, and removing it is what
   * unstranded them.
   */
  network?: string;
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
  /**
   * The two counter rows — what we sent them, and what they sent us.
   *
   * ⚠️ **THIS REPLACED A PAIR OF BOARD COLUMNS AND DOES NOT MEAN THE SAME
   * THING** (Brandon, 2026-09-22). The card used to print the **Attempt
   * Counter** and the **Drop-off Attempt** columns, i.e. calls a rep had
   * pressed *Log call attempt* for and the intake form's two automated
   * nudges — so a patient rung three times read `1`, and a rep's own text
   * read `0`. These are real RingCentral counts from the shared window
   * (`contactState.callsOut` and friends).
   *
   * ⚠️ `undefined` renders NOTHING rather than zeroes: the read has not
   * landed (or cannot be made in a build with no gateway), and four zeroes
   * would be a claim that nobody has touched this patient.
   */
  contact?: {
    callsOut: number; callsIn: number; textsOut: number; textsIn: number;
    /** The call window came back at its page cap, so its numbers are floors.
     *  Withheld rather than shown low — §5.30e's rule for `Call Log (N)`. */
    callsClipped?: boolean;
    /** The same for the text window, which has its own, different ceiling. */
    textsClipped?: boolean;
  };
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
   * Ring them without leaving the page (Brandon, 2026-09-22: *"when i make a
   * call it takes me out of command center"*). Absent — for anybody the
   * browser softphone is not assigned to — leaves `PatientContact`'s ordinary
   * `tel:` handoff in place, which is what every other header in the app does.
   */
  onCall?: () => void;
  /**
   * The duplicate check matched this person to a patient we already serve.
   *
   * ⚠️ Read from **Dup Check Result**, never the Already In System column, for
   * the population this card serves — see `lib/profile/dupCheckFlag.ts`, whose
   * whole header is why. The caller ORs in the flag column for the Completed
   * group, where the check does write it.
   */
  inSystem?: boolean;
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
  /** The long form of `blocker` — the payer's own guidance and AAA code —
   *  carried as the line's `title` rather than on screen. See
   *  `workflow.intakeBlocker` for why it is not in the sentence. */
  blockerDetail?: string;
}) {
  const doctorLine = [doctor?.trim() && `Doctor: ${doctor.trim()}`, clinic?.trim() && `Clinic: ${clinic.trim()}`]
    .filter(Boolean).join(" · ");
  const net = network?.trim() ?? "";
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
          {/* ⚠️ ORANGE, not the rose the blocker below uses. Brandon wrote
              "a red ... orange pill" and did not settle it; on this card rose
              now means "something is wrong and blocks the advance", and this
              is neither — it is a routing fact, and the patient is still
              workable. */}
          {inSystem && (
            <span
              title="The duplicate check matched this person to a patient we already have"
              className="mt-1 inline-block rounded-full border border-orange-400 bg-orange-100 px-2 py-[2px] text-[10.5px] font-semibold uppercase tracking-wide text-orange-950 dark:border-orange-500/50 dark:bg-orange-950/50 dark:text-orange-100"
            >
              Already in System
            </span>
          )}
          {doctorLine && <div className="mt-0.5 text-xs text-muted-foreground">{doctorLine}</div>}
          {/* Only once a check has run — a blank column means nobody has asked
              yet, and "In network: —" on every unworked lead is a row of em
              dashes that teaches a coordinator to stop reading the line. */}
          {net && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              In network: <span className="font-medium text-foreground">{net}</span>
            </div>
          )}
        </div>
        {when}
      </div>

      {/* ⚠️ **ROSE FROM 2026-09-22, REVERSING THE AMBER THIS SHIPPED WITH**
          (Brandon, on the benefits-check line: *"have it be red"*). The note
          it replaces argued §5.17's severity rule — amber for an ordinary next
          step, rose for evidence something is wrong — and the argument was
          sound for a blocker like a missing coverage path. It lost on the
          population: the blocker a coordinator actually sees is a benefits
          check that FAILED, and Savannah French sat behind two failed runs
          nobody noticed. Rose is what gets read.

          ⚠️ It is still not an escalation. An escalated patient is not on this
          card at all — they are in the column's manager count and worked from
          Oversight — so nothing here is being out-ranked. */}
      {blocker?.trim() && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-2 py-1.5 text-[11.5px] font-medium leading-snug text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
          <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0" title={blockerDetail?.trim() || undefined}>{blocker.trim()}</span>
        </div>
      )}

      {/* ⚠️ **TWO ROWS: WHAT WE SENT, THEN WHAT THEY SENT** (Brandon,
          2026-09-22: *"these icons should be showing outgoing texts/calls. we
          should then show incoming calls/texts below it, in green. we should
          add an icon to make it clear that top row is outbound, and bottom row
          is inbound"*). The arrow is that icon, and it carries the whole
          meaning of the row — without it two identical phone/message pairs
          stacked on top of each other say nothing.

          ⚠️ The width is FIXED so the pill grid beside it is the same width on
          every card; left to size themselves, a two-digit count would shift
          every pill column on that one row. It grew from 4.75rem to 6.5rem
          with the second row's arrow.

          ⚠️ Nothing here says "this week", deliberately (Josh, 2026-09-22) —
          seven days is all the shared account-wide read can reach, and a
          qualifier on every number would cost more attention than it buys. */}
      {/* ⚠️ **THE COUNTERS GET THEIR OWN LINE, ABOVE THE PILLS — MEASURED, not
          preferred.** They sat to the RIGHT of the pill grid while they were a
          single row of two small numbers. Two rows with a direction arrow need
          104px (their natural width, measured in a browser at the 1024
          breakpoint), against the 76px the old single row took — and the pill
          area is a FIXED grid whose whole purpose is that captions register
          card to card. Taking 28px out of it clipped three of the four pills
          to "C…", "P…", "I…", which is the one thing that grid exists to
          prevent. A line of its own costs ~18px of card height and gives the
          pills their full width back.

          ⚠️ ABOVE the pills rather than below, so the pill row still ends the
          block and the notes line below it reads as the next thing. */}
      {/* ⚠️ STACKED — outbound on top, inbound underneath (Brandon, 2026-09-22:
          *"these icons should be showing outgoing texts/calls. we should then
          show incoming calls/texts below it, in green"*). Side by side on one
          line is more compact and was tried first; it is not what he asked
          for, and the two rows read as one run of numbers when they share a
          line. */}
      {contact && (
        <div className="mt-2 flex flex-col items-end gap-0.5 text-xs tabular-nums">
          <ContactCountRow
            dir="out"
            calls={contact.callsOut}
            texts={contact.textsOut}
            callsClipped={contact.callsClipped}
            textsClipped={contact.textsClipped}
            /* ⚠️ The emphasis stays on the OUTBOUND phone and is not the same
               fact as a number: `reachedByCall` means they PICKED UP one of
               ours, which no count on this card can express (an outbound call
               that rang out counts identically). The inbound row needs no such
               marker — every number in it is them. */
            highlight={reached?.byCall ? "call" : null}
          />
          <ContactCountRow
            dir="in"
            calls={contact.callsIn}
            texts={contact.textsIn}
            callsClipped={contact.callsClipped}
            textsClipped={contact.textsClipped}
          />
        </div>
      )}

      <div className="mt-2">
        <PillRow slots={pills} variant={variant} actions={pillActions} />
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
            /* Lighter and more transparent than the solid sky-600 it was
               (Brandon, 2026-09-22). It is one of three controls on this row
               and the least urgent of them, so it stops competing with Call
               and Text for the eye while staying plainly a button. */
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-500/15 px-3 py-1.5 text-sm font-semibold text-sky-800 hover:bg-sky-500/25 dark:border-sky-500/40 dark:text-sky-200"
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
