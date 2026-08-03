import { describe, expect, it } from "vitest";
import type { Patient } from "./workflow";
import {
  APPT_ATTEMPT_CADENCE_BUSINESS_DAYS,
  WILL_CALL_SNOOZE_DAYS,
  WONT_SCHEDULE_SNOOZE_DAYS,
  apptAttemptCount,
  apptAttempts,
  canLogAttempt,
  chaseRoleFor,
  chaseRoleLabel,
  formatApptAttempt,
  isApptExhausted,
  nextApptSlot,
  parseApptAttempt,
  resolveApptOutcome,
  snoozeUntilAfterAppointment,
  stampApptAttemptNote,
} from "./apptOutreach";

// Monday 3 Aug 2026 — every date assertion below is anchored to this.
const MON = "2026-08-03";

const p = (over: Partial<Patient> = {}): Patient =>
  ({ id: "1", name: "Test", dob: "", notes: "", ...over }) as Patient;

describe("attempt columns are the counter", () => {
  it("counts only filled columns", () => {
    expect(apptAttemptCount(p())).toBe(0);
    expect(apptAttemptCount(p({ apptAttempt1: "a" }))).toBe(1);
    expect(apptAttemptCount(p({ apptAttempt1: "a", apptAttempt2: "b" }))).toBe(2);
    expect(apptAttemptCount(p({ apptAttempt1: "a", apptAttempt2: "b", apptAttempt3: "c" }))).toBe(3);
  });

  it("treats a whitespace-only column as unused", () => {
    expect(apptAttemptCount(p({ apptAttempt1: "   " }))).toBe(0);
  });

  it("hands out the next free slot, then null", () => {
    expect(nextApptSlot(p())).toBe(1);
    expect(nextApptSlot(p({ apptAttempt1: "a" }))).toBe(2);
    expect(nextApptSlot(p({ apptAttempt1: "a", apptAttempt2: "b" }))).toBe(3);
    expect(nextApptSlot(p({ apptAttempt1: "a", apptAttempt2: "b", apptAttempt3: "c" }))).toBeNull();
  });

  it("requires a note — an empty note would leave the slot looking unused", () => {
    expect(canLogAttempt("", 1)).toBe(false);
    expect(canLogAttempt("   ", 1)).toBe(false);
    expect(canLogAttempt("called, no answer", 1)).toBe(true);
    expect(canLogAttempt("called, no answer", null)).toBe(false);
  });

  it("is exhausted only with 3 attempts AND no appointment", () => {
    const three = { apptAttempt1: "a", apptAttempt2: "b", apptAttempt3: "c" };
    expect(isApptExhausted(p(three))).toBe(true);
    expect(isApptExhausted(p({ ...three, appointmentDate: "2026-09-16" }))).toBe(false);
    expect(isApptExhausted(p({ apptAttempt1: "a" }))).toBe(false);
  });
});

describe("attempt column round-trip", () => {
  it("survives format → parse with a note", () => {
    const raw = formatApptAttempt({
      date: "8/3/26, 2:33 PM",
      method: "Phone call",
      outcome: "noAnswer",
      note: "rang out, mailbox full",
      initials: "BE",
    });
    const back = parseApptAttempt(1, raw);
    expect(back.date).toBe("8/3/26, 2:33 PM");
    expect(back.method).toBe("Phone call");
    expect(back.outcome).toBe("No answer / no response");
    expect(back.note).toBe("rang out, mailbox full —BE");
  });

  it("survives a note containing the separator", () => {
    const raw = formatApptAttempt({
      date: "8/3/26, 2:33 PM",
      method: "Text message",
      outcome: "willCall",
      note: "said she'd call Dr. Reyes · will follow up",
    });
    expect(parseApptAttempt(2, raw).note).toBe("said she'd call Dr. Reyes · will follow up");
  });

  it("never loses a hand-edited value", () => {
    const back = parseApptAttempt(1, "someone typed this straight into Monday");
    expect(back.note).toBe("someone typed this straight into Monday");
  });

  it("lists attempts in slot order", () => {
    const list = apptAttempts(p({ apptAttempt1: "8/1/26 · a — b", apptAttempt3: "8/3/26 · c — d" }));
    expect(list.map((a) => a.slot)).toEqual([1, 3]);
  });
});

