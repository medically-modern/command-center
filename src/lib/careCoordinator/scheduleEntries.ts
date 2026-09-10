/**
 * What sits on the Care Coordinator's day grid — from EITHER source.
 *
 * The grid used to render intake bookings alone, straight off the monday
 * mirror. It now also renders WELCOME CALL bookings, and those come from a
 * different place for a reason that is structural rather than incidental:
 *
 *  · **Intake calls have a monday mirror.** The dtc-mm-form backend writes
 *    Scheduled Call Time / Booking Status / Calendly Event URI onto the
 *    patient's Profile Send Off row, so the app reads them with an ordinary
 *    board query and gets a monday item id for free (CLAUDE.md §5.15).
 *  · **Welcome calls have none.** The Welcome Call board has no booking column
 *    at all — checked against the live board 2026-09-10, 156 columns, not one
 *    of them a booking — and nothing copies the intake mirror across the board
 *    hop (§5.26, §5.31b). Calendly is the only record there is, so those come
 *    through the gateway's `/calendly/day` read.
 *
 * Both are adapted to ONE shape here so the grid has a single thing to render
 * and a single set of sequencing rules (`lib/scheduledCalls/workflow.ts`, whose
 * helpers are widened to `BookedSlot` for exactly this). Two parallel renderers
 * is how the day view and the ten-minute reminder drift apart.
 */
import type { BookedSlot, ScheduledCall } from "@/lib/scheduledCalls/workflow";
import type { CalendlyBooking } from "./calendlyDay";

export type ScheduleKind = "intake" | "welcome";

/** Which sources the grid is showing. The grid's toggle picks one of these. */
export type ScheduleSource = ScheduleKind | "both";

export interface ScheduleEntry extends BookedSlot {
  /**
   * React key, unique ACROSS sources. A monday item id and a Calendly event
   * URI cannot collide, and the kind prefix means they provably can't even if
   * one day they could — the same patient legitimately appears twice when they
   * have both an intake and a welcome call booked.
   */
  key: string;
  kind: ScheduleKind;
  /** The second line on the block. */
  detail: string;
  /**
   * Where "Open" goes, or null when we cannot say WHICH patient this is.
   *
   * ⚠️ Null is a real and expected state for a welcome-call booking: it is
   * matched back to a board item by the invitee's email, and a booking made
   * with a different address than the board holds matches nothing (the same
   * single join the intake mirror depends on — §5.15). A block with no link is
   * still worth rendering: the coordinator can see the call is happening.
   * Guessing a patient would be worse than not linking.
   */
  href: string | null;
}

const FROM = "from=care-coordinator";

/** An intake booking off the monday mirror. */
export function intakeEntry(c: ScheduledCall): ScheduleEntry {
  return {
    key: `intake:${c.id}`,
    kind: "intake",
    name: c.name,
    callDate: c.callDate,
    callTime: c.callTime,
    bookingStatus: c.bookingStatus,
    detail: [c.requestType, c.reason].filter(Boolean).join(" · ") || "Intake call",
    href: `/unverified-referrals?patientId=${encodeURIComponent(c.id)}&${FROM}`,
  };
}

/**
 * Eastern wall-clock parts of a UTC instant.
 *
 * ⚠️ Calendly returns UTC ISO 8601; everything on this grid is naive Eastern
 * (§5.15). Formatting the instant with the browser's own zone would render a
 * 2 PM appointment at 11 AM for anyone west of ET and — far worse — put it on
 * the WRONG DAY either side of midnight, which is how a booking silently
 * disappears from the day a coordinator is looking at. `en-CA` is used because
 * it formats as YYYY-MM-DD, the shape the rest of the grid compares on.
 */
export function etPartsOf(utcIso: string): { date: string; time: string } {
  const at = new Date(utcIso);
  if (!utcIso || Number.isNaN(at.getTime())) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  // Intl renders midnight as "24" in some engines under hour12:false.
  const hh = get("hour") === "24" ? "00" : get("hour");
  return { date, time: `${hh}:${get("minute")}:${get("second")}` };
}

/**
 * A welcome-call booking from Calendly.
 *
 * `itemIdForEmail` resolves the invitee to a Welcome Call board item; it
 * returns null whenever it cannot be sure, and that null flows straight through
 * to `href`.
 */
export function welcomeEntry(
  b: CalendlyBooking,
  itemIdForEmail: (email: string) => string | null,
): ScheduleEntry {
  const { date, time } = etPartsOf(b.startTime);
  const itemId = itemIdForEmail(b.email);
  return {
    key: `welcome:${b.eventUri}:${b.email}`,
    kind: "welcome",
    name: b.name || "(no name on the booking)",
    callDate: date,
    callTime: time,
    // Calendly only ever hands back events we asked for as ACTIVE, so anything
    // that reaches here is booked. `isLiveBooking` treats blank as live.
    bookingStatus: "Scheduled",
    detail: b.eventName || "Welcome call",
    href: itemId ? `/welcome-call?patientId=${encodeURIComponent(itemId)}&${FROM}` : null,
  };
}

/**
 * Email → Welcome Call board item id.
 *
 * ⚠️ POSITIVE EVIDENCE ONLY, and deliberately strict in both directions:
 * a blank email matches nothing, and an email held by MORE THAN ONE item in
 * the queue matches nothing either. An ambiguous match would put one patient's
 * "Open" link on another patient's call — the §5.28 `nameMatchAccepted` rule,
 * for the same reason. Failing to link costs a click; linking wrongly opens the
 * wrong chart on a live call.
 */
export function emailIndex(items: { id: string; email: string }[]): Map<string, string | null> {
  const seen = new Map<string, string | null>();
  for (const it of items) {
    const key = (it.email || "").trim().toLowerCase();
    if (!key) continue;
    // Second sighting of an address poisons it rather than overwriting.
    seen.set(key, seen.has(key) ? null : it.id);
  }
  return seen;
}

/** Both sources merged, filtered to what the toggle is showing. */
export function entriesFor(
  source: ScheduleSource,
  intake: ScheduleEntry[],
  welcome: ScheduleEntry[],
): ScheduleEntry[] {
  if (source === "intake") return intake;
  if (source === "welcome") return welcome;
  return [...intake, ...welcome];
}
