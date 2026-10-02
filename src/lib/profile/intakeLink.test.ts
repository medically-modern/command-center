import { describe, it, expect } from "vitest";
import { intakeProfileHref, intakeQueueHref } from "./intakeLink";
import { BOARDS } from "@/lib/systemMgmt/mondayApi";
import { BOARD_ID, GROUPS } from "./mondayApi";

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

  it("⚠️ a 1. Intake item opens on Referral Intake, not Info Collection (reported 2026-10-02)", () => {
    // The patient screen's "Open Profile Send Off" button builds its link here.
    // 1. Intake fell to the Info Collection default, so a doctor referral opened
    // on the wrong page, with the wrong page's exits.
    expect(intakeProfileHref("1", GROUPS.intake, "from=patient")).toBe(
      "/profile?patientId=1&from=patient",
    );
  });

  it("an Already In System item opens on its own page", () => {
    expect(intakeProfileHref("1", GROUPS.alreadyInSystem)).toBe("/in-system-referrals?patientId=1");
  });

  it("⚠️ agrees with Search on every Profile Send Off group that has a page", () => {
    // Search routes a row by `groupRoutes`. The two doors to the same patient
    // must open the same page, so a group added to one and not the other fails here.
    const board = BOARDS.find((b) => b.boardId === BOARD_ID)!;
    const routed = board.groupRoutes.filter((g) => g.roleRoute && !g.isCompleted);
    expect(routed.length).toBeGreaterThan(0);
    for (const g of routed) {
      expect(intakeProfileHref("1", g.id).startsWith(`${g.roleRoute}?`), g.title).toBe(true);
    }
  });

  it("carries the caller's extra query and encodes the id", () => {
    expect(intakeProfileHref("a b", GROUPS.newFormPartial, "from=care-coordinator")).toBe(
      "/unverified-referrals?source=partial&patientId=a%20b&from=care-coordinator",
    );
  });

  it("intakeQueueHref answers only for a group that has a queue", () => {
    expect(intakeQueueHref("1", GROUPS.intake)).toBe("/profile?patientId=1");
    expect(intakeQueueHref("1", GROUPS.newFormPartial, "from=x")).toBe(
      "/unverified-referrals?source=partial&patientId=1&from=x",
    );
    for (const g of [GROUPS.stuck, GROUPS.patientIntake, GROUPS.tests, GROUPS.completed, "group_other", undefined, null]) {
      expect(intakeQueueHref("1", g)).toBeNull();
    }
  });
});
