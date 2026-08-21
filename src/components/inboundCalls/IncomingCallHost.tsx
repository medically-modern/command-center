/**
 * The inbound-call cards — mounted app-wide, not on one page.
 *
 * A call arrives while you are working wherever you happen to be working, so
 * this hangs off the app root next to FileViewerHost rather than living on the
 * texting page. It is the whole reason the feature is worth having: RingCentral
 * already pops a notification that knows a phone number, and this one knows
 * WHO is calling, what stage they are at, and lets you take the call in a click.
 *
 * Cards come in top-right, deliberately away from the outbound CallOverlay at
 * bottom-right — "a call is arriving" and "you are on a call" must never be
 * mistaken for each other.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Phone, PhoneIncoming, PhoneOff, X } from "lucide-react";
import { toast } from "sonner";
import { useInboundCalls, type RingingCall } from "@/hooks/inboundCalls/useInboundCalls";
import RingPreferencesDialog from "@/components/inboundCalls/RingPreferencesDialog";
import CallStreamStatus from "@/components/inboundCalls/CallStreamStatus";
import { fmtPhone, senderName } from "@/lib/assignedPatients/format";
import { getUser } from "@/lib/shared/auth";
import { cn } from "@/lib/utils";

/** Is this claim the signed-in user's own? `claim()` marks it "you" optimistically
 *  before the server echoes the real email back, so both have to count. */
function mine(claimedBy: string): boolean {
  if (claimedBy === "you") return true;
  const email = (getUser()?.email || "").toLowerCase();
  return !!email && claimedBy.toLowerCase() === email;
}

/** Ring windows are short — a card that has been up this long is about to lose
 *  the call to voicemail, and the bar turns amber to say so. */
const URGENT_AFTER_S = 15;

function useElapsed(startedAt: number, live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

/**
 * A browser notification when the tab is in the background.
 *
 * Permission is never requested from here — an unprompted permission dialog on
 * page load is the fastest way to get permanently denied. The settings dialog
 * asks, in context, when the rep opts in.
 */
function useBackgroundNotification(call: RingingCall) {
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current || call.state !== "ringing") return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (!document.hidden) return;
    shown.current = true;
    const who = call.patient?.name || fmtPhone(call.from);
    const n = new Notification(`${who} is calling`, {
      body: call.patient?.boardName ? `Medically Modern · ${call.patient.boardName}` : "Medically Modern",
      tag: call.id,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return () => n.close();
  }, [call]);
}

