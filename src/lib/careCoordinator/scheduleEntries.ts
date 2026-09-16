/**
 * What sits on the Care Coordinator's day grid — from EITHER source.
 *
 * ⚠️ **CALENDLY IS THE SOURCE OF TRUTH; THE MONDAY MIRROR IS THE BACKUP**
 * (Josh, 2026-09-16). It was the other way round until then, and that is the
 * whole of why a real intake booking could be missing from the strip:
 *
 *  · **Welcome calls have no mirror.** The Welcome Call board has no booking
 *    column at all — checked against the live board 2026-09-10, 156 columns,
 *    not one of them a booking — and nothing copies the intake mirror across
 *    the board hop (§5.26, §5.31b). Calendly was always their only record.
 *  · **Intake calls have a mirror, and it drops bookings.** dtc-mm-form writes
 *    Scheduled Call Time / Booking Status / Calendly Event URI onto the
 *    patient's Profile Send Off row — but only when it can find that row, and
 *    it finds it by matching the invitee's EMAIL inside the two DTC form
 *    groups (§5.15). A patient who books under another address, or whose row
 *    has moved on to Profile Clean-Up, is mirrored NOWHERE and nothing errors.
 *    The board carried exactly three mirrored bookings on 2026-09-16.
 *
 * So the grid now asks Calendly for BOTH kinds and renders exactly what comes
 * back. The mirror is still read — it is instant, it survives a Calendly
 * outage, and it is what supplies the monday item id an intake block needs for
 * its "Open" link — but it no longer decides which calls exist.
 *
 * Both sources are adapted to ONE shape here so the grid has a single thing to
 * render and a single set of sequencing rules (`lib/scheduledCalls/workflow.ts`,
 * whose helpers are widened to `BookedSlot` for exactly this). Two parallel
 * renderers is how the day view and the ten-minute reminder drift apart.
 *
 * ⚠️ The ten-minute reminder (`ScheduledCallHost`) still reads the MIRROR and
 * is still intake-only, so a booking the mirror never caught now appears on
 * this strip and still raises no reminder. The footnote says so rather than
 * promising one (§5.15: "fix the copy, not the gate").
 */
import type { BookedSlot, ScheduledCall } from "@/lib/scheduledCalls/workflow";
import type { CalendlyBooking } from "./calendlyDay";

export type ScheduleKind = "intake" | "welcome";

/** Which sources the grid is showing. The grid's toggle picks one of these. */
export type ScheduleSource = ScheduleKind | "both";

/**
 * How long a block is when we have no end time to measure.
 *
 * Both live Calendly event types are 10 minutes (verified against
 * `/api/calendly/health`, 2026-09-16), and a mirror row records only the
 * start, so this is the mirror's fallback rather than a guess about Calendly.
 */
export const ASSUMED_DURATION_MIN = 10;

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
   * Minutes long, from Calendly's own start/end where we have them.
   *
   * ⚠️ The strip draws a block exactly this wide (Brandon, 2026-09-16: "Chip
   * width always equals the call's length"), so a wrong value here is a block
   * that ends on the wrong line rather than a cosmetic slip.
   */
  durationMin: number;
  /**
   * Where "Open" goes, or null when we cannot say WHICH patient this is.
   *
   * ⚠️ Null is a real and expected state: a booking is matched back to a board
   * item by its Calendly event URI or the invitee's email, and a booking made
   * under an address the board does not hold matches neither — which is the
   * same single join the mirror itself depends on, and the reason this grid
   * stopped depending on the mirror. A block with no link is still worth
   * rendering: the coordinator can see the call is happening. Guessing a
   * patient would be worse than not linking.
   */
  href: string | null;
}

const FROM = "from=care-coordinator";

const hrefFor = (kind: ScheduleKind, itemId: string): string =>
  kind === "welcome"
    ? `/welcome-call?patientId=${encodeURIComponent(itemId)}&${FROM}`
    : `/unverified-referrals?patientId=${encodeURIComponent(itemId)}&${FROM}`;

