// Tests for the subscription sidebar list math (sidebarList.ts).
// SubscriptionPage auto-selects from sidebarVisibleList, so these semantics
// must stay identical to what PatientsSidebar renders: non-escalated patients
// grouped by status — Active → Paused → Dead → Other — then the dimmed
// Escalated section at the bottom. Run: npx vitest run src/lib/subscription/sidebarList.test.ts
import { describe, it, expect } from "vitest";
import { sidebarSections, sidebarVisibleList } from "./sidebarList";
import type { Patient } from "./workflow";

const p = (over: Partial<Patient>): Patient =>
  ({ id: "x", name: "n", status: "", escalated: false, ...over } as Patient);

const ids = (list: Patient[]) => list.map((x) => x.id);

describe("sidebarVisibleList — status grouping", () => {
  it("orders groups Active → Paused → Dead → Other, regardless of input order", () => {
    const patients = [
      p({ id: "oth", status: "Something Else" }),
      p({ id: "dead", status: "Dead" }),
      p({ id: "pau", status: "Paused" }),
      p({ id: "act", status: "Active" }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated"))).toEqual([
      "act",
      "pau",
      "dead",
      "oth",
    ]);
  });

  it("preserves input order within a group", () => {
    const patients = [
      p({ id: "a2", status: "Active" }),
      p({ id: "p1", status: "Paused" }),
      p({ id: "a1", status: "Active" }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated"))).toEqual(["a2", "a1", "p1"]);
  });

  it("puts blank/unknown statuses in Other, after Dead", () => {
    const patients = [
      p({ id: "blank", status: "" }),
      p({ id: "dead", status: "Dead" }),
      p({ id: "unk", status: "Onboarding" }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated"))).toEqual([
      "dead",
      "blank",
      "unk",
    ]);
  });
});

describe("sidebarVisibleList — escalated section", () => {
  it("moves escalated patients below every status group, in input order, whatever their status", () => {
    const patients = [
      p({ id: "esc1", status: "Active", escalated: true }),
      p({ id: "act", status: "Active" }),
      p({ id: "esc2", status: "Dead", escalated: true }),
      p({ id: "pau", status: "Paused" }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated"))).toEqual([
      "act",
      "pau",
      "esc1",
      "esc2",
    ]);
  });

  it("excludes escalated patients from the status groups entirely", () => {
    const s = sidebarSections([p({ id: "esc", status: "Active", escalated: true })]);
    expect(ids(s.active)).toEqual([]);
    expect(ids(s.escalatedPatients)).toEqual(["esc"]);
  });
});

describe("sidebarVisibleList — view filter", () => {
  it("has no escalation view split, so every filter returns the same list", () => {
    const patients = [
      p({ id: "esc", status: "Paused", escalated: true }),
      p({ id: "act", status: "Active" }),
    ];
    const nonEsc = ids(sidebarVisibleList(patients, "nonEscalated"));
    expect(nonEsc).toEqual(["act", "esc"]);
    expect(ids(sidebarVisibleList(patients, "escalated"))).toEqual(nonEsc);
    expect(ids(sidebarVisibleList(patients, "all"))).toEqual(nonEsc);
  });
});

describe("sidebarSections", () => {
  it("splits into the four status groups + escalated", () => {
    const patients = [
      p({ id: "act", status: "Active" }),
      p({ id: "pau", status: "Paused" }),
      p({ id: "dead", status: "Dead" }),
      p({ id: "oth", status: "Churned" }),
      p({ id: "esc", status: "Active", escalated: true }),
    ];
    const s = sidebarSections(patients);
    expect(ids(s.active)).toEqual(["act"]);
    expect(ids(s.paused)).toEqual(["pau"]);
    expect(ids(s.dead)).toEqual(["dead"]);
    expect(ids(s.other)).toEqual(["oth"]);
    expect(ids(s.escalatedPatients)).toEqual(["esc"]);
  });

  it("returns all-empty sections for an empty list", () => {
    const s = sidebarSections([]);
    expect(s.active).toEqual([]);
    expect(s.paused).toEqual([]);
    expect(s.dead).toEqual([]);
    expect(s.other).toEqual([]);
    expect(s.escalatedPatients).toEqual([]);
    expect(sidebarVisibleList([], "all")).toEqual([]);
  });
});
