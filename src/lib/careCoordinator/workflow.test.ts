import { describe, it, expect } from "vitest";
import {
  attemptLabel, chaseBuckets, chaseRoute, daysBetween, daysInPipeline, dueLabel, formatWait,
  intakeBuckets, isFormLead, latestAttempt, liveBooking, methodLabel, overdueCount, summarize,
  toCount, toScheduledCall, uncalledCount, waitingMs, welcomeCallBuckets,
  MAX_INTAKE_ATTEMPTS, READY_AFTER_HOURS,
  type ChaseItem, type IntakeLead, type WelcomeCallItem,
} from "./workflow";

// A fixed "now": Tue 2026-09-08 14:00 ET (18:00Z).
const TODAY = "2026-09-08";
const NOW_MS = Date.parse("2026-09-08T18:00:00Z");
const NOW_MIN = 14 * 60;
const FORM_GROUPS = ["group_mm5z87zt", "group_mm5zgeak"];
const ctx = { today: TODAY, nowMinutes: NOW_MIN, nowMs: NOW_MS, formGroupIds: FORM_GROUPS };

const hoursAgo = (h: number) => new Date(NOW_MS - h * 3_600_000).toISOString();

const lead = (over: Partial<IntakeLead> = {}): IntakeLead => ({
  id: "1", name: "Test Lead", groupId: "group_mm5z87zt",
  createdAt: hoursAgo(72), phone: "3475550101", email: "t@example.com",
  dropOffStep: "Step 4 - Doctor", attemptCounter: "", dropOffAttempt: "2",
  requestType: "CGM", pumpNeed: "", reasonForInquiry: "Denied by insurance",
  proceedPreference: "Wants a call first", scheduledCallTime: "", bookingStatus: "",
  intakeCallComplete: "", intakeEscalation: "", referralType: "Patient", referralSource: "Patient",
  alreadyInSystem: "", followUp: "", followUpDate: "", dupCheckResult: "", state: "NY",
  generalInsurance: "Anthem", calendlyEventUri: "",
  ...over,
});

const chase = (over: Partial<ChaseItem> = {}): ChaseItem => ({
  id: "c1", name: "Chase Patient", groupId: "group_mm1xf2jb", createdAt: hoursAgo(24 * 7),
  phone: "3475550102", subStage: "Chase Clinicals", nextActionDate: TODAY,
  escalationIndex: 1, escalation: "Done", mnAttempts: "Attempt 2", clinicalsMethod: "Fax",
  doctorName: "Dr. Ahuja", clinicName: "Endocrinology", requestSentAt: "2026-09-01",
  appointmentDate: "", dateOfIntake: "2026-09-01",
  confirmAttempts: ["", "", ""], chaseAttempts: ["", "", ""],
  receiptConfirmedName: "", requestType: "CGM", serving: "CGM",
  ...over,
});

const wc = (over: Partial<WelcomeCallItem> = {}): WelcomeCallItem => ({
  id: "w1", name: "Welcome Patient", groupId: "group_mm1wvq8p", createdAt: hoursAgo(48),
  phone: "3475550103", escalation: "", followUp: "", followUpDate: "",
  serving: "Insulin Pump", requestType: "Insulin Pump", pumpQty: "1",
  ipLastBillDate: "", medicarePriorPumpDate: "", callAttempts: "",
  doctorName: "Dr. Kaminski", primaryInsurance: "Medicare A&B", referralReceivedDate: "2026-09-05",
  ...over,
});

