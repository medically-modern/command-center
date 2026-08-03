import { describe, expect, it } from "vitest";
import type { Patient } from "./workflow";
import { apptSidebarSections, apptSidebarVisibleList } from "./sidebarList";
import { ESCALATION_INDEX } from "./mondayMapping";

const TODAY = "2026-08-03";

const p = (over: Partial<Patient> = {}): Patient =>
  ({ id: "x", name: "Test", dob: "", notes: "", ...over }) as Patient;

describe("Doctor Appointments sidebar", () => {
  it("keeps snoozed patients VISIBLE in their own folder", () => {
    const list = [
      p({ id: "due", nextActionDate: TODAY }),
      p({ id: "snoozed", nextActionDate: "2026-08-10" }),
    ];
    const { dueNow, awaitingReply } = apptSidebarSections(list, TODAY);
    expect(dueNow.map((x) => x.id)).toEqual(["due"]);
    expect(awaitingReply.map((x) => x.id)).toEqual(["snoozed"]);
    // The whole point: a patient who texts back mid-snooze is still reachable.
    expect(apptSidebarVisibleList(list, TODAY).map((x) => x.id)).toEqual(["due", "snoozed"]);
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
    expect(apptSidebarVisibleList(list, TODAY).map((x) => x.id)).toEqual(["due"]);
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
    expect(apptSidebarVisibleList(list, TODAY).map((x) => x.id)).toEqual(["d1", "d2", "s1", "s2"]);
  });
});
