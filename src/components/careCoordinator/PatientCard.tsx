/**
 * One patient on the Care Coordinator dashboard — Brandon's 2026-09-14 box,
 * reworked to his 2026-09-17 notes and again to his 2026-09-24 ones.
 *
 *   ┃ Name (a link) [ALREADY IN SYSTEM]                         [when]
 *   ┃ State: NY; Doctor: … · Clinic: …       ↗ 📞 3 💬 1   ↙ 📞 0 💬 2
 *   ┃ [In-network]
 *   ┃ [pill] [pill] [pill] [pill] [pill]
 *   ┃ ──────────────────────────────────────────────────
 *   ┃ Call · Communications                       [Booking Link]
 *   ┃ Notes: the newest line, click to expand
 *
 * **2026-09-24** (Brandon's Masani dashboard notes): the Already-in-System pill
 * sits BESIDE the name instead of under it; the row under the name leads with
 * the patient's **State** ("N/A" when we have none); the call and text counts
 * are ONE line on that same row — gray outbound first, green inbound beside
 * it — where they used to be two stacked rows of their own; and the benefits
 * check's verdict is one pill (`networkPill`) where "In network: …" and the
 * two benefits-check banners used to be. Every one of those was blank space he
 * asked to have back.
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
import type { NetworkPill as NetworkPillFacts, NetworkPillTone } from "@/lib/careCoordinator/networkPill";
import { stateLabel } from "@/lib/shared/usState";
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

/** "since Jun 18" for an archive's first row (Eastern, like every other date
 *  on these boards), or "" when the archive did not say. */
function sinceLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  const day = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "America/New_York",
  }).format(d);
  return `since ${day}`;
}

/** Hover text for one count. `null` means that archive is not running on the
 *  gateway — "we cannot say", never zero. */
function countTitle(n: number | null, noun: "call" | "text", what: string, since: string, extra = ""): string {
  if (n === null) return `Not counted — the ${noun} archive isn't running on the gateway`;
  const base = `${n} ${noun}${n === 1 ? "" : "s"} ${what}${since ? ` ${since}` : ""}`;
  return extra ? `${base} — ${extra}` : base;
}

/**
 * One direction's pair of counts — arrow, calls, texts.
 *
 * ⚠️ **ALL-TIME, OUT OF THE ARCHIVES, FROM 2026-09-24** (Brandon: *"They're
 * all 0's — can we connect this to how many outbound calls in total have ever
 * gone to the patient?"*). They were a seven-day RingCentral window, so a
 * patient nobody had rung THIS week read 0 however often we had rung them
 * before. "Ever" is "since the archive began", and the hover says since when:
 * the call log reaches back further than the texts do.
 */
function CountPair({ dir, calls, texts, callsSince, textsSince, highlight = false }: {
  dir: "out" | "in";
  calls: number | null;
  texts: number | null;
  callsSince: string;
  textsSince: string;
  /** One of our calls to them connected — somebody picked up. */
  highlight?: boolean;
}) {
  const inbound = dir === "in";
  const Arrow = inbound ? ArrowDownLeft : ArrowUpRight;
  const what = inbound ? "from this patient" : "to this patient";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1",
        inbound ? "font-semibold text-[color:var(--mm-green)]" : "text-muted-foreground",
      )}
    >
      <Arrow className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
      <span className="sr-only">{inbound ? "Inbound" : "Outbound"}:</span>
      <span
        className={cn("inline-flex items-center gap-0.5", highlight && "font-semibold text-[color:var(--mm-green)]")}
        title={countTitle(calls, "call", what, callsSince, highlight ? "and they picked up at least once" : "")}
      >
        <Phone className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">calls</span>
        {calls === null ? "—" : calls}
      </span>
      <span className="inline-flex items-center gap-0.5" title={countTitle(texts, "text", what, textsSince)}>
        <MessageSquare className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">texts</span>
        {texts === null ? "—" : texts}
      </span>
    </span>
  );
}

const NETWORK_TONE: Record<NetworkPillTone, string> = {
  green: "border-[color:var(--mm-green)] bg-[color:var(--mm-green-12)] text-foreground",
  red: "border-rose-300 bg-rose-100 text-rose-950 dark:border-rose-500/50 dark:bg-rose-950/50 dark:text-rose-100",
  gray: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200",
};

