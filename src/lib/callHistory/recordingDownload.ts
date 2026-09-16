/**
 * Downloading call recordings out of the Command Center.
 *
 * Playing a recording was never the whole job: a rep who needs to send a call
 * to a manager, attach it to an appeal, or keep it past RingCentral's retention
 * had no way to get the audio off the page (Josh, 2026-09-16 — "all of the
 * calls today i want the option to download them").
 *
 * ⚠️ **RINGCENTRAL DELETES RECORDINGS AT 90 DAYS.** Measured against the live
 * account on 2026-09-16, and it is a cliff rather than a slope: 88–90 days ago
 * 9/9 connected calls still had audio, 90–92 days ago 0/126 did. The call-log
 * ROW survives the purge, so an old call still renders with its duration and
 * simply carries no `recording` — which is indistinguishable, on screen, from a
 * call that was never recorded. Everything a rep might want later has to be
 * pulled before it turns 90 days old; the app cannot fetch it back afterwards.
 * (Auto-recording itself is on for both directions — 760/774 connected calls in
 * the same sample were recorded — so inside the window "no audio" means the
 * call never connected.)
 *
 * ⚠️ **Bulk download is paced, and the pacing is not politeness.** The gateway
 * budgets RingCentral at `maxPerCallerPerWindow: 40` per 60s and sheds
 * background polling above 70% of a global 90 (`services/monday-gateway/
 * rcLimiter.mjs`). One unpaced loop over a day of calls is both refused
 * part-way AND starves every other rep's inbox poll — INCIDENT_2026-08-20's
 * shape with a download button on it. `DEFAULT_GAP_MS` keeps a batch at ~24
 * requests a minute, and a refusal backs off and carries on rather than
 * failing the run.
 */

import { fetchRecordingBlob } from "../fax/ringcentralApi";

/** The least a call has to carry to be downloadable. `PatientCall` satisfies
 *  this, and so does a row built from a raw call-log record, so both surfaces
 *  share one downloader rather than growing two. */
export interface DownloadableCall {
  id: string;
  /** ISO start time, straight from RingCentral (a real UTC instant). */
  startTime: string;
  direction: "Inbound" | "Outbound";
  durationSec: number;
  /** Who the call was with — used to name the file when no better name is
   *  known. */
  otherNumber?: string;
  recording?: { id: string; contentUri: string };
}

/** Gap between requests in a bulk run. 2.5s ≈ 24/min, comfortably inside the
 *  gateway's per-caller budget of 40/min and low enough that a batch does not
 *  push the whole gateway past its background-shed floor. */
export const DEFAULT_GAP_MS = 2_500;

/** One extra attempt per recording, after this pause, before it is recorded as
 *  failed and the run moves on. A throttled request is the expected failure
 *  here, and a whole batch abandoned because one file was refused is the worse
 *  outcome. */
const RETRY_PAUSE_MS = 6_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The call's date and time on the OFFICE clock.
 *
 * ⚠️ Eastern, explicitly, like every other timestamp on these boards (§5.15).
 * A RingCentral `startTime` IS a real UTC instant — unlike a naive Monday
 * column — so `new Date` is correct here; what must not happen is letting the
 * browser's own zone name the file, because a rep who travels would then
 * produce filenames that disagree with the same call in everyone else's list.
 */
