/**
 * The New Order Board in System Management → Search — findable, and **nowhere
 * near the other folders** (Josh, 2026-09-15: *"add them to the search but ONLY
 * show them in a tab to the right of stuck that says orders"*).
 *
 * ⚠️ **THIS BOARD IS DELIBERATELY NOT IN `BOARDS`, AND MUST NOT BE MOVED THERE.**
 * That registry is not "boards search reads" — it is the cross-board patient
 * registry, and six other things key off it (§5.35 records the decision, this
 * is the list):
 *
 *  - `assignedPatients/patientLookup` resolves an INBOUND CALLER against every
 *    board in it, while the phone is ringing. One patient has one item per
 *    reorder, so a caller with twelve orders would return twelve rows and the
 *    lookup could name the CALLER by an order item that opens no stage page.
 *  - `commsHub/dossierApi` builds a patient's stage trail from it — twelve
 *    order items would bury the five stages the pane exists to show.
 *  - The gateway's `DIRECTORY_BOARDS` MIRRORS it (`directoryCoverage.test.ts`
 *    fails the build on a drift), so adding a board here is a Railway change.
 *  - `profileStatus.test.ts` asserts `STUCK_GROUP_IDS`/`COMPLETED_GROUP_IDS`
 *    against it in both directions.
 *  - `fetchAllPatients` — the seven-board snapshot behind the pipeline chart,
 *    the totals and the stage filter — would grow by 1,484 items that are not
 *    pipeline stages.
 *  - `PipelineChart` would draw order stages as pipeline stages.
 *
 * So the board rides the LIVE SEARCH ONLY (`LIVE_SEARCH_BOARDS`), which is what
 * the search box actually asks (§7 — the snapshot stopped answering it on
 * 2026-09-03). The one extra alias on a request that already runs is the whole
 * cost; nothing else in the app can tell the board was added.
 *
 * ⚠️ **THE GROUP IS NOT THE STAGE — API STATUS IS** (§5.35). A Delivered order
 * can still sit in *Accepted / Partial* (11 live rows do, because workflow
 * 7920451305 moves on `SHIPPED` only), and 609 pre-poller orders in
 * Shipped/Delivered carry no API Status at all. So a row's stage comes from
 * `orders/workflow.orderStage` + `cardinalStatus`, the same rules the Orders
 * page uses — never from `groupTitle`, and never re-implemented here (§5.35's
 * keep-in-agreement #2).
 */
import {
  BOARD_ID as ORDERS_BOARD,
  COL,
  GROUPS,
  GROUP_TITLES,
} from "@/lib/orders/mondayApi";
import { STAGE_LABEL, cardinalStatus, orderStage } from "@/lib/orders/workflow";
import type { BoardDef, RowRouting } from "./mondayApi";

export const ORDERS_BOARD_ID = ORDERS_BOARD;

/** Is this row an ORDER rather than a patient's stage on a pipeline board? */
export function isOrderRow(p: { boardId: number }): boolean {
  return p.boardId === ORDERS_BOARD_ID;
}

/**
 * The columns a search row needs beyond what `BoardDef` already names: the
 * three `cardinalStatus` reads, plus the two that tell one of a patient's
 * orders from the next on screen. Named rather than positional — this object is
 * both the fetch list (via `extraColumnIds`) and what `orderSearchFields` reads
 * back, so a reorder here cannot silently repoint one of them.
 */
export const ORDER_SEARCH_COLS = {
  apiStatus: COL.apiStatus,
  holdReason: COL.holdReason,
  apiMessage: COL.apiMessage,
  orderDate: COL.orderDate,
  cahOrderNumber: COL.cahOrderNumber,
} as const;

/**
 * The board as search reads it. Every group routes to `/orders` — the page
 * opens any order by `?orderId=`, whatever group it sits in — and **no group is
 * `isCompleted`**, deliberately: Shipped/Delivered is a finished ORDER, not a
 * finished patient, and flagging it would file those rows under the Completed
 * folder, which is the one thing this whole module exists to prevent.
 */
export const ORDERS_SEARCH_BOARD: BoardDef = {
  boardId: ORDERS_BOARD_ID,
  boardName: "New Order Board",
  groupRoutes: Object.values(GROUPS).map((id) => ({
    id,
    title: GROUP_TITLES[id],
    roleRoute: "/orders",
  })),
  escalationColId: null,
  escalationNotesColId: null,
  phoneColId: COL.phone,
  // Order Status is this board's advancer in the sense that matters here: it is
  // what `orderStage` reads first. Nothing in Search WRITES it — the "Ordered"
  // flip is `orders/mondayWrite.markOrdered`, and it is dark (§5.35).
  stageAdvancerColId: COL.orderStatus,
  daysSinceStageColId: null,
  notesColId: COL.notes,
  notesColType: "long_text",
  // ⚠️ NOT Order Date. That column is the placement date, and on an On Hold
  // order it is the day the snooze returns it — neither is a "next action" the
  // rest of the app means, and `systemProfileStatus` would read it as Waiting.
  nextActionDateColId: null,
  extraColumnIds: Object.values(ORDER_SEARCH_COLS),
};

