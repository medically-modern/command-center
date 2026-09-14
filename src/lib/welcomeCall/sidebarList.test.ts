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
// A stuck PROPOSAL (Escalation index 2). The mapping sets `escalated` false for
// it, but the list rule must not depend on that — `proposedStuck` wins.
const proposedP = p({ id: "p1", name: "Proposed P", proposedStuck: true });
const board = [activeA, escalatedE, activeB, followF, bothX, activeC, proposedP];

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
    expect(s.proposedStuck).toEqual([]);
  });
});

// ── The Propose Stuck ladder (2026-09-14, §5.34) ──
describe("proposed stuck (Escalation index 2)", () => {
  it("never appears in the rep's default view — it is the manager's to decide", () => {
    expect(ids(sidebarVisibleList(board, "nonEscalated"))).not.toContain("p1");
  });

  it("is not an 'escalated' row either — Manager Intervention lists index 0 only", () => {
    expect(ids(sidebarVisibleList(board, "escalated"))).toEqual(["e1", "b1"]);
  });

  it("IS the main list from the Final Decisions column", () => {
    const s = sidebarSections(board, "escalated", { origin: "final-decisions" });
    expect(ids(s.active)).toEqual(["p1"]);
    expect(s.escalated).toEqual([]);
    expect(s.followUp).toEqual([]);
    expect(s.both).toEqual([]);
    expect(ids(sidebarVisibleList(board, "escalated", { origin: "final-decisions" }))).toEqual(["p1"]);
  });

  it("gets its own section, last, on the all filter", () => {
    const s = sidebarSections(board, "all");
    expect(ids(s.proposedStuck)).toEqual(["p1"]);
    expect(ids(sidebarVisibleList(board, "all"))).toEqual(["a1", "a2", "a3", "e1", "f1", "b1", "p1"]);
  });

  it("a proposal outranks a stale escalated flag on the same row", () => {
    const both = p({ id: "q1", escalated: true, proposedStuck: true });
    expect(ids(sidebarVisibleList([both], "escalated"))).toEqual([]);
    expect(ids(sidebarVisibleList([both], "escalated", { origin: "final-decisions" }))).toEqual(["q1"]);
  });
});

describe("sidebarVisibleList — all filter", () => {
  it("renders Active → Escalated → Follow Up → Both, top to bottom", () => {
    expect(ids(sidebarVisibleList(board, "all"))).toEqual([
      "a1", "a2", "a3", // Active
      "e1",             // Escalated (not follow-up)
      "f1",             // Follow Up (not escalated)
      "b1",             // Escalated + Follow Up
      "p1",             // Proposed Stuck (§5.34)
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
