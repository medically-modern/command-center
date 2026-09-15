/**
 * The New Order Board in Search — it is findable, and it is ONLY findable in
 * its own folder.
 *
 * The two halves of that are tested in different places by design: the folder
 * rule is `searchBuckets.test.ts` (an order is an order before it is anything
 * else), and what keeps the board OUT of the patient registry is here, because
 * that separation is the whole design and nothing else would notice it moving.
 */
import { describe, it, expect } from "vitest";
import { BOARDS, LIVE_SEARCH_BOARDS, searchColumnIds } from "./mondayApi";
import {
  ORDERS_BOARD_ID,
  ORDERS_SEARCH_BOARD,
  ORDER_SEARCH_COLS,
  compareOrdersNewestFirst,
  isOrderRow,
  orderRowRouting,
  orderSearchStage,
  orderSearchSubtitle,
} from "./ordersSearch";
import { GROUPS } from "@/lib/orders/mondayApi";

const input = (over: Partial<Parameters<typeof orderSearchStage>[0]> = {}) => ({
  groupId: GROUPS.acceptedPartial,
  orderStatus: "Process Claim",
  apiStatus: "",
  holdReason: "",
  apiMessage: "",
  ...over,
});

describe("where the order board lives", () => {
  it("is SEARCHED but is not in the patient registry", () => {
    /* ⚠️ The two lists mean different things and this is the assertion that
       keeps them apart. `BOARDS` is also the inbound-call lookup, the Comms Hub
       dossier, the gateway's mirrored directory, the pipeline chart and the
       seven-board snapshot — a board with one item per REORDER belongs in none
       of them (§5.35). Moving it there compiles and passes every other test. */
    expect(BOARDS.some((b) => b.boardId === ORDERS_BOARD_ID)).toBe(false);
    expect(LIVE_SEARCH_BOARDS.some((b) => b.boardId === ORDERS_BOARD_ID)).toBe(true);
  });

  it("adds exactly one board to the live search and changes nothing else", () => {
    expect(LIVE_SEARCH_BOARDS).toHaveLength(BOARDS.length + 1);
    for (const b of BOARDS) {
      expect(LIVE_SEARCH_BOARDS).toContain(b);
    }
  });

  it("never marks a group completed — Shipped/Delivered is a finished ORDER", () => {
    // A completed flag here would file those rows under the Completed folder,
    // which is the one thing the board being in Search must not do.
    expect(ORDERS_SEARCH_BOARD.groupRoutes.some((g) => g.isCompleted)).toBe(false);
  });

  it("routes every group to the Orders page, and covers all five", () => {
    expect(ORDERS_SEARCH_BOARD.groupRoutes.map((g) => g.id).sort()).toEqual(
      Object.values(GROUPS).slice().sort(),
    );
    for (const g of ORDERS_SEARCH_BOARD.groupRoutes) {
      expect(g.roleRoute).toBe("/orders");
      expect(g.title, `group ${g.id} has no title`).toBeTruthy();
    }
  });

  it("fetches every column the stage and the subtitle read", () => {
    // §5.11's trap: a column missing from the read set renders as a
    // permanently blank field with no error — here, every order would read
    // "Placed — in progress" whatever Cardinal actually said.
    const cols = searchColumnIds(ORDERS_SEARCH_BOARD);
    for (const id of Object.values(ORDER_SEARCH_COLS)) expect(cols).toContain(id);
    expect(cols).toContain(ORDERS_SEARCH_BOARD.phoneColId);
    expect(cols).toContain(ORDERS_SEARCH_BOARD.stageAdvancerColId);
  });
});

