import { describe, expect, it } from "vitest";
import type { Patient } from "./workflow";
import {
  APPT_ATTEMPT_SNOOZE_BUSINESS_DAYS,
  apptProposedStuckReason,
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
  WILL_CALL_SNOOZE_CALENDAR_DAYS,
} from "./apptOutreach";

// Monday 3 Aug 2026 — every date assertion below is anchored to this.
const MON = "2026-08-03";

const p = (over: Partial<Patient> = {}): Patient =>
  ({ id: "1", name: "Test", dob: "", notes: "", ...over }) as Patient;

/** An attempt line exactly as the app writes it into MN Workflow Notes. */
const line = (n: number) =>
  `8/${n}/26, 1:38 PM · Phone call — No answer / no response · tried her again —JH`;
const notesOf = (...ls: string[]) => ls.join("\n");

describe("MN notes lines are the counter", () => {
  it("counts the attempt lines in the notes body", () => {
    expect(apptAttemptCount(p())).toBe(0);
    expect(apptAttemptCount(p({ mnEvalNotes: line(1) }))).toBe(1);
    expect(apptAttemptCount(p({ mnEvalNotes: notesOf(line(1), line(2)) }))).toBe(2);
    expect(apptAttemptCount(p({ mnEvalNotes: notesOf(line(1), line(2), line(3)) }))).toBe(3);
  });

  it("ignores other stages' lines in the same shared column", () => {
    const notes = notesOf(
      "8/1/26, 9:00 AM · Chase (escalated) · left a voicemail with records —BE",
      "[Proposed Stuck · 8/2/26 · JH] something else entirely",
      "7/30/26, 2:00 PM · Patient Doctor Appointment · Provider requires a new visit —JH",
      line(3),
    );
    expect(apptAttemptCount(p({ mnEvalNotes: notes }))).toBe(1);
  });

  it("hands out the next free slot, then null", () => {
    expect(nextApptSlot(p())).toBe(1);
    expect(nextApptSlot(p({ mnEvalNotes: line(1) }))).toBe(2);
    expect(nextApptSlot(p({ mnEvalNotes: notesOf(line(1), line(2)) }))).toBe(3);
    expect(nextApptSlot(p({ mnEvalNotes: notesOf(line(1), line(2), line(3)) }))).toBeNull();
  });

  it("requires a note — a note-less save would be invisible to the counter", () => {
    expect(canLogAttempt("", 1)).toBe(false);
    expect(canLogAttempt("   ", 1)).toBe(false);
    expect(canLogAttempt("called, no answer", 1)).toBe(true);
    expect(canLogAttempt("called, no answer", null)).toBe(false);
  });

  it("is exhausted only with 3 attempts AND no appointment", () => {
    const three = { mnEvalNotes: notesOf(line(1), line(2), line(3)) };
    expect(isApptExhausted(p(three))).toBe(true);
    expect(isApptExhausted(p({ ...three, appointmentDate: "2026-09-16" }))).toBe(false);
    expect(isApptExhausted(p({ mnEvalNotes: line(1) }))).toBe(false);
  });

  it("never locks the rep out if extra matching lines appear", () => {
    // A returned-and-re-worked patient could accumulate more than three.
    const many = notesOf(line(1), line(2), line(3), line(4), line(5));
    expect(apptAttemptCount(p({ mnEvalNotes: many }))).toBe(3);
    expect(apptAttempts(p({ mnEvalNotes: many })).map((a) => a.slot)).toEqual([1, 2, 3]);
  });
});

