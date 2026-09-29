/**
 * Ringing a patient without leaving the dashboard, and what to do next.
 *
 * Brandon, 2026-09-22: *"when i make a call - it takes me out of command
 * center. It should show up in command center, and then in the pop-up there
 * should be 2 buttons (for both intake and welcome call): Open Profile, Log
 * Call Attempt (with notes)"*.
 *
 * ⚠️ **THE DIAL IS THE BROWSER SOFTPHONE, NOT A `tel:` HANDOFF.** Every other
 * patient header in the app renders the number as `<a href="tel:">`, which
 * hands the call to whatever the operating system has registered and takes the
 * coordinator out of the page mid-queue. This dials through the ONE shared
 * registration `lib/softphone` already owns (§5.13b), so nothing navigates and
 * the call is on the MM main line either way.
 *
 * ⚠️ It needs no answerer privileges. `softphone.doDial` calls
 * `ensureRegistered()` regardless of `enabled`, raising a registration for the
 * call and releasing it afterwards — so this works for anybody, and for one of
 * the five assigned answerers (Masani is one, Josh 2026-09-22) the
 * registration is already warm and there is no connect delay.
 *
 * ⚠️ **NO `<CallOverlay>` HERE.** One is mounted app-wide by
 * `IncomingCallHost`, because an answered inbound call needs it on every page,
 * and `softphoneRules.test.ts` pins that callers must not mount their own. So
 * this dialog reports the call's state and the overlay carries mute and hang
 * up, exactly as the Communications Hub does.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Phone, PhoneOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useWebPhone } from "@/hooks/assignedPatients/useWebPhone";
import { reportDial } from "@/hooks/commsInbox/useInbox";
import { attemptSlot, defaultFollowUpDateFor } from "@/lib/careCoordinator/followUp";
import { nowMinutesEt } from "@/lib/scheduledCalls/workflow";
import { logCallAttempt, type CallAttemptTarget } from "@/lib/careCoordinator/callAttempt";
import { etToday } from "@/lib/masheke/etDate";
import { formatPhoneNice } from "@/lib/shared/phoneDisplay";

export interface CallTarget extends CallAttemptTarget {
  phone: string;
  /** Deep link into the stage page that WORKS this patient — the card's own. */
  openHref: string;
  /**
   * False opens the dialog as the attempt form ALONE — no dial. The post-call
   * path (Josh, 2026-09-25: *"make sure log call attempt here is wired up to
   * work post and during call"*): before this, the only way back to the form
   * after closing it was the Call button, and that placed a whole new call.
   * Absent means dial, which is every Call button's existing contract.
   */
  dial?: boolean;
}

const STATUS_TEXT: Record<string, string> = {
  connecting: "Connecting…",
  ringing: "Ringing…",
  connected: "On the call",
  ending: "Hanging up…",
};

