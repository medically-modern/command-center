/**
 * "Communications" — the one button that replaced every Text and Calls button
 * in the Command Center (Josh, 2026-09-24; CLAUDE.md §5.50):
 *
 *   *"all of the text / calls buttons on command center need to be replaces
 *   with this new 'all activity notes call recordings voicemails etc' button.
 *   lets call it Communications. they should click it and it should show open
 *   a full screen pop up of the back and forth with the patient, basically
 *   just porting the middle text call voicemail notes back and forth there …
 *   there are no action items here, viewing the notes or the texts and calls
 *   vms etc are what we want, with the ability to text them from there"*
 *
 * The popup's content is `CommunicationsView` — the Communications hub's
 * middle pane in its view-only mode. This file owns what must OUTLIVE the
 * popup: whether it is open, and the composer's drafts.
 *
 * ⚠️⚠️ **THE OLD TEXT BUTTON'S CONTRACT IS KEPT, WORD FOR WORD.** Patient
 * Intake opens the composer from its own buttons with a template in it
 * (*Start Insurance Follow-Up*, *Generate CGM data link*) and stamps its Call
 * Log from every text sent (`onTextSent`). So: `open` pushes the popup open,
 * `textPrefill` seeds the PRIMARY number's draft through the same two rules
 * the old composer used (`lib/shared/textDraft` — a template never overwrites
 * words the rep typed, and an untouched template is thrown away on close), and
 * `onTextSent` is told the body of every text that went. A regression here is
 * silent: the wrong template in the box, or a Call Log with no record of a
 * link that was sent.
 *
 * ⚠️ **Drafts are per NUMBER and cleared on a change of patient** — a
 * half-typed text must never follow a sidebar click onto somebody else (§9's
 * notes-box rule), and switching to the caregiver's number must not carry the
 * patient's words across.
 *
 * ⚠️ **It survives the page design systems that reset bare buttons.** `.bnr`
 * (the Insurance pages) and `.pf-root` zero `background`, `border`, `color`
 * and `font` on every <button> beneath them, out-specifying any single-class
 * Tailwind utility (§9) — so the base look is an inline style, which no
 * stylesheet rule beats, and the hover is an opacity/background utility with a
 * pseudo-class, which does beat them.
 *
 * ⚠️ **Outside clicks never close it.** The only things outside a full-screen
 * popup are the incoming-call cards (§5.13b), and answering one must not throw
 * away what the rep was reading. Esc and ✕ close it.
 *
 * ── `presentation="panel"` — the Care Coordinator dashboard only ──
 * Brandon, 2026-09-24: *"When we click communications, let's just have it pop
 * up on a right side-panel, don't need to have a pop-up covering the entire
 * screen"*; Josh chose THAT PAGE ONLY — every other header keeps the
 * full-screen pop-up above (`commsPanelScope.test.ts` pins it).
 *
 * The panel is the same view, docked to the right edge, and deliberately
 * NON-MODAL: the dashboard beside it stays readable, scrollable and clickable,
 * which is the point of not covering it. Two consequences, both handled here:
 *  · ⚠️ **One panel at a time.** Every card carries its own button, so without
 *    a rule a second card's Communications would open a second panel on top of
 *    the first — two composers, one hidden. `PANEL` is a module-scope "who is
 *    open", and opening one closes the other, so pressing another card's
 *    button SWAPS the panel to that patient.
 *  · Outside clicks still never close it, for the same incoming-call reason —
 *    and because a coordinator clicking around the dashboard with the panel
 *    open is the everyday case now, not an accident.
 */
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { MessagesSquare, X } from "lucide-react";
import { draftAfterClose, draftOnOpen } from "@/lib/shared/textDraft";
import { numberKey } from "@/lib/comms/commsPopup";
import { toE164 } from "@/lib/fax/ringcentralApi";
import { CommunicationsView } from "./CommunicationsView";
import { cn } from "@/lib/utils";

/**
 * Which side panel is open, if any — module scope, so opening one card's panel
 * closes another's (see the header). Popups are modal and never need this.
 */
const PANEL = {
  open: null as string | null,
  listeners: new Set<(id: string | null) => void>(),
  claim(id: string) {
    this.open = id;
    for (const l of this.listeners) l(id);
  },
  release(id: string) {
    if (this.open === id) this.open = null;
  },
};

/** The base look, inline so a page's `button { background:none; color:inherit;
 *  font:inherit }` reset cannot strip it (see the header). */
const TRIGGER_STYLE: CSSProperties = {
  color: "var(--mm-teal)",
  boxShadow: "inset 0 0 0 1px var(--mm-card-border)",
  fontSize: "0.875rem",
  lineHeight: "1.25rem",
  fontWeight: 600,
};

