/**
 * A call's transcript, under its recording in the Communications timeline
 * (§5.47e). Collapsed by default; the text is fetched from the gateway only
 * when a rep opens it, and kept for the life of the row (keyed by call id).
 *
 * The speakers are Google's diarization of a mono recording — "Speaker 1" and
 * "Speaker 2", in the order they first spoke. It cannot know which one is the
 * rep, so it doesn't guess.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { fetchCallTranscript, type TranscriptTurn } from "@/lib/commsInbox/api";
import { speakerNames } from "@/lib/commsInbox/transcript";
import { cn } from "@/lib/utils";

function clock(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "";
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function CallTranscript({
  callId,
  answeredBy = "",
}: {
  callId: string;
  /** Who picked up an INBOUND call (§5.47d): names the first voice. Blank otherwise. */
  answeredBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<TranscriptTurn[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && turns === null && !loading) {
      setLoading(true);
      setError(null);
      fetchCallTranscript(callId)
        .then((t) => setTurns(t.turns))
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false));
    }
  };

  const names = speakerNames(turns ?? [], answeredBy);
  const guessed = !!answeredBy.trim() && names.size > 0;
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Transcript
      </button>
      {open && (
        <div className="mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-muted/40 p-2 text-xs" data-testid="call-transcript">
          {loading && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading the transcript…
            </span>
          )}
          {error && <span className="text-destructive">Couldn't load the transcript. {error}</span>}
          {turns && turns.length === 0 && <span className="text-muted-foreground">No words were recognised on this call.</span>}
          {guessed && turns && turns.length > 0 && (
            <p className="mb-1 text-[10px] text-muted-foreground">Names are a best guess from who spoke first.</p>
          )}
          {turns &&
            turns.map((t, i) => (
              <div key={i} className={cn("py-0.5", i > 0 && "border-t border-border/50")}>
                <span className="font-semibold">{names.get(t.speaker) || "Speaker"}</span>
                {t.start != null && <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">{clock(t.start)}</span>}
                <div className="whitespace-pre-wrap">{t.text}</div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
