import { describe, it, expect } from "vitest";

import { formatBookingWhen } from "./calendlyBooking";

/** 2026-09-12 is a Saturday; 18:00Z is 2:00 PM Eastern (EDT, UTC-4). */
const SAT_2PM_ET = "2026-09-12T18:00:00.000000Z";

describe("formatBookingWhen", () => {
  it("renders the EASTERN time, whatever the browser's zone", () => {
    // The container runs UTC. Rendering 18:00Z in local time would print
    // "6:00 PM" for an appointment everyone else calls 2 o'clock.
    const out = formatBookingWhen(SAT_2PM_ET, new Date("2026-09-01T12:00:00Z"));
    expect(out).toBe("Sat, Sep 12 · 2:00 PM ET");
  });

  it("says Today when it lands on the Eastern today", () => {
    expect(formatBookingWhen(SAT_2PM_ET, new Date("2026-09-12T13:00:00Z")))
      .toBe("Today · 2:00 PM ET");
  });

  it("says Tomorrow", () => {
    expect(formatBookingWhen(SAT_2PM_ET, new Date("2026-09-11T13:00:00Z")))
      .toBe("Tomorrow · 2:00 PM ET");
  });

  it("uses the EASTERN today, not the UTC one, to decide", () => {
    // 01:30Z on the 12th is still 21:30 Eastern on the 11th, so a call at 2pm
    // Eastern on the 12th is TOMORROW — reading the UTC date would call it today.
    expect(formatBookingWhen(SAT_2PM_ET, new Date("2026-09-12T01:30:00Z")))
      .toBe("Tomorrow · 2:00 PM ET");
  });

  it("crosses a month end without mislabelling tomorrow", () => {
    const oct1 = "2026-10-01T18:00:00Z";
    expect(formatBookingWhen(oct1, new Date("2026-09-30T13:00:00Z")))
      .toBe("Tomorrow · 2:00 PM ET");
  });

  it("handles the standard-time side of DST", () => {
    // 2026-11-15 is EST (UTC-5), so 19:00Z is 2:00 PM Eastern.
    expect(formatBookingWhen("2026-11-15T19:00:00Z", new Date("2026-11-01T12:00:00Z")))
      .toBe("Sun, Nov 15 · 2:00 PM ET");
  });

  it("returns an empty string for a missing or unparseable time", () => {
    // The chip renders whatever this returns, so it must never produce
    // "Invalid Date" on a header.
    expect(formatBookingWhen("")).toBe("");
    expect(formatBookingWhen("not a time")).toBe("");
  });
});