function CallCard({
  call,
  onClaim,
  onDismiss,
  onNeedsNumber,
}: {
  call: RingingCall;
  onClaim: (id: string) => Promise<string>;
  onDismiss: (id: string) => void;
  onNeedsNumber: () => void;
}) {
  const [claiming, setClaiming] = useState(false);
  const [ringingAt, setRingingAt] = useState("");
  const ringing = call.state === "ringing";
  const seconds = useElapsed(call.startedAt, ringing);
  useBackgroundNotification(call);

  const who = call.patient?.name || fmtPhone(call.from);
  const urgent = ringing && seconds >= URGENT_AFTER_S;

  const subtitle = useMemo(() => {
    // Compared against the signed-in email, not a local flag: the optimistic
    // "you" is overwritten the moment the server's own update arrives, and
    // "Janelle took this call" on your own screen reads as losing the race.
    if (call.claimedBy && mine(call.claimedBy)) {
      return ringingAt ? `Ringing you at ${fmtPhone(ringingAt)}` : "Ringing your phone…";
    }
    if (call.claimedBy) return `${senderName(call.claimedBy)} took this call`;
    if (call.state === "answered") return "Answered";
    if (call.state === "missed") return "Missed";
    if (call.patient) return `${call.patient.boardName} · ${fmtPhone(call.from)}`;
    // A caller on no board is normal — you can still take the call.
    return call.callerName || "Not a patient on any board";
  }, [call, ringingAt]);

  const take = async () => {
    setClaiming(true);
    try {
      const at = await onClaim(call.id);
      setRingingAt(at);
      toast.success(`Picking up — your phone is ringing at ${fmtPhone(at)}`);
    } catch (e) {
      const err = e as Error & { status?: number; needsForwardNumber?: boolean };
      // The ordinary race, in all three shapes it arrives in: the caller hung
      // up, or a colleague was quicker. A ring is often only a few seconds
      // long and the terminal webhook can land between the render and the
      // click, so this is the COMMON outcome of a slow click — not a fault.
      //
      // ⚠️ 404 and 409 belong here too (2026-08-21). Only 410 was handled, so
      // the gateway's own "That call is no longer ringing." (404) and "…has
      // already ended." (409) — the same event, caught one layer earlier —
      // came out as a red error toast AND left the dead card on screen to be
      // clicked again. 410 is the same verdict reached via RingCentral; which
      // layer noticed first is not something a rep should be able to tell.
      if (err.status === 410 || err.status === 409 || err.status === 404) {
        toast.info(err.message);
        onDismiss(call.id);
      } else if (err.needsForwardNumber) {
        // Open the settings right here. The card is app-wide but the dialog
        // used to live only on the texting page, which left a rep on any other
        // page told to add a number with no way to add it — during a call with
        // seconds left on it.
        toast.error(err.message);
        onNeedsNumber();
      } else {
        toast.error(err.message || "Couldn't take that call.");
      }
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div
      className={cn(
        "w-80 rounded-xl border bg-card shadow-xl overflow-hidden pointer-events-auto",
        ringing ? "border-emerald-500/40" : "border-border",
      )}
      role="alert"
    >
      <div
        className={cn(
          "px-4 py-3 flex items-center gap-2.5 text-white",
          ringing ? "bg-gradient-navy" : "bg-muted text-foreground",
        )}
      >
        <span
          className={cn(
            "h-9 w-9 rounded-full flex items-center justify-center shrink-0",
            ringing ? "bg-emerald-500/20 text-emerald-300" : "bg-black/10",
          )}
        >
          <PhoneIncoming className={cn("h-4 w-4", ringing && "animate-pulse")} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{who}</p>
          <p className="text-[11px] opacity-80 truncate">{subtitle}</p>
        </div>
        {ringing && (
          <span className="text-[11px] tabular-nums opacity-80 shrink-0">
            {seconds}s
          </span>
        )}
        <button
          onClick={() => onDismiss(call.id)}
          title="Dismiss"
          className="p-1 rounded hover:bg-white/10 shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {ringing && !call.claimedBy && (
        <>
          <div className="h-0.5 bg-border">
            <div
              className={cn(
                "h-full transition-all duration-1000",
                urgent ? "bg-amber-500" : "bg-emerald-500",
              )}
              // Rough progress against a typical ring-to-voicemail window.
              style={{ width: `${Math.min(100, (seconds / 30) * 100)}%` }}
            />
          </div>
          <div className="flex items-center gap-2 p-3">
            <button
              onClick={() => void take()}
              disabled={claiming}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
              Take it
            </button>
            <button
              onClick={() => onDismiss(call.id)}
              title="Not for me"
              className="h-9 w-9 rounded-lg border border-border flex items-center justify-center hover:bg-muted"
            >
              <PhoneOff className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function IncomingCallHost() {
  const { calls, claim, dismiss, connected, error } = useInboundCalls();
  // Carried here rather than on the texting page so "add your number" is
  // fixable from wherever the call found you.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // ⚠️ No early return on "nothing ringing" any more — CallStreamStatus has to
  // render precisely when there are NO calls, because "no calls" is exactly
  // what a dead stream looks like.
  return (
    <>
      <CallStreamStatus connected={connected} error={error} />
      {/* pointer-events-none on the stack so the gap between cards doesn't
          swallow clicks on the page behind them. */}
      <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
        {calls.map((c) => (
          <CallCard
            key={c.id}
            call={c}
            onClaim={claim}
            onDismiss={dismiss}
            onNeedsNumber={() => setSettingsOpen(true)}
          />
        ))}
      </div>
      <RingPreferencesDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