describe("small helpers", () => {
  it("daysBetween is signed and DST-proof", () => {
    expect(daysBetween("2026-09-01", "2026-09-08")).toBe(7);
    expect(daysBetween("2026-09-08", "2026-09-01")).toBe(-7);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2); // spring-forward weekend
    expect(daysBetween("", TODAY)).toBeNull();
    expect(daysBetween("2026-09-08 14:00", TODAY)).toBe(0); // date-time cell trimmed to its day
  });

  it("toCount reads blank, garbage and negatives as 0", () => {
    expect(toCount("")).toBe(0);
    expect(toCount("3")).toBe(3);
    expect(toCount("-2")).toBe(0);
    expect(toCount("nope")).toBe(0);
    expect(toCount("2.9")).toBe(2);
  });

  it("formatWait", () => {
    expect(formatWait(0)).toBe("just now");
    expect(formatWait(12 * 60_000)).toBe("12m");
    expect(formatWait(9 * 3_600_000)).toBe("9h");
    expect(formatWait((24 + 14) * 3_600_000)).toBe("1d 14h");
    expect(formatWait(48 * 3_600_000)).toBe("2d");
    expect(formatWait(NaN)).toBe("just now");
  });

  it("waitingMs never goes negative and tolerates garbage", () => {
    expect(waitingMs(hoursAgo(2), NOW_MS)).toBe(2 * 3_600_000);
    expect(waitingMs(new Date(NOW_MS + 60_000).toISOString(), NOW_MS)).toBe(0);
    expect(waitingMs("not a date", NOW_MS)).toBe(0);
  });

  it("daysInPipeline prefers Date of Intake, falls back to the creation day", () => {
    expect(daysInPipeline("2026-09-01", hoursAgo(1), TODAY)).toBe(7);
    expect(daysInPipeline("", "2026-09-06T15:00:00Z", TODAY)).toBe(2);
    expect(daysInPipeline("", "garbage", TODAY)).toBeNull();
  });
});

describe("dueLabel — the chase column's clock", () => {
  it("blank is DUE, matching useRoleCounts (blank NAD counts as active)", () => {
    expect(dueLabel("", TODAY)).toMatchObject({ kind: "today" });
  });
  it("past / today / tomorrow / later", () => {
    expect(dueLabel("2026-09-06", TODAY)).toEqual({ kind: "overdue", text: "2d overdue", daysOverdue: 2 });
    expect(dueLabel(TODAY, TODAY)).toMatchObject({ kind: "today", text: "Due today" });
    expect(dueLabel("2026-09-09", TODAY)).toMatchObject({ kind: "tomorrow" });
    expect(dueLabel("2026-09-11", TODAY)).toMatchObject({ kind: "upcoming", text: "Due in 3d" });
  });
});

describe("chase display helpers", () => {
  it("attemptLabel maps the MN Attempts vocabulary", () => {
    expect(attemptLabel("")).toBeNull();
    expect(attemptLabel("Attempt 1")).toBe("Attempt 1");
    expect(attemptLabel("Escalate")).toBe("Attempt 4+ · escalate");
  });
  it("methodLabel treats blank as Fax (§5.9)", () => {
    expect(methodLabel("")).toBe("Fax");
    expect(methodLabel("Parachute")).toBe("Parachute");
  });
  it("chaseRoute follows the §5.9 split and sends Confirm Receipt to its own page", () => {
    expect(chaseRoute({ subStage: "Confirm Receipt", clinicalsMethod: "Email" })).toBe("/confirm-receipt");
    expect(chaseRoute({ subStage: "Chase Clinicals", clinicalsMethod: "" })).toBe("/chase-fax");
    expect(chaseRoute({ subStage: "Chase Clinicals", clinicalsMethod: "Fax" })).toBe("/chase-fax");
    expect(chaseRoute({ subStage: "Chase Clinicals", clinicalsMethod: "Email" })).toBe("/chase-parachute");
    expect(chaseRoute({ subStage: "Chase Clinicals", clinicalsMethod: "Parachute" })).toBe("/chase-parachute");
  });
  it("latestAttempt reads the stage's OWN columns, last non-empty wins", () => {
    const c = chase({
      confirmAttempts: ["9/1/26, 10:00 AM · office closed —MT", "", ""],
      chaseAttempts: ["9/3/26, 9:00 AM · left vm —MT", "9/5/26, 9:10 AM · fax resent —MT", ""],
    });
    expect(latestAttempt(c)).toEqual({ attempt: 2, date: "9/5/26, 9:10 AM", note: "fax resent —MT" });
    expect(latestAttempt({ ...c, subStage: "Confirm Receipt" })).toMatchObject({ attempt: 1, note: "office closed —MT" });
    expect(latestAttempt(chase())).toBeNull();
  });
});

