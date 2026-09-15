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
import {
  BOARDS,
  LIVE_SEARCH_BOARDS,
  liveSearchRules,
  phoneRulesLiteral,
  rulesLiteral,
  searchColumnIds,
} from "./mondayApi";
import {
  ORDERS_BOARD_ID,
  ORDERS_SEARCH_BOARD,
  ORDER_IDENTIFIER_COLS,
  ORDER_SEARCH_COLS,
  compareOrdersNewestFirst,
  isOrderRow,
  orderIdentifierColumns,
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

/**
 * "Make CAH and tracking numbers searchable there" (Josh, 2026-09-15).
 *
 * ⚠️ The real values straddle `liveSearchRules`' digits-vs-name split, which is
 * why the rule has to be on both paths. Measured off the live board the same
 * day: CAH `1120085378` (10 digits) and FedEx tracking `526783026915` (12) are
 * PHONE queries; PO `MM-12660776179-20260729` is a one-word NAME query. Cover
 * one path only and half of what a rep pastes finds nothing, silently.
 */
describe("searching an order by its own number", () => {
  const orders = ORDERS_SEARCH_BOARD;
  const insurance = BOARDS.find((b) => b.boardId === 18410601299)!;
  const literalFor = (q: string, board = orders) => {
    const rules = liveSearchRules(q);
    if (!rules) throw new Error(`"${q}" is too short to search`);
    return rulesLiteral(board, rules);
  };

  it("finds a CAH number, which arrives as a digits query", () => {
    const lit = literalFor("1120085378");
    expect(lit).toContain(ORDER_SEARCH_COLS.cahOrderNumber);
    expect(lit).toContain('compare_value: ["1120085378"]');
    // The phone columns stay in: the same ten digits could be a phone number,
    // and the rep does not have to tell us which they are holding.
    expect(lit).toContain(orders.phoneColId);
    expect(lit).toContain("operator: or");
  });

  it("finds a tracking number, including a second package's", () => {
    const lit = literalFor("526783026915");
    for (const col of ORDER_IDENTIFIER_COLS) expect(lit, col).toContain(col);
  });

  it("finds a PO number, which arrives as a one-word NAME query", () => {
    // `MM-12660776179-20260729` is not all digits, so it takes the other path.
    const rules = liveSearchRules("MM-12660776179-20260729");
    expect(rules).toEqual({ kind: "name", terms: ["MM-12660776179-20260729"] });
    const lit = rulesLiteral(orders, rules!);
    expect(lit).toContain("operator: or");
    expect(lit).toContain('compare_value: ["MM-12660776179-20260729"]');
    // …and still matches the patient's name, or a one-word name search would
    // have stopped working on this board.
    expect(lit).toContain('column_id: "name"');
  });

  it("reaches the item id through the PO number rather than a column of its own", () => {
    // The PO is `MM-<itemId>-<yyyymmdd>`, so the digits are inside it.
    expect(literalFor("12660776179")).toContain(ORDER_IDENTIFIER_COLS[1]);
  });

  it("keeps a MULTI-word query ANDed on names — an identifier has no space", () => {
    const lit = literalFor("jose delgado");
    expect(lit).toContain("operator: and");
    expect(lit).not.toContain(ORDER_SEARCH_COLS.cahOrderNumber);
  });

  it("changes nothing on any other board", () => {
    for (const b of BOARDS) {
      expect(orderIdentifierColumns(b), b.boardName).toEqual([]);
    }
    const lit = literalFor("1120085378", insurance);
    expect(lit).toBe(phoneRulesLiteral(insurance, ["1120085378"]));
    expect(lit).not.toContain(ORDER_SEARCH_COLS.cahOrderNumber);
  });

  it("⚠️ NEVER lets the same-number pass match an identifier", () => {
    /* `phoneRulesLiteral` is what the same-number pass asks with, and that pass
       means "the other records belonging to THIS PERSON's number". A CAH number
       is ten digits exactly as a phone number is, so an identifier rule here
       would let one patient's number pull in a stranger's order and file it
       under their name. The widening belongs to the TYPED query alone. */
    const lit = phoneRulesLiteral(orders, ["5555550100"]);
    for (const col of ORDER_IDENTIFIER_COLS) expect(lit, col).not.toContain(col);
    expect(lit).toContain(orders.phoneColId);
  });

  it("searches the identifiers without fetching them", () => {
    // Monday matches server-side, so pulling six more columns onto every order
    // row would buy nothing a rep reads. CAH is the one exception: the row
    // prints it, so it is in the READ set for that reason, not this one.
    const read = searchColumnIds(orders);
    for (const col of ORDER_IDENTIFIER_COLS) {
      if (col === ORDER_SEARCH_COLS.cahOrderNumber) continue;
      expect(read, col).not.toContain(col);
    }
  });
});
