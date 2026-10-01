/**
 * callTranscribeRules.mjs — the pure half of call transcription (§5.47e).
 *
 * Josh, 2026-10-01: call transcripts like the RingCentral app's AI Notes. That
 * route is closed (RingCentral's AI Notes API needs an internal permission,
 * ReadCopilotCallNotes, §5.13c), so the recordings the call archive already
 * stores are sent to Google Cloud Speech-to-Text (BAA accepted 2026-10-01).
 *
 * Measured on 2026-10-01 against the project, with silence (no patient audio):
 *   · speaker diarization works ONLY in BatchRecognize, ONLY on model
 *     `chirp_3`, ONLY in the `us` multi-region location (us-central1 and
 *     global refuse it; `long`/`telephony`/`chirp_2` refuse it everywhere);
 *   · BatchRecognize reads its audio from Cloud Storage, so each recording is
 *     copied to the `mm-call-transcribe` bucket and deleted after;
 *   · a job took ~3.5 minutes end to end, mostly queueing.
 * RingCentral recordings are mono MP3 (32 kHz, measured), so the two sides are
 * NOT on separate channels — "who said what" is Google's diarization.
 */

export const LOCATION = "us";
export const SPEECH_HOST = "us-speech.googleapis.com";
export const MODEL = "chirp_3";

/** Calls shorter than this aren't worth a transcript (rings, hang-ups). */
export const MIN_DURATION_SEC = Math.max(Number(process.env.GOOGLE_STT_MIN_SEC) || 10, 1);
/** New jobs started per tick, and the most running at once. */
export const START_PER_TICK = Math.max(Number(process.env.GOOGLE_STT_PER_TICK) || 4, 1);
export const MAX_RUNNING = Math.max(Number(process.env.GOOGLE_STT_MAX_RUNNING) || 12, 1);
/** Only calls this recent are picked up — the last 3 days (Josh, 2026-10-01). */
export const LOOKBACK_HOURS = Math.max(Number(process.env.GOOGLE_STT_LOOKBACK_HOURS) || 72, 1);
export const TICK_MS = 2 * 60_000;
/** A job still not done after this is abandoned (and its audio copy deleted). */
export const JOB_TIMEOUT_MS = 3 * 60 * 60_000;
export const MAX_ATTEMPTS = 3;

/**
 * Switched on by an explicit flag, never by the credentials alone: sending
 * patient audio to a third party needs the BAA in place first, and the
 * variables were set before it was confirmed.
 */
export function transcribeEnabled(env = process.env) {
  return (
    env.GOOGLE_STT_ENABLED === "1" &&
    !!env.GOOGLE_STT_CREDENTIALS &&
    !!env.GOOGLE_STT_BUCKET &&
    !!env.GOOGLE_STT_PROJECT
  );
}

/** The GCS object a call's audio is copied to. Call ids carry no PHI. */
export function gcsObjectName(callId) {
  return `calls/${String(callId).replace(/[^A-Za-z0-9_-]/g, "_")}.mp3`;
}

export function batchRequestBody(gcsUri) {
  return {
    config: {
      autoDecodingConfig: {},
      model: MODEL,
      languageCodes: ["en-US"],
      features: {
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: true,
        diarizationConfig: { minSpeakerCount: 2, maxSpeakerCount: 2 },
      },
    },
    files: [{ uri: gcsUri }],
    recognitionOutputConfig: { inlineResponseConfig: {} },
  };
}

/** "12.340s" → 12.34; anything else → null. */
export function seconds(d) {
  if (typeof d === "number") return d;
  const m = /^(-?\d+(?:\.\d+)?)s$/.exec(String(d ?? ""));
  return m ? Number(m[1]) : null;
}

/**
 * The per-file result out of a finished BatchRecognize operation. The v2 API
 * has put it at `inlineResult.transcript` and (deprecated) at `transcript`;
 * both are read.
 */
export function fileResult(operation, gcsUri) {
  const results = operation?.response?.results;
  if (!results || typeof results !== "object") return { error: null, results: [] };
  const file = results[gcsUri] ?? Object.values(results)[0];
  if (!file) return { error: null, results: [] };
  if (file.error && (file.error.code || file.error.message)) {
    return { error: String(file.error.message || `code ${file.error.code}`), results: [] };
  }
  const t = file.inlineResult?.transcript ?? file.transcript ?? {};
  return { error: null, results: Array.isArray(t.results) ? t.results : [] };
}

/**
 * Turn recognition results into speaker turns: [{ speaker, start, text }].
 *
 * ⚠️ Two shapes are handled because the docs don't pin which one chirp_3
 * returns with diarization:
 *   · words carry `speakerLabel` in each result → walk every result's words;
 *   · one result carries ALL the words, labelled (the v1 style) while the
 *     others carry the same words unlabelled → use only that result, or every
 *     word would appear twice.
 * Words with no speaker label anywhere → one turn per result, speaker "".
 */
export function turnsFrom(results) {
  const list = Array.isArray(results) ? results : [];
  const alts = list.map((r) => r?.alternatives?.[0]).filter(Boolean);
  const labelled = alts.map((a) => (Array.isArray(a.words) ? a.words : []).filter((w) => w?.speakerLabel));
  const total = alts.reduce((n, a) => n + (Array.isArray(a.words) ? a.words.length : 0), 0);

  let words = [];
  const withLabels = labelled.filter((l) => l.length);
  const best = withLabels.reduce((b, w) => (w.length > b.length ? w : b), []);
  if (withLabels.length === 1 && alts.length > 1 && best.length >= total - best.length) {
    // v1 style: ONE result holds the whole call, labelled, beside the same
    // words unlabelled in the others.
    words = best;
  } else {
    words = labelled.flat();
  }

  if (!words.length) {
    // No diarization came back — keep the text, without speakers.
    return alts
      .map((a, i) => ({
        speaker: "",
        start: seconds(list[i]?.alternatives?.[0]?.words?.[0]?.startOffset) ?? null,
        text: String(a.transcript || "").trim(),
      }))
      .filter((t) => t.text);
  }

  const turns = [];
  for (const w of words) {
    const speaker = String(w.speakerLabel || "");
    const text = String(w.word || "").trim();
    if (!text) continue;
    const last = turns[turns.length - 1];
    if (last && last.speaker === speaker) last.text += ` ${text}`;
    else turns.push({ speaker, start: seconds(w.startOffset), text });
  }
  return turns;
}

/** What is stored in call_archive.transcript_json. */
export function transcriptRecord(turns) {
  const speakers = [...new Set(turns.map((t) => t.speaker).filter(Boolean))];
  return { v: 1, model: MODEL, speakers, turns };
}
