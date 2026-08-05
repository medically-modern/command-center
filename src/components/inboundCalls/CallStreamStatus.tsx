/**
 * "Call alerts are offline" — the only thing that tells the affected REP.
 *
 * ⚠️ This exists because the feature could die silently in one browser. The
 * hook already computed `connected` and `error`; nothing rendered them, so a
 * rep whose SSE stream dropped saw no cards, no error, and no reason to doubt
 * it — identical to a quiet afternoon. And every gateway deploy drops every
 * open stream, so that is a routine event, not a hypothetical.
 *
 * A server-side monitor cannot cover this: the gateway knows how many browsers
 * are attached, not which person's tab fell off. Only the tab itself can say.
 *
 * Deliberately silent while healthy. A permanent green "connected" badge is
 * noise nobody reads, and the thing worth interrupting someone about is the
 * failure.
 */
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  connected: boolean;
  /** Set once the hook has stopped retrying — the stream is not coming back
   *  on its own and only a reload will fix it. */
  error: string | null;
}

export default function CallStreamStatus({ connected, error }: Props) {
  if (connected && !error) return null;

  const dead = !!error;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed bottom-4 left-4 z-[60] flex items-center gap-2 rounded-lg border px-3 py-2 shadow-lg text-sm",
        dead
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-amber-500/40 bg-amber-500/10 text-amber-700",
      )}
    >
      {dead ? (
        <AlertTriangle className="h-4 w-4 shrink-0" />
      ) : (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      )}
      <span>
        {dead ? "Call alerts are off" : "Reconnecting call alerts…"}
        <span className="block text-[11px] opacity-80">
          {dead
            ? "You won't see incoming calls until you reload."
            : "Incoming calls may not appear right now."}
        </span>
      </span>
      {dead && (
        <button
          onClick={() => window.location.reload()}
          className="ml-1 shrink-0 rounded-md border border-destructive/40 px-2 py-1 text-xs font-medium hover:bg-destructive/10"
        >
          Reload
        </button>
      )}
    </div>
  );
}
