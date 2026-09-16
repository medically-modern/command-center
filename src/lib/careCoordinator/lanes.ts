/**
 * Lane packing for the Care Coordinator's horizontal day strip (§5.30).
 * Pure, so it can be tested without rendering the strip.
 */
/**
 * Lay overlapping bookings out in lanes: each block takes the first lane whose
 * last block ended before it starts. Two calls at 10:00 sit one above the
 * other rather than on top of each other.
 */
export function laneFor<T extends { start: number; end: number }>(blocks: T[]): (T & { lane: number })[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end);
  const laneEnds: number[] = [];
  return sorted.map((b) => {
    let lane = laneEnds.findIndex((end) => end <= b.start);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(b.end); }
    else laneEnds[lane] = b.end;
    return { ...b, lane };
  });
}

/**
 * A booked name split over two lines — first name above, surname below.
 *
 * Brandon, 2026-09-16: "the first name in the middle and the last name at the
 * bottom. Stacking the name means each line only has to fit one word, which is
 * what makes short calls readable." A 10-minute call is 40px wide at 240px an
 * hour, so one word per line is the difference between a legible chip and an
 * ellipsis.
 *
 * Everything after the first token is the surname, so "Lisa Nelson Rivera"
 * keeps both surnames on the lower line rather than losing one.
 */
export function splitName(name: string): { first: string; last: string } {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: "", last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/**
 * Where the strip should be scrolled to when it opens, in pixels.
 *
 * Brandon: "it scrolls so the view starts one hour before now. You'd always
 * see the last hour and the next 4–5 hours." Clamped at zero so an early
 * morning never scrolls backwards past the start of the day.
 */
export function initialScrollLeft(
  nowMinutes: number,
  startMinutes: number,
  pxPerHour: number,
  leadMinutes = 60,
): number {
  const from = nowMinutes - leadMinutes - startMinutes;
  return Math.max(0, (from / 60) * pxPerHour);
}
