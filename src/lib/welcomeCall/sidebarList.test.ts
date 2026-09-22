// Pins the Welcome Call sidebar's visible list to its exact render order
// (Active → Escalated → Follow Up → Escalated + Follow Up) per view filter,
// so useAutoSelectPatient always lands on the first row the rep can see.
//
// ⚠️ THE SNOOZE IS A DATE from 2026-09-22 (§5.31i), not the Follow Up STATUS.
// Every fixture below that used to snooze with `followUp: "Done"` alone now
// carries a FUTURE date, because that is what a snooze is: the status column
// is written by nothing on this board that a list reads, so `"Done"` with no
// date hid a patient for good — the §5.10 Patient-Intake one-way door, one
// board over. `todayYmd` is passed explicitly everywhere so these never depend
// on the clock.
// Run: npx vitest run src/lib/welcomeCall/sidebarList.test.ts
import { describe, it, expect } from "vitest";
import { isWelcomeCallSnoozed, sidebarSections, sidebarVisibleList } from "./sidebarList";
import type { Patient } from "./workflow";

/** A fixed "today" — the rule is date arithmetic, so the clock must not enter. */
const TODAY = "2026-09-22";
const TOMORROW = "2026-09-23";
const YESTERDAY = "2026-09-21";

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
const followF = p({ id: "f1", name: "Follow F", followUp: "Done", followUpDate: TOMORROW });
const bothX = p({ id: "b1", name: "Both X", escalated: true, followUp: "Done", followUpDate: TOMORROW });
const activeC = p({ id: "a3", name: "Active C" });
// A stuck PROPOSAL (Escalation index 2). The mapping sets `escalated` false for
// it, but the list rule must not depend on that — `proposedStuck` wins.
const proposedP = p({ id: "p1", name: "Proposed P", proposedStuck: true });
const board = [activeA, escalatedE, activeB, followF, bothX, activeC, proposedP];

describe("sidebarVisibleList — nonEscalated (default) filter", () => {
  it("shows active then follow-up; hides every escalated patient", () => {
    expect(ids(sidebarVisibleList(board, "nonEscalated", {}, TODAY))).toEqual([
      "a1", "a2", "a3", // Active, input order
      "f1",             // Follow Up
    ]);
  });

  it("IGNORES the Follow Up status entirely — only the date snoozes", () => {
    // Every one of these used to be decided by the status column. None is now.
    const working = p({ id: "o1", followUp: "Working on it" });
    const doneNoDate = p({ id: "o2", followUp: "Done" });
    const doneDatedToday = p({ id: "o3", followUp: "Done", followUpDate: TODAY });
    const doneDatedPast = p({ id: "o4", followUp: "Done", followUpDate: YESTERDAY });
    expect(ids(sidebarVisibleList([working, doneNoDate, doneDatedToday, doneDatedPast], "nonEscalated", {}, TODAY)))
      .toEqual(["o1", "o2", "o3", "o4"]);
    // …and a blank status with a future date IS snoozed.
    const datedOnly = p({ id: "o5", followUpDate: TOMORROW });
    const s = sidebarSections([datedOnly], "all", {}, TODAY);
    expect(ids(s.active)).toEqual([]);
    expect(ids(s.followUp)).toEqual(["o5"]);
  });

  it("returns empty for an empty board", () => {
    expect(sidebarVisibleList([], "nonEscalated", {}, TODAY)).toEqual([]);
  });
});

describe("sidebarVisibleList — escalated filter (manager view)", () => {
  it("shows ONLY escalated patients in the main list, including follow-ups", () => {
    expect(ids(sidebarVisibleList(board, "escalated", {}, TODAY))).toEqual(["e1", "b1"]);
  });

  it("keeps the other sections empty", () => {
    const s = sidebarSections(board, "escalated", {}, TODAY);
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
    expect(ids(sidebarVisibleList(board, "nonEscalated", {}, TODAY))).not.toContain("p1");
  });

  it("is not an 'escalated' row either — Manager Intervention lists index 0 only", () => {
    expect(ids(sidebarVisibleList(board, "escalated", {}, TODAY))).toEqual(["e1", "b1"]);
  });

  it("IS the main list from the Final Decisions column", () => {
    const s = sidebarSections(board, "escalated", { origin: "final-decisions" }, TODAY);
    expect(ids(s.active)).toEqual(["p1"]);
    expect(s.escalated).toEqual([]);
    expect(s.followUp).toEqual([]);
    expect(s.both).toEqual([]);
    expect(ids(sidebarVisibleList(board, "escalated", { origin: "final-decisions" }, TODAY))).toEqual(["p1"]);
  });

  it("gets its own section, last, on the all filter", () => {
    const s = sidebarSections(board, "all", {}, TODAY);
    expect(ids(s.proposedStuck)).toEqual(["p1"]);
    expect(ids(sidebarVisibleList(board, "all", {}, TODAY))).toEqual(["a1", "a2", "a3", "e1", "f1", "b1", "p1"]);
  });

  it("a proposal outranks a stale escalated flag on the same row", () => {
    const both = p({ id: "q1", escalated: true, proposedStuck: true });
    expect(ids(sidebarVisibleList([both], "escalated", {}, TODAY))).toEqual([]);
    expect(ids(sidebarVisibleList([both], "escalated", { origin: "final-decisions" }, TODAY))).toEqual(["q1"]);
  });
});

describe("sidebarVisibleList — all filter", () => {
  it("renders Active → Escalated → Follow Up → Both, top to bottom", () => {
    expect(ids(sidebarVisibleList(board, "all", {}, TODAY))).toEqual([
      "a1", "a2", "a3", // Active
      "e1",             // Escalated (not follow-up)
      "f1",             // Follow Up (not escalated)
      "b1",             // Escalated + Follow Up
      "p1",             // Proposed Stuck (§5.34)
    ]);
  });

  it("splits the sections by escalated × followUp exactly", () => {
    const s = sidebarSections(board, "all", {}, TODAY);
    expect(ids(s.active)).toEqual(["a1", "a2", "a3"]);
    expect(ids(s.escalated)).toEqual(["e1"]);
    expect(ids(s.followUp)).toEqual(["f1"]);
    expect(ids(s.both)).toEqual(["b1"]);
  });
});

describe("sidebarVisibleList — order preservation", () => {
  it("keeps input (board) order within every section", () => {
    const shuffled = [activeC, bothX, followF, activeA, escalatedE, activeB];
    expect(ids(sidebarVisibleList(shuffled, "all", {}, TODAY))).toEqual([
      "a3", "a1", "a2",
      "e1",
      "f1",
      "b1",
    ]);
    expect(ids(sidebarVisibleList(shuffled, "escalated", {}, TODAY))).toEqual(["b1", "e1"]);
  });
});
