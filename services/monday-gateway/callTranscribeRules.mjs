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
export function gcsObjectName(callId, part = 0) {
  const id = String(callId).replace(/[^A-Za-z0-9_-]/g, "_");
  return part ? `calls/${id}-p${part}.mp3` : `calls/${id}.mp3`;
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
  // The by-name lookup is the rule; the lone-entry fallback covers a key that
  // comes back spelled differently. With several pieces, never guess — that
  // would hand every piece the first piece's words.
  const entries = Object.values(results);
  const file = results[gcsUri] ?? (entries.length === 1 ? entries[0] : null);
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

/* ── long calls: split the MP3 at frame boundaries ───────────────────────── */

/**
 * ⚠️ BatchRecognize with chirp_3 refuses audio over 20 minutes ("Only audio
 * files up to 20 minutes long are supported", the first long call, 2026-10-01).
 * A long call is split into pieces of at most CHUNK_SEC, sent as several files
 * in ONE job, and the turns stitched back with each piece's start offset.
 * MP3 is a sequence of self-contained frames, so cutting between frames needs
 * no re-encoding. Speaker labels are per piece: "Speaker 1" in one piece is not
 * guaranteed to be the same voice in the next.
 */
export const CHUNK_SEC = 15 * 60;

const BITRATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], // MPEG-1 Layer III
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], // MPEG-2/2.5 Layer III
};
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** One Layer III frame header at `i`: { length, seconds }, or null. */
export function mp3Frame(buf, i) {
  if (i + 4 > buf.length || buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) return null;
  const version = (buf[i + 1] >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  const layer = (buf[i + 1] >> 1) & 3; // 1 = Layer III
  if (version === 1 || layer !== 1) return null;
  const bitrate = BITRATES[version === 3 ? 1 : 2][buf[i + 2] >> 4];
  const rate = RATES[version]?.[(buf[i + 2] >> 2) & 3];
  if (!bitrate || !rate) return null;
  const padding = (buf[i + 2] >> 1) & 1;
  const mpeg1 = version === 3;
  const length = Math.floor(((mpeg1 ? 144 : 72) * bitrate * 1000) / rate) + padding;
  const samples = mpeg1 ? 1152 : 576;
  return length > 4 ? { length, seconds: samples / rate } : null;
}

/** Skip an ID3v2 tag at the start, if any. */
function audioStart(buf) {
  if (buf.length >= 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    return 10 + ((buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9]);
  }
  return 0;
}

/**
 * Split an MP3 into pieces of at most `maxSec`: [{ buf, startSec }]. A buffer
 * that is not parseable MP3, or is already short enough, comes back whole.
 */
export function splitMp3(buf, maxSec = CHUNK_SEC) {
  const start = audioStart(buf);
  const pieces = [];
  let i = start;
  let pieceStart = start;
  let pieceSec = 0;
  let total = 0;
  let pieceAt = 0;
  while (i < buf.length) {
    const f = mp3Frame(buf, i);
    if (!f) {
      // Resync: scan forward to the next frame header.
      let j = i + 1;
      while (j < buf.length && !mp3Frame(buf, j)) j++;
      if (j >= buf.length) break;
      i = j;
      continue;
    }
    if (pieceSec + f.seconds > maxSec && i > pieceStart) {
      pieces.push({ buf: buf.subarray(pieceStart, i), startSec: pieceAt });
      pieceStart = i;
      pieceAt = total;
      pieceSec = 0;
    }
    pieceSec += f.seconds;
    total += f.seconds;
    i += f.length;
  }
  if (!pieces.length) return [{ buf, startSec: 0 }];
  pieces.push({ buf: buf.subarray(pieceStart), startSec: pieceAt });
  return pieces;
}

/** The request for several pieces of one call. */
export function batchRequestBodyFor(uris) {
  const body = batchRequestBody(uris[0]);
  body.files = uris.map((uri) => ({ uri }));
  return body;
}

/** Turns from every piece, in order, with each piece's start added. */
export function stitchTurns(pieces) {
  const out = [];
  for (const { startSec, results } of pieces) {
    for (const t of turnsFrom(results)) {
      out.push({ ...t, start: t.start == null ? (startSec || null) : Math.round((t.start + startSec) * 100) / 100 });
    }
  }
  return out;
}
