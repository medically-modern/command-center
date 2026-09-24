/**
 * The arithmetic behind `components/shared/AudioPlayer` — the big, scrubbable
 * player every call recording and voicemail in the app now plays in.
 *
 * Kept pure and apart from the component so the rules a rep relies on while
 * scrubbing — where a click on the bar lands, what an arrow key does, what the
 * clock says before the file has told us how long it is — are tested rather
 * than eyeballed.
 */

/** The ⟲ / ⟳ buttons: far enough to re-hear a sentence, short enough to aim. */
export const SKIP_SECONDS = 15;

/** An arrow key on the focused bar. Shift+arrow moves by `SKIP_SECONDS`. */
export const KEY_STEP_SECONDS = 5;

/** PageUp / PageDown on the focused bar. */
export const PAGE_STEP_SECONDS = 30;

/**
 * The speed button cycles through these. A rep reviewing a twenty-minute call
 * for one detail listens fast; 2× is the ceiling at which speech stays
 * intelligible on telephone-quality audio.
 */
export const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2] as const;

/**
 * "0:42", "6:33", "1:02:05". A value the file has not told us yet — `NaN`, or
 * the `Infinity` a streamed file reports before it has been read to the end —
 * prints as "--:--" rather than a fabricated zero, because a clock reading
 * "0:00" of "0:00" says the recording is empty.
 */
export function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "--:--";
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * How long the bar is, in seconds.
 *
 * The file's own answer wins once it has one. Until then — and for a file that
 * never gives a finite answer — the length the call log or the archive already
 * recorded is used, so the bar can be scrubbed the moment it appears instead of
 * after the browser has read the whole file. Zero means "not known at all", and
 * the bar then refuses to seek rather than guessing where a click lands.
 */
export function effectiveDuration(mediaDuration: number, hint?: number): number {
  if (Number.isFinite(mediaDuration) && mediaDuration > 0) return mediaDuration;
  if (typeof hint === "number" && Number.isFinite(hint) && hint > 0) return hint;
  return 0;
}

/** A time the bar may seek to: never before the start, never past the end. */
export function clampTime(t: number, duration: number): number {
  if (!Number.isFinite(t) || t < 0) return 0;
  if (!(duration > 0)) return 0;
  return Math.min(t, duration);
}

/**
 * Where on the bar a pointer is, 0–1. A zero-width bar (not laid out yet)
 * answers 0 rather than dividing by zero into `NaN`, which would seek to the
 * start silently.
 */
export function fractionAt(clientX: number, left: number, width: number): number {
  if (!(width > 0) || !Number.isFinite(clientX)) return 0;
  const f = (clientX - left) / width;
  if (f < 0) return 0;
  if (f > 1) return 1;
  return f;
}

/** The next speed in the cycle; an unrecognised rate starts it again at 1×. */
export function nextRate(rate: number): number {
  const i = PLAYBACK_RATES.findIndex((r) => Math.abs(r - rate) < 0.001);
  return i < 0 ? PLAYBACK_RATES[0] : PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length];
}

/** "1×", "1.25×", "2×". */
export function rateLabel(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}

/**
 * What a key on the focused bar seeks to, or null when the key is not a seek
 * (so the player can leave it alone — Tab must still move focus).
 */
export function keySeek(key: string, shift: boolean, current: number, duration: number): number | null {
  if (!(duration > 0)) return null;
  const step = shift ? SKIP_SECONDS : KEY_STEP_SECONDS;
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return clampTime(current - step, duration);
    case "ArrowRight":
    case "ArrowUp":
      return clampTime(current + step, duration);
    case "PageDown":
      return clampTime(current - PAGE_STEP_SECONDS, duration);
    case "PageUp":
      return clampTime(current + PAGE_STEP_SECONDS, duration);
    case "Home":
      return 0;
    case "End":
      return duration;
    default:
      return null;
  }
}
