// Tests for the masheke sidebar list math (sidebarList.ts). The role pages
// auto-select from sidebarVisibleList, so these semantics must stay identical
// to what PatientsSidebar renders: default view = non-escalated patients due
// now (Next Action Date blank or <= ET today), escalated view = escalated
// only (no date split), "all" = due-now list then escalated below. Run:
// npx vitest run src/lib/masheke/sidebarList.test.ts
import { describe, it, expect } from "vitest";
import { sidebarSections, sidebarVisibleList } from "./sidebarList";
import { etToday } from "./etDate";
import type { Patient } from "./workflow";

const TODAY = "2026-07-02";

const p = (over: Partial<Patient>): Patient =>
  ({ id: "x", name: "n", dob: "", notes: "", ...over } as Patient);

const ids = (list: Patient[]) => list.map((x) => x.id);

describe("sidebarVisibleList — nonEscalated (default) view", () => {
  it("shows non-escalated patients with blank, past, or today Next Action Date", () => {
    const patients = [
      p({ id: "blank" }),
      p({ id: "past", nextActionDate: "2026-06-30" }),
      p({ id: "today", nextActionDate: TODAY }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated", TODAY))).toEqual([
      "blank",
      "past",
      "today",
    ]);
  });

  it("hides future-dated (scheduled) patients — the folder is disabled", () => {
    const patients = [
      p({ id: "due", nextActionDate: TODAY }),
      p({ id: "future", nextActionDate: "2026-07-03" }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated", TODAY))).toEqual(["due"]);
  });

  it("hides escalated patients", () => {
    const patients = [
      p({ id: "esc", escalation: "Escalation Required" }),
      p({ id: "plain" }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated", TODAY))).toEqual(["plain"]);
  });

  it("only 'Escalation Required' counts as escalated (e.g. 'Done' does not)", () => {
    const patients = [p({ id: "done", escalation: "Done" })];
    expect(ids(sidebarVisibleList(patients, "nonEscalated", TODAY))).toEqual(["done"]);
  });

  it("compares only the date part of a datetime Next Action Date", () => {
    const patients = [
      p({ id: "todayTime", nextActionDate: `${TODAY} 09:00:00` }),
      p({ id: "futureTime", nextActionDate: "2026-07-10 12:00:00" }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated", TODAY))).toEqual(["todayTime"]);
  });

  it("preserves input order", () => {
    const patients = [
      p({ id: "c", nextActionDate: TODAY }),
      p({ id: "a" }),
      p({ id: "b", nextActionDate: "2026-01-01" }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated", TODAY))).toEqual(["c", "a", "b"]);
  });
});

describe("sidebarVisibleList — escalated view", () => {
  it("shows only escalated patients, in input order", () => {
    const patients = [
      p({ id: "esc1", escalation: "Escalation Required" }),
      p({ id: "plain" }),
      p({ id: "esc2", escalation: "Escalation Required" }),
    ];
    expect(ids(sidebarVisibleList(patients, "escalated", TODAY))).toEqual(["esc1", "esc2"]);
  });

  it("ignores the Next Action Date split — future-dated escalated still show", () => {
    const patients = [
      p({ id: "escFuture", escalation: "Escalation Required", nextActionDate: "2027-01-01" }),
    ];
    expect(ids(sidebarVisibleList(patients, "escalated", TODAY))).toEqual(["escFuture"]);
  });
});

describe("sidebarVisibleList — all view", () => {
  it("renders the non-escalated due-now section first, then escalated below", () => {
    const patients = [
      p({ id: "esc1", escalation: "Escalation Required" }),
      p({ id: "due1" }),
      p({ id: "esc2", escalation: "Escalation Required", nextActionDate: "2027-01-01" }),
      p({ id: "due2", nextActionDate: TODAY }),
      p({ id: "future", nextActionDate: "2026-07-03" }),
    ];
    expect(ids(sidebarVisibleList(patients, "all", TODAY))).toEqual([
      "due1",
      "due2",
      "esc1",
      "esc2",
    ]);
  });
});

describe("sidebarSections", () => {
  it("splits into due-now, scheduled, and escalated (each in input order)", () => {
    const patients = [
      p({ id: "esc", escalation: "Escalation Required" }),
      p({ id: "future", nextActionDate: "2026-08-01" }),
      p({ id: "due", nextActionDate: "2026-06-01" }),
      p({ id: "blank" }),
    ];
    const s = sidebarSections(patients, TODAY);
    expect(ids(s.nonEscNow)).toEqual(["due", "blank"]);
    expect(ids(s.pendingPatients)).toEqual(["future"]);
    expect(ids(s.escalatedList)).toEqual(["esc"]);
  });

  it("defaults todayStr to ET today", () => {
    const patients = [p({ id: "a" }), p({ id: "b", nextActionDate: "2099-01-01" })];
    expect(sidebarSections(patients)).toEqual(sidebarSections(patients, etToday()));
    expect(sidebarVisibleList(patients, "nonEscalated")).toEqual(
      sidebarVisibleList(patients, "nonEscalated", etToday()),
    );
  });
});
