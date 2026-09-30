/**
 * "Connected for incoming calls on this tab" — the home-page badge
 * (Josh, 2026-09-14). For anyone not rung — who has not connected their own
 * RingCentral login (§5.13c) — it is only the "Connect RingCentral" button.
 *
 * Per TAB, as asked, which the leader model (tabProtocol.ts) makes honest:
 *   · this tab holds the browser's registration and it is up  → connected;
 *   · another tab of this browser holds it                     → "another
 *     tab", with a button to make this tab the phone (takeOver — refused
 *     while that tab is on a call);
 *   · registering / line full / error                          → not
 *     connected, with the reason.
 *
 * Beside it, a MUTE for the ringtone (Josh, 2026-09-14). Per browser, so it
 * silences the tab that actually rings whichever tab it is pressed in; cards
 * and Answer are untouched — this is the speaker, not the assignment.
 *
 * ⚠️ **`compact` is the SAME COMPONENT, not a second one** (Josh, 2026-09-18 —
 * "move to top bar next to users, make it simpler. just a small ui componet and
 * button that moves to this tab, show it with an icon instead of explaining").
 * It is the global header's version: two icon buttons, the sentence in the
 * tooltip instead of on screen. A separate header component would be a second
 * copy of the gate (`phoneLine`) and the tone rules — and those decide
 * whether somebody's phone rings, so a copy that drifts is a rep who never
 * learns they are offline. Everything above the `return` is shared.
 *
 * ⚠️ **The MUTE rides along in compact, and that is not decoration.** With the
 * home sidebar off (§5.39c) the header is the only badge a manager has, so
 * dropping the speaker here would take the ringtone mute away from them
 * entirely — it lives nowhere else.
 *
 * ⚠️ **A tab watching ANOTHER tab sit on "connecting" can take the phone over**
 * (2026-09-23). A follower only mirrors its leader, so a leader that is stuck
 * holds every tab of the browser with it — and reloading the tab you are
 * looking at does nothing, because the reloaded tab just mirrors the same
 * leader again. A leader on the current build cannot stay "registering" this
 * long (every attempt is abandoned after softphone.ts's START_DEADLINE_MS and
 * shows "error" while it waits to retry), so one that does is a tab still
 * running a build from before that fix, or one the browser has frozen. Either
 * way, moving the phone to this tab is the way out.
 */
import { useEffect, useState } from "react";
import { Loader2, PhoneCall, PhoneOff, Volume2, VolumeX } from "lucide-react";
import { useSoftphone } from "@/hooks/softphone/useSoftphone";
import { toast } from "sonner";
import { authRequired } from "@/lib/shared/auth";
import { connectRcLine, phoneLine, useRcLine } from "@/lib/softphone/rcLine";
import { cn } from "@/lib/utils";

/** How long this tab watches another tab sit on "registering" before it offers
 *  to take the phone over. Comfortably past the longest a current leader can
 *  spend there in one go: the provision deadline plus the start deadline. */
export const STUCK_ELSEWHERE_MS = 45_000;

/** How long this tab — which WANTS the phone — watches the tab holding it sit
 *  with no phone at all before offering to take it (§5.13c). Short: an "off"
 *  leader is not retrying anything, it simply does not think this person is
 *  rung (typically a tab still on a build from before they connected). */
export const OFF_ELSEWHERE_MS = 5_000;

export type CallTone = "green" | "amber" | "red" | "grey";

