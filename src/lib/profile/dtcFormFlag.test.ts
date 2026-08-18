import { describe, it, expect } from "vitest";
import {
  DTC_FORM_GROUP_COMPLETED,
  DTC_FORM_GROUP_PARTIAL,
  dtcFormMatchesFor,
  dtcLeadKindLabel,
  dtcLeadRoute,
  findDtcFormMatches,
  isPatientFormReferral,
  queueLeadsFrom,
  type DtcFormLead,
} from "./dtcFormFlag";
import { IN_SYSTEM_GROUP } from "./referralSplit";
import { GROUPS } from "./mondayApi";

const INTAKE_GROUP = "group_mm1xf2jb";

function lead(overrides: Partial<DtcFormLead> = {}): DtcFormLead {
  return {
    id: "form-1",
    name: "Theodore Obrien",
    groupId: DTC_FORM_GROUP_COMPLETED,
    dob: "08/04/1963",
    email: "obrientw@gmail.com",
    phone: "2014464449",
    ...overrides,
  };
}

/** A doctor referral in the Already In System queue, shaped like the live
 *  board rows (§5.10 — phone arrives formatted, "+1"-prefixed or bare). */
function referral(overrides: Partial<Parameters<typeof dtcFormMatchesFor>[0]> = {}) {
  return {
    id: "ref-1",
    name: "Theodore Obrien",
    dob: "08/04/1963",
    email: "obrientw@gmail.com",
    ptPhone: "(201) 446-4449",
    referralType: "Doctor",
    ...overrides,
  };
}

describe("group ids stay in sync with the board schema", () => {
  // Same drill as referralSplit.IN_SYSTEM_GROUP: the flag module keeps
  // literals so tests don't drag the API module's env plumbing — but they MUST
  // be the same groups mondayApi fetches.
  it("matches GROUPS.newFormPartial / GROUPS.newFormCompleted", () => {
    expect(DTC_FORM_GROUP_PARTIAL).toBe(GROUPS.newFormPartial);
    expect(DTC_FORM_GROUP_COMPLETED).toBe(GROUPS.newFormCompleted);
  });
});

describe("findDtcFormMatches — identity rules", () => {
  it("matches on email, case- and whitespace-insensitive", () => {
    const m = findDtcFormMatches(
      referral({ email: " OBrienTW@Gmail.com ", ptPhone: "", name: "", dob: "" }),
      [lead()],
    );
    expect(m).toHaveLength(1);
    expect(m[0].matchedOn).toEqual(["email"]);
  });

  it("matches on phone across renderings (+1 / bare 11-digit / formatted)", () => {
    const base = referral({ email: "", name: "", dob: "" });
    for (const boardPhone of ["12014464449", "+12014464449", "(201) 446-4449", "2014464449"]) {
      const m = findDtcFormMatches(base, [lead({ email: "", phone: boardPhone })]);
      expect(m, boardPhone).toHaveLength(1);
      expect(m[0].matchedOn).toEqual(["phone"]);
    }
  });

  it("never matches phone fragments — only full 10-digit numbers participate", () => {
    const m = findDtcFormMatches(
      referral({ email: "", name: "", dob: "", ptPhone: "446" }),
      [lead({ email: "", phone: "446" })],
    );
    expect(m).toHaveLength(0);
  });

  it("matches on name AND dob together, tolerant of case/spacing/zero-padding", () => {
    const m = findDtcFormMatches(
      referral({ email: "", ptPhone: "", name: "theodore  OBRIEN ", dob: "8/4/1963" }),
      [lead({ email: "", phone: "" })],
    );
    expect(m).toHaveLength(1);
    expect(m[0].matchedOn).toEqual(["name+dob"]);
  });

  it("does NOT match on name alone or dob alone", () => {
    const nameOnly = findDtcFormMatches(
      referral({ email: "", ptPhone: "", dob: "" }),
      [lead({ email: "", phone: "", dob: "01/01/1990" })],
    );
    expect(nameOnly).toHaveLength(0);
    const dobOnly = findDtcFormMatches(
      referral({ email: "", ptPhone: "", name: "Somebody Else" }),
      [lead({ email: "", phone: "" })],
    );
    expect(dobOnly).toHaveLength(0);
  });

  it("blank email/phone on both sides never join two patients", () => {
    const m = findDtcFormMatches(
      referral({ email: "", ptPhone: "", name: "A", dob: "" }),
      [lead({ email: "", phone: "", name: "B", dob: "" })],
    );
    expect(m).toHaveLength(0);
  });

  it("junk DOB text doesn't throw and only matches the identical value", () => {
    const junk = referral({ email: "", ptPhone: "", dob: "00/26/1961" });
    expect(findDtcFormMatches(junk, [lead({ email: "", phone: "", dob: "00/26/1961" })])).toHaveLength(1);
    expect(findDtcFormMatches(junk, [lead({ email: "", phone: "", dob: "01/26/1961" })])).toHaveLength(0);
    expect(findDtcFormMatches(referral({ dob: "unknown" }), [lead({ email: "x", phone: "" })])).toHaveLength(0);
  });

  it("collects every reason that matched", () => {
    const m = findDtcFormMatches(referral(), [lead()]);
    expect(m).toHaveLength(1);
    expect(m[0].matchedOn).toEqual(["email", "phone", "name+dob"]);
  });

  it("excludes the patient's own item id", () => {
    const m = findDtcFormMatches(referral({ id: "same" }), [lead({ id: "same" })]);
    expect(m).toHaveLength(0);
  });
});

