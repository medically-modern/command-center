/** E-07 days outstanding per patient per bucket (CR-8 B), from cached activity spans only. */
import type { HolderSpan } from "../types";
import type { Ctx } from "./context";
const bdOf = (c: Ctx, a: number, b: number) => c.bh(a, b) / 24;
export interface BucketDays { inBucketBd: number; escalatedEpisodeBd: number; trips: number; synthetic: boolean }

/** Days outstanding per patient per bucket (E-02 extended, CR-8 B): from cached activity spans only. */
export function bucketDays(c: Ctx, spans: HolderSpan[]): BucketDays | null {
  const last = spans[spans.length - 1];
  if (!last || last.endMs != null || last.kind === "EXITED") return null;
  let i = spans.length - 1; while (i > 0 && spans[i - 1].kind === last.kind && last.kind !== "QUEUE") i--;
  // Episode: everything after the last dead-lead (Stuck) span; Stuck ends an episode.
  let ep = 0; for (let j = spans.length - 1; j >= 0; j--) if (spans[j].kind === "STUCK" && j !== spans.length - 1) { ep = j + 1; break; }
  let esc = 0, trips = 0;
  for (let j = ep; j < spans.length; j++) {
    const s = spans[j];
    if (s.kind === "MGR" || s.kind === "FINAL") { esc += bdOf(c, s.startMs, s.endMs ?? c.now); if (j > ep && spans[j - 1].kind === "QUEUE") trips++; if (j === ep) trips++; }
  }
  return { inBucketBd: bdOf(c, spans[i].startMs, c.now), escalatedEpisodeBd: esc, trips, synthetic: spans[i].synthetic };
}