export function CallPatientDialog({ target, onClose, onLogged }: {
  /** Null when nothing is open. The dialog is keyed on the patient by the
   *  caller, so a draft note can never survive a change of patient (§9). */
  target: CallTarget | null;
  onClose: () => void;
  /** Fired after a successful write so the column can re-read the board. */
  onLogged: () => void;
}) {
  const phone = useWebPhone();
  const [note, setNote] = useState("");
  // ⚠️ Morning ⇒ TODAY (the card rests until noon, §5.30k); afternoon ⇒ tomorrow.
  const [followUp, setFollowUp] = useState(() => defaultFollowUpDateFor(etToday(), nowMinutesEt()));
  const [saving, setSaving] = useState(false);

  // ⚠️ Dial on OPEN, once per patient. `target` is a fresh object each render
  // in the caller, so the effect keys on the ITEM — without that this redials
  // on every re-render of the page, which on a dashboard that polls is a call
  // placed every minute.
  // ⚠️ Two dials it must NOT place (Josh, 2026-09-25):
  //   · `dial: false` is the log-only opening — the post-call "Log attempt"
  //     buttons — and dialing there rings a patient who was just spoken to;
  //   · a call to this number ALREADY live means the coordinator closed the
  //     form mid-call and pressed Call to get it back — dialing again would
  //     place a second call on top of the one still going.
  const itemId = target?.itemId ?? "";
  useEffect(() => {
    if (!target || target.dial === false) return;
    const digits = target.phone.replace(/\D/g, "").slice(-10);
    if (digits && phone.call && phone.call.phone.replace(/\D/g, "").endsWith(digits)) return;
    // Who dialed — the call log can't say (§5.13b). The Communications inbox
    // reads it for "We called · <name>"; a no-op while that module is off.
    reportDial(target.phone);
    phone.dial(target.phone);
    // `phone.dial` is a stable store method; re-running on it would redial,
    // and `phone.call` is only the mount-time guard, not a retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  useEffect(() => {
    if (!target) return;
    setNote("");
    setFollowUp(defaultFollowUpDateFor(etToday(), nowMinutesEt()));
  }, [itemId, target]);

  if (!target) return null;

  const live = phone.call && phone.call.phone.replace(/\D/g, "").endsWith(target.phone.replace(/\D/g, "").slice(-10));
  const status = live ? (STATUS_TEXT[phone.call!.status] ?? phone.call!.status) : null;

  const submit = async () => {
    setSaving(true);
    try {
      const res = await logCallAttempt(target, note, followUp);
      if (res.noteFailed) {
        // The counter moved and the note didn't, so the attempt now exists with
        // nothing saying what came of it — say so rather than reporting a clean
        // save (the profile page's own rule).
        toast.error(`Attempt ${res.attempt} logged, but the note didn't save`, { description: res.noteFailed });
      } else {
        toast.success(`Attempt ${res.attempt} logged`, {
          description: followUp === etToday()
            ? `${target.name || "They"} come back after 12 PM today.`
            : `${target.name || "They"} come back on ${followUp}.`,
        });
      }
      onLogged();
      onClose();
    } catch (e) {
      toast.error("Couldn't log the attempt", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-[color:var(--mm-teal)]" />
            {target.name || "Calling"}
          </DialogTitle>
          <DialogDescription>
            {formatPhoneNice(target.phone) || "No phone on file"}
            {status ? ` · ${status}` : ""}
          </DialogDescription>
        </DialogHeader>

        {phone.error && (
          <p className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1.5 text-xs text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
            {phone.error}
          </p>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="cc-attempt-note">What happened on the call?</label>
          <textarea
            id="cc-attempt-note"
            className="min-h-[88px] w-full rounded-md border border-input bg-background p-2 text-sm"
            value={note}
            placeholder="No answer, left voicemail…"
            onChange={(e) => setNote(e.target.value)}
          />
          {/* Required, and said out loud — the counter on its own never records
              what was said, so a note-less attempt is indistinguishable from no
              attempt to whoever picks the patient up next. */}
          <p className="text-xs text-muted-foreground">
            Required. The counter records that somebody called; this is the only record of what came of it.
          </p>
          <label className="block text-sm font-medium" htmlFor="cc-attempt-follow-up">Follow up on</label>
          <input
            id="cc-attempt-follow-up"
            type="date"
            min={etToday()}
            className="w-full rounded-md border border-input bg-background p-2 text-sm"
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
          />
          {/* Josh, 2026-09-29: a morning attempt takes them off the list until
              the afternoon, an afternoon one until tomorrow — said here so the
              default date is not a surprise. */}
          <p className="text-xs text-muted-foreground" data-testid="cc-attempt-follow-up-hint">
            {followUp === etToday()
              ? "Today: they leave the list now and come back after 12 PM. Pick a later date to push them further out."
              : attemptSlot(nowMinutesEt()) === "morning"
                ? "They come back on that day. (Before noon, leaving it on today brings them back this afternoon.)"
                : "They come back on that day."}
          </p>
        </div>

        {/* shadcn Buttons, NOT a page `.btn` class: this dialog portals to
            document.body, outside any page's design system. */}
        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to={target.openHref}>Open Profile</Link>
            </Button>
            {live && (
              <Button variant="outline" className="gap-1.5" onClick={() => phone.hangup()}>
                <PhoneOff className="h-4 w-4" /> Hang up
              </Button>
            )}
          </div>
          <Button
            className="gap-2 bg-amber-600 text-white hover:bg-amber-700"
            disabled={saving || !note.trim() || !followUp}
            onClick={() => void submit()}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Logging…" : "Log Call Attempt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