/**
 * Where this browser stands with the line — ONE reading, shared by the two
 * badge forms and by the settings menu's Calls section (§5.52, Brandon's
 * `.status` line and the dot on the gear).
 *
 * ⚠️ **This is the one place the gate (`phoneLine`) is asked for the badge**
 * (`shellRemovals.test.ts` pins it): a second copy is how somebody who is not
 * connected gets a phone icon, or how a connected person stops getting one and
 * never learns their line is down. The settings menu imports THIS rather than
 * re-deriving it.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the gate must live beside the badge (shellRemovals.test.ts)
export function useCallStatus() {
  const phone = useSoftphone();
  // Rung = connected their own RingCentral login (§5.13c) — the same
  // `phoneLine` IncomingCallHost uses. The /access assignment no longer decides.
  const rcLine = useRcLine();
  const { enabled, line } = phoneLine(!authRequired(), rcLine);
  // Offer "Connect" to a signed-in person who is not on their own line yet,
  // once the gateway says the second RingCentral app is set up.
  const canConnect = authRequired() && rcLine.loaded && rcLine.configured && (!rcLine.connected || rcLine.broken);
  // A connecting badge flickering on every page load is noise; give the
  // REGISTER a couple of seconds before saying anything but "connected".
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    const id = setTimeout(() => setSettled(true), 2_500);
    return () => clearTimeout(id);
  }, [phone.registration, phone.leader]);
  // Another tab has been "registering" without a break for STUCK_ELSEWHERE_MS.
  // The timer restarts only when that stops being true, so a leader that is
  // actually retrying (registering → error → registering) never trips it.
  const followerWaiting = !phone.leader && phone.registration === "registering";
  const [stuckElsewhere, setStuckElsewhere] = useState(false);
  useEffect(() => {
    setStuckElsewhere(false);
    if (!followerWaiting) return;
    const id = setTimeout(() => setStuckElsewhere(true), STUCK_ELSEWHERE_MS);
    return () => clearTimeout(id);
  }, [followerWaiting]);

  // ⚠️ This tab wants the phone, but the tab HOLDING it has none at all
  // ("off") — it does not think this person is rung: a tab left open on a build
  // from before they connected their own line, or one whose status has not
  // caught up. Every tab of the browser mirrors it, so without this the person
  // sits on "Not connected for calls" until they find and close that tab
  // (Josh, 2026-09-30). Offered after OFF_ELSEWHERE_MS so a leader that is just
  // about to register is not raced.
  const followerOff = enabled && !phone.leader && phone.registration === "off" && !phone.call;
  const [offElsewhere, setOffElsewhere] = useState(false);
  useEffect(() => {
    setOffElsewhere(false);
    if (!followerOff) return;
    const id = setTimeout(() => setOffElsewhere(true), OFF_ELSEWHERE_MS);
    return () => clearTimeout(id);
  }, [followerOff]);

  const reg = phone.registration;
  const connected = reg === "registered";
  const here = connected && phone.leader;
  const elsewhere = connected && !phone.leader;
  const offHere = offElsewhere && followerOff;
  const stuck = (stuckElsewhere && followerWaiting) || offHere;
  const pending = !stuck && (reg === "registering" || (reg === "off" && !settled));

  let tone: CallTone = "grey";
  let label = "Not connected for calls";
  let detail: string | null = phone.registrationError;
  if (here) {
    tone = "green";
    label = "Connected — calls ring in this tab";
    detail = null;
  } else if (elsewhere) {
    tone = "amber";
    label = "Calls ring in another tab";
    detail = phone.call ? "That tab is on a call" : null;
  } else if (offHere) {
    tone = "amber";
    label = "Another tab has the phone but isn't connected";
    detail = "Use this tab to connect from here instead";
  } else if (stuck) {
    tone = "amber";
    label = "Another tab is stuck connecting";
    detail = "Use this tab to connect from here instead";
  } else if (pending) {
    tone = "amber";
    label = "Connecting for calls…";
    detail = null;
  } else if (reg === "full") {
    tone = "red";
    label = "Not connected — the line is full";
  } else if (reg === "error") {
    tone = "red";
    label = "Not connected for calls";
  }

  // ⚠️ The phone IS the takeover button when another tab holds the line —
  // Josh's "a button that moves to this tab". When this tab already has it
  // there is nothing to move, so it is inert and only reports.
  const canTake = (elsewhere || stuck) && !phone.call;

  if (line === "own" && rcLine.broken) {
    tone = "red";
    label = "Your RingCentral connection expired";
    detail = "Connect again to take calls here";
  }
  const ext = rcLine.extension;
  // Only said once somebody HAS connected: for everyone else the status reads
  // exactly as it did before §5.13c.
  const lineLabel = line === "own" ? `Your own line${ext?.number ? ` · Ext. ${ext.number}` : ""}` : null;

  return {
    phone,
    enabled,
    tone,
    label,
    detail,
    connected,
    pending,
    elsewhere,
    stuck,
    canTake,
    line,
    lineLabel,
    rcLine,
    canConnect,
  };
}

/** Start the RingCentral sign-in; a refusal is a toast, not a silent no-op. */
// eslint-disable-next-line react-refresh/only-export-components -- shared with the settings menu
export function startRcConnect(): void {
  void connectRcLine().catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)));
}

