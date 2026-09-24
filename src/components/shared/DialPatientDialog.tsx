/**
 * Ring a patient inside the Command Center, on a screen that already owns its
 * own "log the attempt" step.
 *
 * Josh, 2026-09-23: *"when i click on a phone call number it still opens ring
 * central, it should call via a pop up inside the command center using the
 * already pre-existing outbound calling ability"*. Every patient header in the
 * app renders the number as `<a href="tel:">`, which hands the call to whatever
 * the operating system has registered — the RingCentral desktop app — and takes
 * the rep out of the page mid-patient.
 *
 * ⚠️ **DIAL ONLY — this deliberately does NOT log an attempt.**
 * `careCoordinator/CallPatientDialog` carries the note and the follow-up date
 * because that dashboard has no attempt step of its own; the intake profile
 * page does, with its own writer and its own gate. Two attempt forms on one
 * screen is the shape §5.30e records finding on this very page with Propose
 * Stuck: *"two different dialogs onto the same write"*. So this hands off to
 * the page's dialog instead of growing a second one.
 *
 * ⚠️ **THE DIAL IS THE SHARED REGISTRATION** `lib/softphone` already owns
 * (§5.13b), so nothing navigates and the call goes out on the MM main line
 * either way. It needs no answerer privileges — `softphone.doDial` calls
 * `ensureRegistered()` regardless of `enabled`, raising a registration for the
 * call and releasing it after.
 *
 * ⚠️ **NO `<CallOverlay>` HERE.** One is mounted app-wide by `IncomingCallHost`
 * and `softphoneRules.test.ts` pins that callers must not mount their own.
 */
import { useEffect } from "react";
import { Phone, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useWebPhone } from "@/hooks/assignedPatients/useWebPhone";
import { reportDial } from "@/hooks/commsInbox/useInbox";
import { formatPhoneNice } from "@/lib/shared/phoneDisplay";

const STATUS_TEXT: Record<string, string> = {
  connecting: "Connecting…",
  ringing: "Ringing…",
  connected: "On the call",
  ending: "Hanging up…",
};

export function DialPatientDialog({ open, phone: number, name, onClose, onLogAttempt }: {
  open: boolean;
  phone: string;
  name: string;
  onClose: () => void;
  /** The screen's OWN log-an-attempt step. Absent renders no button — never a
   *  second attempt form. */
  onLogAttempt?: () => void;
}) {
  const phone = useWebPhone();
  const digits = (number || "").replace(/\D/g, "");

  // ⚠️ Dial once per (open, number). Keyed on the digits rather than on a prop
  // object, because the caller rebuilds that every render and on a page that
  // polls an object-keyed effect is a call placed every poll.
  useEffect(() => {
    if (!open || !digits) return;
    // Who dialed — the call log cannot say, the whole team is one RingCentral
    // extension (§5.13b). Best-effort and only while the Communications inbox
    // is on (§5.49); it never holds the dial up.
    reportDial(number);
    phone.dial(number);
    // `phone.dial` is a stable store method; re-running on it would redial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, digits]);

  if (!open) return null;

  const live = phone.call
    && phone.call.phone.replace(/\D/g, "").endsWith(digits.slice(-10));
  const status = live ? (STATUS_TEXT[phone.call!.status] ?? phone.call!.status) : null;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-[color:var(--mm-teal)]" />
            {name || "Calling"}
          </DialogTitle>
          <DialogDescription>
            {formatPhoneNice(number)}{status ? ` · ${status}` : ""}
          </DialogDescription>
        </DialogHeader>

        {phone.error && (
          <p className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1.5 text-xs text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
            {phone.error}
          </p>
        )}

        {/* shadcn Buttons, NOT a page `.btn` class: this dialog portals to
            document.body, outside any page's design system (§9's `.pf-root`
            rule, which would render a `.btn` here as unstyled text). */}
        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Close</Button>
            {live && (
              <Button variant="outline" className="gap-1.5" onClick={() => phone.hangup()}>
                <PhoneOff className="h-4 w-4" /> Hang up
              </Button>
            )}
          </div>
          {onLogAttempt && (
            <Button
              className="gap-2 bg-amber-600 text-white hover:bg-amber-700"
              onClick={() => { onClose(); onLogAttempt(); }}
            >
              Log call attempt
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
