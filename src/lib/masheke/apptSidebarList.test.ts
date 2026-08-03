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

  it("drops escalated patients from the PROCESSOR sidebar — they belong to the manager", () => {
    const list = [
      p({ id: "due", nextActionDate: TODAY }),
      p({ id: "esc", escalationIndex: ESCALATION_INDEX.required, nextActionDate: TODAY }),
      p({ id: "escSnoozed", escalationIndex: ESCALATION_INDEX.required, nextActionDate: "2026-09-01" }),
    ];
    const { dueNow, awaitingReply } = apptSidebarSections(list, TODAY);
    expect(dueNow.map((x) => x.id)).toEqual(["due"]);
    expect(awaitingReply).toHaveLength(0);
    expect(apptSidebarVisibleList(list, TODAY, [], false).map((x) => x.id)).toEqual(["due"]);
  });

  /**
   * Manager Intervention showed "Nobody due right now" while its bar chart
   * counted the patient: the sections filtered on isEscalatedIndex, which is
   * index-0-ONLY — so Manager Intervention (index 0) patients vanished and
   * Final Decisions (index 2) patients came through, which is exactly the
   * asymmetry Josh reported. The manager's list IS the escalated patients.
   */
  it("KEEPS escalated patients in the manager view, sorted by Next Action Date", () => {
    const list = [
      p({ id: "escToday", escalationIndex: ESCALATION_INDEX.required, nextActionDate: TODAY }),
      p({ id: "escPast", escalationIndex: ESCALATION_INDEX.required, nextActionDate: "2026-07-28" }),
      p({ id: "escFuture", escalationIndex: ESCALATION_INDEX.required, nextActionDate: "2026-09-01" }),
      p({ id: "escBlank", escalationIndex: ESCALATION_INDEX.required }),
    ];
    const { dueNow, awaitingReply, scheduled } = apptSidebarSections(list, TODAY, [], true);
    expect(dueNow.map((x) => x.id)).toEqual(["escToday", "escPast", "escBlank"]);
    expect(awaitingReply.map((x) => x.id)).toEqual(["escFuture"]);
    expect(scheduled).toHaveLength(0);
    expect(apptSidebarVisibleList(list, TODAY, [], true).map((x) => x.id)).toEqual([
      "escToday",
      "escPast",
      "escBlank",
      "escFuture",
    ]);
    // Same list, processor view: nothing at all.
    expect(apptSidebarVisibleList(list, TODAY, [], false)).toHaveLength(0);
  });

  it("keeps a proposed-stuck (index 2) patient in the manager view too", () => {
    const list = [
      p({ id: "final", escalationIndex: ESCALATION_INDEX.finalRequired, nextActionDate: TODAY }),
    ];
    expect(apptSidebarSections(list, TODAY, [], true).dueNow.map((x) => x.id)).toEqual(["final"]);
  });

  it("a booked visit still wins for an escalated patient in the manager view", () => {
    const booked = p({
      id: "escBooked",
      escalationIndex: ESCALATION_INDEX.required,
      nextActionDate: TODAY,
      appointmentDate: "2026-08-14",
    });
    const { dueNow, awaitingReply, scheduled } = apptSidebarSections([booked], TODAY, [booked], true);
    expect(scheduled.map((x) => x.id)).toEqual(["escBooked"]);
    expect(dueNow).toHaveLength(0);
    expect(awaitingReply).toHaveLength(0);
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
