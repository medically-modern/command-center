import { describe, it, expect } from "vitest";
import {
  attemptLabel, autoTexts, chaseBuckets, chaseRoute, classifyBooking, columnSummary, daysBetween,
  daysInPipeline, dueLabel, followUpHorizon, formatDaysSince, formatWait, formCompletion,
  intakeBuckets, isFormLead, latestAttempt, liveBooking, methodLabel, nextUp, overdueCount,
  shortMonthDay, summarize, toCount, toScheduledCall, waitingMs, welcomeCallBuckets, welcomeCallTexts,
  READY_AFTER_HOURS,
  type ChaseItem, type IntakeLead, type WelcomeCallItem,
} from "./workflow";
import type { WelcomeCallBooking } from "@/lib/welcomeCall/calendlyBooking";

// A fixed "now": Tue 2026-09-08 14:00 ET (18:00Z).
const TODAY = "2026-09-08";
const NOW_MS = Date.parse("2026-09-08T18:00:00Z");
const NOW_MIN = 14 * 60;
const FORM_GROUPS = ["group_mm5z87zt", "group_mm5zgeak"];
const GROUPS = { partial: "group_mm5z87zt", completed: "group_mm5zgeak" };
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
  providedDoctorName: "Dr. Provided", providedClinicPhone: "5555550100",
  ipCoveragePath: "", cgmCoveragePath: "Insulin",
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
  phone: "3475550103", email: "wc1@example.com", escalation: "", followUp: "", followUpDate: "",
  serving: "Insulin Pump", requestType: "Insulin Pump", pumpQty: "1",
  ipLastBillDate: "", medicarePriorPumpDate: "", callAttempts: "",
  doctorName: "Dr. Kaminski", primaryInsurance: "Medicare A&B", referralReceivedDate: "2026-09-05",
  referralSource: "Tandem", ipCoveragePath: "1st Pump >6M Diagnosed", cgmCoveragePath: "Not Serving",
  doctorPhone: "", clinicName: "", clinicAddress: "1 Main St, Albany, NY 12207", welcomeCallText: "",
  ...over,
});

const booking = (startUtc: string, over: Partial<WelcomeCallBooking> = {}): WelcomeCallBooking => ({
  eventUri: "https://api.calendly.com/scheduled_events/abc", eventName: "Medically Modern Welcome Call",
  startTime: startUtc, endTime: new Date(Date.parse(startUtc) + 600_000).toISOString(),
  name: "Welcome Patient", email: "wc1@example.com", timezone: "America/New_York",
  rescheduleUrl: "https://calendly.com/reschedulings/abc", ...over,
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
    expect(formatWait((24 + 14) * 3_600_000)).toBe("1d 14h");
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

  it("formatDaysSince — no hours, '<1 day' for today (Brandon)", () => {
    expect(formatDaysSince(hoursAgo(3), TODAY)).toBe("<1 day");
    expect(formatDaysSince("2026-09-07T15:00:00Z", TODAY)).toBe("1 day");
    expect(formatDaysSince("2026-09-01T15:00:00Z", TODAY)).toBe("7 days");
    expect(formatDaysSince("garbage", TODAY)).toBe("—");
  });

  it("shortMonthDay never lets a UTC parse shift the day", () => {
    expect(shortMonthDay("2026-09-10")).toBe("09/10");
    expect(shortMonthDay("2026-09-10 14:30")).toBe("09/10");
    expect(shortMonthDay("")).toBe("—");
  });
});

