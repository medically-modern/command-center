import { describe, it, expect } from "vitest";
import { intakeProfileHref } from "./intakeLink";
import { GROUPS } from "./mondayApi";

describe("intakeProfileHref — the deep link says which queue the patient is really in", () => {
  it("⚠️ a Partial Leads item carries source=partial (Jason Ortiz-Troxell, 2026-09-25)", () => {
    // Without it the page defaults to Completed and calls an abandoned form a
    // successful one.
    expect(intakeProfileHref("13071148612", GROUPS.newFormPartial)).toBe(
      "/unverified-referrals?source=partial&patientId=13071148612",
    );
  });

  it("a Profile Clean-Up item opens its OWN page, not Info Collection", () => {
    expect(intakeProfileHref("1", GROUPS.profileCleanUp)).toBe("/profile-cleanup?patientId=1");
  });

  it("a Completed item, an unknown group and no group all keep today's default", () => {
    for (const g of [GROUPS.newFormCompleted, "group_other", undefined, null]) {
      expect(intakeProfileHref("1", g)).toBe("/unverified-referrals?patientId=1");
    }
  });

  it("carries the caller's extra query and encodes the id", () => {
    expect(intakeProfileHref("a b", GROUPS.newFormPartial, "from=care-coordinator")).toBe(
      "/unverified-referrals?source=partial&patientId=a%20b&from=care-coordinator",
    );
  });
});
