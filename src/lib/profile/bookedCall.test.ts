import { describe, it, expect } from "vitest";
import { formatBookedCall } from "./uploadLink";

/**
 * The Calendly mirror column is timezone-NAIVE Eastern wall-clock (CLAUDE.md
 * §9). Formatting it through `new Date(raw)` reinterprets it in the viewer's
 * zone and shifts the hour — the exact class of bug that had the old form
 * booking patients three hours out. These cases pin the string-surgery
 * behaviour so a "cleanup" back to Date parsing fails here instead of in front
 * of a patient.
 */
describe("formatBookedCall", () => {
  it("renders an Eastern wall-clock time verbatim", () => {
    expect(formatBookedCall("2026-08-14 15:30:00")).toBe("Fri Aug 14, 3:30 PM");
  });

  it("does not shift the hour, whatever zone the browser is in", () => {
    // The whole point: 09:00 is 9 AM to everyone reading the board.
    expect(formatBookedCall("2026-08-14 09:00:00")).toContain("9:00 AM");
    expect(formatBookedCall("2026-01-05 09:00:00")).toContain("9:00 AM"); // and across DST
  });

  it("handles noon and midnight, where 12-hour maths usually breaks", () => {
    expect(formatBookedCall("2026-08-14 12:00:00")).toContain("12:00 PM");
    expect(formatBookedCall("2026-08-14 00:30:00")).toContain("12:30 AM");
  });

  it("accepts the ISO 'T' separator as well as a space", () => {
    expect(formatBookedCall("2026-08-14T15:30:00")).toBe("Fri Aug 14, 3:30 PM");
  });

  it("falls back to the date alone when no time was mirrored", () => {
    // A booking that reached the board without a time still has to render —
    // a date-only value is why the day grid sorts those last rather than
    // dropping them.
    expect(formatBookedCall("2026-08-14")).toBe("Fri Aug 14");
  });

  it("returns empty for blank or unparseable input, never 'Invalid Date'", () => {
    for (const bad of ["", "   ", undefined, "not a date", "14/08/2026"]) {
      expect(formatBookedCall(bad as string | undefined)).toBe("");
    }
  });
});
