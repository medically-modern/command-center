/**
 * Contact marks — the one or two small glyphs in the top-right of a patient
 * sidebar row, saying who owes whom a reply.
 *
 * MANAGER VIEW ONLY (Josh, 2026-09-01), gated on the `?mv=` origin — the flag
 * every Pipeline Oversight column sets and nothing else does. That is the same
 * gate the Doctor Appointments manager folders use, and for the same reason
 * (CLAUDE.md §5.12): `?manager=1` is only set by SOME oversight columns, so the
 * marks would come and go depending on which column a manager clicked in from;
 * and gating on the signed-in user's access level shows them permanently,
 * including on the ordinary role page a processor works from.
 *
 * ⚠️ **Known consequence of that gate:** a manager who opens a role page
 * directly, rather than clicking through from Oversight, sees no marks. That is
 * the accepted cost of not putting them on a processor's own queue.
 *
 * The rule is `lib/contactState/contactState.ts`; the shared, page-capped fetch
 * behind it is `hooks/useContactStates.ts`. This file is only how it looks.
 *
 * ## Why these are hand-drawn rather than lucide components
 *
 * Two of the four are composites lucide does not ship — a FILLED speech bubble
 * and a bubble carrying a check — and mixing two sources for one four-glyph set
 * is how a set stops looking like a set. They are drawn in lucide's own grammar
 * (24px box, 2px stroke, round caps and joins) so they sit correctly beside the
 * `User`, `Clock` and `AlertCircle` icons already on these rows.
 *
 * ## The grammar, which is the whole point
 *
 * **Rose = they are waiting on us. Muted = we have already acted.** A manager
 * scanning forty rows finds the ones needing something by colour alone; the
 * glyph only explains it once they have looked. Rose is the app's existing
 * escalation hue, so it already means "somebody has to do something" here.
 *
 * At most two ever render — one per lane — and that ceiling is a property of
 * the rule, not something this component enforces.
 */
import { useSearchParams } from "react-router-dom";
import { useContactStates, CONTACT_WINDOW_DAYS } from "@/hooks/useContactStates";
import {
  CALL_LANE_LABEL,
  TEXT_LANE_LABEL,
  contactKey,
  type ContactState,
} from "@/lib/contactState/contactState";
import { managerOriginFromParams } from "@/lib/shared/managerOrigin";
import { cn } from "@/lib/utils";

/**
 * 12px. Small enough to sit in a row corner without competing with the name,
 * large enough that a filled shape still reads.
 *
 * ⚠️ The size is load-bearing against the gutter below: two glyphs plus the gap
 * and the right offset come to 31px, which fits inside the 32px (`pr-8`) that
 * shadcn's sidebar reserves when a row carries an action. Grow these and the
 * marks start sitting on top of a long patient name.
 */
const SIZE = 12;

const svgProps = {
  width: SIZE,
  height: SIZE,
  viewBox: "0 0 24 24",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** The lucide `MessageSquare` path, used by all three bubble variants so the
 *  filled and hollow states share one silhouette. */
const BUBBLE = "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z";

/** They texted us and nobody has replied — solid, because a filled mass is what
 *  survives 13px and because filled reads as "owed". */
function BubbleFilled() {
  return (
    <svg {...svgProps} fill="currentColor" stroke="currentColor" strokeLinecap={undefined}>
      <path d={BUBBLE} />
    </svg>
  );
}

/** We sent the last text — same silhouette, hollow, with a check inside. */
function BubbleAnswered() {
  return (
    <svg {...svgProps} fill="none" stroke="currentColor">
      <path d={BUBBLE} />
      <polyline points="8 10 11 13 16 7.5" />
    </svg>
  );
}

/** They called and nobody picked up — the glyph RingCentral itself uses, so
 *  nobody has to learn it. */
function PhoneMissedGlyph() {
  return (
    <svg {...svgProps} fill="none" stroke="currentColor">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      <line x1="22" y1="2" x2="16" y2="8" />
      <line x1="16" y1="2" x2="22" y2="8" />
    </svg>
  );
}

/** We called them — the same phone body, mirrored corner mark. */
function PhoneOutgoingGlyph() {
  return (
    <svg {...svgProps} fill="none" stroke="currentColor">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      <polyline points="23 7 23 1 17 1" />
      <line x1="16" y1="8" x2="23" y2="1" />
    </svg>
  );
}

/** "3 days ago" — the hover text's whole job is to say how stale the mark is. */
function ago(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Is the caller in the manager view? Exported so a sidebar can decide whether
 * to reserve the row's corner padding at all, rather than every row paying for
 * a gutter nobody can see.
 */
export function useContactMarksEnabled(): boolean {
  const [sp] = useSearchParams();
  return managerOriginFromParams(sp) !== null;
}

export function ContactStateMarks({ phone, className }: { phone: string | undefined | null; className?: string }) {
  const enabled = useContactMarksEnabled();
  const { states } = useContactStates(enabled);

  if (!enabled || !states) return null;
  const key = contactKey(phone);
  if (key.length !== 10) return null;
  const state: ContactState | undefined = states.get(key);
  // Nothing in the window. An empty corner IS the answer — a placeholder
  // meaning "no contact" on every row would cost the column its scannability.
  if (!state) return null;

  const marks: Array<{ key: string; node: React.ReactNode; title: string; owed: boolean }> = [];

  if (state.text) {
    marks.push({
      key: "text",
      node: state.text === "awaitingOurReply" ? <BubbleFilled /> : <BubbleAnswered />,
      title: `${TEXT_LANE_LABEL[state.text]} — ${ago(state.textAt)}`,
      owed: state.text === "awaitingOurReply",
    });
  }
  if (state.call) {
    const vm = state.voicemail ? ", voicemail left" : "";
    marks.push({
      key: "call",
      node: state.call === "missedTheirCall" ? <PhoneMissedGlyph /> : <PhoneOutgoingGlyph />,
      title: `${CALL_LANE_LABEL[state.call]}${vm} — ${ago(state.callAt)}`,
      owed: state.call === "missedTheirCall",
    });
  }
  if (!marks.length) return null;

  return (
    // Text lane always left, call lane always right — a column where the marks
    // change position row to row cannot be scanned.
    <span
      // ⚠️ Borrowed deliberately: `sidebarMenuButtonVariants` reserves `pr-8`
      // on any row whose item contains a `menu-action`, which is the only hook
      // in the sidebar primitives for "keep the right end of the row clear".
      // It is referenced in exactly two places in components/ui/sidebar.tsx —
      // that padding rule and SidebarMenuAction's own attribute — so this
      // buys the gutter and no other styling.
      data-sidebar="menu-action"
      // Rendered INSIDE the row button rather than beside it, so a click on a
      // mark still selects the patient (it bubbles) and the native title
      // tooltip still works. A sibling overlay would have to choose between
      // the two: `pointer-events-none` keeps the row clickable but kills the
      // tooltip, which is the only place a rep ever reads what a glyph means.
      className={cn("absolute right-1 top-1.5 flex items-center gap-[3px]", className)}
      // Not a control, and not part of the row's accessible name: the row
      // button already announces the patient. Screen readers get the titles.
      role="group"
      aria-label={`Recent contact, last ${CONTACT_WINDOW_DAYS} days`}
    >
      {marks.map((m) => (
        <span
          key={m.key}
          title={m.title}
          className={cn("shrink-0 leading-none", m.owed ? "text-rose-500" : "text-muted-foreground")}
        >
          {m.node}
        </span>
      ))}
    </span>
  );
}

export default ContactStateMarks;