describe("the Today / Future model", () => {
  it("classifyBooking: another day is 'later'; today by the clock", () => {
    expect(classifyBooking("2026-09-10", "10:00:00", ctx)).toEqual({ when: "later", minutesUntil: null });
    expect(classifyBooking(TODAY, "", ctx)).toEqual({ when: "today-upcoming", minutesUntil: null });
    expect(classifyBooking(TODAY, "14:30:00", ctx)).toEqual({ when: "today-upcoming", minutesUntil: 30 });
    expect(classifyBooking(TODAY, "14:05:00", ctx)).toMatchObject({ when: "today-now" });
    expect(classifyBooking(TODAY, "09:00:00", ctx)).toMatchObject({ when: "today-passed" });
  });

  it("followUpHorizon: future date ⇒ Future; today, past or NONE ⇒ Today, with overdue days", () => {
    expect(followUpHorizon("2026-09-09", TODAY)).toEqual({ horizon: "future", overdueDays: 0 });
    expect(followUpHorizon(TODAY, TODAY)).toEqual({ horizon: "today", overdueDays: 0 });
    expect(followUpHorizon("2026-09-05", TODAY)).toEqual({ horizon: "today", overdueDays: 3 });
    // Blank is Today on purpose — nothing else will ever bring them back.
    expect(followUpHorizon("", TODAY)).toEqual({ horizon: "today", overdueDays: 0 });
    expect(followUpHorizon("garbage", TODAY)).toEqual({ horizon: "today", overdueDays: 0 });
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
    expect(chaseRoute({ subStage: "Chase Clinicals", clinicalsMethod: "Email" })).toBe("/chase-parachute");
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

describe("liveBooking / isFormLead / formCompletion / autoTexts", () => {
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
  it("Completed / Partial comes from the GROUP, not the Drop-off Step", () => {
    expect(formCompletion({ groupId: GROUPS.completed }, GROUPS)).toBe("Completed");
    expect(formCompletion({ groupId: GROUPS.partial }, GROUPS)).toBe("Partial");
    expect(formCompletion({ groupId: "group_mm6c3rhb" }, GROUPS)).toBeNull();
  });
  it("auto texts are the two nudges, clamped as the backend clamps them", () => {
    expect(autoTexts({ dropOffAttempt: "" })).toBe(0);
    expect(autoTexts({ dropOffAttempt: "1" })).toBe(1);
    expect(autoTexts({ dropOffAttempt: "7" })).toBe(2);
  });
});

describe("intakeBuckets — the left column", () => {
  it("an escalated lead is COUNTED, never listed, whatever else the row says", () => {
    const b = intakeBuckets([
      lead({ intakeEscalation: "Manager Escalation Required", scheduledCallTime: "2026-09-08 15:00" }),
      lead({ id: "2", intakeEscalation: "Final Escalation Required" }),
    ], ctx);
    expect(b.withManager).toBe(2);
    expect(b.scheduledToday).toEqual([]);
    expect(b.unscheduledToday).toEqual([]);
  });

  it("a booking wins over every exclusion, including imports and clean-up", () => {
    const b = intakeBuckets([
      lead({ id: "imp", dropOffStep: "", scheduledCallTime: "2026-09-08 15:00" }),
      lead({ id: "cu", groupId: "group_mm6c3rhb", scheduledCallTime: "2026-09-09 10:00" }),
    ], ctx);
    expect(b.scheduledToday.map((s) => s.item.id)).toEqual(["imp"]);
    expect(b.scheduledFuture.map((s) => s.item.id)).toEqual(["cu"]);
    expect(b.excluded.imported).toBe(0);
  });

  it("splits bookings into today (by the clock, passed last) and future", () => {
    const b = intakeBuckets([
      lead({ id: "passed", scheduledCallTime: "2026-09-08 09:00" }),
      lead({ id: "now", scheduledCallTime: "2026-09-08 14:05" }),
      lead({ id: "soon", scheduledCallTime: "2026-09-08 14:30" }),
      lead({ id: "later", scheduledCallTime: "2026-09-10 10:00" }),
      lead({ id: "sooner", scheduledCallTime: "2026-09-09 16:00" }),
      lead({ id: "notime", scheduledCallTime: "2026-09-08" }),
      lead({ id: "yesterday", scheduledCallTime: "2026-09-07 10:00" }), // past day ⇒ not a booking any more
    ], ctx);
    expect(b.scheduledToday.map((s) => `${s.item.id}:${s.when}`)).toEqual([
      "now:today-now", "soon:today-upcoming", "notime:today-upcoming", "passed:today-passed",
    ]);
    expect(b.scheduledFuture.map((s) => s.item.id)).toEqual(["sooner", "later"]);
    expect(b.scheduledToday.find((s) => s.item.id === "soon")?.minutesUntil).toBe(30);
    // Yesterday's booking fell through to unscheduled (it is a form lead, 72h old).
    expect(b.unscheduledToday.map((r) => r.item.id)).toEqual(["yesterday"]);
    // "Up next" is the first call still to make.
    expect(nextUp(b.scheduledToday)?.item.id).toBe("now");
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
    expect(b.unscheduledToday.map((r) => r.item.id)).toEqual(["ready"]);
  });

  it("the automated window only holds a lead nobody has rung yet", () => {
    const b = intakeBuckets([lead({ id: "called", createdAt: hoursAgo(3), attemptCounter: "1" })], ctx);
    expect(b.excluded.nurturing).toBe(0);
    expect(b.unscheduledToday.map((r) => r.item.id)).toEqual(["called"]);
  });

  it("the follow-up DATE moves a lead to Future and back; never the status", () => {
    const b = intakeBuckets([
      lead({ id: "pushed", followUpDate: "2026-09-09", attemptCounter: "1" }),
      lead({ id: "due", followUpDate: TODAY, attemptCounter: "1" }),
      lead({ id: "late", followUpDate: "2026-09-04", attemptCounter: "2" }),
      // The status alone changes NOTHING here — the intake page's one-way door
      // (§5.10) is not this dashboard's rule.
      lead({ id: "status-only", followUp: "Done", attemptCounter: "1" }),
      lead({ id: "never", attemptCounter: "" }),
    ], ctx);
    expect(b.unscheduledFuture.map((r) => r.item.id)).toEqual(["pushed"]);
    // Today: most overdue first, then longest-waiting.
    expect(b.unscheduledToday.map((r) => `${r.item.id}:${r.overdueDays}`)).toEqual([
      "late:4", "due:0", "status-only:0", "never:0",
    ]);
  });

  it("Future is ordered soonest date first", () => {
    const b = intakeBuckets([
      lead({ id: "b", followUpDate: "2026-09-12" }),
      lead({ id: "a", followUpDate: "2026-09-09" }),
    ], ctx);
    expect(b.unscheduledFuture.map((r) => r.item.id)).toEqual(["a", "b"]);
  });

  it("no attempt cap — five attempts is just a count on the card now", () => {
    const b = intakeBuckets([lead({ id: "five", attemptCounter: "5" }), lead({ id: "nine", attemptCounter: "9" })], ctx);
    expect(b.unscheduledToday.map((r) => `${r.item.id}:${r.attempts}`)).toEqual(["five:5", "nine:9"]);
  });
});

describe("chaseBuckets — kept for the day the column returns", () => {
  it("proposed stuck is a count, escalated is the manager's, future visit parks", () => {
    const b = chaseBuckets([
      chase({ id: "ps", escalationIndex: 2 }),
      chase({ id: "esc", escalationIndex: 0, nextActionDate: "2026-09-01" }),
      chase({ id: "visit", appointmentDate: "2026-09-12", nextActionDate: "2026-09-01" }),
      chase({ id: "blank", nextActionDate: "" }),
      chase({ id: "3d", nextActionDate: "2026-09-05" }),
      chase({ id: "tmrw", nextActionDate: "2026-09-09" }),
    ], TODAY);
    expect(b.proposedStuck).toBe(1);
    expect(b.withManager.map((e) => e.item.id)).toEqual(["esc"]);
    expect(b.awaitingVisit.map((e) => e.item.id)).toEqual(["visit"]);
    expect(b.due.map((e) => e.item.id)).toEqual(["blank", "3d"]);
    expect(b.upcoming.map((e) => e.item.id)).toEqual(["tmrw"]);
    expect(overdueCount(b.due)).toBe(1);
  });
});

describe("welcomeCallBuckets — the right column", () => {
  it("escalated is counted, proposed stuck is counted, everyone else is Unscheduled Today", () => {
    const b = welcomeCallBuckets([
      wc({ id: "esc", escalation: "Escalation Required" }),
      wc({ id: "proposed", escalation: "Final Escalation Required", escalationIndex: 2 }),
      wc({ id: "new", createdAt: hoursAgo(1) }),
      wc({ id: "old", createdAt: hoursAgo(100), callAttempts: "2" }),
    ], ctx);
    expect(b.withManager).toBe(1);
    expect(b.proposedStuck).toBe(1);
    // Oldest arrival first.
    expect(b.unscheduledToday.map((e) => `${e.item.id}:${e.attempts}`)).toEqual(["old:2", "new:0"]);
    expect(b.scheduledToday).toEqual([]);
  });

  it("the stage page's snooze (Done + date) is Future until the date, then Today with overdue days", () => {
    const b = welcomeCallBuckets([
      wc({ id: "later", followUp: "Done", followUpDate: "2026-09-12" }),
      wc({ id: "tmrw", followUp: "Done", followUpDate: "2026-09-09" }),
      wc({ id: "due", followUp: "Done", followUpDate: TODAY }),
      wc({ id: "late", followUp: "Done", followUpDate: "2026-09-06", createdAt: hoursAgo(1) }),
      // Done with NO date: nothing will wake them, so they are Today.
      wc({ id: "nodate", followUp: "Done" }),
      // A date without Done is the stage's own leftover — not a snooze.
      wc({ id: "stale-date", followUpDate: "2026-09-20" }),
    ], ctx);
    expect(b.unscheduledFuture.map((e) => e.item.id)).toEqual(["tmrw", "later"]);
    expect(b.unscheduledToday.map((e) => `${e.item.id}:${e.overdueDays}`)).toEqual([
      "late:2", "due:0", "nodate:0", "stale-date:0",
    ]);
  });

  it("a Calendly booking (by email) is Scheduled — today by the ET day, future otherwise", () => {
    const bookings = new Map<string, WelcomeCallBooking | null>([
      ["wc1@example.com", booking("2026-09-08T19:30:00Z")],   // 3:30 PM ET today
      ["two@example.com", booking("2026-09-11T14:00:00Z", { email: "two@example.com" })],
      ["three@example.com", null],
      // 11:30 PM ET on the 8th is 03:30Z on the 9th — still TODAY in Eastern.
      ["late@example.com", booking("2026-09-09T03:30:00Z", { email: "late@example.com" })],
      // A booking that already happened is not a booking any more.
      ["gone@example.com", booking("2026-09-07T14:00:00Z", { email: "gone@example.com" })],
    ]);
    const b = welcomeCallBuckets([
      wc({ id: "one" }),
      wc({ id: "two", email: "TWO@example.com " }),
      wc({ id: "three", email: "three@example.com" }),
      wc({ id: "late", email: "late@example.com" }),
      wc({ id: "gone", email: "gone@example.com", followUp: "Done", followUpDate: "2026-09-10" }),
      wc({ id: "noemail", email: "" }),
    ], ctx, bookings);
    expect(b.scheduledToday.map((e) => `${e.item.id}:${e.time}:${e.when}`)).toEqual([
      "one:15:30:00:today-upcoming", "late:23:30:00:today-upcoming",
    ]);
    expect(b.scheduledFuture.map((e) => `${e.item.id}:${e.date}`)).toEqual(["two:2026-09-11"]);
    expect(b.scheduledToday[0].booking?.rescheduleUrl).toContain("reschedulings");
    expect(b.unscheduledToday.map((e) => e.item.id)).toEqual(["three", "noemail"]);
    expect(b.unscheduledFuture.map((e) => e.item.id)).toEqual(["gone"]);
  });

  it("reads the escalation by INDEX when the raw value is there, by label otherwise", () => {
    const b = welcomeCallBuckets([
      wc({ id: "renamed", escalation: "Anything At All", escalationIndex: 0 }),
      wc({ id: "me-wording", escalation: "Manager Escalation Required" }),
      wc({ id: "done", escalation: "Done", escalationIndex: 1 }),
    ], ctx);
    expect(b.withManager).toBe(2);
    expect(b.unscheduledToday.map((e) => e.item.id)).toEqual(["done"]);
  });

  it("the text count is the Welcome Call Text trigger — 0 or 1", () => {
    expect(welcomeCallTexts({ welcomeCallText: "" })).toBe(0);
    expect(welcomeCallTexts({ welcomeCallText: "Send" })).toBe(1);
  });
});

describe("summarize — the header overview", () => {
  it("counts both horizons per column and overdue follow-ups, never escalations", () => {
    const intake = intakeBuckets([
      lead({ id: "a", scheduledCallTime: "2026-09-08 15:00" }),
      lead({ id: "a2", scheduledCallTime: "2026-09-12 15:00" }),
      lead({ id: "b" }),
      lead({ id: "c", followUpDate: "2026-09-10", attemptCounter: "1" }),
      lead({ id: "c2", followUpDate: "2026-09-01", attemptCounter: "1" }),
      lead({ id: "d", intakeEscalation: "Manager Escalation Required" }),
      lead({ id: "e", dropOffStep: "" }),
    ], ctx);
    const w = welcomeCallBuckets([
      wc({ id: "x" }),
      wc({ id: "y", followUp: "Done", followUpDate: "2026-09-20" }),
      wc({ id: "z", escalation: "Escalation Required" }),
    ], ctx);
    expect(columnSummary(intake)).toEqual({
      today: { scheduled: 1, unscheduled: 2 }, future: { scheduled: 1, unscheduled: 1 }, total: 5, overdue: 1,
    });
    expect(summarize(intake, w)).toMatchObject({
      total: 5 + 2, overdue: 1,
      welcome: { today: { scheduled: 0, unscheduled: 1 }, future: { scheduled: 0, unscheduled: 1 }, total: 2 },
    });
  });
});

describe("toScheduledCall — feeds the day strip from the column's own read", () => {
  it("splits the Calendly mirror the way lib/scheduledCalls/mondayApi does", () => {
    const c = toScheduledCall(lead({ scheduledCallTime: "2026-09-08 14:30", bookingStatus: "Scheduled" }));
    expect(c).toMatchObject({ id: "1", callDate: "2026-09-08", callTime: "14:30:00", bookingStatus: "Scheduled", reason: "Denied by insurance" });
    expect(toScheduledCall(lead({ scheduledCallTime: "2026-09-08" }))).toMatchObject({ callDate: "2026-09-08", callTime: "" });
  });
  it("passes a canceled booking THROUGH — the strip's isLiveBooking is the one filter", () => {
    const c = toScheduledCall(lead({ scheduledCallTime: "2026-09-08 14:30", bookingStatus: "Canceled" }));
    expect(c.bookingStatus).toBe("Canceled");
  });
});
