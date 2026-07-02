// Tests for the samantha sidebar list math (sidebarList.ts). The role pages
// auto-select from sidebarVisibleList, so these semantics must stay identical
// to what PatientsSidebar renders: main list = active patients (non-escalated,
// no Follow Up) — escalated view swaps it for ALL escalated patients — then
// the Follow Up / Escalated / Escalated + Follow Up sections below, and the
// Auth Outstanding group re-sorts the main list by daysSinceStageIndex
// descending. Run: npx vitest run src/lib/samantha/sidebarList.test.ts
import { describe, it, expect } from "vitest";
import { sidebarSections, sidebarVisibleList } from "./sidebarList";
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
    const patients = [
      p({ id: "esc0", escalated: true, daysSinceStageIndex: 0 }),
      p({ id: "esc2", escalated: true, daysSinceStageIndex: 2 }),
      p({ id: "fuLate", followUp: "Follow Up", daysSinceStageIndex: 0 }),
      p({ id: "fuEarly", followUp: "Follow Up", daysSinceStageIndex: 5 }),
    ];
    expect(ids(sidebarVisibleList(patients, "escalated", "authOutstanding"))).toEqual([
      "esc2",
      "esc0",
    ]);
    // Follow-up section keeps input order even on Auth Outstanding.
    expect(ids(sidebarVisibleList(patients, "nonEscalated", "authOutstanding"))).toEqual([
      "fuLate",
      "fuEarly",
    ]);
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
