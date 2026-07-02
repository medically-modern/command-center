// Pins the Welcome Call sidebar's visible list to its exact render order
// (Active → Escalated → Follow Up → Escalated + Follow Up) per view filter,
// so useAutoSelectPatient always lands on the first row the rep can see.
// Run: npx vitest run src/lib/welcomeCall/sidebarList.test.ts
import { describe, it, expect } from "vitest";
import { sidebarSections, sidebarVisibleList } from "./sidebarList";
import type { Patient } from "./workflow";

const p = (over: Partial<Patient>): Patient =>
  ({
    id: "x",
    name: "n",
    escalated: false,
    followUp: "",
    followUpDate: "",
    ...over,
  } as Patient);

const ids = (list: Patient[]) => list.map((x) => x.id);

// One patient per state, deliberately interleaved to prove input order survives.
const activeA = p({ id: "a1", name: "Active A" });
const escalatedE = p({ id: "e1", name: "Escalated E", escalated: true });
const activeB = p({ id: "a2", name: "Active B" });
const followF = p({ id: "f1", name: "Follow F", followUp: "Done" });
const bothX = p({ id: "b1", name: "Both X", escalated: true, followUp: "Done" });
const activeC = p({ id: "a3", name: "Active C" });
const board = [activeA, escalatedE, activeB, followF, bothX, activeC];

describe("sidebarVisibleList — nonEscalated (default) filter", () => {
  it("shows active then follow-up; hides every escalated patient", () => {
    expect(ids(sidebarVisibleList(board, "nonEscalated"))).toEqual([
      "a1", "a2", "a3", // Active, input order
      "f1",             // Follow Up
    ]);
  });

  it("treats any followUp text other than 'Done' as active", () => {
    const odd = p({ id: "o1", followUp: "Working on it" });
    expect(ids(sidebarVisibleList([odd], "nonEscalated"))).toEqual(["o1"]);
  });

  it("returns empty for an empty board", () => {
    expect(sidebarVisibleList([], "nonEscalated")).toEqual([]);
  });
});

describe("sidebarVisibleList — escalated filter (manager view)", () => {
  it("shows ONLY escalated patients in the main list, including follow-ups", () => {
    expect(ids(sidebarVisibleList(board, "escalated"))).toEqual(["e1", "b1"]);
  });

  it("keeps the other sections empty", () => {
    const s = sidebarSections(board, "escalated");
    expect(ids(s.active)).toEqual(["e1", "b1"]);
    expect(s.escalated).toEqual([]);
    expect(s.followUp).toEqual([]);
    expect(s.both).toEqual([]);
  });
});

describe("sidebarVisibleList — all filter", () => {
  it("renders Active → Escalated → Follow Up → Both, top to bottom", () => {
    expect(ids(sidebarVisibleList(board, "all"))).toEqual([
      "a1", "a2", "a3", // Active
      "e1",             // Escalated (not follow-up)
      "f1",             // Follow Up (not escalated)
      "b1",             // Escalated + Follow Up
    ]);
  });

  it("splits the sections by escalated × followUp exactly", () => {
    const s = sidebarSections(board, "all");
    expect(ids(s.active)).toEqual(["a1", "a2", "a3"]);
    expect(ids(s.escalated)).toEqual(["e1"]);
    expect(ids(s.followUp)).toEqual(["f1"]);
    expect(ids(s.both)).toEqual(["b1"]);
  });
});

describe("sidebarVisibleList — order preservation", () => {
  it("keeps input (board) order within every section", () => {
    const shuffled = [activeC, bothX, followF, activeA, escalatedE, activeB];
    expect(ids(sidebarVisibleList(shuffled, "all"))).toEqual([
      "a3", "a1", "a2",
      "e1",
      "f1",
      "b1",
    ]);
    expect(ids(sidebarVisibleList(shuffled, "escalated"))).toEqual(["b1", "e1"]);
  });
});
