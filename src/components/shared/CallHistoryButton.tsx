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
  Download,
  Loader2,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Play,
  List,
  RefreshCw,
  Voicemail,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fetchPatientCallHistory, fetchRecordingBlobUrl } from "@/lib/fax/ringcentralApi";
import {
  callOutcomeLabel,
  summarizeCalls,
  type PatientCall,
} from "@/lib/callHistory/callHistory";
import {
  downloadRecording,
  downloadRecordings,
  estimateMinutes,
  withRecordings,
  type BulkProgress,
} from "@/lib/callHistory/recordingDownload";

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

export function CallHistoryButton({ phone, display, label = "Calls", icon }: {
  phone?: string;
  display?: string;
  /** The trigger's text and icon. The Care Coordinator dashboard passes
   *  "Call Log" + a list icon (Brandon, 2026-09-14); everywhere else keeps
   *  "Calls" and the phone. */
  label?: string;
  icon?: "list";
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [calls, setCalls] = useState<PatientCall[]>([]);
  const [audio, setAudio] = useState<Record<string, AudioState>>({});
  /** Per-call download spinner, keyed by call id. Separate from `audio` so a
   *  rep can save a recording they are already listening to. */
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [bulk, setBulk] = useState<BulkProgress | null>(null);
  const cancelBulk = useRef<AbortController | null>(null);
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

  /** Save one recording. The filename carries the patient's name and the ET
   *  date/time, so a folder of them is readable without opening any. */
  const save = async (call: PatientCall) => {
    if (!call.recording || saving[call.id]) return;
    setSaving((s) => ({ ...s, [call.id]: true }));
    try {
      const name = await downloadRecording(call, { who: display });
      toast.success(`Saved ${name}`);
    } catch (e) {
      toast.error(`Couldn't download that recording. ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving((s) => ({ ...s, [call.id]: false }));
    }
  };

  /**
   * Save every recording in this history.
   *
   * ⚠️ Paced, not parallel — see `recordingDownload`. Browsers drop a burst of
   * simultaneous downloads and the gateway budgets RingCentral per caller, so
   * the honest version is slow and says so up front rather than appearing to
   * work and saving a fraction of the files.
   */
  const saveAll = async () => {
    const recorded = withRecordings(calls);
    if (!recorded.length || bulk) return;
    const mins = estimateMinutes(recorded.length);
    if (
      !window.confirm(
        `Download ${recorded.length} recording${recorded.length === 1 ? "" : "s"}` +
          `${display ? ` for ${display}` : ""}?\n\n` +
          `They save one at a time and take about ${mins} minute${mins === 1 ? "" : "s"}. ` +
          `Keep this window open until it finishes.`,
      )
    ) {
      return;
    }
    const ctl = new AbortController();
    cancelBulk.current = ctl;
    setBulk({ done: 0, total: recorded.length, ok: 0, failed: 0 });
    try {
      const res = await downloadRecordings(recorded, {
        nameFor: () => display,
        onProgress: setBulk,
        signal: ctl.signal,
      });
      if (res.cancelled) toast.info(`Stopped. ${res.ok} saved.`);
      else if (res.failures.length) toast.warning(`Saved ${res.ok}. ${res.failures.length} couldn't be downloaded.`);
      else toast.success(`Saved ${res.ok} recording${res.ok === 1 ? "" : "s"}.`);
    } finally {
      setBulk(null);
      cancelBulk.current = null;
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
          {icon === "list" ? <List className="h-3.5 w-3.5 shrink-0" /> : <Phone className="h-3.5 w-3.5 shrink-0" />} {label}
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
                      {c.recording && (
                        <span className="flex shrink-0 items-center gap-0.5">
                          {!a.url && (
                            <button
                              type="button"
                              onClick={() => void play(c)}
                              disabled={a.loading}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[color:var(--mm-teal)] hover:bg-muted/60 disabled:opacity-50"
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
                          <button
                            type="button"
                            onClick={() => void save(c)}
                            disabled={!!saving[c.id] || !!bulk}
                            className="inline-flex items-center rounded-md p-1.5 text-[color:var(--mm-teal)] hover:bg-muted/60 disabled:opacity-50"
                            title="Download recording"
                            aria-label="Download recording"
                          >
                            {saving[c.id] ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Download className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </span>
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
          <div className="flex items-center gap-3">
            {summary.recorded > 0 &&
              (bulk ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving {bulk.done}/{bulk.total}
                  <button
                    onClick={() => cancelBulk.current?.abort()}
                    className="font-semibold text-foreground hover:underline"
                  >
                    Stop
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => void saveAll()}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[color:var(--mm-teal)] hover:bg-muted/60"
                >
                  <Download className="h-3 w-3" /> Download all ({summary.recorded})
                </button>
              ))}
            <span className="text-[11px] text-muted-foreground">Last 12 months</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
