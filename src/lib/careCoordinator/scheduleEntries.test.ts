import { describe, it, expect } from "vitest";

import {
  emailIndex, entriesFor, etPartsOf, intakeEntry, welcomeEntry,
  type ScheduleEntry,
} from "./scheduleEntries";
import type { CalendlyBooking } from "./calendlyDay";
import type { ScheduledCall } from "@/lib/scheduledCalls/workflow";
import { callsOn, dayView, isLiveBooking } from "@/lib/scheduledCalls/workflow";

const call = (over: Partial<ScheduledCall> = {}): ScheduledCall => ({
  id: "i1", name: "Intake Patient", phone: "3475550101", email: "i@example.com",
  callDate: "2026-09-10", callTime: "14:00:00", bookingStatus: "Scheduled",
  reason: "Denied by insurance", requestType: "CGM", generalInsurance: "Anthem",
  state: "NY", calendlyEventUri: "https://api.calendly.com/scheduled_events/abc",
  ...over,
});

const booking = (over: Partial<CalendlyBooking> = {}): CalendlyBooking => ({
  kind: "welcome", eventUri: "https://api.calendly.com/scheduled_events/w1",
  eventName: "Welcome Call", startTime: "2026-09-10T18:00:00.000000Z",
  endTime: "2026-09-10T18:30:00.000000Z", name: "Welcome Patient",
  email: "WC1@Example.com", timezone: "America/New_York", rescheduleUrl: "",
  ...over,
});

describe("etPartsOf", () => {
  it("renders a UTC instant as Eastern wall-clock, not the runner's zone", () => {
    // 18:00Z in September is 14:00 EDT.
    expect(etPartsOf("2026-09-10T18:00:00Z")).toEqual({ date: "2026-09-10", time: "14:00:00" });
  });

  it("follows DST rather than a fixed offset", () => {
    expect(etPartsOf("2026-01-15T14:00:00Z").time).toBe("09:00:00"); // EST, UTC-5
    expect(etPartsOf("2026-07-15T14:00:00Z").time).toBe("10:00:00"); // EDT, UTC-4
  });

  it("puts a late-evening ET booking on the ET day, not the UTC one", () => {
    // The bug this exists to stop: 01:30Z is still the PREVIOUS evening in ET,
    // so reading the UTC date would file it on a day the coordinator isn't
    // looking at and it would vanish from the grid.
    expect(etPartsOf("2026-09-11T01:30:00Z")).toEqual({ date: "2026-09-10", time: "21:30:00" });
  });

  it("returns blanks for an unusable instant rather than NaN", () => {
    expect(etPartsOf("")).toEqual({ date: "", time: "" });
    expect(etPartsOf("not a date")).toEqual({ date: "", time: "" });
  });
});

describe("emailIndex", () => {
  it("matches case-insensitively and ignores blanks", () => {
    const ix = emailIndex([{ id: "a", email: "A@Example.com" }, { id: "b", email: "  " }]);
    expect(ix.get("a@example.com")).toBe("a");
    expect(ix.size).toBe(1);
  });

  it("POISONS an address two patients share instead of picking one", () => {
    // Linking the wrong chart on a live call is worse than not linking.
    const ix = emailIndex([
      { id: "a", email: "shared@example.com" },
      { id: "b", email: "shared@example.com" },
    ]);
    expect(ix.get("shared@example.com")).toBeNull();
  });
});

describe("welcomeEntry", () => {
  const lookup = (m: Map<string, string | null>) => (e: string) => m.get(e.trim().toLowerCase()) ?? null;

  it("converts to Eastern and links to the matched chart", () => {
    const ix = emailIndex([{ id: "w9", email: "wc1@example.com" }]);
    const e = welcomeEntry(booking(), lookup(ix));
    expect(e.kind).toBe("welcome");
    expect(e.callDate).toBe("2026-09-10");
    expect(e.callTime).toBe("14:00:00");
    expect(e.href).toBe("/welcome-call?patientId=w9&from=care-coordinator");
  });

  it("renders with NO link when the invitee is on no Welcome Call row", () => {
    // The booking is real and must still show; we just can't say whose chart.
    const e = welcomeEntry(booking(), () => null);
    expect(e.href).toBeNull();
    expect(e.name).toBe("Welcome Patient");
    expect(isLiveBooking(e)).toBe(true);
  });

  it("keys uniquely against an intake booking for the same patient", () => {
    const a = intakeEntry(call({ id: "123" }));
    const b = welcomeEntry(booking({ eventUri: "123" }), () => null);
    expect(a.key).not.toBe(b.key);
  });
});

describe("entriesFor", () => {
  const i = [intakeEntry(call())];
  const w = [welcomeEntry(booking(), () => null)];

  it("filters to one source or merges both", () => {
    expect(entriesFor("intake", i, w)).toEqual(i);
    expect(entriesFor("welcome", i, w)).toEqual(w);
    expect(entriesFor("both", i, w)).toHaveLength(2);
  });
});

describe("the day-view rules work on merged entries", () => {
  // The reason `isLiveBooking`/`callsOn`/`dayView` were widened to BookedSlot
  // rather than copied: one set of sequencing rules for both sources.
  const entries: ScheduleEntry[] = [
    intakeEntry(call({ id: "morning", callTime: "09:00:00" })),
    welcomeEntry(booking(), () => null),                                   // 14:00 ET
    intakeEntry(call({ id: "tomorrow", callDate: "2026-09-11" })),
  ];

  it("keeps only the day asked for", () => {
    expect(callsOn(entries, "2026-09-10").map((e) => e.key))
      .toEqual(["intake:morning", "welcome:https://api.calendly.com/scheduled_events/w1:WC1@Example.com"]);
  });

  it("sequences both kinds against one clock", () => {
    const view = dayView(callsOn(entries, "2026-09-10"), 10 * 60); // 10:00 ET
    expect(view.passed.map((e) => e.key)).toEqual(["intake:morning"]);
    expect(view.upcoming.map((e) => e.kind)).toEqual(["welcome"]);
    expect(view.remaining).toBe(1);
    expect(view.total).toBe(2);
  });

  it("drops a canceled intake booking but keeps a Calendly one (only active are returned)", () => {
    const canceled = intakeEntry(call({ id: "x", bookingStatus: "Canceled" }));
    expect(callsOn([canceled, ...entries], "2026-09-10").map((e) => e.key)).not.toContain("intake:x");
  });
});
