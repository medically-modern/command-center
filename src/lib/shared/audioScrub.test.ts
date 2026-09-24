import { describe, expect, it } from "vitest";
import {
  KEY_STEP_SECONDS,
  PAGE_STEP_SECONDS,
  PLAYBACK_RATES,
  SKIP_SECONDS,
  clampTime,
  effectiveDuration,
  formatClock,
  fractionAt,
  keySeek,
  nextRate,
  rateLabel,
} from "./audioScrub";

describe("formatClock", () => {
  it("prints minutes:seconds, and hours once there are any", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(42.9)).toBe("0:42");
    expect(formatClock(393)).toBe("6:33");
    expect(formatClock(3725)).toBe("1:02:05");
  });

  // ⚠️ "0:00 / 0:00" says the recording is empty. A length the file has not
  // told us yet — NaN, or the Infinity a streamed file reports — is unknown.
  it("prints --:-- for a length that is not known, never a fabricated zero", () => {
    expect(formatClock(Number.NaN)).toBe("--:--");
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe("--:--");
    expect(formatClock(-1)).toBe("--:--");
  });
});

describe("effectiveDuration", () => {
  it("takes the file's own answer once it has one", () => {
    expect(effectiveDuration(120, 300)).toBe(120);
  });

  // The call log already knows how long the call was, so the bar can be
  // scrubbed the moment it appears rather than after the browser reads the file.
  it("falls back to the length the call log recorded", () => {
    expect(effectiveDuration(Number.NaN, 300)).toBe(300);
    expect(effectiveDuration(Number.POSITIVE_INFINITY, 300)).toBe(300);
    expect(effectiveDuration(0, 300)).toBe(300);
  });

  it("is 0 — 'not known' — with neither, so the bar refuses to seek", () => {
    expect(effectiveDuration(Number.NaN)).toBe(0);
    expect(effectiveDuration(Number.NaN, 0)).toBe(0);
    expect(effectiveDuration(Number.NaN, Number.NaN)).toBe(0);
  });
});

describe("clampTime", () => {
  it("never seeks before the start or past the end", () => {
    expect(clampTime(-5, 100)).toBe(0);
    expect(clampTime(50, 100)).toBe(50);
    expect(clampTime(150, 100)).toBe(100);
  });

  it("seeks nowhere on an unknown length or a bad time", () => {
    expect(clampTime(50, 0)).toBe(0);
    expect(clampTime(Number.NaN, 100)).toBe(0);
  });
});

describe("fractionAt", () => {
  it("is where on the bar the pointer is, 0–1", () => {
    expect(fractionAt(150, 100, 200)).toBe(0.25);
    expect(fractionAt(100, 100, 200)).toBe(0);
    expect(fractionAt(300, 100, 200)).toBe(1);
  });

  it("clamps a pointer dragged off either end", () => {
    expect(fractionAt(50, 100, 200)).toBe(0);
    expect(fractionAt(900, 100, 200)).toBe(1);
  });

  // ⚠️ A bar that has not been laid out yet is zero wide. Dividing by it is
  // NaN, which would seek to the start without anybody asking.
  it("answers 0 for a zero-width bar rather than NaN", () => {
    expect(fractionAt(150, 100, 0)).toBe(0);
    expect(Number.isNaN(fractionAt(150, 100, 0))).toBe(false);
    expect(fractionAt(Number.NaN, 100, 200)).toBe(0);
  });
});

describe("speed", () => {
  it("cycles 1× → 2× and back round", () => {
    const seen: number[] = [];
    let r = 1;
    for (let i = 0; i < PLAYBACK_RATES.length; i++) {
      seen.push(r);
      r = nextRate(r);
    }
    expect(seen).toEqual([...PLAYBACK_RATES]);
    expect(r).toBe(1);
  });

  it("starts again at 1× from a rate it does not know", () => {
    expect(nextRate(3)).toBe(1);
  });

  it("labels each speed without trailing zeros", () => {
    expect(PLAYBACK_RATES.map(rateLabel)).toEqual(["1×", "1.25×", "1.5×", "1.75×", "2×"]);
  });
});

describe("keySeek — the keyboard on the focused bar", () => {
  it("steps by KEY_STEP_SECONDS, and by SKIP_SECONDS with Shift", () => {
    expect(keySeek("ArrowRight", false, 60, 300)).toBe(60 + KEY_STEP_SECONDS);
    expect(keySeek("ArrowLeft", false, 60, 300)).toBe(60 - KEY_STEP_SECONDS);
    expect(keySeek("ArrowUp", true, 60, 300)).toBe(60 + SKIP_SECONDS);
    expect(keySeek("ArrowDown", true, 60, 300)).toBe(60 - SKIP_SECONDS);
  });

  it("pages by PAGE_STEP_SECONDS and jumps to either end", () => {
    expect(keySeek("PageUp", false, 60, 300)).toBe(60 + PAGE_STEP_SECONDS);
    expect(keySeek("PageDown", false, 60, 300)).toBe(60 - PAGE_STEP_SECONDS);
    expect(keySeek("Home", false, 60, 300)).toBe(0);
    expect(keySeek("End", false, 60, 300)).toBe(300);
  });

  it("stays inside the recording", () => {
    expect(keySeek("ArrowLeft", true, 3, 300)).toBe(0);
    expect(keySeek("PageUp", false, 290, 300)).toBe(300);
  });

  // ⚠️ Tab must still move focus off the bar, and a bar with no known length
  // has nowhere to go.
  it("returns null for a key that is not a seek, or an unknown length", () => {
    expect(keySeek("Tab", false, 60, 300)).toBeNull();
    expect(keySeek("a", false, 60, 300)).toBeNull();
    expect(keySeek("ArrowRight", false, 60, 0)).toBeNull();
  });
});
