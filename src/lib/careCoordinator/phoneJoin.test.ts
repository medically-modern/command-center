/**
 * The PHONE join (CLAUDE.md §5.30l, 2026-09-30).
 *
 * A Calendly booking was matched to a chart by the invitee's EMAIL alone, and
 * on 2026-09-30 only 10 of the 32 Welcome Call patients had an email on the
 * board — all 32 had a phone. So most welcome bookings linked to nobody: no
 * "Open" on the strip, and the patient sat in Unscheduled while booked.
 *
 * What is pinned here is the rule that keeps the second key SAFE: the email
 * join behaves exactly as it did, the phone only adds a link where the email
 * found nobody, a number two rows share links neither, and two keys naming two
 * different patients link nobody — a wrong chart on a live call is worse than
 * no chart.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  bookingLinker, calendlyEntry, emailIndex, eventUriIndex, phoneIndex,
} from "./scheduleEntries";
import {
  calendlyAnswerFor, intakeBooking, phonesHeldOnce, welcomeCallBuckets,
  type CalendlyLookup, type IntakeLead, type WelcomeCallItem,
} from "./workflow";
import type { CalendlyBooking } from "./calendlyDay";
import type { WelcomeCallBooking } from "@/lib/welcomeCall/calendlyBooking";
import { bookingPhoneKey } from "@/lib/shared/phoneCell";

const booking = (over: Partial<CalendlyBooking> = {}): CalendlyBooking => ({
  kind: "welcome", eventUri: "https://api.calendly.com/scheduled_events/w1",
  eventName: "Welcome Call", startTime: "2026-09-30T18:00:00.000000Z",
  endTime: "2026-09-30T18:10:00.000000Z", name: "Welcome Patient",
  email: "someone@elsewhere.com", phone: "", timezone: "America/New_York", rescheduleUrl: "",
  ...over,
});

describe("bookingPhoneKey", () => {
  it("is ten digits however the number was written, and blank for anything else", () => {
    for (const raw of ["9175550142", "(917) 555-0142", "+1 917-555-0142", "1 917 555 0142"]) {
      expect(bookingPhoneKey(raw)).toBe("9175550142");
    }
    for (const bad of ["", null, undefined, "917555014", "917-555-0142 x12"]) {
      expect(bookingPhoneKey(bad)).toBe("");
    }
  });
});

describe("the strip's linker — email and phone together", () => {
  const welcome = [
    { id: "a", email: "", phone: "(917) 555-0142" },
    { id: "b", email: "b@example.com", phone: "2125550199" },
    // A household line: two patients, one number.
    { id: "c1", email: "", phone: "3475550101" },
    { id: "c2", email: "", phone: "347-555-0101" },
    // A shared address (the pre-§5.30l poisoning rule).
    { id: "d1", email: "shared@example.com", phone: "6465550111" },
    { id: "d2", email: "shared@example.com", phone: "6465550122" },
  ];
  const link = bookingLinker({
    intakeByUri: new Map(), intakeByEmail: new Map(),
    welcomeByEmail: emailIndex(welcome), welcomeByPhone: phoneIndex(welcome),
  });

  it("links a booking whose email the board doesn't hold, by its phone", () => {
    expect(link(booking({ phone: "9175550142" }))?.id).toBe("a");
  });

  it("links by email exactly as before, and a phone that agrees changes nothing", () => {
    expect(link(booking({ email: "B@example.com" }))?.id).toBe("b");
    expect(link(booking({ email: "b@example.com", phone: "2125550199" }))?.id).toBe("b");
    // The booking's phone is on no row at all: the email link stands.
    expect(link(booking({ email: "b@example.com", phone: "7185550000" }))?.id).toBe("b");
  });

  it("links NOBODY when the email and the phone name two different patients", () => {
    expect(link(booking({ email: "b@example.com", phone: "9175550142" }))).toBeNull();
  });

  it("a number two rows share links neither of them", () => {
    expect(link(booking({ phone: "3475550101" }))).toBeNull();
  });

  it("a shared email still links nobody, and the phone does not overrule that", () => {
    expect(link(booking({ email: "shared@example.com" }))).toBeNull();
    expect(link(booking({ email: "shared@example.com", phone: "6465550111" }))).toBeNull();
  });

  it("an intake booking's event URI still beats both", () => {
    const calls = [
      { id: "m1", email: "", phone: "9175550142", calendlyEventUri: "https://api.calendly.com/scheduled_events/ABC" },
      { id: "m2", email: "", phone: "2125550199", calendlyEventUri: "" },
    ];
    const intake = bookingLinker({
      intakeByUri: eventUriIndex(calls), intakeByEmail: emailIndex(calls), intakeByPhone: phoneIndex(calls),
      welcomeByEmail: new Map(),
    });
    expect(intake(booking({ kind: "intake", eventUri: "https://api.calendly.com/scheduled_events/abc", phone: "2125550199" }))?.id).toBe("m1");
    expect(intake(booking({ kind: "intake", eventUri: "x", phone: "2125550199" }))?.id).toBe("m2");
  });

  it("a caller that passes no phone indexes links exactly as it did before", () => {
    const old = bookingLinker({ intakeByUri: new Map(), intakeByEmail: new Map(), welcomeByEmail: emailIndex(welcome) });
    expect(old(booking({ phone: "9175550142" }))).toBeNull();
    expect(old(booking({ email: "b@example.com" }))?.id).toBe("b");
  });

  it("an unmatched block still carries the number the patient gave, but never dials it", () => {
    const e = calendlyEntry(booking({ phone: "+1 718 555 0000" }), link);
    expect(e.href).toBeNull();
    expect(e.phone).toBe("");
    expect(e.bookedPhone).toBe("7185550000");
    const matched = calendlyEntry(booking({ phone: "9175550142" }), link);
    expect(matched.phone).toBe("(917) 555-0142");
    expect(matched.href).toContain("patientId=a");
  });
});

describe("phonesHeldOnce", () => {
  it("keeps a number only one row holds, however it is written", () => {
    expect(phonesHeldOnce([
      { phone: "9175550142" }, { phone: "(347) 555-0101" }, { phone: "3475550101" }, { phone: "" }, { phone: "123" },
    ])).toEqual(["9175550142"]);
  });
});

const cal = (email = "", phone = ""): WelcomeCallBooking => ({
  eventUri: "https://api.calendly.com/scheduled_events/EVX", eventName: "Medically Modern Welcome Call",
  startTime: "2026-09-30T18:30:00.000000Z", endTime: "2026-09-30T18:40:00.000000Z",
  name: "Pat", email, phone, timezone: "America/New_York", rescheduleUrl: "",
});

describe("calendlyAnswerFor — one patient, email first then phone", () => {
  const byEmail = new Map<string, WelcomeCallBooking | null>([["e@example.com", null]]);
  const byPhone = new Map<string, WelcomeCallBooking | null>([["9175550142", cal("", "9175550142")], ["2125550199", null]]);

  it("finds a booking by phone when the email was asked and has none", () => {
    const a = calendlyAnswerFor({ email: "e@example.com", phone: "917-555-0142" }, { byEmail, byPhone });
    expect(a.asked).toBe(true);
    expect(a.booking?.phone).toBe("9175550142");
  });

  it("is 'asked, nothing booked' when every key it has was asked and answered null", () => {
    expect(calendlyAnswerFor({ email: "e@example.com", phone: "2125550199" }, { byEmail, byPhone }))
      .toEqual({ asked: true, booking: null });
  });

  it("is NOT asked when neither key is in the answer — not the same as not booked", () => {
    expect(calendlyAnswerFor({ email: "", phone: "7185550000" }, { byEmail, byPhone }).asked).toBe(false);
    expect(calendlyAnswerFor({ email: "", phone: "" }, { byEmail, byPhone: undefined }).asked).toBe(false);
  });
});

describe("the columns read the phone too", () => {
  const TODAY = "2026-09-30";
  const ctx = { today: TODAY, nowMinutes: 9 * 60, nowMs: Date.parse(`${TODAY}T13:00:00Z`) };

  const wc = (over: Partial<WelcomeCallItem> = {}): WelcomeCallItem => ({
    id: "w1", name: "Welcome Patient", groupId: "group_mm1wvq8p", createdAt: "2026-09-28T12:00:00Z",
    phone: "9175550142", email: "", escalation: "", escalationIndex: null, followUp: "", followUpDate: "",
    serving: "Insulin Pump", requestType: "Insulin Pump", pumpQty: "1",
    ipLastBillDate: "", medicarePriorPumpDate: "", callAttempts: "",
    doctorName: "", primaryInsurance: "", referralReceivedDate: "",
    referralSource: "", ipCoveragePath: "", cgmCoveragePath: "",
    doctorPhone: "", clinicName: "", clinicAddress: "", welcomeCallText: "",
    ...over,
  } as WelcomeCallItem);

  it("Welcome Call: an emailless patient booked under their phone is Scheduled", () => {
    const byPhone = new Map<string, WelcomeCallBooking | null>([["9175550142", cal("", "9175550142")]]);
    const b = welcomeCallBuckets([wc(), wc({ id: "w2", phone: "2125550199" })], ctx, new Map(), byPhone);
    expect(b.scheduledToday.map((e) => e.item.id)).toEqual(["w1"]);
    expect(b.unscheduledToday.map((e) => e.item.id)).toEqual(["w2"]);
  });

  const lead = (over: Partial<IntakeLead> = {}) => ({
    email: "", phone: "9175550142", scheduledCallTime: "", bookingStatus: "", ...over,
  });

  it("Patient Intake: a phone answer counts as Calendly having spoken", () => {
    const booked: CalendlyLookup = {
      ready: true, byEmail: new Map(), through: "2026-10-20",
      byPhone: new Map([["9175550142", cal("", "9175550142")]]),
    };
    const got = intakeBooking(lead(), booked);
    expect(got.source).toBe("calendly");
    expect(got.booking).toEqual({ date: TODAY, time: "14:30:00" });

    const nothing: CalendlyLookup = { ...booked, byPhone: new Map([["9175550142", null]]) };
    expect(intakeBooking(lead(), nothing)).toEqual({ booking: null, source: "calendly" });
  });

  it("Patient Intake: a phone that was never asked (shared, or an older gateway) leaves the mirror in charge", () => {
    const lookup: CalendlyLookup = { ready: true, byEmail: new Map(), byPhone: new Map(), through: "2026-10-20" };
    const got = intakeBooking(lead({ scheduledCallTime: `${TODAY} 10:00`, bookingStatus: "Scheduled" }), lookup);
    expect(got.source).toBe("mirror");
    expect(got.booking).toEqual({ date: TODAY, time: "10:00:00" });
  });
});

describe("wiring", () => {
  it("the day strip hands the linker BOTH phone indexes", () => {
    // A linker that accepts phones and is never given any is the "code nothing
    // calls" trap (§5.31b): every test above would pass and nothing would link.
    const grid = readFileSync(resolve(__dirname, "../../components/careCoordinator/ScheduleGrid.tsx"), "utf8");
    expect(grid).toMatch(/intakeByPhone: phoneIndex\(calls\)/);
    expect(grid).toMatch(/welcomeByPhone: phoneIndex\(welcomeItems\)/);
  });
});
