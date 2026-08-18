/**
 * "Messages" — the patient conversation card on the intake page: the recent
 * TEXT thread, readable without opening anything, with the email composer
 * behind a second tab.
 *
 * ── Why the thread is re-implemented here ──────────────────────────────────
 * Not for lack of a component: `assignedPatients/ConversationThread` already
 * does this. But it is built from shadcn controls, and `.pf-root button` strips
 * background and border off every button underneath it — the same trap that
 * stopped Evaluate's NotesPanel being dropped onto this page (it rendered as
 * bare text on a bare box). What has to agree between the two screens is
 * BEHAVIOUR, so the API calls and the opt-out guard are shared —
 * `fetchConversation`, `sendMessage`, `consentState` — and only the markup is
 * this page's own. Same rule the Call Log follows with `appendStampedNote`.
 *
 * ── Two composers, on purpose ──────────────────────────────────────────────
 * The Text button beside the patient's name stays (Katie, 2026-08-13). This
 * card used to be email-only precisely to avoid two text boxes for one
 * conversation "with only one of them showing the history" — that objection is
 * answered rather than ignored: both entry points now send through the same
 * helpers, both are bound by the same opt-out guard, and both stamp the Call
 * Log through `onTextSent`. The thread reloads after a send from here, and the
 * popup's own send lands in the same RingCentral history this card reads.
 */
import { MessageAttachments } from "@/components/shared/MessageAttachments";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { sendViaWorker, SendValidationError } from "@/lib/shared/sendViaWorker";
import { appendIntakeNote } from "@/lib/profile/unverifiedWrite";
import {
  fetchConversation, sendMessage, messagingConfigured,
  type ConversationMessage,
} from "@/lib/assignedPatients/messagingApi";
import { consentState } from "@/lib/assignedPatients/optOut";

type Tab = "text" | "email";

const stamp = (iso: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-US", {
        month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit",
      });
};

