// Tests for the profile sidebar list math (sidebarList.ts). ProfilePage
// auto-selects from sidebarVisibleList, so these semantics must stay identical
// to what PatientsSidebar renders: active (followUp !== "Done") patients
// grouped by referral source — known sources in SOURCE_ORDER (Tandem first),
// then unknown/other sources alphabetically — followed by the dimmed Follow Up
// section. Run: npx vitest run src/lib/profile/sidebarList.test.ts
import { describe, it, expect } from "vitest";
import { sidebarSections, sidebarVisibleList } from "./sidebarList";
import type { Patient } from "./workflow";

const p = (over: Partial<Patient>): Patient =>
  ({ id: "x", name: "n", followUp: "", referralSource: "", ...over } as Patient);

const ids = (list: Patient[]) => list.map((x) => x.id);

describe("sidebarVisibleList — referral source grouping", () => {
  it("orders known sources per SOURCE_ORDER (Tandem first), regardless of input order", () => {
    const patients = [
      p({ id: "sol", referralSource: "Solace Advocates" }),
      p({ id: "pat", referralSource: "Patient" }),
      p({ id: "doc", referralSource: "Doctor" }),
      p({ id: "ccx", referralSource: "CareCentrix" }),
      p({ id: "bb", referralSource: "Beta Bionics" }),
      p({ id: "tan", referralSource: "Tandem" }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated"))).toEqual([
      "tan",
      "bb",
      "ccx",
      "doc",
      "pat",
      "sol",
    ]);
  });

  it("puts unknown/other sources after known ones, alphabetically; blank → Unknown", () => {
    const patients = [
      p({ id: "z", referralSource: "Zenith" }),
      p({ id: "blank", referralSource: "" }),
      p({ id: "a", referralSource: "Acme" }),
      p({ id: "tan", referralSource: "Tandem" }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated"))).toEqual([
      "tan",
      "a",
      "blank",
      "z",
    ]);
  });

  it("trims referral source before grouping", () => {
    const patients = [
      p({ id: "spaced", referralSource: "  Tandem  " }),
      p({ id: "other", referralSource: "Acme" }),
    ];
    const s = sidebarSections(patients);
    expect(s.sourceGroups.map((g) => g.source)).toEqual(["Tandem", "Acme"]);
    expect(ids(sidebarVisibleList(patients, "nonEscalated"))).toEqual(["spaced", "other"]);
  });

  it("preserves input order within a group", () => {
    const patients = [
      p({ id: "t2", referralSource: "Tandem" }),
      p({ id: "d1", referralSource: "Doctor" }),
      p({ id: "t1", referralSource: "Tandem" }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated"))).toEqual(["t2", "t1", "d1"]);
  });
});

describe("sidebarVisibleList — Follow Up section", () => {
  it("moves followUp === 'Done' patients below every active group, in input order", () => {
    const patients = [
      p({ id: "fu1", followUp: "Done", referralSource: "Tandem" }),
      p({ id: "act1", referralSource: "Patient" }),
      p({ id: "fu2", followUp: "Done", referralSource: "Acme" }),
      p({ id: "act2", referralSource: "Tandem" }),
    ];
    expect(ids(sidebarVisibleList(patients, "nonEscalated"))).toEqual([
      "act2",
      "act1",
      "fu1",
      "fu2",
    ]);
  });

  it("only 'Done' counts as follow-up — other statuses stay active", () => {
    const patients = [p({ id: "pending", followUp: "Pending", referralSource: "Tandem" })];
    const s = sidebarSections(patients);
    expect(ids(s.followUpPatients)).toEqual([]);
    expect(ids(s.sourceGroups[0].patients)).toEqual(["pending"]);
  });
});

describe("sidebarVisibleList — view filter", () => {
  it("has no escalation split, so every filter returns the same list", () => {
    const patients = [
      p({ id: "fu", followUp: "Done" }),
      p({ id: "act", referralSource: "Tandem" }),
    ];
    const nonEsc = ids(sidebarVisibleList(patients, "nonEscalated"));
    expect(nonEsc).toEqual(["act", "fu"]);
    expect(ids(sidebarVisibleList(patients, "escalated"))).toEqual(nonEsc);
    expect(ids(sidebarVisibleList(patients, "all"))).toEqual(nonEsc);
  });
});

describe("sidebarSections", () => {
  it("splits into source groups and follow-up (groups only exist when non-empty)", () => {
    const patients = [
      p({ id: "fu", followUp: "Done", referralSource: "Tandem" }),
      p({ id: "doc", referralSource: "Doctor" }),
      p({ id: "unk" }),
    ];
    const s = sidebarSections(patients);
    expect(s.sourceGroups.map((g) => g.source)).toEqual(["Doctor", "Unknown"]);
    expect(ids(s.sourceGroups[0].patients)).toEqual(["doc"]);
    expect(ids(s.sourceGroups[1].patients)).toEqual(["unk"]);
    expect(ids(s.followUpPatients)).toEqual(["fu"]);
  });

  it("returns no groups for an empty or all-follow-up list", () => {
    expect(sidebarSections([]).sourceGroups).toEqual([]);
    const s = sidebarSections([p({ id: "fu", followUp: "Done" })]);
    expect(s.sourceGroups).toEqual([]);
    expect(ids(s.followUpPatients)).toEqual(["fu"]);
  });
});
