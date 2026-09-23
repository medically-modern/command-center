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
  /** Told after a text went out — the inbox uses it to re-read the item. */
  onSent?: () => void;
}

export default function Composer({ conversation, canText, onSent }: Props) {
  const { consent, loading, error } = conversation;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  /** ⚠️ Explicit No only — see the prop's note. */
  const textingOff = canText === "no";

  const send = async () => {
    const text = draft.trim();
    if (!text || sending || consent.optedOut || textingOff) return;
    setSending(true);
    try {
      await conversation.send(text);
      setDraft("");
      onSent?.();
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
