/**
 * "Calls" — a patient's call history with the MM line, in a pop-up.
 *
 * Sits next to the Call and Text buttons in every stage header (see
 * `PatientContact` in masheke/mmKit). Shows both directions, how long each call
 * lasted, and — where RingCentral recorded it — a player.
 *
 * ⚠️ The history is fetched ON OPEN, never on render. RingCentral's call-log is
 * one of its more rate-limited endpoints, and a header renders for every
 * patient a rep clicks through; an eager badge count would spend the account's
 * quota on patients nobody asked about. The cost of that choice is that the
 * button can't show a missed-call count until it's opened, which is the trade
 * the feature was specified around ("click and see").
 */
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Play,
  RefreshCw,
  Voicemail,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fetchPatientCallHistory, fetchRecordingBlobUrl } from "@/lib/fax/ringcentralApi";
import {
  callOutcomeLabel,
  summarizeCalls,
  type PatientCall,
} from "@/lib/callHistory/callHistory";

/** Per-recording playback state, keyed by call id. */
interface AudioState {
  loading?: boolean;
  url?: string;
  err?: string;
}

/** RingCentral timestamps are real UTC instants, so they're rendered in ET
 *  explicitly — everyone reading this works on the office clock, and letting
 *  the browser's zone decide would show a different time to a rep who travels. */
function fmtWhen(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
  } catch {
    return "";
  }
}

function CallIcon({ call }: { call: PatientCall }) {
  const cls = "h-4 w-4 shrink-0";
  if (call.voicemail) return <Voicemail className={cn(cls, "text-amber-600")} />;
  if (!call.connected)
    return <PhoneMissed className={cn(cls, call.direction === "Inbound" ? "text-destructive" : "text-muted-foreground")} />;
  return call.direction === "Inbound" ? (
    <PhoneIncoming className={cn(cls, "text-[color:var(--mm-teal)]")} />
  ) : (
    <PhoneOutgoing className={cn(cls, "text-[color:var(--mm-teal)]")} />
  );
}

export function CallHistoryButton({ phone, display }: { phone?: string; display?: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [calls, setCalls] = useState<PatientCall[]>([]);
  const [audio, setAudio] = useState<Record<string, AudioState>>({});
  /** Blob URLs we minted, so they can be released rather than leaked. */
  const blobs = useRef<string[]>([]);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      setCalls(await fetchPatientCallHistory(phone ?? ""));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      // A history we couldn't read is NOT an empty history — clear the list so
      // the error shows instead of a stale "no calls" that reads as fact.
      setCalls([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Release every blob: URL we created. Recordings are audio files, so leaking
  // them holds real memory for as long as the tab lives.
  useEffect(() => {
    return () => {
      blobs.current.forEach((u) => URL.revokeObjectURL(u));
      blobs.current = [];
    };
  }, []);

  const play = async (call: PatientCall) => {
    if (!call.recording || audio[call.id]?.url || audio[call.id]?.loading) return;
    setAudio((a) => ({ ...a, [call.id]: { loading: true } }));
    try {
      const url = await fetchRecordingBlobUrl(call.recording.contentUri);
      blobs.current.push(url);
      setAudio((a) => ({ ...a, [call.id]: { url } }));
    } catch (e) {
      setAudio((a) => ({ ...a, [call.id]: { err: e instanceof Error ? e.message : String(e) } }));
    }
  };

  const summary = summarizeCalls(calls);

  // No number on file, no history to look up. Guarded here rather than at each
  // call site so every header can drop the button in unconditionally.
  if (!String(phone ?? "").replace(/\D/g, "")) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-[color:var(--mm-teal)] transition-colors hover:bg-muted/40"
          style={{ boxShadow: "inset 0 0 0 1px var(--mm-card-border)" }}
        >
          <Phone className="h-3.5 w-3.5 shrink-0" /> Calls
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg p-0 gap-0 flex flex-col max-h-[80vh]">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Phone className="h-4 w-4 text-[color:var(--mm-teal)]" />
            Call history{display ? ` · ${display}` : ""}
          </DialogTitle>
          {!loading && !err && calls.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {summary.total} {summary.total === 1 ? "call" : "calls"}
              {summary.missedInbound > 0 && ` · ${summary.missedInbound} missed`}
              {summary.recorded > 0 && ` · ${summary.recorded} recorded`}
            </p>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-[220px] bg-muted/20">
          {loading && calls.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading call history…
            </div>
          ) : err ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>Couldn't load the call history. {err}</div>
            </div>
          ) : calls.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No calls with this number in the last year.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {calls.map((c) => {
                const a = audio[c.id] ?? {};
                return (
                  <li key={c.id} className="rounded-lg border border-border bg-card px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <CallIcon call={c} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">
                          {c.direction === "Inbound" ? "Patient called" : "We called"}
                        </div>
                        <div className="text-xs text-muted-foreground">{fmtWhen(c.startTime)}</div>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 text-sm tabular-nums",
                          c.connected ? "font-semibold" : "text-muted-foreground",
                          !c.connected && c.direction === "Inbound" && "text-destructive font-semibold",
                        )}
                        title={c.result ? `RingCentral: ${c.result}` : undefined}
                      >
                        {callOutcomeLabel(c)}
                      </span>
                      {c.recording && !a.url && (
                        <button
                          type="button"
                          onClick={() => void play(c)}
                          disabled={a.loading}
                          className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[color:var(--mm-teal)] hover:bg-muted/60 disabled:opacity-50"
                          title="Play recording"
                        >
                          {a.loading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                          Play
                        </button>
                      )}
                    </div>
                    {a.url && <audio controls autoPlay src={a.url} className="mt-2 w-full h-9" />}
                    {a.err && (
                      <p className="mt-1.5 text-xs text-destructive">Couldn't load the recording. {a.err}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t p-3">
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Refresh
          </button>
          <span className="text-[11px] text-muted-foreground">Last 12 months</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
