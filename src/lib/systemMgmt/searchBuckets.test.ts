import { describe, it, expect } from "vitest";
import { bucketResults, searchBucket } from "./searchBuckets";
import { BOARDS } from "./mondayApi";
import { STUCK_GROUP_IDS, COMPLETED_GROUP_IDS } from "@/lib/shared/profileStatus";

const row = (over: Partial<Parameters<typeof searchBucket>[0]> = {}) => ({
  isCompleted: false,
  groupId: "group_mm1xf2jb",
  boardId: 18406060017,
  stageAdvancerText: "Evaluate MN",
  ...over,
});

describe("searchBucket", () => {
  it("files ordinary pipeline work under active", () => {
    expect(searchBucket(row())).toBe("active");
  });

  it("files every Completed group on every board under completed", () => {
    for (const b of BOARDS) {
      for (const g of b.groupRoutes.filter((g) => g.isCompleted)) {
        expect(searchBucket(row({ isCompleted: true, groupId: g.id, boardId: b.boardId, stageAdvancerText: "" })))
          .toBe("completed");
      }
    }
  });

  it("files every Stuck group under stuck", () => {
    for (const id of STUCK_GROUP_IDS) {
      expect(searchBucket(row({ groupId: id, stageAdvancerText: "" }))).toBe("stuck");
    }
  });

  it("reads the Stage Advancer's Stuck label before the automation has moved the item", () => {
    expect(searchBucket(row({ boardId: 18406060017, stageAdvancerText: "Stuck" }))).toBe("stuck");
    expect(searchBucket(row({ boardId: 18410601299, groupId: "group_mm1xr3q3", stageAdvancerText: "Stuck / Don't Proceed" })))
      .toBe("stuck");
    expect(searchBucket(row({ boardId: 18410804557, groupId: "group_mm1wvq8p", stageAdvancerText: "Stuck / Don't Proceed" })))
      .toBe("stuck");
  });

  it("reads DTC Intake's own two labels, one of which never says Stuck", () => {
    const dtc = { boardId: 18392794310, groupId: "group_mkywy9dj" };
    expect(searchBucket(row({ ...dtc, stageAdvancerText: "Stuck Final Review" }))).toBe("stuck");
    expect(searchBucket(row({ ...dtc, stageAdvancerText: "Can't Proceed" }))).toBe("stuck");
    expect(searchBucket(row({ ...dtc, stageAdvancerText: "2. MN In Progress" }))).toBe("active");
  });

  it("matches labels exactly — a board's vocabulary, not a pattern", () => {
    expect(searchBucket(row({ stageAdvancerText: "Unstuck Review" }))).toBe("active");
    expect(searchBucket(row({ stageAdvancerText: "Stuck / Don't Proceed" /* not ME's label */ }))).toBe("active");
    // A board with no known Stuck label classifies by group alone.
    expect(searchBucket(row({ boardId: 18407459988, groupId: "topics", stageAdvancerText: "Stuck" }))).toBe("active");
  });

  it("completed wins over a stale Stuck label or group", () => {
    expect(searchBucket(row({ isCompleted: true, groupId: COMPLETED_GROUP_IDS[0], stageAdvancerText: "Stuck" })))
      .toBe("completed");
  });

  it("escalated and proposed-stuck rows stay active — a manager still owns them", () => {
    // Escalation is not an input to the bucket at all; only the group and the
    // advancer are. Pinning that here so nobody adds it.
    expect(searchBucket(row({ groupId: "group_mm33pdpm" /* ME Escalations */ }))).toBe("active");
  });
});

describe("bucketResults", () => {
  it("splits in order and loses nothing", () => {
    const rows = [
      row({ groupId: "a" }),
      row({ isCompleted: true, groupId: "group_mm1x5q4e" }),
      row({ groupId: "group_mm1xyczx", stageAdvancerText: "" }),
      row({ groupId: "b" }),
    ];
    const b = bucketResults(rows);
    expect(b.active.map((r) => r.groupId)).toEqual(["a", "b"]);
    expect(b.completed).toHaveLength(1);
    expect(b.stuck).toHaveLength(1);
    expect(b.active.length + b.completed.length + b.stuck.length).toBe(rows.length);
  });
});
