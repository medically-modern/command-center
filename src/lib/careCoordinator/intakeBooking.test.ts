/**
 * "Is this intake patient booked?" — Calendly first, the monday mirror as the
 * fallback (Josh, 2026-09-16).
 *
 * The rule exists because the strip above the Patient Intake column and the
 * Welcome Call column beside it read Calendly while this column read the mirror
 * alone, so one screen gave two answers. Every branch below is a REASON the
 * mirror survives, not a convenience: Calendly's silence only counts against a
 * booking where Calendly was in a position to speak.
 */
import { describe, it, expect } from "vitest";

import { intakeBooking, intakeBuckets, NO_CALENDLY, type CalendlyLookup, type IntakeLead } from "./workflow";

const TODAY = "2026-09-16";
const CTX = { today: TODAY, nowMinutes: 9 * 60, nowMs: Date.parse(`${TODAY}T13:00:00Z`) };
const FORM_GROUPS = ["group_mm5z87zt", "group_mm5zgeak"];

const lead = (over: Partial<IntakeLead> = {}): IntakeLead => ({
  id: "i1", name: "Li Wu", groupId: "group_mm5z87zt", createdAt: "2026-09-01T12:00:00Z",
  phone: "3475550101", email: "li@example.com", dropOffStep: "Step 3 - What they need",
  attemptCounter: "1", dropOffAttempt: "2", requestType: "CGM", pumpNeed: "",
  reasonForInquiry: "", proceedPreference: "", scheduledCallTime: "", bookingStatus: "",
  intakeCallComplete: "", intakeEscalation: "", referralType: "Patient", referralSource: "Patient",
  alreadyInSystem: "", followUp: "", followUpDate: "", dupCheckResult: "", state: "NY",
  generalInsurance: "", insuranceProvidedVia: "", insuranceOther: "", calendlyEventUri: "",
  providedDoctorName: "", providedClinicPhone: "", ipCoveragePath: "", cgmCoveragePath: "",
  ...over,
});

/** A Calendly booking at 14:30 ET on `day` (ET is UTC-4 in September). */
const cal = (day: string, hourEt = 14, min = 30) => ({
  eventUri: "https://api.calendly.com/scheduled_events/EVX",
  eventName: "Medically Modern Intake Call",
  startTime: `${day}T${String(hourEt + 4).padStart(2, "0")}:${String(min).padStart(2, "0")}:00.000000Z`,
  endTime: `${day}T${String(hourEt + 4).padStart(2, "0")}:${String(min + 10).padStart(2, "0")}:00.000000Z`,
  name: "Li Wu", email: "li@example.com", timezone: "America/New_York", rescheduleUrl: "https://calendly.com/reschedulings/x",
});

const answered = (entries: [string, ReturnType<typeof cal> | null][], through = "2026-10-06"): CalendlyLookup =>
  ({ ready: true, byEmail: new Map(entries), through });

