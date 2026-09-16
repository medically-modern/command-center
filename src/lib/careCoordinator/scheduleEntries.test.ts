import { describe, it, expect } from "vitest";

import {
  ASSUMED_DURATION_MIN, bookingLinker, calendlyEntry, durationOf, emailIndex,
  etPartsOf, eventUriIndex, intakeEntry, mergeSchedule,
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

/**
 * The welcome half of `calendlyEntry`. It used to go through a `welcomeEntry`
 * wrapper; that wrapper had no call sites outside this file once the grid
 * started asking Calendly for both kinds, so the tests call the real function.
 */
describe("calendlyEntry — a welcome booking", () => {
  const lookup = (m: Map<string, string | null>) => (e: string) => m.get(e.trim().toLowerCase()) ?? null;
  const welcomeEntry = (
    b: Parameters<typeof calendlyEntry>[0],
    byEmail: (email: string) => string | null,
  ) => calendlyEntry({ ...b, kind: "welcome" }, (x) => byEmail(x.email));

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

describe("the day-view rules work on merged entries", () => {
  // The reason `isLiveBooking`/`callsOn`/`dayView` were widened to BookedSlot
  // rather than copied: one set of sequencing rules for both sources.
  const welcomeEntry = (
    b: Parameters<typeof calendlyEntry>[0],
    byEmail: (email: string) => string | null,
  ) => calendlyEntry({ ...b, kind: "welcome" }, (x) => byEmail(x.email));
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

describe("durationOf", () => {
  it("measures the real length of a Calendly booking", () => {
    expect(durationOf("2026-09-10T18:00:00Z", "2026-09-10T18:10:00Z")).toBe(10);
    expect(durationOf("2026-09-10T18:40:00Z", "2026-09-10T19:00:00Z")).toBe(20);
  });

  it("falls back to ten minutes rather than zero for anything unmeasurable", () => {
    // ⚠️ A zero-width block is an invisible appointment — the one failure the
    // strip exists to prevent. Any degenerate pair gets the assumed length.
    expect(durationOf("", "")).toBe(ASSUMED_DURATION_MIN);
    expect(durationOf("2026-09-10T18:00:00Z", "nonsense")).toBe(ASSUMED_DURATION_MIN);
    expect(durationOf("2026-09-10T18:10:00Z", "2026-09-10T18:00:00Z")).toBe(ASSUMED_DURATION_MIN);
  });
});

describe("calendlyEntry", () => {
  it("renders an INTAKE booking and links it to the monday row", () => {
    const e = calendlyEntry(booking({ kind: "intake", eventName: "Intake Call" }), () => "999");
    expect(e.kind).toBe("intake");
    expect(e.href).toBe("/unverified-referrals?patientId=999&from=care-coordinator");
    expect(e.callDate).toBe("2026-09-10");
    expect(e.callTime).toBe("14:00:00");
  });

  it("renders a booking we cannot identify, with no link", () => {
    const e = calendlyEntry(booking(), () => null);
    expect(e.href).toBeNull();
    expect(e.name).toBe("Welcome Patient");
  });

  it("takes its width from Calendly's own start and end", () => {
    const e = calendlyEntry(booking({
      startTime: "2026-09-10T18:40:00Z", endTime: "2026-09-10T19:00:00Z",
    }), () => null);
    expect(e.durationMin).toBe(20);
  });
});

describe("bookingLinker", () => {
  const mirror = [{ id: "m1", email: "Pat@Example.com", calendlyEventUri: "https://api.calendly.com/scheduled_events/ABC" }];
  const link = bookingLinker({
    intakeByUri: eventUriIndex(mirror),
    intakeByEmail: emailIndex(mirror),
    welcomeByEmail: emailIndex([{ id: "w1", email: "wc1@example.com" }]),
  });

  it("matches an intake booking on its event URI, whatever address it was booked under", () => {
    // The URI join is the better one precisely because it survives a patient
    // booking under a second address — the failure that put a real booking on
    // no board row at all (§5.15).
    expect(link(booking({
      kind: "intake",
      eventUri: "https://api.calendly.com/scheduled_events/abc/",
      email: "somebody-else@gmail.com",
    }))).toBe("m1");
  });

  it("falls back to the email when the row never got a URI", () => {
    expect(link(booking({ kind: "intake", eventUri: "", email: "pat@example.com" }))).toBe("m1");
  });

  it("returns null for an intake booking on neither join", () => {
    expect(link(booking({ kind: "intake", eventUri: "x", email: "nobody@example.com" }))).toBeNull();
  });

  it("never uses the intake indexes for a welcome booking", () => {
    // Same URI, welcome kind: the welcome board carries no URI column at all,
    // so matching one here would open an intake chart on a welcome call.
    expect(link(booking({ kind: "welcome", eventUri: "https://api.calendly.com/scheduled_events/ABC", email: "x@y.com" }))).toBeNull();
    expect(link(booking({ kind: "welcome", email: "WC1@example.com" }))).toBe("w1");
  });
});

describe("mergeSchedule", () => {
  const cal = calendlyEntry(booking(), () => null);
  const mir = intakeEntry(call());

  it("shows EXACTLY what Calendly returned when the read succeeded", () => {
    // Josh, 2026-09-16. The mirror is not merged in alongside: a mirror row
    // Calendly did not return is a cancelled or rescheduled booking whose
    // webhook we missed, and showing it sends a coordinator to ring somebody
    // who called off.
    const out = mergeSchedule({ calendly: [cal], mirror: [mir], calendlyOk: true });
    expect(out.entries).toEqual([cal]);
    expect(out.fellBackToMirror).toBe(false);
  });

  it("shows an empty day as empty rather than reaching for the mirror", () => {
    const out = mergeSchedule({ calendly: [], mirror: [mir], calendlyOk: true });
    expect(out.entries).toEqual([]);
    expect(out.fellBackToMirror).toBe(false);
  });

  it("falls back to the mirror when Calendly cannot be read", () => {
    const out = mergeSchedule({ calendly: [], mirror: [mir], calendlyOk: false });
    expect(out.entries).toEqual([mir]);
    expect(out.fellBackToMirror).toBe(true);
  });

  it("reports no fallback when there is nothing to fall back to", () => {
    expect(mergeSchedule({ calendly: [], mirror: [], calendlyOk: false }).fellBackToMirror).toBe(false);
  });
});

describe("eventUriIndex", () => {
  it("ignores case and a trailing slash", () => {
    const ix = eventUriIndex([{ id: "a", calendlyEventUri: "https://API.calendly.com/scheduled_events/Z1/" }]);
    expect(ix.get("https://api.calendly.com/scheduled_events/z1")).toBe("a");
  });

  it("POISONS a URI two rows share instead of picking one", () => {
    const ix = eventUriIndex([
      { id: "a", calendlyEventUri: "https://api.calendly.com/scheduled_events/z1" },
      { id: "b", calendlyEventUri: "https://api.calendly.com/scheduled_events/z1" },
    ]);
    expect(ix.get("https://api.calendly.com/scheduled_events/z1")).toBeNull();
  });
});
