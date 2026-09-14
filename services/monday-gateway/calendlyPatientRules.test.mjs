import { describe, it, expect } from "vitest";
import {
  DEFAULT_WINDOW_DAYS,
  etDateString,
  indexByEmail,
  looksLikeEmail,
  lookupMany,
  MAX_LOOKUP_EMAILS,
  normalizeEmail,
  pickBooking,
  windowDates,
} from "./calendlyPatientRules.mjs";

const booking = (over = {}) => ({
  kind: "welcome",
  eventUri: "https://api.calendly.com/scheduled_events/abc",
  eventName: "Medically Modern Welcome Call",
  startTime: "2026-09-12T18:00:00.000000Z",
  endTime: "2026-09-12T18:10:00.000000Z",
  name: "Nejwa Negash",
  email: "nejwanegash@gmail.com",
  timezone: "America/New_York",
  rescheduleUrl: "https://calendly.com/reschedulings/abc",
  ...over,
});

describe("etDateString", () => {
  it("reads the EASTERN day, not the container's UTC day", () => {
    // 01:30 UTC on the 11th is still 21:30 Eastern on the 10th. A window built
    // off the UTC date would start a day late for the last five hours of every
    // Eastern day, and would still return bookings while doing it.
    expect(etDateString(new Date("2026-09-11T01:30:00Z"))).toBe("2026-09-10");
  });

  it("agrees with UTC in the middle of the Eastern day", () => {
    expect(etDateString(new Date("2026-09-10T16:00:00Z"))).toBe("2026-09-10");
  });
});

describe("windowDates", () => {
  it("returns consecutive day labels starting at `from`", () => {
    expect(windowDates("2026-09-10", 4)).toEqual([
      "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13",
    ]);
  });

  it("rolls over a month end", () => {
    expect(windowDates("2026-09-29", 4)).toEqual([
      "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02",
    ]);
  });

  it("crosses the DST boundary without dropping or repeating a day", () => {
    // US DST ends 2026-11-01. Stepping these as instants in a zone would either
    // repeat the 1st or skip it; stepping them as UTC labels cannot.
    expect(windowDates("2026-10-31", 4)).toEqual([
      "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03",
    ]);
  });

  it("defaults to the documented window", () => {
    expect(windowDates("2026-09-10")).toHaveLength(DEFAULT_WINDOW_DAYS);
  });

  it("refuses a malformed start rather than inventing a window", () => {
    expect(windowDates("nonsense", 3)).toEqual([]);
    expect(windowDates("", 3)).toEqual([]);
  });

  it("always yields at least one day", () => {
    expect(windowDates("2026-09-10", 0)).toEqual(["2026-09-10"]);
    expect(windowDates("2026-09-10", -5)).toEqual(["2026-09-10"]);
  });
});

describe("normalizeEmail / looksLikeEmail", () => {
  it("folds case and whitespace, because the two sides disagree about both", () => {
    expect(normalizeEmail("  Nejwa.Negash@Gmail.COM ")).toBe("nejwa.negash@gmail.com");
  });

  it("treats a blank as no answer", () => {
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail("   ")).toBe("");
    expect(looksLikeEmail("")).toBe(false);
    expect(looksLikeEmail("   ")).toBe(false);
  });

  it("rejects something that is plainly not an address", () => {
    expect(looksLikeEmail("no-at-sign")).toBe(false);
    expect(looksLikeEmail("two words@x.com")).toBe(false);
    expect(looksLikeEmail("a@b.co")).toBe(true);
  });
});

describe("indexByEmail", () => {
  it("buckets by the normalised address", () => {
    const idx = indexByEmail([
      booking({ email: "A@X.com" }),
      booking({ email: "a@x.com", startTime: "2026-09-13T18:00:00Z" }),
    ]);
    expect([...idx.keys()]).toEqual(["a@x.com"]);
    expect(idx.get("a@x.com")).toHaveLength(2);
  });

  it("DROPS a booking with no invitee email rather than bucketing it under ''", () => {
    // An empty-string bucket is one mis-keyed lookup away from handing every
    // emailless patient the same stranger's appointment.
    const idx = indexByEmail([booking({ email: "" }), booking({ email: null })]);
    expect(idx.size).toBe(0);
  });

  it("sorts each patient's bookings earliest first", () => {
    const idx = indexByEmail([
      booking({ startTime: "2026-09-14T18:00:00Z" }),
      booking({ startTime: "2026-09-11T18:00:00Z" }),
    ]);
    expect(idx.get("nejwanegash@gmail.com").map((b) => b.startTime)).toEqual([
      "2026-09-11T18:00:00Z", "2026-09-14T18:00:00Z",
    ]);
  });

  it("is empty for no bookings at all", () => {
    expect(indexByEmail([]).size).toBe(0);
    expect(indexByEmail(undefined).size).toBe(0);
  });
});

describe("pickBooking", () => {
  const now = "2026-09-12T18:05:00Z";

  it("prefers the soonest booking still ahead", () => {
    const picked = pickBooking([
      booking({ startTime: "2026-09-20T18:00:00Z", endTime: "2026-09-20T18:10:00Z" }),
      booking({ startTime: "2026-09-15T18:00:00Z", endTime: "2026-09-15T18:10:00Z" }),
    ], now);
    expect(picked.startTime).toBe("2026-09-15T18:00:00Z");
  });

  it("keeps showing a call that is IN PROGRESS", () => {
    // The rep is most likely on it. Hiding it the moment it starts is exactly
    // when the time is worth confirming.
    const picked = pickBooking([booking()], now);
    expect(picked.startTime).toBe("2026-09-12T18:00:00.000000Z");
  });

  it("falls back to the most recent finished one", () => {
    const picked = pickBooking([
      booking({ startTime: "2026-09-12T13:00:00Z", endTime: "2026-09-12T13:10:00Z" }),
      booking({ startTime: "2026-09-12T09:00:00Z", endTime: "2026-09-12T09:10:00Z" }),
    ], now);
    expect(picked.startTime).toBe("2026-09-12T13:00:00Z");
  });

  it("is null when there is nothing", () => {
    expect(pickBooking([], now)).toBeNull();
    expect(pickBooking(undefined, now)).toBeNull();
  });
});

describe("lookupMany — the dashboard's batch (§5.30)", () => {
  const idx = indexByEmail([
    booking(),
    booking({ email: "two@example.com", startTime: "2026-09-13T15:00:00Z", endTime: "2026-09-13T15:10:00Z" }),
  ]);
  const now = "2026-09-10T12:00:00Z";

  it("answers every real address once, null for nothing booked, and skips non-addresses", () => {
    const out = lookupMany(idx, ["NejwaNegash@gmail.com ", "two@example.com", "nobody@example.com", "", "not an email", "two@example.com"], now);
    expect(Object.keys(out)).toEqual(["nejwanegash@gmail.com", "two@example.com", "nobody@example.com"]);
    expect(out["nejwanegash@gmail.com"].startTime).toBe("2026-09-12T18:00:00.000000Z");
    expect(out["two@example.com"].startTime).toBe("2026-09-13T15:00:00Z");
    expect(out["nobody@example.com"]).toBeNull();
  });

  it("caps the answer and tolerates a non-array", () => {
    const many = Array.from({ length: MAX_LOOKUP_EMAILS + 5 }, (_, i) => `p${i}@example.com`);
    expect(Object.keys(lookupMany(idx, many, now)).length).toBe(MAX_LOOKUP_EMAILS);
    expect(lookupMany(idx, undefined, now)).toEqual({});
  });
});
