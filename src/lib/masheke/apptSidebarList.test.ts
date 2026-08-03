import { describe, expect, it } from "vitest";
import type { Patient } from "./workflow";
import { apptSidebarSections, apptSidebarVisibleList } from "./sidebarList";
import { ESCALATION_INDEX } from "./mondayMapping";

const TODAY = "2026-08-03";

const p = (over: Partial<Patient> = {}): Patient =>
  ({ id: "x", name: "Test", dob: "", notes: "", ...over }) as Patient;

describe("Doctor Appointments sidebar", () => {
  it("keeps snoozed patients VISIBLE in the manager's folder", () => {
    const list = [
      p({ id: "due", nextActionDate: TODAY }),
      p({ id: "snoozed", nextActionDate: "2026-08-10" }),
    ];
    const { dueNow, awaitingReply } = apptSidebarSections(list, TODAY);
    expect(dueNow.map((x) => x.id)).toEqual(["due"]);
    expect(awaitingReply.map((x) => x.id)).toEqual(["snoozed"]);
    // A manager sees both; a processor sees only today's work.
    expect(apptSidebarVisibleList(list, TODAY, [], true).map((x) => x.id)).toEqual([
      "due",
      "snoozed",
    ]);
    expect(apptSidebarVisibleList(list, TODAY, [], false).map((x) => x.id)).toEqual(["due"]);
  });

  it("a BOOKED visit wins — Scheduled, never Reach out today or Awaiting reply", () => {
    // useMondayPatients injects a deep-linked ?patientId= into the main list
    // even when they don't match this stage, so a booked patient arrives in
    // BOTH lists. There's nothing to do until the visit, so Scheduled wins.
    const snoozed = p({ id: "snoozed", nextActionDate: "2026-08-13", appointmentDate: "2026-08-12" });
    const dueToday = p({ id: "dueToday", nextActionDate: TODAY, appointmentDate: "2026-08-12" });

    const a = apptSidebarSections([snoozed], TODAY, [snoozed]);
    expect(a.scheduled.map((x) => x.id)).toEqual(["snoozed"]);
    expect(a.awaitingReply).toHaveLength(0);
    expect(a.dueNow).toHaveLength(0);

    // Even a Next Action Date of TODAY doesn't pull them into the work list.
    const b = apptSidebarSections([dueToday], TODAY, []);
    expect(b.scheduled.map((x) => x.id)).toEqual(["dueToday"]);
    expect(b.dueNow).toHaveLength(0);
  });

  it("a PAST appointment is not 'scheduled' — the visit already happened", () => {
    const seen = p({ id: "seen", nextActionDate: TODAY, appointmentDate: "2026-07-20" });
    const { dueNow, scheduled } = apptSidebarSections([seen], TODAY, [seen]);
    expect(scheduled).toHaveLength(0);
    expect(dueNow.map((x) => x.id)).toEqual(["seen"]);
  });

  it("shows Scheduled to managers only, soonest visit first", () => {
    const sched = [
      p({ id: "later", appointmentDate: "2026-09-20" }),
      p({ id: "sooner", appointmentDate: "2026-08-12" }),
    ];
    expect(apptSidebarSections([], TODAY, sched).scheduled.map((x) => x.id)).toEqual([
      "sooner",
      "later",
    ]);
    // A processor never sees them.
    expect(apptSidebarVisibleList([], TODAY, sched, false)).toHaveLength(0);
    expect(apptSidebarVisibleList([], TODAY, sched, true).map((x) => x.id)).toEqual([
      "sooner",
      "later",
    ]);
  });

  it("treats a blank or past Next Action Date as due now", () => {
    const list = [
      p({ id: "blank" }),
      p({ id: "past", nextActionDate: "2026-07-30" }),
      p({ id: "today", nextActionDate: TODAY }),
    ];
    expect(apptSidebarSections(list, TODAY).dueNow.map((x) => x.id)).toEqual([
      "blank",
      "past",
      "today",
    ]);
    expect(apptSidebarSections(list, TODAY).awaitingReply).toHaveLength(0);
  });

  it("drops escalated patients entirely — they belong to the manager", () => {
    const list = [
      p({ id: "due", nextActionDate: TODAY }),
      p({ id: "esc", escalationIndex: ESCALATION_INDEX.required, nextActionDate: TODAY }),
      p({ id: "escSnoozed", escalationIndex: ESCALATION_INDEX.required, nextActionDate: "2026-09-01" }),
    ];
    const { dueNow, awaitingReply } = apptSidebarSections(list, TODAY);
    expect(dueNow.map((x) => x.id)).toEqual(["due"]);
    expect(awaitingReply).toHaveLength(0);
    expect(apptSidebarVisibleList(list, TODAY, [], true).map((x) => x.id)).toEqual(["due"]);
  });

  it("compares only the date part of a datetime Next Action Date", () => {
    const list = [
      p({ id: "todayTime", nextActionDate: `${TODAY} 09:00:00` }),
      p({ id: "futureTime", nextActionDate: "2026-08-11 12:00:00" }),
    ];
    const { dueNow, awaitingReply } = apptSidebarSections(list, TODAY);
    expect(dueNow.map((x) => x.id)).toEqual(["todayTime"]);
    expect(awaitingReply.map((x) => x.id)).toEqual(["futureTime"]);
  });

  it("preserves input order within each section", () => {
    const list = [
      p({ id: "s1", nextActionDate: "2026-08-20" }),
      p({ id: "d1", nextActionDate: TODAY }),
      p({ id: "s2", nextActionDate: "2026-08-05" }),
      p({ id: "d2" }),
    ];
    expect(apptSidebarVisibleList(list, TODAY, [], true).map((x) => x.id)).toEqual([
      "d1",
      "d2",
      "s1",
      "s2",
    ]);
  });
});
