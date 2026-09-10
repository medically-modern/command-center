import { describe, it, expect, beforeEach } from "vitest";

import {
  emptyProgress, progressLabel, progressPercent, recallTotal, rememberTotal,
} from "./loadProgress";

const at = (loaded: number, expected: number | null, done = false) =>
  ({ ...emptyProgress(expected), loaded, pages: 1, done });

describe("progressPercent", () => {
  it("is null — indeterminate — when there is no remembered total to divide by", () => {
    // Monday reports no total, so a first-ever load genuinely cannot say.
    expect(progressPercent(at(400, null))).toBeNull();
    expect(progressPercent(at(400, 0))).toBeNull();
  });

  it("reports the real fraction against a remembered total", () => {
    expect(progressPercent(at(500, 1754))).toBe(29);
    expect(progressPercent(at(1000, 1754))).toBe(57);
  });

  it("NEVER reads 100% while rows are still arriving", () => {
    // The whole point: a full bar on a load that is still running is the lie
    // this replaces.
    expect(progressPercent(at(1754, 1754))).toBe(99);
    expect(progressPercent(at(1753, 1754))).toBe(99);
  });

  it("stays at 99 when the run overshoots its remembered total", () => {
    // The memory is from LAST time; the group grows. Past what we expected is
    // "nearly there" — never >100, and never snapping back to indeterminate.
    expect(progressPercent(at(3000, 1754))).toBe(99);
  });

  it("shows a sliver rather than nothing once rows are in", () => {
    expect(progressPercent(at(1, 100000))).toBe(1);
  });

  it("is 100 only when the fetch has actually resolved", () => {
    expect(progressPercent(at(1754, 1754, true))).toBe(100);
    // …even if the total was never known.
    expect(progressPercent(at(41, null, true))).toBe(100);
  });
});

describe("progressLabel", () => {
  it("counts real rows, and marks the total as an estimate", () => {
    expect(progressLabel(at(1204, 1754))).toBe("1,204 of ~1,754 patients");
  });

  it("drops the estimate once it has been passed rather than reading 2,000 of ~1,754", () => {
    expect(progressLabel(at(2000, 1754))).toBe("2,000 patients");
  });

  it("gives a bare count when nothing is remembered", () => {
    expect(progressLabel(at(500, null))).toBe("500 patients");
  });

  it("says something before the first page lands, and nothing once done", () => {
    expect(progressLabel(emptyProgress(1754))).toBe("Starting…");
    expect(progressLabel(at(1754, 1754, true))).toBe("");
  });
});

describe("the remembered total", () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

  it("round-trips per key", () => {
    rememberTotal("intake", 1754);
    rememberTotal("welcome", 41);
    expect(recallTotal("intake")).toBe(1754);
    expect(recallTotal("welcome")).toBe(41);
  });

  it("is null for a key never written", () => {
    expect(recallTotal("nope")).toBeNull();
  });

  it("refuses to store a total that would poison the next bar", () => {
    // A zero or negative denominator makes every later load read as finished.
    rememberTotal("intake", 0);
    expect(recallTotal("intake")).toBeNull();
    rememberTotal("intake", -5);
    expect(recallTotal("intake")).toBeNull();
    rememberTotal("intake", Number.NaN);
    expect(recallTotal("intake")).toBeNull();
  });

  it("ignores a junk value already in storage instead of dividing by it", () => {
    localStorage.setItem("mm-cc-total:intake", "not a number");
    expect(recallTotal("intake")).toBeNull();
  });

  it("survives a localStorage that throws", () => {
    const real = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new Error("private window"); },
    });
    // A progress bar must never be able to break the page it decorates.
    expect(() => rememberTotal("intake", 10)).not.toThrow();
    expect(recallTotal("intake")).toBeNull();
    if (real) Object.defineProperty(window, "localStorage", real);
  });
});
