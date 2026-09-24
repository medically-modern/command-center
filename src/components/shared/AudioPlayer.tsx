/**
 * A call recording or voicemail you can actually SCRUB.
 *
 * Josh, 2026-09-24: *"its impossible to scrub the calls and voicemails cause
 * the areas too small, make it large so i can scrub back and forth"*. Every
 * player in the app was the browser's own `<audio controls>`, squeezed to
 * h-8/h-9 inside a row capped at 78% of a half-screen pane. Chrome gives that
 * control's timeline whatever is left once the play button, both clocks, the
 * volume and the ⋮ menu have taken their share — on a ~400px row that is a
 * sliver of about a hundred pixels, so a six-minute call moved in
 * three-second jumps per pixel and a rep could not land on a sentence.
 *
 * So this draws its own controls around a hidden `<audio>`:
 *   · a bar the full width of its container with a tall hit area, that seeks
 *     WHILE you drag (you hear where you are) and shows the time under the
 *     pointer before you click;
 *   · big play/pause, ⟲15 / ⟳15, a clock, and a speed button (1× → 2×);
 *   · the keyboard on the focused bar: arrows ±5s (Shift ±15s), PageUp/Down
 *     ±30s, Home/End, Space to play or pause.
 *
 * ⚠️ **The bytes are never fetched here.** Callers resolve `src` on the press
 * of a Play button — a blob URL from RingCentral, or the archive's presigned
 * link used as a bare `src` (never `fetch()`ed: a cross-origin redirect with
 * fetch needs CORS on the bucket, which Railway cannot set, §5.47). This only
 * plays what it is handed.
 *
 * ⚠️ **`onError` is the caller's cue to hand back a Play button.** An archive
 * link dies after five minutes (§5.47), so a recording paused and resumed
 * later can fail mid-play; a silent, broken player is worse than a button that
 * fetches a fresh link.
 *
 * ⚠️ Tailwind utilities only work OUTSIDE the page design systems that reset
 * bare buttons (`.pf-root`, `.bnr`, §9). Every place this renders today — the
 * Communications popup and the hub (both unscoped or portalled to the body),
 * the Welcome Call activity card — is outside them; a caller inside one needs
 * that page's own button language first.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Loader2, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import {
  SKIP_SECONDS,
  clampTime,
  effectiveDuration,
  formatClock,
  fractionAt,
  keySeek,
  nextRate,
  rateLabel,
} from "@/lib/shared/audioScrub";
import { cn } from "@/lib/utils";

export function AudioPlayer({
  src,
  autoPlay = true,
  durationHint,
  onError,
  label = "Recording",
  className,
}: {
  src: string;
  /** Start as soon as it can. On by default: every caller reaches here from a
   *  Play button the rep has just pressed. */
  autoPlay?: boolean;
  /** Seconds, from the call log or the archive — lets the bar be scrubbed
   *  before the file has reported its own length. */
  durationHint?: number;
  /** The audio failed to load or died mid-play (an expired link). */
  onError?: () => void;
  /** What this is, for screen readers — "Call recording", "Voicemail". */
  label?: string;
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [time, setTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(Number.NaN);
  const [rate, setRate] = useState(1);
  /** Seconds under the pointer while it is held down on the bar. */
  const [drag, setDrag] = useState<number | null>(null);
  const dragging = useRef(false);
  /** Where the pointer is hovering, for the time bubble. */
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const raf = useRef(0);

  const duration = effectiveDuration(mediaDuration, durationHint);
  const shown = drag ?? time;
  const pct = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0;

  // A new file is a new recording: nothing about the last one carries over.
  useEffect(() => {
    setPlaying(false);
    setTime(0);
    setMediaDuration(Number.NaN);
    setDrag(null);
    dragging.current = false;
  }, [src]);

  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    },
    [],
  );

  // The speed survives a new `src` (a re-issued link) — the rep chose it.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, src]);

  const seekTo = useCallback(
    (t: number) => {
      const a = audioRef.current;
      if (!a || !(duration > 0)) return;
      const next = clampTime(t, duration);
      try {
        a.currentTime = next;
      } catch {
        /* a file with no metadata yet refuses; the next timeupdate corrects the bar */
      }
      setTime(next);
    },
    [duration],
  );

  /** One seek per frame while dragging — every pointermove would otherwise be
   *  a request against the archive's link. */
  const scheduleSeek = useCallback(
    (t: number) => {
      pendingSeek.current = t;
      if (raf.current) return;
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        const v = pendingSeek.current;
        pendingSeek.current = null;
        if (v !== null) seekTo(v);
      });
    },
    [seekTo],
  );

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      // A refused play (autoplay policy, a dead link) is reported by the
      // element's own error / pause events. ⚠️ Older engines return nothing
      // from play(), so the promise is only handled when there is one.
      const p = a.play() as Promise<void> | undefined;
      if (p && typeof p.catch === "function") p.catch(() => {});
    } else a.pause();
  }, []);

  const skip = (delta: number) => seekTo((audioRef.current?.currentTime ?? time) + delta);

  const at = (clientX: number): number => {
    const r = barRef.current?.getBoundingClientRect();
    if (!r) return 0;
    return fractionAt(clientX, r.left, r.width) * duration;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!(duration > 0)) return;
    e.preventDefault();
    barRef.current?.focus();
    try {
      barRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic event has no pointer to capture */
    }
    dragging.current = true;
    const t = at(e.clientX);
    setDrag(t);
    scheduleSeek(t);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!(duration > 0)) return;
    const r = barRef.current?.getBoundingClientRect();
    const t = at(e.clientX);
    if (r) setHover({ x: Math.min(Math.max(e.clientX - r.left, 0), r.width), t });
    if (dragging.current) {
      setDrag(t);
      scheduleSeek(t);
    }
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    const t = at(e.clientX);
    seekTo(t);
    setDrag(null);
    try {
      barRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggle();
      return;
    }
    const next = keySeek(e.key, e.shiftKey, audioRef.current?.currentTime ?? time, duration);
    if (next === null) return;
    e.preventDefault();
    seekTo(next);
  };

  const iconBtn =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40";

  return (
    <div
      className={cn("w-full rounded-xl border border-border bg-card px-3 pb-2 pt-2.5 shadow-sm", className)}
      role="group"
      aria-label={label}
    >
      <audio
        ref={audioRef}
        src={src}
        autoPlay={autoPlay}
        preload="metadata"
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onTimeUpdate={(e) => {
          if (!dragging.current) setTime(e.currentTarget.currentTime);
        }}
        onLoadedMetadata={(e) => setMediaDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setMediaDuration(e.currentTarget.duration)}
        onError={() => {
          setPlaying(false);
          onError?.();
        }}
      />

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[color:var(--mm-teal)] text-[color:var(--mm-on-teal,#fff)] shadow-sm transition-opacity hover:opacity-90"
        >
          {waiting && playing ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : playing ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Play className="ml-0.5 h-5 w-5" />
          )}
        </button>
        <button
          type="button"
          onClick={() => skip(-SKIP_SECONDS)}
          disabled={!(duration > 0)}
          className={iconBtn}
          aria-label={`Back ${SKIP_SECONDS} seconds`}
          title={`Back ${SKIP_SECONDS} seconds`}
        >
          <RotateCcw className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={() => skip(SKIP_SECONDS)}
          disabled={!(duration > 0)}
          className={iconBtn}
          aria-label={`Forward ${SKIP_SECONDS} seconds`}
          title={`Forward ${SKIP_SECONDS} seconds`}
        >
          <RotateCw className="h-[18px] w-[18px]" />
        </button>
        <span className="ml-1 text-sm font-semibold tabular-nums">
          {formatClock(shown)}
          <span className="font-normal text-muted-foreground"> / {formatClock(duration > 0 ? duration : Number.NaN)}</span>
        </span>
        <button
          type="button"
          onClick={() => setRate((r) => nextRate(r))}
          className="ml-auto inline-flex h-8 min-w-[3.25rem] items-center justify-center rounded-full border border-border px-2.5 text-xs font-semibold tabular-nums text-foreground transition-colors hover:bg-muted"
          aria-label={`Playback speed ${rateLabel(rate)} — change`}
          title="Playback speed"
        >
          {rateLabel(rate)}
        </button>
      </div>

      {/* ⚠️ The bar is the point of this component. Tall hit area (36px) with
          an 8px track, the full width of whatever holds the player — a drag
          seeks as it goes, so a rep scrubbing back hears where they are. */}
      <div
        ref={barRef}
        role="slider"
        tabIndex={0}
        aria-label={`${label} position`}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={`${formatClock(shown)} of ${formatClock(duration > 0 ? duration : Number.NaN)}`}
        aria-disabled={duration > 0 ? undefined : true}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        className={cn(
          "group relative mt-1 h-9 touch-none select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
          duration > 0 ? "cursor-pointer" : "cursor-default",
        )}
      >
        <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-[color:var(--mm-teal)]" style={{ width: `${pct}%` }} />
        </div>
        {duration > 0 && (
          <div
            className={cn(
              "pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-[color:var(--mm-teal)] shadow transition-transform",
              drag !== null ? "scale-125" : "group-hover:scale-110",
            )}
            style={{ left: `${pct}%` }}
          />
        )}
        {hover && duration > 0 && (
          <div
            className="pointer-events-none absolute -top-6 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-background shadow"
            style={{ left: hover.x }}
          >
            {formatClock(drag ?? hover.t)}
          </div>
        )}
      </div>
    </div>
  );
}

export default AudioPlayer;
