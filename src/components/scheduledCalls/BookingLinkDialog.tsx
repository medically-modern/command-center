/**
 * Send someone the Calendly booking link, by text or email.
 *
 * The form's embed covers patients who reach the end of it. This covers
 * everyone else — a patient who dropped off, someone who phoned in, a referral
 * a rep is chasing — without making them start a form they have already half
 * filled in.
 *
 * Both transports are the app's existing ones: the RingCentral relay every
 * other composer texts through, and the Cloudflare worker every panel emails
 * through. Nothing new is sent from the browser.
 */
import { useEffect, useState } from "react";
import { Loader2, Mail, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { sendMessage, fetchConversation, messagingConfigured } from "@/lib/assignedPatients/messagingApi";
import { isOptedOut } from "@/lib/assignedPatients/optOut";
import { sendViaWorker, SendValidationError } from "@/lib/shared/sendViaWorker";
import { cn } from "@/lib/utils";

/**
 * Where the booking link comes from.
 *
 * Read live from the form's backend so there is ONE source — the same endpoint
 * the patient form asks. The constant is a fallback for when that service is
 * unreachable: a stale link still books a real call, whereas no link at all
 * means the rep cannot do the thing they opened this dialog to do.
 */
const SCHEDULING_ENDPOINT = "https://dtc-mm-form-api-production.up.railway.app/api/intake/scheduling";
const FALLBACK_URL = "https://calendly.com/records-medicallymodern/medically-modern-intake-call";

type Mode = "text" | "email";

const digits = (s: string) => s.replace(/\D/g, "");

function defaultMessage(url: string, name: string): string {
  const hi = name.trim() ? `Hi ${name.trim().split(/\s+/)[0]}, ` : "Hi, ";
  return `${hi}it's Medically Modern. Pick a time for a quick 10-minute call and we'll walk you through your options: ${url}`;
}

export default function BookingLinkDialog({
  open, onOpenChange, patientName, phone, email,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Optional prefill. Scheduled Calls opens this with no patient in hand and
   *  passes nothing, so it behaves exactly as before. Patient Intake opens it
   *  from a record already on screen — making the rep retype the name and
   *  number they are looking at is how a button goes unused. */
  patientName?: string;
  phone?: string;
  email?: string;
}) {
  const [url, setUrl] = useState(FALLBACK_URL);
  const [mode, setMode] = useState<Mode>("text");
  const [name, setName] = useState("");
  const [to, setTo] = useState("");
  const [body, setBody] = useState(defaultMessage(FALLBACK_URL, ""));
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch(SCHEDULING_ENDPOINT)
      .then((r) => r.json())
      .then((d) => { if (d?.enabled && d.url) setUrl(d.url); })
      .catch(() => { /* fallback already in state */ });
  }, [open]);

  /**
   * Seed from the patient ON OPEN only.
   *
   * Keyed to `open` rather than to the props so a poll that re-renders the
   * parent mid-compose cannot overwrite a recipient the rep has corrected —
   * the intake page refreshes every 15s, so that would happen constantly.
   * Defaults to whichever channel we actually have, since texting an empty
   * box is the same dead end as before.
   */
  useEffect(() => {
    if (!open) return;
    const p = digits(phone ?? "");
    const e = (email ?? "").trim();
    setName(patientName ?? "");
    setTouched(false);
    if (p.length >= 10) { setMode("text"); setTo(p); }
    else if (e) { setMode("email"); setTo(e); }
    // No contact details at all: leave the picker as-is and let the rep type.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open is the trigger; see above
  }, [open]);

  // Keep the draft in step with the link and the name until the rep edits it —
  // after that it is theirs, and rewriting what somebody typed is worse than a
  // slightly stale opener.
  useEffect(() => {
    if (!touched) setBody(defaultMessage(url, name));
  }, [url, name, touched]);

  const reset = () => {
    setName(""); setTo(""); setTouched(false); setBody(defaultMessage(url, ""));
  };

  async function send() {
    const dest = to.trim();
    if (!dest) { toast.error("Who should this go to?"); return; }

    setSending(true);
    try {
      if (mode === "text") {
        const d = digits(dest);
        if (d.length < 10) { toast.error("That doesn't look like a phone number"); return; }
        if (!messagingConfigured()) { toast.error("Texting isn't configured"); return; }

        // Never text somebody who has opted out. Every other composer in the
        // app checks this; a new one that skips it is how a STOP gets ignored.
        try {
          const { messages } = await fetchConversation(d);
          if (isOptedOut(messages)) {
            toast.error("This number has opted out of texts", {
              description: "Send them the link by email instead.",
            });
            return;
          }
        } catch {
          // A thread we cannot read is not proof of consent either way. Let the
          // send proceed — blocking on a transient read would stop legitimate
          // sends far more often than it would catch an opt-out.
        }

        await sendMessage({ to: d, text: body });
        toast.success("Booking link texted");
      } else {
        if (!dest.includes("@")) { toast.error("That doesn't look like an email address"); return; }
        await sendViaWorker({
          recipients: [dest],
          cc: [],
          subject: "Book your call with Medically Modern",
          body,
          files: [],
        });
        toast.success("Booking link emailed");
      }
      reset();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof SendValidationError || e instanceof Error ? e.message : "Could not send";
      toast.error("Not sent", { description: msg });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send a booking link</DialogTitle>
          <DialogDescription>
            They pick their own time. It lands here as soon as they book.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            {(["text", "email"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setTo(""); }}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm",
                  mode === m ? "border-sky-500 bg-sky-50 font-medium dark:bg-sky-950/40" : "hover:bg-accent",
                )}
              >
                {m === "text" ? <MessageSquare className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                {m === "text" ? "Text" : "Email"}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium">First name <span className="font-normal text-muted-foreground">(optional)</span></span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane"
                className="w-full rounded-md border px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">{mode === "text" ? "Mobile number" : "Email address"}</span>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                inputMode={mode === "text" ? "tel" : "email"}
                placeholder={mode === "text" ? "(347) 555-0101" : "jane@example.com"}
                className="w-full rounded-md border px-2.5 py-1.5 text-sm"
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Message</span>
            <textarea
              value={body}
              onChange={(e) => { setBody(e.target.value); setTouched(true); }}
              rows={4}
              className="w-full resize-y rounded-md border px-2.5 py-1.5 text-sm"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              {body.length} characters{mode === "text" && body.length > 300 ? " — long for one text" : ""}
            </span>
          </label>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => onOpenChange(false)}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={() => void send()}
              disabled={sending || !to.trim()}
              className="flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send {mode === "text" ? "text" : "email"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
