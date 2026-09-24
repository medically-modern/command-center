/**
 * The Subscription view's overview strip — Brandon's four facts, not the
 * board's six (§5.46b).
 *
 * Josh, 2026-09-22: *"Delete Days to order: 70 Days in profile - not on
 * redesign - same with cycle - doesn't have first order - just make
 * subscription board look identical to the redesign"*. His `profilePage` strip
 * is exactly **Status · Next order · Subscription · First order**; ours was the
 * SUBSCRIPTION stage-detail map's first section, which is Status · Next order ·
 * Days to order · Cycle · Order type · Orders so far.
 *
 * ⚠️ **Built HERE rather than by trimming that map.** `stageDetail`'s
 * SUBSCRIPTION section is also what the Communications hub's dossier pane
 * renders (§5.28), where a rep on a call wants the cycle and the days-to-order
 * status. Editing the shared map to fix this screen would quietly change that
 * one — the §5.7 hazard with two readers instead of two repos.
 *
 * ⚠️ **"Days to order" is not lost by accident.** It is the board's own STATUS
 * column (`color_mkxmtv9c`, "70 Days" / "Late" / "Very Late"), and the strip
 * now computes the same thing from the DATE, which is the more precise answer
 * and the one Brandon shows. Josh named it as a difference from the mockup;
 * this is that difference closed, not a fact dropped on the floor.
 */
import { etToday } from "@/lib/masheke/etDate";
import { etDateOf } from "@/lib/patient/infoStrip";

const SUBSCRIPTION_BOARD = 18407459988;

/** Column ids on the Subscription board (18407459988) this strip reads. */
export const OVERVIEW_COLS = {
  status: "color_mm2t7tdy",
  nextOrder: "date_mkp0nvf1",
  subscription: "color_mm273mv8",
  orderType: "color_mm2w6kd",
  /** Brandon's pixel-match (2026-09-24): "Subscription = Sensors · First Order
   *  · 90-Days". The cadence is the board's own Order Frequency — the column
   *  the Welcome Call → Subscription hops fill (§5.31c). */
  orderFrequency: "color_mm48kv1c",
} as const;

/**
 * The columns this strip needs, for the dossier read (`dossierApi`).
 *
 * ⚠️ Additive and invisible in the Comms Hub, like the four modules beside it
 * there: that pane renders from `buildStageDetail`'s map, so an extra id only
 * widens a `column_values(ids:)` list that already runs. Four of these five
 * are in the SUBSCRIPTION map already; Order Frequency is the one it adds.
 */
export function overviewColumns(boardId: number): string[] {
  return boardId === SUBSCRIPTION_BOARD ? Object.values(OVERVIEW_COLS) : [];
}

export interface OverviewFact {
  label: string;
  value: string;
  /** A quieter second clause on the same line — Brandon's `<span class="xs muted">`. */
  note?: string;
  /** Rendered in the warning colour: only ever a next order that has passed. */
  warn?: boolean;
  /** Next order only: whole ET days until it (negative once it has passed),
   *  or null when the date is unreadable. The Orders tab's "places in N days"
   *  chip reads it (pixel-match Phase 2); the Profile strip does not. */
  days?: number | null;
  /** Subscription only: the cadence on its own. Brandon's Upcoming order strip
   *  shows "Sensors · 90-Days" where the Profile strip shows
   *  "Sensors · First Order · 90-Days" (pixel-match Phase 2). */
  frequency?: string;
}

/** "2026-09-26" → "9/26/2026"; anything else passes through verbatim.
 *  ⚠️ Monday's dates are naive ET, so they are never parsed into a Date (§9). */
export function usDate(raw: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((raw ?? "").trim());
  if (!m) return (raw ?? "").trim();
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
}

/**
 * How far off the next order is, in whole ET days.
 *
 * ⚠️ **Compared as CALENDAR DAYS in ET, never as `Date` arithmetic on a board
 * value** — §5.15's standing trap, where building a Date from a naive board
 * string in a UTC container put patients three hours and sometimes a day out.
 * Both sides are `YYYY-MM-DD`, so the subtraction is done on a UTC midnight
 * built from the parts, which cannot drift.
 */
export function daysUntil(ymd: string, today: string = etToday()): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd ?? "").trim());
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!a || !b) return null;
  const at = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const bt = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.round((at - bt) / 86_400_000);
}

/** "in 4 days" · "today" · "3 days overdue". Empty when the date is unreadable. */
export function dueText(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "today";
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? "" : "s"} overdue`;
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

/**
 * The four facts, in Brandon's order.
 *
 * ⚠️ **A blank stays blank — never a zero and never invented.** Missing and
 * empty are different facts everywhere on these boards (§5.31f · §5.31g), and
 * a First order of "—" on a patient whose orders have not been read yet is
 * honest where a date guessed from the board's created stamp is not.
 */
export function subscriptionOverview(
  cols: Record<string, string> | undefined,
  /** Every order date this patient has, in any order. `null` while unread. */
  orderDates: readonly string[] | null,
  today: string = etToday(),
  opts: {
    /** The Subscription item's `created_at` (a UTC instant) — First order's
     *  fallback once the orders are READ and none carries a date. */
    createdAt?: string;
  } = {},
): OverviewFact[] {
  const col = (id: string) => (cols?.[id] ?? "").trim();

  const nextRaw = col(OVERVIEW_COLS.nextOrder);
  const days = daysUntil(nextRaw, today);
  const sub = col(OVERVIEW_COLS.subscription);
  const type = col(OVERVIEW_COLS.orderType);
  const freq = col(OVERVIEW_COLS.orderFrequency);

  /* ⚠️ Earliest, not `orders[last]`: the history table is sorted newest-first
     for the rep, and a patient's orders do not arrive in any promised order
     from Monday either. A blank date sorts out rather than counting as "the
     beginning of time". */
  const earliest = (orderDates ?? []).filter(Boolean).sort()[0] ?? "";
  /* Brandon's fallback — "first order = earliest order date, falling back to
     the board item's created date" (pixel-match, item 4). ⚠️ Only once the
     orders are READ: while they are still loading, a date borrowed from the
     row's creation would flip to a real order date a second later, so the
     fact stays blank until there is an answer. `created_at` is a real UTC
     instant, so it is the one date here that goes through a `Date` (§5.46f). */
  const first = earliest
    ? usDate(earliest)
    : orderDates !== null && opts.createdAt
      ? usDate(etDateOf(opts.createdAt))
      : "";

  return [
    { label: "Status", value: col(OVERVIEW_COLS.status) },
    {
      label: "Next order",
      value: usDate(nextRaw),
      note: dueText(days),
      warn: days !== null && days < 0,
      days,
    },
    /* "Sensors · First Order · 90-Days" — the order type and the cadence ride
       as the quieter clause, Brandon's `<span class="xs muted">`. */
    { label: "Subscription", value: sub, note: [type, freq].filter(Boolean).join(" · "), frequency: freq },
    { label: "First order", value: first },
  ];
}
