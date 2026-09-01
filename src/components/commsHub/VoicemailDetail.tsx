/**
 * One voicemail: who left it, the audio, and the transcript when RingCentral
 * produced one.
 *
 * ⚠️ **The transcript is best-effort and has NOT been verified against this
 * account.** RingCentral returns voicemail transcription as a text attachment
 * with `vmTranscriptionStatus` saying whether one exists, but transcription is
 * a per-account feature that may simply be switched off here. When it is, the
 * status comes back `NotAvailable` and there is no text part — so this renders
 * a plain note rather than an error, exactly as `CallHistoryButton` treats an
 * absent recording: an account that doesn't produce them is the NORMAL case.
 */
import { useEffect, useState } from "react";
import { Loader2, Play, Voicemail } from "lucide-react";
import {
  fetchRcContentBlobUrl,
  fetchVoicemailTranscript,
  type VoicemailRecord,
} from "@/lib/fax/ringcentralApi";
import { fmtPhone } from "@/lib/assignedPatients/format";

/** Statuses that mean "a transcript exists" — anything else is an absence. */
const HAS_TRANSCRIPT = new Set(["completed", "completedpartially"]);

export function VoicemailDetail({ voicemail }: { voicemail: VoicemailRecord }) {
  const [audio, setAudio] = useState<string | null>(null);
  const [audioErr, setAudioErr] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [transcript, setTranscript] = useState<string>("");
  const [loadingText, setLoadingText] = useState(false);

  // Bound to the voicemail that was open when the fetch started, so clicking
  // quickly down the list can never paint one message's audio into another's
  // pane — and the blob URL is revoked when we move on.
  useEffect(() => {
    setAudio(null);
    setAudioErr(null);
    setTranscript("");
    let alive = true;

    if (voicemail.transcriptUri) {
      setLoadingText(true);
      void fetchVoicemailTranscript(voicemail.transcriptUri)
        .then((t) => alive && setTranscript(t))
        .finally(() => alive && setLoadingText(false));
    }

    return () => {
      alive = false;
    };
    // Keyed on the MESSAGE, not the record object — the record's identity
    // changes on every poll of the voicemail list.
  }, [voicemail.id, voicemail.transcriptUri]);

  // ⚠️ Separate effect, and it must not be folded into the one above: the blob
  // is created later, by `loadAudio`, so a cleanup that ran when the voicemail
  // changed would always see `null`. Revoking on the URL's own change is what
  // actually frees it — an audio blob is megabytes, and a rep clicks down a
  // list of them.
  useEffect(() => {
    if (!audio) return;
    return () => URL.revokeObjectURL(audio);
  }, [audio]);

  async function loadAudio() {
    if (audio || loadingAudio || !voicemail.audioUri) return;
    setLoadingAudio(true);
    setAudioErr(null);
    try {
      setAudio(await fetchRcContentBlobUrl(voicemail.audioUri));
    } catch (e) {
      setAudioErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingAudio(false);
    }
  }

  const expected = HAS_TRANSCRIPT.has(voicemail.transcriptionStatus.toLowerCase());

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-b border-border px-4 py-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Voicemail className="h-4 w-4 text-muted-foreground" />
          {voicemail.fromName || fmtPhone(voicemail.fromNumber)}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {fmtPhone(voicemail.fromNumber)} · {new Date(voicemail.creationTime).toLocaleString()}
        </p>
      </div>

      <div className="border-b border-border px-4 py-3">
        {!voicemail.audioUri && <p className="text-xs text-muted-foreground">No audio attached to this message.</p>}
        {voicemail.audioUri && !audio && (
          <button
            onClick={() => void loadAudio()}
            disabled={loadingAudio}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
          >
            {loadingAudio ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Play message
          </button>
        )}
        {audio && <audio controls src={audio} className="w-full" />}
        {audioErr && <p className="mt-1.5 text-xs text-destructive break-words">{audioErr}</p>}
      </div>

      <div className="px-4 py-3">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Transcript
        </p>
        {loadingText && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Fetching…
          </p>
        )}
        {!loadingText && transcript && (
          <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-2.5 text-xs leading-relaxed">
            {transcript}
          </p>
        )}
        {!loadingText && !transcript && (
          <p className="text-xs text-muted-foreground">
            {expected
              ? "RingCentral says a transcript exists but returned no text for it."
              : voicemail.transcriptionStatus
                ? `No transcript — RingCentral reports "${voicemail.transcriptionStatus}".`
                : "No transcript. Voicemail transcription may not be switched on for this account."}
          </p>
        )}
      </div>
    </div>
  );
}

export default VoicemailDetail;