describe("attempt line round-trip", () => {
  it("writes exactly the agreed format", () => {
    expect(
      formatApptAttempt({
        date: "8/3/26, 1:38 PM",
        method: "Phone call",
        outcome: "noAnswer",
        note: "sent her a text to ask if shes booking a follow up meeting with doctor test",
        initials: "JH",
      }),
    ).toBe(
      "8/3/26, 1:38 PM · Phone call — No answer / no response · sent her a text to ask if shes booking a follow up meeting with doctor test —JH",
    );
  });

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

  it("numbers attempts by position, so count and slot can never disagree", () => {
    const list = apptAttempts(p({ mnEvalNotes: notesOf(line(1), line(2)) }));
    expect(list.map((a) => a.slot)).toEqual([1, 2]);
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

  it("a logged attempt snoozes 1 business day (Brandon's v3 matrix)", () => {
    expect(APPT_ATTEMPT_SNOOZE_BUSINESS_DAYS).toBe(1);
    // Mon 3 Aug + 1 business day = Tue 4 Aug — same for attempt 1 and 2.
    expect(resolveApptOutcome({ outcome: "noAnswer", slot: 1, today: MON }).nextActionDate).toBe("2026-08-04");
    expect(resolveApptOutcome({ outcome: "leftMessage", slot: 2, today: MON }).nextActionDate).toBe("2026-08-04");
  });

  it("'will call the office' is the ONE outcome with a longer gap — 7 days", () => {
    // Brandon, restored 2026-08-04: the next move is the patient's, so there is
    // nothing to check tomorrow. Mon 3 Aug + 7 calendar days = Mon 10 Aug.
    expect(WILL_CALL_SNOOZE_CALENDAR_DAYS).toBe(7);
    const e = resolveApptOutcome({ outcome: "willCall", slot: 1, today: MON });
    expect(e.kind).toBe("retry");
    expect(e.nextActionDate).toBe("2026-08-10");
    expect(e.summary).toMatch(/will call the office/i);
  });

  it("the will-call week is CALENDAR days, so it never lands on a weekend", () => {
    // 7 calendar days is always the same weekday — that's the point of not
    // using business days here (7 business days would be a week and a half).
    for (const [today, expected] of [
      ["2026-08-04", "2026-08-11"], // Tue → Tue
      ["2026-08-06", "2026-08-13"], // Thu → Thu
      ["2026-08-07", "2026-08-14"], // Fri → Fri
    ] as const) {
      expect(
        resolveApptOutcome({ outcome: "willCall", slot: 2, today }).nextActionDate,
        today,
      ).toBe(expected);
    }
  });

  it("the other non-booking, non-refusal outcomes still share the 1-day gap", () => {
    for (const outcome of ["noAnswer", "leftMessage"] as const) {
      expect(
        resolveApptOutcome({ outcome, slot: 1, today: MON }).nextActionDate,
        outcome,
      ).toBe("2026-08-04");
    }
  });

  it("won't-schedule / wants-to-cancel proposes stuck at ANY attempt", () => {
    // A rep JUDGMENT, not a counter running out, so it doesn't wait for the
    // third attempt.
    for (const slot of [1, 2, 3] as const) {
      const e = resolveApptOutcome({ outcome: "wontSchedule", slot, today: MON });
      expect(e.kind, `slot ${slot}`).toBe("proposeStuck");
      expect(e.nextActionDate, `slot ${slot}`).toBeNull();
    }
  });

  it("names the rung the proposal lands on", () => {
    expect(
      resolveApptOutcome({ outcome: "wontSchedule", slot: 1, today: MON, proposeStuckLevel: "manager" })
        .summary,
    ).toMatch(/Manager Intervention/);
    expect(
      resolveApptOutcome({ outcome: "wontSchedule", slot: 1, today: MON, proposeStuckLevel: "final" })
        .summary,
    ).toMatch(/Final Decisions/);
  });

  it("stamps the proposed-stuck reason with the stage, the attempt and the note", () => {
    const reason = apptProposedStuckReason({ slot: 2, note: "going back to injections" });
    expect(reason).toBe("Patient Doctor Appointments · Attempt 2 of 3 · going back to injections");
  });

  it("the third non-booking attempt escalates with no next date", () => {
    // wontSchedule is excluded — it proposes stuck at every slot (above).
    for (const outcome of ["noAnswer", "leftMessage", "willCall"] as const) {
      const e = resolveApptOutcome({ outcome, slot: 3, today: MON });
      expect(e.kind, outcome).toBe("escalate");
      expect(e.nextActionDate, outcome).toBeNull();
    }
  });

  it("a date that has already passed makes the patient due NOW, not snoozed", () => {
    // "She was seen last Thursday" — nothing left to wait for. A past Next
    // Action Date would technically read as due, but it would show a stale
    // follow-up date on screen and in Monday.
    expect(snoozeUntilAfterAppointment("2026-07-20", MON)).toBe(MON);
    const e = resolveApptOutcome({ outcome: "booked", slot: 1, appointmentDate: "2026-07-20", today: MON });
    expect(e.kind).toBe("booked");
    expect(e.nextActionDate).toBe(MON);
    expect(e.summary).toMatch(/due now/i);
  });

  it("yesterday's appointment is due today, not tomorrow", () => {
    // Sun 2 Aug + 1 = Mon 3 Aug, which IS today — not in the future, so due now.
    expect(snoozeUntilAfterAppointment("2026-08-02", MON)).toBe(MON);
  });

  it("an appointment TODAY still snoozes to tomorrow", () => {
    // The visit hasn't produced paperwork yet — that's the whole point of +1.
    expect(snoozeUntilAfterAppointment(MON, MON)).toBe("2026-08-04");
    const e = resolveApptOutcome({ outcome: "booked", slot: 1, appointmentDate: MON, today: MON });
    expect(e.nextActionDate).toBe("2026-08-04");
    expect(e.summary).toMatch(/snoozed until/i);
  });

  it("a snooze never lands on a Saturday or Sunday", () => {
    // Fri 7 Aug + 1 business day = Mon 10 Aug (skips the weekend)
    expect(resolveApptOutcome({ outcome: "noAnswer", slot: 2, today: "2026-08-07" }).nextActionDate).toBe("2026-08-10");
    // An appointment on Fri 11 Sep would snooze to Sat 12 → clamped to Mon 14
    expect(snoozeUntilAfterAppointment("2026-09-11", MON)).toBe("2026-09-14");
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

describe("reach-out methods", () => {
  it("offers phone, text and email only — no patient portal", async () => {
    const { APPT_METHODS } = await import("./apptOutreach");
    expect(APPT_METHODS).toEqual(["Phone call", "Text message", "Email"]);
  });
});

describe("Propose Stuck climbs the shared ladder", () => {
  it("rep proposal → Manager Intervention; manager's → Final Decisions", async () => {
    const { proposeStuckLevel } = await import("@/lib/shared/stageActions");
    // A rep on the page (no manager origin), patient not yet escalated.
    expect(proposeStuckLevel("doctor-appointments", null)).toBe("manager");
    expect(proposeStuckLevel("doctor-appointments", "overview")).toBe("manager");
    // A manager proposing FROM Manager Intervention promotes to Final.
    expect(proposeStuckLevel("doctor-appointments", "manager-intervention")).toBe("final");
    // An already-escalated patient promotes wherever the click came from —
    // Final is the top rung, so a second proposal can't drop back down.
    expect(
      proposeStuckLevel("doctor-appointments", null, "Manager Escalation Required"),
    ).toBe("final");
    expect(
      proposeStuckLevel("doctor-appointments", null, "Final Escalation Required"),
    ).toBe("final");
  });
});

describe("the counter resets on re-entry and on a manager's return", () => {
  const attempt = (n: number) =>
    `8/${n}/26, 1:38 PM · Phone call — No answer / no response · tried again —JH`;
  const entry =
    "8/1/26, 9:00 AM · Patient Doctor Appointment · Provider requires a new visit, none scheduled (from Chase Clinicals — Fax) · moved to Doctor Appointments —JH";
  const returned = "[Returned to queue · 8/9/26 · MG] give it another go";

  it("a patient re-entering the stage starts at attempt 1, not pre-exhausted", async () => {
    const { apptAttemptCount, nextApptSlot } = await import("./apptOutreach");
    // First pass burned all three, then they were sent back through Chase and
    // the office asked for a visit again.
    const notes = [attempt(1), attempt(2), attempt(3), entry].join("\n");
    expect(apptAttemptCount(p({ mnEvalNotes: notes }))).toBe(0);
    expect(nextApptSlot(p({ mnEvalNotes: notes }))).toBe(1);
  });

  it("a manager's Return to Queue hands the rep a fresh three", async () => {
    const { apptAttemptCount, nextApptSlot } = await import("./apptOutreach");
    // Rep spent three, manager logged five more, then returned them.
    const notes = [
      attempt(1), attempt(2), attempt(3),
      attempt(4), attempt(5), attempt(6), attempt(7), attempt(8),
      returned,
    ].join("\n");
    expect(apptAttemptCount(p({ mnEvalNotes: notes }))).toBe(0);
    expect(nextApptSlot(p({ mnEvalNotes: notes }))).toBe(1);
  });

  it("counts only attempts AFTER the most recent marker", async () => {
    const { apptAttemptCount } = await import("./apptOutreach");
    const notes = [attempt(1), entry, attempt(2), attempt(3)].join("\n");
    expect(apptAttemptCount(p({ mnEvalNotes: notes }))).toBe(2);
  });
});

describe("the 3-attempt cap is a REP guardrail only", () => {
  const attempt = (n: number) =>
    `8/${n}/26, 1:38 PM · Phone call — No answer / no response · tried again —JH`;
  const three = [attempt(1), attempt(2), attempt(3)].join("\n");

  it("locks a rep out at three, but never a manager", async () => {
    const { apptCapApplies, nextApptSlot, isApptExhausted } = await import("./apptOutreach");
    const rep = p({ mnEvalNotes: three });
    const manager = p({ mnEvalNotes: three, escalationIndex: 0 });
    const final = p({ mnEvalNotes: three, escalationIndex: 2 });

    expect(apptCapApplies(rep)).toBe(true);
    expect(nextApptSlot(rep)).toBeNull();
    expect(isApptExhausted(rep)).toBe(true);

    for (const m of [manager, final]) {
      expect(apptCapApplies(m)).toBe(false);
      expect(nextApptSlot(m)).toBe(3); // clamped for display; never null
      expect(isApptExhausted(m)).toBe(false);
    }
  });

  it("counts a manager's attempts uncapped", async () => {
    const { apptAttemptTotal } = await import("./apptOutreach");
    const many = [1, 2, 3, 4, 5, 6].map(attempt).join("\n");
    expect(apptAttemptTotal(p({ mnEvalNotes: many }))).toBe(6);
  });

  it("a manager's third attempt logs instead of escalating", () => {
    const e = resolveApptOutcome({ outcome: "noAnswer", slot: 3, today: MON, capApplies: false });
    expect(e.kind).toBe("retry");
    expect(e.nextActionDate).toBe("2026-08-04");
    // A rep's third still hands over.
    expect(resolveApptOutcome({ outcome: "noAnswer", slot: 3, today: MON }).kind).toBe("escalate");
  });
});
