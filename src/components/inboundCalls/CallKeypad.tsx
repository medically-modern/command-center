/**
 * The keypad for a live browser call — press 1 for billing, enter an extension,
 * get through a payer's phone tree, the way the RingCentral app's keypad does
 * (Josh, 2026-10-01).
 *
 * Each press goes to the softphone's `sendDtmf` (RTP telephone-events on the
 * live session, sent by the leader tab), and plays the same tone locally so the
 * rep hears the press. Typing digits, * or # on the keyboard works too while
 * the keypad is open — except inside a text field, where the keys are the
 * rep's typing, not tones.
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const KEYS: Array<[string, string]> = [
  ["1", ""],
  ["2", "ABC"],
  ["3", "DEF"],
  ["4", "GHI"],
  ["5", "JKL"],
  ["6", "MNO"],
  ["7", "PQRS"],
  ["8", "TUV"],
  ["9", "WXYZ"],
  ["*", ""],
  ["0", "+"],
  ["#", ""],
];

/** The two frequencies of each key (the standard DTMF grid). */
const FREQ: Record<string, [number, number]> = {
  "1": [697, 1209], "2": [697, 1336], "3": [697, 1477],
  "4": [770, 1209], "5": [770, 1336], "6": [770, 1477],
  "7": [852, 1209], "8": [852, 1336], "9": [852, 1477],
  "*": [941, 1209], "0": [941, 1336], "#": [941, 1477],
};

let audio: AudioContext | null = null;

/** A short local beep of the key's tone, so the press is heard. Never throws. */
function playTone(key: string): void {
  const f = FREQ[key];
  if (!f) return;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio = audio ?? new Ctx();
    const ctx = audio;
    const gain = ctx.createGain();
    gain.gain.value = 0.06;
    gain.connect(ctx.destination);
    const stopAt = ctx.currentTime + 0.12;
    for (const hz of f) {
      const osc = ctx.createOscillator();
      osc.frequency.value = hz;
      osc.connect(gain);
      osc.start();
      osc.stop(stopAt);
    }
  } catch {
    /* no audio — the tone still went down the line */
  }
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

interface Props {
  onDigit: (digit: string) => void;
  /** Tones only go on a connected call. */
  disabled?: boolean;
  className?: string;
}

export default function CallKeypad({ onDigit, disabled = false, className }: Props) {
  const [typed, setTyped] = useState("");
  const send = useRef(onDigit);
  send.current = onDigit;

  const press = (key: string) => {
    if (disabled) return;
    playTone(key);
    send.current(key);
    setTyped((t) => (t + key).slice(-24));
  };
  const pressRef = useRef(press);
  pressRef.current = press;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (!/^[0-9*#]$/.test(e.key)) return;
      e.preventDefault();
      pressRef.current(e.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={cn("space-y-2", className)} data-testid="call-keypad">
      <div
        className="h-7 rounded-md bg-muted px-2 text-center font-mono text-base tracking-widest tabular-nums text-foreground truncate"
        aria-live="polite"
      >
        {typed || <span className="text-xs tracking-normal text-muted-foreground font-sans">Keypad</span>}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {KEYS.map(([key, letters]) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => press(key)}
            aria-label={`Key ${key}`}
            className="h-11 rounded-lg border border-border bg-card flex flex-col items-center justify-center leading-none hover:bg-muted active:bg-muted/70 disabled:opacity-40"
          >
            <span className="text-base font-semibold text-foreground">{key}</span>
            <span className="mt-0.5 h-2.5 text-[9px] tracking-wider text-muted-foreground">{letters}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
