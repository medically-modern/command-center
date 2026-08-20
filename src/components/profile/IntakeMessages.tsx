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
import SmsDeliveryNote from "@/components/shared/SmsDeliveryNote";
import { useDeliveryRecheck } from "@/hooks/useDeliveryRecheck";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { sendViaWorker, SendValidationError } from "@/lib/shared/sendViaWorker";
import { appendIntakeNote } from "@/lib/profile/unverifiedWrite";
import {
  fetchConversation, sendMessage, messagingConfigured,
  type ConversationMessage,
} from "@/lib/assignedPatients/messagingApi";
import { consentState } from "@/lib/assignedPatients/optOut";
import {
  fetchEmailThreads, fetchEmailThread, sendEmailReply, replyHeadersFor,
  GmailScopeMissingError,
  type EmailThreadSummary, type EmailThreadMessage,
} from "@/lib/shared/emailThreads";

type Tab = "text" | "email";

const stamp = (t: string | number): string => {
  if (!t) return "";
  const d = new Date(t);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-US", {
        month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit",
      });
};

/** "Jane Doe <jane@x.com>" → "Jane Doe"; a bare address stays an address. */
const fromName = (from: string): string => {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*</);
  return m?.[1]?.trim() || from.replace(/[<>]/g, "").trim() || "Patient";
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
  // A delivery failure lands seconds AFTER the send resolves — see the hook.
  // ⚠️ Destructured on purpose. The effect below needs `cancel`, and listing
  // the whole hook result there is what looped this card (see the hook). The
  // functions are stable; the object was not — and now both are.
  const { schedule: scheduleRecheck, cancel: cancelRecheck } = useDeliveryRecheck();

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
    // ⚠️ Before anything else: a recheck armed for the PREVIOUS patient would
    // fetch their conversation and paint it into this one.
    cancelRecheck();
    setMessages([]);
    setHistoryComplete(false);
    setThreadError(null);
    setText("");
    setTab("text");
    void loadThread(true);
  }, [patientId, loadThread, cancelRecheck]);

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
      // This first read shows it Queued; the failure, if any, arrives later.
      scheduleRecheck(() => loadThread(false));
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

  // ── email history (previous Gmail threads with this address) ──────────────
  const [threads, setThreads] = useState<EmailThreadSummary[]>([]);
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  // The mailbox's token lacks gmail.readonly — setup guidance, not an error.
  const [needsScope, setNeedsScope] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openMsgs, setOpenMsgs] = useState<EmailThreadMessage[]>([]);
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);
  // Guards the async loads against a quick thread/patient switch — only the
  // still-open thread may set messages.
  const openIdRef = useRef<string | null>(null);

  useEffect(() => {
    setSubject(""); setBody("");
    setThreads([]); setThreadsLoaded(false); setThreadsError(null); setNeedsScope(false);
    setOpenId(null); setOpenMsgs([]); setOpenError(null); setReply("");
    openIdRef.current = null;
  }, [patientId, addr]);

  const loadThreads = useCallback(async () => {
    if (!addr) return;
    setThreadsLoading(true);
    setThreadsError(null);
    setNeedsScope(false);
    try {
      setThreads(await fetchEmailThreads(addr));
    } catch (e) {
      setThreads([]);
      if (e instanceof GmailScopeMissingError) setNeedsScope(true);
      else setThreadsError(e instanceof Error ? e.message : String(e));
    } finally {
      setThreadsLoading(false);
      setThreadsLoaded(true);
    }
  }, [addr]);

  // Loaded when the rep first OPENS the email tab — not on mount like the
  // text thread. Email is the second tab, and a Gmail search per sidebar
  // click would be waste for a card most opens never flip.
  useEffect(() => {
    if (tab === "email" && addr && !threadsLoaded && !threadsLoading) void loadThreads();
  }, [tab, addr, threadsLoaded, threadsLoading, loadThreads]);

  const openThread = async (id: string) => {
    if (openId === id) {
      // Toggle closed.
      setOpenId(null);
      openIdRef.current = null;
      return;
    }
    setOpenId(id);
    openIdRef.current = id;
    setOpenMsgs([]);
    setOpenError(null);
    setReply("");
    setOpenLoading(true);
    try {
      const msgs = await fetchEmailThread(id);
      if (openIdRef.current === id) setOpenMsgs(msgs);
    } catch (e) {
      if (openIdRef.current === id) setOpenError(e instanceof Error ? e.message : String(e));
    } finally {
      if (openIdRef.current === id) setOpenLoading(false);
    }
  };

  const sendReply = async () => {
    const bodyTxt = reply.trim();
    if (!bodyTxt || replying || !openId || !addr) return;
    setReplying(true);
    try {
      const h = replyHeadersFor(openMsgs);
      await sendEmailReply({
        threadId: openId, to: addr, subject: h.subject, body: bodyTxt,
        inReplyTo: h.inReplyTo, references: h.references,
      });
      // Same record-keeping as a fresh email, and deliberately AFTER the
      // send — the reply has gone, so a failed note must not read as a
      // failed send.
      try {
        await appendIntakeNote(patientId, `Email reply to ${addr} — ${h.subject || "(no subject)"}: ${bodyTxt}`);
      } catch { /* the send itself succeeded */ }
      setReply("");
      toast.success(`Reply sent to ${addr}`);
      // Re-read so the rep sees their reply land in the thread; a failed
      // refresh just leaves the old view (it shows on the next open).
      try {
        const msgs = await fetchEmailThread(openId);
        if (openIdRef.current === openId) setOpenMsgs(msgs);
      } catch { /* non-fatal */ }
    } catch (e) {
      toast.error("Couldn't send the reply", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setReplying(false);
    }
  };

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
                    {/* A text RingCentral could not deliver. skin="page" is
                        required in here — see the component's own note. */}
                    <SmsDeliveryNote
                      direction={m.direction}
                      messageStatus={m.messageStatus}
                      deliveryError={m.deliveryError}
                      skin="page"
                    />
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
          {/* ── previous conversations with this address ── */}
          <div className="eth-head">
            <span>Previous emails</span>
            <button
              type="button"
              className="btn secondary sm"
              disabled={threadsLoading}
              onClick={() => { void loadThreads(); }}
            >
              {threadsLoading ? "Loading…" : "Reload"}
            </button>
          </div>
          {needsScope ? (
            <div className="msgbox amber">
              Email history needs a one-time authorization on the Medically Modern
              mailbox (Gmail read access). Sending works either way — ask Josh to
              connect it.
            </div>
          ) : threadsError ? (
            <p className="sugg-note">Couldn't load email history — {threadsError}</p>
          ) : threadsLoading && !threadsLoaded ? (
            <p className="sugg-note">Searching the mailbox…</p>
          ) : threadsLoaded && threads.length === 0 ? (
            <p className="sugg-note">No previous emails with {addr}.</p>
          ) : (
            threads.map((t) => (
              <div key={t.id} className="eth">
                <button type="button" className="eth-row" onClick={() => { void openThread(t.id); }}>
                  <span className="eth-subj">{t.subject || "(no subject)"}</span>
                  <span className="eth-meta">
                    {stamp(t.lastAt)} · {t.count} message{t.count === 1 ? "" : "s"}
                  </span>
                  {openId !== t.id && !!t.snippet && <span className="eth-snip">{t.snippet}</span>}
                </button>
                {openId === t.id && (
                  <div className="eth-open">
                    {openLoading ? (
                      <p className="sugg-note">Loading messages…</p>
                    ) : openError ? (
                      <p className="sugg-note">Couldn't open this conversation — {openError}</p>
                    ) : (
                      openMsgs.map((m) => (
                        <div key={m.id} className={m.mine ? "msgbox out" : "msgbox"}>
                          <div className="ts">
                            <span className="ch">{m.mine ? "Medically Modern" : fromName(m.from)}</span>
                            {" · "}
                            {stamp(m.date)}
                          </div>
                          <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.body}</div>
                        </div>
                      ))
                    )}
                    {!openLoading && !openError && (
                      <div className="note-add">
                        <textarea
                          value={reply}
                          placeholder={`Reply to ${addr}…`}
                          onChange={(e) => setReply(e.target.value)}
                        />
                        <button
                          className="btn primary sm"
                          disabled={!reply.trim() || replying}
                          onClick={() => { void sendReply(); }}
                        >
                          {replying ? "Sending…" : "Reply"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}

          <div className="divider" />

          {/* ── new email ── */}
          <div className="eth-head">
            <span>New email</span>
          </div>
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
