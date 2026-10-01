/**
 * A patient's call history with the MM line — both directions, how long each
 * call lasted, and a player for any call we can still hear.
 *
 * This was the body of the "Calls" pop-up (`CallHistoryButton`, §5.16) until
 * the Communications popup replaced every Text and Calls button in the app
 * (Josh, 2026-09-24 — CLAUDE.md §5.50). It lives on as the Calls half of that
 * popup's FALLBACK view, drawn only when the Communications inbox cannot be
 * read (switched off, or the gateway refused): the popup must never dead-end
 * where the old button did not (§5.39f's lossless rule).
 *
 * ⚠️ The history is fetched ON MOUNT — i.e. when the popup opens — and never on
 * render of the page behind it. RingCentral's call log is one of its more
 * rate-limited endpoints, and a header renders for every patient a rep clicks
 * through (INCIDENT_2026-08-20's shape).
 *
 * ⚠️ **Playback is archive-first** (§5.47): `hasPlayableAudio` is what DRAWS
 * the Play and ⤓ buttons, because RingCentral drops the `recording` object from
 * a log row it has purged — gated on `c.recording`, an aged-out call we still
 * hold would show nothing at all.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  Loader2,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Play,
  RefreshCw,
  Voicemail,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { RcBusyError, fetchPatientCallHistory, fetchRecordingBlobUrl } from "@/lib/fax/ringcentralApi";
import RcBusyCountdown from "@/components/shared/RcBusyCountdown";
import {
  archivedPlaybackUrl,
  hasPlayableAudio,
  recordingSource,
} from "@/lib/callHistory/archivedRecordings";
import { useArchivedAudio } from "@/hooks/callHistory/useArchivedAudio";
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
import { AudioPlayer } from "@/components/shared/AudioPlayer";

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

export function CallHistoryList({ phone, display }: {
  phone: string;
  /** How the number reads — used to name saved recordings. */
  display?: string;
}) {
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

  /**
   * Which of these calls we hold audio for after RingCentral deleted it.
   *
   * ⚠️ This is what makes the Play and ⤓ buttons APPEAR on an aged-out call.
   * RingCentral drops the `recording` object from the log row and keeps the
   * row, so without this the buttons are never drawn and the bytes in our
   * bucket are unreachable — a fallback on the download path alone fixes
   * nothing a rep can see (§5.47).
   */
  const callIds = useMemo(() => calls.map((c) => c.id), [calls]);
  const archived = useArchivedAudio(callIds);

  // RingCentral said "wait": when to try again (a countdown replaces the error).
  const [busyUntil, setBusyUntil] = useState<number | null>(null);
  const load = async () => {
    setLoading(true);
    setErr(null);
    setBusyUntil(null);
    try {
      setCalls(await fetchPatientCallHistory(phone ?? ""));
    } catch (e) {
      if (e instanceof RcBusyError) setBusyUntil(e.retryAt);
      setErr(e instanceof Error ? e.message : String(e));
      // A history we couldn't read is NOT an empty history — clear the list so
      // the error shows instead of a stale "no calls" that reads as fact.
      setCalls([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  // Release every blob: URL we created. Recordings are audio files, so leaking
  // them holds real memory for as long as the tab lives.
  useEffect(() => {
    return () => {
      blobs.current.forEach((u) => URL.revokeObjectURL(u));
      blobs.current = [];
    };
  }, []);

  const play = async (call: PatientCall) => {
    const source = recordingSource(call, archived);
    if (!source || audio[call.id]?.url || audio[call.id]?.loading) return;
    setAudio((a) => ({ ...a, [call.id]: { loading: true } }));
    try {
      // ⚠️ The ARCHIVE hands back a presigned URL that is used as a bare `src`,
      // never fetched: a cross-origin `fetch()` would need CORS on the bucket,
      // which Railway exposes no way to set, while an <audio src> needs none.
      // It is therefore NOT a blob URL and must not be pushed onto `blobs` —
      // revoking a URL we did not create is a no-op, but tracking it would
      // imply we own bytes we never held.
      if (source.kind === "archive") {
        const signed = await archivedPlaybackUrl(source.callId);
        setAudio((a) => ({ ...a, [call.id]: { url: signed } }));
        return;
      }
      const url = await fetchRecordingBlobUrl(source.contentUri);
      blobs.current.push(url);
      setAudio((a) => ({ ...a, [call.id]: { url } }));
    } catch (e) {
      setAudio((a) => ({ ...a, [call.id]: { err: e instanceof Error ? e.message : String(e) } }));
    }
  };

  /** Save one recording. The filename carries the patient's name and the ET
   *  date/time, so a folder of them is readable without opening any. */
  const save = async (call: PatientCall) => {
    if (!hasPlayableAudio(call, archived) || saving[call.id]) return;
    setSaving((s) => ({ ...s, [call.id]: true }));
    try {
      const name = await downloadRecording(call, { who: display, archived });
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
    const recorded = withRecordings(calls, archived);
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
        archived,
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
  /**
   * How many of these a rep can actually hear.
   *
   * ⚠️ NOT `summary.recorded`, which counts what RingCentral still has. Once a
   * recording is purged that number falls even though the audio is safe in our
   * bucket — so the footer would offer "Download all (0)" on a patient whose
   * whole history we saved. The honest number is what is playable from
   * anywhere.
   */
  const playable = useMemo(() => withRecordings(calls, archived).length, [calls, archived]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!loading && !err && calls.length > 0 && (
        <p className="shrink-0 border-b border-border px-4 py-2 text-xs text-muted-foreground">
          {summary.total} {summary.total === 1 ? "call" : "calls"}
          {summary.missedInbound > 0 && ` · ${summary.missedInbound} missed`}
          {playable > 0 && ` · ${playable} recorded`}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 px-4 py-3">
        {loading && calls.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading call history…
          </div>
        ) : busyUntil ? (
          <RcBusyCountdown retryAt={busyUntil} onRetry={() => void load()} />
        ) : err ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>Couldn't load the call history. {err}</div>
          </div>
        ) : calls.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No calls with this number in the last year.</p>
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
                        !c.connected && c.direction === "Inbound" && "font-semibold text-destructive",
                      )}
                      title={c.result ? `RingCentral: ${c.result}` : undefined}
                    >
                      {callOutcomeLabel(c)}
                    </span>
                    {hasPlayableAudio(c, archived) && (
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
                  {a.url && (
                    <AudioPlayer
                      src={a.url}
                      durationHint={c.durationSec}
                      label="Call recording"
                      className="mt-2"
                      // An archive link dies after five minutes (§5.47): hand the
                      // Play button back rather than leave a silent player.
                      onError={() =>
                        setAudio((s) => ({
                          ...s,
                          [c.id]: { err: "The recording couldn't load — press Play to try again." },
                        }))
                      }
                    />
                  )}
                  {a.err && <p className="mt-1.5 text-xs text-destructive">Couldn't load the recording. {a.err}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-border p-3">
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Refresh
        </button>
        <div className="flex items-center gap-3">
          {playable > 0 &&
            (bulk ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving {bulk.done}/{bulk.total}
                <button onClick={() => cancelBulk.current?.abort()} className="font-semibold text-foreground hover:underline">
                  Stop
                </button>
              </span>
            ) : (
              <button
                onClick={() => void saveAll()}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[color:var(--mm-teal)] hover:bg-muted/60"
              >
                <Download className="h-3 w-3" /> Download all ({playable})
              </button>
            ))}
          <span className="text-[11px] text-muted-foreground">Last 12 months</span>
        </div>
      </div>
    </div>
  );
}

export default CallHistoryList;
