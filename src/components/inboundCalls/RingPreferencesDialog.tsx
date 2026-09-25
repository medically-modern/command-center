/**
 * Call settings — status and alerts only, no settings left to store.
 *
 * ⚠️ The ring MODES (`all`/`list`/`off`) and the pinned-number allow list went
 * on 2026-09-25 (*"remove the ability to select which call rings them and the
 * pinned numbers, play a ring tone in browser stays"*), and the **"Take it"
 * forward number went the same night** (Josh: *"cut this we dont do call
 * forwarding anymore everyone answers in the browser"*). So this dialog now
 * holds a read-only line on where this browser stands with the line, plus the
 * desktop-alert opt-in. The ringtone and its per-browser mute live on the home
 * badge and the settings menu (§5.13b), untouched.
 *
 * ⚠️ The gateway's `/calls/prefs` routes and the stored forward numbers are
 * deliberately LEFT ALONE (the `call_ring_allow` precedent — never dropped):
 * the "Take it" button still forwards to whatever number a person saved while
 * the editor existed. What is gone is the way to set a new one.
 *
 * Who answers calls in the BROWSER (§5.13b) is not a setting here at all: a
 * manager assigns it on the Access page, capped at RingCentral's five devices.
 */
import { Bell, Headphones } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

/** The desktop-alert opt-in — shared with the settings menu's Calls section. */
export async function askDesktopAlerts(): Promise<void> {
  if (typeof Notification === "undefined") return;
  const result = await Notification.requestPermission();
  if (result === "granted") toast.success("You'll get a desktop alert when the tab is in the background.");
  else toast.info("Desktop alerts stay off. Calls still appear in the app.");
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RingPreferencesDialog({ open, onOpenChange }: Props) {
  const phone = useSoftphone();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Call settings</DialogTitle>
          <DialogDescription>
            Everyone shares the main line, every call reaches everyone connected, and calls are
            answered in the browser.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Read-only: the assignment lives on the Access page. */}
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

          <button
            onClick={() => void askDesktopAlerts()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50"
          >
            <Bell className="h-4 w-4" />
            Alert me when this tab is in the background
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
