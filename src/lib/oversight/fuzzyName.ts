/**
 * Fuzzy patient-name matching for the Pipeline Oversight search bar.
 *
 * Every whitespace-separated query token must match the name either as a
 * case-insensitive substring, or (for tokens of 4+ chars) as an in-order
 * subsequence — so "jsmth" still finds "John Smith" but short tokens like
 * "an" don't light up half the board.
 */
export function fuzzyNameMatch(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const n = (name || "").toLowerCase();
  return q
    .split(/\s+/)
    .every((tok) => n.includes(tok) || (tok.length >= 4 && isSubsequence(tok, n)));
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i++;
    if (i >= needle.length) return true;
  }
  return i >= needle.length;
}
