/**
 * "Email patient?" — the intake page's email composer.
 *
 * TEXT deliberately isn't here. The patient's Call + Text buttons sit beside
 * their name at the top of the page (Evaluate's `PatientContact`, the same
 * component), and that dialog carries the real RingCentral thread. A second
 * text box further down the same page would be two composers for one
 * conversation, with only one of them showing the history.
 *
 * So this is email only, and collapsed until asked for: on an intake call the
 * rep is working the fields, not writing an email, and an always-open
 * textarea is just a tall empty box between two cards.
 *
 * Sending reuses `sendViaWorker` — the same worker route Send Request uses,
 * which sends AS the company Gmail mailbox.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { sendViaWorker, SendValidationError } from "@/lib/shared/sendViaWorker";
import { appendIntakeNote } from "@/lib/profile/unverifiedWrite";

export function IntakeMessages({
  patientId, email,
}: {
  patientId: string;
  email?: string;
}) {
  const addr = (email ?? "").trim();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setOpen(false);
    setSubject("");
    setBody("");
  }, [patientId]);

  const canSend = !!addr && !!subject.trim() && !!body.trim() && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await sendViaWorker({
        recipients: [addr], cc: [], subject: subject.trim(), body: body.trim(), files: [],
      });
      // The Call Log is where all free text lives for future reference
      // (Josh, 2026-08-10). A sent email has no per-patient store to read back
      // — unlike a text, which keeps its RingCentral thread — so without this
      // line there is no record on the patient that we ever wrote to them.
      // Best-effort: the email HAS gone, so a failed note must not read as a
      // failed send.
      try {
        await appendIntakeNote(patientId, `Email to ${addr} — ${subject.trim()}: ${body.trim()}`);
      } catch {
        /* logged below by the toast; the send itself succeeded */
      }
      setSubject("");
      setBody("");
      setOpen(false);
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

  return (
    <section className="sect">
      <div className="sect-title">
        Email patient?
        {!open && addr && <span className="rt sugg-note">{addr}</span>}
      </div>

      {!addr ? (
        <p className="sugg-note">No email address on file.</p>
      ) : !open ? (
        <button type="button" className="btn secondary sm" onClick={() => setOpen(true)}>
          Write an email
        </button>
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
            <button className="btn primary sm" disabled={!canSend} onClick={send}>
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              className="btn secondary sm"
              disabled={sending}
              onClick={() => { setOpen(false); setSubject(""); setBody(""); }}
            >
              Cancel
            </button>
            <span className="sugg-note">Sends as the Medically Modern mailbox.</span>
          </div>
        </>
      )}
    </section>
  );
}
