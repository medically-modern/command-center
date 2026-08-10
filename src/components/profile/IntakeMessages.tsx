/**
 * Patient Messages — the intake page's copy of the mockup's message card.
 *
 * Presentation only: every rule that matters is reused from the libs the
 * Assigned Patients inbox already uses, rather than reimplemented here.
 *
 *  - Texts go through the GATEWAY (`messagingApi.sendMessage`), never straight
 *    to RingCentral, so the sender is taken from the verified Google token
 *    server-side. "Who texted this patient" is the point of the record, and a
 *    browser-supplied sender is self-reported.
 *  - Sending is BLOCKED on `consentState` (TCPA/CTIA). Nothing upstream stops a
 *    rep texting someone who sent STOP — our sends use the plain /sms endpoint,
 *    not High Volume SMS — so the guard has to be in every composer, not just
 *    the inbox's. An incomplete history counts as consent UNKNOWN and also
 *    blocks: "no STOP found" in a truncated thread is absence of evidence.
 *  - Email goes through the same worker route as Send Request
 *    (`sendViaWorker`), which sends AS the company Gmail sender.
 *
 * There is deliberately no unified "message history": the SMS thread is real,
 * pulled from RingCentral, while sent email has no per-patient store to read
 * back. Inventing a merged list would imply a record that doesn't exist.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  fetchConversation, sendMessage, messagingConfigured,
  type ConversationMessage,
} from "@/lib/assignedPatients/messagingApi";
import { consentState } from "@/lib/assignedPatients/optOut";
import { sendViaWorker, SendValidationError } from "@/lib/shared/sendViaWorker";

type Channel = "Text" | "Email";

function fmtTime(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function IntakeMessages({
  patientId, phone, email,
}: {
  patientId: string;
  phone?: string;
  email?: string;
}) {
  const tel = (phone ?? "").replace(/[^\d+]/g, "");
  const addr = (email ?? "").trim();

  const [channel, setChannel] = useState<Channel>("Text");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [historyComplete, setHistoryComplete] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!tel || !messagingConfigured()) return;
    setLoading(true);
    setLoadError(null);
    try {
      const c = await fetchConversation(tel);
      setMessages(c.messages);
      setHistoryComplete(c.complete);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      // A thread we could not read is NOT an empty thread — leaving `complete`
      // true here would let the consent guard fail open.
      setHistoryComplete(false);
    } finally {
      setLoading(false);
    }
  }, [tel]);

  // Reset per patient, then pull the thread.
  useEffect(() => {
    setMessages([]);
    setHistoryComplete(true);
    setDraft("");
    setSubject("");
    setLoadError(null);
  }, [patientId]);
  useEffect(() => { void load(); }, [load, patientId]);

  const consent = consentState(messages, historyComplete);
  const gatewayOff = !messagingConfigured();

  const blockedReason =
    channel === "Text"
      ? gatewayOff
        ? "Patient texting needs the Monday gateway (VITE_MONDAY_GATEWAY_URL)."
        : !tel
          ? "No phone number on file."
          : consent.optedOut
            ? consent.unknown
              ? "Can't confirm this patient hasn't opted out — the full text history didn't load. Sending is blocked until it does."
              : `This patient opted out of texts${consent.keyword ? ` (“${consent.keyword}”` : ""}${consent.since ? ` on ${fmtTime(consent.since)})` : consent.keyword ? ")" : ""}. Call them instead.`
            : null
      : !addr
        ? "No email address on file."
        : null;

  const canSend = !blockedReason && !!draft.trim() && (channel === "Text" || !!subject.trim());

  const send = async () => {
    if (!canSend || sending) return;
    setSending(true);
    try {
      if (channel === "Text") {
        await sendMessage({ to: tel, text: draft.trim(), mondayItemId: patientId });
        setDraft("");
        await load(); // refresh so the sent text appears in the thread
        toast.success("Text sent");
      } else {
        await sendViaWorker({
          recipients: [addr], cc: [], subject: subject.trim(), body: draft.trim(), files: [],
        });
        setDraft("");
        setSubject("");
        toast.success(`Email sent to ${addr}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(
        e instanceof SendValidationError ? msg : `Couldn't send ${channel.toLowerCase()}`,
        { description: e instanceof SendValidationError ? undefined : msg },
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="sect">
      <div className="sect-title">
        Patient Messages
        {channel === "Text" && messages.length > 0 && (
          <span className="rt mp green">{messages.length}</span>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <div className="flabel">Send New Message Via</div>
        <div className="seg">
          {(["Text", "Email"] as Channel[]).map((c) => (
            <button
              key={c}
              type="button"
              className={channel === c ? "on" : undefined}
              aria-pressed={channel === c}
              onClick={() => setChannel(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {channel === "Text" ? (
        <div>
          {loading && <div className="text-xs text-muted-foreground">Loading conversation…</div>}
          {loadError && (
            <div className="text-xs text-destructive">Couldn’t load the thread: {loadError}</div>
          )}
          {!loading && !loadError && messages.length === 0 && (
            <div className="text-xs text-muted-foreground">No texts with this patient yet.</div>
          )}
          {messages.map((m) => (
            <div key={m.id} className="msgbox">
              <span className="ts">[{fmtTime(m.time)}]</span>{" "}
              <span className="ch">{m.direction === "Inbound" ? "Patient:" : `${m.sentBy || "Sent"}:`}</span>{" "}
              {m.text}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          Sent email isn’t threaded back per patient — it goes out from the company mailbox and lands
          in its Sent folder.
        </div>
      )}

      {blockedReason ? (
        <p className="mt-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
          {blockedReason}
        </p>
      ) : (
        <>
          {channel === "Email" && (
            <label className="fld full" style={{ marginTop: 12 }}>
              <div className="flabel">Subject</div>
              <input
                type="text"
                value={subject}
                placeholder="Subject"
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
          )}
          <div className="note-add">
            <textarea
              value={draft}
              placeholder={channel === "Text" ? "Type a message to send…" : "Type an email to send…"}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button className="btn primary sm" disabled={!canSend || sending} onClick={send}>
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {channel === "Text"
              ? `Sends from the Medically Modern number to ${phone}. Recorded against your name.`
              : `Sends as the Medically Modern mailbox to ${addr}.`}
          </p>
        </>
      )}
    </section>
  );
}