describe("dtcFormMatchesFor — the referral-type gate", () => {
  it("suppresses the flag when the queue item itself is a patient-form referral", () => {
    for (const t of ["Patient", "PATIENT", " patient "]) {
      expect(dtcFormMatchesFor(referral({ referralType: t }), [lead()])).toHaveLength(0);
    }
  });

  it("flags doctor referrals — and every other non-patient origin", () => {
    for (const t of ["Doctor", "Manufacturer", "Payor", "Advocacy Group", ""]) {
      expect(dtcFormMatchesFor(referral({ referralType: t }), [lead()]), t).toHaveLength(1);
    }
  });

  it("gates on referral TYPE only — a source of 'Patient' does not suppress (referralSplit's vocabulary rule)", () => {
    // The gate takes no source argument at all; this pins that a Doctor-typed
    // referral is flagged no matter what the Source column says.
    expect(isPatientFormReferral("Doctor")).toBe(false);
    expect(isPatientFormReferral("Patient")).toBe(true);
    expect(isPatientFormReferral("")).toBe(false);
    expect(isPatientFormReferral(undefined)).toBe(false);
  });
});

describe("queueLeadsFrom — patient-form items already inside the queue fetch", () => {
  const queuePatient = (over: Record<string, string>) => ({
    id: "q-1", name: "Ivy Gushea", dob: "04/17/1987", email: "crazybeautiful100@icloud.com",
    ptPhone: "(518) 420-6255", referralType: "Manufacturer", groupId: IN_SYSTEM_GROUP,
    alreadyInSystem: "Yes", dateOfIntake: "2026-07-28", ...over,
  });

  it("keeps only patient-form items, mapped to leads", () => {
    const leads = queueLeadsFrom([
      queuePatient({ id: "manu" }),
      queuePatient({ id: "form", referralType: "Patient" }),
    ]);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      id: "form", name: "Ivy Gushea", groupId: IN_SYSTEM_GROUP,
      phone: "(518) 420-6255", alreadyInSystem: "Yes", submittedOn: "2026-07-28",
    });
  });

  it("the Ivy Gushea pair: a form item MOVED into the in-system group still flags its manufacturer twin", () => {
    // Her patient-form item left the form groups when the board moved it to
    // Already In System — the form-group poll can't see it, the queue can.
    const leads = queueLeadsFrom([queuePatient({ id: "form", referralType: "Patient" })]);
    const m = dtcFormMatchesFor(referral({
      id: "manu", name: "Ivy Gushea", dob: "04/17/1987", email: "", ptPhone: "+15184206255",
      referralType: "Manufacturer",
    }), leads);
    expect(m).toHaveLength(1);
    expect(m[0].matchedOn).toContain("phone");
  });
});

describe("dtcLeadRoute / dtcLeadKindLabel — where 'View form' goes", () => {
  it("routes form-group leads to Unverified Referrals with the right source", () => {
    expect(dtcLeadRoute(lead({ id: "5", groupId: DTC_FORM_GROUP_PARTIAL })))
      .toBe("/unverified-referrals?source=partial&patientId=5");
    expect(dtcLeadRoute(lead({ id: "6", groupId: DTC_FORM_GROUP_COMPLETED })))
      .toBe("/unverified-referrals?patientId=6");
  });

  it("returns null for leads already in the Already In System queue (either §5.10 route)", () => {
    expect(dtcLeadRoute(lead({ groupId: IN_SYSTEM_GROUP, alreadyInSystem: "" }))).toBeNull();
    expect(dtcLeadRoute(lead({ groupId: INTAKE_GROUP, alreadyInSystem: "Yes" }))).toBeNull();
  });

  it("routes a 1. Intake patient-form lead (not in system) to Verified Referrals", () => {
    expect(dtcLeadRoute(lead({ id: "7", groupId: INTAKE_GROUP, alreadyInSystem: "No" })))
      .toBe("/profile?patientId=7");
  });

  it("labels partial vs completed forms, and queue-sourced leads generically", () => {
    expect(dtcLeadKindLabel(lead({ groupId: DTC_FORM_GROUP_PARTIAL }))).toBe("partial form");
    expect(dtcLeadKindLabel(lead({ groupId: DTC_FORM_GROUP_COMPLETED }))).toBe("completed form");
    expect(dtcLeadKindLabel(lead({ groupId: IN_SYSTEM_GROUP }))).toBe("patient-submitted referral");
  });
});