describe("liveBooking / isFormLead", () => {
  it("parses the Calendly mirror and drops canceled bookings", () => {
    expect(liveBooking({ scheduledCallTime: "2026-09-08 14:30", bookingStatus: "Scheduled" }))
      .toEqual({ date: "2026-09-08", time: "14:30:00" });
    expect(liveBooking({ scheduledCallTime: "2026-09-08", bookingStatus: "" })).toEqual({ date: "2026-09-08", time: "" });
    expect(liveBooking({ scheduledCallTime: "2026-09-08 14:30", bookingStatus: "Canceled" })).toBeNull();
    expect(liveBooking({ scheduledCallTime: "", bookingStatus: "Scheduled" })).toBeNull();
    expect(liveBooking({ scheduledCallTime: "2:00 PM", bookingStatus: "" })).toBeNull();
  });
  it("a blank Drop-off Step means the row never touched the form", () => {
    expect(isFormLead({ dropOffStep: "" })).toBe(false);
    expect(isFormLead({ dropOffStep: "Saved for later" })).toBe(true);
  });
});

describe("intakeBuckets — the left column", () => {
  it("an escalated lead is the manager's, whatever else the row says", () => {
    const b = intakeBuckets([
      lead({ intakeEscalation: "Manager Escalation Required", scheduledCallTime: "2026-09-08 15:00" }),
      lead({ id: "2", intakeEscalation: "Final Escalation Required" }),
    ], ctx);
    expect(b.withManager.map((l) => l.id)).toEqual(["1", "2"]);
    expect(b.scheduled).toEqual([]);
    expect(b.ready).toEqual([]);
  });

  it("a booking wins over every exclusion, including imports and clean-up", () => {
    const b = intakeBuckets([
      lead({ id: "imp", dropOffStep: "", scheduledCallTime: "2026-09-08 15:00" }),
      lead({ id: "cu", groupId: "group_mm6c3rhb", scheduledCallTime: "2026-09-09 10:00" }),
    ], ctx);
    expect(b.scheduled.map((s) => s.lead.id)).toEqual(["imp", "cu"]);
    expect(b.excluded.imported).toBe(0);
  });

  it("classifies today's bookings by the clock and orders passed calls last", () => {
    const b = intakeBuckets([
      lead({ id: "passed", scheduledCallTime: "2026-09-08 09:00" }),
      lead({ id: "now", scheduledCallTime: "2026-09-08 14:05" }),
      lead({ id: "soon", scheduledCallTime: "2026-09-08 14:30" }),
      lead({ id: "later", scheduledCallTime: "2026-09-10 10:00" }),
      lead({ id: "notime", scheduledCallTime: "2026-09-08" }),
      lead({ id: "yesterday", scheduledCallTime: "2026-09-07 10:00" }), // past day ⇒ not a booking any more
    ], ctx);
    expect(b.scheduled.map((s) => `${s.lead.id}:${s.when}`)).toEqual([
      "now:today-now", "soon:today-upcoming", "notime:today-upcoming", "passed:today-passed", "later:later",
    ]);
    expect(b.scheduled.find((s) => s.lead.id === "soon")?.minutesUntil).toBe(30);
    expect(b.scheduled.find((s) => s.lead.id === "later")?.minutesUntil).toBeNull();
    // Yesterday's booking fell through to the ready list (it is a form lead, 72h old).
    expect(b.ready.map((r) => r.lead.id)).toEqual(["yesterday"]);
  });

  it("excludes, in order: imported · clean-up · call done · send-request-now · nurturing", () => {
    const b = intakeBuckets([
      lead({ id: "imp", dropOffStep: "", referralType: "Doctor", referralSource: "SNJ [2.0]" }),
      lead({ id: "cu", groupId: "group_mm6c3rhb" }),
      lead({ id: "done", intakeCallComplete: "Yes" }),
      lead({ id: "send", dropOffStep: "Completed", proceedPreference: "Send request now" }),
      lead({ id: "fresh", createdAt: hoursAgo(READY_AFTER_HOURS - 1) }),
      lead({ id: "ready", createdAt: hoursAgo(READY_AFTER_HOURS + 1) }),
    ], ctx);
    expect(b.excluded).toEqual({ imported: 1, cleanUp: 1, callDone: 1, sendNow: 1, nurturing: 1 });
    expect(b.ready.map((r) => r.lead.id)).toEqual(["ready"]);
  });

  it("a completed form that WANTS a call is ready; one that said send-now is not", () => {
    const b = intakeBuckets([
      lead({ id: "call", dropOffStep: "Completed", proceedPreference: "Wants a call first" }),
      lead({ id: "send", dropOffStep: "Completed", proceedPreference: "Send request now" }),
    ], ctx);
    expect(b.ready.map((r) => r.lead.id)).toEqual(["call"]);
    expect(b.excluded.sendNow).toBe(1);
  });

  it("orders ready leads longest-waiting first and carries the attempt count", () => {
    const b = intakeBuckets([
      lead({ id: "3d", createdAt: hoursAgo(72), attemptCounter: "2" }),
      lead({ id: "5d", createdAt: hoursAgo(120) }),
      lead({ id: "2d", createdAt: hoursAgo(49), attemptCounter: "1" }),
    ], ctx);
    expect(b.ready.map((r) => r.lead.id)).toEqual(["5d", "3d", "2d"]);
    expect(b.ready.map((r) => r.attempts)).toEqual([0, 2, 1]);
    expect(uncalledCount(b.ready)).toBe(1);
  });

  it(`shelves a lead at ${MAX_INTAKE_ATTEMPTS} attempts without hiding it`, () => {
    const b = intakeBuckets([
      lead({ id: "cap", attemptCounter: String(MAX_INTAKE_ATTEMPTS) }),
      lead({ id: "over", attemptCounter: "9", createdAt: hoursAgo(200) }),
      lead({ id: "under", attemptCounter: String(MAX_INTAKE_ATTEMPTS - 1) }),
    ], ctx);
    expect(b.ready.map((r) => r.lead.id)).toEqual(["under"]);
    // Most recently created first: the ones that JUST ran out are the ones to glance at.
    expect(b.exhausted.map((r) => r.lead.id)).toEqual(["cap", "over"]);
  });

  it("the attempt cap applies even inside the nurturing window", () => {
    const b = intakeBuckets([lead({ id: "x", createdAt: hoursAgo(1), attemptCounter: "5" })], ctx);
    expect(b.exhausted).toHaveLength(1);
    expect(b.excluded.nurturing).toBe(0);
  });
});

