// Pins the Final Profile Confirmation sidebar's visible list to its exact
// render order (Active/main → Escalated) per view filter, so
// useAutoSelectPatient always lands on the first row the rep can see.
// Run: npx vitest run src/lib/finalConfirm/sidebarList.test.ts
import { describe, it, expect } from "vitest";
import { sidebarSections, sidebarVisibleList } from "./sidebarList";
import type { Patient } from "./workflow";

const p = (over: Partial<Patient>): Patient =>
  ({
    id: "x",
    name: "n",
    escalated: false,
    ...over,
  } as Patient);

const ids = (list: Patient[]) => list.map((x) => x.id);

// Escalated patients deliberately interleaved to prove input order survives.
const activeA = p({ id: "a1", name: "Active A" });
const escalatedE = p({ id: "e1", name: "Escalated E", escalated: true });
const activeB = p({ id: "a2", name: "Active B" });
const escalatedF = p({ id: "e2", name: "Escalated F", escalated: true });
const activeC = p({ id: "a3", name: "Active C" });
const board = [activeA, escalatedE, activeB, escalatedF, activeC];

describe("sidebarVisibleList — nonEscalated (default) filter", () => {
  it("shows only non-escalated patients; hides every escalated patient", () => {
    expect(ids(sidebarVisibleList(board, "nonEscalated"))).toEqual(["a1", "a2", "a3"]);
  });

  it("keeps the Escalated section empty", () => {
    const s = sidebarSections(board, "nonEscalated");
    expect(ids(s.main)).toEqual(["a1", "a2", "a3"]);
    expect(s.escalated).toEqual([]);
  });

  it("returns empty for an empty board", () => {
    expect(sidebarVisibleList([], "nonEscalated")).toEqual([]);
  });
});

describe("sidebarVisibleList — escalated filter (manager view)", () => {
  it("shows ONLY escalated patients in the main list", () => {
    expect(ids(sidebarVisibleList(board, "escalated"))).toEqual(["e1", "e2"]);
  });

  it("keeps the separate Escalated section empty (main list covers it)", () => {
    const s = sidebarSections(board, "escalated");
    expect(ids(s.main)).toEqual(["e1", "e2"]);
    expect(s.escalated).toEqual([]);
  });
});

describe("sidebarVisibleList — all filter", () => {
  it("renders Active then Escalated, top to bottom", () => {
    expect(ids(sidebarVisibleList(board, "all"))).toEqual([
      "a1", "a2", "a3", // Active (main)
      "e1", "e2",       // Escalated
    ]);
  });

  it("splits the sections by escalated exactly", () => {
    const s = sidebarSections(board, "all");
    expect(ids(s.main)).toEqual(["a1", "a2", "a3"]);
    expect(ids(s.escalated)).toEqual(["e1", "e2"]);
  });
});

describe("sidebarVisibleList — order preservation", () => {
  it("keeps input (board) order within every section", () => {
    const shuffled = [activeC, escalatedF, activeA, escalatedE, activeB];
    expect(ids(sidebarVisibleList(shuffled, "all"))).toEqual([
      "a3", "a1", "a2",
      "e2", "e1",
    ]);
    expect(ids(sidebarVisibleList(shuffled, "escalated"))).toEqual(["e2", "e1"]);
    expect(ids(sidebarVisibleList(shuffled, "nonEscalated"))).toEqual(["a3", "a1", "a2"]);
  });
});
