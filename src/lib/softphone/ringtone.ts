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
 * ⚠️⚠️ **THE WHOLE RING IS SCHEDULED ON THE AUDIO CLOCK, NEVER REPEATED BY A
 * TIMER** (2026-09-28). The tab that makes the sound is the LEADER tab
 * (tabProtocol.ts) — whichever tab took the Web Lock first, which is very
 * often NOT the tab the rep is looking at. Chrome throttles `setInterval` in a
 * hidden tab to once a second, and to once a minute once it has been hidden a
 * few minutes ("intensive throttling"), so a chime repeated on a timer can be
 * an isolated blip, or land after the call has already gone to voicemail. Web
 * Audio nodes scheduled against `ctx.currentTime` are not throttled, so
 * `start()` schedules every chime of the whole ring window up front and
 * `stop()` cancels what has not sounded yet. There is no repeating timer in
 * this file, and `softphoneRules.test.ts` fails the build if one comes back.
 *
 * ⚠️ Browsers keep an AudioContext suspended until the page has seen a user
 * gesture, and `resume()` is asynchronous. The old code created the context at
 * the moment the call arrived, fired `resume()` without awaiting it, and then
 * dropped any chime it found the context still suspended for — so the FIRST
 * chime of a ring was routinely lost, and a tab that had never been clicked in
 * stayed silent for the whole call with nothing to say why. Now: `prime()` is
 * called from the first user gesture in the page (softphone.ts), long before a
 * call arrives, and `start()` waits for the resume rather than talking over it.
 * A context that still cannot run leaves `blocked` true and the card alone —
 * silence is never an error here, but it is no longer silent by accident.
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
const REPEAT_S = 3.2;
/**
 * How much ring to schedule in one go. Covers `ringRules.RING_AUDIBLE_MS`, the
 * longest a ring is allowed to chime, so the sound never depends on a timer
 * firing again — see the header.
 */
const WINDOW_S = 46;

export class Ringtone {
  private ctx: AudioContext | null = null;
  private oscillators: OscillatorNode[] = [];
  /** A ring is wanted: `start()` without a `stop()` since. */
  private wanted = false;
  /** The chimes for this ring are already on the audio clock. */
  private scheduled = false;
  /** The last attempt could not get an AudioContext running (no user gesture
   *  in this tab yet, or the browser refused one). Read for support, not for
   *  control flow: the card shows regardless. */
  blocked = false;

  get playing(): boolean {
    return this.wanted;
  }

  /**
   * Get the audio path ready outside a ring — called from the first user
   * gesture in the page, so a call never has to fight the autoplay policy in
   * the seconds it has. Cheap and idempotent; also picks up a ring that is
   * already wanted but was blocked when it started.
   */
  prime(): void {
    void this.ensureRunning();
  }

  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    void this.ensureRunning();
  }

  stop(): void {
    this.wanted = false;
    this.scheduled = false;
    for (const o of this.oscillators) {
      try {
        o.stop();
        o.disconnect();
      } catch {
        /* already stopped, or never started */
      }
    }
    this.oscillators = [];
  }

  /**
   * Create the AudioContext if there isn't one, resume it if it is suspended,
   * and schedule the ring once it is actually running. Resolves to whether
   * sound is possible; callers use it for reporting, never to decide whether
   * to show a card.
   */
  private async ensureRunning(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    const Ctx =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return false;
    try {
      this.ctx ??= new Ctx();
      if (this.ctx.state !== "running") await this.ctx.resume();
    } catch {
      this.blocked = true;
      return false;
    }
    const running = this.ctx.state === "running";
    this.blocked = !running;
    // ⚠️ Re-check `wanted`: the resume above is a real await, and the call can
    // have been answered, dismissed or swept while it ran.
    if (running && this.wanted && !this.scheduled) this.schedule();
    return running;
  }

  /** Put the whole ring on the audio clock in one pass — see the header. */
  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.scheduled = true;
    const t0 = ctx.currentTime;
    for (let at = t0; at < t0 + WINDOW_S; at += REPEAT_S) this.chimeAt(ctx, at);
  }

  /** One chime — three bell notes up the triad, starting at `at`. */
  private chimeAt(ctx: AudioContext, at: number): void {
    NOTES_HZ.forEach((hz, i) => {
      const start = at + i * NOTE_SPACING_S;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(PEAK_GAIN, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + NOTE_DECAY_S);
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
        o.start(start);
        o.stop(start + NOTE_DECAY_S + 0.05);
        this.oscillators.push(o);
        // ⚠️ The graph is torn down by the note's OWN `ended` event, not by a
        // timer: a `setTimeout` per note would be throttled in the background
        // tab this usually plays in, and the nodes would pile up for as long
        // as the browser felt like withholding it.
        o.onended = () => {
          this.oscillators = this.oscillators.filter((x) => x !== o);
          o.disconnect();
          part.disconnect();
          gain.disconnect();
        };
      }
    });
  }
}
