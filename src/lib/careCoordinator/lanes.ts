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
