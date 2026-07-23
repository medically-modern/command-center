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
      p({ id: "esc", escalationIndex: 0 }),
      p({ id: "plain" }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated", TODAY))).toEqual(["plain"]);
  });

  it("detects escalation by INDEX: 0 (manager) + 2 (final) escalated, 1 (Done) not", () => {
    // Done (index 1) is not escalated → stays in the non-escalated list.
    const done = [p({ id: "done", escalationIndex: 1 })];
    expect(ids(sidebarVisibleList(done, "nonEscalated", TODAY))).toEqual(["done"]);
    // Final Escalation (index 2) IS escalated → hidden from the non-escalated
    // view and present in the escalated view.
    const final = [p({ id: "final", escalationIndex: 2 }), p({ id: "plain" })];
    expect(ids(sidebarVisibleList(final, "nonEscalated", TODAY))).toEqual(["plain"]);
    expect(ids(sidebarVisibleList(final, "escalated", TODAY))).toEqual(["final"]);
  });

  it("a blank escalation (no index) is not escalated", () => {
    const patients = [p({ id: "blank" })];
    expect(ids(sidebarVisibleList(patients, "nonEscalated", TODAY))).toEqual(["blank"]);
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
      p({ id: "esc1", escalationIndex: 0 }),
      p({ id: "plain" }),
      p({ id: "esc2", escalationIndex: 0 }),
    ];
    expect(ids(sidebarVisibleList(patients, "escalated", TODAY))).toEqual(["esc1", "esc2"]);
  });

  it("ignores the Next Action Date split — future-dated escalated still show", () => {
    const patients = [
      p({ id: "escFuture", escalationIndex: 0, nextActionDate: "2027-01-01" }),
    ];
    expect(ids(sidebarVisibleList(patients, "escalated", TODAY))).toEqual(["escFuture"]);
  });
});

describe("sidebarVisibleList — all view", () => {
  it("renders the non-escalated due-now section first, then escalated below", () => {
    const patients = [
      p({ id: "esc1", escalationIndex: 0 }),
      p({ id: "due1" }),
      p({ id: "esc2", escalationIndex: 0, nextActionDate: "2027-01-01" }),
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
      p({ id: "esc", escalationIndex: 0 }),
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