/**
 * The columns that identify an ORDER rather than the patient on it — what a rep
 * has in front of them when somebody rings about a package (Josh, 2026-09-15).
 *
 * The same set the Orders page's own search matches (`workflow.orderMatchesQuery`
 * — name · phone · CAH · PO · all five tracking · item id), so a number that
 * finds an order on one screen finds it on the other. The item id is not a
 * column and needs none: the PO Number **contains** it (`MM-<itemId>-<yyyymmdd>`,
 * verified live), so a `contains_text` on the digits reaches it anyway.
 *
 * ⚠️ These are SEARCHED but not FETCHED — deliberately absent from
 * `ORDER_SEARCH_COLS`. Monday does the matching server-side, so pulling six
 * more columns onto every order row would buy nothing a rep reads: the row
 * already names the order by date, group and CAH number.
 *
 * ⚠️ All five tracking columns, not just the first. An order that ships in two
 * boxes carries a second number, and a rep pastes whichever one the patient
 * read out to them.
 */
export const ORDER_IDENTIFIER_COLS: readonly string[] = [
  COL.cahOrderNumber,
  COL.poNumber,
  COL.tracking1,
  COL.tracking2,
  COL.tracking3,
  COL.tracking4,
  COL.tracking5,
];

/**
 * The identifier columns a TYPED query should also match on this board — and
 * none at all on every other, which is what keeps this rule from leaking.
 */
export function orderIdentifierColumns(board: { boardId: number }): readonly string[] {
  return isOrderRow(board) ? ORDER_IDENTIFIER_COLS : [];
}

export interface OrderRowInput {
  groupId: string;
  orderStatus: string;
  apiStatus: string;
  holdReason: string;
  apiMessage: string;
}

/**
 * The one line a rep reads when a patient rings asking where their order is.
 *
 * The lifecycle stage answers it up to the point Cardinal takes over; from
 * there **Cardinal's own verdict is the more precise answer** and replaces it —
 * "Partially shipped" over "Shipped", "On hold — Credit Check Failure" over
 * "Placed — in progress". A `none` verdict falls back to the stage, which is
 * what keeps the 609 pre-poller rows reading "Shipped" rather than blank.
 */
export function orderSearchStage(i: OrderRowInput): string {
  const stage = orderStage(i);
  if (stage === "inProgress" || stage === "shipped" || stage === "delivered") {
    const verdict = cardinalStatus(i.apiStatus, i.holdReason, i.apiMessage);
    if (verdict.kind !== "none") return verdict.label;
  }
  return STAGE_LABEL[stage];
}

/**
 * What tells one order from another on screen. A patient with eight reorders
 * returns eight rows carrying the same name, the same phone and often the same
 * stage; without this they are indistinguishable and the folder is unreadable.
 */
export function orderSearchSubtitle(i: {
  groupId: string;
  orderDate: string;
  cahOrderNumber: string;
}): string {
  const parts = [formatOrderDate(i.orderDate), GROUP_TITLES[i.groupId] ?? ""].filter(Boolean);
  const cah = (i.cahOrderNumber ?? "").trim();
  if (cah) parts.push(`CAH ${cah}`);
  return parts.join(" · ");
}

/** `2026-09-15` → `9/15/26`. Monday hands these back as naive ET dates (§9), so
 *  they are sliced, never parsed — `new Date("2026-09-15")` is UTC midnight and
 *  renders as the 14th west of Greenwich. */
function formatOrderDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? "").trim());
  if (!m) return "";
  return `${Number(m[2])}/${Number(m[3])}/${m[1].slice(2)}`;
}

/** Where an order row points: the Orders page, always, and it always opens. */
export function orderRowRouting(i: OrderRowInput): RowRouting {
  return {
    pipelineStage: orderSearchStage(i),
    roleRoute: "/orders",
    isCompleted: false,
    hasPage: true,
  };
}

/**
 * Everything an order row overrides on `SystemPatient`, from one raw item.
 *
 * `col` is the caller's column reader, so the mapper in `mondayApi.ts` needs no
 * knowledge of this board's columns — it hands over the item and takes back the
 * finished fields.
 */
export function orderSearchFields(
  group: { id: string; title: string },
  orderStatus: string,
  col: (id: string) => string,
): RowRouting & { subtitle: string } {
  const routing = orderRowRouting({
    groupId: group.id,
    orderStatus,
    apiStatus: col(ORDER_SEARCH_COLS.apiStatus),
    holdReason: col(ORDER_SEARCH_COLS.holdReason),
    apiMessage: col(ORDER_SEARCH_COLS.apiMessage),
  });
  return {
    ...routing,
    subtitle: orderSearchSubtitle({
      groupId: group.id,
      orderDate: col(ORDER_SEARCH_COLS.orderDate),
      cahOrderNumber: col(ORDER_SEARCH_COLS.cahOrderNumber),
    }),
  };
}

/**
 * Newest order first, by ITEM ID rather than by Order Date.
 *
 * ⚠️ The date is not the creation order: workflow 7919939752 rewrites Order
 * Date to the day an On Hold snooze returns, so a held order carries a FUTURE
 * date and would sort above orders placed after it. Monday item ids increase
 * with creation, and an order item is created when the order is, so the id is
 * the one field that answers "which of these is the latest".
 */
export function compareOrdersNewestFirst(a: { id: string }, b: { id: string }): number {
  return (Number(b.id) || 0) - (Number(a.id) || 0);
}
