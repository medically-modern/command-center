// Tests for the samantha sidebar list math (sidebarList.ts). The role pages
// auto-select from sidebarVisibleList, so these semantics must stay identical
// to what PatientsSidebar renders: main list = active patients (non-escalated,
// no Follow Up) — escalated view swaps it for ALL escalated patients — then
// the Follow Up / Escalated / Escalated + Follow Up sections below, and the
// Auth Outstanding group re-sorts the main list by daysSinceStageIndex
// descending. Run: npx vitest run src/lib/samantha/sidebarList.test.ts
import { describe, it, expect } from "vitest";
import { isSnoozedFollowUp, sidebarSections, sidebarVisibleList } from "./sidebarList";
import type { Patient } from "./workflow";

const p = (over: Partial<Patient>): Patient =>
  ({ id: "x", name: "n", dob: "", notes: "", ...over } as Patient);

const ids = (list: Patient[]) => list.map((x) => x.id);

describe("sidebarVisibleList — nonEscalated (default) view", () => {
  it("shows active patients then follow-ups; hides escalated and both", () => {
    const patients = [
      p({ id: "esc", escalated: true }),
      p({ id: "active1" }),
      p({ id: "fu", followUp: "Follow Up" }),
      p({ id: "both", escalated: true, followUp: "Follow Up" }),
      p({ id: "active2" }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated", "benefits"))).toEqual([
      "active1",
      "active2",
      "fu",
    ]);
  });

  it("only the exact 'Follow Up' status moves a patient to the follow-up section", () => {
    const patients = [
      p({ id: "lower", followUp: "follow up" }),
      p({ id: "exact", followUp: "Follow Up" }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated", "benefits"))).toEqual([
      "lower",
      "exact",
    ]);
  });

  it("preserves input (Monday) order for non-authOutstanding groups", () => {
    const patients = [
      p({ id: "c", daysSinceStageIndex: 1 }),
      p({ id: "a", daysSinceStageIndex: 5 }),
      p({ id: "b" }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated", "submitAuth"))).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});

describe("sidebarVisibleList — escalated view", () => {
  it("shows ONLY escalated patients as the main list, in input order", () => {
    const patients = [
      p({ id: "esc1", escalated: true }),
      p({ id: "active" }),
      p({ id: "fu", followUp: "Follow Up" }),
      p({ id: "esc2", escalated: true }),
    ];
    expect(ids(sidebarVisibleList(patients, "escalated", "benefits"))).toEqual([
      "esc1",
      "esc2",
    ]);
  });

  it("includes escalated patients who also have a Follow Up (no separate sections)", () => {
    const patients = [
      p({ id: "both", escalated: true, followUp: "Follow Up" }),
      p({ id: "esc", escalated: true }),
    ];
    expect(ids(sidebarVisibleList(patients, "escalated", "benefits"))).toEqual([
      "both",
      "esc",
    ]);
  });
});

describe("sidebarVisibleList — all view", () => {
  it("renders active, then follow-up, then escalated, then escalated + follow-up", () => {
    const patients = [
      p({ id: "both", escalated: true, followUp: "Follow Up" }),
      p({ id: "esc", escalated: true }),
      p({ id: "fu", followUp: "Follow Up" }),
      p({ id: "active" }),
    ];
    expect(ids(sidebarVisibleList(patients, "all", "benefits"))).toEqual([
      "active",
      "fu",
      "esc",
      "both",
    ]);
  });
});

describe("sidebarVisibleList — authOutstanding sort", () => {
  it("sorts the main list by daysSinceStageIndex descending, missing index last", () => {
    const patients = [
      p({ id: "d0", daysSinceStageIndex: 0 }),
      p({ id: "none" }),
      p({ id: "d3", daysSinceStageIndex: 3 }),
      p({ id: "d1", daysSinceStageIndex: 1 }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated", "authOutstanding"))).toEqual([
      "d3",
      "d1",
      "d0",
      "none",
    ]);
  });

  it("keeps input order on ties (stable sort)", () => {
    const patients = [
      p({ id: "t1", daysSinceStageIndex: 2 }),
      p({ id: "t2", daysSinceStageIndex: 2 }),
      p({ id: "t3", daysSinceStageIndex: 2 }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated", "authOutstanding"))).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
  });

  it("re-sorts the escalated main list too, but never the follow-up section", () => {
    // Snoozing on Auth Outstanding is date-only (§12) — a future Follow Up
    // Date moves the patient to the follow-up section, which keeps input
    // order even on Auth Outstanding.
    const patients = [
      p({ id: "esc0", escalated: true, daysSinceStageIndex: 0 }),
      p({ id: "esc2", escalated: true, daysSinceStageIndex: 2 }),
      p({ id: "fuLate", followUpDate: "2099-01-01", daysSinceStageIndex: 0 }),
      p({ id: "fuEarly", followUpDate: "2099-01-02", daysSinceStageIndex: 5 }),
    ];
    expect(ids(sidebarVisibleList(patients, "escalated", "authOutstanding"))).toEqual([
      "esc2",
      "esc0",
    ]);
    expect(ids(sidebarVisibleList(patients, "nonEscalated", "authOutstanding"))).toEqual([
      "fuLate",
      "fuEarly",
    ]);
  });
});

describe("daily bucket — Auth Outstanding date-only rule (2026-07-21, §12)", () => {
  const TODAY = "2026-07-21";

  it("the Follow Up STATUS alone never snoozes on this stage; only a future date does", () => {
    const patients = [
      p({ id: "statusOnly", followUp: "Follow Up" }), // dateless legacy — DUE here
      p({ id: "futureDate", followUpDate: "2026-07-22" }),
      p({ id: "dueToday", followUp: "Follow Up", followUpDate: "2026-07-21" }),
      p({ id: "blank" }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated", "authOutstanding", TODAY))).toEqual([
      "statusOnly",
      "dueToday",
      "blank",
      "futureDate", // follow-up section below the main list
    ]);
    // Same patients on Benefits keep the status-based rule: statusOnly snoozed.
    expect(ids(sidebarVisibleList(patients, "nonEscalated", "benefits", TODAY))).toEqual([
      "futureDate",
      "dueToday",
      "blank",
      "statusOnly",
    ]);
  });

  it("sorts the due list by days outstanding (earliest auth submission first), fallback daysSinceStageIndex", () => {
    const withSub = (id: string, date: string) =>
      p({
        id,
        insurance: {
          universal: { "in-network": "", active: "", "dme-benefits": "" },
          codes: { pump: { status: "pending", authSubmissionDate: date } },
        } as Patient["insurance"],
      });
    const patients = [
      withSub("newer", "2026-07-20"),
      withSub("older", "2026-07-01"),
      p({ id: "noDates", daysSinceStageIndex: 9 }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated", "authOutstanding", TODAY))).toEqual([
      "older",
      "newer",
      "noDates",
    ]);
  });
});

describe("daily bucket — Follow Up Date auto-return (2026-07-20)", () => {
  const TODAY = "2026-07-20";

  it("isSnoozedFollowUp: future date snoozes; due date or no status does not; dateless stays snoozed", () => {
    expect(isSnoozedFollowUp(p({ followUp: "Follow Up", followUpDate: "2026-07-21" }), TODAY)).toBe(true);
    expect(isSnoozedFollowUp(p({ followUp: "Follow Up", followUpDate: "2026-07-20" }), TODAY)).toBe(false);
    expect(isSnoozedFollowUp(p({ followUp: "Follow Up", followUpDate: "2026-07-19" }), TODAY)).toBe(false);
    expect(isSnoozedFollowUp(p({ followUp: "Follow Up" }), TODAY)).toBe(true); // legacy dateless
    expect(isSnoozedFollowUp(p({ followUpDate: "2026-07-25" }), TODAY)).toBe(false); // no status
  });

  it("a due follow-up auto-returns to the active list; a future one stays in the section", () => {
    const patients = [
      p({ id: "due", followUp: "Follow Up", followUpDate: "2026-07-20" }),
      p({ id: "past", followUp: "Follow Up", followUpDate: "2026-07-18" }),
      p({ id: "tomorrow", followUp: "Follow Up", followUpDate: "2026-07-21" }),
      p({ id: "active" }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated", "submitAuth", TODAY))).toEqual([
      "due",
      "past",
      "active",
      "tomorrow",
    ]);
  });

  it("escalated + future follow-up stays in the both section; escalated + due goes to escalated", () => {
    const patients = [
      p({ id: "escDue", escalated: true, followUp: "Follow Up", followUpDate: "2026-07-20" }),
      p({ id: "escFuture", escalated: true, followUp: "Follow Up", followUpDate: "2026-07-22" }),
    ];
    const s = sidebarSections(patients, "all", "benefits", TODAY);
    expect(ids(s.escalatedPatients)).toEqual(["escDue"]);
    expect(ids(s.bothPatients)).toEqual(["escFuture"]);
  });
});

describe("sidebarSections", () => {
  it("splits into active / follow-up / escalated / both for the all view", () => {
    const patients = [
      p({ id: "both", escalated: true, followUp: "Follow Up" }),
      p({ id: "esc", escalated: true }),
      p({ id: "fu", followUp: "Follow Up" }),
      p({ id: "active" }),
    ];
    const s = sidebarSections(patients, "all", "benefits");
    expect(ids(s.activePatients)).toEqual(["active"]);
    expect(ids(s.followUpPatients)).toEqual(["fu"]);
    expect(ids(s.escalatedPatients)).toEqual(["esc"]);
    expect(ids(s.bothPatients)).toEqual(["both"]);
  });

  it("hides the escalated/both sections in the nonEscalated view", () => {
    const patients = [
      p({ id: "both", escalated: true, followUp: "Follow Up" }),
      p({ id: "esc", escalated: true }),
      p({ id: "fu", followUp: "Follow Up" }),
    ];
    const s = sidebarSections(patients, "nonEscalated", "benefits");
    expect(s.escalatedPatients).toEqual([]);
    expect(s.bothPatients).toEqual([]);
    expect(ids(s.followUpPatients)).toEqual(["fu"]);
  });

  it("keeps activePatients in input order while sortedPatients gets the AO re-sort", () => {
    const patients = [
      p({ id: "d1", daysSinceStageIndex: 1 }),
      p({ id: "d4", daysSinceStageIndex: 4 }),
    ];
    const s = sidebarSections(patients, "nonEscalated", "authOutstanding");
    expect(ids(s.activePatients)).toEqual(["d1", "d4"]);
    expect(ids(s.sortedPatients)).toEqual(["d4", "d1"]);
  });
});

describe("manager-origin narrowing (sidebar must match the bar chart)", () => {
  const mk = (id: string, label?: string): Patient =>
    ({ id, name: id, escalated: !!label, escalationLabel: label }) as Patient;

  const pool = [
    mk("plain"),
    mk("mgr", "Manager Escalation Required"),
    mk("final", "Final Escalation Required"),
  ];

  it("Manager Intervention lists only Manager-escalated patients", () => {
    const ids = sidebarVisibleList(pool, "escalated", "benefits", "2026-07-27", "manager-intervention").map((p) => p.id);
    expect(ids).toEqual(["mgr"]);
  });

  it("Final Decisions lists only Final-escalated patients", () => {
    const ids = sidebarVisibleList(pool, "escalated", "benefits", "2026-07-27", "final-decisions").map((p) => p.id);
    expect(ids).toEqual(["final"]);
  });

  it("keeps the whole escalated pool with no origin, and for Processor Overview", () => {
    // A rep's own ?manager=1 link carries no origin — it must not be narrowed.
    for (const origin of [null, "overview"] as const) {
      const ids = sidebarVisibleList(pool, "escalated", "benefits", "2026-07-27", origin).map((p) => p.id);
      expect(ids.sort()).toEqual(["final", "mgr"]);
    }
  });

  it("never narrows a non-escalated (ordinary rep) view", () => {
    const ids = sidebarVisibleList(pool, "nonEscalated", "benefits", "2026-07-27", "final-decisions").map((p) => p.id);
    expect(ids).toEqual(["plain"]);
  });
});
