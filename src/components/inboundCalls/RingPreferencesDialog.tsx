/**
 * Call settings — each employee's own, and there is exactly ONE left.
 *
 * ⚠️ The ring MODES (`all`/`list`/`off`) and the pinned-number allow list are
 * GONE (Josh, 2026-09-25: *"remove the ability to select which call rings
 * them and the pinned numbers, play a ring tone in browser stays"*). Every
 * connected answerer sees every inbound call — §5.13's own model ("it does
 * not matter who picks up") with the notification filter removed. What this
 * dialog still holds is the number **"Take it" forwards to**, which claiming
 * a call cannot work without, plus a read-only line on where this browser
 * stands with the line. The ringtone and its per-browser mute live on the
 * home badge and the settings menu (§5.13b), untouched.
 *
 * Who answers calls in the BROWSER (§5.13b) is not a setting here at all: a
 * manager assigns it on the Access page, capped at RingCentral's five devices.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Headphones, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchRingPrefs, saveRingPrefs, type RingPrefs } from "@/lib/inboundCalls/callsApi";
import { useSoftphone } from "@/hooks/softphone/useSoftphone";
import type { RegistrationStatus } from "@/lib/softphone/types";
import { cn } from "@/lib/utils";

/** Where this browser stands with the line, in a sentence. */
function browserRingStatus(enabled: boolean, registration: RegistrationStatus, error: string | null): string {
  if (!enabled) return "You're not set up to answer calls in the browser. A manager assigns that on the Access page.";
  switch (registration) {
    case "registered":
      return "On. Calls ring in this browser — answer with one click.";
    case "full":
      return error || "The line is full: five devices are already registered. Retrying every minute.";
    case "error":
      return error || "Not working right now. Retrying.";
    default:
      return "Connecting this browser to the line…";
  }
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RingPreferencesDialog({ open, onOpenChange }: Props) {
  const phone = useSoftphone();
  const [prefs, setPrefs] = useState<RingPrefs | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Latest-wins bookkeeping for persist(); see the note there. */
  const saveSeq = useRef(0);
  const inFlight = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchRingPrefs()
      .then(setPrefs)
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [open]);

  /**
   * Persist immediately — a settings panel with a Save button people forget to
   * press is a settings panel that silently doesn't work. Writes are
   * SERIALISED and superseded ones are dropped, so only the newest intent is
   * written (the rule this dialog has always had).
   */
  const persist = useCallback((next: RingPrefs) => {
    setPrefs(next);
    const seq = ++saveSeq.current;
    setSaving(true);
    inFlight.current = inFlight.current
      .catch(() => {})
      .then(async () => {
        if (seq !== saveSeq.current) return;
        try {
          await saveRingPrefs({ forwardNumber: next.forwardNumber });
        } catch (e) {
          toast.error((e as Error).message);
        }
      })
      .finally(() => {
        if (seq === saveSeq.current) setSaving(false);
      });
  }, []);

  const askNotifications = async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    if (result === "granted") toast.success("You'll get a desktop alert when the tab is in the background.");
    else toast.info("Desktop alerts stay off. Calls still appear in the app.");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Call settings</DialogTitle>
          <DialogDescription>
            Everyone shares the main line, every call reaches everyone connected, and anyone can
            pick up.
          </DialogDescription>
        </DialogHeader>

        {loading || !prefs ? (
          <div className="py-10 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Read-only: the assignment lives on the Access page. Leads the
                dialog because it decides whether a ring is a click or a
                transfer to your cell. */}
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-3">
                <Headphones className="h-4 w-4 text-muted-foreground shrink-0" />
                <p className="text-sm font-medium flex-1">Answering in the browser</p>
              </div>
              <p
                className={cn(
                  "text-[11px]",
                  phone.enabled && (phone.registration === "full" || phone.registration === "error")
                    ? "text-amber-700"
                    : "text-muted-foreground",
                )}
              >
                {browserRingStatus(phone.enabled, phone.registration, phone.registrationError)}
              </p>
              {phone.enabled && (
                <p className="text-[11px] text-muted-foreground">
                  RingCentral allows five devices on the shared line at once. Every browser you open
                  the Command Center in counts as one, and a RingCentral app still signed in counts
                  too.
                </p>
              )}
            </div>

            {/* Without this the Take-it button has nowhere to send the call. */}
            <div className="space-y-1.5">
              <label htmlFor="ring-at" className="text-sm font-medium">
                Ring me at
              </label>
              <input
                id="ring-at"
                value={prefs.forwardNumber}
                onChange={(e) => setPrefs({ ...prefs, forwardNumber: e.target.value })}
                onBlur={() => void persist(prefs)}
                placeholder="(347) 555-0123"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <p className="text-[11px] text-muted-foreground">
                Your desk phone or cell. Take it transfers the ringing call here — the way to pick
                up from a browser that isn't answering calls itself.
              </p>
            </div>

            <button
              onClick={() => void askNotifications()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50"
            >
              <Bell className="h-4 w-4" />
              Alert me when this tab is in the background
            </button>

            <p className="text-[11px] text-muted-foreground text-right h-4">
              {saving ? "Saving…" : "Saved automatically"}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