/** An intake booking off the monday mirror — the BACKUP source. */
export function intakeEntry(c: ScheduledCall): ScheduleEntry {
  return {
    key: `intake:${c.id}`,
    kind: "intake",
    name: c.name,
    callDate: c.callDate,
    callTime: c.callTime,
    bookingStatus: c.bookingStatus,
    detail: [c.requestType, c.reason].filter(Boolean).join(" · ") || "Intake call",
    durationMin: ASSUMED_DURATION_MIN,
    href: hrefFor("intake", c.id),
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
 * How many minutes a Calendly booking runs for.
 *
 * ⚠️ Falls back to `ASSUMED_DURATION_MIN` rather than to zero for anything it
 * cannot measure — a zero-width block is an invisible appointment, which is
 * the one failure this grid exists to prevent. Clamped at both ends so a
 * malformed pair cannot stretch a block across the whole day either.
 */
export function durationOf(startIso: string, endIso: string): number {
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  if (!startIso || !endIso || Number.isNaN(a) || Number.isNaN(b)) return ASSUMED_DURATION_MIN;
  const mins = Math.round((b - a) / 60_000);
  if (!Number.isFinite(mins) || mins <= 0) return ASSUMED_DURATION_MIN;
  return Math.min(mins, 8 * 60);
}

/**
 * A booking straight from Calendly — the source of truth, either kind.
 *
 * `itemIdFor` resolves the booking to a board item; it returns null whenever
 * it cannot be sure, and that null flows straight through to `href`.
 */
export function calendlyEntry(
  b: CalendlyBooking,
  itemIdFor: (b: CalendlyBooking) => string | null,
): ScheduleEntry {
  const { date, time } = etPartsOf(b.startTime);
  const kind: ScheduleKind = b.kind === "intake" ? "intake" : "welcome";
  const itemId = itemIdFor(b);
  return {
    key: `${kind}:${b.eventUri}:${b.email}`,
    kind,
    name: b.name || "(no name on the booking)",
    callDate: date,
    callTime: time,
    // Calendly only ever hands back events we asked for as ACTIVE, so anything
    // that reaches here is booked. `isLiveBooking` treats blank as live.
    bookingStatus: "Scheduled",
    detail: b.eventName || (kind === "welcome" ? "Welcome call" : "Intake call"),
    durationMin: durationOf(b.startTime, b.endTime),
    href: itemId ? hrefFor(kind, itemId) : null,
  };
}

/** Kept for callers that only ever hand this function welcome bookings. */
export function welcomeEntry(
  b: CalendlyBooking,
  itemIdForEmail: (email: string) => string | null,
): ScheduleEntry {
  return calendlyEntry({ ...b, kind: "welcome" }, (x) => itemIdForEmail(x.email));
}

/**
 * Key → board item id, for the two joins that link a booking to a chart.
 *
 * ⚠️ POSITIVE EVIDENCE ONLY, and deliberately strict in both directions:
 * a blank key matches nothing, and a key held by MORE THAN ONE item in the
 * queue matches nothing either. An ambiguous match would put one patient's
 * "Open" link on another patient's call — the §5.28 `nameMatchAccepted` rule,
 * for the same reason. Failing to link costs a click; linking wrongly opens
 * the wrong chart on a live call.
 */
function indexBy<T>(items: T[], keyOf: (t: T) => string, idOf: (t: T) => string): Map<string, string | null> {
  const seen = new Map<string, string | null>();
  for (const it of items) {
    const key = (keyOf(it) || "").trim().toLowerCase();
    if (!key) continue;
    // Second sighting of a key poisons it rather than overwriting.
    seen.set(key, seen.has(key) ? null : idOf(it));
  }
  return seen;
}

/** Email → board item id. */
export function emailIndex(items: { id: string; email: string }[]): Map<string, string | null> {
  return indexBy(items, (i) => i.email, (i) => i.id);
}

/**
 * Calendly event URI → monday item id, off the mirror's own Event URI column.
 *
 * This is the BETTER of the two intake joins and is tried first: it is the
 * exact event, so it cannot be confused by a shared or mistyped address, and
 * the column is already in the Care Coordinator's intake read. Email is the
 * fallback for a row whose URI never landed.
 */
export function eventUriIndex(items: { id: string; calendlyEventUri: string }[]): Map<string, string | null> {
  return indexBy(items, (i) => normalizeEventUri(i.calendlyEventUri), (i) => i.id);
}

/** Trailing slashes and case are not part of the identity. */
export function normalizeEventUri(uri: string): string {
  return (uri || "").trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * The resolver the grid hands `calendlyEntry` — URI first, then email, per kind.
 *
 * Welcome bookings have only the email join (their board carries no URI
 * column, because it carries no booking columns at all).
 */
export function bookingLinker(indexes: {
  intakeByUri: Map<string, string | null>;
  intakeByEmail: Map<string, string | null>;
  welcomeByEmail: Map<string, string | null>;
}): (b: CalendlyBooking) => string | null {
  return (b) => {
    const email = (b.email || "").trim().toLowerCase();
    if (b.kind === "intake") {
      const byUri = indexes.intakeByUri.get(normalizeEventUri(b.eventUri));
      if (byUri) return byUri;
      return indexes.intakeByEmail.get(email) ?? null;
    }
    return indexes.welcomeByEmail.get(email) ?? null;
  };
}

export interface ScheduleMerge {
  entries: ScheduleEntry[];
  /** True when the strip is showing mirror rows because Calendly is unreadable. */
  fellBackToMirror: boolean;
}

/**
 * Which source the strip renders.
 *
 * ⚠️ **When Calendly answers, the strip IS Calendly** (Josh, 2026-09-16: "show
 * exactly what's on calendly on the table"). The mirror is not merged in
 * alongside it, and that is deliberate rather than lazy: a mirror row Calendly
 * did not return is a booking that was cancelled or rescheduled and whose
 * webhook we missed, and showing it sends a coordinator to ring somebody who
 * called off — the same failure §5.15 records for a stale Booking Status.
 *
 * ⚠️ When Calendly CANNOT be read, the mirror is all there is, and showing it
 * beats showing an empty day. The caller must still say on screen that welcome
 * calls are missing from that fallback, because the mirror has never held one.
 * `calendlyOk` must be false while the first read is still in flight, or the
 * strip blinks empty before Calendly answers.
 */
export function mergeSchedule(input: {
  calendly: ScheduleEntry[];
  mirror: ScheduleEntry[];
  calendlyOk: boolean;
}): ScheduleMerge {
  if (input.calendlyOk) return { entries: input.calendly, fellBackToMirror: false };
  return { entries: input.mirror, fellBackToMirror: input.mirror.length > 0 };
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
