/**
 * A ringtone with no asset: a soft rising chime from the Web Audio API.
 *
 * The SDK plays nothing on its own (README, "Enabling Local Ringtones"), and
 * an inbound call that only shows a card is a call people miss. The first cut
 * was the North American ringback pair (440 + 480 Hz) — accurate, and harsh in
 * an office (Josh, 2026-09-14: "a friendlier ringtone"). This is three bell
 * notes up a major triad, C5 · E5 · G5, each with a quick attack and a long
 * exponential decay so it reads as a chime rather than a buzzer, repeated
 * every few seconds while the call is unanswered. Quiet by design: the card is
 * the primary signal, the sound is the nudge.
 *
 * ⚠️ Browsers keep an AudioContext suspended until the page has seen a user
 * gesture. The Command Center is something the rep has clicked around in, so
 * that is nearly always satisfied — and when it is not, `resume()` fails
 * quietly and the card still shows. Silence is never an error here.
 */

/** C5 · E5 · G5 — a rising major triad. */
const NOTES_HZ = [523.25, 659.25, 783.99];
/** Gap between the three notes of one chime. */
const NOTE_SPACING_S = 0.19;
/** How long each note rings out before it is inaudible. */
const NOTE_DECAY_S = 0.9;
/** Peak loudness of a note — deliberately modest for an open office. */
const PEAK_GAIN = 0.16;
/** One chime every this often while the call keeps ringing. */
const REPEAT_MS = 3_200;

export class Ringtone {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private oscillators: OscillatorNode[] = [];

  get playing(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer) return;
    if (typeof window === "undefined") return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    try {
      this.ctx ??= new Ctx();
      void this.ctx.resume().catch(() => {});
    } catch {
      return;
    }
    const chime = () => {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== "running") return;
      NOTES_HZ.forEach((hz, i) => {
        const at = ctx.currentTime + i * NOTE_SPACING_S;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(PEAK_GAIN, at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_DECAY_S);
        gain.connect(ctx.destination);
        // A sine fundamental plus a much quieter octave gives a bell its
        // shimmer without the edge a square or saw would add.
        for (const [mult, level] of [
          [1, 1],
          [2, 0.25],
        ] as const) {
          const o = ctx.createOscillator();
          o.type = "sine";
          o.frequency.value = hz * mult;
          const part = ctx.createGain();
          part.gain.value = level;
          o.connect(part);
          part.connect(gain);
          o.start(at);
          o.stop(at + NOTE_DECAY_S + 0.05);
          this.oscillators.push(o);
          o.onended = () => {
            this.oscillators = this.oscillators.filter((x) => x !== o);
            o.disconnect();
            part.disconnect();
          };
        }
        setTimeout(() => gain.disconnect(), (i * NOTE_SPACING_S + NOTE_DECAY_S + 0.2) * 1000);
      });
    };
    chime();
    this.timer = setInterval(chime, REPEAT_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const o of this.oscillators) {
      try {
        o.stop();
        o.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.oscillators = [];
  }
}
