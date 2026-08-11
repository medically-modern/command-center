import { describe, it, expect } from "vitest";
import {
  minutesOfDay, isLiveBooking, callState, remainingToday,
  sortByTime, displayTime, dayView, nowMinutesEt,
  callsOn, dueForReminder, minutesUntil, REMINDER_LEAD_MIN,
  type ScheduledCall,
} from "./workflow";

const call = (over: Partial<ScheduledCall> = {}): ScheduledCall => ({
  id: "1",
  name: "Test Patient",
  phone: "3475550101",
  email: "t@example.com",
  callDate: "2026-08-11",
  callTime: "14:00:00",
  bookingStatus: "Scheduled",
  reason: "Pharmacy is too expensive",
  requestType: "CGM",
  generalInsurance: "Anthem / BCBS",
  state: "NY",
  calendlyEventUri: "https://api.calendly.com/scheduled_events/abc",
  ...over,
});

const at = (h: number, m = 0) => h * 60 + m;

describe("minutesOfDay", () => {
  it("parses wall-clock times", () => {
    expect(minutesOfDay("14:00:00")).toBe(840);
    expect(minutesOfDay("09:30:00")).toBe(570);
    expect(minutesOfDay("00:00:00")).toBe(0);
    expect(minutesOfDay("9:05")).toBe(545);
  });

  it("returns null rather than a plausible wrong number", () => {
    for (const bad of ["", "  ", "nope", "25:00:00", "12:99", "2:00 PM"]) {
      expect(minutesOfDay(bad)).toBeNull();
    }
  });
});

describe("isLiveBooking", () => {
  it("keeps a scheduled call", () => {
    expect(isLiveBooking(call())).toBe(true);
  });

  it("drops a canceled one — the row survives the cancellation", () => {
    expect(isLiveBooking(call({ bookingStatus: "Canceled" }))).toBe(false);
    expect(isLiveBooking(call({ bookingStatus: "  canceled  " }))).toBe(false);
  });

  it("drops a row with no date at all", () => {
    expect(isLiveBooking(call({ callDate: "" }))).toBe(false);
  });

  it("keeps a blank status — a lagging mirror must not hide a real call", () => {
    expect(isLiveBooking(call({ bookingStatus: "" }))).toBe(true);
  });
});

describe("callState", () => {
  const c = call({ callTime: "14:00:00" });

  it("is upcoming well before", () => {
    expect(callState(c, at(9))).toBe("upcoming");
    expect(callState(c, at(13, 54))).toBe("upcoming");
  });

  it("is now across the appointment window", () => {
    expect(callState(c, at(13, 55))).toBe("now");
    expect(callState(c, at(14))).toBe("now");
    expect(callState(c, at(14, 10))).toBe("now");
  });

  it("is passed after the window", () => {
    expect(callState(c, at(14, 11))).toBe("passed");
    expect(callState(c, at(17))).toBe("passed");
  });

  it("treats a timeless booking as still to do, never as passed", () => {
    // Dropping it off the bottom of the list would lose a real patient.
    const noTime = call({ callTime: "" });
    expect(callState(noTime, at(23))).toBe("upcoming");
  });
});

describe("remainingToday — the burndown number", () => {
  const day = [
    call({ id: "a", callTime: "09:00:00" }),
    call({ id: "b", callTime: "11:00:00" }),
    call({ id: "c", callTime: "14:00:00" }),
    call({ id: "d", callTime: "16:00:00" }),
  ];

  it("counts down as the day passes", () => {
    expect(remainingToday(day, at(8))).toBe(4);
    expect(remainingToday(day, at(10))).toBe(3);
    expect(remainingToday(day, at(12))).toBe(2);
    expect(remainingToday(day, at(15))).toBe(1);
    expect(remainingToday(day, at(18))).toBe(0);
  });

  it("reaches zero on the clock alone, worked or not", () => {
    // Documented and accepted (Josh, 2026-08-10): this measures what is left
    // today, not what was done. If that ever changes, useRoleCounts and BOTH
    // baseline generators change with it.
    expect(remainingToday(day, at(23))).toBe(0);
  });

  it("excludes cancellations from the count", () => {
    const withCancel = [...day, call({ id: "e", callTime: "15:00:00", bookingStatus: "Canceled" })];
    expect(remainingToday(withCancel, at(12))).toBe(2);
  });

  it("counts a same-day booking added mid-afternoon", () => {
    // A patient can book a 4pm slot at 2pm, so the number can go UP.
    const later = [...day, call({ id: "f", callTime: "16:30:00" })];
    expect(remainingToday(later, at(15))).toBe(2);
  });
});