export default function CallConnectionBadge({
  className,
  compact = false,
}: {
  className?: string;
  /** The global header's icon-only form (§5.39c). */
  compact?: boolean;
}) {
  const { phone, enabled, tone, label, detail, connected, pending, elsewhere, stuck, canTake, lineLabel, canConnect, rcLine } =
    useCallStatus();
  const lineNote = lineLabel ? ` (${lineLabel})` : "";

  if (!enabled) {
    // Not rung at all yet. The home page offers the one thing that changes
    // that without a manager: connecting their own RingCentral login (§5.13c).
    // The header stays empty for them, as before.
    if (compact || !canConnect) return null;
    return (
      <button
        type="button"
        onClick={startRcConnect}
        title="Sign in with your own RingCentral login so calls ring here, on your own line"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white/80 hover:bg-white/10",
          className,
        )}
      >
        <PhoneCall className="h-3 w-3" />
        Connect RingCentral to take calls
      </button>
    );
  }

  const StateIcon = pending ? Loader2 : connected ? PhoneCall : PhoneOff;

  if (compact) {
    return (
      <span className={cn("cc-phone", className)} role="status">
        <button
          type="button"
          className={cn("ib", `cc-phone-${tone}`)}
          onClick={canTake ? phone.takeOver : undefined}
          // ⚠️ Not `disabled`: a disabled button shows no tooltip in most
          // browsers, and the tooltip is the entire explanation in this form.
          aria-disabled={!canTake}
          title={
            elsewhere
              ? phone.call
                ? "Calls ring in another tab — wait for that call to finish"
                : "Calls ring in another tab — click to ring in this one"
              : stuck
                ? `${label} — click to connect from this tab`
                : detail
                ? `${label} — ${detail}${lineNote}`
                : `${label}${lineNote}`
          }
          aria-label={label}
        >
          <StateIcon style={{ width: 16, height: 16 }} className={pending ? "animate-spin" : undefined} />
        </button>
        <button
          type="button"
          className={cn("ib", phone.ringMuted && "cc-phone-muted")}
          onClick={() => phone.setRingMuted(!phone.ringMuted)}
          title={
            phone.ringMuted
              ? "Ringtone muted in this browser — click to unmute"
              : "Mute the ringtone in this browser"
          }
          aria-label={phone.ringMuted ? "Unmute ringtone" : "Mute ringtone"}
          aria-pressed={phone.ringMuted}
        >
          {phone.ringMuted ? (
            <VolumeX style={{ width: 16, height: 16 }} />
          ) : (
            <Volume2 style={{ width: 16, height: 16 }} />
          )}
        </button>
      </span>
    );
  }

  return (
    <div
      role="status"
      title={`${detail || label}${lineNote}`}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        tone === "green" && "border-emerald-400/40 bg-emerald-400/15 text-emerald-100",
        tone === "amber" && "border-amber-400/40 bg-amber-400/15 text-amber-100",
        tone === "red" && "border-red-400/40 bg-red-400/15 text-red-100",
        tone === "grey" && "border-white/15 bg-white/5 text-white/70",
        className,
      )}
    >
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : connected ? (
        <PhoneCall className="h-3 w-3" />
      ) : (
        <PhoneOff className="h-3 w-3" />
      )}
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tone === "green" && "bg-emerald-400",
          tone === "amber" && "bg-amber-400",
          tone === "red" && "bg-red-400",
          tone === "grey" && "bg-white/40",
        )}
      />
      <span className="truncate">{label}</span>
      <button
        onClick={() => phone.setRingMuted(!phone.ringMuted)}
        title={phone.ringMuted ? "Ringtone muted in this browser — click to unmute" : "Mute the ringtone in this browser"}
        aria-label={phone.ringMuted ? "Unmute ringtone" : "Mute ringtone"}
        aria-pressed={phone.ringMuted}
        className={cn(
          "ml-0.5 rounded-full p-0.5 hover:bg-white/10",
          phone.ringMuted && "text-amber-200",
        )}
      >
        {phone.ringMuted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
      </button>
      {canConnect && (
        <button
          onClick={startRcConnect}
          title={
            rcLine.broken
              ? "Sign in to RingCentral again so calls keep ringing on your own line"
              : "Sign in with your own RingCentral login, so you ring on your own line instead of Katie's"
          }
          className="ml-1 rounded-full border border-current/40 px-1.5 py-0.5 text-[10px] hover:bg-white/10"
        >
          {rcLine.broken ? "Reconnect" : "Use my own line"}
        </button>
      )}
      {(elsewhere || stuck) && (
        <button
          onClick={phone.takeOver}
          disabled={!!phone.call}
          title={phone.call ? "Wait for that call to finish" : "Ring in this tab instead"}
          className="ml-1 rounded-full border border-current/40 px-1.5 py-0.5 text-[10px] hover:bg-white/10 disabled:opacity-50"
        >
          Use this tab
        </button>
      )}
    </div>
  );
}
