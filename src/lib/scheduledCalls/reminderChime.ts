/**
 * The scheduled-call heads-up sound — "a distinctly different ring … just have
 * it ring twice" (Josh, 2026-10-02).
 *
 * Built to be told apart from the incoming-call ring (`softphone/ringtone.ts`)
 * without looking: that one is three SINE notes RISING (C5 · E5 · G5),
 * repeating every 3.2 s for as long as the call rings. This is a two-note
 * "ding-dong" FALLING a major third (E6 → C6), an octave higher, on a TRIANGLE
 * wave (a brighter, woodier bell), played exactly twice and then silent.
 *
 * Both rings are scheduled on the audio clock up front, never repeated by a
 * timer — the ringtone's header says why (a hidden tab's timers are throttled).
 * `prime()` is called from the first user gesture in the page, because a
 * browser keeps an AudioContext suspended until it has seen one. Silence is
 * never an error here: the card shows whatever the sound does.
 */

/** E6 then C6 — falling, where the incoming ring rises. */
const DING_DONG_HZ = [1318.51, 1046.5];
const NOTE_GAP_S = 0.42;
const NOTE_DECAY_S = 1.1;
const PEAK_GAIN = 0.2;
/** Start of the second ring after the first. */
const RING_GAP_S = 1.6;
export const RING_COUNT = 2;

let ctx: AudioContext | null = null;

async function running(): Promise<AudioContext | null> {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  try {
    ctx ??= new Ctx();
    if (ctx.state !== "running") await ctx.resume();
    return ctx.state === "running" ? ctx : null;
  } catch {
    return null;
  }
}

/** Get the audio path ready from a user gesture, long before a reminder. */
export function primeReminderChime(): void {
  void running();
}

/** Ring twice. Resolves to whether sound was possible. */
export async function playReminderChime(): Promise<boolean> {
  const c = await running();
  if (!c) return false;
  const t0 = c.currentTime + 0.05;
  for (let r = 0; r < RING_COUNT; r++) {
    DING_DONG_HZ.forEach((hz, i) => note(c, hz, t0 + r * RING_GAP_S + i * NOTE_GAP_S));
  }
  return true;
}

function note(c: AudioContext, hz: number, at: number): void {
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(PEAK_GAIN, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_DECAY_S);
  gain.connect(c.destination);
  const o = c.createOscillator();
  o.type = "triangle";
  o.frequency.value = hz;
  o.connect(gain);
  o.start(at);
  o.stop(at + NOTE_DECAY_S + 0.05);
  o.onended = () => {
    o.disconnect();
    gain.disconnect();
  };
}