describe("chaseBuckets — the middle column mirrors the stage's own rule", () => {
  it("ignores other sub-stages entirely", () => {
    const b = chaseBuckets([chase({ subStage: "Evaluate MN" }), chase({ subStage: "Doctor Appointment" })], TODAY);
    expect(b.due).toEqual([]);
    expect(b.upcoming).toEqual([]);
  });

  it("proposed stuck is a count, escalated is the manager's", () => {
    const b = chaseBuckets([
      chase({ id: "ps", escalationIndex: 2 }),
      chase({ id: "esc", escalationIndex: 0, nextActionDate: "2026-09-01" }),
    ], TODAY);
    expect(b.proposedStuck).toBe(1);
    expect(b.withManager.map((e) => e.item.id)).toEqual(["esc"]);
    expect(b.withManager[0].due.kind).toBe("overdue");
    expect(b.due).toEqual([]);
  });

  it("a future provider visit parks the patient, whatever the NAD says", () => {
    const b = chaseBuckets([
      chase({ id: "visit", appointmentDate: "2026-09-12", nextActionDate: "2026-09-01" }),
      chase({ id: "past-visit", appointmentDate: "2026-09-01", nextActionDate: TODAY }),
    ], TODAY);
    expect(b.awaitingVisit.map((e) => e.item.id)).toEqual(["visit"]);
    expect(b.due.map((e) => e.item.id)).toEqual(["past-visit"]);
  });

  it("splits due from upcoming by NAD and sorts most overdue first, blank first of all", () => {
    const b = chaseBuckets([
      chase({ id: "today", nextActionDate: TODAY }),
      chase({ id: "3d", nextActionDate: "2026-09-05" }),
      chase({ id: "blank", nextActionDate: "" }),
      chase({ id: "1d", nextActionDate: "2026-09-07" }),
      chase({ id: "tmrw", nextActionDate: "2026-09-09" }),
      chase({ id: "next", nextActionDate: "2026-09-15" }),
    ], TODAY);
    expect(b.due.map((e) => e.item.id)).toEqual(["blank", "3d", "1d", "today"]);
    expect(b.upcoming.map((e) => e.item.id)).toEqual(["tmrw", "next"]);
    expect(overdueCount(b.due)).toBe(2);
  });
});

