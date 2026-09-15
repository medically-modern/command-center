import { describe, it, expect } from "vitest";
import {
  bucketEmptyNoun,
  bucketResultCount,
  bucketResults,
  searchBucket,
  SEARCH_BUCKETS,
} from "./searchBuckets";
import { BOARDS } from "./mondayApi";
import { ORDERS_BOARD_ID } from "./ordersSearch";
import { GROUPS as ORDER_GROUPS } from "@/lib/orders/mondayApi";
import { STUCK_GROUP_IDS, COMPLETED_GROUP_IDS } from "@/lib/shared/profileStatus";

const row = (over: Partial<Parameters<typeof searchBucket>[0]> = {}) => ({
  isCompleted: false,
  groupId: "group_mm1xf2jb",
  boardId: 18406060017,
  stageAdvancerText: "Evaluate MN",
  escalationLevel: null as "manager" | "final" | "flat" | null,
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

  it("Manager Intervention (index 0) stays active — being worked, by a manager", () => {
    expect(searchBucket(row({ groupId: "group_mm33pdpm" /* ME Escalations */, escalationLevel: "manager" }))).toBe("active");
    expect(searchBucket(row({ escalationLevel: "flat" }))).toBe("active");
  });

  it("Proposed Stuck (Final Decisions) is stuck — Gregory White's case", () => {
    expect(searchBucket(row({ boardId: 18410601299, groupId: "group_mm1xr3q3", stageAdvancerText: "Benefits / SoS", escalationLevel: "final" })))
      .toBe("stuck");
  });

  it("files every New Order Board group under orders, and only there", () => {
    /* ⚠️ "ONLY show them in a tab to the right of stuck" (Josh, 2026-09-15) is
       this assertion. Nothing else would catch a regression: an order has no
       Completed group, no Stuck group and no escalation column, so dropping
       the first check files every one of them under ACTIVE — silently, in
       among the pipeline stages a rep is searching for. */
    for (const groupId of Object.values(ORDER_GROUPS)) {
      expect(searchBucket(row({ boardId: ORDERS_BOARD_ID, groupId, stageAdvancerText: "Process Claim" })))
        .toBe("orders");
    }
  });

  it("an order stays an order whatever else the row looks like", () => {
    // Shipped/Delivered is a finished ORDER, not a finished patient; "Stuck"
    // is one of this board's own Order Status labels; an escalation level
    // could only arrive here by mistake. None of them may move the row.
    const order = { boardId: ORDERS_BOARD_ID, groupId: ORDER_GROUPS.shippedDelivered };
    expect(searchBucket(row({ ...order, isCompleted: true }))).toBe("orders");
    expect(searchBucket(row({ ...order, stageAdvancerText: "Stuck" }))).toBe("orders");
    expect(searchBucket(row({ ...order, escalationLevel: "final" }))).toBe("orders");
  });

  it("completed still wins over a stale Final escalation", () => {
    expect(searchBucket(row({ isCompleted: true, groupId: COMPLETED_GROUP_IDS[3], escalationLevel: "final" }))).toBe("completed");
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
    expect(b.orders).toHaveLength(0);
    expect(b.active.length + b.completed.length + b.stuck.length + b.orders.length)
      .toBe(rows.length);
  });

  it("keeps orders out of the other three folders", () => {
    const rows = [
      row(),
      row({ boardId: ORDERS_BOARD_ID, groupId: ORDER_GROUPS.order, stageAdvancerText: "Order" }),
      row({ boardId: ORDERS_BOARD_ID, groupId: ORDER_GROUPS.shippedDelivered, stageAdvancerText: "Process Claim" }),
    ];
    const b = bucketResults(rows);
    expect(b.orders).toHaveLength(2);
    expect(b.active).toHaveLength(1);
    expect(b.completed).toHaveLength(0);
    expect(b.stuck).toHaveLength(0);
  });
});

describe("how a folder names what is in it", () => {
  it("keeps the patient folders reading as they always did", () => {
    expect(bucketResultCount("active", 3)).toBe("3 active results");
    expect(bucketResultCount("completed", 1)).toBe("1 completed result");
    expect(bucketEmptyNoun("stuck")).toBe("stuck patients");
  });

  it("does not call an order a patient, or say 'orders results'", () => {
    expect(bucketResultCount("orders", 3)).toBe("3 orders");
    expect(bucketResultCount("orders", 1)).toBe("1 order");
    expect(bucketEmptyNoun("orders")).toBe("orders");
  });

  it("phrases every folder — a new one must not fall through to a template", () => {
    for (const b of SEARCH_BUCKETS) {
      expect(bucketResultCount(b, 2), b).toMatch(/^2 \S/);
      expect(bucketEmptyNoun(b), b).toBeTruthy();
    }
  });
});
