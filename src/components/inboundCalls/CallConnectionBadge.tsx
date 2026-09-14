/**
 * "Connected for incoming calls on this tab" — the home-page badge
 * (Josh, 2026-09-14). Renders NOTHING for anyone who is not an assigned call
 * answerer: they are not rung, so there is no connection to report.
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
 */
import { useEffect, useState } from "react";
import { Loader2, PhoneCall, PhoneOff, Volume2, VolumeX } from "lucide-react";
import { useAccessContext } from "@/components/AccessProvider";
import { useSoftphone } from "@/hooks/softphone/useSoftphone";
import { canAnswerCalls } from "@/lib/accessStore";
import { authRequired } from "@/lib/shared/auth";
import { cn } from "@/lib/utils";

export default function CallConnectionBadge({ className }: { className?: string }) {
  const { email, config } = useAccessContext();
  const phone = useSoftphone();
  const enabled = !authRequired() || canAnswerCalls(email, config);
  // A connecting badge flickering on every page load is noise; give the
  // REGISTER a couple of seconds before saying anything but "connected".
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    const id = setTimeout(() => setSettled(true), 2_500);
    return () => clearTimeout(id);
  }, [phone.registration, phone.leader]);

  if (!enabled) return null;

  const reg = phone.registration;
  const connected = reg === "registered";
  const here = connected && phone.leader;
  const elsewhere = connected && !phone.leader;
  const pending = reg === "registering" || (reg === "off" && !settled);

  let tone: "green" | "amber" | "red" | "grey" = "grey";
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

  return (
    <div
      role="status"
      title={detail || label}
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
      {elsewhere && (
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
