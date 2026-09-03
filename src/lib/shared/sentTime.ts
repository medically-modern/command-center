/**
 * "When was this sent?" for Monday date+time text.
 *
 * Monday returns these columns as "2026-04-30 20:00:00 UTC" or
 * "2026-04-30 20:00:00" — normalise both, and render in ET, because every date
 * on these boards is Eastern wall-clock (§9).
 *
 * Split out of the fax-status chip so that file exports only components
 * (react-refresh), and so anything else needing "was this sent today" gets the
 * same answer rather than its own near-copy.
 */

function toDate(iso: string): Date {
  return new Date(iso.replace(/\s+UTC$/, "Z").replace(" ", "T"));
}

/** True when `iso` falls on today's date in ET. */
export function isSentToday(iso?: string): boolean {
  if (!iso) return false;
  const d = toDate(iso);
  if (Number.isNaN(d.getTime())) return false;
  const etDate = (x: Date) =>
    x.toLocaleDateString("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  return etDate(d) === etDate(new Date());
}

export function formatSent(iso: string): string {
  const d = toDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }) + " ET";
}