describe("sortByTime", () => {
  it("orders by clock time", () => {
    const out = sortByTime([
      call({ id: "late", callTime: "16:00:00" }),
      call({ id: "early", callTime: "09:00:00" }),
      call({ id: "mid", callTime: "12:00:00" }),
    ]);
    expect(out.map((c) => c.id)).toEqual(["early", "mid", "late"]);
  });

  it("puts unsequenceable bookings last, not first", () => {
    const out = sortByTime([
      call({ id: "none", callTime: "" }),
      call({ id: "two", callTime: "14:00:00" }),
      call({ id: "one", callTime: "09:00:00" }),
    ]);
    expect(out.map((c) => c.id)).toEqual(["one", "two", "none"]);
  });

  it("does not mutate its input", () => {
    const input = [call({ id: "b", callTime: "16:00:00" }), call({ id: "a", callTime: "09:00:00" })];
    sortByTime(input);
    expect(input.map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("displayTime", () => {
  it("renders 12-hour wall clock", () => {
    expect(displayTime("14:00:00")).toBe("2:00 PM");
    expect(displayTime("09:30:00")).toBe("9:30 AM");
    expect(displayTime("00:00:00")).toBe("12:00 AM");
    expect(displayTime("12:00:00")).toBe("12:00 PM");
    expect(displayTime("23:45:00")).toBe("11:45 PM");
  });

  it("degrades visibly rather than inventing a time", () => {
    expect(displayTime("")).toBe("—");
  });
});

describe("dayView", () => {
  it("splits the day into done / doing / next", () => {
    const v = dayView([
      call({ id: "a", callTime: "09:00:00" }),
      call({ id: "b", callTime: "14:00:00" }),
      call({ id: "c", callTime: "16:00:00" }),
      call({ id: "x", callTime: "11:00:00", bookingStatus: "Canceled" }),
    ], at(14));

    expect(v.passed.map((c) => c.id)).toEqual(["a"]);
    expect(v.now.map((c) => c.id)).toEqual(["b"]);
    expect(v.upcoming.map((c) => c.id)).toEqual(["c"]);
    expect(v.remaining).toBe(2);
    expect(v.total).toBe(3); // cancellation excluded everywhere
  });

  it("every live call lands in exactly one bucket", () => {
    const calls = [
      call({ id: "a", callTime: "09:00:00" }),
      call({ id: "b", callTime: "14:00:00" }),
      call({ id: "c", callTime: "16:00:00" }),
      call({ id: "d", callTime: "" }),
    ];
    for (const t of [at(0), at(9), at(14), at(16), at(23, 59)]) {
      const v = dayView(calls, t);
      const seen = [...v.passed, ...v.now, ...v.upcoming].map((c) => c.id).sort();
      expect(seen).toEqual(["a", "b", "c", "d"]);
    }
  });
});

describe("callsOn", () => {
  const week = [
    call({ id: "yest", callDate: "2026-08-10" }),
    call({ id: "today", callDate: "2026-08-11" }),
    call({ id: "tmrw", callDate: "2026-08-12" }),
    call({ id: "cancelled-today", callDate: "2026-08-11", bookingStatus: "Canceled" }),
  ];

  it("is one day only, and excludes cancellations", () => {
    expect(callsOn(week, "2026-08-11").map((c) => c.id)).toEqual(["today"]);
  });

  it("returns nothing for a day with no bookings", () => {
    expect(callsOn(week, "2026-08-13")).toEqual([]);
  });
});

describe("dueForReminder", () => {
  const c = call({ callTime: "14:00:00" });

  it("stays quiet until the lead time", () => {
    expect(dueForReminder(c, at(13, 49))).toBe(false);
  });

  it("fires across the whole lead window, not on one exact minute", () => {
    // The page polls, tabs sleep, laptops suspend. A check for "exactly ten
    // minutes out" fires only if a tick lands on that minute — so a patient
    // whose reminder was due while the tab was asleep would never be announced.
    for (const m of [50, 51, 55, 59]) expect(dueForReminder(c, at(13, m))).toBe(true);
    expect(dueForReminder(c, at(14, 0))).toBe(true);
  });

  it("stops once the appointment has started", () => {
    expect(dueForReminder(c, at(14, 1))).toBe(false);
    expect(dueForReminder(c, at(16))).toBe(false);
  });

  it("never fires for a cancellation or a timeless booking", () => {
    expect(dueForReminder(call({ callTime: "14:00:00", bookingStatus: "Canceled" }), at(13, 55))).toBe(false);
    expect(dueForReminder(call({ callTime: "" }), at(13, 55))).toBe(false);
  });

  it("uses the documented lead time", () => {
    expect(dueForReminder(c, at(14 * 60 - REMINDER_LEAD_MIN >= 0 ? 13 : 13, 50))).toBe(true);
  });
});

describe("minutesUntil", () => {
  it("counts down and then goes negative", () => {
    const c = call({ callTime: "14:00:00" });
    expect(minutesUntil(c, at(13, 30))).toBe(30);
    expect(minutesUntil(c, at(14))).toBe(0);
    expect(minutesUntil(c, at(14, 15))).toBe(-15);
  });

  it("is null when there is no time to count to", () => {
    expect(minutesUntil(call({ callTime: "" }), at(9))).toBeNull();
  });
});

describe("nowMinutesEt", () => {
  it("reads Eastern, not the container's zone", () => {
    // 18:00Z in August is 14:00 EDT. A UTC container reading its own clock
    // would say 1080 and put the whole afternoon in the wrong bucket.
    expect(nowMinutesEt(new Date("2026-08-11T18:00:00Z"))).toBe(840);
  });

  it("handles the winter offset too", () => {
    expect(nowMinutesEt(new Date("2026-01-15T19:00:00Z"))).toBe(840);
  });

  it("returns 0 at Eastern midnight, never 1440", () => {
    expect(nowMinutesEt(new Date("2026-08-11T04:00:00Z"))).toBe(0);
  });
});
