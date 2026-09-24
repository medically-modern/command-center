/**
 * The text composer — or, when texting this patient is not allowed, the banner
 * that says why.
 *
 * Extracted from `ConversationThread` so the Communications inbox's timeline
 * renders the SAME composer (COMMS_INBOX_PLAN.md §4.6). ⚠️ The opt-out and Can
 * Text guards live HERE and nowhere else; a second composer would be a second
 * copy of the rule that stops us texting somebody who asked us to stop.
 *
 * Two guards worth knowing about:
 *  - **Opt-out.** If the patient has texted STOP (or another CTIA keyword) the
 *    composer is disabled. RingCentral only auto-honors opt-out on High Volume
 *    SMS, and we send through plain /sms, so nothing upstream stops this.
 *  - **Can Text** (§5.46e) — an explicit No on the patient's record blocks it.
 *
 * ⚠️ Callers KEY this on the number, so a draft can never follow the rep onto a
 * different thread.
 */
import { useState } from "react";
import { Loader2, Send, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { mmPhoneNumber } from "@/lib/fax/ringcentralApi";
import { fmtPhone } from "@/lib/assignedPatients/format";
import type { ConversationView } from "@/hooks/assignedPatients/useConversation";
import { cn } from "@/lib/utils";

interface Props {
  conversation: ConversationView;
  /**
   * The patient's **Can Text** column (§5.46e), when the caller holds it.
   *
   * ⚠️ **OPT-IN: absent means `"unknown"`**, which is the behaviour of every
   * screen that does not pass it. A blank column is UNKNOWN, never a No
   * (§5.31d) — the composer is blocked only on an explicit No, because blank
   * means nobody has asked and blocking on it would silence texting for the
   * whole board.
   *
   * ⚠️ It BLOCKS rather than warning, which is §5.31d's call for the same
   * column one screen over: RingCentral accepts a text to a landline and only
   * flips it to `SendingFailed` seconds later (§5.5), so a click-through
   * warning buys a green toast and a patient who heard nothing.
   */
  canText?: "yes" | "no" | "unknown";
  /** Told after a text went out, with what was sent — the inbox uses it to
   *  re-read the item; Patient Intake stamps its Call Log from the body. */
  onSent?: (body: string) => void;
  /**
   * The draft, held by the CALLER. The Communications popup (§5.50) keeps it
   * on its button, which outlives the dialog, so a template seeded before the
   * popup opens lands in this box and words the rep typed survive a close
   * (the rule `lib/shared/textDraft` keeps). Absent — the hub's thread, the
   * patient screen — the composer keeps its own, exactly as it always has.
   *
   * ⚠️ Both halves or neither: a `draft` with no `onDraftChange` is a box that
   * cannot be typed in.
   */
  draft?: string;
  onDraftChange?: (text: string) => void;
  /**
   * How the box LOOKS — nothing else. `"line"` is Brandon's patient-screen
   * composer (pixel-match item 14, 2026-09-24): one line and a blue "Send
   * text", in the patient screen's own `.cc-pt` classes. ⚠️ **OPT-IN: absent is
   * the box every other screen has always had**, byte for byte. The guards
   * above and the send below are the same code whichever look is drawn —
   * a second composer would be a second copy of the rule that stops us
   * texting somebody who asked us to stop.
   */
  variant?: "box" | "line";
  /** The line look's placeholder — "Write a text…" unless the caller names the number. */
  placeholder?: string;
}

export default function Composer({
  conversation,
  canText,
  onSent,
  draft: heldDraft,
  onDraftChange,
  variant = "box",
  placeholder,
}: Props) {
  const { consent, loading, error } = conversation;
  const [ownDraft, setOwnDraft] = useState("");
  const held = heldDraft !== undefined && !!onDraftChange;
  const draft = held ? heldDraft : ownDraft;
  const setDraft: (text: string) => void = held && onDraftChange ? onDraftChange : setOwnDraft;
  const [sending, setSending] = useState(false);

  /** ⚠️ Explicit No only — see the prop's note. */
  const textingOff = canText === "no";

  const send = async () => {
    const text = draft.trim();
    if (!text || sending || consent.optedOut || textingOff) return;
    setSending(true);
    try {
      // ⚠️ Cleared when RingCentral ACCEPTS the text, not after the re-read
      // that follows — see `ConversationView.send`.
      await conversation.send(text, () => setDraft(""));
      // Best-effort by contract: the text has gone, so a listener that throws
      // (a Call Log stamp that failed, say) must never read as a failed send.
      try {
        onSent?.(text);
      } catch {
        /* the caller's problem, not the send's */
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {consent.optedOut || textingOff ? (
        <div
          className={cn(
            "shrink-0 border-t border-border px-4 py-3 flex items-start gap-2 text-sm",
            // A pending check is not an accusation — only style it as a block
            // once we actually know something. ⚠️ `Can Text = No` IS something
            // we know, so it never wears the pending look, however the STOP
            // check is going.
            consent.unknown && loading && !textingOff
              ? "bg-muted/40 text-muted-foreground"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {consent.unknown && loading && !textingOff ? (
            <Loader2 className="h-4 w-4 shrink-0 mt-0.5 animate-spin" />
          ) : (
            <ShieldOff className="h-4 w-4 shrink-0 mt-0.5" />
          )}
          {/* ⚠️ A STOP reply outranks the column: it is the patient's own
              words, where Can Text is a rep's note about the line. */}
          {textingOff && !consent.optedOut ? (
            <span>
              This patient&apos;s <b>Can Text</b> is set to <b>No</b> on their board record, so
              texting is blocked here. Call them instead, or change it on the stage page.
            </span>
          ) : !consent.unknown ? (
            <span>
              This patient replied <b>{(consent.keyword || "stop").toUpperCase()}</b>
              {consent.since ? ` on ${new Date(consent.since).toLocaleDateString("en-US")}` : ""} and is opted out of
              texts. Call them instead — texting is blocked.
            </span>
          ) : loading ? (
            <span>Checking whether this patient has opted out of texts…</span>
          ) : error ? (
            <span>
              This conversation didn't load, so we can't confirm whether the patient has opted out of texts. Texting is
              blocked until it does — hit Refresh, or call them instead.
            </span>
          ) : (
            <span>
              This conversation is too long to load in full, so we can't confirm whether the patient has opted out of
              texts. Texting is blocked rather than risk messaging someone who asked us to stop — call them instead.
            </span>
          )}
        </div>
      ) : variant === "line" ? (
        /* Brandon's `.pt-side .composer`: one line, a blue Send text. Enter
           sends, exactly as in the box. */
        <div className="composer">
          <div className="row">
            <input
              className="input grow"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={placeholder || "Write a text…"}
              aria-label="Write a text"
            />
            <button
              type="button"
              className="btn primary sm"
              onClick={() => void send()}
              disabled={!draft.trim() || sending}
              title="Send text"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send text
            </button>
          </div>
        </div>
      ) : (
        <div className="shrink-0 border-t border-border bg-card p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder={`Text from ${fmtPhone(mmPhoneNumber())}…`}
              className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={() => void send()}
              disabled={!draft.trim() || sending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
