// Days Auth Outstanding — live computation from per-product Auth Submission
// Dates with the cron-maintained board column as fallback. The cron
// (services/baseline-cron recalcDaysAuthOutstanding) mirrors this math —
// see the counting contract note in authOutstandingDays.ts.
import { describe, expect, it } from "vitest";
import {
  daysAuthOutstanding,
  daysBetweenYmd,
  earliestAuthSubmissionYmd,
  normalizeSubmissionYmd,
} from "./authOutstandingDays";
import type { Patient } from "./workflow";

const TODAY = "2026-07-21";

function p(over: Partial<Patient> = {}): Patient {
  return { id: "1", name: "Test", ...over } as Patient;
}

function withSubDates(dates: Record<string, string>, over: Partial<Patient> = {}): Patient {
  const codes: Record<string, { status: "pending"; authSubmissionDate: string }> = {};
  for (const [cid, d] of Object.entries(dates)) {
    codes[cid] = { status: "pending", authSubmissionDate: d };
  }
  return p({ insurance: { universal: {}, codes } as Patient["insurance"], ...over });
}

describe("normalizeSubmissionYmd", () => {
  it("passes ISO through and converts US format", () => {
    expect(normalizeSubmissionYmd("2026-07-10")).toBe("2026-07-10");
    expect(normalizeSubmissionYmd("7/1/2026")).toBe("2026-07-01");
    expect(normalizeSubmissionYmd("07/10/2026")).toBe("2026-07-10");
  });
  it("rejects blanks and junk", () => {
    expect(normalizeSubmissionYmd("")).toBe("");
    expect(normalizeSubmissionYmd(undefined)).toBe("");
    expect(normalizeSubmissionYmd("01 July 2026")).toBe("");
  });
});

describe("earliestAuthSubmissionYmd", () => {
  it("takes the earliest across products", () => {
    const pt = withSubDates({ pump: "2026-07-12", "cgm-sensors": "2026-07-08" });
    expect(earliestAuthSubmissionYmd(pt)).toBe("2026-07-08");
  });
  it("ignores products without a date", () => {
    const pt = withSubDates({ pump: "2026-07-12", "cgm-sensors": "" });
    expect(earliestAuthSubmissionYmd(pt)).toBe("2026-07-12");
  });
  it("empty when no dates recorded", () => {
    expect(earliestAuthSubmissionYmd(p())).toBe("");
  });
});

describe("daysBetweenYmd", () => {
  it("whole days, UTC math", () => {
    expect(daysBetweenYmd("2026-07-08", TODAY)).toBe(13);
    expect(daysBetweenYmd(TODAY, TODAY)).toBe(0);
  });
  it("null on malformed input", () => {
    expect(daysBetweenYmd("", TODAY)).toBeNull();
    expect(daysBetweenYmd("07/08/2026", TODAY)).toBeNull();
  });
});

describe("daysAuthOutstanding", () => {
  it("live-computes from the earliest submission date", () => {
    const pt = withSubDates({ pump: "2026-07-12", "cgm-sensors": "2026-07-08" });
    expect(daysAuthOutstanding(pt, TODAY)).toBe(13);
  });
  it("live compute wins over a stale column value", () => {
    const pt = withSubDates({ pump: "2026-07-14" }, { daysAuthOutstanding: 2 });
    expect(daysAuthOutstanding(pt, TODAY)).toBe(7);
  });
  it("falls back to the board column when no dates are hydrated", () => {
    expect(daysAuthOutstanding(p({ daysAuthOutstanding: 5 }), TODAY)).toBe(5);
  });
  it("clamps future-dated submissions to 0", () => {
    const pt = withSubDates({ pump: "2026-07-25" });
    expect(daysAuthOutstanding(pt, TODAY)).toBe(0);
  });
  it("null when neither source has data", () => {
    expect(daysAuthOutstanding(p(), TODAY)).toBeNull();
  });
});
