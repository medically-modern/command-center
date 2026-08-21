// Tests for the profile sidebar list math (sidebarList.ts). ProfilePage
// auto-selects from sidebarVisibleList, so these semantics must stay identical
// to what PatientsSidebar renders: active (followUp !== "Done") patients
// grouped by referral source — known sources in SOURCE_ORDER (Tandem first),
// then unknown/other sources alphabetically — followed by the dimmed Follow Up
// section. Run: npx vitest run src/lib/profile/sidebarList.test.ts
import { describe, it, expect } from "vitest";
import {
  attemptCount, autoTextCount, contactTally, sidebarSections, sidebarVisibleList,
} from "./sidebarList";
import type { Patient } from "./workflow";

const p = (over: Partial<Patient>): Patient =>
  ({ id: "x", name: "n", followUp: "", referralSource: "", attemptCounter: "", ...over } as Patient);

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

describe("ignoreFollowUp — Patient Intake, which has no snooze", () => {
  // Josh, 2026-08-13: a call attempt on that stage bumps the Attempt Counter
  // and nothing else, so Follow Up is not part of its model. The page must
  // IGNORE the column, not merely hide the section — patients parked by the
  // old snooze carry "Done" and would otherwise stay missing from the sidebar
  // with no way for a rep to reach them.
  const patients = [
    p({ id: "parked", followUp: "Done", referralSource: "Patient" }),
    p({ id: "live", referralSource: "Patient" }),
  ];

  it("keeps a 'Done' patient in the main list instead of a section", () => {
    const s = sidebarSections(patients, { ignoreFollowUp: true });
    expect(ids(s.followUpPatients)).toEqual([]);
    expect(ids(s.sourceGroups[0].patients)).toEqual(["parked", "live"]);
  });

  it("still splits by default, so the other two profile roles are untouched", () => {
    const s = sidebarSections(patients);
    expect(ids(s.followUpPatients)).toEqual(["parked"]);
    expect(ids(s.sourceGroups[0].patients)).toEqual(["live"]);
  });

  it("carries through sidebarVisibleList, so page auto-select matches", () => {
    expect(ids(sidebarVisibleList(patients, "nonEscalated", { ignoreFollowUp: true })))
      .toEqual(["parked", "live"]);
  });
});

describe("sortByAttempts — Patient Intake, where nothing ages a patient out", () => {
  // With no snooze the queue only grows, so it needs an order or a rep working
  // top-down re-rings the same people and the bottom never gets touched.
  const patients = [
    p({ id: "three", attemptCounter: "3", referralSource: "Patient" }),
    p({ id: "none", attemptCounter: "", referralSource: "Patient" }),
    p({ id: "one", attemptCounter: "1", referralSource: "Patient" }),
  ];

  it("puts the least-tried first", () => {
    const s = sidebarSections(patients, { sortByAttempts: true });
    expect(ids(s.sourceGroups[0].patients)).toEqual(["none", "one", "three"]);
  });

  it("keeps Monday's order among equals, so the oldest untried is called first", () => {
    // Stable sort. Newest-first among the untried would leave the oldest
    // untried patient permanently last — the exact rot this ordering prevents.
    const sameCount = [
      p({ id: "older", attemptCounter: "", referralSource: "Patient" }),
      p({ id: "newer", attemptCounter: "0", referralSource: "Patient" }),
    ];
    const s = sidebarSections(sameCount, { sortByAttempts: true });
    expect(ids(s.sourceGroups[0].patients)).toEqual(["older", "newer"]);
  });

  it("orders WITHIN each referral-source group, not just across the flat list", () => {
    const mixed = [
      p({ id: "t-tried", attemptCounter: "2", referralSource: "Tandem" }),
      p({ id: "p-tried", attemptCounter: "5", referralSource: "Patient" }),
      p({ id: "t-fresh", attemptCounter: "", referralSource: "Tandem" }),
      p({ id: "p-fresh", attemptCounter: "", referralSource: "Patient" }),
    ];
    const s = sidebarSections(mixed, { sortByAttempts: true });
    expect(s.sourceGroups.map((g) => g.source)).toEqual(["Tandem", "Patient"]);
    expect(ids(s.sourceGroups[0].patients)).toEqual(["t-fresh", "t-tried"]);
    expect(ids(s.sourceGroups[1].patients)).toEqual(["p-fresh", "p-tried"]);
  });

  it("treats an unreadable counter as untried rather than hiding it at the bottom", () => {
    const odd = [
      p({ id: "junk", attemptCounter: "n/a", referralSource: "Patient" }),
      p({ id: "two", attemptCounter: "2", referralSource: "Patient" }),
    ];
    expect(attemptCount(odd[0])).toBe(0);
    expect(ids(sidebarSections(odd, { sortByAttempts: true }).sourceGroups[0].patients))
      .toEqual(["junk", "two"]);
  });

  it("leaves the order alone by default, for the two roles with no counter", () => {
    const s = sidebarSections(patients);
    expect(ids(s.sourceGroups[0].patients)).toEqual(["three", "none", "one"]);
  });

  it("is what sidebarVisibleList returns, so page auto-select opens the top row", () => {
    expect(ids(sidebarVisibleList(patients, "all", { sortByAttempts: true })))
      .toEqual(["none", "one", "three"]);
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

describe("contactTally — what a rep sees before picking up the phone", () => {
  it("counts the two automated drop-off texts and nothing else", () => {
    // Drop-off Attempt is claimed by the intake backend before each of its two
    // sends (30 minutes, 24 hours) and written by nothing else — not the resume
    // link, not the insurance upload link, not a rep's own text.
    expect(autoTextCount(p({ dropOffAttempt: "" }))).toBe(0);
    expect(autoTextCount(p({ dropOffAttempt: "1" }))).toBe(1);
    expect(autoTextCount(p({ dropOffAttempt: "2" }))).toBe(2);
  });

  it("clamps a hand-typed number rather than reporting it", () => {
    // The sequence caps at two, so a 7 in the column is somebody's typo — not
    // seven texts this patient received. Reporting it would send a rep into a
    // call believing we had hounded them.
    expect(autoTextCount(p({ dropOffAttempt: "7" }))).toBe(2);
    expect(autoTextCount(p({ dropOffAttempt: "-3" }))).toBe(0);
    expect(autoTextCount(p({ dropOffAttempt: "not a number" }))).toBe(0);
  });

  it("prints both numbers even at zero", () => {
    // "We have not tried" is as load-bearing an answer as "we tried twice";
    // an omitted count reads as no data rather than as none.
    expect(contactTally(p({}))).toBe("Call Attempts: 0 | Auto. Texts: 0");
    expect(contactTally(p({ attemptCounter: "3", dropOffAttempt: "2" })))
      .toBe("Call Attempts: 3 | Auto. Texts: 2");
  });

  it("is the format the sidebar row and the patient header BOTH render", () => {
    // One builder on purpose: the number a rep scanned the list by and the
    // number on the patient they opened cannot be allowed to disagree.
    const patient = p({ attemptCounter: "1", dropOffAttempt: "1" });
    expect(contactTally(patient)).toContain(`Call Attempts: ${attemptCount(patient)}`);
    expect(contactTally(patient)).toContain(`Auto. Texts: ${autoTextCount(patient)}`);
  });
});
