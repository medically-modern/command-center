/**
 * A ringtone with no asset: two-tone bursts from the Web Audio API.
 *
 * The SDK plays nothing on its own (README, "Enabling Local Ringtones"), and
 * an inbound call that only shows a card is a call people miss. US ringback is
 * 440 Hz + 480 Hz, 2s on / 4s off; this rings a touch faster because the whole
 * window before voicemail is ~20 seconds.
 *
 * ⚠️ Browsers keep an AudioContext suspended until the page has seen a user
 * gesture. The Command Center is something the rep has clicked around in, so
 * that is nearly always satisfied — and when it is not, `resume()` fails
 * quietly and the card still shows. Silence is never an error here.
 */
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
    const burst = () => {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== "running") return;
      const gain = ctx.createGain();
      gain.gain.value = 0.12;
      gain.connect(ctx.destination);
      for (const hz of [440, 480]) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = hz;
        o.connect(gain);
        o.start();
        o.stop(ctx.currentTime + 1.0);
        this.oscillators.push(o);
        o.onended = () => {
          this.oscillators = this.oscillators.filter((x) => x !== o);
          o.disconnect();
        };
      }
      setTimeout(() => gain.disconnect(), 1_100);
    };
    burst();
    this.timer = setInterval(burst, 3_000);
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
