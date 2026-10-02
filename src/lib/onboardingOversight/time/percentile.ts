/** Nearest-rank percentile (BUILD-SPEC §3.1): sorted[ceil(p/100*n)-1]; null below minSample. */
export function percentile(values: number[], p: number, minSample = 1): number | null {
  if (values.length < Math.max(1, minSample)) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil((p / 100) * s.length) - 1);
  return s[idx];
}
export const median = (v: number[], minSample = 1) => percentile(v, 50, minSample);