describe("orderSearchStage", () => {
  it("names the step a rep can act on before Cardinal has it", () => {
    expect(orderSearchStage(input({ orderStatus: "Order", groupId: GROUPS.order }))).toBe("To place");
    expect(orderSearchStage(input({ orderStatus: "On Hold" }))).toBe("On hold");
    expect(orderSearchStage(input({ orderStatus: "Ordered" }))).toBe("Placing");
  });

  it("lets Cardinal's verdict replace the stage once Cardinal has it", () => {
    expect(orderSearchStage(input({ apiStatus: "Delivered" }))).toBe("Delivered");
    expect(orderSearchStage(input({ apiStatus: "Partially Shipped" }))).toBe("Partially shipped");
    expect(orderSearchStage(input({ apiStatus: "Backordered" }))).toBe("Backordered");
    expect(orderSearchStage(input({ apiStatus: "Needs Review" }))).toBe("Needs review");
  });

  it("reads a hold reason that the API Status label alone does not admit to", () => {
    // The live shape: API Status "Warning", Hold Reason "Credit Check Failure".
    // The label alone reads as fine; the row has to say the order is stopped.
    expect(
      orderSearchStage(input({ apiStatus: "Warning", holdReason: "Credit Check Failure" })),
    ).toBe("On hold — Credit Check Failure");
  });

  it("does not resurrect a STALE hold on an order that shipped anyway", () => {
    /* ⚠️ Live on the board today: several delivered and partially-shipped
       orders still carry Hold Reason "Credit Check Failure" — the poller never
       clears that column, so it is a record of a hold that once delayed the
       order, not a live one (§5.35). Reading the reason first would tell a
       patient their delivered order is stuck. `cardinalStatus` matches the
       shipped/delivered labels ahead of the reason; this asserts the order. */
    expect(
      orderSearchStage(input({ apiStatus: "Delivered", holdReason: "Credit Check Failure" })),
    ).toBe("Delivered");
    expect(
      orderSearchStage(input({ apiStatus: "Partially Shipped", holdReason: "Credit Check Failure" })),
    ).toBe("Partially shipped");
  });

  it("keeps the 609 pre-poller rows reading Shipped, not blank", () => {
    // Placed before the Cardinal poller existed: no API Status at all, and the
    // GROUP is the only evidence they shipped.
    expect(orderSearchStage(input({ groupId: GROUPS.shippedDelivered, apiStatus: "" }))).toBe("Shipped");
  });

  it("does not let the group overrule Cardinal", () => {
    // 11 live rows: delivered, still sitting in Accepted / Partial because
    // workflow 7920451305 only moves on SHIPPED.
    expect(
      orderSearchStage(input({ groupId: GROUPS.acceptedPartial, apiStatus: "Delivered" })),
    ).toBe("Delivered");
  });

  it("calls a cancelled or returned order what it is", () => {
    expect(orderSearchStage(input({ groupId: GROUPS.cancelled }))).toBe("Cancelled");
    expect(orderSearchStage(input({ groupId: GROUPS.returns }))).toBe("Returns");
  });
});

describe("orderSearchSubtitle", () => {
  it("tells one of a patient's reorders from the next", () => {
    expect(
      orderSearchSubtitle({
        groupId: GROUPS.shippedDelivered,
        orderDate: "2026-08-14",
        cahOrderNumber: "1119501795",
      }),
    ).toBe("8/14/26 · Shipped/Delivered · CAH 1119501795");
  });

  it("drops what the order does not have yet rather than printing a gap", () => {
    expect(orderSearchSubtitle({ groupId: GROUPS.order, orderDate: "2026-09-15", cahOrderNumber: "" }))
      .toBe("9/15/26 · Order");
    expect(orderSearchSubtitle({ groupId: GROUPS.order, orderDate: "", cahOrderNumber: "" }))
      .toBe("Order");
  });

  it("slices the date, never parses it", () => {
    // §9 — `new Date("2026-01-01")` is UTC midnight, which renders as 12/31
    // west of Greenwich. Monday hands these back as naive ET dates.
    expect(
      orderSearchSubtitle({ groupId: GROUPS.order, orderDate: "2026-01-01", cahOrderNumber: "" }),
    ).toBe("1/1/26 · Order");
  });
});

describe("orderRowRouting", () => {
  it("always opens, never reads as finished", () => {
    const r = orderRowRouting(input({ groupId: GROUPS.shippedDelivered, apiStatus: "Delivered" }));
    expect(r).toMatchObject({ roleRoute: "/orders", hasPage: true, isCompleted: false });
    expect(r.pipelineStage).toBe("Delivered");
  });
});

describe("compareOrdersNewestFirst", () => {
  it("sorts by item id, so the latest order leads", () => {
    const rows = [{ id: "100" }, { id: "300" }, { id: "200" }];
    expect(rows.slice().sort(compareOrdersNewestFirst).map((r) => r.id)).toEqual(["300", "200", "100"]);
  });

  it("does not sort by Order Date, which a snooze moves into the future", () => {
    /* Workflow 7919939752 rewrites Order Date to the day an On Hold snooze
       returns, so a held order carries a date LATER than orders placed after
       it. The id cannot be rewritten; that is the whole reason it is the key. */
    const held = { id: "100", orderDate: "2026-12-01" };
    const newer = { id: "500", orderDate: "2026-09-15" };
    expect([held, newer].sort(compareOrdersNewestFirst)[0].id).toBe("500");
  });
});

describe("isOrderRow", () => {
  it("keys on the board, the one fact that cannot be edited on the item", () => {
    expect(isOrderRow({ boardId: ORDERS_BOARD_ID })).toBe(true);
    expect(isOrderRow({ boardId: 18410601299 })).toBe(false);
  });
});