export interface CommunicationsButtonProps {
  /** The patient's number on this page. No number, no button. */
  phone?: string;
  /** Their other number, when the page holds one. */
  altPhone?: string;
  /** Whose communications — shown in the popup's title. */
  patientName?: string;
  /** The board record an outbound text is about (§5.28). */
  mondayItemId?: string | null;
  /** The PRIMARY line's Can Text answer, when the page reads it (§5.31d). */
  canText?: "yes" | "no" | "unknown";
  /** Seeds the primary number's draft when the popup opens. */
  textPrefill?: string;
  /** An outside button pushing the popup open (Patient Intake). One-way. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Told with the body of every text sent from the popup. */
  onTextSent?: (body: string) => void;
  /** "green" — the Care Coordinator card's light-green button (Brandon,
   *  2026-09-14, carried over from the Text button it replaced). */
  tone?: "green";
  /**
   * "panel" docks it to the right edge, non-modal, one at a time — the Care
   * Coordinator dashboard only (Josh, 2026-09-24). Absent: the full-screen
   * pop-up every other header uses (§5.50).
   */
  presentation?: "popup" | "panel";
  label?: string;
  className?: string;
}

export function CommunicationsButton({
  phone,
  altPhone,
  patientName,
  mondayItemId,
  canText,
  textPrefill,
  open: openSignal,
  onOpenChange,
  onTextSent,
  tone,
  presentation = "popup",
  label = "Communications",
  className,
}: CommunicationsButtonProps) {
  const [open, setOpen] = useState(false);
  const panel = presentation === "panel";
  const panelId = useId();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** The template WE put in the box, so a close can tell an untouched template
   *  apart from words the rep actually wrote (`draftAfterClose`). */
  const seeded = useRef<string | null>(null);
  const primaryKey = numberKey(toE164(phone || ""));

  // ⚠️ Declared BEFORE the seeding effect on purpose: effects run in order, and
  // a template seeded and then wiped in the same commit is exactly the silent
  // "wrong template" failure `textDraft` exists to prevent.
  useEffect(() => {
    setDrafts({});
    seeded.current = null;
  }, [primaryKey]);

  // An outside button pushing the popup open. One-way: the popup still closes
  // itself.
  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);

  useEffect(() => {
    if (!open || !textPrefill || !primaryKey) return;
    setDrafts((d) => ({ ...d, [primaryKey]: draftOnOpen(d[primaryKey] ?? "", textPrefill) }));
    seeded.current = textPrefill;
  }, [open, textPrefill, primaryKey]);

  const draftFor = useCallback((key: string) => drafts[key] ?? "", [drafts]);
  const setDraftFor = useCallback((key: string, text: string) => {
    if (!key) return;
    setDrafts((d) => (d[key] === text ? d : { ...d, [key]: text }));
  }, []);

  const handleOpenChange = useCallback((v: boolean) => {
    if (!v) {
      // An untouched template is thrown away so the next one has an empty box
      // to land in; anything the rep typed survives the close.
      const t = seeded.current;
      seeded.current = null;
      if (primaryKey) {
        setDrafts((d) => ({ ...d, [primaryKey]: draftAfterClose(d[primaryKey] ?? "", t) }));
      }
    }
    setOpen(v);
    onOpenChange?.(v);
  }, [primaryKey, onOpenChange]);

  // One side panel at a time: claim the slot on open, and close when another
  // card claims it. A popup is modal and never takes part.
  useEffect(() => {
    if (!panel || !open) return;
    PANEL.claim(panelId);
    const onClaim = (id: string | null) => {
      if (id !== panelId) handleOpenChange(false);
    };
    PANEL.listeners.add(onClaim);
    return () => {
      PANEL.listeners.delete(onClaim);
      PANEL.release(panelId);
    };
  }, [panel, open, panelId, handleOpenChange]);

  // No number on file, nothing to show. Guarded here so every header can drop
  // the button in unconditionally.
  if (!primaryKey) return null;

  const who = patientName?.trim() || "";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange} modal={!panel}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          title={`Every text, call, recording and voicemail with ${who || "this patient"} — and text them`}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-colors",
            tone === "green"
              ? "bg-[color:var(--mm-green-12)] hover:bg-[color:var(--mm-mint)]"
              : "hover:bg-muted/40",
            className,
          )}
          style={TRIGGER_STYLE}
        >
          <MessagesSquare className="h-3.5 w-3.5 shrink-0" /> {label}
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        {/* A modal overlay for the popup only — Radix draws none for a
            non-modal dialog, which is what keeps the dashboard beside the
            panel visible and live. */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
          data-comms-presentation={presentation}
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden bg-background outline-none data-[state=open]:animate-in data-[state=closed]:animate-out",
            panel
              ? /* Docked right, full height, the dashboard beside it. `100vw`
                   is the cap on a narrow window, where the panel simply
                   becomes the whole width rather than overflowing it. */
                "inset-y-0 right-0 w-[min(760px,100vw)] border-l border-border shadow-2xl data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
              : "inset-2 rounded-xl border border-border shadow-2xl sm:inset-4 data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            Communications{who ? ` with ${who}` : ""}
          </DialogPrimitive.Title>
          <CommunicationsView
            phone={phone || ""}
            altPhone={altPhone}
            name={who}
            mondayItemId={mondayItemId}
            canText={canText}
            draftFor={draftFor}
            setDraftFor={setDraftFor}
            onTextSent={onTextSent}
            narrow={panel}
          />
          <DialogPrimitive.Close
            className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close"
            title="Close (Esc)"
          >
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default CommunicationsButton;
