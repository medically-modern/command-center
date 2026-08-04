/**
 * The calling UI: who you're calling, what the call is doing, a timer, mute and
 * a hangup button. Shown while a browser call is live.
 *
 * Deliberately a small floating card rather than a full-screen takeover — a rep
 * on a call still needs the conversation behind it to read what the patient
 * texted.
 */
import { Loader2, Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import type { WebPhoneCall } from "@/hooks/assignedPatients/useWebPhone";
import { fmtPhone } from "@/lib/assignedPatients/format";
import { cn } from "@/lib/utils";

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const LABEL: Record<WebPhoneCall["status"], string> = {
  idle: "",
  connecting: "Setting up…",
  ringing: "Ringing…",
  connected: "Connected",
  ending: "Hanging up…",
};

interface Props {
  call: WebPhoneCall;
  name: string;
  onHangup: () => void;
  onToggleMute: () => void;
}

export default function CallOverlay({ call, name, onHangup, onToggleMute }: Props) {
  const live = call.status === "connected";
  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
      <div className="bg-gradient-navy text-navy-foreground px-4 py-3 flex items-center gap-2.5">
        <span
          className={cn(
            "h-9 w-9 rounded-full flex items-center justify-center shrink-0",
            live ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10",
          )}
        >
          {call.status === "connecting" || call.status === "ending" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Phone className={cn("h-4 w-4", call.status === "ringing" && "animate-pulse")} />
          )}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{name || fmtPhone(call.phone)}</p>
          <p className="text-[11px] opacity-80 tabular-nums">
            {live ? mmss(call.seconds) : LABEL[call.status]}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center gap-3 p-3">
        <button
          onClick={onToggleMute}
          disabled={!live}
          title={call.muted ? "Unmute" : "Mute"}
          className={cn(
            "h-10 w-10 rounded-full flex items-center justify-center border transition-colors disabled:opacity-40",
            call.muted
              ? "bg-amber-500/15 border-amber-500/40 text-amber-600"
              : "border-border hover:bg-muted",
          )}
        >
          {call.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        <button
          onClick={onHangup}
          title="Hang up"
          className="h-10 w-14 rounded-full bg-red-600 text-white flex items-center justify-center hover:bg-red-700"
        >
          <PhoneOff className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
