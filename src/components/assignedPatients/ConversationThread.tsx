/**
 * One SMS conversation: the message history, a composer that sends from the MM
 * number, and click-to-call via RingOut.
 *
 * Two guards worth knowing about:
 *  - **Opt-out.** If the patient has texted STOP (or another CTIA keyword) the
 *    composer is disabled. RingCentral only auto-honors opt-out on High Volume
 *    SMS, and we send through plain /sms, so nothing upstream stops this.
 *  - **RingOut `from`.** The rep is rung on their own number. Without one
 *    configured we fall back to the MM main number and say so, because that
 *    rings the main line rather than this person.
 */
import { MessageAttachments } from "@/components/shared/MessageAttachments";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Phone, Send, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { mmPhoneNumber } from "@/lib/fax/ringcentralApi";
import { fetchConversation, sendMessage, type ConversationMessage } from "@/lib/assignedPatients/messagingApi";
import { consentState } from "@/lib/assignedPatients/optOut";
import type { PatientRef } from "@/lib/assignedPatients/patientLookup";
import { fmtPhone, senderColor, senderName } from "@/lib/assignedPatients/format";
import WatchCallbackButton from "@/components/inboundCalls/WatchCallbackButton";
import { cn } from "@/lib/utils";

interface Props {
  phone: string;
  patient: PatientRef | null;
  /** Start the call (in-browser softphone). */
  onCall: () => void;
  calling: boolean;
}

export default function ConversationThread({ phone, patient, onCall, calling }: Props) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  // Whether we saw the WHOLE thread. Consent can't be inferred from a partial
  // one, so this gates the composer alongside the messages themselves.
  //
  // ⚠️ Starts FALSE and is reset to false on every phone change and every failed
  // load. Starting true meant an empty message list read as "complete history,
  // no STOP found" — so the composer was live during the load, and stayed live
  // after a load that failed outright. Not knowing must never look like consent.
  const [historyComplete, setHistoryComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    try {
      const thread = await fetchConversation(phone);
      setMessages(thread.messages);
      setHistoryComplete(thread.complete);
      setError(null);
    } catch (e) {
      // A history we couldn't read is a history we can't clear for sending.
      setHistoryComplete(false);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    setMessages([]);
    setHistoryComplete(false);
    void (async () => {
      if (alive) await load(true);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const consent = consentState(messages, historyComplete);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending || consent.optedOut) return;
    setSending(true);
    try {
      await sendMessage({ to: phone, text, mondayItemId: patient?.itemId || undefined });
      setDraft("");
      await load(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="flex-1 flex flex-col min-h-0 min-w-0">
      <header className="px-4 py-3 border-b border-border bg-card shrink-0 flex items-center gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold truncate">{patient?.name || fmtPhone(phone)}</h2>
          <p className="text-[11px] text-muted-foreground truncate">
            {fmtPhone(phone)}
            {patient?.boardName ? ` · ${patient.boardName}` : ""}
          </p>
        </div>
        {/* The only way a number joins your ring list — see the component. */}
        <div className="ml-auto shrink-0">
          <WatchCallbackButton phone={phone} label={patient?.name || ""} />
        </div>
        <button
          onClick={onCall}
          disabled={calling}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--mm-teal,theme(colors.teal.600))] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {calling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
          Call
        </button>
      </header>

      <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-2 bg-gradient-subtle">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading conversation…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        ) : messages.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={cn("flex flex-col", m.direction === "Outbound" ? "items-end" : "items-start")}
            >
              {/* Sender name ABOVE the bubble, and the bubble tinted per sender,
                  so a long thread can be scanned for "who sent what" without
                  reading every label. Colour is derived from the email, so one
                  person is the same colour everywhere. */}
              {m.direction === "Outbound" && m.sentBy && (
                <span className="text-[10px] font-medium text-muted-foreground mb-0.5 mr-1">
                  {senderName(m.sentBy)}
                </span>
              )}
              <div
                className={cn(
                  "max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                  m.direction !== "Outbound"
                    ? "bg-card border border-border"
                    : m.sentBy
                      ? `${senderColor(m.sentBy)} text-white`
                      : "bg-primary text-primary-foreground",
                )}
              >
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                <MessageAttachments attachments={m.attachments} />
                <p
                  className={cn(
                    "text-[10px] mt-0.5",
                    m.direction === "Outbound" ? "text-white/70" : "text-muted-foreground",
                  )}
                >
                  {m.time ? new Date(m.time).toLocaleString("en-US", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
                  {/* Sends made outside the Command Center (or before this
                      tracking existed) have no sender on record — say so rather
                      than leaving the reader to guess. */}
                  {m.direction === "Outbound" && !m.sentBy ? " · sent outside Command Center" : ""}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {consent.optedOut ? (
        <div
          className={cn(
            "shrink-0 border-t border-border px-4 py-3 flex items-start gap-2 text-sm",
            // A pending check is not an accusation — only style it as a block
            // once we actually know something.
            consent.unknown && loading
              ? "bg-muted/40 text-muted-foreground"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {consent.unknown && loading ? (
            <Loader2 className="h-4 w-4 shrink-0 mt-0.5 animate-spin" />
          ) : (
            <ShieldOff className="h-4 w-4 shrink-0 mt-0.5" />
          )}
          {!consent.unknown ? (
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
    </section>
  );
}