describe("outcome → effect", () => {
  it("booked returns to chase snoozed to the day AFTER the visit", () => {
    const e = resolveApptOutcome({ outcome: "booked", slot: 1, appointmentDate: "2026-09-16", today: MON });
    expect(e.kind).toBe("booked");
    expect(e.nextActionDate).toBe("2026-09-17");
  });

  it("booked refuses to resolve without a date", () => {
    expect(() => resolveApptOutcome({ outcome: "booked", slot: 1, today: MON })).toThrow(/appointment date is required/i);
  });

  it("booked wins even on the third attempt — success is not escalation", () => {
    const e = resolveApptOutcome({ outcome: "booked", slot: 3, appointmentDate: "2026-09-16", today: MON });
    expect(e.kind).toBe("booked");
  });

  it("no answer uses the escalating cadence", () => {
    const [g1, g2] = APPT_ATTEMPT_CADENCE_BUSINESS_DAYS;
    expect(g1).toBe(1);
    expect(g2).toBe(3);
    // Mon 3 Aug + 1 business day = Tue 4 Aug
    expect(resolveApptOutcome({ outcome: "noAnswer", slot: 1, today: MON }).nextActionDate).toBe("2026-08-04");
    // Mon 3 Aug + 3 business days = Thu 6 Aug
    expect(resolveApptOutcome({ outcome: "leftMessage", slot: 2, today: MON }).nextActionDate).toBe("2026-08-06");
  });

  it("will-call waits a week and never lands on a weekend", () => {
    const e = resolveApptOutcome({ outcome: "willCall", slot: 1, today: MON });
    expect(WILL_CALL_SNOOZE_DAYS).toBe(7);
    // Mon 3 Aug + 7 calendar days = Mon 10 Aug (a weekday, unchanged)
    expect(e.nextActionDate).toBe("2026-08-10");
    // Fri 7 Aug + 7 = Fri 14 Aug
    expect(resolveApptOutcome({ outcome: "willCall", slot: 1, today: "2026-08-07" }).nextActionDate).toBe("2026-08-14");
    // Wed 5 Aug + 7 = Wed 12 Aug
    expect(resolveApptOutcome({ outcome: "willCall", slot: 1, today: "2026-08-05" }).nextActionDate).toBe("2026-08-12");
  });

  it("won't-schedule snoozes rather than escalating (Katie's open call)", () => {
    const e = resolveApptOutcome({ outcome: "wontSchedule", slot: 1, today: MON });
    expect(e.kind).toBe("retry");
    expect(WONT_SCHEDULE_SNOOZE_DAYS).toBe(14);
    // Mon 3 Aug + 14 = Mon 17 Aug
    expect(e.nextActionDate).toBe("2026-08-17");
  });

  it("the third non-booking attempt escalates with no next date", () => {
    for (const outcome of ["noAnswer", "leftMessage", "willCall", "wontSchedule"] as const) {
      const e = resolveApptOutcome({ outcome, slot: 3, today: MON });
      expect(e.kind, outcome).toBe("escalate");
      expect(e.nextActionDate, outcome).toBeNull();
    }
  });

  it("a snooze never lands on a Saturday or Sunday", () => {
    // Thu 6 Aug + 3 business days = Tue 11 Aug (skips the weekend)
    expect(resolveApptOutcome({ outcome: "noAnswer", slot: 2, today: "2026-08-06" }).nextActionDate).toBe("2026-08-11");
    // An appointment on Fri 11 Sep would snooze to Sat 12 → clamped to Mon 14
    expect(snoozeUntilAfterAppointment("2026-09-11")).toBe("2026-09-14");
  });
});

describe("note stamps", () => {
  it("carries the stage prefix and the attempt number", () => {
    const line = stampApptAttemptNote({
      stamp: "8/3/26, 2:33 PM",
      slot: 2,
      method: "Phone call",
      outcome: "noAnswer",
      note: "no answer",
      initials: "BE",
    });
    expect(line).toContain("Patient Doctor Appointment Attempt 2");
    expect(line).toContain("Phone call — No answer / no response");
    expect(line.endsWith("—BE")).toBe(true);
  });
});

describe("which chase role a patient returns to", () => {
  it("mirrors the §5.9 split — Email rides with Parachute", () => {
    expect(chaseRoleFor("Parachute")).toBe("chaseParachute");
    expect(chaseRoleFor("Email")).toBe("chaseParachute");
    expect(chaseRoleFor("Fax")).toBe("chaseFax");
    expect(chaseRoleFor(undefined)).toBe("chaseFax");
    expect(chaseRoleFor("")).toBe("chaseFax");
  });

  it("labels the return with the role the patient came from", () => {
    expect(chaseRoleLabel("Email")).toBe("Chase Clinicals — Email & Parachute");
    expect(chaseRoleLabel("Fax")).toBe("Chase Clinicals — Fax");
  });
});

describe("Sub-Stage indices", () => {
  it("are distinct and every one has a label", async () => {
    const { SUB_STAGE_INDEX, SUB_STAGE_LABEL } = await import("./mondayMapping");
    const values = Object.values(SUB_STAGE_INDEX);
    // A collision would silently move patients into the wrong stage.
    expect(new Set(values).size).toBe(values.length);
    for (const idx of values) {
      expect(SUB_STAGE_LABEL[idx as keyof typeof SUB_STAGE_LABEL], `index ${idx}`).toBeTruthy();
    }
  });

  it("pins Doctor Appointment to the index the live board actually assigned", () => {
    // Monday picks the index when a label is created in the UI — it chose 0,
    // not the 12 this was first written against. A status write by index is
    // SILENT if the index has no label, so this is pinned deliberately: change
    // it only after re-reading the board's settings_str.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return import("./mondayMapping").then(({ SUB_STAGE_INDEX, SUB_STAGE_LABEL }) => {
      expect(SUB_STAGE_INDEX.doctorAppointment).toBe(0);
      expect(SUB_STAGE_LABEL[SUB_STAGE_INDEX.doctorAppointment]).toBe("Doctor Appointment");
    });
  });
});