/** The benefits check's verdict, as one pill (see `networkPill.ts`). */
function NetworkPill({ pill }: { pill: NetworkPillFacts }) {
  return (
    <span
      title={pill.title}
      className={cn(
        "inline-block max-w-full truncate rounded-full border px-2 py-[2px] text-[11px] font-semibold leading-tight",
        NETWORK_TONE[pill.tone],
      )}
    >
      {pill.label}
    </span>
  );
}

export function PatientCard({
  name, attempted, nextUp = false, state, doctor, clinic, networkPill, when, pills, pillActions, variant, contact,
  phone, notes, notesLabel, openHref, openLabel, onBookingLink, onCall, reached, blocker,
  inSystem = false,
}: {
  name: string;
  /** Has anybody rung them yet? Green edge when true, gray when false. */
  attempted: boolean;
  /** The scheduled call up next — the one box shaded darker. */
  nextUp?: boolean;
  /**
   * The patient's state, already normalised (`shared/usState`), or "" — which
   * prints "N/A" (Brandon, 2026-09-24: *"if for whatever reason we don't have
   * it, just have it say N/A"*). Intake reads the web form's State; Welcome
   * Call, which has no State column, reads it out of the patient's address.
   */
  state: string;
  doctor?: string;
  clinic?: string;
  /**
   * The benefits check's verdict (`networkPill`) — In-network · Out-of-network
   * · Check failed · Network unknown, or `null`/absent when no check has run,
   * which draws nothing (Brandon: *"if it hasn't been run yet, it'll just stay
   * blank"*). Intake cards only; the Welcome Call board carries no answer.
   *
   * ⚠️ It blocks nothing, here or anywhere (§5.20).
   */
  networkPill?: NetworkPillFacts | null;
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
   * The calls and texts that have EVER passed between us, both ways — out of
   * the gateway's call and text archives (`useContactTotals`).
   *
   * ⚠️ `undefined` renders NOTHING rather than zeroes: the count has not
   * landed (or there is no number to count), and four zeroes would be a claim
   * that nobody has touched this patient. A `null` count is an archive that is
   * not running, and prints an em dash.
   */
  contact?: {
    callsOut: number | null; callsIn: number | null;
    textsOut: number | null; textsIn: number | null;
    /** When each archive begins (ISO) — the hover's "since". */
    callsSince?: string | null;
    textsSince?: string | null;
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
   * call it takes me out of command center"*). The page's `CallPatientDialog`
   * dials AND offers Log call attempt. Absent, `PatientContact` falls back to
   * its own dial-only popup — never a `tel:` handoff (§5.50).
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
   * Have we actually got through to this patient?
   *
   * ⚠️ Undefined until the count lands. The outbound phone then stays neutral,
   * which is what it looked like before this existed — a missing signal must
   * never read as "we have not reached them", because that is a claim.
   */
  reached?: { byText: boolean; byCall: boolean };
  /**
   * The advance-unlock condition this patient fails, from
   * `workflow.reviewCardBlocker` — Review Profile cards only, and only what the
   * network pill does not already say.
   *
   * ⚠️ Blank prints NOTHING, and must never print "ready to advance": this
   * dashboard's read is narrower than the profile page's checklist and can
   * miss a coverage-path condition (see `intakeBlocker`). An absent line means
   * "nothing we can see", which is a different claim.
   */
  blocker?: string;
}) {
  const detailLine = [
    `State: ${stateLabel(state)}`,
    [doctor?.trim() && `Doctor: ${doctor.trim()}`, clinic?.trim() && `Clinic: ${clinic.trim()}`]
      .filter(Boolean).join(" · "),
  ].filter(Boolean).join("; ");
  const callsSince = sinceLabel(contact?.callsSince);
  const textsSince = sinceLabel(contact?.textsSince);
  return (
    <article
      className={cn(
        "rounded-xl border border-l-4 p-3 shadow-sm",
        attempted ? "border-l-[color:var(--mm-green)]" : "border-l-slate-300 dark:border-l-slate-600",
        nextUp ? "bg-slate-200/80 dark:bg-slate-800/70" : "bg-card",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {/* ⚠️ The pill sits BESIDE the name (Brandon, 2026-09-24: "Already in
            system pill should be next to the name, not below it"). `shrink-0`
            on the pill and `truncate` on the name, so a long name gives way
            and the pill is never the thing clipped — it is the fact on this
            row a coordinator most needs to see. */}
        <div className="flex min-w-0 items-center gap-2">
          {/* The name IS the link (Brandon, 2026-09-17). Underlined on hover so
              it advertises itself; `title` carries the destination, because the
              two columns lead to different stage pages. */}
          <h4 className="min-w-0 truncate text-[15px] font-semibold leading-tight">
            <Link to={openHref} title={openLabel} className="rounded hover:underline focus-visible:underline focus-visible:outline-none">
              {name}
            </Link>
          </h4>
          {/* ⚠️ ORANGE, not the rose the blocker below uses. Brandon wrote
              "a red ... orange pill" and did not settle it; on this card rose
              means "something is wrong and blocks the advance", and this is
              neither — it is a routing fact, and the patient is still
              workable. */}
          {inSystem && (
            <span
              title="The duplicate check matched this person to a patient we already have"
              className="shrink-0 rounded-full border border-orange-400 bg-orange-100 px-2 py-[2px] text-[10.5px] font-semibold uppercase leading-tight tracking-wide text-orange-950 dark:border-orange-500/50 dark:bg-orange-950/50 dark:text-orange-100"
            >
              Already in System
            </span>
          )}
        </div>
        {when}
      </div>

      {/* ⚠️ **ONE ROW: WHO AND WHERE ON THE LEFT, THE COUNTS ON THE RIGHT**
          (Brandon, 2026-09-24: *"bring this up to a single line — first have
          the gray outbound, then next to it have the green in-bound — this
          should be all on the same line as the doctor info"*). The counts
          were two stacked rows of their own, which is the blank space he
          asked to have back.

          ⚠️ The left side TRUNCATES and the counts never do (`shrink-0`): a
          count cut off reads as a different number, while a clinic address
          cut off is one hover from whole (`title`). */}
      <div className="mt-0.5 flex items-center justify-between gap-3 text-xs">
        <p className="min-w-0 truncate text-muted-foreground" title={detailLine}>{detailLine}</p>
        {contact && (
          <span className="inline-flex shrink-0 items-center gap-2.5 tabular-nums">
            <CountPair
              dir="out"
              calls={contact.callsOut}
              texts={contact.textsOut}
              callsSince={callsSince}
              textsSince={textsSince}
              /* ⚠️ The emphasis is on the OUTBOUND phone and is not the same
                 fact as the number: `reachedByCall` means they PICKED UP one of
                 ours, which no count can express (a call that rang out counts
                 identically). */
              highlight={!!reached?.byCall}
            />
            <CountPair
              dir="in"
              calls={contact.callsIn}
              texts={contact.textsIn}
              callsSince={callsSince}
              textsSince={textsSince}
            />
          </span>
        )}
      </div>

      {/* Where "In network: …" used to be, and in place of the two
          benefits-check banners (Brandon, 2026-09-24). Nothing at all until a
          check has run. */}
      {networkPill && (
        <div className="mt-1.5 flex min-w-0">
          <NetworkPill pill={networkPill} />
        </div>
      )}

      {/* ⚠️ Rose, and now only for what the network pill cannot say —
          coverage that came back inactive, or a coverage path nobody has
          chosen (`reviewCardBlocker`). The two benefits-check sentences this
          banner used to carry are the pill's now.

          ⚠️ It is still not an escalation. An escalated patient is not on this
          card at all — they are in the column's manager count and worked from
          Oversight — so nothing here is being out-ranked. */}
      {blocker?.trim() && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-2 py-1.5 text-[11.5px] font-medium leading-snug text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
          <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0">{blocker.trim()}</span>
        </div>
      )}

      <div className="mt-2">
        <PillRow slots={pills} variant={variant} actions={pillActions} />
      </div>

      <div className="mt-3 border-t pt-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* ⚠️ `onCall` IS passed now. The card has taken it since 2026-09-22
              and never handed it on, so every Call here was a `tel:` handoff
              to the RingCentral app while the page's in-app CallPatientDialog
              sat unused (found 2026-09-24, §5.50). */}
          {/* ⚠️ `commsPresentation="panel"` — Communications opens as a
              right-hand side panel HERE and nowhere else (Brandon, 2026-09-24:
              "don't need to have a pop-up covering the entire screen"; Josh:
              this page only). Every other header keeps the full-screen pop-up
              of §5.50; `commsPanelScope.test.ts` fails if a second caller opts
              in without saying so. */}
          <PatientContact
            phone={phone}
            patientName={name}
            commsTone="green"
            onCall={onCall}
            commsPresentation="panel"
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
