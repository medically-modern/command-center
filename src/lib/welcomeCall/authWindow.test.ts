/**
 * MM-1080: the Welcome Call view shows auth STATUS but never said through when.
 * A patient whose auth was invalid, went to the retry queue and came back
 * approved reads "Auth Valid" with no date and no note — which is exactly the
 * confusion the ticket was filed about.
 */
import { describe, it, expect } from "vitest";
import { authWindow, AUTH_EXPIRING_SOON_DAYS } from "./workflow";

const TODAY = "2026-08-28";

describe("authWindow", () => {
  it("reads as a range when both dates are present", () => {
    const w = authWindow("2026-03-15", "2027-03-15", TODAY);
    expect(w.text).toBe("03/15/2026 – 03/15/2027");
    expect(w.state).toBe("ok");
  });

  it("reads as 'through' when only the end date is known", () => {
    expect(authWindow("", "2027-03-15", TODAY).text).toBe("through 03/15/2027");
  });

  it("is blank with no dates at all", () => {
    const w = authWindow("", "", TODAY);
    expect(w.text).toBe("");
    expect(w.state).toBe("none");
    expect(w.daysLeft).toBeNull();
  });

  it("cannot judge an auth with a start but no end", () => {
    // The end date is what establishes coverage — a start alone must not be
    // reported as valid.
    const w = authWindow("2026-03-15", "", TODAY);
    expect(w.text).toBe("from 03/15/2026");
    expect(w.state).toBe("none");
  });

  it("flags an auth that has already lapsed", () => {
    const w = authWindow("2025-01-01", "2026-08-27", TODAY);
    expect(w.state).toBe("expired");
    expect(w.daysLeft).toBe(-1);
  });

  it("treats an auth ending today as still valid", () => {
    const w = authWindow("", TODAY, TODAY);
    expect(w.state).toBe("expiring");
    expect(w.daysLeft).toBe(0);
  });

  it("warns inside the expiring window and not outside it", () => {
    const inside = authWindow("", "2026-09-20", TODAY); // 23 days
    expect(inside.state).toBe("expiring");
    expect(inside.daysLeft).toBe(23);

    const outside = authWindow("", "2026-10-20", TODAY); // 53 days
    expect(outside.state).toBe("ok");
  });

  it("puts the boundary exactly at the documented threshold", () => {
    const at = authWindow("", "2026-09-27", TODAY); // 30 days
    expect(at.daysLeft).toBe(AUTH_EXPIRING_SOON_DAYS);
    expect(at.state).toBe("expiring");

    const past = authWindow("", "2026-09-28", TODAY); // 31 days
    expect(past.state).toBe("ok");
  });

  it("is timezone-proof — the same strings give the same answer regardless of runtime zone", () => {
    // Monday dates are timezone-naive ET strings. Parsing either side through a
    // bare `new Date()` in a UTC container shifts the result by a day.
    const w = authWindow("2026-01-01", "2026-12-31", "2026-06-15");
    expect(w.daysLeft).toBe(199);
  });

  it("ignores a time component Monday may append", () => {
    expect(authWindow("", "2027-03-15 00:00:00", TODAY).text).toBe("through 03/15/2027");
  });
});