export function IntakeMessages({
  patientId, email, phone, onTextSent,
}: {
  patientId: string;
  email?: string;
  /** Patient's mobile. Blank hides the text tab's composer, not the tab. */
  phone?: string;
  /** Stamps the Call Log — the page owns that, so it is passed in. */
  onTextSent?: (body: string) => void;
}) {
  const addr = (email ?? "").trim();
  const tel = (phone ?? "").trim();
  const [tab, setTab] = useState<Tab>("text");

  // ── text ──────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  // ⚠️ Starts FALSE and resets on every patient change and every failed load.
  // Starting true means an empty list reads as "complete history, no STOP
  // found", which would leave the composer live during the load and after a
  // load that failed outright. Not knowing must never look like consent.
  // (Same reasoning as ConversationThread — kept identical on purpose.)
  const [historyComplete, setHistoryComplete] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [texting, setTexting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const configured = messagingConfigured();

  const loadThread = useCallback(async (showSpinner: boolean) => {
    if (!tel || !configured) return;
    if (showSpinner) setLoadingThread(true);
    try {
      const thread = await fetchConversation(tel);
      setMessages(thread.messages);
      setHistoryComplete(thread.complete);
      setThreadError(null);
    } catch (e) {
      // A history we couldn't read is a history we can't clear for sending.
      setHistoryComplete(false);
      setThreadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingThread(false);
    }
  }, [tel, configured]);

  // Load as soon as the card mounts for this patient — "instantly viewable"
  // is the whole point of the card, so it must not wait on a click.
  useEffect(() => {
    setMessages([]);
    setHistoryComplete(false);
    setThreadError(null);
    setText("");
    setTab("text");
    void loadThread(true);
  }, [patientId, loadThread]);

  // Newest at the bottom, scrolled into view, so the recent exchange is what
  // the rep sees without touching the scrollbar.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, tab]);

  const consent = consentState(messages, historyComplete);
  const canText = !!tel && configured && !consent.optedOut && !!text.trim() && !texting;

  const sendText = async () => {
    const body = text.trim();
    if (!body || texting || consent.optedOut) return;
    setTexting(true);
    try {
      await sendMessage({ to: tel, text: body, mondayItemId: patientId });
      setText("");
      await loadThread(false);
      // Best-effort, and deliberately after the send: the text has gone, so a
      // failed note must never read as a failed send.
      onTextSent?.(body);
    } catch (e) {
      toast.error("Couldn't send the text", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTexting(false);
    }
  };

  // ── email ─────────────────────────────────────────────────────────────────
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => { setSubject(""); setBody(""); }, [patientId]);

  const canSend = !!addr && !!subject.trim() && !!body.trim() && !sending;

  const sendEmail = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await sendViaWorker({
        recipients: [addr], cc: [], subject: subject.trim(), body: body.trim(), files: [],
      });
      // The Call Log is where all free text lives for future reference (Josh,
      // 2026-08-10). A sent email has no per-patient store to read back —
      // unlike a text, which keeps its RingCentral thread — so without this
      // line there is no record on the patient that we ever wrote to them.
      // Best-effort: the email HAS gone, so a failed note must not read as a
      // failed send.
      try {
        await appendIntakeNote(patientId, `Email to ${addr} — ${subject.trim()}: ${body.trim()}`);
      } catch {
        /* surfaced by the toast below; the send itself succeeded */
      }
      setSubject("");
      setBody("");
      toast.success(`Email sent to ${addr}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(
        e instanceof SendValidationError ? msg : "Couldn't send the email",
        { description: e instanceof SendValidationError ? undefined : msg },
      );
    } finally {
      setSending(false);
    }
  };

  // ── optOut copy ───────────────────────────────────────────────────────────
  // A pending check is not an accusation: only read as a block once we know
  // something. `unknown` means we could not confirm, not that they said stop.
  const blockedNote = (): string => {
    if (!consent.unknown) {
      return `This patient replied ${(consent.keyword || "stop").toUpperCase()}${
        consent.since ? ` on ${new Date(consent.since).toLocaleDateString("en-US")}` : ""
      } and is opted out of texts. Call them instead — texting is blocked.`;
    }
    if (loadingThread) return "Checking whether this patient has opted out of texts…";
    if (threadError) {
      return "This conversation didn't load, so we can't confirm whether the patient has "
        + "opted out of texts. Texting is blocked until it does — hit Reload, or call them.";
    }
    return "This conversation is too long to load in full, so we can't confirm whether the "
      + "patient has opted out of texts. Texting is blocked rather than risk messaging "
      + "someone who asked us to stop — call them instead.";
  };

  return (
    <section className="sect">
      <div className="sect-title">
        Messages
        <span className="rt sugg-note">{tab === "text" ? tel : addr}</span>
      </div>

      <div className="pills" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={tab === "text" ? "pillbtn on" : "pillbtn"}
          onClick={() => setTab("text")}
        >
          Text
        </button>
        <button
          type="button"
          className={tab === "email" ? "pillbtn on" : "pillbtn"}
          onClick={() => setTab("email")}
        >
          Email
        </button>
      </div>

      {tab === "text" ? (
        !tel ? (
          <p className="sugg-note">No mobile number on file.</p>
        ) : !configured ? (
          <p className="sugg-note">Texting isn't available in this build.</p>
        ) : (
          <>
            <div className="thread">
              {loadingThread ? (
                <p className="sugg-note">Loading conversation…</p>
              ) : threadError ? (
                <p className="sugg-note">Couldn't load the conversation — {threadError}</p>
              ) : messages.length === 0 ? (
                <p className="sugg-note">No texts with this patient yet.</p>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={m.direction === "Outbound" ? "msgbox out" : "msgbox"}
                  >
                    <div className="ts">
                      <span className="ch">
                        {m.direction === "Outbound" ? m.sentBy || "Medically Modern" : "Patient"}
                      </span>
                      {" · "}
                      {stamp(m.time)}
                      {/* Sends made outside Command Center (or before sender
                          tracking existed) have nobody on record — say so
                          rather than leaving the reader to guess. */}
                      {m.direction === "Outbound" && !m.sentBy ? " · sent outside Command Center" : ""}
                    </div>
                    <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.text}</div>
                    <MessageAttachments attachments={m.attachments} />
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>

            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                className="btn secondary sm"
                disabled={loadingThread}
                onClick={() => { void loadThread(true); }}
              >
                {loadingThread ? "Reloading…" : "Reload"}
              </button>
              <span className="sugg-note">Sends from the Medically Modern number.</span>
            </div>

            {consent.optedOut ? (
              <div className={consent.unknown ? "msgbox" : "msgbox rose"} style={{ marginTop: 10 }}>
                {blockedNote()}
              </div>
            ) : (
              <div className="note-add">
                <textarea
                  value={text}
                  placeholder={`Text ${tel}…`}
                  onChange={(e) => setText(e.target.value)}
                />
                <button
                  className="btn primary sm"
                  disabled={!canText}
                  onClick={() => { void sendText(); }}
                >
                  {texting ? "Sending…" : "Send"}
                </button>
              </div>
            )}
          </>
        )
      ) : !addr ? (
        <p className="sugg-note">No email address on file.</p>
      ) : (
        <>
          <label className="fld full">
            <div className="flabel">Subject</div>
            <input
              type="text"
              value={subject}
              placeholder="Subject"
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <div className="note-add">
            <textarea
              value={body}
              placeholder={`Write to ${addr}…`}
              onChange={(e) => setBody(e.target.value)}
            />
            <button
              className="btn primary sm"
              disabled={!canSend}
              onClick={() => { void sendEmail(); }}
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
          <div className="mt-2">
            <span className="sugg-note">Sends as the Medically Modern mailbox.</span>
          </div>
        </>
      )}
    </section>
  );
}