describe("intakeBooking", () => {
  it("1. an unfinished read falls back to the mirror — it is not 'nobody is booked'", () => {
    const p = lead({ scheduledCallTime: `${TODAY} 10:14`, bookingStatus: "Scheduled" });
    const got = intakeBooking(p, NO_CALENDLY);
    expect(got.source).toBe("mirror");
    expect(got.booking).toEqual({ date: TODAY, time: "10:14:00" });
  });

  it("2. a lead with no email falls back — email is the only join Calendly gives us", () => {
    // Calendly answered for everybody else; it was never asked about this one,
    // so its silence says nothing (§5.31e: unanswerable, not unbooked).
    const p = lead({ email: "", scheduledCallTime: `${TODAY} 10:14`, bookingStatus: "Scheduled" });
    expect(intakeBooking(p, answered([["someone@example.com", null]])).source).toBe("mirror");
  });

  it("3. an address missing from the answer falls back, rather than reading as unbooked", () => {
    const p = lead({ scheduledCallTime: `${TODAY} 10:14`, bookingStatus: "Scheduled" });
    expect(intakeBooking(p, answered([["other@example.com", null]])).source).toBe("mirror");
  });

  it("4. Calendly wins outright when it has a booking — the mirror is not merged in", () => {
    const p = lead({ scheduledCallTime: `${TODAY} 10:14`, bookingStatus: "Scheduled" });
    const got = intakeBooking(p, answered([["li@example.com", cal(TODAY)]]));
    expect(got.source).toBe("calendly");
    expect(got.booking).toEqual({ date: TODAY, time: "14:30:00" });
    expect(got.calendlyBooking?.rescheduleUrl).toBe("https://calendly.com/reschedulings/x");
  });

  it("4b. …and finds a booking the mirror never caught, which is the whole point", () => {
    // Josh's report: booked under an address `findPatientRow` couldn't match
    // inside the two form groups, so monday holds nothing at all.
    const got = intakeBooking(lead(), answered([["li@example.com", cal(TODAY)]]));
    expect(got.source).toBe("calendly");
    expect(got.booking?.date).toBe(TODAY);
  });

  it("5. a mirror booking Calendly does not have is DROPPED — a cancel whose webhook we missed", () => {
    const p = lead({ scheduledCallTime: `${TODAY} 10:14`, bookingStatus: "Scheduled" });
    const got = intakeBooking(p, answered([["li@example.com", null]]));
    expect(got.source).toBe("calendly");
    expect(got.booking).toBeNull();
  });

  it("5b. …unless it is BEYOND the window, which is outside what was looked at", () => {
    const p = lead({ scheduledCallTime: "2026-11-02 10:14", bookingStatus: "Scheduled" });
    const got = intakeBooking(p, answered([["li@example.com", null]], "2026-10-06"));
    expect(got.source).toBe("mirror");
    expect(got.booking?.date).toBe("2026-11-02");
  });

  it("a canceled mirror row is never a booking, whichever branch reaches it", () => {
    const p = lead({ scheduledCallTime: `${TODAY} 10:14`, bookingStatus: "Canceled" });
    expect(intakeBooking(p, NO_CALENDLY).booking).toBeNull();
    expect(intakeBooking(p, answered([["li@example.com", null]])).booking).toBeNull();
  });

  it("matches the address case-insensitively, like every other Calendly join", () => {
    const p = lead({ email: "  LI@Example.COM " });
    expect(intakeBooking(p, answered([["li@example.com", cal(TODAY)]])).source).toBe("calendly");
  });
});

describe("intakeBuckets reads the same rule", () => {
  const ctx = { ...CTX, formGroupIds: FORM_GROUPS };

  it("puts a Calendly-only booking in Scheduled instead of the calling list", () => {
    const leads = [lead({ id: "cal-only" })];
    const before = intakeBuckets(leads, ctx);
    expect(before.unscheduledToday.map((e) => e.item.id)).toEqual(["cal-only"]);

    const after = intakeBuckets(leads, { ...ctx, calendly: answered([["li@example.com", cal(TODAY)]]) });
    expect(after.scheduledToday.map((e) => e.item.id)).toEqual(["cal-only"]);
    expect(after.unscheduledToday).toHaveLength(0);
    // The reschedule link rides along, as it does on the Welcome Call column.
    expect(after.scheduledToday[0].booking?.rescheduleUrl).toContain("calendly.com");
  });

  it("moves a stale mirror booking OUT of Scheduled once Calendly has answered", () => {
    const leads = [lead({ id: "stale", scheduledCallTime: `${TODAY} 10:14`, bookingStatus: "Scheduled" })];
    expect(intakeBuckets(leads, ctx).scheduledToday.map((e) => e.item.id)).toEqual(["stale"]);

    const after = intakeBuckets(leads, { ...ctx, calendly: answered([["li@example.com", null]]) });
    expect(after.scheduledToday).toHaveLength(0);
    expect(after.unscheduledToday.map((e) => e.item.id)).toEqual(["stale"]);
  });

  it("is byte-for-byte the old behaviour when no lookup is passed at all", () => {
    const leads = [
      lead({ id: "a", scheduledCallTime: `${TODAY} 10:14`, bookingStatus: "Scheduled" }),
      lead({ id: "b", email: "b@example.com" }),
    ];
    expect(intakeBuckets(leads, ctx)).toEqual(intakeBuckets(leads, { ...ctx, calendly: NO_CALENDLY }));
  });
});
