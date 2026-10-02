/**
 * Shares of ALL past due for the overview's two boxes (Brandon): the two header %s sum to 100, and each box's row %s
 * sum to its header %. Whole numbers by largest remainder, so nothing is off by one.
 */
import type { Bucket } from "./model";

/** Split `total` whole points across `parts` in proportion to their weights (largest remainder). */
export function largestRemainder(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0); if (!sum) return weights.map(() => 0);
  const raw = weights.map((w) => (w / sum) * total); const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  for (const i of raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i)) { if (left <= 0) break; out[i]++; left--; }
  return out;
}

export interface Box { n: number; pct: number; rows: { b: Bucket; i: number; pct: number }[] }
export function pastDueShares(buckets: Bucket[]): { esc: Box; proc: Box; total: number } {
  // Brandon: purely by Past Due, largest first; Priority never reorders or greys these rows.
  const rows = buckets.map((b, i) => ({ b, i })).filter(({ b }) => b.pastDue > 0).sort((x, y) => y.b.pastDue - x.b.pastDue || y.b.untouched - x.b.untouched);
  const esc = rows.filter(({ b }) => b.kind === "esc"), proc = rows.filter(({ b }) => b.kind === "step");
  const en = esc.reduce((n, r) => n + r.b.pastDue, 0), pn = proc.reduce((n, r) => n + r.b.pastDue, 0), total = en + pn;
  const [ep, pp] = total ? largestRemainder([en, pn], 100) : [0, 0];
  const box = (rs: typeof rows, n: number, pct: number): Box => { const ps = largestRemainder(rs.map((r) => r.b.pastDue), pct); return { n, pct, rows: rs.map((r, k) => ({ ...r, pct: ps[k] })) }; };
  return { esc: box(esc, en, ep), proc: box(proc, pn, pp), total };
}