describe("welcomeCallBuckets — the right column", () => {
  it("escalated · snoozed · call now, with the ops flags", () => {
    const b = welcomeCallBuckets([
      wc({ id: "esc", escalation: "Escalation Required" }),
      wc({ id: "snz", followUp: "Done", followUpDate: "2026-09-12" }),
      wc({ id: "snz-nodate", followUp: "Done" }),
      wc({ id: "snz-soon", followUp: "Done", followUpDate: "2026-09-09" }),
      wc({ id: "new", createdAt: hoursAgo(1), serving: "Supplies + CGM", requestType: "Supplies", pumpQty: "0" }),
      wc({ id: "old", createdAt: hoursAgo(100), callAttempts: "2" }),
    ]);
    expect(b.withManager.map((e) => e.item.id)).toEqual(["esc"]);
    expect(b.followUpLater.map((e) => e.item.id)).toEqual(["snz-soon", "snz", "snz-nodate"]);
    expect(b.callNow.map((e) => e.item.id)).toEqual(["old", "new"]);
    const byId = Object.fromEntries(b.callNow.map((e) => [e.item.id, e]));
    expect(byId.old).toMatchObject({ firstTimePump: true, crossSell: false, attempts: 2 });
    expect(byId.new).toMatchObject({ firstTimePump: false, crossSell: true, attempts: 0 });
  });
});

describe("summarize — the header chips", () => {
  it("counts workable patients per column and escalations separately", () => {
    const intake = intakeBuckets([
      lead({ id: "a", scheduledCallTime: "2026-09-08 15:00" }),
      lead({ id: "b" }),
      lead({ id: "c", attemptCounter: "5" }),
      lead({ id: "d", intakeEscalation: "Manager Escalation Required" }),
      lead({ id: "e", dropOffStep: "" }),
    ], ctx);
    const ch = chaseBuckets([
      chase({ id: "1", nextActionDate: "2026-09-01" }),
      chase({ id: "2", nextActionDate: "2026-09-20" }),
      chase({ id: "3", escalationIndex: 0 }),
      chase({ id: "4", escalationIndex: 2 }),
    ], TODAY);
    const w = welcomeCallBuckets([wc({ id: "x" }), wc({ id: "y", followUp: "Done" }), wc({ id: "z", escalation: "Escalation Required" })]);
    expect(summarize(intake, ch, w)).toEqual({
      total: 2 + 2 + 2, intake: 2, chase: 2, welcome: 2, overdue: 1, escalated: 3,
    });
  });
});

describe("toScheduledCall — feeds the day grid from the column's own read", () => {
  it("splits the Calendly mirror the way lib/scheduledCalls/mondayApi does", () => {
    const c = toScheduledCall(lead({ scheduledCallTime: "2026-09-08 14:30", bookingStatus: "Scheduled" }));
    expect(c).toMatchObject({ id: "1", callDate: "2026-09-08", callTime: "14:30:00", bookingStatus: "Scheduled", reason: "Denied by insurance" });
    expect(toScheduledCall(lead({ scheduledCallTime: "2026-09-08" }))).toMatchObject({ callDate: "2026-09-08", callTime: "" });
    expect(toScheduledCall(lead({ scheduledCallTime: "" }))).toMatchObject({ callDate: "", callTime: "" });
  });
  it("passes a canceled booking THROUGH — the grid's isLiveBooking is the one filter", () => {
    const c = toScheduledCall(lead({ scheduledCallTime: "2026-09-08 14:30", bookingStatus: "Canceled" }));
    expect(c.callDate).toBe("2026-09-08");
    expect(c.bookingStatus).toBe("Canceled");
  });
});
