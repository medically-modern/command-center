/**
 * "This browser can't ring right now" — the only thing that tells the REP.
 *
 * Same reasoning as CallStreamStatus beside it: browser answering fails
 * SILENTLY. A browser that lost its slot on the shared line (five devices,
 * §5.13b), or never got one, simply doesn't ring — indistinguishable from a
 * quiet afternoon, except that a manager assigned this person to answer.
 *
 * Silent while healthy, silent while off. "Connecting" only shows after a
 * grace period, because a two-second REGISTER on every page load is not worth
 * a banner.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, PhoneOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RegistrationStatus } from "@/lib/softphone/types";

const REGISTERING_GRACE_MS = 8_000;

interface Props {
  enabled: boolean;
  registration: RegistrationStatus;
  error: string | null;
}

export default function SoftphoneStatus({ enabled, registration, error }: Props) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (registration !== "registering") return;
    const id = setTimeout(() => setSlow(true), REGISTERING_GRACE_MS);
    return () => clearTimeout(id);
  }, [registration]);

  if (!enabled) return null;
  if (registration === "registered" || registration === "off") return null;
  if (registration === "registering" && !slow) return null;

  const full = registration === "full";
  const dead = registration === "error";
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 shadow-lg text-sm max-w-sm",
        dead
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-amber-500/40 bg-amber-500/10 text-amber-700",
      )}
    >
      {full ? (
        <PhoneOff className="h-4 w-4 shrink-0 mt-0.5" />
      ) : dead ? (
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      ) : (
        <Loader2 className="h-4 w-4 shrink-0 mt-0.5 animate-spin" />
      )}
      <span>
        {full ? "The line is full — this browser can't ring" : dead ? "Browser answering is off" : "Connecting this browser to the line…"}
        <span className="block text-[11px] opacity-80">
          {error || "Calls still show here, and Take it rings your phone."}
        </span>
      </span>
    </div>
  );
}
