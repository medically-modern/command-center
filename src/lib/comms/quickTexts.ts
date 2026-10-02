/**
 * Suggested-text buttons under the Communications text box — per board.
 *
 * Brandon, 2026-10-02 (Care Coordinator notes): *"Right below the text box,
 * suggest a few buttons to make life easier: OON text — auto writes this, and
 * user just has to press send (and can adjust as well) … Copy booking link —
 * when you press it, it copies the booking link"*. Josh, same day: *"ONLY
 * exist on the care coordinator board … make sure that we can have a
 * replicable system for suggested texts only landing on certain boards. click
 * button, text shows in send, only show it on specified board"*.
 *
 * How it stays on one board: the Communications panel draws the bar only when
 * its caller passes a `QuickTextsContext`, and the context names a board in
 * `QUICK_TEXTS`. Today exactly one caller passes one — the Care Coordinator
 * card — and `quickTextsScope.test.ts` fails the build if another starts to.
 * **To give another board buttons:** add its key and actions here, pass
 * `quickTexts={{ board: "<key>", … }}` from that board's own header, and add
 * that file to the scope test's list.
 *
 * ⚠️ A "fill" button NEVER sends. It puts words in the box; the rep reads,
 * edits and presses Send, which goes through the composer's own STOP / Can Text
 * guards like any typed text.
 */
import type { BookingKind } from "@/lib/scheduledCalls/bookingLink";

export interface QuickTextPatient {
  name: string;
  email?: string;
  phone?: string;
}

/** What the caller knows about the patient whose panel is open. */
export interface QuickTextsContext {
  board: QuickTextBoard;
  patient: QuickTextPatient;
  /** Which Calendly link "Copy booking link" copies — settled by which card
   *  opened the panel, exactly as the card's own Booking link button is. */
  bookingKind?: BookingKind;
}

export type QuickAction =
  | {
      kind: "fill";
      id: string;
      label: string;
      title: string;
      text: (p: QuickTextPatient) => string;
    }
  | {
      kind: "copyBookingLink";
      id: string;
      label: string;
      title: string;
    };

/** "Neesha Patel" → "Neesha". Blank in, blank out. */
export function firstName(name: string): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Brandon's out-of-network text, word for word, with the patient's first name. */
export function oonText(p: QuickTextPatient): string {
  const first = firstName(p.name);
  return (
    `Hey ${first || "there"} - I just reviewed your profile, and unfortunately we are not in-network with your insurance. ` +
    `We're hoping to get in-network with more insurances soon, so feel free to reach back out at a later time.`
  );
}

export const QUICK_TEXTS = {
  careCoordinator: [
    {
      kind: "fill",
      id: "oon",
      label: "OON text",
      title: "Put the out-of-network text in the box — edit it, then press Send",
      text: oonText,
    },
    {
      kind: "copyBookingLink",
      id: "booking-link",
      label: "Copy booking link",
      title: "Copy this patient's Calendly link, prefilled like the Booking link dialog's",
    },
  ],
} satisfies Record<string, QuickAction[]>;

export type QuickTextBoard = keyof typeof QUICK_TEXTS;

/** The buttons for a board — none when no board is named. */
export function quickTextsFor(board: QuickTextBoard | undefined): QuickAction[] {
  return board ? (QUICK_TEXTS[board] as QuickAction[]) ?? [] : [];
}

/**
 * The box after a fill button. An empty box takes the text as is; words the
 * rep already typed are kept, with the suggestion after a blank line — a click
 * must never throw away something they wrote. Pressing the same button twice
 * does not stack a second copy.
 */
export function applyQuickText(draft: string, text: string): string {
  const cur = draft ?? "";
  if (!cur.trim()) return text;
  if (cur.includes(text)) return cur;
  return `${cur.replace(/\s+$/, "")}\n\n${text}`;
}