export function etStamp(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return { date: "undated", time: "" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const p: Record<string, string> = {};
  for (const x of parts) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}${p.minute}` };
}

/** Today's date on the office clock, as `YYYY-MM-DD`. */
export function etToday(now: Date = new Date()): string {
  return etStamp(now.toISOString()).date;
}

/** Was this call placed today, Eastern? The Phone tab's "Today" filter and the
 *  filename share this so a batch labelled "today" and a filename dated today
 *  can never disagree across midnight. */
export function isEtToday(iso: string, now: Date = new Date()): boolean {
  return !!iso && etStamp(iso).date === etToday(now);
}

/** `6m33s` / `47s` — the same shape the filename and the confirm dialog use. */
export function durationSlug(seconds: number): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

/** Filename-safe slug. Anything that is not a letter or digit becomes a single
 *  hyphen, so a name, a formatted number and an email all survive intact enough
 *  to read and none of them can smuggle a path separator into a save dialog. */
export function slug(value: string, max = 40): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/**
 * The extension is taken from what RingCentral actually sent, never assumed.
 *
 * Recordings come back as MP3 on most accounts and WAV on some, and the setting
 * is per-account rather than per-call — so hardcoding `.mp3` produces a file
 * that will not open on exactly the accounts where it is wrong, with nothing
 * saying why.
 */
export function extensionFor(mimeType: string | undefined): string {
  const t = String(mimeType ?? "").toLowerCase().split(";")[0].trim();
  if (t === "audio/wav" || t === "audio/x-wav" || t === "audio/wave") return "wav";
  if (t === "audio/ogg") return "ogg";
  if (t === "audio/mp4" || t === "audio/x-m4a") return "m4a";
  return "mp3";
}

/**
 * What the saved file is called, e.g.
 * `2026-09-16_1226ET_Charmaine-Brooks_outbound_6m33s.mp3`.
 *
 * Date first so a folder of them sorts chronologically, then the office clock
 * time, then who the call was with — that is the order somebody scanning a
 * download folder reads in. The number is the fallback name, because a file
 * called `unknown` is no use in an appeal.
 */
export function recordingFilename(
  call: DownloadableCall,
  opts: { who?: string; ext?: string } = {},
): string {
  const { date, time } = etStamp(call.startTime);
  const who = slug(opts.who || call.otherNumber || "unknown");
  const dir = call.direction === "Inbound" ? "inbound" : "outbound";
  const bits = [date, time ? `${time}ET` : "", who, dir, durationSlug(call.durationSec)].filter(Boolean);
  return `${bits.join("_")}.${opts.ext || "mp3"}`;
}

/** Hand the browser a blob to save. Split out so the download path is one
 *  place and the revoke can never be forgotten — an un-revoked audio blob holds
 *  real memory for as long as the tab lives. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously races the browser's own read of the blob in some
  // engines, so it waits a tick rather than a frame-perfect cleanup.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Fetch one recording and save it. Returns the filename actually used. */
export async function downloadRecording(
  call: DownloadableCall,
  opts: { who?: string } = {},
): Promise<string> {
  if (!call.recording?.contentUri) throw new Error("This call has no recording.");
  const blob = await fetchRecordingBlob(call.recording.contentUri);
  const name = recordingFilename(call, { who: opts.who, ext: extensionFor(blob.type) });
  saveBlob(blob, name);
  return name;
}

export interface BulkProgress {
  /** Finished, successfully or not. */
  done: number;
  total: number;
  ok: number;
  failed: number;
}

export interface BulkResult {
  ok: number;
  failures: Array<{ id: string; error: string }>;
  /** True when the caller aborted part-way. */
  cancelled: boolean;
}

/** Only calls that actually carry audio — the rest have nothing to fetch. */
export function withRecordings<T extends DownloadableCall>(calls: readonly T[]): T[] {
  return calls.filter((c) => !!c.recording?.contentUri);
}

/**
 * Download a run of recordings, one at a time.
 *
 * ⚠️ **Sequential on purpose, and not only for the rate limit.** Browsers
 * throttle or silently drop a burst of simultaneous downloads, so a parallel
 * version appears to work and quietly saves a fraction of the files — the
 * failure mode that is worse than an error, because the rep believes they have
 * the call they went looking for.
 *
 * ⚠️ A failure never ends the run. One recording refused by a throttle, or one
 * whose media URL has expired, must not cost the other sixty; failures are
 * collected and reported together at the end.
 */
export async function downloadRecordings(
  calls: readonly DownloadableCall[],
  opts: {
    /** Display name per call id, where the caller knows one. */
    nameFor?: (call: DownloadableCall) => string | undefined;
    gapMs?: number;
    onProgress?: (p: BulkProgress) => void;
    /** Abort a run in flight. Whatever has already saved stays saved. */
    signal?: AbortSignal;
  } = {},
): Promise<BulkResult> {
  const list = withRecordings(calls);
  const gap = opts.gapMs ?? DEFAULT_GAP_MS;
  const failures: BulkResult["failures"] = [];
  let ok = 0;

  for (let i = 0; i < list.length; i++) {
    if (opts.signal?.aborted) {
      return { ok, failures, cancelled: true };
    }
    const call = list[i];
    try {
      await downloadRecording(call, { who: opts.nameFor?.(call) });
      ok++;
    } catch (first) {
      // Almost always a throttle. Wait longer than the gap, try once more, and
      // only then give up on this one.
      await sleep(RETRY_PAUSE_MS);
      if (opts.signal?.aborted) return { ok, failures, cancelled: true };
      try {
        await downloadRecording(call, { who: opts.nameFor?.(call) });
        ok++;
      } catch (second) {
        failures.push({
          id: call.id,
          error: second instanceof Error ? second.message : String(second ?? first),
        });
      }
    }
    opts.onProgress?.({ done: i + 1, total: list.length, ok, failed: failures.length });
    if (i < list.length - 1) await sleep(gap);
  }

  return { ok, failures, cancelled: false };
}

/** Roughly how long a batch will take, for the confirm dialog. A rep who is
 *  told "about 3 minutes" leaves it running; one who is told nothing closes the
 *  tab half way and loses the rest. */
export function estimateMinutes(count: number, gapMs = DEFAULT_GAP_MS): number {
  return Math.max(1, Math.ceil((count * (gapMs + 800)) / 60_000));
}
